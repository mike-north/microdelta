/**
 * Verifies the checked-in example as a user runs it: the compiled CLI over
 * the installed workspace packages, each command a separate Node process over
 * one store directory. Expected sentences and statistics are written by hand
 * from the fixture data and the README's attribution rules:
 *
 * - Ada: PRs 101 and 102 merged and 103 open were created in the window (98
 *   predates it); five reviews were submitted in the window (rv-ada-0 predates
 *   it, rv-ada-6 is pending).
 * - Ben: PR 201 merged and 202 open (204 was created exactly at the exclusive
 *   window end); three reviews in the window (rv-ben-4 follows it).
 *
 * This checks the example's documented behavior. It is not the independent
 * process kill-point and lost-acknowledgment acceptance harness, which is
 * separate work.
 *
 * @see ../README.md
 * @see ../../../docs/plans/m3-contribution-analysis.md (Concrete fixture decisions)
 */
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const main = fileURLToPath(new URL('../dist/main.js', import.meta.url));

const expectedText = [
  'Contribution report for acme/widget, 2026-01-01 to 2026-04-01 (exclusive)',
  'Selected contributors: person:ada, person:ben (not complete repository coverage)',
  '- person:ada: Ada authored 3 pull requests, 2 of which were merged, and submitted 5 reviews.',
  '- person:ben: Ben authored 2 pull requests, 1 of which was merged, and submitted 3 reviews.',
].join('\n');

/** Run one CLI command as its own process and parse its JSON output. */
function cli(...args) {
  const result = spawnSync(process.execPath, [main, ...args, '--json'], { encoding: 'utf8' });
  assert.equal(result.status, 0, `${args.join(' ')} failed: ${result.stderr}`);
  return JSON.parse(result.stdout);
}

test('the example reports, restarts without summary bodies, recovers and checks', () => {
  const store = mkdtempSync(path.join(tmpdir(), 'microdelta-example-'));
  try {
    const cold = cli('run', '--store', store);
    assert.equal(cold.text, expectedText);
    assert.deepEqual(cold.report.contributors.map(entry => [entry.key, entry.authored, entry.merged, entry.reviews]), [
      ['person:ada', 3, 2, 5],
      ['person:ben', 2, 1, 3],
    ]);
    assert.deepEqual(cold.executions, { 'person:ada/activity': 1, 'person:ada/summary': 1, 'person:ben/activity': 1, 'person:ben/summary': 1 });
    assert.deepEqual(cold.ordinary, { report: 1 });
    assert.equal(cold.outcomes['person:ada'].kind, 'published');
    assert.equal(cold.outcomes['person:ben'].kind, 'published');

    // Recovery of the cold run's saved keys returns its exact committed summaries without running author code.
    const recovered = cli('recover', '--store', store);
    assert.deepEqual(recovered.recovered, {
      'person:ada': { kind: 'recovered', reference: cold.outcomes['person:ada'].reference },
      'person:ben': { kind: 'recovered', reference: cold.outcomes['person:ben'].reference },
    });
    assert.deepEqual([recovered.executions, recovered.finality, recovered.ordinary], [{}, {}, {}]);

    // A new process resolving in reverse order reuses both exact summaries; only finality and the report run.
    const restarted = cli('run', '--store', store, '--reverse');
    assert.deepEqual(restarted.order, ['person:ben', 'person:ada']);
    assert.equal(restarted.text, expectedText);
    assert.deepEqual(restarted.outcomes['person:ada'], { kind: 'reused', basis: 'validated', reference: cold.outcomes['person:ada'].reference });
    assert.deepEqual(restarted.outcomes['person:ben'], { kind: 'reused', basis: 'validated', reference: cold.outcomes['person:ben'].reference });
    assert.deepEqual(restarted.executions, {});
    assert.deepEqual(restarted.finality, { 'person:ada/activity': 1, 'person:ben/activity': 1 });
    assert.deepEqual(restarted.ordinary, { report: 1 });

    // The restarted run reused rather than executed, so its saved keys identify no admitted execution.
    assert.deepEqual(cli('recover', '--store', store).recovered, { 'person:ada': { kind: 'absent' }, 'person:ben': { kind: 'absent' } });

    const checked = cli('check', '--store', store);
    assert.deepEqual(checked.checked, {
      'person:ada': { kind: 'reusable', reference: cold.outcomes['person:ada'].reference },
      'person:ben': { kind: 'reusable', reference: cold.outcomes['person:ben'].reference },
    });
    assert.deepEqual(checked.executions, {});
  } finally {
    rmSync(store, { recursive: true, force: true });
  }
});

test('the example rejects an incomplete command line with a usage message', () => {
  const result = spawnSync(process.execPath, [main, 'run'], { encoding: 'utf8' });
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /usage: main\.js run\|recover\|check --store DIR/u);
});
