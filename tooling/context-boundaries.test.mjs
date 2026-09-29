/**
 * PKG-001/004/007 fixtures exercise the checked import rule on real package
 * roles, including roles that have no implementation package yet.
 */
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import { ESLint } from 'eslint';

/** The checkout root makes virtual probes use the same paths as checked code. */
const root = fileURLToPath(new URL('../', import.meta.url));
const rule = 'microdelta/context-imports';
const checkerConfig = path.join(root, 'tooling/context-imports.config.mjs');

/** Inspect the production ESLint rule without relying on a mocked graph. */
async function diagnostics(owner, source) {
  const eslint = new ESLint({ cwd: root, overrideConfigFile: checkerConfig });
  const filePath = path.join(root, owner, 'src', 'probe.ts');
  const [result] = await eslint.lintText(source, { filePath });
  assert.ok(result, `Expected ESLint to inspect ${filePath}`);
  return result.messages;
}

test('implemented contexts and facade follow their directed package edges', async () => {
  for (const [owner, source, allowed] of [
    ['packages/core', "export { createMemoryStore } from '@microdelta/history';", true],
    ['packages/core/test/conformance/store', "export { storeConformance } from '@microdelta/history/conformance/store';", true],
    ['packages/definition', "import type { Store } from '@microdelta/history';", false],
    ['packages/tracking', "import type { Store } from '@microdelta/history';", false],
    ['packages/history', "import { nameOf } from '@microdelta/definition';", false],
    ['packages/history', "import type { Store } from 'microdelta';", false],
    ['packages/materialization', "import type { ICompletedResultReader } from '@microdelta/history';", true],
    ['packages/materialization', "import type { ITrackingObserver } from '@microdelta/tracking';", true],
    ['packages/materialization', "import type { IValue } from '@microdelta/value';", true],
    ['packages/materialization', "import type { ISha256Capability } from '@microdelta/machine';", false],
    ['packages/materialization', "import { createMemoryStore } from 'microdelta';", false],
  ]) {
    const messages = await diagnostics(owner, source);
    assert.deepEqual(messages.map(message => message.ruleId), allowed ? [] : [rule], `${owner}: ${source}: ${JSON.stringify(messages)}`);
  }
});

test('absent context roles use the same allowed-edge policy', async () => {
  for (const [role, source, allowed] of [
    ['resolution', "import type { Store } from '@microdelta/history';", true],
    ['resolution', "import { nameOf } from '@microdelta/definition';", true],
    ['supervision', "import type { Store } from '@microdelta/history';", false],
    ['materialization', "import type { Store } from '@microdelta/history';", true],
    ['accounting', "import type { Store } from '@microdelta/history';", false],
  ]) {
    const messages = await diagnostics(`fixtures/context-roles/${role}`, source);
    assert.deepEqual(messages.map(message => message.ruleId), allowed ? [] : [rule], `${role}: ${source}: ${JSON.stringify(messages)}`);
  }
});

test('Value Semantics consumes only the portable Machine hashing capability', async () => {
  const allowed = await diagnostics('packages/value', "import type { ISha256Capability } from '@microdelta/machine'; export type IHash = ISha256Capability;");
  assert.deepEqual(allowed.map(message => message.ruleId), []);
  const reverse = await diagnostics('packages/machine', "import type { IValue } from '@microdelta/value'; export type IReverse = IValue;");
  assert.deepEqual(reverse.map(message => message.ruleId), [rule]);
});

test('source, deep, re-export, facade, and unknown-path bypasses fail closed', async () => {
  for (const [owner, source] of [
    ['packages/core', "import { createMemoryStore } from '@microdelta/history/src/store/memory/index.js';"],
    ['packages/core', "export { createMemoryStore } from '@microdelta/history/dist/src/store/memory/index.js';"],
    ['packages/core', "import { createMemoryStore } from '../../history/src/store/memory/index.js';"],
    ['packages/history/test', "import { nameOf } from '../../../definition/src/name/index.js';"],
    ['packages/history/test', "import { nameOf } from '@source/definition';"],
    ['packages/history', "export { createMemoryStore } from 'microdelta';"],
    ['packages/definition', "export type Leak = import('@microdelta/history').Store;"],
    ['packages/history', "export { storeConformance } from 'microdelta/conformance/store';"],
    ['packages/definition', "import { x } from 'file:///tmp/other-package/src/index.js';"],
    ['packages/history', "import { x } from '@microdelta/unknown';"],
    ['packages/unknown', "import { x } from '@microdelta/history';"],
  ]) {
    const messages = await diagnostics(owner, source);
    assert.ok(messages.some(message => message.ruleId === rule), `${owner}: ${source}: ${JSON.stringify(messages)}`);
    assert.ok(messages.every(message => message.ruleId === rule), `${owner}: unexpected diagnostic ${JSON.stringify(messages)}`);
  }
});

test('Node builtins and host globals are confined to the Node implementation', async () => {
  const forbidden = [
    "import { AsyncLocalStorage } from 'node:async_hooks';",
    "import { serialize } from 'v8';",
    "import value from 'node:fs/promises';",
    "export { serialize } from 'v8';",
    "export * from 'node:async_hooks';",
    "const value = import('node:v8');",
    "type IValue = import('node:v8').Serializer;",
    "import value = require('node:fs');",
    "const value = require('node:fs/promises');",
    'void process.env;',
    'void Buffer.from("value");',
    'void globalThis.process.env;',
    'const host = globalThis; void host.process.env;',
    'function readLater() { return host.process.env; } const host = globalThis; void readLater;',
    'const host = globalThis; const runtime = host; void runtime.process.env;',
    'const { process } = globalThis; void process.env;',
    'const { setImmediate: defer } = globalThis; defer(() => {});',
    'setImmediate(() => {});',
    "import '../test/host.js';",
    "export * from '../test/host.js';",
  ];
  for (const source of forbidden) {
    const messages = await diagnostics('packages/tracking', source);
    assert.ok(messages.some(message => message.ruleId === rule), `${source}: ${JSON.stringify(messages)}`);
  }
});

test('Node boundary permits shadowed names, ECMAScript globals, tests, tooling, and Node adapter', async () => {
  for (const [owner, source] of [
    ['packages/tracking', 'function use(process: { value: string }): string { return process.value; }'],
    ['packages/tracking', 'function load(require: (name: string) => string): string { return require("node:fs"); }'],
    ['packages/tracking', 'function run(setImmediate: (callback: () => void) => void): void { setImmediate(() => {}); }'],
    ['packages/tracking', 'interface IRecord { process: string; Buffer: number; }'],
    ['packages/tracking', 'const IRecord = { process: "data", Buffer: 1 }; void IRecord;'],
    ['packages/tracking', 'void Promise.resolve(globalThis); void Object.keys({ value: 1 }); void JSON.stringify({ value: 1 });'],
    ['packages/tracking/test', "import { serialize } from 'node:v8'; void serialize;"],
    ['packages/tracking/test', "import '../src/index.js';"],
    ['packages/machine-node/src/node', "import { AsyncLocalStorage } from 'node:async_hooks'; void AsyncLocalStorage;"],
  ]) {
    const messages = await diagnostics(owner, source);
    assert.deepEqual(messages.map(message => message.ruleId), [], `${owner}: ${source}: ${JSON.stringify(messages)}`);
  }
});

/** Every import form the existing rule inspects, applied to the native SQLite driver. */
const sqliteDriverForms = [
  "import Database from 'better-sqlite3'; void Database;",
  "import type { Database } from 'better-sqlite3'; export type IDriver = Database;",
  "import Database from 'better-sqlite3/lib/database.js'; void Database;",
  "export { default } from 'better-sqlite3';",
  "export * from 'better-sqlite3';",
  "const driver = import('better-sqlite3'); void driver;",
  "import driver = require('better-sqlite3'); void driver;",
  "const driver = require('better-sqlite3'); void driver;",
];

test('the native SQLite driver is confined to the Node Machine implementation', async () => {
  for (const owner of [
    'packages/history',
    'packages/history/test',
    'packages/machine',
    'packages/machine-node',
    'packages/machine-node/test',
    'packages/core',
    'packages/tracking',
    'experiments/exp-3',
  ]) {
    for (const source of sqliteDriverForms) {
      const messages = await diagnostics(owner, source);
      assert.ok(
        messages.some(message => message.ruleId === rule && /better-sqlite3/u.test(message.message)),
        `${owner}: ${source}: ${JSON.stringify(messages)}`,
      );
    }
  }
  for (const source of sqliteDriverForms) {
    const messages = await diagnostics('packages/machine-node/src/node', source);
    assert.deepEqual(messages.map(message => message.ruleId), [], `Node adapter: ${source}: ${JSON.stringify(messages)}`);
  }
  // The existing rule treats every TypeScript import type as an unanalyzed module
  // path and fails closed, so a type-position driver import is refused everywhere.
  for (const owner of ['packages/history', 'packages/machine-node/src/node']) {
    const messages = await diagnostics(owner, "export type IDriver = import('better-sqlite3').Database;");
    assert.deepEqual(messages.map(message => message.ruleId), [rule], `${owner}: ${JSON.stringify(messages)}`);
  }
  // Other third-party specifiers keep their existing unrestricted treatment.
  const unrelated = await diagnostics('packages/history', "import { expectType } from 'tsd'; void expectType;");
  assert.deepEqual(unrelated.map(message => message.ruleId), []);
});

test('portable experiment source rejects Node access while its explicit test harness may use it', async () => {
  for (const owner of ['experiments/exp-1', 'experiments/exp-2', 'experiments/exp-4']) {
    for (const source of [
      "import { readFile } from 'node:fs/promises';",
      "export { serialize } from 'v8';",
      'void process.env;',
      'void globalThis.Buffer;',
      "import '../test/process-entry.js';",
      "import { internal } from '@microdelta/tracking/src/index.js';",
      "import { internal } from '@microdelta/unknown';",
    ]) {
      const messages = await diagnostics(owner, source);
      assert.ok(messages.some(message => message.ruleId === rule), `${owner}: ${source}: ${JSON.stringify(messages)}`);
    }
    const portable = await diagnostics(owner, 'void Object.keys({ value: 1 });');
    assert.deepEqual(portable.map(message => message.ruleId), []);
    const declaredPackage = await diagnostics(owner, "import type { ITracking } from '@microdelta/tracking';");
    assert.deepEqual(declaredPackage.map(message => message.ruleId), []);
  }
  const harness = await diagnostics('experiments/exp-1/test', "import { readFile } from 'node:fs/promises'; void readFile;");
  assert.ok(harness.every(message => message.ruleId !== rule));
});

test('Tracking and History production builds exclude ambient Node declarations', async () => {
  for (const packageName of ['tracking', 'history']) {
    const config = JSON.parse(await readFile(path.join(root, `packages/${packageName}/tsconfig.portable.json`), 'utf8'));
    assert.deepEqual(config.compilerOptions.types, [], `${packageName} build must opt out of ambient host globals`);
    assert.equal(config.compilerOptions.skipLibCheck, false, `${packageName} build must check imported declarations`);
  }

  const directory = await mkdtemp(path.join(os.tmpdir(), 'microdelta-machine-types-'));
  try {
    await writeFile(path.join(directory, 'leaky.d.ts'), "declare module 'leaky' { export interface IValue { readonly timer: NodeJS.Timeout; } }\n");
    await writeFile(path.join(directory, 'consumer.ts'), "import type { IValue } from 'leaky';\nexport const value: IValue | undefined = undefined;\n");
    const config = path.join(directory, 'tsconfig.json');
    await writeFile(config, JSON.stringify({
      compilerOptions: {
        strict: true,
        noEmit: true,
        skipLibCheck: false,
        types: [],
        target: 'ES2022',
        module: 'NodeNext',
        moduleResolution: 'NodeNext',
      },
      files: ['consumer.ts', 'leaky.d.ts'],
    }));
    const result = spawnSync(process.execPath, [path.join(root, 'node_modules/typescript/bin/tsc'), '-p', config], {
      cwd: root,
      encoding: 'utf8',
    });
    assert.notEqual(result.status, 0, 'A Node ambient type in a dependency declaration must fail a portable consumer');
    assert.match(result.stdout + result.stderr, /NodeJS|TS2503/u);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test('Value production source compiles without ambient host declarations', async () => {
  const config = JSON.parse(await readFile(path.join(root, 'packages/value/tsconfig.portable.json'), 'utf8'));
  assert.deepEqual(config.compilerOptions.types, [], 'Value build must opt out of ambient host globals');
  assert.equal(config.compilerOptions.skipLibCheck, false, 'Value build must check Machine declarations');
});

/**
 * The executable example is an external consumer of the facade: it may import
 * only `microdelta` (and Node built-ins), never a scoped owner package or
 * source path, even though its compiler resolves their alpha declarations.
 */
test('the executable example may import only the microdelta facade and Node built-ins', async () => {
  const eslint = new ESLint({ cwd: root, overrideConfigFile: checkerConfig });
  const filePath = path.join(root, 'examples/contribution-report/src/probe.ts');
  for (const [source, allowed] of [
    ["import { openWorkspace } from 'microdelta';", true],
    ["import { readFileSync } from 'node:fs';", true],
    ["import { openDurableHistory } from '@microdelta/history';", false],
    ["import type { IResolution } from '@microdelta/resolution';", false],
    ["export { createSupervision } from '@microdelta/supervision';", false],
    ["import { createResolution } from '../../../packages/resolution/src/index.js';", false],
  ]) {
    const [result] = await eslint.lintText(source, { filePath });
    assert.ok(result, 'Expected ESLint to inspect the example probe');
    const errors = result.messages.filter(message => message.severity === 2);
    assert.equal(errors.length === 0, allowed, `${source}: ${JSON.stringify(result.messages)}`);
  }
});
