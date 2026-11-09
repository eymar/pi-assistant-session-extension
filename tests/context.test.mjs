import { test } from 'node:test';
import assert from 'node:assert/strict';
import { pi, home, user, loadModule } from './support/runtime.mjs';
import { assistantMessage, billedUsage } from './support/messages.mjs';
const extension = await loadModule('lib/context.ts');
const clean = (messages) => messages.map(({ timestamp, fromId, ...message }) => message);
function assertProjectionCopy(source) {
  const target = pi.SessionManager.inMemory(home);
  extension.copyProjection(target, source.buildSessionProjection());
  assert.deepEqual(clean(target.buildSessionProjection().messages), clean(source.buildSessionProjection().messages));
  return target;
}

test('projection respects custom-message replacements and omissions', () => {
  const source = pi.SessionManager.inMemory(home);
  const edited = source.appendCustomMessageEntry('note', 'original secret', true, { metadata: 1 });
  const omitted = source.appendCustomMessageEntry('note', 'omitted secret', true);
  source.appendContextEdit(edited, { content: 'redacted' });
  source.appendContextEdit(omitted, null);
  const target = assertProjectionCopy(source);
  assert.equal(target.buildSessionProjection().messages[0].content, 'redacted');
  assert.equal(target.buildSessionProjection().messages.length, 1);
});

test('projection preserves branch findings with local tree pointers', () => {
  const source = pi.SessionManager.inMemory(home);
  const id = source.appendMessage(user('question'));
  source.branchWithSummary(id, 'important finding');
  const target = assertProjectionCopy(source);
  const entries = target.getEntries();
  assert.equal(entries[1].parentId, entries[0].id);
  assert.equal(entries[1].fromId, entries[0].id);
});

test('projection preserves system checkpoints and suppresses older retained compactions', () => {
  const source = pi.SessionManager.inMemory(home);
  source.appendMessage({ role: 'system', content: 'system instruction', timestamp: 0 });
  const keep = source.appendMessage(user('retained question'));
  source.appendCompaction('OLD summary', keep, 100);
  source.appendMessage(user('retained followup'));
  source.appendCompaction('NEW summary', keep, 200);
  assertProjectionCopy(source);
});

test('projection respects ordinary message edits and excludes abandoned branches', () => {
  const source = pi.SessionManager.inMemory(home);
  const id = source.appendMessage(user('original'));
  source.appendMessage(user('abandoned'));
  source.branch(id);
  source.appendContextEdit(id, { content: 'replacement' });
  const target = assertProjectionCopy(source);
  assert.equal(target.buildSessionProjection().messages.length, 1);
});

for (const role of ['assistant', 'toolResult']) {
  test(`projection clears inherited ${role} costs without changing content, tokens, or source`, () => {
    const source = pi.SessionManager.inMemory(home);
    const message = role === 'assistant' ? assistantMessage() : {
      role, toolCallId: 'call-1', toolName: 'test',
      content: [{ type: 'text', text: 'tool finding' }],
      isError: false, timestamp: 0, usage: billedUsage(),
    };
    source.appendMessage(message);
    const projection = source.buildSessionProjection();
    const original = structuredClone(projection);
    const target = pi.SessionManager.inMemory(home);
    extension.copyProjection(target, projection);
    const copied = target.buildSessionProjection().messages[0];
    const zeroCost = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 };
    assert.deepEqual(copied, { ...message, usage: { ...message.usage, cost: zeroCost } });
    assert.deepEqual(projection, original);
    assert.deepEqual(source.buildSessionProjection(), original);
    assert.notEqual(copied.usage, message.usage);
    assert.notEqual(copied.usage.cost, message.usage.cost);
  });
}

test('projection preserves tool results without usage metadata', () => {
  const source = pi.SessionManager.inMemory(home);
  source.appendMessage({
    role: 'toolResult', toolCallId: 'call-2', toolName: 'test',
    content: [{ type: 'text', text: 'no billing' }], isError: false, timestamp: 0,
  });
  assertProjectionCopy(source);
});

test('summary input excludes inherited history and survives compaction while honoring edits', () => {
  const source = pi.SessionManager.inMemory(home);
  source.appendMessage(user('PRIMARY SECRET'));
  const boundary = source.appendMessage(user('[boundary]'));
  const edited = source.appendMessage(user('old stint question'));
  source.appendContextEdit(edited, { content: 'stint question' });
  source.appendCompaction('mixed PRIMARY SECRET and stint summary', null, 100);
  source.appendMessage(user('stint followup'));
  const messages = extension.stintMessages(source.getBranch(), boundary);
  assert.deepEqual(messages.map((message) => message.content), ['stint question', 'stint followup']);
  assert.equal(extension.stintMessages(source.getBranch(), undefined), undefined);
  source.branch(edited);
  assert.deepEqual(extension.stintMessages(source.getBranch(), boundary).map((m) => m.content), ['old stint question']);
});
