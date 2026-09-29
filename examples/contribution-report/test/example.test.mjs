/**
 * Verifies the checked-in example as a user runs it: the compiled CLI over
 * the installed workspace packages, each command a separate Node process over
 * one store directory. Every expected value below is written by hand from
 * `data/acme-widget.json` and the README's attribution, discovery and rubric
 * rules, never captured from program output.
 *
 * Discovery over the UTC window [2026-01-01, 2026-04-01): a contributor is
 * discovered when they authored a PR created in the window or submitted a
 * non-pending review in the window.
 *
 * - Ada authored 101 (merged), 102 (merged) and 103 (open) in the window; 98
 *   predates it. She submitted rv-ada-1..5 in the window; rv-ada-0 predates
 *   it and rv-ada-6 is pending. Authored 3, merged 2, reviews 5.
 * - Ben authored 201 (merged) and 202 (open); 204 was created exactly at the
 *   exclusive end. He submitted rv-ben-1..3; rv-ben-4 follows the window.
 *   Authored 2, merged 1, reviews 3.
 * - Cy authored 301 (merged) and submitted rv-cy-1. Authored 1, merged 1,
 *   reviews 1.
 * - Dot is not discovered: PR 99 predates the window, rv-dot-1 is pending and
 *   rv-dot-2 follows the window.
 *
 * Rubric A scores a merged PR 2 and an unmerged PR 1: Ada 2 + 2 + 1 = 5, Ben
 * 2 + 1 = 3, Cy 2. Rubric B changes only the explanation text, so every score
 * is equal. Rubric C also scores a merged PR labelled `bug` 3; only Ben's 201
 * carries that label in the window, so Ben becomes 3 + 1 = 4 and Ada and Cy
 * keep 5 and 2. Six PRs are assessed: 101, 102, 103, 201, 202 and 301.
 *
 * With `minimumAuthored` 2, Cy (one authored PR) is skipped by the gate.
 * Designated identity keys members `person:ada`, `person:ben`, `person:cy`;
 * the custom key uses the upstream profile id `gh:1001`, `gh:2002`, `gh:3003`.
 *
 * This checks the example's documented behavior. The independent-process
 * kill-point acceptance harness is separate work.
 *
 * @see ../README.md
 * @see ../../../docs/plans/m4-composition.md (Concrete fixture decisions; Planned evidence names)
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

const ada = 'person:ada';
const ben = 'person:ben';
const cy = 'person:cy';
const designatedKeys = [ada, ben, cy];

const sentences = {
  ada: 'Ada authored 3 pull requests, 2 of which were merged, and submitted 5 reviews.',
  ben: 'Ben authored 2 pull requests, 1 of which was merged, and submitted 3 reviews.',
  cy: 'Cy authored 1 pull request, 1 of which was merged, and submitted 1 review.',
};

/** Hand-derived member statistics and rubric A scores. */
const expectedSummaries = {
  ada: { name: 'Ada', authored: 3, merged: 2, reviews: 5, score: 5, sentence: sentences.ada },
  ben: { name: 'Ben', authored: 2, merged: 1, reviews: 3, score: 3, sentence: sentences.ben },
  cy: { name: 'Cy', authored: 1, merged: 1, reviews: 1, score: 2, sentence: sentences.cy },
};

const header = 'Contribution report for acme/widget, 2026-01-01 to 2026-04-01 (exclusive)';

/** The complete report text at threshold 1 under rubric A with designated keys. */
const coldText = [
  header,
  'Required: contributors with at least 1 authored pull request in the window',
  `- person:ada (score 5): ${sentences.ada}`,
  `- person:ben (score 3): ${sentences.ben}`,
  `- person:cy (score 2): ${sentences.cy}`,
  'Coverage: 3 required, 0 skipped; discovery closed',
].join('\n');

/** Every body a cold run executes once: discovery, three activities, three summaries, six assessments and the report. */
const coldExecutions = {
  contributors: 1,
  'person:ada/activity': 1,
  'person:ada/summary': 1,
  'person:ben/activity': 1,
  'person:ben/summary': 1,
  'person:cy/activity': 1,
  'person:cy/summary': 1,
  assessor: 6,
  report: 1,
};

/** Run one CLI command as its own process and parse its JSON output. */
function cli(...args) {
  const result = spawnSync(process.execPath, [main, ...args, '--json'], { encoding: 'utf8' });
  assert.equal(result.status, 0, `${args.join(' ')} failed: ${result.stderr}`);
  return JSON.parse(result.stdout);
}

/** Run one CLI command expecting a nonzero exit, returning its stderr. */
function failing(...args) {
  const result = spawnSync(process.execPath, [main, ...args], { encoding: 'utf8' });
  assert.notEqual(result.status, 0, `${args.join(' ')} unexpectedly succeeded: ${result.stdout}`);
  return result.stderr;
}

/** A fresh store directory, removed after `body`. */
function withStore(body) {
  const store = mkdtempSync(path.join(tmpdir(), 'microdelta-example-'));
  try {
    body(store);
  } finally {
    rmSync(store, { recursive: true, force: true });
  }
}

/** The exact references of every succeeded member of one run output. */
function references(output) {
  return Object.fromEntries(Object.entries(output.members).map(([key, member]) => [key, member.reference]));
}

/** Assert a cold run: every body once and the hand-derived report. */
function assertCold(cold) {
  assert.equal(cold.text, coldText);
  assert.deepEqual(cold.discovery, { kind: 'keyed', completion: 'complete', keys: designatedKeys });
  assert.deepEqual(cold.summaries, { [ada]: expectedSummaries.ada, [ben]: expectedSummaries.ben, [cy]: expectedSummaries.cy });
  for (const key of designatedKeys) {
    assert.equal(cold.members[key].status, 'succeeded');
    assert.equal(cold.members[key].kind, 'published');
    assert.equal(typeof cold.members[key].reference, 'string');
  }
  assert.equal(cold.fold.status, 'succeeded');
  assert.equal(cold.fold.kind, 'published');
  assert.deepEqual(cold.fold.coverage, { required: designatedKeys, skipped: [], closed: true });
  assert.deepEqual(cold.report, {
    repository: 'acme/widget',
    window: { start: '2026-01-01', end: '2026-04-01' },
    minimumAuthored: 1,
    required: [
      { key: ada, score: 5, sentence: sentences.ada },
      { key: ben, score: 3, sentence: sentences.ben },
      { key: cy, score: 2, sentence: sentences.cy },
    ],
    excluded: [],
  });
  assert.deepEqual(cold.executions, coldExecutions);
}

test('keyed-cold-and-restarted-report: cold, unchanged restart with zero member, assessment and report bodies, recover and check', () => {
  withStore((store) => {
    const cold = cli('run', '--store', store);
    assertCold(cold);
    const coldMembers = references(cold);

    // Recovery of the cold run's saved request key returns its exact committed report and member summaries without running author code.
    const recovered = cli('recover', '--store', store);
    assert.deepEqual(recovered.recovered, {
      report: { kind: 'recovered', reference: cold.fold.reference },
      members: Object.fromEntries(designatedKeys.map((key) => [key, { kind: 'recovered', reference: coldMembers[key] }])),
    });
    assert.deepEqual([recovered.executions, recovered.finality], [{}, {}]);

    // A new process registering everything in reverse executes no discovery, member, assessment or report body.
    const restarted = cli('run', '--store', store, '--reverse');
    assert.equal(restarted.text, coldText);
    assert.deepEqual(restarted.executions, {});
    // Discovery and each member's activity run their current finality policy once.
    assert.deepEqual(restarted.finality, { contributors: 1, 'person:ada/activity': 1, 'person:ben/activity': 1, 'person:cy/activity': 1 });
    for (const key of designatedKeys) {
      assert.deepEqual(restarted.members[key], { status: 'succeeded', kind: 'reused', reference: coldMembers[key] });
    }
    assert.deepEqual(restarted.fold, { status: 'succeeded', kind: 'reused', reference: cold.fold.reference, misses: [], coverage: { required: designatedKeys, skipped: [], closed: true } });
    assert.deepEqual(restarted.summaries, cold.summaries);

    // The restart executed no fold work, so its saved key identifies no admitted execution; members are listed only by a recovered report.
    assert.deepEqual(cli('recover', '--store', store).recovered, { report: { kind: 'absent' }, members: {} });

    const checked = cli('check', '--store', store);
    assert.equal(checked.checked.discovery.kind, 'reusable');
    assert.deepEqual(checked.checked.members, Object.fromEntries(designatedKeys.map((key) => [key, { kind: 'reusable', reference: coldMembers[key] }])));
    assert.deepEqual(checked.executions, {});
  });
});

test('nested-equal-output-cutoff then nested-changed-output: rubric B reruns assessments only; rubric C reruns Ben and the report', () => {
  withStore((store) => {
    const cold = cli('run', '--store', store);
    assertCold(cold);
    const coldMembers = references(cold);

    const rubricB = cli('run', '--store', store, '--rubric', 'B');
    assert.deepEqual(rubricB.executions, { assessor: 6 });
    for (const key of designatedKeys) {
      assert.deepEqual(rubricB.members[key], { status: 'succeeded', kind: 'reused', reference: coldMembers[key] });
    }
    assert.equal(rubricB.fold.kind, 'reused');
    assert.equal(rubricB.fold.reference, cold.fold.reference);
    assert.equal(rubricB.text, coldText);

    const rubricC = cli('run', '--store', store, '--rubric', 'C');
    assert.deepEqual(rubricC.executions, { assessor: 6, 'person:ben/summary': 1, report: 1 });
    assert.deepEqual(rubricC.members[ada], { status: 'succeeded', kind: 'reused', reference: coldMembers[ada] });
    assert.deepEqual(rubricC.members[cy], { status: 'succeeded', kind: 'reused', reference: coldMembers[cy] });
    assert.equal(rubricC.members[ben].kind, 'published');
    assert.notEqual(rubricC.members[ben].reference, coldMembers[ben]);
    assert.deepEqual(rubricC.summaries[ben], { ...expectedSummaries.ben, score: 4 });
    assert.equal(rubricC.fold.kind, 'published');
    assert.notEqual(rubricC.fold.reference, cold.fold.reference);
    assert.deepEqual(rubricC.report.required.map((entry) => [entry.key, entry.score]), [[ada, 5], [ben, 4], [cy, 2]]);
    assert.match(rubricC.text, /^- person:ben \(score 4\): Ben authored 2 pull requests/mu);
  });
});

test('tracked-gate-instances: threshold 2 skips Cy and reruns only the report; threshold 1 again reuses the cold report', () => {
  withStore((store) => {
    const cold = cli('run', '--store', store);
    assertCold(cold);
    const coldMembers = references(cold);

    const gated = cli('run', '--store', store, '--minimum-authored', '2');
    assert.deepEqual(gated.executions, { report: 1 });
    assert.deepEqual(gated.members[cy], { status: 'skipped' });
    assert.deepEqual(gated.members[ada], { status: 'succeeded', kind: 'reused', reference: coldMembers[ada] });
    assert.deepEqual(gated.members[ben], { status: 'succeeded', kind: 'reused', reference: coldMembers[ben] });
    assert.equal(gated.fold.kind, 'published');
    assert.deepEqual(gated.fold.coverage, { required: [ada, ben], skipped: [cy], closed: true });
    assert.deepEqual(gated.report.excluded, [cy]);
    assert.equal(gated.text, [
      header,
      'Required: contributors with at least 2 authored pull requests in the window',
      `- person:ada (score 5): ${sentences.ada}`,
      `- person:ben (score 3): ${sentences.ben}`,
      '- person:cy: excluded by the gate',
      'Coverage: 2 required, 1 skipped (person:cy); discovery closed',
    ].join('\n'));

    // Requiring Cy again restores the cold membership and threshold: Cy's and the report's cold results validate.
    const regated = cli('run', '--store', store, '--minimum-authored', '1');
    assert.deepEqual(regated.executions, {});
    assert.deepEqual(regated.members[cy], { status: 'succeeded', kind: 'reused', reference: coldMembers[cy] });
    assert.equal(regated.fold.kind, 'reused');
    assert.equal(regated.fold.reference, cold.fold.reference);
  });
});

test('strict-fold-readiness: open discovery leaves the report waiting; closing it again reuses the cold report', () => {
  withStore((store) => {
    const cold = cli('run', '--store', store);
    assertCold(cold);
    const coldMembers = references(cold);

    const open = cli('run', '--store', store, '--open-discovery');
    // Only discovery's check runs: its finality rejects a closed previous listing while the upstream reports it open.
    assert.deepEqual(open.executions, { contributors: 1 });
    assert.deepEqual(open.discovery, { kind: 'keyed', completion: 'open', keys: designatedKeys });
    for (const key of designatedKeys) {
      assert.deepEqual(open.members[key], { status: 'succeeded', kind: 'reused', reference: coldMembers[key] });
    }
    assert.deepEqual(open.fold, { status: 'waiting', pending: [], openDiscovery: true });
    assert.equal(open.report, null);
    assert.equal(open.text, 'Report waiting: discovery is still open; no member is pending');

    const closed = cli('run', '--store', store);
    assert.deepEqual(closed.executions, { contributors: 1 });
    assert.equal(closed.fold.kind, 'reused');
    assert.equal(closed.fold.reference, cold.fold.reference);
    assert.equal(closed.text, coldText);
  });
});

test('custom-key-correspondence: members keyed by upstream profile id correspond across a reordered restart', () => {
  withStore((store) => {
    const customKeys = ['gh:1001', 'gh:2002', 'gh:3003'];
    const cold = cli('run', '--store', store, '--key', 'id');
    assert.deepEqual(cold.discovery, { kind: 'keyed', completion: 'complete', keys: customKeys });
    assert.deepEqual(cold.summaries, { 'gh:1001': expectedSummaries.ada, 'gh:2002': expectedSummaries.ben, 'gh:3003': expectedSummaries.cy });
    assert.deepEqual(cold.fold.coverage, { required: customKeys, skipped: [], closed: true });
    assert.deepEqual(cold.report.required.map((entry) => [entry.key, entry.score]), [['gh:1001', 5], ['gh:2002', 3], ['gh:3003', 2]]);

    const restarted = cli('run', '--store', store, '--key', 'id', '--reverse');
    assert.deepEqual(restarted.executions, {});
    assert.deepEqual(references(restarted), references(cold));
    assert.equal(restarted.fold.reference, cold.fold.reference);
  });
});

test('the example rejects an incomplete command line or an unknown option value with a usage message', () => {
  const usage = /usage: main\.js run\|recover\|check --store DIR/u;
  assert.match(failing('run'), usage);
  withStore((store) => {
    assert.match(failing('run', '--store', store, '--rubric', 'D'), usage);
    assert.match(failing('run', '--store', store, '--minimum-authored', 'two'), usage);
    assert.match(failing('run', '--store', store, '--minimum-authored', '-1'), usage);
    assert.match(failing('run', '--store', store, '--key', 'name'), usage);
  });
});
