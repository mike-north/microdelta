/**
 * The workspace cleaner removes only this repository's generated build outputs.
 * Each test builds a throwaway tree so nothing in the real checkout is at risk.
 */
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { cleanGeneratedOutputs, generatedOutputTargets } from './clean.mjs';

/** Generated outputs the cleaner must remove, relative to the workspace root. */
const generated = [
  'packages/alpha/dist',
  'packages/alpha/temp',
  'packages/alpha/.test-build',
  'packages/alpha/alpha.tsbuildinfo',
  'packages/beta/dist',
  'fixtures/declarations/producer/dist',
  'examples/report/dist',
  'experiments/exp-1/.test-build',
  'experiments/exp-nested/.test-build',
  '.test-build',
  'coverage',
];

/** Files and directories the cleaner must leave alone. */
const preserved = [
  'node_modules/x/dist',
  'node_modules/x/temp',
  'node_modules/x/.test-build',
  'packages/alpha/node_modules/y/dist',
  'packages/alpha/src',
  'packages/alpha/package.json',
  'packages/alpha/distribution-notes.md',
  'packages/alpha/tsconfig.json',
  'packages/beta/src/dist',
  'experiments/exp-1/src',
  'fixtures/declarations/consumer-alpha/src',
  'examples/report/src',
  'scratch/dist',
  'scratch/coverage',
  'docs/coverage-notes.md',
];

/** Create `relative` as a directory (with a file inside) unless it looks like a file. */
function materialize(root, relative) {
  const absolute = path.join(root, relative);
  if (/\.(json|md|tsbuildinfo)$/u.test(relative)) {
    mkdirSync(path.dirname(absolute), { recursive: true });
    writeFileSync(absolute, 'content');
  } else {
    mkdirSync(absolute, { recursive: true });
    writeFileSync(path.join(absolute, 'marker.txt'), 'content');
  }
}

/** Build a temporary workspace holding every generated and preserved path. */
function makeWorkspace() {
  const root = mkdtempSync(path.join(tmpdir(), 'microdelta-clean-'));
  for (const relative of [...generated, ...preserved]) materialize(root, relative);
  return root;
}

test('removes every generated output and nothing else', () => {
  const root = makeWorkspace();
  try {
    cleanGeneratedOutputs(root);
    for (const relative of generated) {
      assert.equal(existsSync(path.join(root, relative)), false, `${relative} should be removed`);
    }
    for (const relative of preserved) {
      assert.equal(existsSync(path.join(root, relative)), true, `${relative} must be preserved`);
    }
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('is idempotent and tolerates a workspace with no generated outputs', () => {
  const root = mkdtempSync(path.join(tmpdir(), 'microdelta-clean-empty-'));
  try {
    assert.doesNotThrow(() => cleanGeneratedOutputs(root));
    assert.doesNotThrow(() => cleanGeneratedOutputs(root));
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('never enumerates a target inside node_modules', () => {
  const root = makeWorkspace();
  try {
    const targets = generatedOutputTargets(root);
    assert.ok(targets.length >= generated.length);
    for (const target of targets) {
      assert.ok(!target.split(path.sep).includes('node_modules'), `${target} is under node_modules`);
      assert.ok(target.startsWith(root + path.sep), `${target} escapes the workspace root`);
    }
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
