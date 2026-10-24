/**
 * Ruling R, RUN-014 and PUB-002 through the actual facade: establish a send,
 * then force lease expiry or successor ownership before late completion.
 * Only Node's wall-clock readings are controlled. Timers, owner composition,
 * SQLite, renewal, fencing, stop and publication behavior remain real.
 */
import { afterEach, beforeEach, describe, expect, jest, test } from '@jest/globals';
import { performance } from 'node:perf_hooks';
import { createNodeClock } from '@microdelta/machine-node';
import { createStopController } from '../../src/index.js';
import { cleanup, openHistory } from '../durable-history/support.js';
import { createWorld, installWorld } from './fixture.js';
import type { IWorld } from './fixture.js';
import { untilRunReaches, within } from './lease-boundary.js';
import { freshKey, logicalStore, openStopSession, runIn } from './session.js';
import { attemptsAt, publishedSubjects, tempStore } from './support.js';
import type { ITempStore } from './support.js';

let store: ITempStore;
let world: IWorld;
beforeEach(() => { store = tempStore(); world = installWorld(createWorld(['item:1'])); });
afterEach(() => { cleanup(); store.remove(); });

/** The work subject whose publication would incorrectly authorize a stale writer. */
const workSubject = 'work:stop:item:1';

describe('a drain that outlives the writer lease cannot publish (ruling R)', () => {
  test.each(['a successor takes the lease over', 'the lease simply expires'] as const)('%s: the late completion publishes nothing and the request is denied lease-lost', async (situation) => {
    const leaseMilliseconds = 150;
    let now = 1_000;
    const wallClock = jest.spyOn(Date, 'now').mockImplementation(() => now);
    const stop = createStopController();
    let closeSession: (() => void) | undefined;
    let running: Promise<unknown> | undefined;
    try {
      const session = openStopSession(store.location, { leaseMilliseconds });
      closeSession = () => { session.close(); };
      const probe = openHistory({ location: store.location, store: logicalStore, clock: createNodeClock() });
      let delayedSetup = false;
      let setupElapsed = 0;
      const started = runIn(session, { stop, observers: [{ observe(event) {
        if (!delayedSetup && event.kind === 'step' && event.event.phase === 'verify') {
          delayedSetup = true;
          expect(probe.currentWriter()).toMatchObject({ expiresAt: now + leaseMilliseconds });
          // Deliberate synchronous setup cost exceeds the old lease budget. Real
          // elapsed time cannot consume the controlled post-send loss boundary.
          const before = performance.now();
          expect(Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 250)).toBe('timed-out');
          setupElapsed = performance.now() - before;
        }
      } }] }, (run) => run.resolve(session.fixture.instance('item:1'), { requestKey: freshKey() }));
      running = started;
      await untilRunReaches(started, () => world.provider.received.includes('item:1'), 'the member is sending');
      expect(delayedSetup).toBe(true);
      expect(setupElapsed).toBeGreaterThan(leaseMilliseconds);
      expect(world.provider.received).toEqual(['item:1']);
      expect(world.provider.completed).toEqual([]);
      const held = probe.currentWriter();
      expect(held).toBeDefined();
      if (held === undefined) { throw new Error('Sending member must hold a writer lease'); }
      expect(held.expiresAt).toBeGreaterThan(now);
      const attemptBeforeLoss = attemptsAt(store.location).find((row) => row.subject === workSubject);
      expect(attemptBeforeLoss).toMatchObject({ state: 'allocated' });
      stop.request({ level: 'soft' });
      now = held.expiresAt;
      expect(createNodeClock().currentEpochMilliseconds()).toBe(held.expiresAt);
      const successor = situation === 'a successor takes the lease over' ? probe.acquireWriter({ holder: 'successor', leaseMilliseconds: 60_000 }) : undefined;
      if (situation === 'a successor takes the lease over') { expect(successor?.kind).toBe('acquired'); }
      else { expect(probe.currentWriter()).toEqual(held); }
      world.provider.release('item:1');
      const result = await within(started, 'late completion after lease loss');
      expect(world.provider.completed).toEqual(['item:1']);
      expect(result.value).toMatchObject({ kind: 'refused', reason: 'lease-lost', disposition: 'denied' });
      expect(publishedSubjects(store.location)).not.toContain(workSubject);
      expect(attemptsAt(store.location).find((row) => row.subject === workSubject)).toEqual(attemptBeforeLoss);
      if (successor?.kind === 'acquired') { expect(probe.currentWriter()).toEqual(successor.lease); }
    } finally {
      try {
        stop.request({ level: 'hard' });
        world.provider.release('item:1');
        if (running !== undefined) { await within(running.catch(() => undefined), 'lease-drain cleanup'); }
      } finally {
        try { closeSession?.(); } finally { wallClock.mockRestore(); }
      }
    }
  });
});
