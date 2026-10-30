/** PR preparation and receipts must prove complete, revision-bound test coverage. */
import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtemp, writeFile, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

/** This fixture records real wrapper dispatch without executing expensive child phases. */
const root = fileURLToPath(new URL('../', import.meta.url));
import { partitionObligations, shardNumber, validateBundle, validateAggregate, validateGraph } from './pr-ci.mjs';

test('#301 focused regression maps to one ordinary core owner without another default invocation', async () => {
  const { planRepository } = await import('./pr-ci.mjs');
  const plan = await planRepository(root);
  const workspace = JSON.parse(await readFile(path.join(root, 'package.json'), 'utf8'));
  const regression = 'jest:packages/core/test/within-person/regression.test.ts';
  const alias = 'test:within-person:regression';
  const command = 'tsc -p packages/core/tsconfig.test.json && node --experimental-vm-modules node_modules/jest/bin/jest.js --config packages/core/jest.config.mjs --runInBand --runTestsByPath packages/core/.test-build/test/within-person/regression.test.js';
  assert.equal(workspace.scripts[alias], command);
  assert.equal(plan.catalog.graph.scripts[`.:${alias}`], command);
  const owned = plan.obligations.filter(item => item.id === regression);
  assert.equal(owned.length, 1);
  assert.equal(owned[0].group, 'packages/core/jest.config.mjs');
  assert.equal(owned[0].file, 'packages/core/.test-build/test/within-person/regression.test.js');
  assert.equal(plan.shards.flat().filter(id => id === regression).length, 1);

  // The focused command names the existing ordinary owner. Default entrypoints
  // reach that owner through core's ordinary suite and never invoke it again.
  const reachable = new Set();
  const visit = name => {
    if (reachable.has(name)) return;
    reachable.add(name);
    for (const match of (workspace.scripts[name] ?? '').matchAll(/npm run ([\w:-]+)/gu)) visit(match[1]);
  };
  for (const name of ['build', 'check', 'test', 'build:pr-ci', 'test:pr-ci', 'test:pr-ci:aggregate']) visit(name);
  assert.equal(reachable.has(alias), false);
  assert.equal(reachable.has('qualify:within-person'), false);
  assert.ok(!plan.obligations.some(item => item.id.includes('qualify:within-person') || item.file?.includes('exp-within-person-discovery/.test-build/test/')));
  assert.ok(!Object.values(plan.catalog.graph.scripts).some(script => script.includes('/test/parent.js') || script.includes('coordinator.js')));
});

test('a complete partition retains all four expected isolated shards', () => {
  assert.deepEqual(partitionObligations(['a', 'b'], { a: 1, b: 4 }), [[ 'a' ], [], [], [ 'b' ]]);
  assert.equal(shardNumber('4'), 4);
});

test('omitted, duplicated and unknown obligations cannot disappear from coverage', () => {
  assert.throws(() => partitionObligations(['a', 'b'], { a: 1 }), /assignment/u);
  assert.throws(() => partitionObligations(['a', 'a'], { a: 1 }), /duplicate/u);
  assert.throws(() => partitionObligations(['a'], { a: 1, unknown: 2 }), /unknown/u);
});

test('shard identity rejects zero, outside the fixed set and noncanonical aliases', () => {
  for (const value of ['0', '5', '01', '1.0', '', 'NaN']) {
    assert.throws(() => shardNumber(value), /shard/u, value);
  }
});

/** Source head and tested merge commit have different meanings and both stay bound. */
const identity = { testedSha: 'a'.repeat(40), headSha: 'b'.repeat(40), runId: '123', attempt: '1', sourceDigest: 'f'.repeat(64) };
const entries = [{ path: 'packages/core/dist/index.js', sha256: 'c'.repeat(64), size: 12 }];
const manifest = { schema: 1, identity, shard: 1, entries };
const plan = [['a'], ['b'], ['c'], ['d']];
const preparation = { identity, planDigest: 'e'.repeat(64), bundles: ['1', '2', '3', '4'].map(value => value.repeat(64)) };
const receipts = plan.map((ids, index) => ({ schema: 1, identity, shard: index + 1, planned: ids, executed: ids, status: 'success', planDigest: preparation.planDigest, bundleDigest: preparation.bundles[index] }));

test('bundles reject stale identity and missing, changed or extra outputs', () => {
  assert.deepEqual(validateBundle(manifest, entries, identity), manifest);
  for (const key of Object.keys(identity)) {
    assert.throws(() => validateBundle(manifest, entries, { ...identity, [key]: 'wrong' }), /identity/u, key);
  }
  assert.throws(() => validateBundle(manifest, [], identity), /entries/u);
  assert.throws(() => validateBundle(manifest, [{ ...entries[0], sha256: 'd'.repeat(64) }], identity), /entries/u);
  assert.throws(() => validateBundle(manifest, [...entries, { ...entries[0], path: 'extra' }], identity), /entries/u);
});

test('aggregate requires preparation and every successful expected shard', () => {
  assert.equal(validateAggregate(plan, identity, 'success', ['success', 'success', 'success', 'success'], receipts, preparation), true);
  for (const result of ['failure', 'cancelled', 'skipped', undefined]) {
    assert.throws(() => validateAggregate(plan, identity, result, Array(4).fill('success'), receipts, preparation), /preparation/u);
    assert.throws(() => validateAggregate(plan, identity, 'success', ['success', result, 'success', 'success'], receipts, preparation), /shard/u);
  }
  assert.throws(() => validateAggregate(plan, identity, 'success', Array(4).fill('success'), receipts.slice(0, 3), preparation), /receipt/u);
  assert.throws(() => validateAggregate(plan, identity, 'success', Array(4).fill('success'), [receipts[0], receipts[0], ...receipts.slice(2)], preparation), /receipt/u);
});

test('partial, stale and falsely successful receipts cannot qualify the protected aggregate', () => {
  for (const bad of [
    { ...receipts[0], executed: [] },
    { ...receipts[0], executed: ['a', 'a'] },
    { ...receipts[0], planned: ['unknown'] },
    { ...receipts[0], identity: { ...identity, attempt: '2' } },
    { ...receipts[0], status: 'failure' },
  ]) assert.throws(() => validateAggregate(plan, identity, 'success', Array(4).fill('success'), [bad, ...receipts.slice(1)], preparation), /receipt/u);
});

test('new workspace, configuration, reachable script or tsd obligation fails closed', () => {
  const reviewed = { packages: ['core'], configs: ['core/jest.config.mjs'], scripts: { 'root:test': 'jest' }, typeFiles: ['core/test-d/api.test-d.ts'] };
  assert.deepEqual(validateGraph(reviewed, reviewed), reviewed);
  for (const changed of [
    { ...reviewed, packages: ['core', 'new'] },
    { ...reviewed, configs: [...reviewed.configs, 'new/jest.config.mjs'] },
    { ...reviewed, scripts: { ...reviewed.scripts, 'root:test:new': 'node unseen.mjs' } },
    { ...reviewed, scripts: { 'root:test': 'jest && node unseen.mjs' } },
    { ...reviewed, typeFiles: [] },
  ]) assert.throws(() => validateGraph(changed, reviewed), /graph/u);
});

test('prepared compound gates skip only already completed compiler/lint prerequisites', async () => {
  const directory = await mkdtemp(path.join(tmpdir(), 'microdelta-pr-ci-wrapper-'));
  try {
    const hook = path.join(directory, 'hook.mjs');
    await writeFile(hook, `import cp from 'node:child_process'; import { syncBuiltinESMExports } from 'node:module'; import { appendFileSync } from 'node:fs';
cp.spawnSync = (cmd, args) => { appendFileSync(process.env.PR_CI_TRACE, JSON.stringify([cmd, args]) + '\\n'); return { status: 0, stdout: '', stderr: '' }; }; syncBuiltinESMExports();`);
    for (const [wrapper, phaseCount] of [['scratch/gap-hunt/scale/repro-fanout-admission.mjs', 9], ['tooling/subtree-query-gate.mjs', 5]]) {
      const traces = [];
      for (const prepared of [false, true]) {
        const trace = path.join(directory, `trace-${traces.length}.jsonl`);
        await writeFile(trace, '');
        const result = spawnSync(process.execPath, ['--import', hook, wrapper, ...(prepared ? ['--prepared'] : [])], {
          cwd: root, encoding: 'utf8', env: { ...process.env, GAP_HUNT_REUSE_BUILD: '1', PR_CI_TRACE: trace },
        });
        assert.equal(result.status, 0, result.stderr);
        traces.push((await readFile(trace, 'utf8')).trim().split('\n').map(line => JSON.parse(line).map(value => Array.isArray(value) ? value.map(arg => arg.replace(/microdelta-(fanout-matrix|subtree-query)-[^/]+/u, 'microdelta-$1-TEMP')) : value)));
      }
      assert.equal(traces[0].length, phaseCount);
      assert.deepEqual(traces[1], traces[0].slice(2));
    }
  } finally { await rm(directory, { recursive: true, force: true }); }
});

test('bundle input rejects noncanonical identity and escaping generated paths', () => {
  for (const change of [{ testedSha: 'no-sha' }, { headSha: '' }, { runId: '0' }, { attempt: '01' }]) {
    const changedIdentity = { ...identity, ...change };
    assert.throws(() => validateBundle({ ...manifest, identity: changedIdentity }, entries, changedIdentity), /identity/u);
  }
  for (const filename of ['../private', '/absolute', 'node_modules/secret', 'packages/core/dist/../../source.ts']) {
    const badEntries = [{ ...entries[0], path: filename }];
    assert.throws(() => validateBundle({ ...manifest, entries: badEntries }, badEntries, identity), /entries/u);
  }
});

test('aggregate also binds receipts to preparation plan and individual bundle hashes', () => {
  const preparation = { identity, planDigest: 'e'.repeat(64), bundles: ['1', '2', '3', '4'].map(digest => digest.repeat(64)) };
  const complete = receipts.map((receipt, index) => ({ ...receipt, planDigest: preparation.planDigest, bundleDigest: preparation.bundles[index] }));
  assert.equal(validateAggregate(plan, identity, 'success', Array(4).fill('success'), complete, preparation), true);
  assert.throws(() => validateAggregate(plan, identity, 'success', Array(4).fill('success'), receipts.map(({ planDigest, bundleDigest, ...rest }) => rest), preparation), /receipt/u);
  assert.throws(() => validateAggregate(plan, identity, 'success', Array(4).fill('success'), complete, { ...preparation, identity: { ...identity, attempt: '2' } }), /preparation/u);
});

test('actual CI routing avoids automatic feature-push duplicates and retains caller-selected manual full checks', async () => {
  const { workflowRoute } = await import('./pr-ci-workflow.mjs');
  const check = await readFile(path.join(root, '.github/workflows/check.yml'), 'utf8');
  const pr = await readFile(path.join(root, '.github/workflows/pr-check.yml'), 'utf8').catch(() => 'on: []\n');
  assert.equal(workflowRoute(check, 'push', 'feature'), false);
  assert.equal(workflowRoute(check, 'push', 'main'), true);
  assert.equal(workflowRoute(check, 'pull_request', 'feature'), false);
  for (const branch of ['main', 'feature', 'changeset-release/main']) assert.equal(workflowRoute(check, 'workflow_dispatch', branch), true);
  assert.equal(workflowRoute(pr, 'pull_request', 'feature'), true);
  assert.equal(workflowRoute(pr, 'push', 'main'), false);
  assert.equal(workflowRoute(pr, 'push', 'feature'), false);
});

test('the discovered plan covers all ordinary core files and every non-Jest default gate', async () => {
  const { planRepository, sourceFiles } = await import('./pr-ci.mjs');
  const plan = await planRepository(root);
  const core = sourceFiles(root).filter(file => file.startsWith('packages/core/test/') && file.endsWith('.test.ts')).map(file => `jest:${file}`).sort();
  const assigned = plan.shards.flat();
  assert.deepEqual(assigned.filter(id => id.startsWith('jest:packages/core/')).sort(), core);
  assert.equal(new Set(assigned).size, assigned.length);
  for (const shard of plan.shards) assert.ok(shard.some(id => id.startsWith('jest:packages/core/')));
  for (const id of ['compound:fanout', 'compound:subtree', 'node:tooling', 'node:examples', 'controls:core', 'controls:tracking', 'controls:supervision', 'types:controlled-report']) assert.equal(assigned.filter(item => item === id).length, 1);
  for (const owner of plan.catalog.graph.packages) assert.equal(assigned.filter(id => id === `types:${owner}`).length, 1);
  assert.ok(plan.catalog.excluded['.:test:controlled-report:workload']);
  assert.equal(assigned.some(id => id.includes('test:controlled-report:workload')), false);
});

test('invalid bundle attempts cannot dispatch the first test command or copy source paths', async () => {
  const { executeShard } = await import('./pr-ci-runner.mjs');
  const { fileEntries, digest, sourceDigest } = await import('./pr-ci.mjs');
  const directory = await sourceFixture();
  const fixtureIdentity = { ...identity, sourceDigest: await sourceDigest(directory) };
  try {
    const { mkdir } = await import('node:fs/promises');
    const output = 'packages/core/dist';
    await mkdir(path.join(directory, 'bundle/outputs', output), { recursive: true });
    await writeFile(path.join(directory, 'bundle/outputs', output, 'index.js'), 'export {};\n');
    const marker = path.join(directory, 'dispatched');
    const obligation = { id: 'test', kind: 'command', cwd: '.', args: ['-e', `require('fs').writeFileSync(${JSON.stringify(marker)}, '')`] };
    const plan = { digest: digest('fixture'), catalog: { commonOutputs: [output] }, obligations: [obligation], shards: [['test'], [], [], []] };
    const bundleManifest = { schema: 1, identity: fixtureIdentity, shard: 1, planDigest: plan.digest, outputs: [output], entries: await fileEntries(path.join(directory, 'bundle/outputs')) };
    const filename = path.join(directory, 'bundle/manifest.json');
    for (const invalid of [
      { ...bundleManifest, identity: { ...fixtureIdentity, attempt: '2' } },
      { ...bundleManifest, identity: { ...fixtureIdentity, testedSha: 'f'.repeat(40) } },
      { ...bundleManifest, planDigest: digest('old plan') },
      { ...bundleManifest, entries: [] },
      { ...bundleManifest, shard: 2 },
    ]) {
      await writeFile(filename, JSON.stringify(invalid));
      await assert.rejects(executeShard(directory, fixtureIdentity, plan, 1, path.join(directory, 'bundle')), /identity|entries|mismatch/u);
      await assert.rejects(readFile(marker), { code: 'ENOENT' });
      await assert.rejects(readFile(path.join(directory, output, 'index.js')), { code: 'ENOENT' });
    }
    await writeFile(filename, JSON.stringify(bundleManifest));
    const receipt = await executeShard(directory, fixtureIdentity, plan, 1, path.join(directory, 'bundle'));
    assert.equal(receipt.status, 'success');
    assert.deepEqual(receipt.executed, ['test']);
    assert.equal(await readFile(marker, 'utf8'), '');
  } finally { await rm(directory, { recursive: true, force: true }); }
});

test('the PR workflow waits for every dependency and uploads complete hidden test emissions', async () => {
  const { workflowJobs } = await import('./release-workflow.mjs');
  const workflow = await readFile(path.join(root, '.github/workflows/pr-check.yml'), 'utf8');
  const jobs = workflowJobs(workflow);
  assert.match(jobs.core, /name: core \(24\)/u);
  assert.match(jobs.core, /if: \$\{\{ always\(\) \}\}/u);
  assert.match(jobs.core, /needs: \[prepare, tests\]/u);
  assert.match(jobs.core, /PR_PREPARE_RESULT: \$\{\{ needs.prepare.result \}\}/u);
  assert.match(jobs.core, /PR_SHARDS_RESULT: \$\{\{ needs.tests.result \}\}/u);
  assert.match(jobs.tests, /fail-fast: false/u);
  assert.match(jobs.tests, /shard: \[1, 2, 3, 4\]/u);
  assert.equal([...jobs.prepare.matchAll(/include-hidden-files: true/gu)].length, 4);
  assert.match(workflow, /permissions:\n  contents: read/u);
  assert.doesNotMatch(workflow, /pull_request_target|:\s*write\b/u);
  assert.equal([...workflow.matchAll(/ref: \$\{\{ github.sha \}\}/gu)].length, 3);
});

test('the CLI rejects an invalid shard before source discovery or test dispatch', () => {
  for (const shard of ['0', '5', '01']) {
    const result = spawnSync(process.execPath, ['tooling/pr-ci-runner.mjs', 'shard', shard, 'missing-bundle'], { cwd: root, encoding: 'utf8' });
    assert.equal(result.status, 1);
    assert.match(result.stderr, /shard/u);
    assert.equal(result.stdout, '');
  }
});

test('the aggregate rejects an omitted successful-preparation record', () => {
  assert.throws(() => validateAggregate(plan, identity, 'success', Array(4).fill('success'), receipts, undefined), /preparation/u);
});

test('removing or duplicating a config/type owner from the catalog fails instead of shrinking discovery', async () => {
  const { validateCatalog } = await import('./pr-ci.mjs');
  const catalog = JSON.parse(await readFile(path.join(root, 'tooling/pr-ci-catalog.json'), 'utf8'));
  assert.equal(validateCatalog(catalog), catalog);
  assert.throws(() => validateCatalog({ ...catalog, groups: catalog.groups.slice(1) }), /configuration/u);
  assert.throws(() => validateCatalog({ ...catalog, groups: [...catalog.groups, catalog.groups[0]] }), /configuration/u);
  assert.throws(() => validateCatalog({ ...catalog, types: catalog.types.slice(1) }), /type/u);
  assert.throws(() => validateCatalog({ ...catalog, types: [...catalog.types, catalog.types[0]] }), /type/u);
});

test('generated output roots cannot widen preparation deletion into source or dependencies', async () => {
  const { outputsForShard } = await import('./pr-ci-runner.mjs');
  for (const output of ['.', '..', '/', 'packages/core', 'node_modules', 'scratch', 'packages/core/dist/../../src']) {
    assert.throws(() => outputsForShard({ catalog: { commonOutputs: [output] }, obligations: [], shards: [[], [], [], []] }, 1), /output/u);
  }
});

test('prepared node test groups serialize their file dispatch within each shard', async () => {
  const { planRepository } = await import('./pr-ci.mjs');
  const plan = await planRepository(root);
  for (const id of ['node:tooling', 'node:examples']) {
    assert.ok(plan.obligations.find(item => item.id === id).args.includes('--test-concurrency=1'));
  }
  for (const id of ['controls:core', 'controls:tracking']) {
    assert.match(plan.obligations.find(item => item.id === id).script, /node --test --test-concurrency=1 /u);
  }
});

test('discovery treats npm pretest/posttest lifecycle hooks as new ordinary obligations', async () => {
  const { discoverGraph } = await import('./pr-ci.mjs');
  const { mkdir } = await import('node:fs/promises');
  const directory = await mkdtemp(path.join(tmpdir(), 'microdelta-pr-ci-lifecycle-'));
  try {
    await mkdir(path.join(directory, 'packages/core'), { recursive: true });
    await writeFile(path.join(directory, 'packages/core/package.json'), JSON.stringify({ scripts: { test: 'node test.mjs' } }));
    await writeFile(path.join(directory, 'package.json'), JSON.stringify({ workspaces: ['packages/*'], scripts: { test: 'npm test --workspaces', pretest: 'node before.mjs', posttest: 'node after.mjs' } }));
    const graph = await discoverGraph(directory, []);
    assert.equal(graph.scripts['.:pretest'], 'node before.mjs');
    assert.equal(graph.scripts['.:posttest'], 'node after.mjs');
  } finally { await rm(directory, { recursive: true, force: true }); }
});

test('discovery recognizes alternate Jest configuration extensions instead of silently omitting them', async () => {
  const { discoverGraph } = await import('./pr-ci.mjs');
  const { mkdir } = await import('node:fs/promises');
  const directory = await mkdtemp(path.join(tmpdir(), 'microdelta-pr-ci-config-'));
  try {
    await mkdir(path.join(directory, 'packages'), { recursive: true });
    await writeFile(path.join(directory, 'package.json'), JSON.stringify({ workspaces: ['packages/*'], scripts: { test: 'jest' } }));
    for (const file of ['jest.config.cjs', 'custom.jest.config.ts', 'jest.config.js', 'jest.config.json']) await writeFile(path.join(directory, file), '{}');
    const files = ['custom.jest.config.ts', 'jest.config.cjs', 'jest.config.js', 'jest.config.json'];
    assert.deepEqual(Object.keys((await discoverGraph(directory, files)).configs), files);
  } finally { await rm(directory, { recursive: true, force: true }); }
});

test('assignment values are canonical numbers and the partition union is exact', () => {
  assert.throws(() => partitionObligations(['a'], { a: '1' }), /assignment/u);
  const discovered = ['a', 'b', 'c', 'd'];
  const shards = partitionObligations(discovered, { a: 1, b: 2, c: 3, d: 4 });
  assert.deepEqual(shards.flat().sort(), [...discovered].sort());
  assert.equal(new Set(shards.flat()).size, discovered.length);
});

/** Reproduce inventory changes in a real Git checkout without changing this repository. */
async function inventoryFixture() {
  const { mkdir } = await import('node:fs/promises');
  const { sourceFiles } = await import('./pr-ci.mjs');
  const directory = await mkdtemp(path.join(tmpdir(), 'microdelta-pr-ci-inventory-'));
  const catalog = JSON.parse(await readFile(path.join(root, 'tooling/pr-ci-catalog.json'), 'utf8'));
  const files = new Set(['package.json', 'tooling/pr-ci-catalog.json', ...catalog.graph.packages.map(owner => `${owner}/package.json`), ...Object.keys(catalog.graph.configs), ...catalog.graph.typeFiles,
    ...sourceFiles(root).filter(file => file.endsWith('.test.ts') || file.endsWith('.test.mjs'))]);
  for (const file of files) {
    await mkdir(path.dirname(path.join(directory, file)), { recursive: true });
    await writeFile(path.join(directory, file), await readFile(path.join(root, file)));
  }
  const git = spawnSync('git', ['init', '-q'], { cwd: directory, encoding: 'utf8' });
  assert.equal(git.status, 0, git.stderr);
  const track = spawnSync('git', ['add', '-f', '.'], { cwd: directory, encoding: 'utf8' });
  assert.equal(track.status, 0, track.stderr);
  return { directory, catalog };
}

test('an actual catalog string assignment cannot silently remove a planned type obligation', async () => {
  const { planRepository } = await import('./pr-ci.mjs');
  const { directory, catalog } = await inventoryFixture();
  try {
    const valid = await planRepository(directory);
    assert.equal(valid.shards.flat().length, valid.obligations.length);
    catalog.types[0].shard = '1';
    await writeFile(path.join(directory, 'tooling/pr-ci-catalog.json'), JSON.stringify(catalog));
    await assert.rejects(planRepository(directory), /assignment/u);
  } finally { await rm(directory, { recursive: true, force: true }); }
});

test('matching source/snapshot additions still require an executable owner for a new reachable leaf', async () => {
  const { discoverGraph, planRepository } = await import('./pr-ci.mjs');
  const { directory, catalog } = await inventoryFixture();
  try {
    const filename = path.join(directory, 'package.json');
    const workspace = JSON.parse(await readFile(filename, 'utf8'));
    workspace.scripts['test:extra'] = 'node extra.test.mjs';
    workspace.scripts.test += ' && npm run test:extra';
    await writeFile(filename, JSON.stringify(workspace));
    await writeFile(path.join(directory, 'extra.test.mjs'), 'throw new Error("must have an execution owner");\n');
    catalog.graph = await discoverGraph(directory);
    await writeFile(path.join(directory, 'tooling/pr-ci-catalog.json'), JSON.stringify(catalog));
    await assert.rejects(planRepository(directory), /execution owner|unsupported/u);
  } finally { await rm(directory, { recursive: true, force: true }); }
});

test('bundle provenance requires a canonical whole-source digest even when commit and plan agree', () => {
  for (const sourceDigest of [undefined, '', 'not-a-digest']) {
    const sameIdentity = { ...identity, sourceDigest };
    assert.throws(() => validateBundle({ ...manifest, identity: sameIdentity }, entries, sameIdentity), /identity/u);
  }
});

/** A minimal real checkout lets provenance tests distinguish source from generated state. */
async function sourceFixture() {
  const directory = await mkdtemp(path.join(tmpdir(), 'microdelta-pr-ci-source-'));
  await writeFile(path.join(directory, '.gitignore'), '.pr-ci/\nbundle/\npackages/*/dist/\ndispatched\n');
  await writeFile(path.join(directory, 'source.txt'), 'accepted source\n');
  const git = (...args) => spawnSync('git', args, { cwd: directory, encoding: 'utf8' });
  assert.equal(git('init', '-q').status, 0);
  assert.equal(git('add', '-f', '.gitignore', 'source.txt').status, 0);
  return directory;
}

test('whole-source digest includes all tracked and new source while excluding generated outputs', async () => {
  const { sourceDigest } = await import('./pr-ci.mjs');
  const { mkdir } = await import('node:fs/promises');
  const directory = await sourceFixture();
  try {
    const original = await sourceDigest(directory);
    assert.match(original, /^[a-f0-9]{64}$/u);
    await mkdir(path.join(directory, '.pr-ci'), { recursive: true });
    await writeFile(path.join(directory, '.pr-ci/generated.json'), '{}');
    assert.equal(await sourceDigest(directory), original);
    await writeFile(path.join(directory, 'new-tooling.mjs'), 'export {};\n');
    assert.notEqual(await sourceDigest(directory), original);
    await rm(path.join(directory, 'new-tooling.mjs'));
    await writeFile(path.join(directory, 'source.txt'), 'changed with the same Git HEAD\n');
    assert.notEqual(await sourceDigest(directory), original);
  } finally { await rm(directory, { recursive: true, force: true }); }
});

/** A verified-looking generated bundle isolates source identity from output hash validity. */
async function bundleFixture(directory, fixtureIdentity, obligations = []) {
  const { mkdir } = await import('node:fs/promises');
  const { digest, fileEntries } = await import('./pr-ci.mjs');
  const output = 'packages/core/dist';
  await mkdir(path.join(directory, 'bundle/outputs', output), { recursive: true });
  await writeFile(path.join(directory, 'bundle/outputs', output, 'index.js'), 'export {};\n');
  const plan = { digest: digest('source fixture'), catalog: { commonOutputs: [output] }, obligations, shards: [obligations.map(item => item.id), [], [], []] };
  const manifest = { schema: 1, identity: fixtureIdentity, shard: 1, planDigest: plan.digest, outputs: [output], entries: await fileEntries(path.join(directory, 'bundle/outputs')) };
  await writeFile(path.join(directory, 'bundle/manifest.json'), JSON.stringify(manifest));
  return plan;
}

test('restore and shard dispatch reject dirty source even with the same commit, run, attempt, plan and bundle hashes', async () => {
  const { sourceDigest } = await import('./pr-ci.mjs');
  const { restoreBundle, executeShard } = await import('./pr-ci-runner.mjs');
  const directory = await sourceFixture();
  try {
    const fixtureIdentity = { ...identity, sourceDigest: await sourceDigest(directory) };
    const marker = path.join(directory, 'dispatched');
    const plan = await bundleFixture(directory, fixtureIdentity, [{ id: 'test', kind: 'command', cwd: '.', args: ['-e', `require('fs').writeFileSync(${JSON.stringify(marker)}, '')`] }]);
    await writeFile(path.join(directory, 'source.txt'), 'changed after preparation\n');
    await assert.rejects(restoreBundle(directory, path.join(directory, 'bundle'), fixtureIdentity, plan, 1), /source digest/u);
    await assert.rejects(executeShard(directory, fixtureIdentity, plan, 1, path.join(directory, 'bundle')), /source digest/u);
    await assert.rejects(readFile(marker), { code: 'ENOENT' });
    await assert.rejects(readFile(path.join(directory, 'packages/core/dist/index.js')), { code: 'ENOENT' });
  } finally { await rm(directory, { recursive: true, force: true }); }
});

test('a shard cannot issue a successful receipt after a test changes source', async () => {
  const { sourceDigest } = await import('./pr-ci.mjs');
  const { executeShard } = await import('./pr-ci-runner.mjs');
  const directory = await sourceFixture();
  try {
    const fixtureIdentity = { ...identity, sourceDigest: await sourceDigest(directory) };
    const source = path.join(directory, 'source.txt');
    const plan = await bundleFixture(directory, fixtureIdentity, [{ id: 'test', kind: 'command', cwd: '.', args: ['-e', `require('fs').writeFileSync(${JSON.stringify(source)}, 'changed')`] }]);
    await assert.rejects(executeShard(directory, fixtureIdentity, plan, 1, path.join(directory, 'bundle')), /source digest/u);
    assert.equal(JSON.parse(await readFile(path.join(directory, '.pr-ci/receipt-1.json'), 'utf8')).status, 'failure');
  } finally { await rm(directory, { recursive: true, force: true }); }
});

for (const mutation of ['before', 'during']) test(`preparation refuses ${mutation} source drift before issuing its record`, async () => {
  const { sourceDigest } = await import('./pr-ci.mjs');
  const { prepare } = await import('./pr-ci-runner.mjs');
  const { mkdir } = await import('node:fs/promises');
  const directory = await sourceFixture();
    try {
      const fixtureIdentity = { ...identity, sourceDigest: await sourceDigest(directory) };
      const plan = { digest: 'a'.repeat(64), catalog: { commonOutputs: ['packages/core/dist'], compiles: [], groups: [] }, obligations: [], shards: [[], [], [], []] };
      let dispatched = 0;
      const execute = async () => {
        dispatched++;
        await mkdir(path.join(directory, 'packages/core/dist'), { recursive: true });
        await writeFile(path.join(directory, 'packages/core/dist/index.js'), 'export {};\n');
        if (mutation === 'during') await writeFile(path.join(directory, 'source.txt'), 'changed during build\n');
      };
      if (mutation === 'before') await writeFile(path.join(directory, 'source.txt'), 'changed before build\n');
      await assert.rejects(prepare(directory, fixtureIdentity, plan, execute), /source digest/u);
      if (mutation === 'before') assert.equal(dispatched, 0);
      await assert.rejects(readFile(path.join(directory, '.pr-ci/preparation.json')), { code: 'ENOENT' });
  } finally { await rm(directory, { recursive: true, force: true }); }
});

test('aggregate refuses source drift even when all four receipts otherwise match preparation', async () => {
  const { sourceDigest, digest } = await import('./pr-ci.mjs');
  const { aggregate } = await import('./pr-ci-runner.mjs');
  const { mkdir } = await import('node:fs/promises');
  const directory = await sourceFixture();
  try {
    const fixtureIdentity = { ...identity, sourceDigest: await sourceDigest(directory) };
    const plan = { digest: digest('empty plan'), shards: [[], [], [], []], obligations: [] };
    const preparation = { schema: 1, identity: fixtureIdentity, planDigest: plan.digest, bundles: Array(4).fill('a'.repeat(64)) };
    await mkdir(path.join(directory, '.pr-ci/receipts'), { recursive: true });
    await writeFile(path.join(directory, '.pr-ci/preparation.json'), JSON.stringify(preparation));
    for (const shard of [1, 2, 3, 4]) await writeFile(path.join(directory, `.pr-ci/receipts/receipt-${shard}.json`), JSON.stringify({ schema: 1, identity: fixtureIdentity, shard, planDigest: plan.digest, bundleDigest: preparation.bundles[shard - 1], planned: [], executed: [], status: 'success' }));
    await writeFile(path.join(directory, 'source.txt'), 'changed before aggregation\n');
    await assert.rejects(aggregate(directory, fixtureIdentity, plan, { PR_PREPARE_RESULT: 'success', PR_SHARDS_RESULT: 'success' }), /source digest/u);
  } finally { await rm(directory, { recursive: true, force: true }); }
});

test('refreshed graph snapshots cannot hide lifecycle hooks around directly invoked test leaves', async () => {
  const { discoverGraph, planRepository } = await import('./pr-ci.mjs');
  const { directory, catalog } = await inventoryFixture();
  try {
    for (const [owner, hook] of [['.', 'pretest'], ['.', 'posttest'], ['packages/core', 'pretest:unit'], ['packages/core', 'posttest:types']]) {
      const filename = path.join(directory, owner, 'package.json');
      const manifest = JSON.parse(await readFile(filename, 'utf8'));
      manifest.scripts[hook] = 'node must-have-an-owner.mjs';
      await writeFile(filename, JSON.stringify(manifest));
      catalog.graph = await discoverGraph(directory);
      await writeFile(path.join(directory, 'tooling/pr-ci-catalog.json'), JSON.stringify(catalog));
      await assert.rejects(planRepository(directory), /unsupported execution owner/iu, `${owner}:${hook}`);
      delete manifest.scripts[hook];
      await writeFile(filename, JSON.stringify(manifest));
    }
  } finally { await rm(directory, { recursive: true, force: true }); }
});

test('an opt-in exclusion cannot be made reachable by refreshing its parent script snapshot', async () => {
  const { discoverGraph, planRepository } = await import('./pr-ci.mjs');
  const { directory, catalog } = await inventoryFixture();
  try {
    const filename = path.join(directory, 'package.json');
    const workspace = JSON.parse(await readFile(filename, 'utf8'));
    workspace.scripts.test += ' && npm run test:controlled-report:workload';
    await writeFile(filename, JSON.stringify(workspace));
    catalog.graph = await discoverGraph(directory);
    await writeFile(path.join(directory, 'tooling/pr-ci-catalog.json'), JSON.stringify(catalog));
    await assert.rejects(planRepository(directory), /unsupported execution owner/iu);
  } finally { await rm(directory, { recursive: true, force: true }); }
});

test('an added private npm workspace cannot escape the supported package inventory', async () => {
  const { discoverGraph, planRepository } = await import('./pr-ci.mjs');
  const { mkdir } = await import('node:fs/promises');
  const { directory } = await inventoryFixture();
  try {
    const filename = path.join(directory, 'package.json');
    const workspace = JSON.parse(await readFile(filename, 'utf8'));
    workspace.workspaces = ['packages/*', 'tools/*'];
    await writeFile(filename, JSON.stringify(workspace));
    await mkdir(path.join(directory, 'tools/probe'), { recursive: true });
    await writeFile(path.join(directory, 'tools/probe/package.json'), JSON.stringify({ name: '@fixture/probe', private: true, version: '0.0.0', scripts: { test: 'node probe.test.mjs' } }));
    await writeFile(path.join(directory, 'tools/probe/probe.test.mjs'), 'throw new Error("must not disappear");\n');
    const membership = spawnSync('npm', ['pkg', 'get', 'name', '--workspaces', '--json'], { cwd: directory, encoding: 'utf8' });
    assert.equal(membership.status, 0, membership.stderr);
    assert.ok(Object.values(JSON.parse(membership.stdout)).includes('@fixture/probe'), 'ordinary npm workspace commands include the new private probe');
    await assert.rejects(discoverGraph(directory), /workspace layout/u);
    await assert.rejects(planRepository(directory), /workspace layout/u);
  } finally { await rm(directory, { recursive: true, force: true }); }
});

test('artifact-producing aggregation is dispatched as a test task while check tasks stay read-only', async () => {
  const { workflowJobs } = await import('./release-workflow.mjs');
  const workspace = JSON.parse(await readFile(path.join(root, 'package.json'), 'utf8'));
  assert.equal(workspace.scripts['test:pr-ci:aggregate'], 'node tooling/pr-ci-runner.mjs aggregate');
  assert.equal(Object.hasOwn(workspace.scripts, 'check:pr-ci'), false);
  const workflow = await readFile(path.join(root, '.github/workflows/pr-check.yml'), 'utf8');
  assert.match(workflowJobs(workflow).core, /run: npm run test:pr-ci:aggregate\b/u);
  assert.doesNotMatch(workflowJobs(workflow).core, /run: npm run check:pr-ci\b/u);
});

test('coordination task exclusion is restricted to root tasks and cannot hide package obligations', async () => {
  const { discoverGraph } = await import('./pr-ci.mjs');
  const { mkdir } = await import('node:fs/promises');
  const directory = await mkdtemp(path.join(tmpdir(), 'microdelta-pr-ci-task-scope-'));
  try {
    await mkdir(path.join(directory, 'packages/probe'), { recursive: true });
    const scripts = { test: 'node ordinary.mjs', 'test:pr-ci': 'node shard.mjs', 'test:pr-ci:aggregate': 'node aggregate.mjs' };
    await writeFile(path.join(directory, 'package.json'), JSON.stringify({ workspaces: ['packages/*'], scripts }));
    await writeFile(path.join(directory, 'packages/probe/package.json'), JSON.stringify({ scripts }));
    const graph = await discoverGraph(directory, []);
    assert.equal(graph.scripts['packages/probe:test:pr-ci'], 'node shard.mjs');
    assert.equal(graph.scripts['packages/probe:test:pr-ci:aggregate'], 'node aggregate.mjs');
    assert.equal(Object.hasOwn(graph.scripts, '.:test:pr-ci'), false);
    assert.equal(Object.hasOwn(graph.scripts, '.:test:pr-ci:aggregate'), false);
  } finally { await rm(directory, { recursive: true, force: true }); }
});


test('the actual protected aggregate workflow resolves the artifact-producing test task', async () => {
  const { workflowJobs } = await import('./release-workflow.mjs');
  const workspace = JSON.parse(await readFile(path.join(root, 'package.json'), 'utf8'));
  const core = workflowJobs(await readFile(path.join(root, '.github/workflows/pr-check.yml'), 'utf8')).core;
  const task = /^      - run: npm run (\S+)$/mu.exec(core)?.[1];
  assert.equal(task, 'test:pr-ci:aggregate');
  assert.equal(workspace.scripts[task], 'node tooling/pr-ci-runner.mjs aggregate');
});

test('measured tooling files have the selected whole-file owners while every ordinary file stays covered once', async () => {
  const { planRepository, sourceFiles } = await import('./pr-ci.mjs');
  const plan = await planRepository(root);
  const expected = new Map([['tooling/quality-gates.test.mjs', 3], ['tooling/release-artifacts.test.mjs', 2], ['tooling/declaration-boundaries.test.mjs', 1]]);
  for (const [file, shard] of expected) {
    const owner = plan.obligations.find(item => item.files?.includes(file));
    assert.ok(owner, file);
    assert.ok(plan.shards[shard - 1].includes(owner.id), `${file} must be wholly owned by shard ${shard}`);
  }
  const discovered = sourceFiles(root).filter(file => /^tooling\/[^/]+\.test\.mjs$/u.test(file));
  const commands = plan.obligations.filter(item => item.group === 'node:tooling');
  assert.equal(commands.length, 4);
  assert.deepEqual(commands.flatMap(item => item.files).sort(), discovered);
  assert.equal(new Set(commands.flatMap(item => item.files)).size, discovered.length);
  for (const command of commands) assert.deepEqual(command.args, ['--test', '--test-concurrency=1', ...command.files]);
});

/** Independent malformed inventories exercise each fail-closed ownership boundary. */
const invalidToolingGroups = [
  ['missing group', (files, groups) => [files, groups.slice(1)]],
  ['missing file', (files, groups) => [files, [{ ...groups[0], files: [], args: ['--test', '--test-concurrency=1'] }, ...groups.slice(1)]]],
  ['duplicate file owner', (files, groups) => [files, [groups[0], { ...groups[1], files: [files[0]], args: ['--test', '--test-concurrency=1', files[0]] }, ...groups.slice(2)]]],
  ['new unowned file', (files, groups) => [[...files, 'tooling/new.test.mjs'], groups]],
  ['wrong dispatched file', (files, groups) => [files, [{ ...groups[0], args: ['--test', '--test-concurrency=1', 'tooling/wrong.test.mjs'] }, ...groups.slice(1)]]],
  ['undiscovered extra file', (files, groups) => [files, [{ ...groups[0], files: [...groups[0].files, 'tooling/extra.test.mjs'], args: [...groups[0].args, 'tooling/extra.test.mjs'] }, ...groups.slice(1)]]],
];
for (const [label, mutate] of invalidToolingGroups) test(`tooling file ownership rejects ${label}`, async () => {
  const { validateToolingGroups } = await import('./pr-ci.mjs');
  const files = ['tooling/a.test.mjs', 'tooling/b.test.mjs', 'tooling/c.test.mjs', 'tooling/d.test.mjs'];
  const groups = files.map((file, index) => ({ id: index === 3 ? 'node:tooling' : `node:tooling:${index + 1}`, group: 'node:tooling', shard: index + 1, kind: 'command', command: 'node', cwd: '.', files: [file], args: ['--test', '--test-concurrency=1', file] }));
  assert.equal(validateToolingGroups(files, groups), groups);
  const [discovered, commands] = mutate(files, groups);
  assert.throws(() => validateToolingGroups(discovered, commands), /tooling/u);
});

test('a removed named tooling file cannot silently leave its routing slot empty', async () => {
  const { partitionToolingFiles, sourceFiles } = await import('./pr-ci.mjs');
  const files = sourceFiles(root).filter(file => /^tooling\/[^/]+\.test\.mjs$/u.test(file));
  for (const required of ['tooling/quality-gates.test.mjs', 'tooling/release-artifacts.test.mjs', 'tooling/declaration-boundaries.test.mjs']) {
    assert.throws(() => partitionToolingFiles(files.filter(file => file !== required)), /Missing named tooling file/u);
  }
});


test('a newly discovered ordinary tooling file enters one real command and cannot be omitted from its inventory', async () => {
  const { planRepository, sourceFiles, validateToolingGroups } = await import('./pr-ci.mjs');
  const { directory } = await inventoryFixture();
  try {
    const filename = 'tooling/new-ordinary.test.mjs';
    await writeFile(path.join(directory, filename), 'export {};\n');
    const plan = await planRepository(directory);
    const groups = plan.obligations.filter(item => item.group === 'node:tooling');
    const group = groups.find(item => item.files.includes(filename));
    assert.equal(group.shard, 4);
    assert.equal(groups.filter(item => item.files.includes(filename)).length, 1);
    assert.ok(group.args.includes(filename));
    const discovered = sourceFiles(directory).filter(file => /^tooling\/[^/]+\.test\.mjs$/u.test(file));
    const omitted = groups.map(item => ({ ...item, files: item.files.filter(file => file !== filename), args: item.args.filter(arg => arg !== filename) }));
    assert.throws(() => validateToolingGroups(discovered, omitted), /tooling/u);
  } finally { await rm(directory, { recursive: true, force: true }); }
});

test('the isolated offline CLI fixture runs after its real package-install cache prerequisite exactly once', async () => {
  const { planRepository } = await import('./pr-ci.mjs');
  const plan = await planRepository(root);
  const fixture = plan.obligations.find(item => item.id === 'jest:fixtures/contribution-report/cli-workload.test.ts');
  const prerequisite = plan.obligations.find(item => item.group === 'node:tooling' && item.files.includes('tooling/release-artifacts.test.mjs'));
  const shard = plan.shards.find(ids => ids.includes(fixture.id));
  assert.ok(shard.includes(prerequisite.id), 'both stages must share the same private consumer/cache');
  const firstFixture = shard.findIndex(id => plan.obligations.find(item => item.id === id).group === 'fixtures/contribution-report/jest.config.mjs');
  assert.ok(shard.indexOf(prerequisite.id) < firstFixture, 'registry-resolving packaged installs precede the grouped offline fixture invocation');
  assert.equal(plan.shards.flat().filter(id => id === prerequisite.id).length, 1);
});

test('adding an earlier fixture file preserves offline CLI co-location and prerequisite order', async () => {
  const { planRepository } = await import('./pr-ci.mjs');
  const { directory } = await inventoryFixture();
  try {
    await writeFile(path.join(directory, 'fixtures/contribution-report/000-before-cli.test.ts'), 'export {};\n');
    const plan = await planRepository(directory);
    const fixture = plan.obligations.find(item => item.id === 'jest:fixtures/contribution-report/cli-workload.test.ts');
    const prerequisite = plan.obligations.find(item => item.group === 'node:tooling' && item.files.includes('tooling/release-artifacts.test.mjs'));
    assert.ok(plan.shards[1].includes(fixture.id), 'the offline package fixture stays with its shard-2 package prerequisite');
    const firstFixture = plan.shards[1].findIndex(id => plan.obligations.find(item => item.id === id).group === 'fixtures/contribution-report/jest.config.mjs');
    assert.ok(plan.shards[1].indexOf(prerequisite.id) < firstFixture);
    assert.equal(plan.shards.flat().filter(id => id === fixture.id).length, 1);
    assert.ok(plan.obligations.some(item => item.id === 'jest:fixtures/contribution-report/000-before-cli.test.ts'));
  } finally { await rm(directory, { recursive: true, force: true }); }
});


/** Capture the actual package shell argv without compiling or running a workload. */
async function coreScriptDispatch(script) {
  const { mkdir, chmod } = await import('node:fs/promises');
  const directory = await mkdtemp(path.join(tmpdir(), 'microdelta-core-script-route-'));
  const trace = path.join(directory, 'dispatch.jsonl');
  await mkdir(path.join(directory, 'packages/core'), { recursive: true });
  await mkdir(path.join(directory, 'node_modules/jest/bin'), { recursive: true });
  await mkdir(path.join(directory, 'bin'), { recursive: true });
  const record = type => `const fs=require('node:fs');fs.appendFileSync(${JSON.stringify(trace)},JSON.stringify({type:${JSON.stringify(type)},args:process.argv.slice(2)})+String.fromCharCode(10));`;
  await writeFile(path.join(directory, 'node_modules/jest/bin/jest.js'), record('jest'));
  const compiler = path.join(directory, 'bin/tsc');
  await writeFile(compiler, ['#!/usr/bin/env node', record('tsc')].join(String.fromCharCode(10)));
  await chmod(compiler, 0o755);
  try {
    const result = spawnSync('sh', ['-c', script], { cwd: path.join(directory, 'packages/core'), encoding: 'utf8',
      env: { ...process.env, PATH: [path.join(directory, 'bin'), path.dirname(process.execPath), process.env.PATH ?? ''].join(path.delimiter) } });
    assert.equal(result.status, 0, result.stderr);
    return (await readFile(trace, 'utf8')).trim().split(String.fromCharCode(10)).map(line => JSON.parse(line));
  } finally { await rm(directory, { recursive: true, force: true }); }
}

/** A fresh core root makes discovery independent of any retained repository emission. */
async function coreInventoryFixture() {
  const { mkdir, realpath } = await import('node:fs/promises');
  const { sourceFiles } = await import('./pr-ci.mjs');
  const directory = await realpath(await mkdtemp(path.join(tmpdir(), 'microdelta-core-inventory-')));
  const coreDirectory = path.join(directory, 'packages/core');
  await mkdir(coreDirectory, { recursive: true });
  await writeFile(path.join(coreDirectory, 'jest.config.mjs'), await readFile(path.join(root, 'packages/core/jest.config.mjs')));
  const files = sourceFiles(root).filter(file => file.startsWith('packages/core/test/') && file.endsWith('.test.ts'));
  const expected = files.map(file => path.join(directory, file.replace('/test/', '/.test-build/test/').replace(/[.]ts$/u, '.js'))).sort();
  for (const filename of expected) {
    await mkdir(path.dirname(filename), { recursive: true });
    await writeFile(filename, 'throw new Error("Inert discovery modules must never execute");');
  }
  return { directory, coreDirectory, expected };
}

test('#301 default core dispatch owns one fresh bounded regression invocation and complete other-suite discovery', async () => {
  const core = JSON.parse(await readFile(path.join(root, 'packages/core/package.json'), 'utf8'));
  const command = 'node --experimental-vm-modules ../../node_modules/jest/bin/jest.js --config jest.config.mjs --runInBand';
  const emitted = '.test-build/test/within-person/regression.test.js';
  // The shell must preserve one separator expression for native and Windows-shaped paths.
  const backslash = String.fromCharCode(92);
  const separator = `[/${backslash.repeat(2)}]`;
  const pattern = `(^|${separator})packages${separator}core${separator}[.]test-build${separator}test${separator}within-person${separator}regression[.]test[.]js$`;
  const expected = `tsc -p tsconfig.test.json && ${command} --testPathIgnorePatterns "${pattern.replaceAll(backslash, backslash.repeat(2))}" && ${command} --runTestsByPath ${emitted}`;
  // Validate the complete allowed command before executing its inert shell stand-ins.
  assert.equal(core.scripts['test:unit'], expected);
  const calls = await coreScriptDispatch(core.scripts['test:unit']);
  assert.deepEqual(calls.map(call => call.type), ['tsc', 'jest', 'jest']);
  assert.deepEqual(calls[0].args, ['-p', 'tsconfig.test.json']);
  const general = calls[1].args;
  const dedicated = calls[2].args;
  assert.ok(general.includes('--runInBand') && dedicated.includes('--runInBand'));
  assert.equal(general.includes('--runTestsByPath'), false);
  assert.deepEqual(dedicated.slice(dedicated.indexOf('--runTestsByPath')), ['--runTestsByPath', emitted]);
  const ignored = new RegExp(general[general.indexOf('--testPathIgnorePatterns') + 1]);
  for (const filename of ['/repo/packages/core/.test-build/test/within-person/regression.test.js', ['C:', 'repo', 'packages', 'core', '.test-build', 'test', 'within-person', 'regression.test.js'].join(backslash)]) assert.equal(ignored.test(filename), true, filename);
  for (const filename of ['/repo/packages/other/.test-build/test/within-person/regression.test.js', '/repo/packages/core/.test-build/test/within-person/regression-extra.test.js', '/repo/packages/core/.test-build/test/within-person/regression.testXjs', '/repo/packages/core/.test-build/test/within-person/regression.test.js/extra']) assert.equal(ignored.test(filename), false, filename);

  // Installed Jest reads a fresh inert inventory with the actual config; no owner module can run here.
  const fixture = await coreInventoryFixture();
  try {
    const inventory = args => {
      const result = spawnSync(process.execPath, [path.join(root, 'node_modules/jest/bin/jest.js'), ...args, '--listTests', '--json'], { cwd: fixture.coreDirectory, encoding: 'utf8', maxBuffer: 16 * 1024 * 1024 });
      assert.equal(result.status, 0, result.stderr);
      return JSON.parse(result.stdout).sort();
    };
    const all = inventory(['--config', 'jest.config.mjs', '--runInBand']);
    const ordinary = inventory(general);
    const isolated = inventory(dedicated);
    const target = path.join(fixture.coreDirectory, emitted);
    assert.deepEqual(all, fixture.expected);
    assert.deepEqual(isolated, [target]);
    assert.equal(ordinary.includes(target), false);
    assert.equal(new Set([...ordinary, ...isolated]).size, all.length);
    assert.deepEqual([...ordinary, ...isolated].sort(), all);
  } finally { await rm(fixture.directory, { recursive: true, force: true }); }
});

/** A prepared source-bound shard uses inert Jest argv recording, never the real regression module. */
async function isolatedCoreShard(suiteFiles, fail = 'none') {
  const { mkdir } = await import('node:fs/promises');
  const { sourceDigest, fileEntries, digest } = await import('./pr-ci.mjs');
  const directory = await sourceFixture();
  await writeFile(path.join(directory, '.gitignore'), ['.pr-ci/', 'bundle/', 'packages/*/dist/', 'packages/*/.test-build/', 'node_modules/', 'jest-dispatch.jsonl', ''].join(String.fromCharCode(10)));
  await mkdir(path.join(directory, 'node_modules/jest/bin'), { recursive: true });
  const trace = path.join(directory, 'jest-dispatch.jsonl');
  const bounded = 'packages/core/.test-build/test/within-person/regression.test.js';
  await writeFile(path.join(directory, 'node_modules/jest/bin/jest.js'), `
const fs=require('node:fs');const path=require('node:path');const args=process.argv.slice(2);
const files=args.slice(args.indexOf('--runTestsByPath')+1).map(file=>path.relative(${JSON.stringify(directory)},file).split(path.sep).join('/'));
fs.appendFileSync(${JSON.stringify(trace)},JSON.stringify({args,files,cwd:process.cwd()})+String.fromCharCode(10));
if(${JSON.stringify(fail)}==='ordinary'&&files.some(file=>file!==${JSON.stringify(bounded)}))process.exit(7);
if(${JSON.stringify(fail)}==='regression'&&files.includes(${JSON.stringify(bounded)}))process.exit(8);
`);
  const fixtureIdentity = { ...identity, sourceDigest: await sourceDigest(directory) };
  const output = 'packages/core/.test-build';
  const obligations = suiteFiles.map(file => ({ id: `jest:${file.replace('/.test-build/', '/').replace(/[.]js$/u, '.ts')}`, kind: 'jest', group: 'packages/core/jest.config.mjs', file, cwd: 'packages/core', output }));
  const plan = { digest: digest('bounded core routing fixture'), catalog: { commonOutputs: [] }, obligations, shards: [obligations.map(item => item.id), [], [], []] };
  for (const file of suiteFiles) {
    const target = path.join(directory, 'bundle/outputs', file);
    await mkdir(path.dirname(target), { recursive: true }); await writeFile(target, 'export {};');
  }
  const manifest = { schema: 1, identity: fixtureIdentity, shard: 1, planDigest: plan.digest, outputs: [output], entries: await fileEntries(path.join(directory, 'bundle/outputs')) };
  await writeFile(path.join(directory, 'bundle/manifest.json'), JSON.stringify(manifest));
  return { directory, trace, identity: fixtureIdentity, plan, bundle: path.join(directory, 'bundle') };
}

/** The real bounded obligation retains its canonical file identity across every shard shape. */
const boundedCoreSuite = 'packages/core/.test-build/test/within-person/regression.test.js';
/** A neighboring name must remain in the ordinary partition rather than matching by prefix. */
const neighboringCoreSuite = 'packages/core/.test-build/test/within-person/regression-adjacent.test.js';
for (const [name, files, expected] of [
  ['absent', [neighboringCoreSuite], [[neighboringCoreSuite]]],
  ['only', [boundedCoreSuite], [[boundedCoreSuite]]],
  ['mixed', [boundedCoreSuite, neighboringCoreSuite], [[neighboringCoreSuite], [boundedCoreSuite]]],
]) test(`#301 PR core routing ${name} keeps exact ownership without empty or duplicate dispatch`, async () => {
  const { executeShard } = await import('./pr-ci-runner.mjs');
  const fixture = await isolatedCoreShard(files);
  try {
    const receipt = await executeShard(fixture.directory, fixture.identity, fixture.plan, 1, fixture.bundle);
    const calls = (await readFile(fixture.trace, 'utf8')).trim().split(String.fromCharCode(10)).map(line => JSON.parse(line));
    assert.deepEqual(calls.map(call => call.files), expected);
    assert.ok(calls.every(call => call.args.includes('--runInBand') && call.args.includes('--runTestsByPath')));
    assert.deepEqual(calls.flatMap(call => call.files).sort(), [...files].sort());
    assert.equal(receipt.status, 'success'); assert.deepEqual(receipt.executed, fixture.plan.shards[0]);
    assert.equal(new Set(receipt.executed).size, files.length);
    assert.deepEqual(JSON.parse(await readFile(path.join(fixture.directory, '.pr-ci/receipt-1.json'), 'utf8')).executed, fixture.plan.shards[0]);
  } finally { await rm(fixture.directory, { recursive: true, force: true }); }
});

for (const failed of ['ordinary', 'regression']) test(`#301 PR ${failed} failure never receives credit or silently starts the next partition`, async () => {
  const { executeShard } = await import('./pr-ci-runner.mjs');
  const fixture = await isolatedCoreShard([boundedCoreSuite, neighboringCoreSuite], failed);
  try {
    await assert.rejects(executeShard(fixture.directory, fixture.identity, fixture.plan, 1, fixture.bundle), /Command failed/u);
    const calls = (await readFile(fixture.trace, 'utf8')).trim().split(String.fromCharCode(10)).map(line => JSON.parse(line));
    assert.deepEqual(calls.map(call => call.files), failed === 'ordinary' ? [[neighboringCoreSuite]] : [[neighboringCoreSuite], [boundedCoreSuite]]);
    const receipt = JSON.parse(await readFile(path.join(fixture.directory, '.pr-ci/receipt-1.json'), 'utf8'));
    assert.equal(receipt.status, 'failure');
    const ordinaryId = fixture.plan.obligations.find(item => item.file === neighboringCoreSuite).id;
    assert.deepEqual(receipt.executed, failed === 'ordinary' ? [] : [ordinaryId]);
    assert.equal(receipt.executed.includes(fixture.plan.obligations.find(item => item.file === boundedCoreSuite).id), false);
  } finally { await rm(fixture.directory, { recursive: true, force: true }); }
});

/** The separately released facade proof is compiled/linted source, never an ordinary runtime obligation. */
test('#315 bounded facade proof has strict source ownership without automatic runtime execution', async () => {
  const { planRepository } = await import('./pr-ci.mjs');
  const plan = await planRepository(root);
  const workspace = JSON.parse(await readFile(path.join(root, 'package.json'), 'utf8'));
  const config = 'fixtures/within-person-slice/jest.config.mjs';
  assert.equal(workspace.scripts['qualify:within-person-slice'], `node --experimental-vm-modules node_modules/jest/bin/jest.js --config ${config} --runInBand`);
  assert.ok(workspace.scripts['build:fixtures'].includes('tsc -p fixtures/within-person-slice/tsconfig.json'));
  assert.ok(workspace.scripts['check:fixtures'].includes('tsc --noEmit -p fixtures/within-person-slice/tsconfig.json && eslint fixtures/within-person-slice'));
  assert.ok(plan.catalog.excluded[config]);
  assert.equal(plan.obligations.some(item => item.file?.includes('within-person-slice') || item.group === config), false);
  const reachable = new Set();
  const visit = name => {
    if (reachable.has(name)) return;
    reachable.add(name);
    for (const match of (workspace.scripts[name] ?? '').matchAll(/npm run ([\w:-]+)/gu)) visit(match[1]);
  };
  for (const name of ['build', 'check', 'test', 'build:pr-ci', 'test:pr-ci', 'test:pr-ci:aggregate']) visit(name);
  assert.equal(reachable.has('qualify:within-person-slice'), false);
});
