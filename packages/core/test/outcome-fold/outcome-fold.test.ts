/**
 * Outcome (tolerant) folds through the facade's real workspace path (issue
 * #120, RUN-010): Reuse Resolution resolves the consumed template step for
 * every current member, each independently, and settles each one's status;
 * the outcome fold then waits while discovery is open or any member is
 * unsettled, and otherwise is validated or executed over every member's
 * settled status, with framework coverage. Run Supervision reports its typed
 * outcome. Each session is a fresh composition over the same SQLite file, so
 * only durable History survives between sessions; the separate-process
 * evidence is `restart.test.ts`.
 *
 * Expected values are derived by hand from the fixture data (Ada 5, Ben 3,
 * Cy 2, Dee 4; Cy skipped at threshold 2) and the owning contracts:
 *
 * - An outcome fold receives every member's settled status (succeeded,
 *   skipped, failed, cancelled) with coverage, and never claims completeness
 *   while discovery or any member is unsettled: then its body never runs,
 *   its work is never admitted and nothing is published.
 * - Repairing a failed member makes it reconsider, and unaffected member
 *   bodies stay unexecuted; unchanged statuses reuse it.
 * - Strict folds are unchanged, and neither contract accepts the other's
 *   results.
 * - A soft-stop cancelled member is settled-not-successful for that run and
 *   never a complete success.
 * - Events carry identifiers, statuses and references, never values.
 *
 * @see ../../../../docs/spec/operations.md (RUN-004, RUN-005, RUN-010, RUN-013, RUN-014, RUN-017)
 * @see ../../../../docs/spec/acceptance.md (A-11)
 * @see ../../../../docs/plans/m5-operations.md (Folds; outcome-fold-coverage)
 */
import { afterEach, beforeEach, describe, expect, test } from '@jest/globals';

import { createStopController } from '../../src/index.js';
import { cleanup, freshLocation } from '../durable-history/support.js';
import { until } from '../stop/support.js';
import { analysis, clearHolds, contributors, createWorld, dee, hold, plantedMarker, release, resetWorld, tallySubject, world } from './fixture.js';
import type { IContributor } from './fixture.js';
import {
  logged,
  memberReference,
  publishUnder,
  readProvenanceRecord,
  readResult,
  reportCandidates,
  runTally,
  tallyCandidates,
  tallyReference,
} from './support.js';
import type { ICoverageJson, ITallyRunReport } from './support.js';

beforeEach(() => {
  resetWorld();
});
afterEach(() => {
  clearHolds();
  cleanup();
});

/** Start a fresh helper log, keeping the world's data and policy answers. */
function clearLog(): void {
  world.log = [];
}

/** Coverage with every list empty unless given; complete only when stated. */
function coverage(fields: Partial<ICoverageJson>): ICoverageJson {
  return { succeeded: [], skipped: [], failed: [], cancelled: [], pending: [], openDiscovery: false, complete: false, ...fields };
}

/** The outcome fold body never ran, its work was never admitted and it has no lifecycle at all. */
function expectNoTallyWork(report: ITallyRunReport): void {
  expect(logged(report, 'tally')).toEqual([]);
  expect(report.admissions.filter((entry) => entry.startsWith('outcome-fold:'))).toEqual([]);
  expect(report.events.filter((entry) => entry.startsWith('tally/'))).toEqual([]);
}

/** Ada, Ben and Cy with one member replaced. */
function withMember(key: string, change: (member: IContributor) => IContributor): IContributor[] {
  return contributors().map((member) => member.key === key ? change(member) : member);
}

describe('completeness: never complete while anything is unsettled (acceptance 1)', () => {
  test('A-11: one failed, one pending and one successful member with discovery open: it waits with partial coverage and runs nothing', async () => {
    const location = freshLocation();
    resetWorld(createWorld(contributors(), 'open'));
    world.failSummary = ['cy'];
    world.decisions = { 'person:ben': 'denied' };
    const report = await runTally(location);
    expect(report.members).toEqual({
      'person:ada': { status: 'succeeded', kind: 'published', reference: expect.any(String) },
      'person:ben': { status: 'pending' },
      'person:cy': { status: 'failed', code: 'execution-failure' },
    });
    expect(report.tally).toEqual({
      status: 'waiting',
      coverage: coverage({ succeeded: ['person:ada'], failed: ['person:cy'], pending: ['person:ben'], openDiscovery: true, complete: false }),
    });
    expectNoTallyWork(report);
    expect(tallyCandidates(location)).toEqual([]);
  });

  test('every current member settled, failure included, but discovery open: it waits', async () => {
    const location = freshLocation();
    resetWorld(createWorld(contributors(), 'open'));
    world.failSummary = ['cy'];
    const report = await runTally(location);
    expect(report.tally).toEqual({
      status: 'waiting',
      coverage: coverage({ succeeded: ['person:ada', 'person:ben'], failed: ['person:cy'], openDiscovery: true }),
    });
    expectNoTallyWork(report);
    expect(tallyCandidates(location)).toEqual([]);
  });

  test('discovery closed but one member pending: it waits, although the others succeeded', async () => {
    const location = freshLocation();
    world.decisions = { 'person:ben': 'denied' };
    const report = await runTally(location);
    expect(report.tally).toEqual({ status: 'waiting', coverage: coverage({ succeeded: ['person:ada', 'person:cy'], pending: ['person:ben'] }) });
    expectNoTallyWork(report);
    expect(tallyCandidates(location)).toEqual([]);
  });

  test('denied discovery work waits with discovery open and no members known', async () => {
    world.decisions = { '@contributors': 'denied' };
    const report = await runTally(freshLocation());
    expect(report.members).toEqual({});
    expect(report.tally).toEqual({ status: 'waiting', coverage: coverage({ openDiscovery: true }) });
    expect(report.log).toEqual([]);
    expectNoTallyWork(report);
  });

  test('cancelled discovery work, or a rejected snapshot, fails it: no population can be established in this pass', async () => {
    world.decisions = { '@contributors': 'cancelled' };
    const cancelled = await runTally(freshLocation());
    expect(cancelled.tally).toEqual({ status: 'failed', diagnostic: expect.stringMatching(/discovery/u) });
    expectNoTallyWork(cancelled);

    resetWorld(createWorld([...contributors(), { ...dee(), key: 'person:ben' }]));
    const rejected = await runTally(freshLocation());
    expect(rejected.tally).toEqual({ status: 'failed', diagnostic: expect.stringMatching(/duplicate member key "person:ben"/u) });
    expect(rejected.log).toEqual(['discover']);
    expectNoTallyWork(rejected);
  });
});

describe('settled statuses with coverage (acceptance 1, 3)', () => {
  test('RUN-010: over closed discovery the body receives every settled status, and the outcome carries complete coverage', async () => {
    const location = freshLocation();
    resetWorld(createWorld([...contributors(), dee()]));
    world.failSummary = ['ben'];
    world.decisions = { 'person:dee': 'cancelled' };
    const report = await runTally(location, { minimumAuthored: 2 });
    expect(report.members).toEqual({
      'person:ada': { status: 'succeeded', kind: 'published', reference: expect.any(String) },
      'person:ben': { status: 'failed', code: 'execution-failure' },
      'person:cy': { status: 'skipped' },
      'person:dee': { status: 'cancelled' },
    });
    expect(logged(report, 'tally')).toEqual(['person:ada=succeeded,person:ben=failed,person:cy=skipped,person:dee=cancelled']);
    const complete = coverage({ succeeded: ['person:ada'], skipped: ['person:cy'], failed: ['person:ben'], cancelled: ['person:dee'], complete: true });
    expect(report.tally).toEqual({ status: 'folded', kind: 'published', reference: expect.any(String), misses: [], coverage: complete });
    // Only Ada's score counts; the cancelled member is settled but never a success.
    expect(readResult(location, tallyReference(report))).toEqual({ succeeded: 1, skipped: 1, failed: 1, cancelled: 1, total: 5 });
    // The fold's own work was admitted only after every member settled.
    expect(report.admissions.at(-1)).toBe(`outcome-fold:${tallySubject}`);
  });

  test('unchanged settled statuses reuse it without its body; a still-failing member is retried, the fold is not', async () => {
    const location = freshLocation();
    world.failSummary = ['cy'];
    const cold = await runTally(location);
    expect(cold.tally).toMatchObject({ status: 'folded', kind: 'published', coverage: coverage({ succeeded: ['person:ada', 'person:ben'], failed: ['person:cy'], complete: true }) });
    clearLog();
    const again = await runTally(location, { order: 'reversed' });
    expect(logged(again, 'summary')).toEqual(['cy']);
    expect(logged(again, 'tally')).toEqual([]);
    expect(again.tally).toEqual({
      status: 'folded',
      kind: 'reused',
      reference: tallyReference(cold),
      misses: [],
      coverage: coverage({ succeeded: ['person:ada', 'person:ben'], failed: ['person:cy'], complete: true }),
      accepted: [memberReference(cold, 'person:ada'), memberReference(cold, 'person:ben')],
    });
  });

  test('a closed empty population folds as complete with empty coverage', async () => {
    const location = freshLocation();
    resetWorld(createWorld([]));
    const report = await runTally(location);
    expect(logged(report, 'tally')).toEqual(['']);
    expect(report.tally).toEqual({ status: 'folded', kind: 'published', reference: expect.any(String), misses: [], coverage: coverage({ complete: true }) });
  });

  test('stored provenance names the outcome-fold contract and every settled status, never gate facts', async () => {
    const location = freshLocation();
    resetWorld(createWorld([...contributors(), dee()]));
    world.failSummary = ['ben'];
    world.decisions = { 'person:dee': 'cancelled' };
    const report = await runTally(location, { minimumAuthored: 2 });
    const stored = readProvenanceRecord(location, tallyReference(report));
    expect(stored.formatVersion).toBe(4);
    // Resolution's version-4 provenance stores an outcome fold's record as plain data of this shape.
    const content = stored.content as { readonly kind: string; readonly over: unknown; readonly membership: unknown; readonly observations: readonly { readonly binding: { readonly path: readonly string[] } }[] };
    expect(content.kind).toBe('outcome-fold');
    expect(content.over).toEqual({ scope: analysis, role: 'step', slot: 'summary', template: 'contributor', collection: 'contributors' });
    expect(content.membership).toEqual([
      { key: 'person:ada', status: 'included', reference: { kind: 'completed-result', locator: memberReference(report, 'person:ada') } },
      { key: 'person:ben', status: 'failed' },
      { key: 'person:cy', status: 'skipped' },
      { key: 'person:dee', status: 'cancelled' },
    ]);
    const bindings = [...new Set(content.observations.map((item) => JSON.stringify(item.binding.path)))].sort();
    expect(bindings).toEqual(['["callable","tally"]', '["entry","person:ada"]', '["self"]']);
  });
});

describe('repair makes the outcome fold reconsider (acceptance 2)', () => {
  test('RUN-010: repairing a failed member reruns only that member and the outcome fold; the next run reuses everything', async () => {
    const location = freshLocation();
    world.failSummary = ['cy'];
    const failing = await runTally(location);
    expect(failing.tally).toMatchObject({ status: 'folded', kind: 'published', coverage: coverage({ succeeded: ['person:ada', 'person:ben'], failed: ['person:cy'], complete: true }) });
    expect(readResult(location, tallyReference(failing))).toEqual({ succeeded: 2, skipped: 0, failed: 1, cancelled: 0, total: 8 });

    world.failSummary = [];
    clearLog();
    const repaired = await runTally(location, { order: 'reversed' });
    // Unaffected member bodies stay unexecuted; only the repaired member and the fold run.
    expect(logged(repaired, 'summary')).toEqual(['cy']);
    expect(logged(repaired, 'tally')).toEqual(['person:ada=succeeded,person:ben=succeeded,person:cy=succeeded']);
    expect(repaired.members['person:ada']).toEqual({ status: 'succeeded', kind: 'reused', reference: memberReference(failing, 'person:ada') });
    expect(repaired.tally).toEqual({
      status: 'folded',
      kind: 'published',
      reference: expect.any(String),
      misses: ['changed-membership'],
      coverage: coverage({ succeeded: ['person:ada', 'person:ben', 'person:cy'], complete: true }),
    });
    expect(tallyReference(repaired)).not.toBe(tallyReference(failing));
    expect(readResult(location, tallyReference(repaired))).toEqual({ succeeded: 3, skipped: 0, failed: 0, cancelled: 0, total: 10 });

    clearLog();
    const settled = await runTally(location);
    expect(logged(settled, 'summary')).toEqual([]);
    expect(logged(settled, 'tally')).toEqual([]);
    expect(settled.tally).toMatchObject({ status: 'folded', kind: 'reused', reference: tallyReference(repaired) });
  });

  test('a change to a member fact the outcome fold consumed reconsiders it; the member itself reruns alone', async () => {
    const location = freshLocation();
    const cold = await runTally(location);
    resetWorld(createWorld(withMember('person:ada', (member) => ({ ...member, score: 6 }))));
    world.discoveryFinal = false;
    const changed = await runTally(location);
    expect(logged(changed, 'summary')).toEqual(['ada']);
    expect(changed.tally).toMatchObject({ status: 'folded', kind: 'published', misses: ['changed-member-output'] });
    expect(tallyReference(changed)).not.toBe(tallyReference(cold));
    expect(readResult(location, tallyReference(changed))).toEqual({ succeeded: 3, skipped: 0, failed: 0, cancelled: 0, total: 11 });
  });
});

describe('separation from strict folds (acceptance 3)', () => {
  test('CMP-8: with a failed member the strict fold fails while the outcome fold folds the failure', async () => {
    const location = freshLocation();
    world.failSummary = ['cy'];
    const report = await runTally(location, { strict: true });
    expect(report.report).toEqual({ status: 'failed' });
    expect(logged(report, 'report')).toEqual([]);
    expect(reportCandidates(location)).toEqual([]);
    expect(report.tally).toMatchObject({ status: 'folded', kind: 'published', coverage: coverage({ succeeded: ['person:ada', 'person:ben'], failed: ['person:cy'], complete: true }) });
  });

  test('with every member successful both fold, distinctly, and neither contract accepts the other\'s result', async () => {
    const location = freshLocation();
    const cold = await runTally(location, { strict: true });
    expect(cold.report).toEqual({ status: 'succeeded', reference: expect.any(String) });
    const strictReference = cold.report?.reference ?? '';
    const outcomeReference = tallyReference(cold);
    expect(outcomeReference).not.toBe(strictReference);
    // An all-successful outcome fold still reports outcome coverage, never strict complete-success coverage.
    expect(cold.tally).toMatchObject({ coverage: coverage({ succeeded: ['person:ada', 'person:ben', 'person:cy'], complete: true }) });

    // Each fold's subject gains a newest candidate recorded by the other contract.
    publishUnder(location, tallySubject, strictReference);
    publishUnder(location, 'report:acme/widget:2026-Q1', outcomeReference);
    clearLog();
    const crossed = await runTally(location, { strict: true });
    expect(logged(crossed, 'tally')).toEqual([]);
    expect(logged(crossed, 'report')).toEqual([]);
    expect(crossed.tally).toMatchObject({ status: 'folded', kind: 'reused', reference: outcomeReference, misses: ['unsupported-evidence'] });
    expect(crossed.report).toEqual({ status: 'succeeded', reference: strictReference });
  });
});

describe('stop interactions (RUN-014)', () => {
  test('a soft stop while one member drains: queued members are cancelled for this run, settled but never successful, and the outcome fold publishes nothing', async () => {
    const location = freshLocation();
    const stop = createStopController();
    hold('ada');
    const running = runTally(location, { stop, window: 1 });
    await until(() => world.log.includes('summary:ada'), 'Ada\'s summary is executing');
    stop.request({ level: 'soft' });
    release('ada');
    const stopped = await running;
    expect(stopped.members).toEqual({
      'person:ada': { status: 'succeeded', kind: 'published', reference: expect.any(String) },
      'person:ben': { status: 'cancelled' },
      'person:cy': { status: 'cancelled' },
    });
    expect(stopped.tally).toEqual({
      status: 'cancelled',
      reason: expect.stringMatching(/soft stop/u),
      refused: 'tally',
      coverage: coverage({ succeeded: ['person:ada'], cancelled: ['person:ben', 'person:cy'], complete: true }),
    });
    expect(logged(stopped, 'summary')).toEqual(['ada']);
    expect(logged(stopped, 'tally')).toEqual([]);
    expect(tallyCandidates(location)).toEqual([]);

    // The next run settles the cancelled members and folds them as successes.
    clearLog();
    const resumed = await runTally(location);
    expect(logged(resumed, 'summary')).toEqual(['ben', 'cy']);
    expect(resumed.tally).toMatchObject({ status: 'folded', kind: 'published', coverage: coverage({ succeeded: ['person:ada', 'person:ben', 'person:cy'], complete: true }) });
  });
});

describe('event privacy (RUN-013)', () => {
  test('run events carry identifiers, statuses and references, never member values or failure text', async () => {
    const location = freshLocation();
    world.failSummary = ['cy'];
    const report = await runTally(location);
    expect(report.tally).toMatchObject({ status: 'folded' });
    // The outcome fold's own lifecycle is observable.
    expect(report.events.filter((entry) => entry.startsWith('tally/'))).toEqual(['tally/:verify', 'tally/:admit', 'tally/:claim', 'tally/:execute', 'tally/:publish']);
    // The planted marker is in the member outputs and the failure, and in no event or coverage.
    expect(JSON.stringify(readResult(location, memberReference(report, 'person:ada')))).toContain(plantedMarker);
    expect(report.rawEvents.length).toBeGreaterThan(0);
    for (const event of report.rawEvents) {
      expect(event).not.toContain(plantedMarker);
    }
    expect(JSON.stringify(report.tally)).not.toContain(plantedMarker);
  });
});

describe('environment isolation (RUN-017)', () => {
  test('an outcome fold folded in one environment is never a candidate in another', async () => {
    const location = freshLocation();
    const trial = await runTally(location, { environment: 'env:trial' });
    clearLog();
    const production = await runTally(location, { environment: 'env:production' });
    expect(logged(production, 'summary')).toEqual(['ada', 'ben', 'cy']);
    expect(logged(production, 'tally')).toHaveLength(1);
    expect(production.tally).toMatchObject({ status: 'folded', kind: 'published', misses: [] });
    expect(tallyCandidates(location, 'env:trial')).toEqual([tallyReference(trial)]);
    expect(tallyCandidates(location, 'env:production')).toEqual([tallyReference(production)]);
  });
});
