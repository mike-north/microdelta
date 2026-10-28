/**
 * PR preparation is the sole writer of generated test inputs. Isolated consumers
 * restore a verified bundle, execute their complete serial partition, and issue
 * receipts. The aggregate accepts only the current attempt's complete graph.
 */
import { cp, mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { assertSourceDigest, digest, fileEntries, planRepository, shardNumber, sourceDigest, validateAggregate, validateBundle, validateIdentity } from './pr-ci.mjs';

/** Only the calling checkout and current run attempt can consume prepared work. */
export async function workflowIdentity(root, environment = process.env) {
  const git = (...args) => {
    const result = spawnSync('git', args, { cwd: root, encoding: 'utf8' });
    if (result.status !== 0) throw new Error(`Cannot read checkout identity: ${result.stderr}`);
    return result.stdout.trim();
  };
  const testedSha = git('rev-parse', 'HEAD');
  const identity = validateIdentity({ testedSha, headSha: environment.PR_HEAD_SHA, runId: environment.GITHUB_RUN_ID, attempt: environment.GITHUB_RUN_ATTEMPT, sourceDigest: await sourceDigest(root) });
  if (environment.GITHUB_SHA && environment.GITHUB_SHA !== testedSha) throw new Error('Tested checkout identity differs from workflow SHA');
  const parents = git('cat-file', '-p', 'HEAD').split('\n').filter(line => line.startsWith('parent ')).map(line => line.slice(7));
  if (identity.headSha !== testedSha && !parents.includes(identity.headSha)) throw new Error('PR head identity is not associated with the tested checkout');
  if (process.versions.node.split('.')[0] !== '24') throw new Error('PR CI requires the Node 24 baseline');
  return identity;
}

/** Generated runtime dependencies are shared; test outputs follow each shard's owners. */
export function outputsForShard(plan, shard) {
  const ids = new Set(plan.shards[shardNumber(shard) - 1]);
  const outputs = [...new Set([...plan.catalog.commonOutputs, ...plan.obligations.filter(item => ids.has(item.id) && item.output).map(item => item.output)])].sort();
  for (const output of outputs) {
    if (!/^(?:\.test-build|packages\/[a-z-]+\/(?:dist|\.test-build)|experiments\/[a-z0-9-]+\/\.test-build|fixtures\/declarations\/(?:producer|capture-producer|forged)\/dist|fixtures\/contribution-report\/\.test-build|examples\/contribution-report\/dist|scratch\/gap-hunt\/(?:consumer-dx|scale)\/dist|tooling\/subtree-query\/dist)$/u.test(output)) throw new Error(`Invalid generated output root: ${output}`);
  }
  return outputs;
}

/** Run one existing leaf with diagnostics intact and preserve its exact failure. */
function command(root, executable, args, cwd = '.', environment = process.env) {
  const normalized = args.map(arg => arg.startsWith('node_modules/') ? path.join(root, arg) : arg);
  console.log(`$ ${executable} ${normalized.join(' ')} (${cwd})`);
  const result = spawnSync(executable === 'node' ? process.execPath : executable, normalized, {
    cwd: path.join(root, cwd), stdio: 'inherit', env: environment,
  });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`Command failed (${result.status ?? result.signal}): ${executable} ${args.join(' ')}`);
}

/** A preparation phase is recorded only when its full underlying command succeeds. */
async function measured(timings, id, operation) {
  const start = performance.now();
  await operation();
  timings.push({ id, milliseconds: Math.round(performance.now() - start) });
}

/** Finish each receipt before its caller starts artifact upload. */
async function json(filename, value) {
  await mkdir(path.dirname(filename), { recursive: true });
  await writeFile(filename, `${JSON.stringify(value, null, 2)}\n`);
}

/** Source discovery and Jest's installed resolver must agree before bundling any work. */
export function verifyJestInventory(root, plan) {
  for (const group of plan.catalog.groups) {
    const result = spawnSync(process.execPath, ['--experimental-vm-modules', path.join(root, 'node_modules/jest/bin/jest.js'), '--config', path.join(root, group.config), '--listTests', '--runInBand', '--json'], {
      cwd: path.join(root, group.cwd), encoding: 'utf8', maxBuffer: 16 * 1024 * 1024,
    });
    if (result.status !== 0) throw new Error(`Cannot discover Jest inventory: ${group.config}\n${result.stderr}`);
    const actual = JSON.parse(result.stdout).map(filename => path.relative(root, filename).split(path.sep).join('/')).sort();
    const expected = plan.obligations.filter(item => item.kind === 'jest' && item.group === group.config).map(item => item.file).sort();
    if (JSON.stringify(actual) !== JSON.stringify(expected)) throw new Error(`Jest inventory mismatch: ${group.config}\n${JSON.stringify({ actual, expected })}`);
  }
}

/** The single preparation retains the existing static checks and compiles every missing test output. */
export async function prepare(root, identity, plan, execute = command) {
  await assertSourceDigest(root, identity);
  const directory = path.join(root, '.pr-ci');
  await rm(directory, { recursive: true, force: true });
  // A fresh bundle cannot borrow an old emission that compilation no longer
  // produces. Deletion is limited to validated generated roots in this checkout.
  const generated = [...new Set([1, 2, 3, 4].flatMap(shard => outputsForShard(plan, shard)))];
  for (const output of generated) await rm(path.join(root, output), { recursive: true, force: true });
  const timings = [];
  await measured(timings, 'root:build', () => execute(root, 'npm', ['run', 'build']));
  await measured(timings, 'root:check:packages', () => execute(root, 'npm', ['run', 'check:packages']));
  await measured(timings, 'root:check:workspace', () => execute(root, 'npm', ['run', 'check:workspace']));
  for (const config of plan.catalog.compiles) {
    await measured(timings, `compile:${config}`, () => execute(root, 'node', ['node_modules/typescript/bin/tsc', '-p', config]));
  }
  await measured(timings, 'fanout:lint', () => execute(root, 'node', ['node_modules/eslint/bin/eslint.js', '--config', 'scratch/gap-hunt/scale/fanout-admission.eslint.config.mjs', 'scratch/gap-hunt/scale/fanout-admission.ts']));
  await assertSourceDigest(root, identity);
  verifyJestInventory(root, plan);
  const bundles = [];
  for (const shard of [1, 2, 3, 4]) {
    const bundle = path.join(directory, `bundle-${shard}`);
    const outputs = outputsForShard(plan, shard);
    for (const output of outputs) {
      // The reviewed allowlist supplies these roots; no arbitrary working tree,
      // scratch evidence, installed dependency or credential directory is copied.
      await fileEntries(path.join(root, output));
      await cp(path.join(root, output), path.join(bundle, 'outputs', output), { recursive: true });
    }
    const manifest = { schema: 1, identity, shard, planDigest: plan.digest, outputs, entries: await fileEntries(path.join(bundle, 'outputs')) };
    validateBundle(manifest, manifest.entries, identity);
    await json(path.join(bundle, 'manifest.json'), manifest);
    bundles.push(digest(JSON.stringify(manifest)));
  }
  await assertSourceDigest(root, identity);
  const preparation = { schema: 1, identity, planDigest: plan.digest, bundles, inventory: plan, timings };
  await json(path.join(directory, 'preparation.json'), preparation);
  console.log(JSON.stringify({ prepared: identity, obligations: plan.obligations.length, shardSizes: plan.shards.map(items => items.length), timings }));
  return preparation;
}

/** Reject incomplete or foreign bundles before copying outputs or dispatching any test. */
export async function restoreBundle(root, bundle, identity, plan, shard) {
  await assertSourceDigest(root, identity);
  const manifest = JSON.parse(await readFile(path.join(bundle, 'manifest.json'), 'utf8'));
  const entries = await fileEntries(path.join(bundle, 'outputs'));
  validateBundle(manifest, entries, identity);
  const outputs = outputsForShard(plan, shard);
  if (manifest.shard !== shard || manifest.planDigest !== plan.digest || JSON.stringify(manifest.outputs) !== JSON.stringify(outputs)) throw new Error('Bundle identity/plan/shard mismatch');
  for (const entry of entries) {
    if (!outputs.some(output => entry.path.startsWith(`${output}/`))) throw new Error(`Unexpected generated entries: ${entry.path}`);
  }
  for (const output of outputs) {
    if (!entries.some(entry => entry.path.startsWith(`${output}/`))) throw new Error(`Missing generated entries: ${output}`);
  }
  for (const item of plan.obligations.filter(item => item.kind === 'jest' && plan.shards[shard - 1].includes(item.id))) {
    if (!entries.some(entry => entry.path === item.file)) throw new Error(`Missing generated entries: ${item.file}`);
  }
  await assertSourceDigest(root, identity);
  for (const output of outputs) {
    await rm(path.join(root, output), { recursive: true, force: true });
    await mkdir(path.dirname(path.join(root, output)), { recursive: true });
    await cp(path.join(bundle, 'outputs', output), path.join(root, output), { recursive: true });
  }
  await assertSourceDigest(root, identity);
  return digest(JSON.stringify(manifest));
}

/** Each consumer is serial, with one Jest invocation per ordinary config partition. */
export async function executeShard(root, identity, plan, shard, bundle) {
  shard = shardNumber(shard);
  const planned = plan.shards[shard - 1];
  const executed = [];
  const timings = [];
  const receipt = { schema: 1, identity, shard, planDigest: plan.digest, planned, executed, timings, status: 'failure' };
  const receiptPath = path.join(root, '.pr-ci', `receipt-${shard}.json`);
  await rm(receiptPath, { force: true });
  try {
    await assertSourceDigest(root, identity);
    receipt.bundleDigest = await restoreBundle(root, bundle, identity, plan, shard);
    const obligations = plan.obligations.filter(item => planned.includes(item.id));
    const finishedGroups = new Set();
    for (const item of obligations) {
      if (item.kind === 'jest') {
        if (finishedGroups.has(item.group)) continue;
        finishedGroups.add(item.group);
        const group = obligations.filter(candidate => candidate.kind === 'jest' && candidate.group === item.group);
        if (item.group === 'experiments/exp-3/jest.config.mjs') {
          // EXP-3's existing command gate qualifies SQLite capability first,
          // then publication, keeping both in one serial consumer.
          group.sort((a, b) => Number(b.file.includes('sqlite-capability')) - Number(a.file.includes('sqlite-capability')));
          for (const suite of group) await measured(timings, suite.id, () => command(root, 'node', ['--experimental-vm-modules', 'node_modules/jest/bin/jest.js', '--config', path.join(root, item.group), '--runInBand', '--runTestsByPath', path.join(root, suite.file)], item.cwd));
        } else {
          await measured(timings, item.group, () => command(root, 'node', ['--experimental-vm-modules', 'node_modules/jest/bin/jest.js', '--config', path.join(root, item.group), '--runInBand', '--runTestsByPath', ...group.map(suite => path.join(root, suite.file))], item.cwd));
        }
        executed.push(...group.map(suite => suite.id));
      } else {
        await measured(timings, item.id, () => item.kind === 'shell'
          ? command(root, 'sh', ['-c', item.script], item.cwd)
          : command(root, 'node', item.args, item.cwd, { ...process.env, GAP_HUNT_REUSE_BUILD: '1' }));
        executed.push(item.id);
      }
    }
    // Execution order may group a config's files, but the receipt uses the
    // canonical plan order and never invents an unexecuted obligation.
    receipt.executed = planned.filter(id => executed.includes(id));
    if (new Set(executed).size !== planned.length || executed.length !== planned.length) throw new Error('Partial or duplicate executed inventory');
    await assertSourceDigest(root, identity);
    receipt.status = 'success';
    return receipt;
  } finally { await json(receiptPath, receipt); }
}

/** Read exactly four current-attempt receipts and the single successful preparation. */
export async function aggregate(root, identity, plan, environment = process.env) {
  await assertSourceDigest(root, identity);
  const directory = path.join(root, '.pr-ci');
  const preparation = JSON.parse(await readFile(path.join(directory, 'preparation.json'), 'utf8'));
  if (preparation.schema !== 1 || preparation.planDigest !== plan.digest || preparation.bundles.length !== 4) throw new Error('Invalid preparation inventory');
  const receiptDirectory = path.join(directory, 'receipts');
  const names = await readdir(receiptDirectory);
  if (names.length !== 4 || names.some(name => !/^receipt-[1-4]\.json$/u.test(name))) throw new Error('Missing or unexpected receipt artifacts');
  const receipts = await Promise.all(names.sort().map(async name => JSON.parse(await readFile(path.join(receiptDirectory, name), 'utf8'))));
  validateAggregate(plan.shards, identity, environment.PR_PREPARE_RESULT, Array(4).fill(environment.PR_SHARDS_RESULT), receipts, preparation);
  await assertSourceDigest(root, identity);
  await json(path.join(directory, 'aggregate.json'), { schema: 1, identity, planDigest: plan.digest, status: 'success', receipts });
  console.log(`Complete PR test graph qualified: ${plan.obligations.length} obligations across four shards.`);
}

/** Direct invocation has a deliberately small command surface; unknown operations fail. */
export async function main(args, root = fileURLToPath(new URL('../', import.meta.url))) {
  const [mode, value, bundle] = args;
  if (!['plan', 'prepare', 'shard', 'aggregate'].includes(mode)) throw new Error('Expected plan, prepare, shard or aggregate');
  const shard = mode === 'shard' ? shardNumber(value) : undefined;
  if ((mode === 'shard' && (args.length !== 3 || !bundle)) || (mode !== 'shard' && args.length !== 1)) throw new Error('Invalid PR CI command arguments');
  if (mode === 'plan') { console.log(JSON.stringify(await planRepository(root), null, 2)); return; }
  const identity = await workflowIdentity(root);
  const plan = await planRepository(root);
  await assertSourceDigest(root, identity);
  if (mode === 'prepare') await prepare(root, identity, plan);
  if (mode === 'shard') await executeShard(root, identity, plan, shard, path.resolve(root, bundle));
  if (mode === 'aggregate') await aggregate(root, identity, plan);
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  main(process.argv.slice(2)).catch(error => { console.error(error.message); process.exitCode = 1; });
}
