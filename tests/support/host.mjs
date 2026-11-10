import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { pi, temporary, user, loadModule } from './runtime.mjs';
const extension = await loadModule('assistant-session.ts');

// Commands run against actual SDK sessions and restore selected models from disk.
// A small host wrapper supplies dialogs and enforces stale-context restrictions.
export async function host() {
  const root = temporary();
  const commands = new Map();
  const handlers = new Map();
  const notifications = [];
  const statuses = [];
  const choices = [];
  const edits = [];
  const summaries = [];
  const settings = pi.SettingsManager.inMemory();
  const modelRuntime = await pi.ModelRuntime.create({ authPath: join(root, 'auth.json'), modelsPath: join(root, 'models.json') });
  modelRuntime.registerProvider('review-test', {
    api: 'openai-completions', baseUrl: 'https://example.invalid', apiKey: 'not-a-real-key',
    models: ['primary', 'assistant'].map((id) => ({ id, name: id, reasoning: false, input: ['text'],
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }, contextWindow: 128000, maxTokens: 4096 })),
  });
  await modelRuntime.refresh({ allowNetwork: false });
  const loader = new pi.DefaultResourceLoader({ cwd: root, agentDir: root, settingsManager: settings,
    noExtensions: true, noSkills: true, noPromptTemplates: true, noThemes: true });
  await loader.reload();
  let current;
  let cancelSwitch = false;
  let forcePrimaryModel = false;
  let rejectModelActivation = false;
  const ui = { notify: (message) => notifications.push(message), setStatus: (key, text) => statuses.push([key, text]),
    confirm: async () => choices.shift() ?? false, editor: async () => edits.shift(),
    select: async () => { throw Error('unexpected picker'); } };
  const registry = new pi.ModelRegistry(modelRuntime);
  registry.complete = async (...args) => { summaries.push(args); return response; };
  let response = { provider: 'review-test', model: 'assistant', content: [{ type: 'text', text: 'summary' }], stopReason: 'stop' };
  function context(session) {
    const check = () => assert.equal(current, session, 'old context used after replacement');
    return {
      get sessionManager() { check(); return session.sessionManager; },
      get model() { check(); return session.model; },
      get cwd() { check(); return root; },
      get ui() { check(); return ui; },
      get hasUI() { check(); return true; },
      get modelRegistry() { check(); return registry; },
      waitForIdle: async () => { check(); },
      sendMessage: async (message) => { check(); await session.sendCustomMessage(message); },
      switchSession: async (path, options) => {
        check();
        if (cancelSwitch) return { cancelled: true };
        await activate(pi.SessionManager.open(path));
        await options?.withSession?.(context(current));
        return { cancelled: false };
      },
    };
  }
  async function activate(sm, initialModel) {
    current?.dispose();
    ({ session: current } = await pi.createAgentSession({ cwd: root, agentDir: root, sessionManager: sm,
      settingsManager: settings, resourceLoader: loader, modelRuntime,
      model: forcePrimaryModel ? modelRuntime.getModel('review-test', 'primary') : initialModel, noTools: true }));
    await handlers.get('session_start')?.({ reason: 'resume' }, context(current));
  }
  extension.default({ registerCommand: (name, command) => commands.set(name, command),
    setModel: async (model) => {
      if (rejectModelActivation) return false;
      await current.setModel(model);
      return true;
    },
    on: (name, handler) => handlers.set(name, handler) });
  const sm = pi.SessionManager.create(root, join(root, 'sessions'));
  sm.appendMessage(user('PRIMARY SECRET'));
  await activate(sm, modelRuntime.getModel('review-test', 'primary'));
  const primaryPath = sm.getSessionFile();
  const primaryBytes = readFileSync(primaryPath, 'utf8');
  return {
    commands, choices, edits, summaries, notifications, statuses, handlers, primaryPath, primaryBytes,
    get session() { return current; },
    set cancel(value) { cancelSwitch = value; },
    set forcePrimary(value) { forcePrimaryModel = value; },
    set rejectActivation(value) { rejectModelActivation = value; },
    set response(value) { response = value; },
    run: async (name) => commands.get(name).handler('', context(current)),
    close: () => current.dispose(),
  };
}
