/**
 * `outcome-fold-coverage` (A-11, RUN-010): strict and outcome folds over
 * failed, pending and successful members, in separate processes over the
 * assembled facade path.
 *
 * Expectations, written by hand from the owner decision and the M5
 * selection (RUN-010):
 *
 * - pr-1 is answered; pr-2's response is lost, so its operation is unknown
 *   and its member pending (unsettled); pr-3 is refused permanently three
 *   times (failed each time) and answered on its fourth request.
 * - The strict report never folds a failed or pending member: it fails,
 *   naming pr-3 failed and pr-2 pending, and runs no body.
 * - While pr-2 is unsettled the outcome fold waits with partial coverage
 *   (pr-1 succeeded, pr-3 failed, pr-2 pending, complete false): no body,
 *   nothing published.
 * - Once the operator abandons pr-2's operation and pr-2 is answered, every
 *   member has settled: the outcome fold runs over succeeded, succeeded and
 *   failed, with complete coverage that still names the failure, which is
 *   never complete success.
 * - Repairing pr-3 changes the fold's membership-and-status fact, so the fold
 *   runs again and publishes a new result, while pr-1 and pr-2 are reused
 *   unexecuted. With nothing changed, the next process reuses it.
 *
 * @see ../../../../docs/spec/operations.md (RUN-010)
 * @see ../../../../docs/spec/acceptance.md (A-11)
 */
import { describe, expect, test } from '@jest/globals';

import { baseWorld, clean, freshScenario, operationOf, removeScenarios, statuses } from './support.js';

removeScenarios();

/** The tally body's runs in a process. */
function tallies(lines: readonly Readonly<Record<string, unknown>>[]): number {
  return lines.filter((line) => line['t'] === 'trace' && line['helper'] === 'tally').length;
}

describe('outcome-fold-coverage (A-11, RUN-010)', () => {
  test('settled statuses with coverage, never completeness while a member is unsettled, and reconsideration after repair', () => {
    const s = freshScenario(baseWorld({ script: { 'pr-2': [{ kind: 'lost' }], 'pr-3': [{ kind: 'refuse' }, { kind: 'refuse' }, { kind: 'refuse' }, { kind: 'ok' }] } }));

    const strict = clean(s.run({ kind: 'fold' }, { window: 1 }));
    expect(statuses(strict)).toEqual({ 'pr-1': 'succeeded', 'pr-2': 'pending', 'pr-3': 'failed' });
    expect(strict.result.fold).toMatchObject({ status: 'failed', failed: ['pr-3'], cancelled: [], pending: ['pr-2'] });
    expect(strict.lines.filter((line) => line['t'] === 'trace' && line['helper'] === 'report')).toEqual([]);

    const waiting = clean(s.run({ kind: 'tally' }, { window: 1 }));
    expect(waiting.result.tally).toEqual({
      status: 'waiting',
      coverage: { succeeded: ['pr-1'], skipped: [], failed: ['pr-3'], cancelled: [], pending: ['pr-2'], openDiscovery: false, complete: false },
    });
    expect(tallies(waiting.lines)).toBe(0);
    expect(waiting.result.tallied).toBeNull();
    expect(s.publications('tally:acme/widget')).toEqual([]);

    clean(s.run({ kind: 'settle', operation: operationOf(waiting, 'pr-2'), action: 'abandon' }));
    const folded = clean(s.run({ kind: 'tally' }, { window: 1 }));
    expect(folded.result.tally).toMatchObject({
      status: 'folded',
      kind: 'published',
      coverage: { succeeded: ['pr-1', 'pr-2'], skipped: [], failed: ['pr-3'], cancelled: [], pending: [], openDiscovery: false, complete: true },
    });
    expect(folded.result.tallied).toEqual({ statuses: ['pr-1=succeeded', 'pr-2=succeeded', 'pr-3=failed'] });
    expect(tallies(folded.lines)).toBe(1);

    // pr-3's fourth request is answered: the repaired member changes the fold's input, so it runs again.
    const repaired = clean(s.run({ kind: 'tally' }, { window: 1 }));
    expect(repaired.assessed).toEqual(['pr-3']);
    expect(repaired.result.tally).toMatchObject({
      status: 'folded',
      kind: 'published',
      coverage: { succeeded: ['pr-1', 'pr-2', 'pr-3'], skipped: [], failed: [], cancelled: [], pending: [], openDiscovery: false, complete: true },
    });
    expect(repaired.result.tally?.reference).not.toBe(folded.result.tally?.reference);
    expect(repaired.result.tallied).toEqual({ statuses: ['pr-1=succeeded', 'pr-2=succeeded', 'pr-3=succeeded'] });
    expect(repaired.result.members['pr-1']).toMatchObject({ status: 'succeeded', kind: 'reused' });
    expect(repaired.result.members['pr-2']).toMatchObject({ status: 'succeeded', kind: 'reused' });

    const unchanged = clean(s.run({ kind: 'tally' }, { window: 1 }));
    expect(unchanged.assessed).toEqual([]);
    expect(tallies(unchanged.lines)).toBe(0);
    expect(unchanged.result.tally).toMatchObject({ status: 'folded', kind: 'reused', reference: repaired.result.tally?.reference });
    expect(s.keys('received')).toEqual(['pr-1', 'pr-2', 'pr-3', 'pr-3', 'pr-2', 'pr-3', 'pr-3']);
  });
});
