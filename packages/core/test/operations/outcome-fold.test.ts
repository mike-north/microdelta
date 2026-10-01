/**
 * The owner ruling on #119 for outcome folds: an operation whose outcome is
 * unresolved (unknown, or awaiting an operator's resolve or abandon) counts
 * as **unsettled**. Its member stays pending, and every outcome fold over it
 * reports `waiting` with partial coverage instead of publishing; it is never
 * treated as failed or as succeeded.
 *
 * Outcome folds arrive with issue #120 (PR #133), which has not merged into
 * this branch's base. The strict-fold half of the ruling is proven now in
 * `replay.test.ts` ("keeps its member pending and a strict fold over it
 * waiting"). Once #133 merges, replace the to-do below with this test, using
 * an outcome fold declared over `pr`/`assess` in `fixture.ts`:
 *
 * 1. Script `assess` for pr-2 as `lost` (no safety basis), so pr-2's
 *    operation is unknown.
 * 2. `run.resolveOutcomeFold(fold, key)` reports pr-1 and pr-3 `succeeded`,
 *    pr-2 `pending` with `blocked: { kind: 'unknown-outcome', reason:
 *    'not-repeat-safe' }`, and the fold `waiting` with coverage naming pr-2
 *    as unsettled; the fold body never ran and nothing was published.
 * 3. After `run.settleOperation({ action: 'abandon', ... })`, the next run
 *    re-executes pr-2 and the outcome fold folds all three members.
 *
 * @see ../../../../docs/spec/operations.md (RUN-010 owner decision)
 */
import { describe, test } from '@jest/globals';

describe('an unknown operation counts as unsettled for outcome folds (owner ruling on #119)', () => {
  test.todo('enable after #133 merges: an outcome fold over a member with an unknown operation waits with partial coverage, never failed or succeeded');
});
