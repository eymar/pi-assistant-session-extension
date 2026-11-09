import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { loadModule } from './support/runtime.mjs';
import { host } from './support/host.mjs';
const { assistantCachePayload } = await loadModule('lib/cache.ts');
const { cacheFingerprint } = await loadModule('lib/cache-debug.ts');
const model = { provider: 'openai', api: 'openai-responses', id: 'gpt-6-luna', compat: { supportsExplicitPromptCacheMode: true } };
const text = (value) => ({ type: 'input_text', text: value });
const boundaryText = '[test boundary]';
const entries = [
  { type: 'message', id: 'boundary', message: { role: 'user', content: boundaryText } },
  { type: 'custom', customType: 'assistant-session/primary-ref', data: {
    primaryPath: '/primary', model: 'openai/gpt-6-luna', boundaryId: 'boundary' } },
];
const ctx = { model, sessionManager: { getBranch: () => entries } };
function request() {
  return { model: 'gpt-6-luna', prompt_cache_key: 'stint',
    prompt_cache_options: { mode: 'implicit', ttl: '30m' },
    input: [
      { role: 'developer', content: [text('instructions')] },
      { role: 'user', content: [text('inherited question'), { type: 'input_image', image_url: 'example' }] },
      { role: 'assistant', content: [{ type: 'output_text', text: 'inherited answer' }] },
      { role: 'user', content: [text(boundaryText)] },
      { role: 'user', content: [text('new side question')] },
    ] };
}
const points = (payload) => payload.input.flatMap((item, i) => (item.content ?? [])
  .flatMap((block, j) => block.prompt_cache_breakpoint ? [[i, j]] : []));

test('compatible GPT breakpoint marks only inherited user text, preserving implicit retention policy', () => {
  const payload = request();
  const original = structuredClone(payload);
  const rewritten = assistantCachePayload(payload, ctx);
  assert.deepEqual(payload, original);
  assert.deepEqual(points(rewritten), [[1, 0]]);
  assert.deepEqual(cacheFingerprint(rewritten).inputItems[1].breakpointBlocks, [0]);
  assert.deepEqual(rewritten.input[1].content[0].prompt_cache_breakpoint, { mode: 'explicit' });
  assert.deepEqual(rewritten.prompt_cache_options, original.prompt_cache_options);
  const cleaned = structuredClone(rewritten);
  delete cleaned.input[1].content[0].prompt_cache_breakpoint;
  assert.deepEqual(cleaned, { ...original, prompt_cache_key: rewritten.prompt_cache_key });
});

test('unsupported models, absent/ambiguous boundaries, and missing eligible inherited blocks skip annotation', () => {
  const variants = [];
  const absent = request(); absent.input.splice(3, 1); variants.push(absent);
  const ambiguous = request(); ambiguous.input.push({ role: 'user', content: [text(boundaryText)] }); variants.push(ambiguous);
  const noText = request(); noText.input[1].content = [{ type: 'input_image' }]; variants.push(noText);
  for (const payload of variants) assert.deepEqual(points(assistantCachePayload(payload, ctx)), []);
  for (const id of ['gpt-5.4', 'gpt-6.1-sol', 'gpt-6-luna']) {
    const compatible = { ...request(), model: id };
    assert.deepEqual(points(assistantCachePayload(compatible, { ...ctx,
      model: { ...model, id } })), [[1, 0]], id);
  }
  const nonGpt = { ...request(), model: 'o4-mini' };
  assert.deepEqual(points(assistantCachePayload(nonGpt, { ...ctx, model: { ...model, id: 'o4-mini' } })), []);
  const unsupported = { ...request(), model: 'gpt-5.5' };
  assert.deepEqual(points(assistantCachePayload(unsupported, { ...ctx,
    model: { ...model, id: 'gpt-5.5', compat: { supportsExplicitPromptCacheMode: false } } })), []);
  assert.deepEqual(points(assistantCachePayload(request(), { model, sessionManager: {
    getBranch: () => [entries[1]] } })), []);
});

test('explicit-only mode and existing breakpoints are not overridden', () => {
  const explicit = request(); explicit.prompt_cache_options.mode = 'explicit';
  assert.deepEqual(points(assistantCachePayload(explicit, ctx)), []);
  const existing = request();
  existing.input[0].content[0].prompt_cache_breakpoint = { mode: 'explicit', ttl: '12h' };
  const result = assistantCachePayload(existing, ctx);
  assert.deepEqual(points(result), [[0, 0]]);
  assert.deepEqual(result.input, existing.input);
});

test('default implicit mode stays unset and repeated rewrites do not add more breakpoints', () => {
  const payload = request(); delete payload.prompt_cache_options;
  const rewritten = assistantCachePayload(payload, ctx);
  assert.equal(rewritten.prompt_cache_options, undefined);
  assert.deepEqual(points(rewritten), [[1, 0]]);
  assert.deepEqual(assistantCachePayload(rewritten, ctx), rewritten);
});

test('real SDK stint hook locates the persisted boundary without changing session files', async () => {
  const h = await host();
  try {
    await h.run('assistant');
    const sm = h.session.sessionManager;
    const marker = sm.getBranch().find((entry) => entry.type === 'custom' && entry.customType === 'assistant-session/primary-ref');
    const boundary = sm.getEntry(marker.data.boundaryId).message.content;
    const payload = request(); payload.input[3].content = [text(boundary)];
    const before = readFileSync(sm.getSessionFile(), 'utf8');
    const result = h.handlers.get('before_provider_request')({ payload }, { model, sessionManager: sm });
    assert.deepEqual(points(result), [[1, 0]]);
    assert.equal(readFileSync(sm.getSessionFile(), 'utf8'), before);
  } finally { h.close(); }
});
