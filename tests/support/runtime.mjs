import { after } from 'node:test';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { createRequire } from 'node:module';
import { pathToFileURL, fileURLToPath } from 'node:url';

// npm install resolves locally. PI_PACKAGE_ROOT permits tests against Pi's own
// installed package without installing a second copy or making network calls.
const require = createRequire(import.meta.url);
export const packageEntry = process.env.PI_PACKAGE_ROOT
  ? join(resolve(process.env.PI_PACKAGE_ROOT), 'dist/index.js')
  : require.resolve('@earendil-works/pi-coding-agent');
export const pi = await import(pathToFileURL(packageEntry).href);
const packageRequire = createRequire(packageEntry);
const { createJiti } = packageRequire('jiti');
export const home = mkdtempSync(join(tmpdir(), 'assistant-tests-'));
const previousHome = process.env.HOME;
process.env.HOME = home;
mkdirSync(join(home, '.pi/agent'), { recursive: true });
writeFileSync(join(home, '.pi/agent/assistant-session.json'), JSON.stringify({ model: 'review-test/assistant' }));
const jiti = createJiti(import.meta.url, {
  alias: { '@earendil-works/pi-coding-agent': packageEntry }, moduleCache: false,
});
export const projectRoot = fileURLToPath(new URL('../../', import.meta.url));
export const loadModule = (path) => jiti.import(join(projectRoot, path));
after(() => {
  if (previousHome === undefined) delete process.env.HOME;
  else process.env.HOME = previousHome;
  rmSync(home, { recursive: true, force: true });
});
export const temporary = () => mkdtempSync(join(home, 'case-'));
export const user = (content) => ({ role: 'user', content, timestamp: 0 });
