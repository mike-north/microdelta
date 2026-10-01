/**
 * Reuse Resolution against Run Supervision's cancellation port and fan-out
 * window, driven by a scripted port over real durable History, so each rule
 * is exercised at the exact point Resolution consults it:
 *
 * - an admitted body whose supervised execution is interrupted ends its
 *   attempt interrupted (ending `stopped`) and publishes nothing (RUN-015);
 * - a publication refusal consulted immediately before the commit discards
 *   output the body already returned (EXP-8 resolution 2: a hard stop
 *   effective before the commit forbids publication);
 * - a refusal landing at any moment between the body's return and the commit
 *   (including during Resolution's wait for in-flight calls) discards the
 *   output, and one landing after the commit cannot undo it;
 * - members of one members request resolve through the port's `member()`
 *   window, started and reported in canonical order, and one at a time
 *   without Run Supervision (RUN-002).
 *
 * @see ../../../../docs/spec/operations.md (RUN-002, RUN-014, RUN-015)
 * @see ../../../../experiments/exp-8/decision.md (mechanism 2, supervisor resolution 2)
 */
import { afterEach, beforeEach, describe, expect, test } from '@jest/globals';
import type { IBindingDescriptor } from '@microdelta/definition';
import { createNodeMachine } from '@microdelta/machine-node';
import { createResolution } from '@microdelta/resolution';
import type { IExecutionSupervision, IResolution, ISupervisedExecution } from '@microdelta/resolution';
import { createTrackingObserver } from '@microdelta/tracking';

import { cleanup, controlledClock, freshLocation, openHistory } from '../durable-history/support.js';
import { composeStop, createWorld, environment, installWorld } from './fixture.js';
import type { IWorld } from './fixture.js';
import { attemptsAt, publishedSubjects, turns, until } from './support.js';

let world: IWorld;
let location: string;

beforeEach(() => {
  world = installWorld(createWorld());
  location = freshLocation();
});

afterEach(cleanup);

/**
 * A refusal the scripted port makes effective a given number of microtask
 * hops after a body's work returns: somewhere between the body returning and
 * (or after) its publication commit.
 */
interface IScheduledRefusal {
  readonly hops: number;
  readonly reason: string;
  /** Whether the step had not yet been published when the refusal took effect; set when it does. */
  beforeCommit: boolean | undefined;
}

/** A scripted cancellation port: interrupts the named steps' executions, and refuses publication while `refusal` is set. */
interface IScriptedPort extends IExecutionSupervision {
  /** Step slots whose executions end interrupted without running. */
  readonly interrupt: Set<string>;
  /** The publication refusal to report, if any. */
  refusal: string | undefined;
  /** A refusal to make effective after the next body returns, if any. */
  scheduled: IScheduledRefusal | undefined;
  /** Step slots presented for execution, in order. */
  readonly executed: string[];
  /** The most members that were resolving at once through `member()`. */
  readonly peak: number;
}

/** Run `effect` after `hops` further microtask hops. */
function afterHops(hops: number, effect: () => void): void {
  queueMicrotask(() => {
    if (hops === 0) {
      effect();
    } else {
      afterHops(hops - 1, effect);
    }
  });
}

/** Create a scripted port whose `member()` grants `lanes` lanes first in, first out, as Run Supervision's window does. */
function scriptedPort(lanes = 1): IScriptedPort {
  const queue: (() => void)[] = [];
  let active = 0;
  let peak = 0;
  const port: IScriptedPort = {
    interrupt: new Set(),
    refusal: undefined,
    scheduled: undefined,
    executed: [],
    get peak(): number {
      return peak;
    },
    async member<T>(work: () => Promise<T>): Promise<T> {
      if (active >= lanes) {
        await new Promise<void>((resolve) => {
          queue.push(resolve);
        });
      } else {
        active += 1;
      }
      peak = Math.max(peak, active);
      try {
        return await work();
      } finally {
        const next = queue.shift();
        if (next === undefined) {
          active -= 1;
        } else {
          next();
        }
      }
    },
    async execute<T>(step: IBindingDescriptor, work: () => Promise<T>): Promise<ISupervisedExecution<T>> {
      port.executed.push(step.slot);
      if (port.interrupt.has(step.slot)) {
        return { kind: 'interrupted', reason: 'scripted hard stop' };
      }
      let value: T;
      try {
        value = await work();
      } catch (error: unknown) {
        return { kind: 'threw', error };
      }
      const scheduled = port.scheduled;
      if (scheduled !== undefined) {
        // The body has returned; the refusal lands while Resolution proceeds towards the commit.
        afterHops(scheduled.hops, () => {
          scheduled.beforeCommit = publishedSubjects(location).length === 0;
          port.refusal = scheduled.reason;
        });
      }
      return { kind: 'returned', value };
    },
    publicationRefusal: () => port.refusal,
  };
  return port;
}

/** Monotonic request keys. */
let requests = 0;

/** A Resolution over a fresh fixture composition and real History, with the given port (or none). */
function resolutionWith(port: IExecutionSupervision | undefined): { readonly resolution: IResolution; resolve(step: IBindingDescriptor): ReturnType<IResolution['resolve']>; members(): ReturnType<IResolution['resolveMembers']> } {
  const history = openHistory({ location, clock: controlledClock(1_000), store: 'store:stop-port' });
  const acquired = history.acquireWriter({ holder: 'stop-port', leaseMilliseconds: 3_600_000 });
  if (acquired.kind !== 'acquired') {
    throw new Error('expected the writer lease');
  }
  const machine = createNodeMachine();
  const fixture = composeStop();
  const resolution = createResolution({
    declarations: fixture.builders,
    composition: fixture.composition,
    bindings: { inputs: fixture.composition.topology.inputs, helpers: fixture.composition.topology.helpers },
    environment,
    history,
    tracking: createTrackingObserver(machine),
    host: machine,
    admission: { admit: () => ({ kind: 'admitted' }) },
    ...(port === undefined ? {} : { execution: port }),
  });
  return {
    resolution,
    resolve: (step) => {
      requests += 1;
      return resolution.resolve({ step, requestKey: `port:${String(requests)}`, lease: acquired.lease });
    },
    members: () => {
      requests += 1;
      return resolution.resolveMembers({ template: 'item', step: 'work', requestKey: `port:${String(requests)}`, lease: acquired.lease });
    },
  };
}

/** The fixture's composition-level step descriptor. */
function stepOf(slot: 'plain'): IBindingDescriptor {
  return composeStop().step(slot);
}

describe('the cancellation port (RUN-015)', () => {
  test('a body whose supervised execution is interrupted ends interrupted and publishes nothing', async () => {
    const port = scriptedPort();
    port.interrupt.add('plain');
    const outcome = await resolutionWith(port).resolve(stepOf('plain'));
    expect(outcome).toMatchObject({ kind: 'refused', disposition: 'cancelled', reason: 'scripted hard stop', refused: { slot: 'plain' } });
    expect(outcome.trace.map((event) => event.phase)).toEqual(['verify', 'admit', 'claim', 'execute', 'abandon']);
    expect(attemptsAt(location)).toEqual([{ subject: 'plain:stop', state: 'interrupted', ending: 'stopped' }]);
    expect(publishedSubjects(location)).toEqual([]);
  });

  test('a publication refusal consulted before the commit discards output the body already returned', async () => {
    const port = scriptedPort();
    port.refusal = 'hard stop took effect before the publication commit';
    const outcome = await resolutionWith(port).resolve(stepOf('plain'));
    expect(port.executed).toEqual(['plain']);
    expect(outcome).toMatchObject({ kind: 'refused', disposition: 'cancelled', reason: 'hard stop took effect before the publication commit' });
    expect(attemptsAt(location)).toEqual([{ subject: 'plain:stop', state: 'interrupted', ending: 'stopped' }]);
    expect(publishedSubjects(location)).toEqual([]);
  });

  test('the commit is the linearization point: a refusal landing at any moment after the body returned discards the output exactly when it lands before the commit', async () => {
    const observed: { readonly hops: number; readonly beforeCommit: boolean | undefined; readonly outcome: string }[] = [];
    for (let hops = 0; hops <= 12; hops += 1) {
      location = freshLocation();
      const port = scriptedPort();
      const scheduled: IScheduledRefusal = { hops, reason: 'a hard stop landed after the body returned', beforeCommit: undefined };
      port.scheduled = scheduled;
      const outcome = await resolutionWith(port).resolve(stepOf('plain'));
      await turns(1);
      observed.push({ hops, beforeCommit: scheduled.beforeCommit, outcome: outcome.kind });
    }
    // Every refusal that landed before the commit discarded the output; one after it could not undo the commit.
    expect(observed.filter((entry) => entry.outcome !== (entry.beforeCommit === true ? 'refused' : 'published'))).toEqual([]);
    // Both sides of the commit were exercised, including a refusal landing during Resolution's wait between the body returning and the commit.
    expect(observed.filter((entry) => entry.hops > 0 && entry.beforeCommit === true).length).toBeGreaterThan(0);
    expect(observed.some((entry) => entry.beforeCommit === false)).toBe(true);
  });

  test('without a refusal the same body publishes (control)', async () => {
    const outcome = await resolutionWith(scriptedPort()).resolve(stepOf('plain'));
    expect(outcome.kind).toBe('published');
    expect(publishedSubjects(location)).toEqual(['plain:stop']);
  });
});

describe('the bounded active window of member fan-out (RUN-002)', () => {
  test('members resolve through the port\'s window, started first in first out in canonical key order, and report in that order', async () => {
    world = installWorld(createWorld(['item:3', 'item:1', 'item:4', 'item:2']));
    for (const key of world.keys) {
      world.plans[key] = 'gate';
    }
    const port = scriptedPort(2);
    const running = resolutionWith(port).members();
    await until(() => world.log.filter((entry) => entry.startsWith('start:')).length === 2, 'two members have started');
    await turns(20);
    expect(world.log).toEqual(['start:item:1', 'start:item:2']);
    world.gates.open('item:2:go');
    await until(() => world.log.includes('start:item:3'), 'the next member starts when one settles');
    expect(world.log.filter((entry) => entry.startsWith('start:'))).toEqual(['start:item:1', 'start:item:2', 'start:item:3']);
    for (const key of world.keys) {
      world.gates.open(`${key}:go`);
    }
    const resolved = await running;
    expect(resolved.members.map((member) => `${member.key}:${member.outcome.kind}`)).toEqual(['item:1:published', 'item:2:published', 'item:3:published', 'item:4:published']);
    expect(port.peak).toBe(2);
  });

  test('without Run Supervision members resolve one at a time', async () => {
    for (const key of world.keys) {
      world.plans[key] = 'gate';
    }
    const running = resolutionWith(undefined).members();
    await until(() => world.log.includes('start:item:1'), 'the first member has started');
    await turns(20);
    expect(world.log).toEqual(['start:item:1']);
    world.gates.open('item:1:go');
    world.gates.open('item:2:go');
    expect((await running).members.map((member) => member.outcome.kind)).toEqual(['published', 'published']);
  });
});
