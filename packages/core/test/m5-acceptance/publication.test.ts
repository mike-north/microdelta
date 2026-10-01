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
 * Kills immediately before and after the publication commit of a soft-stop
 * drain are proven through the same facade path by the M3 harness's
 * `publication-commit-race` cases (`../acceptance/stop-publication.test.ts`),
 * which kill the process at History's commit boundary.
 *
 * @see ../../../../docs/spec/acceptance.md (A-09, A-19)
 * @see ../../../../experiments/exp-8/decision.md (mechanism 2)
 */
import { describe, expect, test } from '@jest/globals';

import { assessmentSubject, clean, freshScenario, removeScenarios, statuses, usageOf } from './support.js';

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
