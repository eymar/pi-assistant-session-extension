import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { loadModule } from './support/runtime.mjs';
import { host } from './support/host.mjs';
const { assistantCachePayload } = await loadModule('lib/cache.ts');

const model = { provider: 'openai', api: 'openai-responses', id: 'assistant' };
const marker = (primaryPath = '/sessions/primary.jsonl') => ({
  type: 'custom', customType: 'assistant-session/primary-ref',
  data: { primaryPath, model: 'openai/assistant' },
});
const context = (entries = [marker()], selectedModel = model) => ({
  model: selectedModel, sessionManager: { getBranch: () => entries },
});
const request = () => ({ model: 'assistant', prompt_cache_key: 'unique-stint-id',
  input: [{ role: 'user', content: 'hello' }], store: false, stream: true,
  prompt_cache_options: { ttl: '30m' }, metadata: { trace: 'keep' } });

test('cache rewrite changes only the outgoing key, preserving source and retention', () => {
  const payload = request();
  const original = structuredClone(payload);
  const rewritten = assistantCachePayload(payload, context());
  assert.deepEqual(payload, original);
  assert.deepEqual(rewritten, { ...original, prompt_cache_key: rewritten.prompt_cache_key });
  assert.match(rewritten.prompt_cache_key, /^assistant:v1:[0-9a-f]{48}$/);
  assert.ok(rewritten.prompt_cache_key.length <= 64);
  assert.ok(!rewritten.prompt_cache_key.includes('/sessions/'));
  assert.notEqual(rewritten.prompt_cache_key, payload.prompt_cache_key);
  assert.equal(assistantCachePayload({ ...payload, prompt_cache_key: 'next-stint-id' }, context()).prompt_cache_key,
    rewritten.prompt_cache_key);
});

test('cache scope separates primaries and actual outgoing models', () => {
  const key = assistantCachePayload(request(), context()).prompt_cache_key;
  assert.notEqual(assistantCachePayload(request(), context([marker('/sessions/other.jsonl')])).prompt_cache_key, key);
  assert.notEqual(assistantCachePayload({ ...request(), model: 'another-model' }, context()).prompt_cache_key, key);
});

test('primary, unsupported providers/APIs, malformed payloads, and disabled caching are untouched', () => {
  assert.equal(assistantCachePayload(request(), context([])), undefined);
  assert.equal(assistantCachePayload(request(), context([marker()], { ...model, provider: 'anthropic' })), undefined);
  assert.equal(assistantCachePayload(request(), context([marker()], { ...model, api: 'openai-completions' })), undefined);
  for (const payload of [null, [], 42, 'text', {}, { ...request(), model: null },
    { ...request(), prompt_cache_key: undefined }, { ...request(), prompt_cache_key: null }]) {
    assert.equal(assistantCachePayload(payload, context()), undefined);
  }
});

test('registered hook shares a key across real stints without changing session IDs or files', async () => {
  const h = await host();
  try {
    const hook = h.handlers.get('before_provider_request');
    const emit = () => hook({ payload: request() }, { model, sessionManager: h.session.sessionManager });
    assert.equal(emit(), undefined, 'primary requests are untouched');
    await h.run('assistant');
    const firstId = h.session.sessionManager.getSessionId();
    const path = h.session.sessionManager.getSessionFile();
    const before = readFileSync(path, 'utf8');
    const primaryBefore = readFileSync(h.primaryPath, 'utf8');
    const firstKey = emit().prompt_cache_key;
    assert.equal(h.session.sessionManager.getSessionId(), firstId);
    assert.equal(readFileSync(path, 'utf8'), before);
    assert.equal(readFileSync(h.primaryPath, 'utf8'), primaryBefore);
    await h.run('primary');
    assert.equal(emit(), undefined);
    await h.run('assistant');
    const secondId = h.session.sessionManager.getSessionId();
    assert.notEqual(firstId, secondId);
    assert.equal(emit().prompt_cache_key, firstKey);
    assert.equal(h.session.sessionManager.getSessionId(), secondId);
    assert.notEqual(h.session.sessionManager.getSessionFile(), path);
  } finally { h.close(); }
});
