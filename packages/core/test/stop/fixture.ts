/**
 * The stop-and-permit authoring fixture: a small analysis whose steps make
 * real, permit-guarded sends to a stub provider through the live run's
 * execution controls, written as an author writes it against Definition's
 * builders bound to the facade's authoring family.
 *
 * - `items` is a keyed collection source over the world's item keys.
 * - `item` is a template over it with one member memo, `work`, whose body
 *   runs the world's plan for that member (see {@link IPlan}).
 * - `c1`, `c2` and `c3` are memos that each send one request labelled
 *   `child-<n>`; `stuck` is a memo whose body never settles and ignores the
 *   abort signal (a non-cooperative child). `failing` is a supplied step slot
 *   whose implementation notes its execution attribution and throws.
 * - `plain` is a memo that touches neither the run nor the provider.
 * - `fanout` calls `c1`, `c2` and `c3` concurrently; `hanging` awaits
 *   `stuck`; `throwing` starts `stuck` and then throws its own error;
 *   `attributed` notes its attribution, awaits a failing child and notes
 *   again.
 *
 * Author callbacks capture nothing but their typed context: every effect goes
 * through a declared helper over the module's `world`, which each test
 * installs afresh. Helpers reach the run only through scoped lookup
 * (`currentExecution()`, `currentRun()`), never through a context parameter.
 *
 * @see ../../../../docs/spec/operations.md (RUN-001, RUN-002, RUN-014, RUN-015)
 * @see ../../../../docs/plans/m5-operations.md (Selected execution contract)
 */
import { declarations } from '@microdelta/definition';
import type { IMemberBuilder } from '@microdelta/definition';

import { currentExecution, currentRun, sourceOutcome } from '../../src/index.js';
import type { IAuthoring, IAuthoringFamily, IComposition, IRunExecution, ISourceOutcome, IStepDescriptor } from '../../src/index.js';
import { gates, stubProvider } from './support.js';
import type { IGates, IStubProvider } from './support.js';

/** The analysis scope of the fixture composition. */
export const analysis = 'stop:fixture';

/** The environment every fixture run selects. */
export const environment = 'env:stop';

/** One discovered item. */
export interface IItem {
  readonly key: string;
}

/** The discovery result. */
export interface IRoster {
  readonly members: readonly IItem[];
  readonly status: 'complete';
}

/**
 * What one member's `work` body does:
 *
 * - `send`: one first-attempt send labelled with the member key;
 * - `retry`: a first send, then (once the test opens `<key>:retry-gate`) a
 *   retry send, as a retry policy would issue after a transient failure;
 * - `sleep`: wait holding no permit until the world's `wakeAt`, then return;
 * - `ignore-stop`: ignore the abort signal, wait for `<key>:output` and then
 *   return complete output (arbitrary JavaScript a signal cannot stop, CX-2);
 * - `keep`: stash its execution controls in the world, then return;
 * - `gate`: wait for `<key>:go` without touching the run, then return (for
 *   Resolution driven without Supervision).
 */
export type IPlan = 'send' | 'retry' | 'sleep' | 'ignore-stop' | 'keep' | 'gate';

/** A member's result. */
export interface IWork {
  readonly key: string;
  readonly value: number;
}

/** The mutable fixture world one test installs. */
export interface IWorld {
  /** Item keys discovery returns. */
  keys: readonly string[];
  /** Plans by member key; `send` when absent. */
  plans: Record<string, IPlan>;
  /** The stub provider every send reaches. */
  provider: IStubProvider;
  /** Gates the test opens. */
  gates: IGates;
  /** What the provider reports when asked to cancel remote work; no cancellation support when undefined. */
  cancel: 'cancelled' | 'running' | undefined;
  /** When a `sleep` plan wakes, in epoch milliseconds. */
  wakeAt: number;
  /** Ordered notes: plan progress and execution attribution. */
  log: string[];
  /** Execution controls a `keep` plan stashed. */
  kept: IRunExecution | undefined;
}

/** A fresh world over `keys` with a non-cooperative provider. */
export function createWorld(keys: readonly string[] = ['item:1', 'item:2'], options: { readonly cooperative?: boolean } = {}): IWorld {
  return { keys, plans: {}, provider: stubProvider(options), gates: gates(), cancel: undefined, wakeAt: 0, log: [], kept: undefined };
}

/** The world the helpers read; each test installs its own. */
export let world: IWorld = createWorld();

/** Install a world. */
export function installWorld(next: IWorld): IWorld {
  world = next;
  return world;
}

/** The declared input record (no inputs are read). */
export type IInputs = Record<never, never>;

/** The declared helper record. */
export interface IHelpers {
  readonly roster: () => ISourceOutcome<IRoster>;
  readonly work: (key: string) => Promise<IWork>;
  readonly child: (n: number) => Promise<{ readonly n: number }>;
  readonly fail: (n: number) => never;
  readonly total: (values: readonly number[]) => { readonly total: number };
  readonly note: (label: string) => void;
  readonly boom: () => never;
}

/** One permit-guarded send of `label` to the world's provider. */
function send(label: string, retry = false): Promise<number> {
  const cancel = world.cancel;
  return currentExecution().send({
    label,
    retry,
    perform: world.provider.request(label, 1),
    ...(cancel === undefined ? {} : { cancel: () => Promise.resolve(cancel) }),
  });
}

/** Discovery: the world's items. */
function roster(): ISourceOutcome<IRoster> {
  return sourceOutcome.fresh<IRoster>({ members: world.keys.map((key) => ({ key })), status: 'complete' });
}

/** A member's work, by the world's plan. */
async function work(key: string): Promise<IWork> {
  const plan = world.plans[key] ?? 'send';
  world.log.push(`start:${key}`);
  switch (plan) {
    case 'send':
      return { key, value: await send(key) };
    case 'retry': {
      await send(`${key}:first`);
      world.log.push(`awaiting-retry:${key}`);
      await world.gates.wait(`${key}:retry-gate`);
      return { key, value: await send(`${key}:retry`, true) };
    }
    case 'sleep': {
      world.log.push(`sleeping:${key}`);
      await currentExecution().sleepUntil(world.wakeAt);
      world.log.push(`woke:${key}`);
      return { key, value: 0 };
    }
    case 'ignore-stop': {
      world.log.push(`ignoring:${key}`);
      await world.gates.wait(`${key}:output`);
      world.log.push(`returned:${key}`);
      return { key, value: 42 };
    }
    case 'keep':
      world.kept = currentExecution();
      return { key, value: 0 };
    case 'gate':
      await world.gates.wait(`${key}:go`);
      world.log.push(`done:${key}`);
      return { key, value: 0 };
    default: {
      const exhaustive: never = plan;
      return exhaustive;
    }
  }
}

/** A supplied child: one send, or (for 0) work that never settles and ignores its signal. */
async function child(n: number): Promise<{ readonly n: number }> {
  world.log.push(`child:${String(n)}`);
  if (n === 0) {
    return new Promise<never>(() => undefined);
  }
  return { n: await send(`child-${String(n)}`) };
}

/** A supplied child that notes its attribution and fails. */
function fail(n: number): never {
  note(`failing-${String(n)}`);
  throw new Error(`child failure ${String(n)}`);
}

/** Sum child values. */
function total(values: readonly number[]): { readonly total: number } {
  return { total: values.reduce((sum, value) => sum + value, 0) };
}

/** Note a label with the execution's run and step attribution. */
function note(label: string): void {
  const execution = currentExecution();
  world.log.push(`${label}@${execution.step?.slot ?? 'none'}:${currentRun().runId === execution.runId ? 'same-run' : 'other-run'}`);
}

/** A body's own failure. */
function boom(): never {
  throw new Error('body failure');
}

/** One fresh composition with its builders and the descriptors tests use. */
export interface IStopFixture {
  readonly builders: IAuthoring<IInputs, IHelpers>;
  readonly composition: IComposition<IInputs, IHelpers>;
  /** A composition-level step. */
  step(slot: 'fanout' | 'hanging' | 'throwing' | 'attributed' | 'plain'): IStepDescriptor;
  /** One member's `work` instance. */
  instance(memberKey: string): IStepDescriptor;
}

/** Compose the fixture with fresh allocations, standing in for a new process. */
export function composeStop(): IStopFixture {
  const builders: IAuthoring<IInputs, IHelpers> = declarations<IAuthoringFamily<IInputs, IHelpers>>();
  const { source, memo, template, stepSlot, suppliedStep, supply, compose } = builders;
  const items = source<IRoster>({
    subject: 'items:stop',
    collection: { identity: 'key' },
    finality: () => true,
    run: ({ helpers }) => helpers.roster(),
  });
  const steps = (member: IMemberBuilder<IAuthoringFamily<IInputs, IHelpers>, IItem>) => ({
    work: member.memo({
      subject: member.subject('work:stop'),
      run: ({ member: bound, helpers }) => helpers.work(bound.key),
    }),
  });
  const item = template({ slot: 'item', collection: items, steps });
  const failingSlot = stepSlot<readonly [number], { readonly n: number }>({ slot: 'failing' });
  const failingStep = suppliedStep<readonly [number], { readonly n: number }>({ label: 'failing', run: ({ args, helpers }) => helpers.fail(args[0]) });
  const c1 = memo({ subject: 'c1:stop', run: ({ helpers }) => helpers.child(1) });
  const c2 = memo({ subject: 'c2:stop', run: ({ helpers }) => helpers.child(2) });
  const c3 = memo({ subject: 'c3:stop', run: ({ helpers }) => helpers.child(3) });
  const stuck = memo({ subject: 'stuck:stop', run: ({ helpers }) => helpers.child(0) });
  const plain = memo({ subject: 'plain:stop', run: ({ helpers }) => helpers.total([1, 2]) });
  const fanout = memo({
    subject: 'fanout:stop',
    children: { c1, c2, c3 },
    run: async ({ calls, helpers }) => {
      // Three declared calls in flight at once; the parent holds no permit while it waits for them.
      // eslint-disable-next-line microdelta/tracked-captures -- Promise.all only joins this body's own three declared calls; it reads no external value that could influence the result.
      const [first, second, third] = await Promise.all([calls.c1(), calls.c2(), calls.c3()]);
      return helpers.total([first.data.n, second.data.n, third.data.n]);
    },
  });
  const hanging = memo({
    subject: 'hanging:stop',
    children: { stuck },
    run: async ({ calls }) => ({ n: (await calls.stuck()).data.n }),
  });
  const throwing = memo({
    subject: 'throwing:stop',
    children: { stuck },
    run: ({ calls, helpers }) => {
      // A call still in flight, which never settles, when the body throws its own error.
      void calls.stuck().catch(() => undefined);
      return helpers.boom();
    },
  });
  const attributed = memo({
    subject: 'attributed:stop',
    children: { failing: failingSlot },
    run: async ({ calls, helpers }) => {
      helpers.note('parent-before');
      const settled = await calls.failing(7).then(() => 'ok', () => 'failed');
      helpers.note(`parent-after-${settled}`);
      return { settled };
    },
  });
  const composition = compose({
    scope: analysis,
    inputs: [],
    helpers: [
      { slot: 'roster', helper: roster },
      { slot: 'work', helper: work },
      { slot: 'child', helper: child },
      { slot: 'fail', helper: fail },
      { slot: 'total', helper: total },
      { slot: 'note', helper: note },
      { slot: 'boom', helper: boom },
    ],
    steps: [
      { slot: 'items', declaration: items },
      { slot: 'c1', declaration: c1 },
      { slot: 'c2', declaration: c2 },
      { slot: 'c3', declaration: c3 },
      { slot: 'stuck', declaration: stuck },
      { slot: 'plain', declaration: plain },
      { slot: 'fanout', declaration: fanout },
      { slot: 'hanging', declaration: hanging },
      { slot: 'throwing', declaration: throwing },
      { slot: 'attributed', declaration: attributed },
    ],
    templates: [item],
    supplied: [supply({ slot: failingSlot, declaration: failingStep, subject: () => 'failing:stop' })],
  });
  return {
    builders,
    composition,
    step: (slot) => Object.freeze({ scope: analysis, role: 'step', slot }),
    instance: (memberKey) => Object.freeze({ scope: analysis, role: 'step', slot: 'work', template: 'item', collection: 'items', memberKey }),
  };
}
