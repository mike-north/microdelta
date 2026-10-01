/**
 * Asynchronous supplied steps through the facade, at runtime: a supplied
 * step's body may return a promise, as a memo's may, and the call's result is
 * its settled value. This is how an author isolates one awaited external
 * operation per call in its own child step (EXP-8 resolution 3), so the
 * expected behavior is that of any supplied step:
 *
 * - a settled value is published as the call's exact result and the calling
 *   memo consumes it;
 * - a rejected promise is the step's failure, reported as Resolution's
 *   `execution-failure` with the rejection as its cause, never a result;
 * - after a restart (a fresh workspace and freshly composed declarations, as
 *   a new process has) the published call is reused and its body never runs
 *   again.
 *
 * @see ../../../../docs/spec/composition.md (CMP-3, CMP-7: supplied step slots)
 * @see ../../../../experiments/exp-8/decision.md (resolution 3: isolate each paid call in its own step)
 */
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, test } from '@jest/globals';

import { ResolutionError, authoring, openWorkspace } from '../../src/index.js';
import type { IAuthoring, IComposition, IRunEvent, IStepDescriptor, IWorkspace } from '../../src/index.js';

/** The analysis scope of the fixture. */
const scope = 'facade-async-supplied:doubling';

/** The logical store of every store in this suite. */
const logicalStore = 'store:facade-async-supplied';

/** The environment of every run. */
const environment = 'env:production';

/** A doubled value, the supplied step's result. */
interface IDoubled {
  readonly value: number;
}

/** The declared input record (no inputs are read). */
type IInputs = Record<never, never>;

/** The declared helper record: the asynchronous doubling the supplied step awaits. */
interface IHelpers {
  readonly doubleLater: (value: number) => Promise<IDoubled>;
}

/** What the helper does in this test, and how often its body ran. */
const world = { fail: false, calls: 0 };

/** Double a value after an asynchronous turn, or reject when the test says so. */
async function double(value: number): Promise<IDoubled> {
  world.calls += 1;
  await new Promise((resolve) => {
    setImmediate(resolve);
  });
  if (world.fail) {
    throw new Error('the doubling service refused the request');
  }
  return { value: value * 2 };
}

/** A fresh composition: a memo that calls the `double` slot once, supplied with an asynchronous step. */
function compose(): { readonly authoring: IAuthoring<IInputs, IHelpers>; readonly composition: IComposition<IInputs, IHelpers>; readonly total: IStepDescriptor } {
  const builders = authoring<IInputs, IHelpers>();
  const { memo, stepSlot, suppliedStep, supply, compose: composeAll } = builders;
  const slot = stepSlot<readonly [number], IDoubled>({ slot: 'double' });
  const total = memo({
    subject: 'total:21',
    children: { double: slot },
    run: async ({ calls }) => {
      const doubled = await calls.double(21);
      return { total: doubled.data.value };
    },
  });
  const asynchronous = suppliedStep<readonly [number], IDoubled>({ label: 'asynchronous doubling', run: ({ args, helpers }) => helpers.doubleLater(args[0]) });
  const composition = composeAll({
    scope,
    inputs: [],
    helpers: [{ slot: 'doubleLater', helper: double }],
    steps: [{ slot: 'total', declaration: total }],
    supplied: [supply({ slot, declaration: asynchronous, subject: (derived) => `double:${String(derived[0])}` })],
  });
  return { authoring: builders, composition, total: Object.freeze({ scope, role: 'step', slot: 'total' }) };
}

let directory: string;
let workspace: IWorkspace;
/** A counter of fresh request keys. */
let requests = 0;

beforeEach(() => {
  directory = mkdtempSync(join(tmpdir(), 'microdelta-async-supplied-'));
  workspace = openWorkspace({ location: join(directory, 'history.sqlite'), logicalStore });
  world.fail = false;
  world.calls = 0;
});

afterEach(() => {
  workspace.close();
  rmSync(directory, { recursive: true, force: true });
});

/** Resolve the memo once in a run over `fixture`, recording the run's step executions. */
async function resolveTotal(fixture: ReturnType<typeof compose>, executions: string[] = []): Promise<unknown> {
  const observe = (event: IRunEvent): void => {
    if (event.kind === 'step' && event.event.phase === 'execute') {
      executions.push(event.event.step.slot);
    }
  };
  const result = await workspace.run({ authoring: fixture.authoring, composition: fixture.composition, environment, observers: [{ observe }] }, async (run) => {
    requests += 1;
    const outcome = await run.resolve(fixture.total, { requestKey: `async-supplied:${String(requests)}` });
    return outcome.kind === 'published' || outcome.kind === 'reused' ? { kind: outcome.kind, data: run.read<unknown>(outcome.reference) } : { kind: outcome.kind };
  });
  return result.value;
}

describe('asynchronous supplied steps (CMP-7, EXP-8 resolution 3)', () => {
  test('the settled value of an asynchronous supplied body is the call\'s published result, consumed by its caller', async () => {
    const executions: string[] = [];
    expect(await resolveTotal(compose(), executions)).toEqual({ kind: 'published', data: { total: 42 } });
    expect(executions.sort()).toEqual(['double', 'total']);
    expect(world.calls).toBe(1);
  });

  test('a rejected promise is the supplied step\'s failure: execution-failure with the rejection as its cause, and nothing is published', async () => {
    world.fail = true;
    let failure: unknown;
    try {
      await resolveTotal(compose());
    } catch (error: unknown) {
      failure = error;
    }
    expect(failure).toBeInstanceOf(ResolutionError);
    expect(failure instanceof ResolutionError ? failure.code : undefined).toBe('execution-failure');
    // The rejection is reported as the cause; the message names it and no result exists to reuse.
    expect(failure instanceof Error ? failure.message : '').toContain('the doubling service refused the request');
    world.fail = false;
    expect(await resolveTotal(compose())).toEqual({ kind: 'published', data: { total: 42 } });
    expect(world.calls).toBe(2);
  });

  test('after a restart the published asynchronous call is reused and its body never runs again', async () => {
    expect(await resolveTotal(compose())).toEqual({ kind: 'published', data: { total: 42 } });
    workspace.close();
    workspace = openWorkspace({ location: join(directory, 'history.sqlite'), logicalStore });
    const executions: string[] = [];
    expect(await resolveTotal(compose(), executions)).toEqual({ kind: 'reused', data: { total: 42 } });
    expect(executions).toEqual([]);
    expect(world.calls).toBe(1);
  });
});
