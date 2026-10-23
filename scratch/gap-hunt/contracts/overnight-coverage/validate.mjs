/** Checks the audit's disjoint counting unit and recorded runs; does not execute product tests. */
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
const read = async (name) => JSON.parse(await readFile(new URL(name, import.meta.url), 'utf8'));
const ledger = await read('coverage.json');
const categories = ['executed_passing', 'divergent_filed', 'missing_surface_target', 'insufficient_proof_unexamined'];
const counts = Object.fromEntries(categories.map((key) => [key, 0]));
const ids = new Set();
for (const outcome of ledger.outcomes) {
  assert(!ids.has(outcome.id), `Duplicate outcome ${outcome.id}`);
  ids.add(outcome.id);
  assert(categories.includes(outcome.classification), outcome.classification);
  counts[outcome.classification] += 1;
}
assert.equal(ids.size, 74);
assert.deepEqual(counts, ledger.counts);
assert.equal(Object.values(counts).reduce((a, b) => a + b, 0), ledger.total);
assert.equal(Object.values(ledger.passingEvidenceCohorts).reduce((a, b) => a + b, 0), counts.executed_passing);
for (const [name, passed, skipped] of [['provenance', 36, 0], ['migration', 1, 37], ['pass-through', 1, 46]]) {
  const result = await read(`${name}-results.json`);
  assert.deepEqual([result.numPassedTests, result.numFailedTests, result.numPendingTests, result.numRuntimeErrorTestSuites], [passed, 0, skipped, 0]);
}
assert((await read('commands.json')).every((command) => command.exitCode === 0));
assert.equal((await read('current-check-metadata.json')).gitStatusAfterRun, '');
console.log(JSON.stringify({ unit: 'finite semantic outcome in the explicitly bounded audit cohort', total: ledger.total, counts, freshCurrentChecks: { passed: 38, failed: 0, skipped: 83, runtimeErrorSuites: 0 } }, null, 2));
