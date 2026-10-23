/**
 * The executable example may resolve literal source imports only inside its
 * own package; lexical calls to a user-supplied `require` function are not
 * imports. These focused checks pin URL resolution and scope distinctions at
 * the ESLint boundary owned by PKG-004, PKG-007.5 and PKG-008.
 */
import assert from 'node:assert/strict';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { ESLint } from 'eslint';
import test from 'node:test';

/** The import boundary is exercised with the example's actual parser and rule configuration. */
const eslint = new ESLint({ cwd: process.cwd(), overrideConfigFile: 'tooling/context-imports.config.mjs' });
/** A representative TypeScript consumer location makes relative imports resolve from the example. */
const importer = 'examples/contribution-report/src/probe.ts';

/** Return only architectural boundary errors for one virtual source file. */
async function diagnostics(source) {
  const [result] = await eslint.lintText(source, { filePath: importer });
  assert.ok(result);
  return result.messages.filter((message) => message.ruleId === 'microdelta/example-source-imports');
}

test('relative, absolute and file-URL imports cannot reach workspace source while local paths remain allowed', async () => {
  const importerPath = path.resolve(importer);
  const workspaceSource = path.resolve('packages/history/src/index.js');
  const exampleSource = path.resolve(path.dirname(importerPath), 'local.js');
  const cases = [
    { source: "void import('../../../packages/history/src/index.js');", allowed: false },
    { source: "void import('./%2e%2e/%2e%2e/%2e%2e/packages/history/src/index.js');", allowed: false },
    { source: `void import('${workspaceSource}');`, allowed: false },
    { source: `void import('${pathToFileURL(workspaceSource).href}');`, allowed: false },
    { source: `import * as workspace from '${workspaceSource}';`, allowed: false },
    { source: `import * as workspaceUrl from '${pathToFileURL(workspaceSource).href}';`, allowed: false },
    { source: "void import('./local.js');", allowed: true },
    { source: "void import('./%2e/local.js');", allowed: true },
    { source: `void import('${exampleSource}');`, allowed: true },
    { source: `void import('${pathToFileURL(exampleSource).href}');`, allowed: true },
    { source: `import * as local from '${exampleSource}';`, allowed: true },
    { source: `import * as localUrl from '${pathToFileURL(exampleSource).href}';`, allowed: true },
  ];

  for (const { source, allowed } of cases) {
    const errors = await diagnostics(source);
    assert.equal(errors.length === 0, allowed, source);
  }
});

test('a locally bound require name is a call, but an unbound require remains a module edge', async () => {
  const shadowed = [
    "export const parameter = (require: (value: string) => string): string => require('../../../packages/history/src/index.js');",
    "function require(value: string): string { return value; } require('../../../packages/history/src/index.js');",
    "const require = (value: string): string => value; require('../../../packages/history/src/index.js');",
    "if (true) { let require: (value: string) => string = (value) => value; require('../../../packages/history/src/index.js'); }",
    "import { require } from './local.js'; require('../../../packages/history/src/index.js');",
  ];
  const unbound = "require('../../../packages/history/src/index.js');";
  const nested = "require('../../../packages/history/src/index.js'); function nested(require: (value: string) => string): string { return require('../../../packages/history/src/index.js'); }";

  for (const source of shadowed) {
    assert.deepEqual(await diagnostics(source), [], source);
  }
  assert.equal((await diagnostics(unbound)).length, 1);
  assert.equal((await diagnostics(nested)).length, 1, 'nested parameter shadows only its own call');
});
