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
 * - members of one members request resolve concurrently within the bounded
 *   active window, one at a time by default, and report in canonical order
 *   (RUN-002).
 *
 * @see ../../../../docs/spec/operations.md (RUN-002, RUN-014, RUN-015)
 * @see ../../../../experiments/exp-8/decision.md (mechanism 2, supervisor resolution 2)
 */
import { afterEach, beforeEach, describe, expect, test } from '@jest/globals';
import type { IBindingDescriptor } from '@microdelta/definition';
import { createNodeMachine } from '@microdelta/machine-node';
import { ResolutionError, createResolution } from '@microdelta/resolution';
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

/** A scripted cancellation port: interrupts the named steps' executions, and refuses publication while `refusal` is set. */
interface IScriptedPort extends IExecutionSupervision {
  /** Step slots whose executions end interrupted without running. */
  readonly interrupt: Set<string>;
  /** The publication refusal to report, if any. */
  refusal: string | undefined;
  /** Step slots presented for execution, in order. */
  readonly executed: string[];
}

/** Create a scripted port. */
function scriptedPort(): IScriptedPort {
  const port: IScriptedPort = {
    interrupt: new Set(),
    refusal: undefined,
    executed: [],
    async execute<T>(step: IBindingDescriptor, work: () => Promise<T>): Promise<ISupervisedExecution<T>> {
      port.executed.push(step.slot);
      if (port.interrupt.has(step.slot)) {
        return { kind: 'interrupted', reason: 'scripted hard stop' };
      }
      try {
        return { kind: 'returned', value: await work() };
      } catch (error: unknown) {
        return { kind: 'threw', error };
      }
    },
    publicationRefusal: () => port.refusal,
  };
  return port;
}

/** Monotonic request keys. */
let requests = 0;

/** A Resolution over a fresh fixture composition and real History, with the given port and window. */
function resolutionWith(port: IExecutionSupervision | undefined, window?: number): { readonly resolution: IResolution; resolve(step: IBindingDescriptor): ReturnType<IResolution['resolve']>; members(): ReturnType<IResolution['resolveMembers']> } {
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
    ...(window === undefined ? {} : { window }),
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

  test('without a refusal the same body publishes (control)', async () => {
    const outcome = await resolutionWith(scriptedPort()).resolve(stepOf('plain'));
    expect(outcome.kind).toBe('published');
    expect(publishedSubjects(location)).toEqual(['plain:stop']);
  });
});

describe('the bounded active window of member fan-out (RUN-002)', () => {
  test('members resolve concurrently up to the window and report in canonical key order', async () => {
    world = installWorld(createWorld(['item:3', 'item:1', 'item:4', 'item:2']));
    for (const key of world.keys) {
      world.plans[key] = 'gate';
    }
    const running = resolutionWith(scriptedPort(), 2).members();
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
  });

  test('without a window members resolve one at a time', async () => {
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

  test.each([0, 1.5, -1])('a window of %s is refused at construction', (window) => {
    let caught: unknown;
    try {
      resolutionWith(scriptedPort(), window);
    } catch (error: unknown) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(ResolutionError);
    expect(caught).toMatchObject({ code: 'invalid-request' });
  });
});
