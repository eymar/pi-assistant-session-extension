import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cpSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { packageEntry, projectRoot, temporary } from './support/runtime.mjs';

const loaderPath = join(dirname(packageEntry), 'core/extensions/loader.js');
const { discoverAndLoadExtensions } = await import(pathToFileURL(loaderPath).href);

function assertSingleExtension(result) {
  assert.deepEqual(result.errors, []);
  assert.equal(result.extensions.length, 1, 'helper modules must not be loaded as extensions');
  assert.deepEqual([...result.extensions[0].commands.keys()].sort(), ['assistant', 'primary']);
}

test('Pi loads the source package directory via its manifest', async () => {
  const root = temporary();
  assertSingleExtension(await discoverAndLoadExtensions([projectRoot], root, join(root, 'agent')));
});

test('Pi discovers an installed package with relative helper imports', async () => {
  const root = temporary();
  const agentDir = join(root, 'agent');
  const installed = join(agentDir, 'extensions/assistant-session');
  mkdirSync(installed, { recursive: true });
  for (const name of ['assistant-session.ts', 'package.json', 'lib']) {
    cpSync(join(projectRoot, name), join(installed, name), { recursive: true });
  }
  assertSingleExtension(await discoverAndLoadExtensions([], root, agentDir));
});
