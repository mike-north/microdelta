/**
 * The executable example may resolve literal source imports only inside its
 * own package; lexical calls to a user-supplied `require` function are not
 * imports. These focused checks pin URL resolution and scope distinctions at
 * the ESLint boundary owned by PKG-004, PKG-007.5 and PKG-008.
 */
import assert from 'node:assert/strict';
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

test('URL-equivalent relative paths cannot reach workspace source while local imports remain allowed', async () => {
  const cases = [
    { source: "void import('../../../packages/history/src/index.js');", allowed: false },
    { source: "void import('./%2e%2e/%2e%2e/%2e%2e/packages/history/src/index.js');", allowed: false },
    { source: "void import('./local.js');", allowed: true },
    { source: "void import('./%2e/local.js');", allowed: true },
  ];

  for (const { source, allowed } of cases) {
    const errors = await diagnostics(source);
    assert.equal(errors.length === 0, allowed, source);
  }
});

test('a lexically shadowed require parameter is a function call, but an unbound require remains an import edge', async () => {
  const shadowed = "export const label = (require: (value: string) => string): string => require('../../../packages/history/src/index.js');";
  const unbound = "require('../../../packages/history/src/index.js');";

  assert.deepEqual(await diagnostics(shadowed), []);
  assert.equal((await diagnostics(unbound)).length, 1);
});
