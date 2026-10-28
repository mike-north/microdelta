/** The supported Node floor is one contract across developer setup, every package, lock metadata and CI enforcement. */
import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { missingFoundationGates } from './foundation-wiring.mjs';

/** Read actual workspace metadata; dependency engine declarations are owned by their upstream packages. */
const root = fileURLToPath(new URL('../', import.meta.url));
const json = async filename => JSON.parse(await readFile(path.join(root, filename), 'utf8'));

/** Every package matched by the workspace's packages/* pattern participates in the supported runtime floor. */
async function manifests() {
  const directories = (await readdir(path.join(root, 'packages'), { withFileTypes: true })).filter(entry => entry.isDirectory());
  return Object.fromEntries(await Promise.all(directories.map(async entry => [entry.name, await json(`packages/${entry.name}/package.json`)])));
}

/** A coherent Node 24 baseline isolates each metadata mutation from unrelated foundation responsibilities. */
async function inputs() {
  const packages = await manifests();
  const workspace = await json('package.json');
  const lockfile = await json('package-lock.json');
  workspace.engines = { node: '>=24' };
  lockfile.packages[''].engines = { node: '>=24' };
  for (const [directory, manifest] of Object.entries(packages)) {
    manifest.engines = { node: '>=24' };
    lockfile.packages[`packages/${directory}`].engines = { node: '>=24' };
  }
  const names = ['core', 'definition', 'tracking', 'history', 'value', 'materialization', 'resolution', 'supervision', 'accounting'];
  const files = names.map(name => `packages/${name}/api-extractor.json`);
  files.push('packages/core/api-extractor-conformance.json', 'packages/history/api-extractor-conformance.json', 'packages/history/api-extractor-shared.json', 'fixtures/declarations/producer/api-extractor.json', 'fixtures/declarations/capture-producer/api-extractor.json', 'fixtures/declarations/forged/api-extractor.json');
  return { workspace, packages, lockfile, extractors: Object.fromEntries(await Promise.all(files.map(async file => [file, await json(file)]))), eslintConfig: await readFile(path.join(root, 'eslint.config.mjs'), 'utf8'), workflow: await readFile(path.join(root, '.github/workflows/check.yml'), 'utf8') };
}

test('the supported Node baseline is >=24 in the root, all eleven packages and their lock records', async () => {
  const workspace = await json('package.json'); const lock = await json('package-lock.json'); const packages = await manifests();
  assert.equal(Object.keys(packages).length, 11);
  assert.equal(workspace.engines?.node, '>=24');
  assert.equal(lock.packages[''].engines?.node, '>=24');
  for (const [directory, manifest] of Object.entries(packages)) {
    assert.equal(manifest.engines?.node, '>=24', manifest.name);
    assert.equal(lock.packages[`packages/${directory}`]?.engines?.node, '>=24', `${manifest.name} lock metadata`);
  }
});

for (const [label, mutate, expected] of [
  ['root engine metadata', data => { data.workspace.engines.node = '>=22'; }, /workspace.*engine.*>=24/iu],
  ['root lock engine metadata', data => { data.lockfile.packages[''].engines.node = '>=22'; }, /workspace.*lock.*engine.*>=24/iu],
  ['package engine metadata', data => { data.packages['machine-node'].engines.node = '>=22'; }, /machine-node.*engine.*>=24/iu],
  ['package lock engine metadata', data => { data.lockfile.packages['packages/machine-node'].engines.node = '>=22'; }, /machine-node.*lock.*engine.*>=24/iu],
  ['missing package lock metadata', data => { delete data.lockfile.packages['packages/machine-node']; }, /machine-node.*lock.*engine.*>=24/iu],
  ['missing root lock metadata', data => { delete data.lockfile.packages['']; }, /workspace.*lock.*engine.*>=24/iu],
]) {
  test(`foundation enforcement rejects inconsistent ${label}`, async () => {
    const data = await inputs();
    assert.deepEqual(missingFoundationGates(data), [], 'the unmodified metadata fixture must have a clean foundation baseline');
    mutate(data);
    const problems = missingFoundationGates(data);
    assert.equal(problems.length, 1, problems.join('\n'));
    assert.match(problems[0], expected);
  });
}
