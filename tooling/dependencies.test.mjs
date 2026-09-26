import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';

import { ESLint } from 'eslint';
import tseslint from 'typescript-eslint';

import { dependencies, dependencyBoundaries } from './dependencies.mjs';

/** Virtual graph probes isolate the import rule; type-aware integration uses real files. */
function graphProbeLinter() {
  return new ESLint({
    overrideConfigFile: true,
    overrideConfig: [{
      files: ['**/*.ts'],
      languageOptions: { parser: tseslint.parser },
      plugins: { microdelta: { rules: { 'dependency-boundaries': dependencyBoundaries } } },
      rules: { 'microdelta/dependency-boundaries': 'error' },
    }],
  });
}

test('DR-1: the enforced graph equals the governing component graph', async () => {
  const source = await readFile(new URL('../docs/source/incremental-analysis-components.md', import.meta.url), 'utf8');
  const graph = source.split('```mermaid')[1]?.split('```')[0];
  assert.ok(graph);
  const expected = Object.fromEntries(Object.keys(dependencies).map(name => [name, []]));
  for (const [, dependency, owner] of graph.matchAll(/^\s+(\w+)\s+(?:-->|-\. schema \.->)\s+(\w+)$/gm)) {
    if (owner in expected) { expected[owner].push(dependency); }
  }
  for (const name of Object.keys(expected)) {
    assert.deepEqual([...dependencies[name]].sort(), expected[name].sort(), name);
  }
});

test('DR-1: imports, re-exports and dynamic imports cannot bypass the graph', async () => {
  const eslint = graphProbeLinter();
  for (const source of [
    'import { x } from "../store/index.js";',
    'export { x } from "../store/index.js";',
    'await import("../store/index.js");',
    'const store = require("../store/index.js");',
    'import store = require("../store/index.js");',
    'import type { Store } from "../store/index.js";',
    'import { x } from "../index.js";',
    'import { x } from "microdelta";',
  ]) {
    const [result] = await eslint.lintText(source, { filePath: path.resolve('packages/core/src/name/probe.ts') });
    assert.ok(result.messages.some(message => message.ruleId === 'microdelta/dependency-boundaries'), source);
  }
});

test('package identity: consumers load the public entry and resolve the Jest conformance entry', async () => {
  const { createMemoryStore } = await import('microdelta');
  assert.equal(typeof createMemoryStore, 'function');

  // The conformance entry uses Jest globals and must be loaded by Jest; this
  // consumer check proves its package export names an existing built module.
  const conformanceEntry = import.meta.resolve('microdelta/conformance/store');
  const source = await readFile(new URL(conformanceEntry));
  assert.ok(source.byteLength > 0);
});

test('DR-1: unlisted components cannot hide imports outside the configured graph', async () => {
  const eslint = graphProbeLinter();
  for (const relative of ['unlisted.ts', 'unlisted/index.ts', 'types.ts']) {
    const [result] = await eslint.lintText('import { x } from "./store/index.js";', {
      filePath: path.resolve(`packages/core/src/${relative}`),
    });
    assert.ok(result.messages.some(message => message.ruleId === 'microdelta/dependency-boundaries'), relative);
  }
});

test('DR-1: shared types and schema-only claim imports are permitted', async () => {
  const eslint = graphProbeLinter();
  for (const [owner, source, valid] of [
    ['name', 'import type { Identity } from "../types.js";', true],
    ['claim', 'import type { Repository } from "../repository/index.js";', true],
    ['claim', 'import { createRepository } from "../repository/index.js";', false],
    ['materialize', 'import { x } from "../track/index.js";', true],
    ['identity', 'import { x } from "../fingerprint/index.js";', false],
  ]) {
    const [result] = await eslint.lintText(source, { filePath: path.resolve(`packages/core/src/${owner}/probe.ts`) });
    assert.equal(result.messages.some(message => message.ruleId === 'microdelta/dependency-boundaries'), !valid, source);
  }
});
