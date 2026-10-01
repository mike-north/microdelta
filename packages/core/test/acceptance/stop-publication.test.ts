/**
 * M5 acceptance for the publication commit as the stop linearization point
 * (A-09, A-13, A-19; EXP-8 mechanism 2), through independent processes over
 * the assembled workspace path.
 *
 * Setup, as in the M3 kill-boundary suite: process A publishes the cold
 * report; the world then merges Ada's PR 103 and her source policy answers
 * not-final, so resolving Ada's summary runs and publishes the source check
 * and then executes the summary. For that invocation History's transactions
 * are writer acquisition, source allocate/stage/publish (#1 each), then the
 * summary's allocate #2, stage #2 and publish #2. The operator requests a
 * stop when the run's observer sees the summary's `execute` position.
 *
 * Expectations, derived from the selected execution contract:
 *
 * - a soft stop lets the admitted summary drain; killed immediately before
 *   its publication commit, the old complete state stands and the attempt is
 *   honestly incomplete; killed immediately after it, the committed success
 *   is recovered exactly and later reused, never re-executed;
 * - a throwing observer at the commit and a failing presenter afterwards
 *   leave the committed success intact, and a later process reuses it with
 *   no summary execution;
 * - a hard stop effective before the commit discards the step: nothing is
 *   published and the attempt ends unsuccessful, so a later process executes
 *   it afresh.
 *
 * @see ../../../../docs/spec/acceptance.md (A-09, A-13, A-19)
 * @see ../../../../docs/plans/m5-operations.md (planned evidence `publication-commit-race`)
 * @see ../../../../experiments/exp-8/decision.md (mechanism 2, supervisor resolution 2)
 */
import { afterEach, beforeEach, describe, expect, test } from '@jest/globals';
import type { IWriterLease } from '@microdelta/history';

import { baseWorld, outcomeOf, referenceOf, scenario, subjectOf } from './harness.js';
import type { IProcessRun, IScenario } from './harness.js';
import { outlastStoredLease } from './lease-expiry.js';

let s: IScenario;
let cold: IProcessRun;

/** Finite headroom so a killed run still holds an unexpired lease at its planned boundary (see crash-recovery.test.ts). */
const leaseMilliseconds = 2_000;

/** The operator's soft stop, requested as Ada's summary starts executing. */
const softAtSummary = { level: 'soft', phase: 'execute', memberKey: 'person:ada', slot: 'summary' } as const;

/** The operator's hard stop, requested as Ada's summary starts executing. */
const hardAtSummary = { level: 'hard', phase: 'execute', memberKey: 'person:ada', slot: 'summary' } as const;

beforeEach(() => {
  s = scenario();
  s.writeWorld(baseWorld());
  cold = s.run({ kind: 'report' }, { keys: s.saveKeys('cold').file });
  s.writeWorld({
    ...baseWorld(),
    pullRequests: baseWorld().pullRequests.map((pull) => (pull.number === 103 ? { ...pull, merged: true } : pull)),
    final: { 'person:ada': false, 'person:ben': true },
  });
});

afterEach(() => {
  s.remove();
});

/** Ada's completed summary candidates and the latest pointer, read on the real store. */
function adaSummaries(): { readonly candidates: readonly string[]; readonly current: string | undefined } {
  return s.inspect((history) => {
    const subject = subjectOf('person:ada', 'summary');
    return {
      candidates: history.findCandidates(subject).map((candidate) => candidate.reference.locator),
      current: history.readCurrent({ analysis: subject.analysis, environment: subject.environment, subject: subject.subject })?.locator,
    };
  });
}

/** Wait until a killed holder's stored lease has expired for History. */
function outlastKilledLease(): void {
  outlastStoredLease(() => s.inspect((history): IWriterLease | undefined => history.currentWriter()), { marginMilliseconds: 50, budgetMilliseconds: leaseMilliseconds + 50 });
}

/** The stop intent the killed or finished process reported, as `level:cause`. */
function stops(run: IProcessRun): string[] {
  return run.lines.filter((line) => line['t'] === 'stop').map((line) => `${String(line['level'])}:${String(line['cause'])}`);
}

describe('publication-commit-race (A-09, A-13): a soft-stop drain killed on either side of its commit', () => {
  test('killed immediately before the commit: the old complete state stands, the attempt is incomplete, and a new process executes it afresh', () => {
    const saved = s.saveKeys('drain-before');
    const killed = s.run({ kind: 'resolve', member: 'person:ada' }, { keys: saved.file, fault: { role: 'publish', occurrence: 2, when: 'before' }, stopAt: softAtSummary, leaseMilliseconds });
    expect(killed.signal).toBe('SIGKILL');
    expect(stops(killed)).toEqual(['soft:operator']);
    // The admitted summary drained: its body ran to completion after the soft stop.
    expect(killed.count('summary', 'person:ada')).toBe(1);
    expect(adaSummaries()).toEqual({ candidates: [referenceOf(cold, 'person:ada')], current: referenceOf(cold, 'person:ada') });
    expect(s.run({ kind: 'recover', member: 'person:ada' }, { keys: saved.file }).result?.['recovered']).toMatchObject({ kind: 'incomplete' });
    outlastKilledLease();
    const fresh = s.run({ kind: 'resolve', member: 'person:ada' }, { keys: s.saveKeys('drain-before-fresh').file, leaseMilliseconds });
    expect(outcomeOf(fresh)['kind']).toBe('published');
    expect(fresh.count('summary', 'person:ada')).toBe(1);
  });

  test('killed immediately after the commit: the committed success is recovered exactly and reused, never re-executed', () => {
    const saved = s.saveKeys('drain-after');
    const killed = s.run({ kind: 'resolve', member: 'person:ada' }, { keys: saved.file, fault: { role: 'publish', occurrence: 2, when: 'after' }, stopAt: softAtSummary, leaseMilliseconds });
    expect(killed.signal).toBe('SIGKILL');
    expect(stops(killed)).toEqual(['soft:operator']);
    const state = adaSummaries();
    expect(state.candidates).toHaveLength(2);
    const committed = state.current;
    expect(committed).not.toBe(referenceOf(cold, 'person:ada'));
    expect(s.run({ kind: 'recover', member: 'person:ada' }, { keys: saved.file }).result?.['recovered']).toEqual({ kind: 'recovered', reference: committed });
    outlastKilledLease();
    const later = s.run({ kind: 'resolve', member: 'person:ada' }, { keys: s.saveKeys('drain-after-later').file, leaseMilliseconds });
    expect(outcomeOf(later)).toMatchObject({ kind: 'reused', reference: committed });
    expect(later.count('summary', 'person:ada')).toBe(0);
  });
});

describe('publication-commit-race (A-19): observer and presenter failures after the commit', () => {
  test('a throwing observer at the commit and a failing presenter never re-execute the committed success', () => {
    const failed = s.run({ kind: 'report' }, {
      keys: s.saveKeys('presenter').file,
      stopAt: softAtSummary,
      throwAt: { phase: 'publish', memberKey: 'person:ada', slot: 'summary' },
      failPresenter: true,
    });
    expect(failed.status).toBe(3);
    expect(failed.error).toMatchObject({ message: 'acceptance presenter failure' });
    expect(failed.phases('person:ada', 'summary')).toEqual(['verify', 'admit', 'claim', 'execute', 'publish']);
    expect(failed.count('summary', 'person:ada')).toBe(1);
    const committed = adaSummaries().current;
    expect(committed).not.toBe(referenceOf(cold, 'person:ada'));
    const later = s.run({ kind: 'report' }, { keys: s.saveKeys('presenter-later').file });
    expect(outcomeOf(later, 'person:ada')).toMatchObject({ kind: 'reused', reference: committed });
    expect(outcomeOf(later, 'person:ben')).toMatchObject({ kind: 'reused', reference: referenceOf(cold, 'person:ben') });
    expect(later.count('summary')).toBe(0);
  });
});

describe('publication-commit-race (A-13): a hard stop before the commit', () => {
  test('discards the step: nothing is published, the attempt is unsuccessful, and a later process executes it afresh', () => {
    const saved = s.saveKeys('hard');
    const stopped = s.run({ kind: 'resolve', member: 'person:ada' }, { keys: saved.file, stopAt: hardAtSummary });
    expect(stops(stopped)).toEqual(['hard:operator']);
    expect(outcomeOf(stopped)).toMatchObject({ kind: 'refused', reason: expect.stringContaining('hard stop') });
    expect(stopped.count('summary', 'person:ada')).toBe(0);
    expect(stopped.phases('person:ada', 'summary')).toEqual(['verify', 'admit', 'claim', 'execute', 'abandon']);
    expect(adaSummaries()).toEqual({ candidates: [referenceOf(cold, 'person:ada')], current: referenceOf(cold, 'person:ada') });
    expect(s.run({ kind: 'recover', member: 'person:ada' }, { keys: saved.file }).result?.['recovered']).toMatchObject({ kind: 'unsuccessful' });
    const later = s.run({ kind: 'resolve', member: 'person:ada' }, { keys: s.saveKeys('hard-later').file });
    expect(outcomeOf(later)['kind']).toBe('published');
    expect(later.count('summary', 'person:ada')).toBe(1);
  });
});
