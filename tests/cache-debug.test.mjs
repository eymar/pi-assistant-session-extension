import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync, statSync, symlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { loadModule, temporary } from './support/runtime.mjs';
const { cacheFingerprint, logCacheFingerprint } = await loadModule('lib/cache-debug.ts');
const extension = await loadModule('assistant-session.ts');
const request = () => ({ model: 'assistant', prompt_cache_key: 'original-key',
  reasoning: { effort: 'high' }, prompt_cache_options: { ttl: '30m' },
  tools: [{ name: 'secret-tool', description: 'private instructions' }],
  input: [{ role: 'developer', content: 'PRIVATE MESSAGE '.repeat(700) },
    { type: 'function_call', call_id: 'private-call', arguments: '{"secret":"password"}' }] });

function fixture() {
  const sessionFile = join(temporary(), 'session.jsonl');
  const notices = [];
  return { path: `${sessionFile}.cache-debug.log`, notices,
    ctx: { model: { provider: 'openai', api: 'openai-responses' },
      sessionManager: { getSessionFile: () => sessionFile, getSessionId: () => 'stint-id',
        getBranch: () => [{ type: 'custom', customType: 'assistant-session/primary-ref',
          data: { primaryPath: '/primary', model: 'openai/assistant' } }] },
      ui: { notify: (...args) => notices.push(args) } } };
}
function debug(action) {
  const previous = process.env.PI_ASSISTANT_CACHE_DEBUG;
  process.env.PI_ASSISTANT_CACHE_DEBUG = '1';
  try { return action(); }
  finally {
    if (previous === undefined) delete process.env.PI_ASSISTANT_CACHE_DEBUG;
    else process.env.PI_ASSISTANT_CACHE_DEBUG = previous;
  }
}

test('fingerprints are deterministic, non-mutating, and omit message/tool/argument text', () => {
  const payload = request();
  const before = structuredClone(payload);
  const result = cacheFingerprint(payload);
  assert.deepEqual(result, cacheFingerprint(payload));
  assert.deepEqual(payload, before);
  for (const secret of ['PRIVATE MESSAGE', 'secret-tool', 'private instructions', 'private-call', 'password']) {
    assert.ok(!JSON.stringify(result).includes(secret));
  }
  assert.equal(result.model, 'assistant');
  assert.equal(result.cacheKey, 'original-key');
  assert.equal(result.inputPrefixes.at(-1).bytes, Buffer.byteLength(JSON.stringify(payload.input)));
});

test('fingerprints locate changed input items/fields and retain unchanged prefix hashes', () => {
  const payload = request();
  const first = cacheFingerprint(payload);
  payload.input[1].arguments = '{"secret":"different"}';
  const second = cacheFingerprint(payload);
  assert.deepEqual(first.inputItems[0], second.inputItems[0]);
  assert.deepEqual(first.inputPrefixes[0], second.inputPrefixes[0]);
  assert.notDeepEqual(first.inputPrefixes.at(-1), second.inputPrefixes.at(-1));
  assert.deepEqual(first.inputItems[1].fields.call_id, second.inputItems[1].fields.call_id);
  assert.notDeepEqual(first.inputItems[1].fields.arguments, second.inputItems[1].fields.arguments);
  assert.deepEqual(first.fields.tools, second.fields.tools);
  payload.reasoning.effort = 'low';
  assert.notDeepEqual(first.fields.reasoning, cacheFingerprint(payload).fields.reasoning);
});

test('logging is opt-in and skips primary/unsupported requests', () => {
  const { ctx, path } = fixture();
  debug(() => {
    process.env.PI_ASSISTANT_CACHE_DEBUG = '0';
    logCacheFingerprint(request(), ctx);
    process.env.PI_ASSISTANT_CACHE_DEBUG = '1';
    logCacheFingerprint(request(), { ...ctx, model: { provider: 'anthropic' } });
    logCacheFingerprint(request(), { ...ctx, sessionManager: { getBranch: () => [] } });
    logCacheFingerprint(null, ctx);
    assert.equal(existsSync(path), false);
  });
});

test('registered hook logs the rewritten key to a private append-only sidecar', () => {
  const { ctx, path } = fixture();
  const hooks = new Map();
  extension.default({ on: (event, handler) => hooks.set(event, handler), registerCommand() {} });
  debug(() => {
    const hook = hooks.get('before_provider_request');
    const payload = request();
    const rewritten = hook({ payload }, ctx);
    hook({ payload }, ctx);
    const records = readFileSync(path, 'utf8').trim().split('\n').map(JSON.parse);
    assert.equal(records.length, 2);
    assert.equal(records[0].cacheKey, rewritten.prompt_cache_key);
    assert.match(records[0].cacheKey, /^assistant:v1:/);
    assert.equal(records[0].sessionId, 'stint-id');
    assert.equal(payload.prompt_cache_key, 'original-key');
    assert.equal(statSync(path).mode & 0o777, 0o600);
    assert.equal(existsSync(ctx.sessionManager.getSessionFile()), false);
  });
});

test('logging failures do not abort requests or follow symlinks', () => {
  const { ctx, path, notices } = fixture();
  const target = join(temporary(), 'do-not-touch');
  writeFileSync(target, 'unchanged');
  symlinkSync(target, path);
  debug(() => assert.doesNotThrow(() => logCacheFingerprint(request(), ctx)));
  assert.equal(readFileSync(target, 'utf8'), 'unchanged');
  assert.equal(notices.length, 1);
});
