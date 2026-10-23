/** Focused consumer evidence for intent-before-send and canonical reports.
 * The receive hook snapshots authority before the fake provider can act;
 * the report test holds two real runtime lanes and settles them out of order.
 */
import { afterEach, beforeEach, expect, test } from '@jest/globals';

import { createWorld, installWorld } from './fixture.js';
import type { IWorld } from './fixture.js';
import { fakeTimer, openSession, tempStores, until } from './harness.js';
import type { IFakeTimer, IOperationStores } from './harness.js';
import { journalContents, members, received } from './support.js';

let stores: IOperationStores;
let timer: IFakeTimer;
let world: IWorld;

beforeEach(() => {
  stores = tempStores();
  timer = fakeTimer();
  world = installWorld(createWorld(() => timer.currentEpochMilliseconds()));
});
afterEach(() => stores.remove());

test('each send names the pending operation and usage intent already visible at the provider boundary', async () => {
  const session = openSession(stores, timer);
  const provider = world.provider;
  const snapshots: unknown[] = [];
  world.provider = {
    ...provider,
    perform: (name, key, send) => {
      // Snapshot before entering the provider: it has received and applied nothing yet.
      snapshots.push({ name, key, operation: send.operation, requestAttempt: send.requestAttempt,
        journal: journalContents(session), unknown: session.usage().unknown });
      return provider.perform(name, key, send);
    },
  };
  try {
    const result = await members(session, { permits: 1, window: 1, runId: 'run:boundary' }).done;
    expect(result.value.members.map((member) => member.status)).toEqual(['succeeded', 'succeeded', 'succeeded']);
    expect(snapshots).toHaveLength(3);
    for (const key of ['pr-1', 'pr-2', 'pr-3']) {
      const request = received(key)[0];
      expect(request).toBeDefined();
      expect(snapshots).toContainEqual(expect.objectContaining({
        name: 'assess', key, operation: request?.operation, requestAttempt: request?.requestAttempt,
        journal: expect.arrayContaining([expect.objectContaining({
          operation: request?.operation, member: key, status: 'pending',
          attempts: [expect.objectContaining({ requestAttempt: request?.requestAttempt, status: 'pending', run: 'run:boundary' })],
        })]),
        unknown: expect.arrayContaining([expect.objectContaining({ operation: request?.operation, requestAttempt: request?.requestAttempt })]),
      }));
    }
  } finally {
    session.close();
  }
});

test('a two-lane runtime reports exact canonical member identities despite out-of-order completion', async () => {
  world.keys = ['pr-3', 'pr-1', 'pr-2'];
  for (const key of world.keys) {
    world.provider.script('assess', key, ['hang']);
  }
  const session = openSession(stores, timer);
  try {
    const started = members(session, { permits: 2, window: 2 });
    await until(() => received('pr-1').length === 1 && received('pr-2').length === 1, 'two lanes reached the provider');
    expect(received('pr-3')).toHaveLength(0);
    world.provider.release('assess', 'pr-2');
    await until(() => received('pr-3').length === 1, 'the completed second member releases its lane');
    world.provider.release('assess', 'pr-3');
    await until(() => world.provider.inFlight === 1, 'only the first member remains in flight');
    world.provider.release('assess', 'pr-1');
    const result = await started.done;
    expect(result.value.members.map((member) => [member.key, member.status])).toEqual([
      ['pr-1', 'succeeded'], ['pr-2', 'succeeded'], ['pr-3', 'succeeded'],
    ]);
    expect(world.provider.peak).toBe(2);
  } finally {
    session.close();
  }
});
