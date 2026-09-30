/**
 * Bounded nested waiting under run cancellation (#106) and run-scoped
 * lifecycle isolation (A-18) through the assembled workspace path.
 *
 * #106: a nested memo waits for every call it started to settle before its
 * attempt ends, so a child write never races the ending. That wait is bounded
 * by run cancellation: a child that never settles is abandoned through the
 * cancellation contract when a hard stop takes effect, the parent ends with an
 * honest cancelled or failed outcome and never a partial publication, and a
 * body that throws while children hang reports its own error. There is no
 * default deadline, so without a stop the wait continues.
 *
 * A-18: concurrent runs in one process keep their own context and execution
 * controls; a thrown nested frame restores its parent's attribution; a
 * callback that escaped a closed run fails clearly instead of attributing
 * work to it.
 *
 * @see https://github.com/mike-north/microdelta/issues/106
 * @see ../../../../docs/spec/operations.md (RUN-001, RUN-014)
 * @see ../../../../docs/spec/acceptance.md (A-18)
 */
import { afterEach, beforeEach, describe, expect, test } from '@jest/globals';

import { ResolutionError, createStopController, currentExecution, currentRun } from '../../src/index.js';
import { cleanup } from '../durable-history/support.js';
import { createWorld, installWorld } from './fixture.js';
import type { IWorld } from './fixture.js';
import { freshKey, openStopSession, runIn, runMembers, statuses } from './session.js';
import { attemptsAt, deferred, elapse, publishedSubjects, tempStore, turns, until } from './support.js';
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

/** The error code a promise settles with, if it rejects with a coded error. */
async function settledCode(promise: Promise<unknown>): Promise<string | undefined> {
  try {
    await promise;
  } catch (error: unknown) {
    const code: unknown = typeof error === 'object' && error !== null ? Reflect.get(error, 'code') : undefined;
    return typeof code === 'string' ? code : `uncoded: ${String(error)}`;
  }
  return undefined;
}

describe('bounded nested waiting under run cancellation (#106)', () => {
  test('a never-settling nested call keeps its parent waiting until a hard stop, which ends it cancelled without publishing', async () => {
    const session = openStopSession(store.location);
    const stop = createStopController();
    let settled = false;
    try {
      const running = runIn(session, { stop }, (run) => run.resolve(session.fixture.step('hanging'), { requestKey: freshKey() })).finally(() => {
        settled = true;
      });
      await until(() => world.log.includes('child:0'), 'the hanging child is running');
      // No default deadline: without a stop the parent keeps waiting.
      await elapse(50);
      await turns(20);
      expect(settled).toBe(false);
      stop.request({ level: 'hard' });
      const { value } = await running;
      expect(value).toMatchObject({ kind: 'refused', disposition: 'cancelled', refused: { slot: 'hanging' } });
      expect(publishedSubjects(store.location)).toEqual([]);
      const endings = attemptsAt(store.location).map((row) => `${row.subject}:${row.state}:${String(row.ending)}`);
      expect(endings).toEqual(['hanging:stop:interrupted:stopped', 'stuck:stop:interrupted:stopped']);
    } finally {
      session.close();
    }
  });

  test('a body that throws while a child hangs reports its own error once cancellation bounds the wait', async () => {
    const session = openStopSession(store.location);
    const stop = createStopController();
    let settled = false;
    try {
      const running = runIn(session, { stop }, (run) => run.resolve(session.fixture.step('throwing'), { requestKey: freshKey() })).finally(() => {
        settled = true;
      });
      await until(() => world.log.includes('child:0'), 'the hanging child is running');
      await elapse(50);
      await turns(20);
      expect(settled).toBe(false);
      stop.request({ level: 'hard' });
      const failure = await running.then(() => undefined, (error: unknown) => error);
      expect(failure).toBeInstanceOf(ResolutionError);
      expect(failure).toMatchObject({ code: 'execution-failure' });
      expect(failure instanceof Error ? failure.message : '').toMatch(/body failure/u);
      expect(publishedSubjects(store.location)).toEqual([]);
      expect(attemptsAt(store.location).find((row) => row.subject === 'throwing:stop')).toMatchObject({ state: 'failed' });
    } finally {
      session.close();
    }
  });
});

describe('run-scoped lifecycle isolation (A-18)', () => {
  test('concurrent runs in one process keep their own context and controls: stopping one never reaches the other', async () => {
    const other = tempStore();
    const first = openStopSession(store.location);
    const second = openStopSession(other.location);
    const firstStop = createStopController();
    const secondStop = createStopController();
    world.keys = ['item:1'];
    try {
      const seen: string[] = [];
      const firstRun = runIn(first, { stop: firstStop }, async (run) => {
        seen.push(`first:${currentRun().runId === run.context.runId ? 'own-context' : 'leaked'}`);
        const report = await run.resolveMembers({ template: 'item', step: 'work' }, { requestKey: freshKey() });
        seen.push(`first:${currentExecution().runId === run.context.runId ? 'own-controls' : 'leaked'}`);
        return report;
      });
      await until(() => world.provider.received.length === 1, 'the first run is sending');
      const secondRun = runIn(second, { stop: secondStop }, async (run) => {
        seen.push(`second:${currentRun().runId === run.context.runId ? 'own-context' : 'leaked'}`);
        const report = await run.resolveMembers({ template: 'item', step: 'work' }, { requestKey: freshKey() });
        seen.push(`second:${currentExecution().stop.level}`);
        return report;
      });
      await until(() => world.provider.received.length === 2, 'the second run is sending');
      firstStop.request({ level: 'hard' });
      const firstResult = await firstRun;
      world.provider.release('item:1');
      const secondResult = await secondRun;
      expect(statuses(firstResult.value)).toEqual({ 'item:1': 'cancelled' });
      expect(statuses(secondResult.value)).toEqual({ 'item:1': 'succeeded' });
      expect(world.provider.aborted).toEqual(['item:1']);
      expect(secondResult.stop.level).toBe('none');
      expect(seen).toEqual(['first:own-context', 'second:own-context', 'first:own-controls', 'second:none']);
      expect(publishedSubjects(other.location)).toContain('work:stop:item:1');
      expect(publishedSubjects(store.location)).not.toContain('work:stop:item:1');
    } finally {
      first.close();
      second.close();
      other.remove();
    }
  });

  test('a thrown nested frame restores its parent\'s attribution and run context', async () => {
    const session = openStopSession(store.location);
    try {
      const failure = await runIn(session, {}, (run) => run.resolve(session.fixture.step('attributed'), { requestKey: freshKey() })).then(() => undefined, (error: unknown) => error);
      expect(world.log).toEqual(['parent-before@attributed:same-run', 'failing-7@failing:same-run', 'parent-after-failed@attributed:same-run']);
      // A body that swallowed a failed child still cannot publish.
      expect(failure).toMatchObject({ code: 'execution-failure' });
    } finally {
      session.close();
    }
  });

  test('a callback that escaped a closed run fails clearly and sends nothing', async () => {
    world.keys = ['item:1'];
    world.plans['item:1'] = 'keep';
    const session = openStopSession(store.location);
    const gate = deferred();
    let escaped: Promise<string | undefined> | undefined;
    try {
      const { value } = await runMembers(session);
      expect(statuses(value)).toEqual({ 'item:1': 'succeeded' });
      await runIn(session, {}, async () => {
        escaped = settledCode(gate.promise.then(() => currentExecution()));
      });
      gate.resolve();
      expect(await escaped).toBe('run-closed');
      const kept = world.kept;
      expect(kept).toBeDefined();
      if (kept !== undefined) {
        expect(await settledCode(kept.send({ label: 'late', perform: world.provider.request('late', 1) }))).toBe('run-closed');
        expect(await settledCode(kept.sleepUntil(Date.now() + 10))).toBe('run-closed');
      }
      expect(world.provider.received).toEqual([]);
      expect(await settledCode(Promise.resolve().then(() => currentExecution()))).toBe('outside-run');
    } finally {
      session.close();
    }
  });
});
