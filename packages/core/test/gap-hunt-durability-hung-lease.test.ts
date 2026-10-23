/**
 * RUN-015's selected workspace contract renews only between requests. A held
 * request must expire without an operator stop; wall-clock time is not work.
 * No progress-reporting API or suspended-body recovery is implied here.
 */
import { expect, test } from '@jest/globals';
import { createNodeClock } from '@microdelta/machine-node';

import { cleanup, openHistory } from './durable-history/support.js';
import { createWorld, installWorld } from './stop/fixture.js';
import { freshKey, logicalStore, openStopSession, runIn } from './stop/session.js';
import { attemptsAt, elapse, publishedSubjects, tempStore, until } from './stop/support.js';

test('a hung request receives no timer renewal without a stop; a successor fences its late output', async () => {
  const store = tempStore();
  const world = installWorld(createWorld(['item:1']));
  const session = openStopSession(store.location, { leaseMilliseconds: 150 });
  const probe = openHistory({ location: store.location, store: logicalStore, clock: createNodeClock() });
  try {
    const running = runIn(session, {}, (run) => run.resolve(session.fixture.instance('item:1'), { requestKey: freshKey() }));
    await until(() => world.provider.received.includes('item:1'), 'the request is held');
    const held = probe.currentWriter();
    expect(held).toBeDefined();
    await elapse(300);
    expect(probe.currentWriter()).toEqual(held);
    const successor = probe.acquireWriter({ holder: 'successor', leaseMilliseconds: 60_000 });
    expect(successor.kind).toBe('acquired');
    world.provider.release('item:1');
    expect((await running).value).toMatchObject({ kind: 'refused', reason: 'lease-lost', disposition: 'denied' });
    expect(publishedSubjects(store.location)).not.toContain('work:stop:item:1');
    expect(attemptsAt(store.location).find((row) => row.subject === 'work:stop:item:1')).toMatchObject({ state: 'allocated' });
    if (successor.kind !== 'acquired') { throw new Error('expected expired lease takeover'); }
    expect(probe.currentWriter()).toEqual(successor.lease);
  } finally {
    world.provider.release('item:1');
    session.close();
    cleanup();
    store.remove();
  }
});
