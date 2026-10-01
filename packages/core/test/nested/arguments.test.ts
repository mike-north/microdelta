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
 *   publish: its evidence would be missing that call. A body that throws
 *   while calls are in flight reports its own failure once they settle.
 * - The argument list behaves as the plain array it stands for under every
 *   ordinary idiom (array methods, iteration, spread, destructuring, `in`,
 *   key reflection, `for...in`, JSON), and each idiom's reads are evidence:
 *   an arity change or a value change under an equal subject reruns the
 *   child, and an unchanged list reuses it. Expected results are the same
 *   idiom applied to a plain array.
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
  /** The numbers the `summed` memo passes, one argument each. */
  readonly nums: readonly number[];
  /** Which idiom the supplied `sum` implementation reads its argument list with. */
  readonly idiom: { readonly name: IIdiom };
}

/** The ordinary array idioms a supplied step may use on its argument list. */
type IIdiom = 'map' | 'forEach' | 'reduce' | 'filter' | 'indexOf' | 'includes' | 'slice' | 'concat' | 'in' | 'keys' | 'forIn' | 'destructuring' | 'spread' | 'json' | 'index';

/** Every idiom, in test order. */
const idioms: readonly IIdiom[] = ['map', 'forEach', 'reduce', 'filter', 'indexOf', 'includes', 'slice', 'concat', 'in', 'keys', 'forIn', 'destructuring', 'spread', 'json', 'index'];

/** What `sum` returns: the collected values' total and count, and the list's keys for the key idiom. */
interface ICollected {
  readonly t: number;
  readonly n: number;
  readonly keys?: readonly string[];
}

/** One forwarded record. */
interface IValue {
  readonly v: number;
}

/** Helpers: the supplied steps' bodies, counting their runs. */
interface IHelpers {
  readonly scoreOf: (count: number, value: number) => { readonly s: number };
  readonly readOf: (value: number) => IValue;
  readonly collect: (idiom: IIdiom, args: readonly number[]) => ICollected;
  readonly failOf: (value: number) => IValue;
  readonly boom: () => never;
}

/** Resolution's binding family for this composition. */
type IFamily = IResolutionFamily<IInputs, IHelpers>;

/** Body runs of the supplied steps in the current test. */
const runs = { score: 0, read: 0, sum: 0, fail: 0 };

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

/** The values one idiom collects from a list; applied to a plain array it is the expected meaning. */
function idiomValues(idiom: IIdiom, args: readonly number[]): readonly number[] {
  switch (idiom) {
    case 'map':
      return args.map((value) => value);
    case 'forEach': {
      const out: number[] = [];
      args.forEach((value) => {
        out.push(value);
      });
      return out;
    }
    case 'reduce':
      return args.reduce<readonly number[]>((collected, value) => [...collected, value], []);
    case 'filter':
      return args.filter(() => true);
    case 'indexOf':
      return [1, 2, 5].map((value) => args.indexOf(value));
    case 'includes':
      return [1, 2, 5].map((value) => (args.includes(value) ? value : 0));
    case 'slice':
      return args.slice(0);
    case 'concat': {
      const empty: number[] = [];
      return empty.concat(args);
    }
    case 'in':
      return [0, 1, 2].filter((position) => position in args).map((position) => args[position] ?? 0);
    case 'keys':
      return Object.keys(args).map((key) => args[Number(key)] ?? 0);
    case 'forIn': {
      const out: number[] = [];
      for (const key in args) {
        out.push(args[Number(key)] ?? 0);
      }
      return out;
    }
    case 'destructuring': {
      const [first, second] = args;
      return [first, second].filter((value): value is number => value !== undefined);
    }
    case 'spread':
      return [...args];
    case 'json': {
      const parsed: unknown = JSON.parse(JSON.stringify(args));
      return Array.isArray(parsed) ? parsed.filter((value): value is number => typeof value === 'number') : [];
    }
    case 'index':
      // Direct positional reads, including one past the end of a shorter list.
      return [args[0] ?? 0, args[1] ?? 0];
    default: {
      const exhaustive: never = idiom;
      return exhaustive;
    }
  }
}

/** The supplied `sum` body: one idiom over the argument list. */
function collect(idiom: IIdiom, args: readonly number[]): ICollected {
  runs.sum += 1;
  return expected(idiom, args);
}

/** The result `collect` produces for a list, computed on a plain array. */
function expected(idiom: IIdiom, args: readonly number[]): ICollected {
  const values = idiomValues(idiom, args);
  return { t: values.reduce((total, value) => total + value, 0), n: values.length, ...(idiom === 'keys' ? { keys: Object.keys(args) } : {}) };
}

/** A supplied body that always fails, standing in for a child that fails while in flight. */
function failOf(value: number): IValue {
  runs.fail += 1;
  throw new Error(`child failure ${String(value)}`);
}

/** A memo body failure. */
function boom(): never {
  throw new Error('body failure');
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
  readonly nums?: readonly number[];
  readonly idiom?: IIdiom;
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
  const sum = stepSlot<readonly number[], ICollected>({ slot: 'sum' });
  // Constant subject: arity and values never change which history the call belongs to.
  const sumSubject: ISlotSubject<readonly number[]> = () => 'sum:all';
  const sumImplementation = suppliedStep<readonly number[], ICollected>({ run: ({ args, helpers, inputs }) => helpers.collect(inputs.idiom.name, args) });
  const fail = stepSlot<readonly [number], IValue>({ slot: 'fail' });
  const failSubject: ISlotSubject<readonly [number]> = (derived) => `fail:${String(derived[0])}`;
  const failImplementation = suppliedStep<readonly [number], IValue>({ run: ({ args, helpers }) => helpers.failOf(args[0]) });
  const summed = memo({
    subject: 'summed',
    children: { sum },
    run: async ({ calls, inputs }) => {
      const values: number[] = [];
      for (let index = 0; index < inputs.nums.length; index += 1) {
        const value = inputs.nums[index];
        if (value !== undefined) {
          values.push(value);
        }
      }
      const collected = await calls.sum(...values);
      return { t: collected.data.t, n: collected.data.n };
    },
  });
  const throwing = memo({
    subject: 'throwing',
    children: { fail },
    run: ({ calls, helpers }) => {
      // A call still in flight, which will itself fail, when the body throws.
      void calls.fail(1).catch(() => undefined);
      return helpers.boom();
    },
  });
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
      { slot: 'nums', value: variation.nums ?? [1] },
      { slot: 'idiom', value: { name: variation.idiom ?? 'map' } },
    ],
    helpers: [
      { slot: 'scoreOf', helper: scoreOf },
      { slot: 'readOf', helper: readOf },
      { slot: 'collect', helper: collect },
      { slot: 'failOf', helper: failOf },
      { slot: 'boom', helper: boom },
    ],
    steps: [
      { slot: 'arity', declaration: arity },
      { slot: 'pick', declaration: pick },
      { slot: 'deep', declaration: deep },
      { slot: 'dangling', declaration: dangling },
      { slot: 'summed', declaration: summed },
      { slot: 'throwing', declaration: throwing },
    ],
    supplied: [
      supply({ slot: score, declaration: scoreImplementation, subject: scoreSubject }),
      supply({ slot: read, declaration: readImplementation, subject: readSubject }),
      supply({ slot: sum, declaration: sumImplementation, subject: sumSubject }),
      supply({ slot: fail, declaration: failImplementation, subject: failSubject }),
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
    bindings: { inputs: ['cfg', 'data', 'nums', 'idiom'], helpers: ['scoreOf', 'readOf', 'collect', 'failOf', 'boom'] },
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
  if (outcome.kind === 'refused' || outcome.kind === 'skipped') {
    throw new Error('expected a result');
  }
  return history.reader.readSubtree(outcome.reference, []);
}

/** Zero the run counts. */
function resetRuns(): void {
  runs.score = 0;
  runs.read = 0;
  runs.sum = 0;
  runs.fail = 0;
}

/** Expect a rejection with a ResolutionError of `code`. */
async function failureOf(promise: Promise<unknown>, code: ResolutionError['code']): Promise<{ readonly message: string; readonly cause: string }> {
  let caught: unknown;
  try {
    await promise;
  } catch (error: unknown) {
    caught = error;
  }
  expect(caught).toBeInstanceOf(ResolutionError);
  expect(caught instanceof ResolutionError ? caught.code : undefined).toBe(code);
  const cause: unknown = caught instanceof Error ? caught.cause : undefined;
  return { message: caught instanceof Error ? caught.message : '', cause: cause instanceof Error ? cause.message : '' };
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
      expect(outcome.kind !== 'refused' && outcome.kind !== 'skipped' && first.kind !== 'refused' && first.kind !== 'skipped' ? outcome.reference.locator === first.reference.locator : false).toBe(true);
    });
    expect(runs.score).toBe(0);
  });
});

describe('argument lists behave as plain arrays under every idiom, and each idiom is evidence', () => {
  test.each(idioms)('%s: an arity change and a value change rerun the child; an unchanged list reuses it', async (idiom) => {
    const location = freshLocation();
    /** One session over `nums`: the parent's result, the child's latest payload and the child body runs. */
    const sessionOver = async (nums: readonly number[]): Promise<{ readonly parent: unknown; readonly child: unknown; readonly runs: number }> => {
      resetRuns();
      return session(location, { idiom, nums }, async ({ history, resolve }) => {
        const parent = payload(history, await resolve('summed'));
        const [latest] = history.findCandidates({ analysis: scope, environment: 'env:arguments', subject: 'sum:all', version: 1 });
        return { parent, child: latest === undefined ? undefined : history.reader.readSubtree(latest.reference, []), runs: runs.sum };
      });
    };
    const cold = await sessionOver([1]);
    expect(cold).toEqual({ parent: { t: expected(idiom, [1]).t, n: expected(idiom, [1]).n }, child: expected(idiom, [1]), runs: 1 });
    // Arity change under the same subject: the list's recorded shape differs, so the child reruns.
    const wider = await sessionOver([1, 2]);
    expect(wider).toEqual({ parent: { t: expected(idiom, [1, 2]).t, n: expected(idiom, [1, 2]).n }, child: expected(idiom, [1, 2]), runs: 1 });
    // Value change at an equal arity: a read element differs, so the child reruns.
    const changed = await sessionOver([5, 2]);
    expect(changed).toEqual({ parent: { t: expected(idiom, [5, 2]).t, n: expected(idiom, [5, 2]).n }, child: expected(idiom, [5, 2]), runs: 1 });
    // Unchanged arity and values: the child and parent are reused.
    const same = await sessionOver([5, 2]);
    expect(same).toEqual({ ...changed, runs: 0 });
  });

  test('Object.keys reports the argument list\'s index keys', async () => {
    resetRuns();
    await session(freshLocation(), { idiom: 'keys', nums: [1, 2] }, async ({ history, resolve }) => {
      await resolve('summed');
      const [latest] = history.findCandidates({ analysis: scope, environment: 'env:arguments', subject: 'sum:all', version: 1 });
      expect(latest === undefined ? undefined : history.reader.readSubtree(latest.reference, [])).toEqual({ t: 3, n: 2, keys: ['0', '1'] });
    });
  });
});

describe('forwarded paths', () => {
  test('a forwarded path chosen after an observed untracked read is unjustified: the parent reruns and reads the current choice', async () => {
    resetRuns();
    const location = freshLocation();
    await session(location, { which: 'a' }, async ({ history, resolve }) => {
      const outcome = await resolve('pick');
      expect(payload(history, outcome)).toEqual({ v: 1 });
      if (outcome.kind === 'refused' || outcome.kind === 'skipped') {
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
      expect((await failureOf(resolve('deep'), 'execution-failure')).cause).toMatch(/no longer has that shape/u);
    });
    expect(runs.read).toBe(0);
  });
});

describe('unsettled calls at publication', () => {
  test('a body that throws while a call is in flight reports its own failure once that call settles, even when the call fails too', async () => {
    resetRuns();
    await session(freshLocation(), {}, async ({ history, resolve }) => {
      const { message, cause } = await failureOf(resolve('throwing'), 'execution-failure');
      // The body's own error is the cause; the framework message never repeats author text (RUN-013).
      expect(cause).toMatch(/body failure/u);
      expect(cause).not.toMatch(/child failure/u);
      expect(message).not.toMatch(/body failure|child failure/u);
      expect(history.findCandidates({ analysis: scope, environment: 'env:arguments', subject: 'throwing', version: 1 })).toEqual([]);
    });
    // The in-flight call ran to its own end before the request reported.
    expect(runs.fail).toBe(1);
  });

  test.each(['only', 'trailing'] as const)('a body that returns while its %s call is unsettled fails without publishing', async (dangling) => {
    resetRuns();
    const location = freshLocation();
    await session(location, { dangling }, async ({ history, resolve }) => {
      const { message } = await failureOf(resolve('dangling'), 'execution-failure');
      expect(message).toMatch(/settled/u);
      expect(history.findCandidates({ analysis: scope, environment: 'env:arguments', subject: 'dangling', version: 1 })).toEqual([]);
    });
    // The unsettled child's own work completed before the request ended; it was not abandoned mid-write.
    expect(runs.score).toBe(dangling === 'trailing' ? 2 : 1);
  });
});
