/**
 * The permit pool and operator stop control through the assembled workspace
 * path: the facade over real Definition, Resolution, Supervision, Tracking and
 * History on SQLite, with steps that send to a stub provider through
 * `currentExecution()` (RUN-002, RUN-014, RUN-015, A-13; EXP-8 mechanisms 1
 * and 2 and ruling R).
 *
 * Expected outcomes are derived from the owner decisions and the selected
 * execution contract, not from the implementation:
 *
 * - members run concurrently up to the permit bound; a permit guards only a
 *   real send, and waiting (for a permit, for children, for a time) holds none;
 * - after a soft stop nothing new is admitted and nothing is retried; an
 *   admitted step drains and publishes, with no default deadline;
 * - an operator deadline or a hard stop escalates: sends, permit waits and
 *   waits for a time are aborted, the attempt ends interrupted, the remote
 *   state is recorded, and returned but uncommitted output is discarded;
 * - a drain that outlives the writer lease cannot publish, and a successor's
 *   lease is untouched.
 *
 * @see ../../../../docs/spec/operations.md (RUN-002, RUN-014, RUN-015)
 * @see ../../../../docs/spec/acceptance.md (A-13)
 * @see ../../../../docs/plans/m5-operations.md (Selected execution contract; planned evidence `soft-then-hard-stop`, `drain-outlives-lease`)
 * @see ../../../../experiments/exp-8/decision.md (ruling R)
 */
import { afterEach, beforeEach, describe, expect, test } from '@jest/globals';
import { createNodeClock } from '@microdelta/machine-node';

import { createStopController } from '../../src/index.js';
import type { IRunEvent } from '../../src/index.js';
import { cleanup, openHistory } from '../durable-history/support.js';
import { createWorld, installWorld } from './fixture.js';
import type { IWorld } from './fixture.js';
import { controlEvents, freshKey, logicalStore, openStopSession, runIn, runMembers, statuses } from './session.js';
import { attemptsAt, elapse, publishedSubjects, tempStore, turns, until } from './support.js';
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

/** The member `work` subjects, as History records them. */
const workSubject = (key: string): string => `work:stop:${key}`;

describe('the permit pool (RUN-002)', () => {
  test('members run concurrently up to the permit bound, and every member completes', async () => {
    world = installWorld(createWorld(['item:1', 'item:2', 'item:3', 'item:4', 'item:5']));
    const session = openStopSession(store.location);
    try {
      const running = runMembers(session, { permits: 2 });
      await until(() => world.provider.received.length === 2, 'two sends are in flight');
      await turns(20);
      // The default window (independent of permits) starts every member; only the two permitted sends are in flight.
      expect(world.provider.received).toEqual(['item:1', 'item:2']);
      expect(world.log.filter((entry) => entry.startsWith('start:'))).toEqual(['start:item:1', 'start:item:2', 'start:item:3', 'start:item:4', 'start:item:5']);
      for (const key of world.keys) {
        await until(() => world.provider.received.includes(key), `${key} is sent`);
        world.provider.release(key);
      }
      const { value } = await running;
      expect(statuses(value)).toEqual({ 'item:1': 'succeeded', 'item:2': 'succeeded', 'item:3': 'succeeded', 'item:4': 'succeeded', 'item:5': 'succeeded' });
      expect(world.provider.peak).toBe(2);
    } finally {
      session.close();
    }
  });

  test('a permit guards only the send: with a wider window every member starts, and only the permitted sends are in flight', async () => {
    world = installWorld(createWorld(['item:1', 'item:2', 'item:3', 'item:4']));
    const session = openStopSession(store.location);
    try {
      const running = runMembers(session, { permits: 2, window: 4 });
      await until(() => world.log.filter((entry) => entry.startsWith('start:')).length === 4, 'every member body has started');
      await turns(20);
      // Four admitted bodies wait; only two hold permits.
      expect(world.provider.inFlight).toBe(2);
      for (const key of world.keys) {
        world.provider.release(key);
      }
      expect(Object.values(statuses((await running).value))).toEqual(['succeeded', 'succeeded', 'succeeded', 'succeeded']);
      expect(world.provider.peak).toBe(2);
    } finally {
      session.close();
    }
  });

  test('a nested group completes with a single permit: a parent waiting for its children holds none', async () => {
    const session = openStopSession(store.location);
    try {
      for (const label of ['child-1', 'child-2', 'child-3']) {
        world.provider.release(label);
      }
      const { value } = await runIn(session, { permits: 1 }, (run) => run.resolve(session.fixture.step('fanout'), { requestKey: freshKey() }));
      expect(value.kind).toBe('published');
      expect([...world.provider.received].sort()).toEqual(['child-1', 'child-2', 'child-3']);
      expect(world.provider.peak).toBe(1);
    } finally {
      session.close();
    }
  });

  test('a member waiting for a time holds no permit: a sibling sends and publishes meanwhile', async () => {
    world.plans['item:1'] = 'sleep';
    world.wakeAt = Date.now() + 150;
    const session = openStopSession(store.location);
    try {
      world.provider.release('item:2');
      const { value } = await runMembers(session, { permits: 1, window: 2 });
      expect(statuses(value)).toEqual({ 'item:1': 'succeeded', 'item:2': 'succeeded' });
      // The sibling's send completed while the first member was still waiting.
      expect(world.log.indexOf('woke:item:1')).toBeGreaterThan(world.log.indexOf('start:item:2'));
      expect(world.provider.completed).toEqual(['item:2']);
    } finally {
      session.close();
    }
  });
});

describe('the bounded active window: a wait holds neither a permit nor a lane (RUN-002, RUN-011)', () => {
  test('under the default options a member waiting for a time lets a sibling start and complete meanwhile', async () => {
    world.plans['item:1'] = 'sleep';
    world.wakeAt = Date.now() + 300;
    const session = openStopSession(store.location);
    try {
      world.provider.release('item:2');
      const running = runMembers(session);
      await until(() => world.provider.completed.includes('item:2'), 'the sibling has started and completed');
      expect(world.log).not.toContain('woke:item:1');
      const { value } = await running;
      expect(statuses(value)).toEqual({ 'item:1': 'succeeded', 'item:2': 'succeeded' });
      expect(world.log.indexOf('woke:item:1')).toBeGreaterThan(world.log.indexOf('start:item:2'));
    } finally {
      session.close();
    }
  });

  test('a woken member resumes only once a lane is free, so the window is never exceeded', async () => {
    world.plans['item:1'] = 'sleep';
    world.wakeAt = Date.now() + 50;
    const session = openStopSession(store.location);
    try {
      const running = runMembers(session, { window: 1 });
      // The sleeping member lent its only lane: the sibling starts and sends.
      await until(() => world.provider.received.includes('item:2'), 'the sibling holds the lane and is sending');
      await elapse(150);
      await turns(20);
      // Its time has come, but the lane is taken: it has not resumed.
      expect(world.log).not.toContain('woke:item:1');
      world.provider.release('item:2');
      const { value } = await running;
      expect(statuses(value)).toEqual({ 'item:1': 'succeeded', 'item:2': 'succeeded' });
      expect(world.log).toEqual(['start:item:1', 'sleeping:item:1', 'start:item:2', 'woke:item:1']);
    } finally {
      session.close();
    }
  });
});

describe('soft stop: no admission or retry, and admitted steps drain (RUN-014)', () => {
  test('an in-flight step drains and publishes; a queued member is never admitted or sent', async () => {
    const session = openStopSession(store.location);
    const stop = createStopController();
    const events: IRunEvent[] = [];
    try {
      // One lane, so the second member has not started when the stop lands.
      const running = runMembers(session, { stop, window: 1, observers: [{ observe: (event) => events.push(event) }] });
      await until(() => world.provider.received.includes('item:1'), 'the first member is sending');
      stop.request({ level: 'soft' });
      world.provider.release('item:1');
      const result = await running;
      expect(statuses(result.value)).toEqual({ 'item:1': 'succeeded', 'item:2': 'cancelled' });
      expect(result.value.members[1]).toMatchObject({ status: 'cancelled', reason: expect.stringContaining('soft stop') });
      expect(world.provider.received).toEqual(['item:1']);
      expect(world.log).not.toContain('start:item:2');
      expect(publishedSubjects(store.location)).toContain(workSubject('item:1'));
      // The queued member was refused before any claim: it has no attempt at all.
      expect(attemptsAt(store.location).map((row) => row.subject)).not.toContain(workSubject('item:2'));
      expect(result.stop).toEqual({ level: 'soft', cause: 'operator', deadline: undefined });
      expect(controlEvents(events)).toEqual(['send:item:1:begin', 'stop:soft:operator', 'send:item:1:end']);
    } finally {
      session.close();
    }
  });

  test('a new request after a soft stop is refused before any work', async () => {
    const session = openStopSession(store.location);
    const stop = createStopController();
    try {
      const { value } = await runIn(session, { stop }, (run) => {
        stop.request({ level: 'soft' });
        return run.resolve(session.fixture.step('fanout'), { requestKey: freshKey() });
      });
      expect(value).toMatchObject({ kind: 'refused', disposition: 'cancelled' });
      expect(world.provider.received).toEqual([]);
      expect(attemptsAt(store.location).filter((row) => row.subject === 'fanout:stop')).toEqual([]);
    } finally {
      session.close();
    }
  });

  test('a retry after a soft stop is refused without sending, and the step publishes nothing', async () => {
    world.plans['item:1'] = 'retry';
    world.keys = ['item:1'];
    const session = openStopSession(store.location);
    const stop = createStopController();
    try {
      world.provider.release('item:1:first');
      world.provider.release('item:1:retry');
      const running = runMembers(session, { stop });
      await until(() => world.log.includes('awaiting-retry:item:1'), 'the first attempt has completed');
      stop.request({ level: 'soft' });
      world.gates.open('item:1:retry-gate');
      const { value } = await running;
      expect(statuses(value)).toEqual({ 'item:1': 'cancelled' });
      expect(world.provider.received).toEqual(['item:1:first']);
      expect(publishedSubjects(store.location)).not.toContain(workSubject('item:1'));
      expect(attemptsAt(store.location).find((row) => row.subject === workSubject('item:1'))).toMatchObject({ state: 'interrupted', ending: 'stopped' });
    } finally {
      session.close();
    }
  });

  test('the drain has no default deadline: the admitted step keeps running until it completes', async () => {
    world.keys = ['item:1'];
    const session = openStopSession(store.location);
    const stop = createStopController();
    try {
      const running = runMembers(session, { stop });
      await until(() => world.provider.received.includes('item:1'), 'the member is sending');
      stop.request({ level: 'soft' });
      await elapse(100);
      await turns(20);
      expect(world.provider.aborted).toEqual([]);
      expect(stop.state).toEqual({ level: 'soft', cause: 'operator', deadline: undefined });
      world.provider.release('item:1');
      const { value } = await running;
      expect(statuses(value)).toEqual({ 'item:1': 'succeeded' });
      expect(publishedSubjects(store.location)).toContain(workSubject('item:1'));
    } finally {
      session.close();
    }
  });
});

describe('deadline and hard stop (RUN-014, RUN-015)', () => {
  test('an operator deadline escalates an unfinished drain to a hard stop that aborts the send', async () => {
    world.keys = ['item:1'];
    const session = openStopSession(store.location);
    const stop = createStopController();
    try {
      const running = runMembers(session, { stop });
      await until(() => world.provider.received.includes('item:1'), 'the member is sending');
      stop.request({ level: 'soft', deadline: Date.now() + 30 });
      const result = await running;
      expect(statuses(result.value)).toEqual({ 'item:1': 'cancelled' });
      expect(world.provider.aborted).toEqual(['item:1']);
      expect(result.stop).toEqual({ level: 'hard', cause: 'deadline', deadline: undefined });
      expect(result.interruptions).toEqual([{ label: 'item:1', remote: 'unknown' }]);
      expect(publishedSubjects(store.location)).not.toContain(workSubject('item:1'));
      expect(attemptsAt(store.location).find((row) => row.subject === workSubject('item:1'))).toMatchObject({ state: 'interrupted', ending: 'stopped' });
    } finally {
      session.close();
    }
  });

  test.each([
    ['cancelled', 'cancelled'],
    ['running', 'running'],
    [undefined, 'unknown'],
  ] as const)('a hard stop aborts a body mid-send and records the remote state (provider answers %s)', async (cancel, remote) => {
    world.keys = ['item:1'];
    world.cancel = cancel;
    const session = openStopSession(store.location);
    const stop = createStopController();
    const events: IRunEvent[] = [];
    try {
      const running = runMembers(session, { stop, observers: [{ observe: (event) => events.push(event) }] });
      await until(() => world.provider.received.includes('item:1'), 'the member is sending');
      stop.request({ level: 'hard' });
      const result = await running;
      expect(statuses(result.value)).toEqual({ 'item:1': 'cancelled' });
      expect(result.interruptions).toEqual([{ label: 'item:1', remote }]);
      expect(controlEvents(events)).toEqual([
        'send:item:1:begin',
        'stop:hard:operator',
        'send:item:1:aborted',
        ...(cancel === undefined ? [] : ['send:item:1:cancel-requested']),
        `send:item:1:remote-state:${remote}`,
      ]);
      expect(attemptsAt(store.location).find((row) => row.subject === workSubject('item:1'))).toMatchObject({ state: 'interrupted', ending: 'stopped' });
      expect(publishedSubjects(store.location)).not.toContain(workSubject('item:1'));
    } finally {
      session.close();
    }
  });

  test('a hard stop reaches a member waiting for a permit: it never sends', async () => {
    const session = openStopSession(store.location);
    const stop = createStopController();
    try {
      const running = runMembers(session, { stop, permits: 1, window: 2 });
      await until(() => world.log.includes('start:item:2') && world.provider.received.length === 1, 'one member sends while the other waits for the permit');
      stop.request({ level: 'hard' });
      const result = await running;
      expect(statuses(result.value)).toEqual({ 'item:1': 'cancelled', 'item:2': 'cancelled' });
      expect(world.provider.received).toEqual(['item:1']);
      expect(result.interruptions).toEqual([{ label: 'item:1', remote: 'unknown' }]);
    } finally {
      session.close();
    }
  });

  test('a hard stop ends a wait for a time at once', async () => {
    world.keys = ['item:1'];
    world.plans['item:1'] = 'sleep';
    world.wakeAt = Date.now() + 60 * 60 * 1_000;
    const session = openStopSession(store.location);
    const stop = createStopController();
    try {
      const started = Date.now();
      const running = runMembers(session, { stop });
      await until(() => world.log.includes('sleeping:item:1'), 'the member is waiting');
      stop.request({ level: 'hard' });
      const result = await running;
      expect(statuses(result.value)).toEqual({ 'item:1': 'cancelled' });
      expect(world.log).not.toContain('woke:item:1');
      expect(Date.now() - started).toBeLessThan(10_000);
    } finally {
      session.close();
    }
  });

  test('output a body returns after a hard stop is discarded, never published (CX-2)', async () => {
    world.keys = ['item:1'];
    world.plans['item:1'] = 'ignore-stop';
    const session = openStopSession(store.location);
    const stop = createStopController();
    try {
      const running = runMembers(session, { stop });
      await until(() => world.log.includes('ignoring:item:1'), 'the body is running');
      stop.request({ level: 'hard' });
      const result = await running;
      // The body ignored the signal; it now returns complete output after the stop.
      world.gates.open('item:1:output');
      await until(() => world.log.includes('returned:item:1'), 'the detached body has returned');
      await turns(20);
      expect(statuses(result.value)).toEqual({ 'item:1': 'cancelled' });
      expect(publishedSubjects(store.location)).not.toContain(workSubject('item:1'));
      expect(attemptsAt(store.location).find((row) => row.subject === workSubject('item:1'))).toMatchObject({ state: 'interrupted', ending: 'stopped' });
    } finally {
      session.close();
    }
  });
});

describe('a drain that outlives the writer lease cannot publish (ruling R)', () => {
  test.each(['a successor takes the lease over', 'the lease simply expires'] as const)('%s: the late completion publishes nothing', async (situation) => {
    world.keys = ['item:1'];
    const leaseMilliseconds = 150;
    const session = openStopSession(store.location, { leaseMilliseconds });
    const stop = createStopController();
    try {
      const running = runIn(session, { stop }, (run) => run.resolve(session.fixture.instance('item:1'), { requestKey: freshKey() }));
      await until(() => world.provider.received.includes('item:1'), 'the member is sending');
      stop.request({ level: 'soft' });
      await elapse(leaseMilliseconds + 150);
      const probe = openHistory({ location: store.location, store: logicalStore, clock: createNodeClock() });
      const successor = situation === 'a successor takes the lease over' ? probe.acquireWriter({ holder: 'successor', leaseMilliseconds: 60_000 }) : undefined;
      if (successor !== undefined) {
        expect(successor.kind).toBe('acquired');
      }
      world.provider.release('item:1');
      const failure = await running.then(() => undefined, (error: unknown) => error);
      expect(failure).toMatchObject({ name: 'StaleWriterError' });
      expect(publishedSubjects(store.location)).not.toContain(workSubject('item:1'));
      if (successor?.kind === 'acquired') {
        expect(probe.currentWriter()).toEqual(successor.lease);
      }
      // The late completion made no durable write: its attempt stays incomplete and recoverable.
      expect(attemptsAt(store.location).find((row) => row.subject === workSubject('item:1'))).toMatchObject({ state: 'allocated' });
    } finally {
      session.close();
    }
  });
});
