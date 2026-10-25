/**
 * The issue-250 boundary probe runs a strict generated-facade consumer in
 * separate Node processes. Its stale-detail assertion is intentionally a
 * recorded unsupported observation, never runtime acceptance.
 */
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const entry = fileURLToPath(new URL('../.test-build/test/process-entry.js', import.meta.url));
const fixtureFile = fileURLToPath(new URL('../data/acme-widget.json', import.meta.url));
const ada = 'person:ada';
const ben = 'person:ben';
const cy = 'person:cy';

/** Run one resolution in its own process against the shared durable store. */
function runFixture(fixturePath, store) {
  const result = spawnSync(process.execPath, [entry, store], {
    encoding: 'utf8',
    env: { ...process.env, MICRODELTA_CONTRIBUTION_REPORT_FIXTURE: fixturePath },
  });
  assert.equal(result.status, 0, `probe failed: ${result.stderr}`);
  return JSON.parse(result.stdout);
}

/** A fresh store directory scoped to one test. */
function withStore(body) {
  const directory = mkdtempSync(path.join(tmpdir(), 'microdelta-exp9-'));
  try {
    body(path.join(directory, 'history.sqlite'));
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
}

test('generated facade composes complete IDs, separate details, cold/restart and changed-ID correspondence', () => {
  withStore((store) => {
    const original = JSON.parse(readFileSync(fixtureFile, 'utf8'));
    const cold = runFixture(fixtureFile, store);
    assert.equal(cold.fold.status, 'succeeded');
    assert.deepEqual(cold.searches, { [ada]: [101, 102, 103], [ben]: [201, 202], [cy]: [301] });
    assert.deepEqual(Object.fromEntries(Object.entries(cold.summaries).map(([key, summary]) => [key, summary.score])), { [ada]: 5, [ben]: 3, [cy]: 2 });
    assert.deepEqual(cold.executions, { contributors: 1, search: 3, pullRequestDetail: 6, assessor: 6, summary: 3, report: 1 });
    assert.equal(cold.references.details.length, 6);

    const restarted = runFixture(fixtureFile, store);
    assert.deepEqual(restarted.executions, {});
    assert.deepEqual(restarted.references, cold.references);
    assert.deepEqual(restarted.summaries, cold.summaries);

    const changedPath = path.join(path.dirname(store), 'changed-ids.json');
    writeFileSync(changedPath, JSON.stringify({ ...original, revision: original.revision + 1, pullRequests: original.pullRequests.filter((pull) => pull.number !== 103) }));
    const changed = runFixture(changedPath, store);
    assert.deepEqual(changed.summaries[ben], cold.summaries[ben]);
    assert.deepEqual(changed.summaries[cy], cold.summaries[cy]);
    assert.equal(changed.summaries[ada].score, 4);
    assert.equal(changed.references.details.length, 5);
    assert.ok(changed.references.details.every((reference) => cold.references.details.includes(reference)));
  });
});

test('known unsupported behavior: same-ID changed detail keeps stale result; selected-search failure remains a failure', () => {
  withStore((store) => {
    const original = JSON.parse(readFileSync(fixtureFile, 'utf8'));
    const cold = runFixture(fixtureFile, store);

    const changedPath = path.join(path.dirname(store), 'changed-detail.json');
    writeFileSync(changedPath, JSON.stringify({
      ...original,
      revision: original.revision + 1,
      pullRequests: original.pullRequests.map((pull) => pull.number === 101 ? { ...pull, merged: false } : pull),
    }));
    const stale = runFixture(changedPath, store);
    assert.deepEqual(stale.executions, { contributors: 1, search: 3 });
    assert.equal(stale.summaries[ada].score, 5);
    assert.equal(stale.references.members[ada], cold.references.members[ada]);

    // Preserve the exact intended acceptance assertion as a counterexample.
    const intendedFreshnessAssertion = () => assert.equal(stale.summaries[ada].score, 4);
    assert.throws(intendedFreshnessAssertion, /4/u);

    const emptyPath = path.join(path.dirname(store), 'valid-empty.json');
    writeFileSync(emptyPath, JSON.stringify({ ...original, revision: original.revision + 2, pullRequests: [], reviews: [] }));
    const empty = runFixture(emptyPath, path.join(path.dirname(store), 'empty-history.sqlite'));
    assert.deepEqual(empty.discovery, []);
    assert.equal(empty.fold.status, 'succeeded');
    assert.deepEqual(empty.report.required, []);

    const failedPath = path.join(path.dirname(store), 'failed-ada-search.json');
    writeFileSync(failedPath, JSON.stringify({ ...original, revision: original.revision + 3, searchFailures: [ada] }));
    const failed = runFixture(failedPath, path.join(path.dirname(store), 'failed-history.sqlite'));
    assert.deepEqual(failed.discovery, [ada, ben, cy]);
    assert.equal(failed.members[ada].status, 'failed');
    assert.equal(failed.summaries[ada], undefined);
    assert.equal(failed.fold.status, 'failed');
    assert.equal(failed.report, null);
  });
});
