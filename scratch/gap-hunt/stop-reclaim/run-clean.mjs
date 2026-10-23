/** Replay the finite reclaim proof from the committed evidence tree, with no source overlays. */
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const pin = 'f43c5872987573d9b98a19f41c324b4d9336894c';
const home = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');
const allowed = (name) => name === 'packages/supervision/test/stop.test.ts'
  || name.startsWith('scratch/gap-hunt/stop-reclaim/');
const output = join(home, 'scratch/gap-hunt/stop-reclaim/runs', new Date().toISOString().replaceAll(':', '-'));
mkdirSync(output, { recursive: true });
const commands = [];
/** Run a bounded command, preserving its exact output and status. */
function command(cwd, name, program, args, expected = 0) {
  const result = spawnSync(program, args, { cwd, encoding: 'utf8', timeout: 180_000 });
  writeFileSync(join(output, `${name}.log`), `${result.stdout ?? ''}${result.stderr ?? ''}`);
  commands.push({ name, program, args, status: result.status, error: result.error?.message });
  assert.equal(result.status, expected, `${name}: ${result.error?.message ?? 'see command log'}`);
  return result.stdout.trim();
}
/** Verify actual Jest outcomes, including each selected named case. */
function counts(path, passed, failed, skipped) {
  const result = JSON.parse(readFileSync(path, 'utf8'));
  assert.equal(result.numPassedTests, passed);
  assert.equal(result.numFailedTests, failed);
  assert.equal(result.numPendingTests, skipped);
  assert.equal(result.numRuntimeErrorTestSuites, 0);
  return result.testResults.flatMap((suite) => suite.assertionResults)
    .filter((test) => test.title.includes('queued priority lane reclaim'))
    .map(({ title, status, failureMessages }) => ({ title, status, failureMessages }));
}
const head = command(home, 'head', 'git', ['rev-parse', 'HEAD']);
const changed = command(home, 'committed-paths', 'git', ['diff', '--name-only', pin, head]).split('\n').filter(Boolean);
assert.ok(changed.length > 0 && changed.every(allowed), 'Evidence commit changes only the named test and evidence directory');
const parent = mkdtempSync(join(tmpdir(), 'gap-hunt-stop-reclaim-clean-'));
const checkout = join(parent, 'checkout');
let added = false;
let proof;
try {
  command(home, 'checkout', 'git', ['worktree', 'add', '--detach', checkout, head]);
  added = true;
  assert.equal(command(checkout, 'initial-status', 'git', ['status', '--porcelain']), '');
  const testText = readFileSync(join(checkout, 'packages/supervision/test/stop.test.ts'), 'utf8');
  assert.ok(testText.includes('a queued priority lane reclaim settles with hard stop %s'));
  // A published command must consume its committed test directly, never a copied local patch.
  command(checkout, 'install', 'npm', ['ci', '--no-audit', '--no-fund']);
  command(checkout, 'build', 'npm', ['run', 'build:packages']);
  const pkg = join(checkout, 'packages/supervision');
  command(pkg, 'checks', 'npm', ['run', 'check']);
  const jest = ['--testPathPatterns', 'stop.test', '--json'];
  const positive = join(output, 'positive.json');
  command(pkg, 'positive', 'npm', ['run', 'test:unit', '--', ...jest, '--testNamePattern', 'queued priority lane reclaim', '--outputFile', positive]);
  const positives = counts(positive, 2, 0, 62);
  assert.equal(positives.length, 2);
  assert.ok(positives.every((test) => test.status === 'passed'));
  const emitted = join(pkg, '.test-build/src/execution.js');
  const original = readFileSync(emitted);
  const source = join(pkg, 'src/execution.ts');
  const sourceHash = createHash('sha256').update(readFileSync(source)).digest('hex');
  const anchor = 'run.lanes.acquire(run.hard.signal, { priority: true })';
  assert.equal(original.toString().split(anchor).length, 2);
  const negative = join(output, 'negative.json');
  let negatives;
  try {
    writeFileSync(emitted, original.toString().replace(anchor, 'run.lanes.acquire(createAbortSource().signal, { priority: true })'));
    command(pkg, 'negative', 'node', ['--experimental-vm-modules', '../../node_modules/jest/bin/jest.js', '--config', 'jest.config.mjs', '--runInBand', ...jest, '--testNamePattern', 'queued priority lane reclaim', '--outputFile', negative], 1);
    negatives = counts(negative, 1, 1, 62);
    assert.equal(negatives.find((test) => test.title.includes('false'))?.status, 'passed');
    const failed = negatives.find((test) => test.title.includes('true'));
    assert.equal(failed?.status, 'failed');
    assert.ok(failed.failureMessages.join('\n').includes('expect(resumed).toEqual([])'));
    assert.ok(failed.failureMessages.join('\n').includes('"sleeper"'));
  } finally {
    writeFileSync(emitted, original);
    assert.deepEqual(readFileSync(emitted), original, 'emitted execution restored byte-for-byte');
    assert.equal(createHash('sha256').update(readFileSync(source)).digest('hex'), sourceHash, 'production source unchanged');
  }
  const restored = join(output, 'restored.json');
  command(pkg, 'restored', 'npm', ['run', 'test:unit', '--', ...jest, '--outputFile', restored]);
  counts(restored, 64, 0, 0);
  assert.equal(command(checkout, 'final-status', 'git', ['status', '--porcelain']), '');
  proof = { pin, head, changed, positives, negatives, sourceHash, restored: { passed: 64, failed: 0, skipped: 0 }, scope: 'Supervision port; fake timer; three members; window one; no persisted History claim' };
} finally {
  writeFileSync(join(output, 'commands.json'), JSON.stringify(commands, null, 2) + '\n');
  if (proof !== undefined) writeFileSync(join(output, 'proof.json'), JSON.stringify(proof, null, 2) + '\n');
  if (added) command(home, 'remove-checkout', 'git', ['worktree', 'remove', '--force', checkout]);
  rmSync(parent, { recursive: true, force: true });
}
console.log(`Proof passed. Evidence: ${output}`);
