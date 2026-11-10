import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync, rmSync, chmodSync } from 'node:fs';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { temporary, loadModule } from './support/runtime.mjs';
const extension = await loadModule('lib/files.ts');

function git(root, args) {
  return execFileSync('git', ['-C', root, ...args], { encoding: 'utf8' });
}
function repo() {
  const root = temporary();
  git(root, ['init', '-q']);
  writeFileSync(join(root, 'tracked.txt'), 'base\n');
  writeFileSync(join(root, '.gitignore'), 'ignored.txt\n');
  git(root, ['add', '.']);
  git(root, ['-c', 'user.name=Test', '-c', 'user.email=test@example.invalid', 'commit', '-qm', 'base']);
  return root;
}

test('hash snapshots detect already-dirty files, committed edits, and untracked directory contents', async () => {
  const root = repo();
  writeFileSync(join(root, 'tracked.txt'), 'already dirty\n');
  mkdirSync(join(root, 'untracked'));
  writeFileSync(join(root, 'untracked/newline\nname.txt'), 'before');
  const before = await extension.snapshotFiles(root);
  writeFileSync(join(root, 'tracked.txt'), 'assistant edit\n');
  writeFileSync(join(root, 'untracked/newline\nname.txt'), 'after');
  writeFileSync(join(root, 'ignored.txt'), 'outside coverage');
  git(root, ['add', 'tracked.txt']);
  git(root, ['-c', 'user.name=Test', '-c', 'user.email=test@example.invalid', 'commit', '-qm', 'edit']);
  const report = extension.fileChangeReport(before, await extension.snapshotFiles(root));
  assert.deepEqual(report.changed, ['tracked.txt', 'untracked/newline\nname.txt']);
  assert.match(report.text, /newline\\nname/);
  assert.match(report.text, /Ignored files/);
});

test('hash snapshots detect additions, deletion, and executable-bit changes', async () => {
  const root = repo();
  const before = await extension.snapshotFiles(root);
  rmSync(join(root, 'tracked.txt'));
  writeFileSync(join(root, 'added.txt'), 'new');
  chmodSync(join(root, '.gitignore'), 0o755);
  const report = extension.fileChangeReport(before, await extension.snapshotFiles(root));
  assert.deepEqual(report.changed, ['.gitignore', 'added.txt', 'tracked.txt']);
  assert.match(report.text, /deleted: "tracked.txt"/);
});

test('git-status snapshots record clean sentinels and match legacy full-hash comparisons', async () => {
  const root = repo();
  const before = await extension.snapshotFiles(root);
  assert.equal(before.version, 2);
  assert.equal(before.files['tracked.txt'], 'clean');
  assert.equal(before.files['.gitignore'], 'clean');
  // No change between snapshots: nothing to report, as with full hashing.
  assert.deepEqual(extension.fileChangeReport(before, await extension.snapshotFiles(root)).changed, []);
  // Legacy snapshots (no version) still work when both sides use the legacy path.
  const legacy = await extension.snapshotFiles(root, { legacy: true });
  assert.equal(legacy.version, undefined);
  assert.match(legacy.files['tracked.txt'], /^file:/);
  assert.deepEqual(extension.fileChangeReport(legacy, await extension.snapshotFiles(root, { legacy: true })).changed, []);
});

test('a change reverted to the committed state reports as modified, not clean', async () => {
  const root = repo();
  writeFileSync(join(root, 'tracked.txt'), 'already dirty\n');
  const before = await extension.snapshotFiles(root);
  // Assistant reverts the file to its committed content during the stint.
  writeFileSync(join(root, 'tracked.txt'), 'base\n');
  const report = extension.fileChangeReport(before, await extension.snapshotFiles(root));
  assert.deepEqual(report.changed, ['tracked.txt']);
  assert.match(report.text, /modified: "tracked.txt"/);
});

test('mixed snapshot formats report unavailable instead of spurious changes', async () => {
  const root = repo();
  const legacy = await extension.snapshotFiles(root, { legacy: true });
  const current = await extension.snapshotFiles(root);
  assert.match(extension.fileChangeReport(legacy, current).text, /snapshot formats differ/);
  assert.deepEqual(extension.fileChangeReport(legacy, current).changed, []);
});

test('outside Git and legacy baselines explicitly report unavailable coverage', async () => {
  const snapshot = await extension.snapshotFiles(temporary());
  assert.match(extension.fileChangeReport(snapshot, snapshot).text, /unavailable/);
  assert.match(extension.fileChangeReport(undefined, snapshot).text, /Files may have changed/);
});
