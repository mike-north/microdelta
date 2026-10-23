/** Reproduce PR 180's finite issue outcomes from committed tests in a fresh checkout. */
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const pin = '77715afc573341e3d9d4bd84dafbc6ab7e168f7e';
const root = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');
const records = JSON.parse(readFileSync(new URL('./provenance.json', import.meta.url), 'utf8'));
const allowed = new Set(records.map((record) => record.path));
const output = join(root, 'scratch/gap-hunt/review-180/runs', new Date().toISOString().replaceAll(':', '-'));
mkdirSync(output, { recursive: true });
const receipts = [];
/** Preserve every command status/output; an intentional negative has its own expected status. */
function run(cwd, name, program, args, expected = 0) {
  const result = spawnSync(program, args, { cwd, encoding: 'utf8', timeout: 180_000 });
  writeFileSync(join(output, `${name}.log`), `${result.stdout ?? ''}${result.stderr ?? ''}`);
  receipts.push({ name, program, args, status: result.status, error: result.error?.message });
  assert.equal(result.status, expected, name);
  return result.stdout.trim();
}
/** A green process cannot conceal an empty, skipped, or runtime-broken test selection. */
function counts(name, pass, fail, skip) {
  const data = JSON.parse(readFileSync(join(output, `${name}.json`), 'utf8'));
  assert.deepEqual([data.numPassedTests, data.numFailedTests, data.numPendingTests, data.numRuntimeErrorTestSuites], [pass, fail, skip, 0]);
  return data.testResults.flatMap((suite) => suite.assertionResults);
}
const head = run(root, 'head', 'git', ['rev-parse', 'HEAD']);
const changed = run(root, 'committed-paths', 'git', ['diff', '--name-only', pin, head]).split('\n').filter(Boolean);
assert.ok(changed.length > 0 && changed.every((path) => allowed.has(path) || path.startsWith('scratch/gap-hunt/review-180/')));
const parent = mkdtempSync(join(tmpdir(), 'gap-hunt-review-180-clean-'));
const checkout = join(parent, 'checkout');
let added = false;
let proof;
try {
  run(root, 'checkout', 'git', ['worktree', 'add', '--detach', checkout, head]); added = true;
  assert.equal(run(checkout, 'initial-status', 'git', ['status', '--porcelain']), '');
  for (const record of records) {
    assert.equal(createHash('sha256').update(readFileSync(join(checkout, record.path))).digest('hex'), record.sha256, record.path);
  }
  run(checkout, 'install', 'npm', ['ci', '--no-audit', '--no-fund']);
  run(checkout, 'build', 'npm', ['run', 'build:packages']);
  for (const pkg of ['value', 'tracking', 'core']) run(join(checkout, 'packages', pkg), `${pkg}-check`, 'npm', ['run', 'check']);
  /** Compile a package's tests, then select only named existing or reproduced outcomes. */
  const unit = (pkg, name, args) => run(join(checkout, 'packages', pkg), name, 'npm', ['run', 'test:unit', '--', ...args, '--json', '--outputFile', join(output, `${name}.json`)]);
  const original = '.test-build/test/gap-hunt-contracts-intrinsic-presence.test.js';
  const supplement = '.test-build/test/gap-hunt-review-171-invalidation.test.js';
  unit('tracking', 'original-and-guard', ['--runTestsByPath', original, supplement]); counts('original-and-guard', 13, 0, 0);
  unit('core', 'durable-guard', ['--runTestsByPath', '.test-build/test/gap-hunt-contracts-container-guard.test.js']); counts('durable-guard', 5, 0, 0);
  unit('value', 'value-acceptance', ['--runTestsByPath', '.test-build/test/value.test.js', '--testNamePattern', 'presence on an ordinary record|own-to-inherited|presence respects supported']); counts('value-acceptance', 6, 0, 31);
  unit('tracking', 'tracking-acceptance', ['--runTestsByPath', '.test-build/test/observer.test.js', '--testNamePattern', 'intrinsic-name presence']); counts('tracking-acceptance', 1, 0, 47);
  const emitted = join(checkout, 'packages/value/dist/src/value.js');
  const originalBytes = readFileSync(emitted);
  const source = join(checkout, 'packages/value/src/value.ts');
  const sourceHash = createHash('sha256').update(readFileSync(source)).digest('hex');
  const anchor = "    if (operation === 'own' || operation === 'membership') {\n        return { operation, address, fact: presenceValidated(parent, last.key, targetPath, operation) };\n    }\n    const selected = lookupValidated(parent, last.key, targetPath);\n    return { operation, address, fact: selected.value };";
  const oldLookup = "    const selected = lookupValidated(parent, last.key, targetPath);\n    const fact = operation === 'value' ? selected.value : operation === 'own' ? selected.own : selected.present;\n    return { operation, address, fact };";
  assert.equal(originalBytes.toString().split(anchor).length, 2);
  try {
    writeFileSync(emitted, originalBytes.toString().replace(anchor, oldLookup));
    run(checkout, 'negative', 'node', ['--experimental-vm-modules', 'node_modules/jest/bin/jest.js', '--config', 'packages/tracking/jest.config.mjs', '--runInBand', '--runTestsByPath', `packages/tracking/${original}`, '--json', '--outputFile', join(output, 'negative.json')], 1);
    const failed = counts('negative', 2, 9, 0).filter((test) => test.status === 'failed');
    assert.equal(failed.length, 9);
    assert.ok(failed.every((test) => test.failureMessages.join('\n').includes('intrinsic inherited data')));
  } finally {
    writeFileSync(emitted, originalBytes);
    assert.deepEqual(readFileSync(emitted), originalBytes);
    assert.equal(createHash('sha256').update(readFileSync(source)).digest('hex'), sourceHash);
  }
  unit('tracking', 'restored', ['--runTestsByPath', original, supplement]); counts('restored', 13, 0, 0);
  assert.equal(run(checkout, 'final-status', 'git', ['status', '--porcelain']), '');
  proof = { pin, head, changed, provenance: records, sourceHash, counts: { original162: 11, semantic155: 2, durable155: 5, acceptance162: 7, negative: { passed: 2, failed: 9 }, restored: 13 }, runtimeErrorSuites: 0, scope: 'macOS/Node; bounded Value/Tracking current-fact and original SQLite process fixture; no broad repository or Linux claim' };
} finally {
  if (proof !== undefined) writeFileSync(join(output, 'proof.json'), JSON.stringify(proof, null, 2) + '\n');
  if (added) run(root, 'remove-checkout', 'git', ['worktree', 'remove', '--force', checkout]);
  writeFileSync(join(output, 'commands.json'), JSON.stringify(receipts, null, 2) + '\n');
  rmSync(parent, { recursive: true, force: true });
}
console.log(`Proof passed. Evidence: ${output}`);
