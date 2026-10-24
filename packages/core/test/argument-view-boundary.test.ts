/** Supplied argument-list edge behavior through real Definition, Tracking, Resolution, and durable History (CMP-7, TRK-3/5, RUN-013). */
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, test } from '@jest/globals';
import { declarations } from '@microdelta/definition';
import { openDurableHistory } from '@microdelta/history';
import type { IDurableHistory } from '@microdelta/history';
import { createNodeMachine, createNodeSqlite } from '@microdelta/machine-node';
import { createTrackingObserver } from '@microdelta/tracking';
import type { ITrackingObserver } from '@microdelta/tracking';
import { createResolution, ResolutionError } from '@microdelta/resolution';
import type { IExecutionSupervision, IResolutionFamily } from '@microdelta/resolution';

/** A declared helper lets the test exercise the assembly-owned observer without exposing it to an ordinary author. */
interface IHelpers { readonly inspect: (args: readonly (number | { readonly score: number })[]) => unknown; readonly after: () => void }
/** The supplied callback receives no input slots. */
type IFamily = IResolutionFamily<Record<string, never>, IHelpers>;
/** These invocation shapes distinguish empty, scalar, sibling, and object-valued argument behavior. */
type IArity = 'empty' | 'one' | 'sibling' | 'object';

/** Find a typed owning boundary without depending on an enclosing memo's presentation. */
function boundary(error: unknown, code: string): ResolutionError | undefined {
  let current = error;
  for (let depth = 0; depth < 5 && current instanceof ResolutionError; depth += 1) {
    if (current.code === code) { return current; }
    current = current.cause;
  }
  return undefined;
}

/** Resolve an ordinary supplied child once; inspect may ask the same observer to start another capture. */
async function runCase(arity: IArity, inspect: (args: readonly (number | { readonly score: number })[], observer: ITrackingObserver) => unknown, afterChild?: (observer: ITrackingObserver) => void, abandonFailure?: unknown, interruptChild = false): Promise<{ readonly error: unknown; readonly childResults: number; readonly childProvenance: string | undefined }> {
  const directory = mkdtempSync(join(tmpdir(), 'issue100-argument-'));
  const location = join(directory, 'history.sqlite');
  const machine = createNodeMachine();
  const observer = createTrackingObserver(machine);
  const history = openDurableHistory({ sqlite: createNodeSqlite(), clock: { currentEpochMilliseconds: () => 1000 }, sha256: machine, location, logicalStore: 'argument-boundary' });
  const api = declarations<IFamily>();
  const child = api.stepSlot<readonly (number | { readonly score: number })[], unknown>({ slot: 'child' });
  const implementation = api.suppliedStep<readonly (number | { readonly score: number })[], unknown>({ run: ({ args, helpers }) => helpers.inspect(args) });
  const parent = arity === 'empty'
    ? api.memo({ subject: 'parent', children: { child }, run: async ({ calls, helpers }) => { await calls.child(); helpers.after(); return { done: true }; } })
    : arity === 'sibling'
      ? api.memo({ subject: 'parent', children: { child }, run: async ({ calls, helpers }) => { await calls.child(7); await calls.child(8); helpers.after(); return { done: true }; } })
      : arity === 'object'
        ? api.memo({ subject: 'parent', children: { child }, run: async ({ calls, helpers }) => { await calls.child({ score: 7 }); helpers.after(); return { done: true }; } })
      : api.memo({ subject: 'parent', children: { child }, run: async ({ calls, helpers }) => { await calls.child(7); helpers.after(); return { done: true }; } });
  const composition = api.compose({ scope: 'argument-boundary', inputs: [], helpers: [{ slot: 'inspect', helper: (args: readonly (number | { readonly score: number })[]): unknown => inspect(args, observer) }, { slot: 'after', helper: (): void => afterChild?.(observer) }], steps: [{ slot: 'parent', declaration: parent }], supplied: [api.supply({ slot: child, declaration: implementation, subject: () => 'child' })] });
  const lease = history.acquireWriter({ holder: 'argument-boundary', leaseMilliseconds: 60000 });
  if (lease.kind !== 'acquired') { throw new Error('Test writer lease unavailable'); }
  /** One injected History ending failure checks diagnostic containment without changing publication behavior. */
  const authority: IDurableHistory = abandonFailure === undefined ? history : {
    ...history,
    abandonAttempt: () => { throw abandonFailure; },
  };
  /** A child may be interrupted while its authored Promise and Tracking frame remain open. */
  const execution: IExecutionSupervision = {
    async execute<T>(step: { readonly slot: string }, work: () => Promise<T>) {
      if (interruptChild && step.slot === 'child') {
        void work().catch(() => undefined);
        return { kind: 'interrupted', reason: 'test cancellation' } as const;
      }
      try { return { kind: 'returned', value: await work() } as const; }
      catch (error: unknown) { return { kind: 'threw', error } as const; }
    },
    member<T>(work: () => Promise<T>): Promise<T> { return work(); },
    /** This fixture models supplied-child interruption only; member fanout is outside its contract. */
    dispatchMembers(_count: number, _continueWhile: () => boolean, _work: (position: number) => Promise<void>): Promise<number> {
      throw new Error('Unexpected member fanout in argument-boundary fixture');
    },
    publicationRefusal(): undefined { return undefined; },
  };
  const resolution = createResolution({ declarations: api, composition, bindings: { inputs: [], helpers: ['inspect', 'after'] }, environment: 'test', history: authority, tracking: observer, host: machine, admission: { admit: () => ({ kind: 'admitted' }) }, execution });
  let error: unknown;
  try {
    await resolution.resolve({ step: { scope: 'argument-boundary', role: 'step', slot: 'parent' }, requestKey: 'first', lease: lease.lease });
  } catch (caught: unknown) { error = caught; }
  finally { history.close(); }
  const sqlite = createNodeSqlite().openSqlite(location);
  try {
    const row = sqlite.prepare('SELECT count(*) AS count FROM history_results WHERE subject = ?').get('child');
    const provenanceRow = sqlite.prepare('SELECT provenance FROM history_results WHERE subject = ?').get('child');
    if (typeof row !== 'object' || row === null || !('count' in row) || typeof row.count !== 'number') { throw new Error('Expected child count'); }
    const childProvenance = typeof provenanceRow === 'object' && provenanceRow !== null && 'provenance' in provenanceRow && typeof provenanceRow.provenance === 'string' ? provenanceRow.provenance : undefined;
    return { error, childResults: row.count, childProvenance };
  } finally { sqlite.close(); rmSync(directory, { recursive: true, force: true }); }
}

test.each(['empty', 'one'] as const)('returning the exact %s argument list rejects with a static detachment cause', async arity => {
  const result = await runCase(arity, args => args);
  const failure = boundary(result.error, 'unsupported-result');
  expect(failure).toBeDefined();
  expect(failure?.message).not.toMatch(/\[\.\.\.args\]/u);
  expect(failure?.cause).toBeInstanceOf(TypeError);
  expect((failure?.cause as Error).message).toMatch(/argument list.*\[\.\.\.args\]/iu);
  expect(result.childResults).toBe(0);
});

test.each(['empty', 'one'] as const)('returning a nested %s argument list rejects before publication', async arity => {
  const result = await runCase(arity, args => ({ nested: [args] }));
  const failure = boundary(result.error, 'unsupported-result');
  expect((failure?.cause as Error | undefined)?.message).toMatch(/argument list.*\[\.\.\.args\]/iu);
  expect(result.childResults).toBe(0);
});

test('a same-observer nested capture cannot consume the supplied list or steal argument facts', async () => {
  const result = await runCase('one', (args, observer) => {
    // eslint-disable-next-line microdelta/tracked-captures -- Negative runtime control deliberately attempts a nested capture through the assembly-owned observer.
    const nested = observer.capture(() => { expect(() => args[0]).toThrow(/capture|frame/i); return { done: true }; });
    expect(nested.observations).toHaveLength(0);
    return nested.value;
  });
  expect(result.error).toBeUndefined();
  expect(result.childResults).toBe(1);
});

test('unsafe integer string reads return undefined without making an argument fact', async () => {
  const result = await runCase('one', args => {
    expect(Reflect.get(args, '9007199254740993')).toBeUndefined();
    return { done: true };
  });
  expect(result.error).toBeUndefined();
  expect(result.childResults).toBe(1);
  expect(result.childProvenance).not.toContain('"argument"');
});

test('a safe absent index still records the supplied list shape', async () => {
  const result = await runCase('one', args => {
    expect(args[2]).toBeUndefined();
    return { done: true };
  });
  expect(result.error).toBeUndefined();
  expect(result.childProvenance).toContain('"argument"');
});

test('parent-capture reads and detached descriptor getters reject a leaked view', async () => {
  let leaked: readonly (number | { readonly score: number })[] | undefined;
  let getter: (() => unknown) | undefined;
  const result = await runCase('one', args => {
    leaked = args;
    getter = Object.getOwnPropertyDescriptor(args, '0')?.get;
    return { done: true };
  }, () => {
    const view = leaked;
    if (view === undefined) { throw new Error('Expected leaked view'); }
    expect(() => view[0]).toThrow(/argument list|capture|frame/i);
    expect(() => view.length).toThrow(/argument list|capture|frame/i);
    expect(() => 0 in view).toThrow(/argument list|capture|frame/i);
    expect(() => Object.keys(view)).toThrow(/argument list|capture|frame/i);
    expect((): unknown => Object.getPrototypeOf(view)).toThrow(/argument list|capture|frame/i);
    expect(() => Object.isExtensible(view)).toThrow(/argument list|capture|frame/i);
    expect((): unknown => Reflect.get(view, '9007199254740993')).toThrow(/argument list|capture|frame/i);
    expect(getter).toThrow(/argument list|capture|frame/i);
  });
  expect(result.error).toBeUndefined();
  expect(result.childResults).toBe(1);
  expect(getter).toThrow(/argument list|capture|frame/i);
});

test('a sibling supplied invocation rejects the earlier list while its own list remains readable', async () => {
  let earlier: readonly (number | { readonly score: number })[] | undefined;
  let calls = 0;
  const result = await runCase('sibling', args => {
    calls += 1;
    if (calls === 1) { earlier = args; }
    else {
      expect(() => earlier?.[0]).toThrow(/argument list|capture|frame/i);
      expect(args[0]).toBe(8);
    }
    return { value: args[0] };
  });
  expect(result.error).toBeUndefined();
  expect(result.childResults).toBe(2);
});

test('a closed invocation rejects a continuation even while its Tracking frame is still open', async () => {
  let release: (() => void) | undefined;
  let finish: (() => void) | undefined;
  let lateError: unknown;
  const gate = new Promise<void>(resolve => { release = resolve; });
  const finished = new Promise<void>(resolve => { finish = resolve; });
  const result = await runCase('one', async args => {
    await gate;
    try { void args[0]; }
    catch (error: unknown) { lateError = error; }
    finally { finish?.(); }
    return { done: true };
  }, undefined, undefined, true);
  expect(result.childResults).toBe(0);
  release?.();
  await finished;
  expect(lateError).toBeInstanceOf(TypeError);
  expect((lateError as Error).message).toMatch(/argument list|invocation/i);
});

test('an unrelated accessor array keeps the generic detachment failure without invoking its getter', async () => {
  let getterCalls = 0;
  const result = await runCase('one', () => {
    const output: number[] = [];
    Object.defineProperty(output, '0', { enumerable: true, get: () => { getterCalls += 1; return 7; } });
    return { output };
  });
  const failure = boundary(result.error, 'unsupported-result');
  expect((failure?.cause as Error | undefined)?.message).toMatch(/array slot 0 is hidden or an accessor/i);
  expect(getterCalls).toBe(0);
  expect(result.childResults).toBe(0);
});

test('object-valued elements keep ordinary Tracking output behavior when copied or returned', async () => {
  const copied = await runCase('object', args => ({ copied: [...args] }));
  const element = await runCase('object', args => args[0]);
  expect(copied.error).toBeUndefined();
  expect(element.error).toBeUndefined();
  expect(copied.childResults).toBe(1);
  expect(element.childResults).toBe(1);
});

test('a non-printable History ending failure cannot replace the authored callback failure', async () => {
  const hostile: unknown = Object.create(null);
  const result = await runCase('one', () => { throw new Error('synthetic author detail'); }, undefined, hostile);
  expect(result.error).toBeInstanceOf(ResolutionError);
  expect(result.error).not.toBeInstanceOf(TypeError);
  expect((result.error as ResolutionError).message).not.toContain('synthetic author detail');
});

test.each(['empty', 'one'] as const)('explicit %s spread and slice copies remain valid output', async arity => {
  const spread = await runCase(arity, args => ({ values: [...args] }));
  const slice = await runCase(arity, args => ({ values: args.slice() }));
  expect(spread.error).toBeUndefined();
  expect(slice.error).toBeUndefined();
  expect(spread.childResults).toBe(1);
  expect(slice.childResults).toBe(1);
  expect(spread.childProvenance).toContain('"self"');
  expect(spread.childProvenance).toContain('"argument"');
});

test('structuredClone identifies the supplied view as an unclonable Proxy', async () => {
  const result = await runCase('one', args => {
    expect(() => structuredClone(args)).toThrow(/clone/i);
    return { done: true };
  });
  expect(result.error).toBeUndefined();
});
