/**
 * The executable example may resolve literal source imports only inside its
 * own package; lexical calls to a user-supplied `require` function are not
 * imports. These focused checks pin URL resolution and scope distinctions at
 * the ESLint boundary owned by PKG-004, PKG-007.5 and PKG-008.
 */
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
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
  const encodedWorkspacePath = `${path.dirname(importerPath)}/%2e%2e/%2e%2e/%2e%2e/packages/history/src/index.js`;
  const encodedLocalPath = `${path.dirname(importerPath)}/%2e/local.js`;
  const esmForms = [
    (specifier) => `import * as subject from '${specifier}';`,
    (specifier) => `export * from '${specifier}';`,
    (specifier) => `export { IHistory } from '${specifier}';`,
    (specifier) => `void import('${specifier}');`,
    (specifier) => `type Subject = import('${specifier}').IHistory;`,
  ];
  const workspaceSpecifiers = [
    '../../../packages/history/src/index.js',
    './%2e%2e/%2e%2e/%2e%2e/packages/history/src/index.js',
    encodedWorkspacePath,
    workspaceSource,
    pathToFileURL(workspaceSource).href,
    `${pathToFileURL(workspaceSource).href}?version=1#entry`,
    pathToFileURL(workspaceSource).href.replace('file:', 'FILE:'),
    pathToFileURL(workspaceSource).href.replace('file:', 'FiLe:'),
  ];
  const localSpecifiers = [
    './local.js',
    './%2e/local.js',
    encodedLocalPath,
    exampleSource,
    pathToFileURL(exampleSource).href,
    `${pathToFileURL(exampleSource).href}?version=1#entry`,
    pathToFileURL(exampleSource).href.replace('file:', 'FiLe:'),
  ];
  assert.equal(fileURLToPath(new URL(encodedWorkspacePath, pathToFileURL(importerPath))), workspaceSource);
  assert.equal(fileURLToPath(new URL(encodedLocalPath, pathToFileURL(importerPath))), exampleSource);
  const cases = [
    { source: "void import('../../../packages/history/src/index.js');", allowed: false },
    { source: "void import('./%2e%2e/%2e%2e/%2e%2e/packages/history/src/index.js');", allowed: false },
    { source: `void import('${encodedWorkspacePath}');`, allowed: false },
    { source: `void import('${workspaceSource}');`, allowed: false },
    { source: `void import('${pathToFileURL(workspaceSource).href}');`, allowed: false },
    { source: `void import('${pathToFileURL(workspaceSource).href}?version=1#entry');`, allowed: false },
    { source: `void import('${pathToFileURL(workspaceSource).href.replace('file:', 'FILE:')}');`, allowed: false },
    { source: `void import('${pathToFileURL(workspaceSource).href.replace('file:', 'FiLe:')}');`, allowed: false },
    { source: `import * as workspace from '${workspaceSource}';`, allowed: false },
    { source: `import * as workspaceUrl from '${pathToFileURL(workspaceSource).href}';`, allowed: false },
    { source: `export * from '${encodedWorkspacePath}';`, allowed: false },
    { source: `export { IHistory } from '${pathToFileURL(workspaceSource).href.replace('file:', 'FiLe:')}';`, allowed: false },
    { source: `type Workspace = import('${encodedWorkspacePath}').IHistory;`, allowed: false },
    { source: `type WorkspaceFile = import('${pathToFileURL(workspaceSource).href.replace('file:', 'FILE:')}').IHistory;`, allowed: false },
    { source: "void import('./local.js');", allowed: true },
    { source: "void import('./%2e/local.js');", allowed: true },
    { source: `void import('${encodedLocalPath}');`, allowed: true },
    { source: `void import('${exampleSource}');`, allowed: true },
    { source: `void import('${pathToFileURL(exampleSource).href}');`, allowed: true },
    { source: `void import('${pathToFileURL(exampleSource).href}?version=1#entry');`, allowed: true },
    { source: `void import('${pathToFileURL(exampleSource).href.replace('file:', 'FiLe:')}');`, allowed: true },
    { source: `import * as local from '${exampleSource}';`, allowed: true },
    { source: `import * as localUrl from '${pathToFileURL(exampleSource).href}';`, allowed: true },
    { source: "export * from './local.js';", allowed: true },
    { source: `export { Widget } from '${pathToFileURL(exampleSource).href}?version=1#entry';`, allowed: true },
    { source: `type Local = import('${pathToFileURL(exampleSource).href.replace('file:', 'FiLe:')}').Widget;`, allowed: true },
    { source: "import * as packageApi from '@microdelta/history';", allowed: true },
    { source: "import * as nodeApi from 'node:fs';", allowed: true },
    { source: "void import('https://example.invalid/module.js');", allowed: true },
  ];

  for (const form of esmForms) {
    for (const specifier of workspaceSpecifiers) {
      cases.push({ source: form(specifier), allowed: false });
    }
    for (const specifier of localSpecifiers) {
      cases.push({ source: form(specifier), allowed: true });
    }
  }

  for (const { source, allowed } of cases) {
    const errors = await diagnostics(source);
    assert.equal(errors.length === 0, allowed, source);
  }
});

test('a locally bound require name is a call, but an unbound require remains a module edge', async () => {
  const workspaceSource = path.resolve('packages/history/src/index.js');
  const localSource = path.resolve('examples/contribution-report/src/local.js');
  const shadowed = [
    "export const parameter = (require: (value: string) => string): string => require('../../../packages/history/src/index.js');",
    "function require(value: string): string { return value; } require('../../../packages/history/src/index.js');",
    "const require = (value: string): string => value; require('../../../packages/history/src/index.js');",
    "if (true) { let require: (value: string) => string = (value) => value; require('../../../packages/history/src/index.js'); }",
    "import { require } from './local.js'; require('../../../packages/history/src/index.js');",
  ];
  const commonJsEdges = [
    { source: "require('../../../packages/history/src/index.js');", allowed: false },
    { source: `require('${workspaceSource}');`, allowed: false },
    { source: `require('${localSource}');`, allowed: true },
    { source: "require('./%2e%2e/%2e%2e/%2e%2e/packages/history/src/index.js');", allowed: true },
    { source: `require('${pathToFileURL(path.resolve('packages/history/src/index.js')).href}');`, allowed: true },
    { source: "import workspace = require('../../../packages/history/src/index.js');", allowed: false },
    { source: `import absoluteWorkspace = require('${workspaceSource}');`, allowed: false },
    { source: `import absoluteLocal = require('${localSource}');`, allowed: true },
    { source: "import local = require('./%2e%2e/local.js');", allowed: true },
    { source: `import unresolved = require('${pathToFileURL(path.resolve('packages/history/src/index.js')).href}');`, allowed: true },
    { source: "require('node:fs');", allowed: true },
    { source: "require('@microdelta/history');", allowed: true },
  ];
  const unbound = "require('../../../packages/history/src/index.js');";
  const nested = "require('../../../packages/history/src/index.js'); function nested(require: (value: string) => string): string { return require('../../../packages/history/src/index.js'); }";

  for (const source of shadowed) {
    assert.deepEqual(await diagnostics(source), [], source);
  }
  assert.equal((await diagnostics(unbound)).length, 1);
  assert.equal((await diagnostics(nested)).length, 1, 'nested parameter shadows only its own call');

  for (const { source, allowed } of commonJsEdges) {
    const errors = await diagnostics(source);
    assert.equal(errors.length === 0, allowed, source);
  }
});
