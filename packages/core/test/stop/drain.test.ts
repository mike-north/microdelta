/**
 * What a soft stop drains, through the assembled workspace path: the facade
 * over real Definition, Resolution, Supervision, Tracking and History on
 * SQLite (RUN-014; EXP-8 mechanism 1 and resolution 3; supervisor ruling on
 * nested children during a soft stop).
 *
 * The drain unit is the admitted step attempt: it keeps running, may issue
 * its remaining first-attempt requests, and publishes. Authors isolate each
 * paid call in its own child step (resolution 3), so a child call the body of
 * an admitted, draining step demands is part of that drain: it is admitted as
 * a first attempt, transitively, while its retries stay refused. Work that no
 * executing admitted body demands is new work and is cancelled. The spending
 * bound during a soft stop is an operator deadline or a hard stop, which
 * still interrupts the drain subtree; a child that already completed stays a
 * reusable result of its own.
 *
 * @see ../../../../docs/spec/operations.md (RUN-014, RUN-015)
 * @see ../../../../docs/plans/m5-operations.md (Selected execution contract: Stop, Reuse)
 * @see ../../../../experiments/exp-8/decision.md (mechanism 1, CX-1, resolution 3)
 */
import { afterEach, beforeEach, describe, expect, test } from '@jest/globals';

import { createStopController } from '../../src/index.js';
import { cleanup } from '../durable-history/support.js';
import { createWorld, installWorld } from './fixture.js';
import type { IWorld } from './fixture.js';
import { freshKey, openStopSession, runIn, runMembers, statuses } from './session.js';
import { attemptsAt, publishedSubjects, tempStore, turns, until } from './support.js';
import type { ITempStore } from './support.js';

let store: ITempStore;
let world: IWorld;

beforeEach(() => {
  store = tempStore();
  world = installWorld(createWorld());
});

afterEach(() => {
  cleanup();
  store.remove();
});

/** The durable attempt of `subject`, if any. */
const attemptOf = (subject: string): ReturnType<typeof attemptsAt>[number] | undefined => attemptsAt(store.location).find((row) => row.subject === subject);

describe('a draining parent obtains the children its body demands', () => {
  test('a parent that demands a new child after a soft stop obtains it and publishes', async () => {
    const session = openStopSession(store.location);
    const stop = createStopController();
    try {
      const running = runIn(session, { stop }, (run) => run.resolve(session.fixture.step('sequential'), { requestKey: freshKey() }));
      await until(() => world.provider.received.includes('child-1'), 'the first child is sending');
      stop.request({ level: 'soft' });
      world.provider.release('child-1');
      world.provider.release('child-2');
      const result = await running;
      expect(result.value.kind).toBe('published');
      // The second child was demanded only after the stop, and was sent as a first attempt.
      expect(world.provider.received).toEqual(['child-1', 'child-2']);
      expect(publishedSubjects(store.location)).toEqual(['c1:stop', 'c2:stop', 'sequential:stop']);
      expect(result.stop).toEqual({ level: 'soft', cause: 'operator', deadline: undefined });
    } finally {
      session.close();
    }
  });

  test('a child admitted during the drain may still not retry: its retry is refused, and neither it nor its parent publishes', async () => {
    const session = openStopSession(store.location);
    const stop = createStopController();
    try {
      world.provider.release('retrier:first');
      world.provider.release('retrier:retry');
      const running = runIn(session, { stop }, (run) => run.resolve(session.fixture.step('staged'), { requestKey: freshKey() }));
      await until(() => world.provider.received.includes('child-1'), 'the first child is sending');
      stop.request({ level: 'soft' });
      world.provider.release('child-1');
      await until(() => world.log.includes('awaiting-retry:retrier'), 'the child admitted during the drain has sent its first attempt');
      world.gates.open('retrier:retry-gate');
      const { value } = await running;
      expect(value).toMatchObject({ kind: 'refused', disposition: 'cancelled', refused: { slot: 'retrier' }, reason: expect.stringContaining('soft stop refuses retries') });
      expect(world.provider.received).toEqual(['child-1', 'retrier:first']);
      // The completed first child stays a reusable result of its own; nothing partial is published.
      expect(publishedSubjects(store.location)).toEqual(['c1:stop']);
      expect(attemptOf('retrier:stop')).toMatchObject({ state: 'interrupted', ending: 'stopped' });
      expect(attemptOf('staged:stop')).toMatchObject({ state: 'interrupted', ending: 'child-refused' });
    } finally {
      session.close();
    }
  });
});

describe('work no executing admitted body demands is new work', () => {
  test('a fan-out member that has not started when a soft stop lands is cancelled before any claim', async () => {
    const session = openStopSession(store.location);
    const stop = createStopController();
    try {
      // One lane: the second member has not started when the stop lands.
      const running = runMembers(session, { stop, window: 1 });
      await until(() => world.provider.received.includes('item:1'), 'the first member is sending');
      stop.request({ level: 'soft' });
      world.provider.release('item:1');
      const { value } = await running;
      expect(statuses(value)).toEqual({ 'item:1': 'succeeded', 'item:2': 'cancelled' });
      expect(value.members[1]).toMatchObject({ status: 'cancelled', reason: expect.stringContaining('soft stop') });
      expect(world.log).not.toContain('start:item:2');
      expect(attemptOf('work:stop:item:2')).toBeUndefined();
    } finally {
      session.close();
    }
  });

  test('a member already admitted when a soft stop lands drains: it waits for the permit, sends its first attempt and publishes', async () => {
    const session = openStopSession(store.location);
    const stop = createStopController();
    try {
      // Default options: one permit, and a window wide enough that both members are admitted.
      const running = runMembers(session, { stop });
      await until(() => world.log.includes('start:item:2') && world.provider.received.length === 1, 'one member sends while the other, admitted, waits for the permit');
      stop.request({ level: 'soft' });
      world.provider.release('item:1');
      world.provider.release('item:2');
      const { value } = await running;
      expect(statuses(value)).toEqual({ 'item:1': 'succeeded', 'item:2': 'succeeded' });
      expect(world.provider.received).toEqual(['item:1', 'item:2']);
      expect(world.provider.peak).toBe(1);
    } finally {
      session.close();
    }
  });
});

describe('an operator deadline or a hard stop bounds the drain subtree', () => {
  test.each(['deadline', 'hard'] as const)('%s: a child obtained during the drain is aborted mid-send; its completed sibling stays reusable and nothing partial publishes', async (escalation) => {
    const session = openStopSession(store.location);
    const stop = createStopController();
    try {
      const running = runIn(session, { stop }, (run) => run.resolve(session.fixture.step('sequential'), { requestKey: freshKey() }));
      await until(() => world.provider.received.includes('child-1'), 'the first child is sending');
      stop.request({ level: 'soft' });
      world.provider.release('child-1');
      await until(() => world.provider.received.includes('child-2'), 'the child demanded during the drain is sending');
      await turns(5);
      if (escalation === 'deadline') {
        stop.request({ level: 'soft', deadline: Date.now() + 30 });
      } else {
        stop.request({ level: 'hard' });
      }
      const result = await running;
      expect(result.value).toMatchObject({ kind: 'refused', disposition: 'cancelled' });
      expect(world.provider.aborted).toEqual(['child-2']);
      expect(world.provider.completed).toEqual(['child-1']);
      expect(result.interruptions).toEqual([{ label: 'child-2', remote: 'unknown' }]);
      expect(result.stop).toEqual({ level: 'hard', cause: escalation === 'deadline' ? 'deadline' : 'operator', deadline: undefined });
      expect(publishedSubjects(store.location)).toEqual(['c1:stop']);
      expect(attemptOf('c2:stop')).toMatchObject({ state: 'interrupted', ending: 'stopped' });
    } finally {
      session.close();
    }
  });
});
