/**
 * PKG-001/004/007 fixtures exercise the checked import rule on real package
 * roles, including roles that have no implementation package yet.
 */
import assert from 'node:assert/strict';
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
