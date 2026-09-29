/**
 * Argument and call-settlement edge cases of nested validation, over a small
 * composition of its own and real durable History. Each session is a fresh
 * composition, Tracking observer and Resolution over the same SQLite file.
 *
 * - A supplied step's argument list is its own evidence: reading `length`,
 *   iterating or spreading the list is observed, so a changed arity under an
 *   equal subject reruns the child (REUSE-005/006).
 * - A forwarded path chosen after an observed untracked read is unjustified,
 *   exactly like a derived value (CMP-7, supervisor ruling on #84).
 * - A forwarded origin whose current shape no longer answers the recorded
 *   path is changed evidence, never guessed.
 * - A body that returns while a call it started is still unsettled cannot
 *   publish: its evidence would be missing that call.
 *
 * @see ../../../../docs/spec/composition.md (CMP-7 and the EXP-4 argument recipe)
 * @see ../../../../docs/spec/execution.md (REUSE-005, REUSE-006, REUSE-007)
 */
import { afterEach, describe, expect, test } from '@jest/globals';
import { declarations } from '@microdelta/definition';
import type { IBindingDescriptor, IComposition, IDeclarations, ISlotSubject } from '@microdelta/definition';
import type { IDurableHistory } from '@microdelta/history';
import { createNodeMachine } from '@microdelta/machine-node';
import { ResolutionError, createResolution } from '@microdelta/resolution';
import type { IResolutionFamily, IResolutionOutcome, ICheckOutcome } from '@microdelta/resolution';
import { createTrackingObserver } from '@microdelta/tracking';

import { cleanup, controlledClock, freshLocation, openHistory } from '../durable-history/support.js';

afterEach(cleanup);

/** The analysis scope of this composition. */
const scope = 'arguments:fixture';

/** The declared inputs: a selector read only untracked, and data reached only by forwarding. */
interface IInputs {
  readonly cfg: { readonly which: string };
  readonly data: Readonly<Record<string, unknown>>;
}

/** One forwarded record. */
interface IValue {
  readonly v: number;
}

/** Helpers: the supplied steps' bodies, counting their runs. */
interface IHelpers {
  readonly scoreOf: (count: number, value: number) => { readonly s: number };
  readonly readOf: (value: number) => IValue;
}

/** Resolution's binding family for this composition. */
type IFamily = IResolutionFamily<IInputs, IHelpers>;

/** Body runs of the supplied steps in the current test. */
const runs = { score: 0, read: 0 };

/** Score: a wide call (more than one argument) scores 100, otherwise the first argument. */
function scoreOf(count: number, value: number): { readonly s: number } {
  runs.score += 1;
  return { s: count > 1 ? 100 : value };
}

/** Read: the forwarded value. */
function readOf(value: number): IValue {
  runs.read += 1;
  return { v: value };
}

/** One build's choices. */
interface IVariation {
  /** How the `arity` memo calls `score`: one argument, or two. */
  readonly arity?: 'one' | 'two';
  /** How the supplied score implementation observes its argument list. */
  readonly scoreImplementation?: 'length' | 'spread';
  /** How the `dangling` memo leaves a call unsettled: its only call, or a trailing one. */
  readonly dangling?: 'only' | 'trailing';
  readonly which?: string;
  readonly data?: Readonly<Record<string, unknown>>;
}

/** One fresh composition. */
interface IBuild {
  readonly builders: IDeclarations<IFamily>;
  readonly composition: IComposition<IFamily>;
}

/** Compose afresh, standing in for a new process. */
function compose(variation: IVariation): IBuild {
  const builders = declarations<IFamily>();
  const { memo, stepSlot, suppliedStep, supply, forward } = builders;
  const score = stepSlot<readonly [number, string?], { readonly s: number }>({ slot: 'score' });
  const read = stepSlot<readonly [IValue], IValue>({ slot: 'read' });
  const scoreSubject: ISlotSubject<readonly [number, string?]> = (derived) => `s:${String(derived[0])}`;
  const readSubject: ISlotSubject<readonly [IValue]> = () => 'read:data';
  const scoreImplementation = variation.scoreImplementation === 'spread'
    ? suppliedStep<readonly [number, string?], { readonly s: number }>({ run: ({ args, helpers }) => helpers.scoreOf([...args].length, args[0]) })
    : suppliedStep<readonly [number, string?], { readonly s: number }>({ run: ({ args, helpers }) => helpers.scoreOf(args.length, args[0]) });
  const readImplementation = suppliedStep<readonly [IValue], IValue>({ run: ({ args, helpers }) => helpers.readOf(args[0].v) });
  const arity = variation.arity === 'two'
    ? memo({ subject: 'arity', children: { score }, run: async ({ calls }) => ({ s: (await calls.score(7, 'bonus')).data.s }) })
    : memo({ subject: 'arity', children: { score }, run: async ({ calls }) => ({ s: (await calls.score(7)).data.s }) });
  const pick = memo({
    subject: 'pick',
    children: { read },
    run: async ({ calls, inputs, untracked }) => {
      // The path below is chosen by an observed untracked read.
      const key = untracked(inputs.cfg, 'which');
      return { v: (await calls.read(forward.input<IValue>('data', [key]))).data.v };
    },
  });
  const deep = memo({
    subject: 'deep',
    children: { read },
    run: async ({ calls }) => ({ v: (await calls.read(forward.input<IValue>('data', ['nested', 'a']))).data.v }),
  });
  const dangling = variation.dangling === 'trailing'
    ? memo({
        subject: 'dangling',
        children: { score },
        run: async ({ calls }) => {
          const first = await calls.score(1);
          void calls.score(2).catch(() => undefined);
          return { s: first.data.s };
        },
      })
    : memo({
        subject: 'dangling',
        children: { score },
        run: ({ calls }) => {
          void calls.score(1).catch(() => undefined);
          return { s: 0 };
        },
      });
  const composition = builders.compose({
    scope,
    inputs: [
      { slot: 'cfg', value: { which: variation.which ?? 'a' } },
      { slot: 'data', value: variation.data ?? { a: { v: 1 }, b: { v: 2 }, nested: { a: { v: 3 } } } },
    ],
    helpers: [{ slot: 'scoreOf', helper: scoreOf }, { slot: 'readOf', helper: readOf }],
    steps: [
      { slot: 'arity', declaration: arity },
      { slot: 'pick', declaration: pick },
      { slot: 'deep', declaration: deep },
      { slot: 'dangling', declaration: dangling },
    ],
    supplied: [
      supply({ slot: score, declaration: scoreImplementation, subject: scoreSubject }),
      supply({ slot: read, declaration: readImplementation, subject: readSubject }),
    ],
  });
  return { builders, composition };
}

/** A composition-level step. */
function step(slot: string): IBindingDescriptor {
  return { scope, role: 'step', slot };
}

/** Request-key counter across sessions: a saved key identifies one execution for the store's lifetime. */
let requests = 0;

/** One session: fresh composition and Resolution over the store; closed afterwards. */
async function session<T>(location: string, variation: IVariation, body: (operations: {
  readonly history: IDurableHistory;
  resolve(slot: string): Promise<IResolutionOutcome>;
  check(slot: string): Promise<ICheckOutcome>;
}) => Promise<T>): Promise<T> {
  const history = openHistory({ location, clock: controlledClock(1_000), store: 'store:arguments' });
  const acquired = history.acquireWriter({ holder: 'arguments', leaseMilliseconds: 3_600_000 });
  if (acquired.kind !== 'acquired') {
    throw new Error('expected the writer lease');
  }
  const machine = createNodeMachine();
  const build = compose(variation);
  const resolution = createResolution({
    declarations: build.builders,
    composition: build.composition,
    bindings: { inputs: ['cfg', 'data'], helpers: ['scoreOf', 'readOf'] },
    environment: 'env:arguments',
    history,
    tracking: createTrackingObserver(machine),
    host: machine,
    admission: { admit: () => ({ kind: 'admitted' }) },
  });
  try {
    return await body({
      history,
      resolve: (slot) => {
        requests += 1;
        return resolution.resolve({ step: step(slot), requestKey: `arguments:${slot}:${String(requests)}`, lease: acquired.lease });
      },
      check: (slot) => resolution.check({ step: step(slot) }),
    });
  } finally {
    history.releaseWriter(acquired.lease);
    history.close();
  }
}

/** The stored payload of an outcome's exact result. */
function payload(history: IDurableHistory, outcome: IResolutionOutcome): unknown {
  if (outcome.kind === 'refused') {
    throw new Error('expected a result');
  }
  return history.reader.readSubtree(outcome.reference, []);
}

/** Zero the run counts. */
function resetRuns(): void {
  runs.score = 0;
  runs.read = 0;
}

/** Expect a rejection with a ResolutionError of `code`. */
async function failureOf(promise: Promise<unknown>, code: ResolutionError['code']): Promise<string> {
  let caught: unknown;
  try {
    await promise;
  } catch (error: unknown) {
    caught = error;
  }
  expect(caught).toBeInstanceOf(ResolutionError);
  expect(caught instanceof ResolutionError ? caught.code : undefined).toBe(code);
  return caught instanceof Error ? caught.message : '';
}

describe('supplied step argument lists are observed', () => {
  test.each(['length', 'spread'] as const)('an arity change under an equal subject reruns the child that read the list (%s)', async (scoreImplementation) => {
    resetRuns();
    const location = freshLocation();
    await session(location, { arity: 'one', scoreImplementation }, async ({ history, resolve }) => {
      expect(payload(history, await resolve('arity'))).toEqual({ s: 7 });
    });
    expect(runs.score).toBe(1);
    resetRuns();
    await session(location, { arity: 'two', scoreImplementation }, async ({ history, resolve }) => {
      const outcome = await resolve('arity');
      expect(outcome.kind).toBe('published');
      // Same subject `s:7`, but the child's recorded list length (1) differs from the current one (2).
      expect(payload(history, outcome)).toEqual({ s: 100 });
    });
    expect(runs.score).toBe(1);
  });

  test('an unchanged argument list keeps the child and the parent exact references', async () => {
    resetRuns();
    const location = freshLocation();
    const first = await session(location, { arity: 'two' }, async ({ resolve }) => resolve('arity'));
    resetRuns();
    await session(location, { arity: 'two' }, async ({ resolve }) => {
      const outcome = await resolve('arity');
      expect(outcome).toMatchObject({ kind: 'reused', misses: [] });
      expect(outcome.kind !== 'refused' && first.kind !== 'refused' ? outcome.reference.locator === first.reference.locator : false).toBe(true);
    });
    expect(runs.score).toBe(0);
  });
});

describe('forwarded paths', () => {
  test('a forwarded path chosen after an observed untracked read is unjustified: the parent reruns and reads the current choice', async () => {
    resetRuns();
    const location = freshLocation();
    await session(location, { which: 'a' }, async ({ history, resolve }) => {
      const outcome = await resolve('pick');
      expect(payload(history, outcome)).toEqual({ v: 1 });
      if (outcome.kind === 'refused') {
        throw new Error('expected a result');
      }
      const calls = (history.readEnvelope(outcome.reference).provenance.content as { readonly calls: readonly { readonly witness: { readonly arguments: unknown } }[] }).calls;
      expect(calls[0]?.witness.arguments).toEqual([
        { form: 'forwarded', origin: { binding: 'input', slot: 'data', path: [{ kind: 'property', key: 'a' }] }, justified: false },
      ]);
    });
    resetRuns();
    await session(location, { which: 'b' }, async ({ history, resolve }) => {
      const outcome = await resolve('pick');
      expect(outcome.kind).toBe('published');
      expect(outcome.misses.map((item) => item.reason)).toEqual(['unjustified-argument']);
      expect(payload(history, outcome)).toEqual({ v: 2 });
    });
    expect(runs.read).toBe(1);
  });

  test('a forwarded origin whose current shape no longer answers the recorded path is changed evidence', async () => {
    resetRuns();
    const location = freshLocation();
    await session(location, {}, async ({ history, resolve }) => {
      expect(payload(history, await resolve('deep'))).toEqual({ v: 3 });
    });
    resetRuns();
    await session(location, { data: { a: { v: 1 }, b: { v: 2 }, nested: [{ v: 3 }] } }, async ({ check, resolve }) => {
      const checked = await check('deep');
      expect(checked.kind).toBe('execution-required');
      expect(checked.misses.map((item) => item.reason)).toEqual(['changed']);
      expect(checked.misses[0]?.detail).toMatch(/call 0 argument 0 forwards input data at nested\.a, which no longer has that shape/u);
      // Executing the parent cannot make the call either: the path does not resolve now.
      expect(await failureOf(resolve('deep'), 'execution-failure')).toMatch(/no longer has that shape/u);
    });
    expect(runs.read).toBe(0);
  });
});

describe('unsettled calls at publication', () => {
  test.each(['only', 'trailing'] as const)('a body that returns while its %s call is unsettled fails without publishing', async (dangling) => {
    resetRuns();
    const location = freshLocation();
    await session(location, { dangling }, async ({ history, resolve }) => {
      const message = await failureOf(resolve('dangling'), 'execution-failure');
      expect(message).toMatch(/settled/u);
      expect(history.findCandidates({ analysis: scope, environment: 'env:arguments', subject: 'dangling', version: 1 })).toEqual([]);
    });
    // The unsettled child's own work completed before the request ended; it was not abandoned mid-write.
    expect(runs.score).toBe(dangling === 'trailing' ? 2 : 1);
  });
});
