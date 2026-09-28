/**
 * M3 acceptance, A-09/PUB-004 publication kill boundaries and the explicit
 * recovery request, through a real summary invocation of the assembled
 * workspace path in an independent process.
 *
 * Setup: process A publishes the cold report (Ada's summary TA0). The world
 * then changes a consumed field of Ada (PR 103 merged) and her source policy
 * answers not-final, so a process resolving Ada's summary validates TA0,
 * runs and publishes the source check, finds a consumed change, and executes
 * the summary. The caller saves a fresh request key to a file before that
 * process starts. For that invocation the History transactions are, in
 * order: writer acquisition (writer #1), source allocate/stage/publish
 * (#1 each), then the summary's allocate #2, stage #2 and publish #2. The
 * process is killed with SIGKILL immediately before or after the commit of
 * the selected summary transaction. Later processes reopen the same file.
 *
 * The component crash matrix for History's own boundaries, fencing and stale
 * holders remains in `../durable-history/crash-recovery.test.ts`; this suite
 * proves the assembled path, not a substitute for it.
 *
 * @see ../../../../docs/spec/acceptance.md (A-09)
 * @see ../../../../docs/spec/execution.md (PUB-004)
 * @see ../../../../docs/plans/m3-contribution-analysis.md (Explicit recovery request; History, host operations and durable records)
 */
import { afterEach, beforeEach, describe, expect, test } from '@jest/globals';

import { adaExpected } from './expected.js';
import { baseWorld, outcomeOf, referenceOf, scenario, subjectOf } from './harness.js';
import type { IProcessRun, IScenario } from './harness.js';

let s: IScenario;
let cold: IProcessRun;

/** Ada's summary after PR 103 is merged, derived by hand. */
const adaMerged = { name: 'Ada', authored: 3, merged: 3, reviews: 5, sentence: 'Ada authored 3 pull requests, 3 of which were merged, and submitted 5 reviews.' };

/** A short lease, so a killed holder's lease expires before the next normal request. */
const leaseMilliseconds = 300;

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

/** Wait past the killed process's lease. */
function outlastLease(): void {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, leaseMilliseconds + 150);
}

/** Durable state of Ada's summary after reopening: completed candidates, the latest pointer and the old exact result. */
function adaSummaryState(): { readonly candidates: readonly string[]; readonly current: string | undefined; readonly old: unknown } {
  return s.inspect((history) => {
    const subject = subjectOf('person:ada', 'summary');
    return {
      candidates: history.findCandidates(subject).map((candidate) => candidate.reference.locator),
      current: history.readCurrent({ analysis: subject.analysis, environment: subject.environment, subject: subject.subject })?.locator,
      old: history.reader.readSubtree({ kind: 'completed-result', locator: referenceOf(cold, 'person:ada') }, []),
    };
  });
}

/** Resolve Ada's summary under a saved key, killed at one boundary. */
function killedAt(keys: string, fault: { readonly role: string; readonly occurrence: number; readonly when: 'before' | 'after' }): IProcessRun {
  const killed = s.run({ kind: 'resolve', member: 'person:ada' }, { keys, fault, leaseMilliseconds });
  expect(killed.signal).toBe('SIGKILL');
  expect(killed.result).toBeUndefined();
  return killed;
}

describe('publication-kill-boundaries (A-09) through a real summary invocation', () => {
  test('killed before the writer acquisition commits: nothing changed, no holder, the saved key identifies nothing', () => {
    const saved = s.saveKeys('acquire');
    const killed = killedAt(saved.file, { role: 'writer', occurrence: 1, when: 'before' });
    expect(killed.count('check')).toBe(0);
    expect(killed.count('summary')).toBe(0);
    expect(s.inspect((history) => history.currentWriter())).toBeUndefined();
    expect(adaSummaryState()).toEqual({ candidates: [referenceOf(cold, 'person:ada')], current: referenceOf(cold, 'person:ada'), old: { name: 'Ada', authored: 3, merged: 2, reviews: 5, sentence: adaExpected.sentence } });
    const recovered = s.run({ kind: 'recover', member: 'person:ada' }, { keys: saved.file });
    expect(recovered.result?.['recovered']).toEqual({ kind: 'absent' });
    expect(recovered.count('summary') + recovered.count('check') + recovered.count('finality')).toBe(0);
  });

  test('killed before the summary allocation commits: the source result is committed, the summary attempt never existed', () => {
    const saved = s.saveKeys('allocate');
    const killed = killedAt(saved.file, { role: 'allocate', occurrence: 2, when: 'before' });
    expect(killed.count('check', 'person:ada')).toBe(1);
    expect(killed.count('summary')).toBe(0);
    expect(adaSummaryState()).toMatchObject({ candidates: [referenceOf(cold, 'person:ada')], current: referenceOf(cold, 'person:ada') });
    const recovered = s.run({ kind: 'recover', member: 'person:ada' }, { keys: saved.file });
    expect(recovered.result?.['recovered']).toEqual({ kind: 'absent' });
  });

  for (const boundary of [
    { name: 'after the summary allocation commits', fault: { role: 'allocate', occurrence: 2, when: 'after' as const }, body: 0 },
    { name: 'before the summary staging commits', fault: { role: 'stage', occurrence: 2, when: 'before' as const }, body: 1 },
    { name: 'after the summary staging commits', fault: { role: 'stage', occurrence: 2, when: 'after' as const }, body: 1 },
    { name: 'immediately before the summary publication commits', fault: { role: 'publish', occurrence: 2, when: 'before' as const }, body: 1 },
  ]) {
    test(`killed ${boundary.name}: no partial result, old history intact, the attempt is honestly incomplete and never auto-executes`, () => {
      const saved = s.saveKeys(boundary.fault.role);
      const killed = killedAt(saved.file, boundary.fault);
      expect(killed.count('summary', 'person:ada')).toBe(boundary.body);
      expect(adaSummaryState()).toEqual({ candidates: [referenceOf(cold, 'person:ada')], current: referenceOf(cold, 'person:ada'), old: { name: 'Ada', authored: 3, merged: 2, reviews: 5, sentence: adaExpected.sentence } });
      const recovered = s.run({ kind: 'recover', member: 'person:ada' }, { keys: saved.file });
      expect(recovered.result?.['recovered']).toMatchObject({ kind: 'incomplete' });
      expect(recovered.count('summary') + recovered.count('check') + recovered.count('finality')).toBe(0);
      outlastLease();
      // Ada's committed source is now final, so the summary's own saved-key check is
      // what a normal request meets (the source is not re-executed under that key).
      s.writeWorld({ ...baseWorld(), pullRequests: baseWorld().pullRequests.map((pull) => (pull.number === 103 ? { ...pull, merged: true } : pull)) });
      // A normal request with the same saved key is refused rather than resuming the incomplete work.
      const reused = s.run({ kind: 'resolve', member: 'person:ada' }, { keys: saved.file, leaseMilliseconds });
      expect(reused.error).toMatchObject({ code: 'invalid-request' });
      expect(reused.count('summary')).toBe(0);
      // A fresh request performs current policy (the current finality hook) and publishes the new summary.
      const fresh = s.run({ kind: 'resolve', member: 'person:ada' }, { keys: s.saveKeys('fresh').file, leaseMilliseconds });
      expect(outcomeOf(fresh)['kind']).toBe('published');
      expect(fresh.count('finality', 'person:ada')).toBe(1);
      expect(fresh.count('check', 'person:ada')).toBe(0);
      expect(fresh.count('summary', 'person:ada')).toBe(1);
      s.inspect((history) => {
        expect(history.reader.readSubtree({ kind: 'completed-result', locator: referenceOf(fresh) }, [])).toEqual(adaMerged);
      });
    });
  }

  test('an unsuccessful summary attempt is reported as such by recovery and is never re-executed automatically', () => {
    const saved = s.saveKeys('failed');
    const failed = s.run({ kind: 'resolve', member: 'person:ada' }, { keys: saved.file, failSummary: 'person:ada' });
    expect(failed.error).toMatchObject({ code: 'execution-failure' });
    expect(failed.phases('person:ada', 'summary')).toEqual(['verify', 'admit', 'claim', 'execute', 'abandon']);
    expect(adaSummaryState()).toMatchObject({ candidates: [referenceOf(cold, 'person:ada')], current: referenceOf(cold, 'person:ada') });
    const recovered = s.run({ kind: 'recover', member: 'person:ada' }, { keys: saved.file });
    expect(recovered.result?.['recovered']).toMatchObject({ kind: 'unsuccessful' });
    expect(recovered.count('summary') + recovered.count('check') + recovered.count('finality')).toBe(0);
  });

  test('killed after the summary publication commits (lost acknowledgment): recovery returns the exact committed result with no author work or acceptance, wrong intent is rejected, and a fresh request applies current policy', () => {
    const saved = s.saveKeys('publish-after');
    const killed = killedAt(saved.file, { role: 'publish', occurrence: 2, when: 'after' });
    expect(killed.count('summary', 'person:ada')).toBe(1);
    // The committed result exists, fully: it is a candidate, the latest publication, and exactly readable.
    const state = adaSummaryState();
    expect(state.candidates).toHaveLength(2);
    const committed = state.current;
    expect(committed).toBeDefined();
    expect(committed).not.toBe(referenceOf(cold, 'person:ada'));
    expect(state.old).toEqual({ name: 'Ada', authored: 3, merged: 2, reviews: 5, sentence: adaExpected.sentence });
    const acceptancesBefore = s.inspect((history) => history.readAcceptances({ kind: 'completed-result', locator: committed ?? '' }).length);

    // Recovery through the workspace's recover entry, while the killed process's lease is still unexpired.
    const recovered = s.run({ kind: 'recover', member: 'person:ada' }, { keys: saved.file });
    expect(recovered.result?.['recovered']).toEqual({ kind: 'recovered', reference: committed });
    expect(recovered.count('summary') + recovered.count('check') + recovered.count('finality')).toBe(0);
    expect(recovered.admissions).toEqual([]);
    expect(s.inspect((history) => history.readAcceptances({ kind: 'completed-result', locator: committed ?? '' }).length)).toBe(acceptancesBefore);
    s.inspect((history) => {
      expect(history.reader.readSubtree({ kind: 'completed-result', locator: committed ?? '' }, [])).toEqual(adaMerged);
    });

    // The same saved key under a different current intent is rejected, without author work.
    const wrongIntent = s.run({ kind: 'recover', member: 'person:ada' }, { keys: saved.file, variation: { formatter: 'revised' } });
    expect(wrongIntent.error).toMatchObject({ code: 'wrong-intent' });
    expect(wrongIntent.count('summary') + wrongIntent.count('check') + wrongIntent.count('finality')).toBe(0);

    // Recovery again is stable.
    expect(s.run({ kind: 'recover', member: 'person:ada' }, { keys: saved.file }).result?.['recovered']).toEqual({ kind: 'recovered', reference: committed });

    outlastLease();
    // A subsequent fresh normal request performs current policy validation (the not-final check runs) and reuses the committed result.
    const fresh = s.run({ kind: 'resolve', member: 'person:ada' }, { keys: s.saveKeys('after-recovery').file, leaseMilliseconds });
    expect(fresh.count('finality', 'person:ada')).toBe(1);
    expect(fresh.count('check', 'person:ada')).toBe(1);
    expect(fresh.count('summary', 'person:ada')).toBe(0);
    expect(outcomeOf(fresh)).toMatchObject({ kind: 'reused', basis: 'validated', reference: committed });
  });
});
