/**
 * Partition the ordinary test graph for isolated PR consumers. Preparation owns
 * compilation and static checks; receipts account for every runtime obligation.
 */

/** Parse the canonical, one-based identity used in artifact and job names. */
export function shardNumber(value) {
  if (!/^[1-4]$/u.test(String(value))) throw new Error('Invalid shard identity');
  return Number(value);
}

/** Keep serial work within each shard and preserve empty expected shards. */
export function partitionObligations(discovered, assignments) {
  if (new Set(discovered).size !== discovered.length) throw new Error('duplicate obligation');
  for (const id of discovered) {
    if (!Object.hasOwn(assignments, id)) throw new Error(`Missing assignment: ${id}`);
    if (!Number.isInteger(assignments[id])) throw new Error(`Noncanonical assignment: ${id}`);
    shardNumber(assignments[id]);
  }
  for (const id of Object.keys(assignments)) {
    if (!discovered.includes(id)) throw new Error(`unknown obligation: ${id}`);
  }
  const shards = [1, 2, 3, 4].map(shard => discovered.filter(id => assignments[id] === shard));
  const union = shards.flat();
  if (union.length !== discovered.length || new Set(union).size !== discovered.length || discovered.some(id => !union.includes(id))) throw new Error('Partition union differs from discovered obligations');
  return shards;
}

/** A bundle is usable only by its preparation's exact checkout and workflow attempt. */
export function validateBundle(manifest, entries, identity) {
  validateIdentity(identity);
  for (const entry of entries) {
    if (typeof entry.path !== 'string' || entry.path.startsWith('/') || entry.path.split('/').some(part => part === '..' || part === '.' || part === '' || part === 'node_modules')
      || !/^[a-f0-9]{64}$/u.test(entry.sha256) || !Number.isSafeInteger(entry.size) || entry.size < 0) throw new Error('Invalid bundle entries');
  }
  if (entries.length === 0 || new Set(entries.map(entry => entry.path)).size !== entries.length) throw new Error('Missing or duplicate bundle entries');
  if (JSON.stringify(manifest.identity) !== JSON.stringify(identity)) throw new Error('Bundle identity mismatch');
  if (manifest.schema !== 1 || JSON.stringify(manifest.entries) !== JSON.stringify(entries)) throw new Error('Bundle entries mismatch');
  shardNumber(manifest.shard);
  return manifest;
}

/** The protected check represents the complete expected graph, including preparation. */
export function validateAggregate(plan, identity, prepareResult, shardResults, receipts, preparation) {
  validateIdentity(identity);
  if (!preparation || JSON.stringify(preparation.identity) !== JSON.stringify(identity) || !/^[a-f0-9]{64}$/u.test(preparation.planDigest)
    || !Array.isArray(preparation.bundles) || preparation.bundles.length !== 4 || preparation.bundles.some(value => !/^[a-f0-9]{64}$/u.test(value))) throw new Error('preparation identity or bundle association mismatch');
  if (prepareResult !== 'success') throw new Error('preparation did not succeed');
  if (shardResults.length !== 4 || shardResults.some(result => result !== 'success')) throw new Error('Every shard must succeed');
  if (receipts.length !== 4 || new Set(receipts.map(receipt => receipt.shard)).size !== 4) throw new Error('Missing or duplicate receipt');
  for (let index = 0; index < 4; index++) {
    const receipt = receipts.find(item => item.shard === index + 1);
    if (!receipt || receipt.schema !== 1 || receipt.status !== 'success' || JSON.stringify(receipt.identity) !== JSON.stringify(identity)
      || (receipt.planDigest !== preparation.planDigest || receipt.bundleDigest !== preparation.bundles[index])
      || JSON.stringify(receipt.planned) !== JSON.stringify(plan[index]) || JSON.stringify(receipt.executed) !== JSON.stringify(plan[index])) {
      throw new Error(`Invalid receipt for shard ${index + 1}`);
    }
  }
  return true;
}

/** Reviewed script/configuration ownership makes graph changes explicit in CI review. */
export function validateGraph(actual, reviewed) {
  if (JSON.stringify(actual) !== JSON.stringify(reviewed)) throw new Error('Ordinary test graph changed; review tooling/pr-ci-catalog.json');
  return actual;
}

import { readFile, readdir, lstat } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import path from 'node:path';

/** Canonical hashes bind reviewed inputs and generated files without trusting timestamps. */
export function digest(value) { return createHash('sha256').update(value).digest('hex'); }

/** Canonical source inputs include new untracked files during pre-commit validation. */
export function sourceFiles(root) {
  const result = spawnSync('git', ['ls-files', '--cached', '--others', '--exclude-standard', '-z'], { cwd: root, encoding: 'utf8' });
  if (result.status !== 0) throw new Error(`Cannot discover source graph: ${result.stderr}`);
  return [...new Set(result.stdout.split('\0').filter(Boolean))].sort();
}

/** Preserve reviewed script leaves so added work cannot bypass a static partition. */
export async function discoverGraph(root, files = sourceFiles(root)) {
  const workspace = JSON.parse(await readFile(path.join(root, 'package.json'), 'utf8'));
  // npm's workspace traversal is broader than the package directory scanner.
  // Widening it requires explicit inventory and execution ownership support.
  if (JSON.stringify(workspace.workspaces) !== JSON.stringify(['packages/*'])) throw new Error('Unsupported workspace layout; PR CI owns exactly packages/*');
  const packages = (await readdir(path.join(root, 'packages'), { withFileTypes: true }))
    .filter(entry => entry.isDirectory()).map(entry => `packages/${entry.name}`).sort();
  const scripts = {};
  for (const directory of ['.', ...packages]) {
    const manifest = JSON.parse(await readFile(path.join(root, directory, 'package.json'), 'utf8'));
    for (const [name, command] of Object.entries(manifest.scripts).sort(([a], [b]) => a.localeCompare(b, 'en'))) {
      // Root coordination tasks invoke this plan; the same names in a package
      // remain ordinary obligations and require an execution owner.
      const coordination = directory === '.' && (name === 'test:pr-ci' || name === 'test:pr-ci:aggregate');
      if (/^(?:pre|post)?test(?::|$)/u.test(name) && !coordination) scripts[`${directory}:${name}`] = command;
    }
  }
  const configs = {};
  for (const filename of files.filter(file => /jest\.config\.(?:[cm]?[jt]s|json)$/u.test(file))) configs[filename] = digest(await readFile(path.join(root, filename)));
  return { packages, configs, scripts, typeFiles: files.filter(file => file.endsWith('.test-d.ts')) };
}

/** Build the small explicit partition from ordinary suite files and reviewed compound leaves. */
export async function planRepository(root) {
  const catalog = validateCatalog(JSON.parse(await readFile(path.join(root, 'tooling/pr-ci-catalog.json'), 'utf8')));
  const files = sourceFiles(root);
  validateGraph(await discoverGraph(root, files), catalog.graph);
  const obligations = [];
  const assignments = {};
  /** Register exactly one serial execution owner for every discovered obligation. */
  const add = (obligation, shard) => { obligations.push(obligation); assignments[obligation.id] = shard; };
  for (const group of catalog.groups) {
    const tests = files.filter(file => file.startsWith(`${group.source}/`) && file.endsWith('.test.ts'));
    if (tests.length === 0) throw new Error(`No ordinary tests discovered for ${group.config}`);
    tests.forEach((file, index) => add({ id: `jest:${file}`, kind: 'jest', group: group.config,
      file: `${group.emitted}/${file.slice(group.source.length + 1).replace(/\.ts$/u, '.js')}`, cwd: group.cwd, output: group.output },
    group.config === 'experiments/exp-3/jest.config.mjs' ? 3 : index % 4 + 1));
  }
  for (const item of catalog.types) add({ ...item, kind: 'types' }, item.shard);
  for (const owner of ['accounting', 'materialization', 'resolution', 'supervision']) {
    add({ id: `public:${owner}`, kind: 'command', cwd: `packages/${owner}`, command: 'node', args: ['node_modules/typescript/bin/tsc', '--noEmit', '-p', 'tsconfig.public-consumer.json'] }, 4);
  }
  add({ id: 'compound:fanout', kind: 'command', cwd: '.', command: 'node', args: ['scratch/gap-hunt/scale/repro-fanout-admission.mjs', '--prepared'], output: 'scratch/gap-hunt/scale/dist', files: ['scratch/gap-hunt/scale/fanout-admission.test.mjs'] }, 1);
  add({ id: 'compound:subtree', kind: 'command', cwd: '.', command: 'node', args: ['tooling/subtree-query-gate.mjs', '--prepared'], output: 'tooling/subtree-query/dist', files: ['tooling/subtree-query/probe.test.ts'] }, 2);
  const tooling = ordinaryToolingFiles(files);
  const toolingGroups = partitionToolingFiles(tooling).map((tests, index) => ({
    id: index === 3 ? 'node:tooling' : `node:tooling:${index + 1}`, group: 'node:tooling', shard: index + 1,
    kind: 'command', command: 'node', cwd: '.', args: ['--test', '--test-concurrency=1', ...tests], files: tests,
  }));
  validateToolingGroups(tooling, toolingGroups);
  for (const group of toolingGroups) add(group, group.shard);
  const examples = files.filter(file => file.startsWith('examples/contribution-report/test/') && file.endsWith('.test.mjs'));
  add({ id: 'node:examples', kind: 'command', command: 'node', cwd: '.', args: ['--test', '--test-concurrency=1', ...examples], files: examples }, 1);
  // Tracking's intentional negative runs and final positive rerun are one
  // ordered obligation in its private emitted tree, never a parallel consumer.
  for (const [owner, shard] of [['core', 3], ['tracking', 2], ['supervision', 4]]) {
    const script = catalog.graph.scripts[`packages/${owner}:test:controls`].replace(/^tsc -p tsconfig.test.json && /u, '').replaceAll('node --test ', 'node --test --test-concurrency=1 ');
    add({ id: `controls:${owner}`, kind: 'shell', cwd: `packages/${owner}`, script, output: `packages/${owner}/.test-build` }, shard);
  }
  validateExecutionOwners(catalog, obligations, files);
  const ids = obligations.map(item => item.id);
  const shards = partitionObligations(ids, assignments);
  const plan = { schema: 1, obligations, shards, catalog };
  return { ...plan, digest: digest(JSON.stringify(plan)) };
}

/** Only plain generated files may cross a runner boundary; symlinks are rejected. */
export async function fileEntries(root, prefix = '') {
  if ((await lstat(path.join(root, prefix))).isSymbolicLink()) throw new Error(`Generated bundle contains symlink: ${prefix}`);
  const entries = [];
  for (const entry of await readdir(path.join(root, prefix), { withFileTypes: true })) {
    const relative = path.posix.join(prefix, entry.name);
    const filename = path.join(root, relative);
    const stat = await lstat(filename);
    if (stat.isSymbolicLink()) throw new Error(`Generated bundle contains symlink: ${relative}`);
    if (stat.isDirectory()) entries.push(...await fileEntries(root, relative));
    else if (stat.isFile()) entries.push({ path: relative, sha256: digest(await readFile(filename)), size: stat.size });
    else throw new Error(`Generated bundle contains non-file: ${relative}`);
  }
  return entries.sort((a, b) => a.path.localeCompare(b.path, 'en'));
}

/** Test and PR source identity are distinct; the current attempt cannot borrow old work. */
export function validateIdentity(identity) {
  if (!identity || !/^[a-f0-9]{40}$/u.test(identity.testedSha) || !/^[a-f0-9]{40}$/u.test(identity.headSha)
    || !/^[a-f0-9]{64}$/u.test(identity.sourceDigest)
    || !/^[1-9][0-9]*$/u.test(identity.runId) || !/^[1-9][0-9]*$/u.test(identity.attempt)) throw new Error('Invalid workflow identity');
  return identity;
}

/** Every reviewed configuration has one ordinary, compound, or explicit opt-in owner. */
export function validateCatalog(catalog) {
  for (const [key, script] of Object.entries(catalog.graph.scripts)) {
    if (!Object.hasOwn(SUPPORTED_TEST_EXECUTION, key) || SUPPORTED_TEST_EXECUTION[key].command !== script) throw new Error(`Unsupported execution owner for ${key}; changing the graph snapshot alone cannot add execution`);
  }
  for (const key of Object.keys(SUPPORTED_TEST_EXECUTION)) {
    if (!Object.hasOwn(catalog.graph.scripts, key)) throw new Error(`Missing execution owner input: ${key}`);
  }
  const compound = ['scratch/gap-hunt/scale/fanout-admission.jest.config.mjs', 'tooling/subtree-query/jest.config.mjs'];
  const configurations = [...catalog.groups.map(group => group.config), ...compound, ...Object.keys(catalog.excluded).filter(key => key.endsWith('jest.config.mjs'))];
  if (new Set(configurations).size !== configurations.length || JSON.stringify(configurations.sort()) !== JSON.stringify(Object.keys(catalog.graph.configs).sort())) throw new Error('Missing or duplicate configuration ownership');
  const expectedTypes = [];
  for (const [key, script] of Object.entries(catalog.graph.scripts)) {
    let cwd = key.startsWith('.:') ? '.' : key.slice(0, key.indexOf(':'));
    for (const part of script.split('&&').map(value => value.trim())) {
      if (part.startsWith('cd ')) cwd = part.slice(3);
      if (/^tsd(?: |$)/u.test(part)) expectedTypes.push(`${cwd}\0${part}`);
    }
  }
  const actualTypes = catalog.types.map(item => `${item.cwd}\0${['tsd', ...item.args.slice(1)].join(' ')}`);
  if (new Set(actualTypes).size !== actualTypes.length || JSON.stringify(actualTypes.sort()) !== JSON.stringify(expectedTypes.sort())) throw new Error('Missing or duplicate type obligation ownership');
  return catalog;
}

/** Whole checkout inputs bind tooling and sources even before a commit exists locally. */
export async function sourceDigest(root) {
  const inputs = [];
  for (const filename of sourceFiles(root)) inputs.push({ path: filename, sha256: digest(await readFile(path.join(root, filename))) });
  return digest(JSON.stringify(inputs));
}

/**
 * The ordinary graph has a fixed supported command surface paired with explicit
 * preparation, compound, config or type owners. Refreshing an input snapshot
 * cannot teach this executor a new leaf or silently ignore a lifecycle hook.
 * Changing these commands requires an implementation and ownership review.
 */
const SUPPORTED_TEST_EXECUTION = Object.freeze({
  ".:test": { command: "npm run build && npm run test:fanout-dispatch && npm run test:subtree-query && npm run test:tooling && npm run test --workspaces && npm run test:experiments && npm run test:examples", owners: ["prepare:build", "composite"] },
  ".:test:controlled-report": { command: "tsc -p fixtures/contribution-report/tsconfig.json && node --experimental-vm-modules node_modules/jest/bin/jest.js --config fixtures/contribution-report/jest.config.mjs --runInBand && npm run test:controlled-report:types", owners: ["composite", "config:fixtures/contribution-report/jest.config.mjs"] },
  ".:test:controlled-report:types": { command: "cd fixtures/contribution-report/test-d && tsd --typings ../.test-build/examples/contribution-report/src/controlled/application.d.ts --files contracts.test-d.ts", owners: ["types:controlled-report"] },
  ".:test:controlled-report:workload": { command: "tsc -p fixtures/contribution-report/tsconfig.json && node fixtures/contribution-report/workload-driver.mjs", owners: ["excluded:opt-in"] },
  ".:test:examples": { command: "node --test examples/contribution-report/test/*.test.mjs && npm run test:controlled-report", owners: ["composite", "node:examples"] },
  ".:test:exp-authoring": { command: "tsd --typings experiments/exp-authoring/src/protocol.ts --files experiments/exp-authoring/test-d/protocol.test-d.ts && node --experimental-vm-modules node_modules/jest/bin/jest.js --config experiments/exp-authoring/jest.config.mjs --runInBand", owners: ["config:experiments/exp-authoring/jest.config.mjs", "types:experiments/exp-authoring"] },
  ".:test:exp-nested": { command: "tsc -p experiments/exp-nested/tsconfig.test.json && node --experimental-vm-modules ./node_modules/jest/bin/jest.js --config experiments/exp-nested/jest.config.mjs --runInBand", owners: ["config:experiments/exp-nested/jest.config.mjs"] },
  ".:test:exp2": { command: "tsc -p experiments/exp-2/tsconfig.json && node --experimental-vm-modules node_modules/jest/bin/jest.js --config experiments/exp-2/jest.config.mjs --runInBand", owners: ["config:experiments/exp-2/jest.config.mjs"] },
  ".:test:exp3": { command: "tsc -p experiments/exp-3/tsconfig.test.json && node --experimental-vm-modules ./node_modules/jest/bin/jest.js --config experiments/exp-3/jest.config.mjs --runInBand --runTestsByPath .test-build/experiments/exp-3/test/sqlite-capability.test.js && node --experimental-vm-modules ./node_modules/jest/bin/jest.js --config experiments/exp-3/jest.config.mjs --runInBand --runTestsByPath .test-build/experiments/exp-3/test/publication.test.js", owners: ["config:experiments/exp-3/jest.config.mjs"] },
  ".:test:exp4": { command: "tsd --typings experiments/exp-4/src/protocol.ts --files experiments/exp-4/test-d/protocol.test-d.ts && node --experimental-vm-modules node_modules/jest/bin/jest.js --config experiments/exp-4/jest.config.mjs --runInBand", owners: ["config:experiments/exp-4/jest.config.mjs", "types:experiments/exp-4"] },
  ".:test:exp8": { command: "tsd --typings experiments/exp-8/src/protocol.ts --files experiments/exp-8/test-d/events.test-d.ts && node --experimental-vm-modules node_modules/jest/bin/jest.js --config experiments/exp-8/jest.config.mjs --runInBand", owners: ["config:experiments/exp-8/jest.config.mjs", "types:experiments/exp-8"] },
  ".:test:experiments": { command: "tsd --typings experiments/exp-1/src/protocol.ts --files experiments/exp-1/test-d/protocol.test-d.ts && node --experimental-vm-modules node_modules/jest/bin/jest.js --config experiments/exp-1/jest.config.mjs --runInBand && npm run test:exp2 && npm run test:exp3 && npm run test:exp-nested && npm run test:exp4 && npm run test:exp8 && npm run test:exp-authoring && npm run test:provenance-capacity && npm run test:read-snapshot", owners: ["composite", "config:experiments/exp-1/jest.config.mjs", "types:experiments/exp-1"] },
  ".:test:fanout-dispatch": { command: "GAP_HUNT_REUSE_BUILD=1 node scratch/gap-hunt/scale/repro-fanout-admission.mjs", owners: ["compound:fanout"] },
  ".:test:provenance-capacity": { command: "tsc -p experiments/provenance-capacity/tsconfig.test.json && node --experimental-vm-modules node_modules/jest/bin/jest.js --config experiments/provenance-capacity/jest.config.mjs --runInBand", owners: ["config:experiments/provenance-capacity/jest.config.mjs"] },
  ".:test:read-snapshot": { command: "tsc -p experiments/exp-read-snapshot/tsconfig.test.json && node --experimental-vm-modules node_modules/jest/bin/jest.js --config experiments/exp-read-snapshot/jest.config.mjs --runInBand", owners: ["config:experiments/exp-read-snapshot/jest.config.mjs"] },
  ".:test:subtree-query": { command: "node tooling/subtree-query-gate.mjs", owners: ["compound:subtree"] },
  ".:test:tooling": { command: "node --test tooling/*.test.mjs", owners: ["node:tooling"] },
  "packages/accounting:test": { command: "npm run test:unit && npm run test:types && npm run test:public", owners: ["composite"] },
  "packages/accounting:test:public": { command: "tsc --noEmit -p tsconfig.public-consumer.json", owners: ["public:accounting"] },
  "packages/accounting:test:types": { command: "tsd", owners: ["types:packages/accounting"] },
  "packages/accounting:test:unit": { command: "tsc -p tsconfig.test.json && node --experimental-vm-modules ../../node_modules/jest/bin/jest.js --config jest.config.mjs --runInBand", owners: ["config:packages/accounting/jest.config.mjs"] },
  "packages/core:test": { command: "npm run test:unit && npm run test:types && npm run test:controls", owners: ["composite"] },
  "packages/core:test:controls": { command: "node --test test/durable-history/controls/control-outcome.test.mjs test/acceptance/controls/paths.test.mjs test/concurrency/controls/controls.test.mjs test/durable-history/controls/anchor-check.test.mjs test/resolution/controls/resolution-mutation-controls.test.mjs", owners: ["controls:core"] },
  "packages/core:test:types": { command: "tsd", owners: ["types:packages/core"] },
  "packages/core:test:unit": { command: "tsc -p tsconfig.test.json && node --experimental-vm-modules ../../node_modules/jest/bin/jest.js --config jest.config.mjs --runInBand", owners: ["config:packages/core/jest.config.mjs"] },
  "packages/definition:test": { command: "npm run test:unit && npm run test:types", owners: ["composite"] },
  "packages/definition:test:types": { command: "tsd", owners: ["types:packages/definition"] },
  "packages/definition:test:unit": { command: "tsc -p tsconfig.test.json && node --experimental-vm-modules ../../node_modules/jest/bin/jest.js --runInBand", owners: ["config:packages/definition/jest.config.mjs"] },
  "packages/history:test": { command: "npm run test:unit && npm run test:types", owners: ["composite"] },
  "packages/history:test:types": { command: "tsd", owners: ["types:packages/history"] },
  "packages/history:test:unit": { command: "tsc -p tsconfig.test.json && node --experimental-vm-modules ../../node_modules/jest/bin/jest.js --runInBand", owners: ["config:packages/history/jest.config.mjs"] },
  "packages/machine:test": { command: "npm run test:types", owners: ["composite"] },
  "packages/machine:test:types": { command: "tsd", owners: ["types:packages/machine"] },
  "packages/machine-node:test": { command: "npm run test:unit && npm run test:types", owners: ["composite"] },
  "packages/machine-node:test:types": { command: "tsd", owners: ["types:packages/machine-node"] },
  "packages/machine-node:test:unit": { command: "tsc -p tsconfig.test.json && node --experimental-vm-modules ../../node_modules/jest/bin/jest.js --config jest.config.mjs --runInBand", owners: ["config:packages/machine-node/jest.config.mjs"] },
  "packages/materialization:test": { command: "npm run test:unit && npm run test:types && npm run test:public", owners: ["composite"] },
  "packages/materialization:test:public": { command: "tsc --noEmit -p tsconfig.public-consumer.json", owners: ["public:materialization"] },
  "packages/materialization:test:types": { command: "tsd", owners: ["types:packages/materialization"] },
  "packages/materialization:test:unit": { command: "tsc -p tsconfig.test.json && node --experimental-vm-modules ../../node_modules/jest/bin/jest.js --config jest.config.mjs --runInBand", owners: ["config:packages/materialization/jest.config.mjs"] },
  "packages/resolution:test": { command: "npm run test:unit && npm run test:types && npm run test:public", owners: ["composite"] },
  "packages/resolution:test:public": { command: "tsc --noEmit -p tsconfig.public-consumer.json", owners: ["public:resolution"] },
  "packages/resolution:test:types": { command: "tsd", owners: ["types:packages/resolution"] },
  "packages/resolution:test:unit": { command: "tsc -p tsconfig.test.json && node --experimental-vm-modules ../../node_modules/jest/bin/jest.js --config jest.config.mjs --runInBand", owners: ["config:packages/resolution/jest.config.mjs"] },
  "packages/supervision:test": { command: "npm run test:unit && npm run test:types && npm run test:public && npm run test:controls", owners: ["composite"] },
  "packages/supervision:test:controls": { command: "node test/controls/shared-rate-mutation-controls.mjs --check-anchors", owners: ["controls:supervision"] },
  "packages/supervision:test:public": { command: "tsc --noEmit -p tsconfig.public-consumer.json", owners: ["public:supervision"] },
  "packages/supervision:test:types": { command: "tsd", owners: ["types:packages/supervision"] },
  "packages/supervision:test:unit": { command: "tsc -p tsconfig.test.json && node --experimental-vm-modules ../../node_modules/jest/bin/jest.js --config jest.config.mjs --runInBand", owners: ["config:packages/supervision/jest.config.mjs"] },
  "packages/tracking:test": { command: "npm run test:unit && npm run test:controls && npm run test:types", owners: ["composite"] },
  "packages/tracking:test:controls": { command: "tsc -p tsconfig.test.json && node --test test/controls/control-outcome.test.mjs && node test/controls/lazy-view-controls.mjs", owners: ["controls:tracking"] },
  "packages/tracking:test:types": { command: "tsd", owners: ["types:packages/tracking"] },
  "packages/tracking:test:unit": { command: "tsc -p tsconfig.test.json && node --experimental-vm-modules ../../node_modules/jest/bin/jest.js --runInBand", owners: ["config:packages/tracking/jest.config.mjs"] },
  "packages/value:test": { command: "npm run test:unit && npm run test:types", owners: ["composite"] },
  "packages/value:test:types": { command: "tsd", owners: ["types:packages/value"] },
  "packages/value:test:unit": { command: "tsc -p tsconfig.test.json && node --experimental-vm-modules ../../node_modules/jest/bin/jest.js --config jest.config.mjs --runInBand", owners: ["config:packages/value/jest.config.mjs"] },
});

/** Each supported leaf must resolve to real planned work; composites retain their exact reviewed expansion. */
function validateExecutionOwners(catalog, obligations, files) {
  for (const [key, { owners }] of Object.entries(SUPPORTED_TEST_EXECUTION)) {
    for (const owner of owners) {
      if (owner === 'prepare:build' || owner === 'composite') continue;
      if (owner === 'excluded:opt-in') {
        if (key !== '.:test:controlled-report:workload' || !catalog.excluded[key]) throw new Error(`Unjustified excluded execution owner: ${key}`);
        continue;
      }
      if (owner === 'node:tooling') {
        validateToolingGroups(ordinaryToolingFiles(files), obligations.filter(item => item.group === owner));
        continue;
      }
      if (owner.startsWith('config:') ? !obligations.some(item => item.kind === 'jest' && item.group === owner.slice(7)) : !obligations.some(item => item.id === owner)) throw new Error(`Missing execution owner: ${owner}`);
    }
  }
}

/** A phase can issue evidence only while every source/tooling input remains frozen. */
export async function assertSourceDigest(root, identity) {
  validateIdentity(identity);
  if (await sourceDigest(root) !== identity.sourceDigest) throw new Error('Whole-source digest changed; prepare and re-run all shards on one frozen checkout');
}

/** The tooling owner must prove complete whole-file coverage and exact serial commands. */
export function validateToolingGroups(discovered, groups) {
  if (groups.length !== 4 || new Set(groups.map(group => group.shard)).size !== 4) throw new Error('Missing or duplicate tooling group');
  for (const group of groups) {
    if (!Number.isInteger(group.shard) || group.shard < 1 || group.shard > 4 || group.id !== (group.shard === 4 ? 'node:tooling' : `node:tooling:${group.shard}`)
      || group.group !== 'node:tooling' || group.kind !== 'command' || group.command !== 'node' || group.cwd !== '.' || group.files.length === 0
      || JSON.stringify(group.args) !== JSON.stringify(['--test', '--test-concurrency=1', ...group.files])) throw new Error('Invalid tooling command ownership');
  }
  const union = groups.flatMap(group => group.files);
  if (new Set(discovered).size !== discovered.length || union.length !== discovered.length || new Set(union).size !== discovered.length
    || discovered.some(file => !union.includes(file))) throw new Error('Incomplete or duplicate tooling file coverage');
  return groups;
}

/** The default tooling glob owns top-level Node test files, independently of timing routes. */
function ordinaryToolingFiles(files) { return files.filter(file => /^tooling\/[^/]+\.test\.mjs$/u.test(file)); }

/** Whole-file routes keep the measured compiler/package checks off the default tooling consumer. */
export function partitionToolingFiles(files) {
  const routes = { 'tooling/quality-gates.test.mjs': 3, 'tooling/release-artifacts.test.mjs': 2, 'tooling/declaration-boundaries.test.mjs': 1 };
  for (const filename of Object.keys(routes)) {
    if (!files.includes(filename)) throw new Error(`Missing named tooling file: ${filename}`);
  }
  return partitionObligations(files, Object.fromEntries(files.map(file => [file, routes[file] ?? 4])));
}
