/**
 * A request whose writer lease History no longer honours (it expired, as for
 * a drain that outlived it, or a successor took it over) writes nothing more
 * under it. Each step that needed a write ends with a typed `lease-lost`
 * denial, never a raw History error, and an attempt it had claimed stays
 * incomplete for the lease's successor to recover (EXP-8 ruling R, PUB-004).
 * The separate-process drain over the assembled path is in
 * `../operations/processes.test.ts`.
 *
 * @see ../../../../experiments/exp-8/decision.md (ruling R: draining versus lease expiry)
 * @see ../../../../docs/plans/m5-operations.md (drain outlives the lease TTL)
 */
import { afterEach, beforeEach, describe, expect, test } from '@jest/globals';

import { cleanup, freshLocation } from '../durable-history/support.js';
import { resetWorld, world } from './fixture.js';
import { advanceClock, leaseMilliseconds, openSession, referenceOf } from './support.js';
import type { ISession } from './support.js';

beforeEach(() => {
  resetWorld();
});
afterEach(cleanup);

/** History statement roles that write under the writer lease. */
const leaseWrites = ['allocate', 'stage', 'publish', 'accept', 'abandon'] as const;

/** The lease-requiring writes History executed since `start`. */
function writesSince(session: ISession, start: number): Readonly<Record<string, number>> {
  const { roles } = session.sqlite.evidence(start);
  return Object.fromEntries(leaseWrites.flatMap((role) => roles[role] === undefined ? [] : [[role, roles[role]]]));
}

/** Run one session around `body`. */
async function withSession<T>(location: string, body: (session: ISession) => Promise<T>): Promise<T> {
  const session = openSession(location);
  try {
    return await body(session);
  } finally {
    session.close();
  }
}

/** The typed denial of a step whose write the lease no longer authorizes. */
const leaseLost = { kind: 'refused', reason: 'lease-lost', disposition: 'denied' } as const;

describe('a request whose writer lease is no longer current (EXP-8 ruling R)', () => {
  test('the claim admitted work needs is not made: the step is denied lease-lost, its body never runs, and nothing is written', async () => {
    await withSession(freshLocation(), async (session) => {
      advanceClock(leaseMilliseconds + 1);
      const start = session.sqlite.mark();
      const outcome = await session.resolve(session.contributors.steps['person:ada'].activity);
      expect(outcome).toMatchObject({ ...leaseLost, refused: session.contributors.steps['person:ada'].activity });
      expect(world.checks['person:ada']).toBe(0);
      expect(writesSince(session, start)).toEqual({});
    });
  });

  test('the acceptance a valid cached result needs is not recorded: the step is denied lease-lost instead of reused', async () => {
    const location = freshLocation();
    const reference = await withSession(location, async (session) => referenceOf(await session.resolve(session.contributors.steps['person:ada'].activity)));
    await withSession(location, async (session) => {
      const acceptances = session.history.readAcceptances({ kind: 'completed-result', locator: reference }, 'env:fixture').length;
      advanceClock(leaseMilliseconds + 1);
      const start = session.sqlite.mark();
      const outcome = await session.resolve(session.contributors.steps['person:ada'].activity);
      expect(outcome).toMatchObject(leaseLost);
      expect(writesSince(session, start)).toEqual({});
      expect(session.history.readAcceptances({ kind: 'completed-result', locator: reference }, 'env:fixture')).toHaveLength(acceptances);
    });
  });

  test('a publication whose lease expired while the body ran is not committed: the attempt stays incomplete, the step is denied lease-lost, and the request writes nothing more', async () => {
    await withSession(freshLocation(), async (session) => {
      let start = 0;
      world.duringSummary = () => {
        advanceClock(leaseMilliseconds + 1);
        start = session.sqlite.mark();
      };
      const outcome = await session.resolve(session.contributors.steps['person:ada'].summary);
      expect(outcome).toMatchObject({ ...leaseLost, refused: session.contributors.steps['person:ada'].summary });
      expect(world.summaries['person:ada']).toBe(1);
      // History refused the staging write and the ending of the attempt: nothing was written.
      expect(writesSince(session, start)).toEqual({});
      expect(outcome.diagnostics).toEqual([expect.stringContaining('stays incomplete')]);
      // A later request under the same lease is denied before any work.
      const later = await session.resolve(session.contributors.steps['person:ben'].summary);
      expect(later).toMatchObject(leaseLost);
      expect(world.summaries['person:ben']).toBe(0);
    });
  });
});
