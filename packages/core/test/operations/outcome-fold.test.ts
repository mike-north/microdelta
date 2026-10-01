/**
 * The owner ruling on #119 for outcome folds: an operation whose outcome is
 * unresolved (unknown, or awaiting an operator's resolve or abandon) counts
 * as **unsettled**. Its member stays pending, and every outcome fold over it
 * reports `waiting` with partial coverage instead of publishing; it is never
 * treated as failed or as succeeded. Settling the operation lets the member
 * execute again, after which the outcome fold folds the complete set.
 *
 * The strict-fold half of the ruling is proven in `replay.test.ts` ("keeps
 * its member pending and a strict fold over it waiting").
 *
 * @see ../../../../docs/spec/operations.md (RUN-010 owner decision, RUN-012)
 * @see ../../../../experiments/exp-8/decision.md (resolution 5)
 */
import { afterEach, beforeEach, describe, expect, test } from '@jest/globals';

import { analysis, createWorld, installWorld } from './fixture.js';
import type { IWorld } from './fixture.js';
import { fakeTimer, openSession, production, statuses, tempStores } from './harness.js';
import type { IFakeTimer, IOperationStores } from './harness.js';
import { memberOf, outcomeFold, received } from './support.js';

let stores: IOperationStores;
let timer: IFakeTimer;
let world: IWorld;

beforeEach(() => {
  stores = tempStores();
  timer = fakeTimer();
  world = installWorld(createWorld(() => timer.currentEpochMilliseconds()));
});

afterEach(() => {
  stores.remove();
});

describe('an unknown operation counts as unsettled for outcome folds (owner ruling on #119)', () => {
  test('an outcome fold over a member with an unknown operation waits with partial coverage, never publishing, and folds the complete set once an operator settles it', async () => {
    world.provider.script('assess', 'pr-2', ['lost', 'ok']);
    const session = openSession(stores, timer);
    try {
      const first = await outcomeFold(session).done;
      expect(statuses(first.value.members)).toEqual({ 'pr-1': 'succeeded', 'pr-2': 'pending', 'pr-3': 'succeeded' });
      const pr2 = memberOf(first.value, 'pr-2');
      const operation = received('pr-2')[0]?.operation;
      expect(pr2.status === 'pending' ? pr2.blocked : undefined).toEqual({ kind: 'unknown-outcome', operation, reason: 'not-repeat-safe' });
      // Unsettled, so the outcome fold waits: pr-2 is neither failed nor succeeded.
      expect(first.value.outcome).toEqual({
        status: 'waiting',
        coverage: { succeeded: ['pr-1', 'pr-3'], skipped: [], failed: [], cancelled: [], pending: ['pr-2'], openDiscovery: false, complete: false },
      });
      // Its body never ran and nothing was published.
      expect(world.log.filter((line) => line.startsWith('tally:'))).toEqual([]);
      expect(session.history.readCurrent({ analysis, environment: production, subject: 'tally:acme/widget' })).toBeUndefined();

      // A later pass still waits: the operation stays unsettled until an operator settles it.
      const again = await outcomeFold(session).done;
      expect(again.value.outcome.status).toBe('waiting');
      expect(received('pr-2')).toHaveLength(1);

      if (operation === undefined) {
        throw new Error('pr-2 was never sent');
      }
      await session.start({}, (run) => run.settleOperation({ action: 'abandon', operation, operator: 'operator.ada' })).done;
      const settled = await outcomeFold(session).done;
      expect(statuses(settled.value.members)).toEqual({ 'pr-1': 'succeeded', 'pr-2': 'succeeded', 'pr-3': 'succeeded' });
      expect(settled.value.outcome).toEqual({ status: 'folded', outcome: expect.objectContaining({ kind: 'published' }) });
      expect(world.log.filter((line) => line.startsWith('tally:'))).toEqual(['tally:pr-1=succeeded,pr-2=succeeded,pr-3=succeeded']);
    } finally {
      session.close();
    }
  });
});
