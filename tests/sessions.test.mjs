import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { pi, user } from './support/runtime.mjs';
import { host } from './support/host.mjs';
import { assistantMessage } from './support/messages.mjs';

test('assistant activation restores the actual model and leaves primary bytes unchanged', async () => {
  const h = await host();
  try {
    await h.run('assistant');
    assert.equal(h.session.model.id, 'assistant');
    assert.equal(readFileSync(h.primaryPath, 'utf8'), h.primaryBytes);
    assert.equal(h.session.sessionManager.getHeader().parentSession, h.primaryPath);
    assert.match(JSON.stringify(h.session.messages), /Assistant stint begins/);
  } finally { h.close(); }
});

test('assistant cost starts at zero, persists, and counts only newly appended usage', async () => {
  const h = await host();
  try {
    h.session.sessionManager.appendMessage(assistantMessage());
    const primaryBefore = readFileSync(h.primaryPath, 'utf8');
    assert.equal(h.session.getSessionStats().cost, 0.5);
    await h.run('assistant');
    assert.equal(h.session.getSessionStats().cost, 0);
    const sm = h.session.sessionManager;
    const reopened = pi.SessionManager.open(sm.getSessionFile());
    assert.equal(reopened.getEntries().find((entry) =>
      entry.type === 'message' && entry.message.role === 'assistant').message.usage.cost.total, 0);
    sm.appendMessage(assistantMessage());
    assert.equal(h.session.getSessionStats().cost, 0.5);
    assert.equal(readFileSync(h.primaryPath, 'utf8'), primaryBefore);
  } finally { h.close(); }
});

test('fresh session_start applies assistant model even with a CLI-style override', async () => {
  const h = await host();
  try {
    h.forcePrimary = true;
    await h.run('assistant');
    assert.equal(h.session.model.id, 'assistant');
    assert.equal(readFileSync(h.primaryPath, 'utf8'), h.primaryBytes);
  } finally { h.close(); }
});

test('failed live-model verification returns to primary without false success', async () => {
  const h = await host();
  try {
    h.forcePrimary = true;
    h.rejectActivation = true;
    await h.run('assistant');
    assert.equal(h.session.sessionManager.getSessionFile(), h.primaryPath);
    assert.equal(readFileSync(h.primaryPath, 'utf8'), h.primaryBytes);
    assert.ok(h.notifications.some((message) => message.includes('restoration failed')));
    assert.ok(!h.notifications.some((message) => message.includes('Assistant session on')));
  } finally { h.close(); }
});

test('reviewed summary is scoped, tool-free, attributed, and appended after return', async () => {
  const h = await host();
  try {
    await h.run('assistant');
    const assistantId = h.session.sessionManager.getSessionId();
    h.session.sessionManager.appendMessage(user('stint finding'));
    h.choices.push(true);
    h.edits.push('approved and edited summary');
    await h.run('primary');
    assert.equal(h.session.model.id, 'primary');
    const [model, request] = h.summaries[0];
    assert.equal(model.id, 'assistant');
    assert.equal(request.tools, undefined);
    assert.doesNotMatch(JSON.stringify(request), /PRIMARY SECRET/);
    assert.match(JSON.stringify(request), /stint finding/);
    const flowback = h.session.sessionManager.getEntries().at(-1);
    assert.equal(flowback.customType, 'assistant-session/flowback');
    assert.equal(flowback.details.note, 'approved and edited summary');
    assert.equal(flowback.details.assistantSessionId, assistantId);
    assert.equal(flowback.details.summaryModel, 'review-test/assistant');
    assert.match(flowback.content, /File-change detection unavailable/);
  } finally { h.close(); }
});

test('cancelled return writes no flow-back; retry appends exactly once', async () => {
  const h = await host();
  try {
    await h.run('assistant');
    h.cancel = true;
    await h.run('primary');
    assert.equal(readFileSync(h.primaryPath, 'utf8'), h.primaryBytes);
    h.cancel = false;
    await h.run('assistant'); // Toggle also returns to primary.
    assert.equal(h.session.sessionManager.getEntries().filter((e) => e.customType === 'assistant-session/flowback').length, 1);
  } finally { h.close(); }
});

test('cancelled assistant switch removes prepared file and stays in primary', async () => {
  const h = await host();
  try {
    h.cancel = true;
    await h.run('assistant');
    assert.equal(h.session.model.id, 'primary');
    const sessions = await pi.SessionManager.list(h.session.sessionManager.getCwd(), h.session.sessionManager.getSessionDir());
    assert.equal(sessions.length, 1);
    assert.equal(readFileSync(h.primaryPath, 'utf8'), h.primaryBytes);
  } finally { h.close(); }
});

test('discarded summary does not flow back or retain generated-summary attribution', async () => {
  const h = await host();
  try {
    await h.run('assistant');
    h.session.sessionManager.appendMessage(user('some finding'));
    h.choices.push(true, false);
    h.edits.push(undefined);
    await h.run('primary');
    const note = h.session.sessionManager.getEntries().at(-1);
    assert.equal(note.details.note, '');
    assert.equal(note.details.summaryModel, undefined);
    assert.doesNotMatch(note.content, /Summary generated by/);
  } finally { h.close(); }
});

test('Nothing substantive is exact; longer findings with that prefix remain reviewable', async () => {
  const h = await host();
  try {
    await h.run('assistant');
    h.session.sessionManager.appendMessage(user('some work'));
    h.response = { provider: 'review-test', model: 'assistant', content: [{ type: 'text', text: 'Nothing substantive.' }], stopReason: 'stop' };
    h.choices.push(true);
    await h.run('primary');
    assert.equal(h.session.sessionManager.getEntries().at(-1).details.note, '');
    await h.run('assistant');
    h.session.sessionManager.appendMessage(user('new work'));
    h.response = { provider: 'review-test', model: 'assistant', content: [{ type: 'text', text: 'Nothing substantive was changed, but an answer was discovered.' }], stopReason: 'stop' };
    h.choices.push(true);
    h.edits.push('discovered answer');
    await h.run('primary');
    assert.equal(h.session.sessionManager.getEntries().at(-1).details.note, 'discovered answer');
  } finally { h.close(); }
});

test('empty stint avoids a summary call; failed summary allows a manual note', async () => {
  const h = await host();
  try {
    await h.run('assistant');
    h.choices.push(true);
    await h.run('primary');
    assert.equal(h.summaries.length, 0);
    await h.run('assistant');
    h.session.sessionManager.appendMessage(user('new work'));
    h.response = { provider: 'review-test', model: 'assistant', content: [], stopReason: 'aborted' };
    h.choices.push(true, true);
    h.edits.push('manual finding');
    await h.run('primary');
    const note = h.session.sessionManager.getEntries().at(-1);
    assert.equal(note.details.note, 'manual finding');
    assert.equal(note.details.summaryModel, undefined);
    assert.ok(h.notifications.some((message) => message.includes('Could not summarize')));
  } finally { h.close(); }
});
