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

test('outside Git and legacy baselines explicitly report unavailable coverage', async () => {
  const snapshot = await extension.snapshotFiles(temporary());
  assert.match(extension.fileChangeReport(snapshot, snapshot).text, /unavailable/);
  assert.match(extension.fileChangeReport(undefined, snapshot).text, /Files may have changed/);
});
