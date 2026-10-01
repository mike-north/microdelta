/**
 * `publication-commit-race` (A-19, A-09) for paid work: an observer that
 * throws at the publication commit and a presenter that fails afterwards
 * never cause committed, paid success to be executed or paid for again, in
 * separate processes over the assembled facade path.
 *
 * Expectations, written by hand from A-19 and EXP-8 mechanism 2:
 *
 * - The publication commit is the linearization point. An observer's throw
 *   at the `publish` position comes after the commit: it becomes a
 *   diagnostic and the committed result stands.
 * - A presenter failing after every result committed fails the process, but
 *   commits nothing back and erases nothing.
 * - The next process reuses every committed result with its exact reference:
 *   it runs no assessment body and sends no request, so nothing is paid
 *   twice, and the usage total is unchanged.
 *
 * - Killed after a paid answer came back but before its step published (the
 *   operation's outcome and usage are committed; the step's result is not):
 *   the reuse unit is the step (EXP-8 resolution 3, its documented CX-3
 *   limit), so a resumed run re-executes the step and pays again under a new
 *   operation. Both operations are succeeded and reported, each report counted
 *   once, nothing unknown. With the paid call isolated in its own memoized
 *   child step, the child has published, so the resumed parent reuses it and
 *   pays once.
 * - Killed after the step published: the next process reuses it; the provider
 *   was called once.
 *
 * Each kill is a SIGKILL from caller code: the author body once its answer is
 * back, or an observer at the `publish` position. Kills immediately before and
 * after History's own publication commit, of a soft-stop drain, are proven
 * through the same facade path by the M3 harness's `publication-commit-race`
 * cases (`../acceptance/stop-publication.test.ts`).
 *
 * @see ../../../../docs/spec/acceptance.md (A-09, A-19)
 * @see ../../../../experiments/exp-8/decision.md (mechanism 2; resolution 3 and CX-3)
 */
import { describe, expect, test } from '@jest/globals';

import { assessmentSubject, clean, freshScenario, removeScenarios, statuses, usageOf } from './support.js';

/** A killed process's writer lease, short so the next process takes over soon after the kill. */
const killedLease = 1_000;

/** Every member succeeded. */
const allSucceeded = { 'pr-1': 'succeeded', 'pr-2': 'succeeded', 'pr-3': 'succeeded' };

removeScenarios();

/** The exact references a process published, by member key, from its `publish` step events. */
function published(events: readonly Readonly<Record<string, unknown>>[]): Readonly<Record<string, string>> {
  return Object.fromEntries(events.flatMap((event) => {
    const inner: unknown = event['event'];
    if (event['kind'] !== 'step' || typeof inner !== 'object' || inner === null || Reflect.get(inner, 'phase') !== 'publish') {
      return [];
    }
    const step: unknown = Reflect.get(inner, 'step');
    const reference: unknown = Reflect.get(inner, 'reference');
    const key: unknown = typeof step === 'object' && step !== null ? Reflect.get(step, 'memberKey') : undefined;
    const locator: unknown = typeof reference === 'object' && reference !== null ? Reflect.get(reference, 'locator') : undefined;
    return typeof key === 'string' && typeof locator === 'string' ? [[key, locator]] : [];
  }));
}

describe('publication-commit-race (A-19, A-09)', () => {
  test('a throwing observer at the commit and a failing presenter never re-execute or re-pay committed success', () => {
    const s = freshScenario();
    const failed = s.run({ kind: 'fold' }, { window: 1, throwObserverAt: { phase: 'publish', key: 'pr-1' }, failPresenter: true });
    expect(failed.status).toBe(3);
    expect(failed.error).toMatchObject({ message: 'acceptance presenter failure' });
    const committed = published(failed.events);
    expect(Object.keys(committed).sort()).toEqual(['pr-1', 'pr-2', 'pr-3']);
    expect(s.publications(assessmentSubject('pr-1'))).toHaveLength(1);
    expect(s.keys('received')).toEqual(['pr-1', 'pr-2', 'pr-3']);

    const later = clean(s.run({ kind: 'fold' }, { window: 1 }));
    expect(later.assessed).toEqual([]);
    expect(s.keys('received')).toEqual(['pr-1', 'pr-2', 'pr-3']);
    expect(statuses(later)).toEqual({ 'pr-1': 'succeeded', 'pr-2': 'succeeded', 'pr-3': 'succeeded' });
    for (const key of ['pr-1', 'pr-2', 'pr-3']) {
      expect(later.result.members[key]).toEqual({ status: 'succeeded', kind: 'reused', reference: committed[key] });
    }
    expect(later.result.report).toEqual({ scores: [['pr-1', 2], ['pr-2', 1], ['pr-3', 2]] });
    expect(usageOf(later.result.usage)).toEqual({ status: 'complete', observed: [{ unit: 'tokens', amount: 300 }], unknown: 0, operations: 3, reports: 3, requestAttempts: 3 });
  });
});

describe('publication-commit-race (A-09, CX-3): process death on either side of a paid step\'s publication', () => {
  test('killed after the paid answer but before the step publishes: the resumed step re-executes and pays again under a new operation (CX-3), each report counted once', async () => {
    const s = freshScenario();
    const killed = s.run({ kind: 'members' }, { window: 1, leaseMilliseconds: killedLease, kill: { at: 'after-answer', key: 'pr-1' } });
    expect(killed.signal).toBe('SIGKILL');
    expect(s.publications(assessmentSubject('pr-1'))).toEqual([]);
    // The operation's outcome and its usage were committed before the kill: 100 tokens, known.
    expect(usageOf(s.usage())).toEqual({ status: 'complete', observed: [{ unit: 'tokens', amount: 100 }], unknown: 0, operations: 1, reports: 1, requestAttempts: 1 });

    await s.outlastLease();
    const resumed = clean(s.run({ kind: 'members' }, { window: 1 }));
    expect(statuses(resumed)).toEqual(allSucceeded);
    expect(resumed.assessed).toEqual(['pr-1', 'pr-2', 'pr-3']);
    // The step is the reuse unit: its body ran again and paid again, under a new operation.
    const sends = s.ledger().filter((entry) => entry.kind === 'received' && entry.key === 'pr-1');
    expect(sends).toHaveLength(2);
    expect(sends[1]?.operation).not.toBe(sends[0]?.operation);
    expect(s.keys('applied').filter((key) => key === 'pr-1')).toEqual(['pr-1', 'pr-1']);
    // Both operations are succeeded and reported once each; nothing is unknown and nothing is counted twice.
    const views = resumed.result.operations.filter((view) => view.member === 'pr-1');
    expect(views.map((view) => [view.operation, view.status, view.attempts.map((attempt) => attempt.usage)])).toEqual([
      [sends[0]?.operation, 'succeeded', ['acknowledged']],
      [sends[1]?.operation, 'succeeded', ['acknowledged']],
    ]);
    expect(usageOf(resumed.result.usage)).toEqual({ status: 'complete', observed: [{ unit: 'tokens', amount: 400 }], unknown: 0, operations: 4, reports: 4, requestAttempts: 4 });
    expect(s.publications(assessmentSubject('pr-1'))).toHaveLength(1);
  });

  test('the same kill with the paid call isolated in a memoized child step: the child published, so the resumed parent reuses it and pays once', async () => {
    const s = freshScenario();
    const killed = s.run({ kind: 'members', step: 'isolated' }, { window: 1, leaseMilliseconds: killedLease, kill: { at: 'after-answer', key: 'pr-1', step: 'isolated' } });
    expect(killed.signal).toBe('SIGKILL');
    // The child's result is committed; the parent's is not.
    expect(s.publications('paid:pr-1')).toHaveLength(1);
    expect(s.publications('isolated:pr-1')).toEqual([]);

    await s.outlastLease();
    const resumed = clean(s.run({ kind: 'members', step: 'isolated' }, { window: 1 }));
    expect(statuses(resumed)).toEqual(allSucceeded);
    // pr-1's paid child was reused: its body did not run again, and the provider was called for it once.
    expect(resumed.assessed).toEqual(['pr-2', 'pr-3']);
    expect(s.keys('received')).toEqual(['pr-1', 'pr-2', 'pr-3']);
    expect(s.publications('paid:pr-1')).toHaveLength(1);
    expect(s.publications('isolated:pr-1')).toHaveLength(1);
    expect(usageOf(resumed.result.usage)).toEqual({ status: 'complete', observed: [{ unit: 'tokens', amount: 300 }], unknown: 0, operations: 3, reports: 3, requestAttempts: 3 });
  });

  test('killed after the step published: the next process reuses it, and the provider was called once', async () => {
    const s = freshScenario();
    const killed = s.run({ kind: 'members' }, { window: 1, leaseMilliseconds: killedLease, kill: { at: 'after-publish', key: 'pr-1' } });
    expect(killed.signal).toBe('SIGKILL');
    const committed = published(killed.events)['pr-1'];
    expect(s.publications(assessmentSubject('pr-1'))).toHaveLength(1);

    await s.outlastLease();
    const resumed = clean(s.run({ kind: 'members' }, { window: 1 }));
    expect(statuses(resumed)).toEqual(allSucceeded);
    expect(resumed.result.members['pr-1']).toEqual({ status: 'succeeded', kind: 'reused', reference: committed });
    expect(resumed.assessed).toEqual(['pr-2', 'pr-3']);
    expect(s.keys('received')).toEqual(['pr-1', 'pr-2', 'pr-3']);
    expect(usageOf(resumed.result.usage)).toEqual({ status: 'complete', observed: [{ unit: 'tokens', amount: 300 }], unknown: 0, operations: 3, reports: 3, requestAttempts: 3 });
  });
});
