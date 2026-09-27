import { describe, expect, test } from '@jest/globals';

import { createNodeMachine } from '../src/index.js';

/** Coordinate concurrent operations with explicit events rather than timers. */
function deferred(): { promise: Promise<void>; release(): void } {
  let release: () => void = (): never => { throw new Error('Promise executor has not run'); };
  const promise = new Promise<void>((resolve) => { release = resolve; });
  return { promise, release };
}

describe('Node Machine conformance', () => {
  test('A-20: async context propagates through awaits and restores nested context', async () => {
    const machine = createNodeMachine();
    const context = machine.createAsyncContext<string>();
    const failure = new Error('nested failure');

    await expect(context.run('outer', async () => {
      expect(context.getStore()).toBe('outer');
      await Promise.resolve();
      await expect(context.run('inner', async () => {
        expect(context.getStore()).toBe('inner');
        await Promise.resolve();
        throw failure;
      })).rejects.toBe(failure);
      expect(context.getStore()).toBe('outer');
      return 'resolved';
    })).resolves.toBe('resolved');
    expect(context.getStore()).toBeUndefined();
  });

  test('A-20: concurrently interleaved callbacks retain separate context values', async () => {
    const machine = createNodeMachine();
    const context = machine.createAsyncContext<string>();
    const firstMayFinish = deferred();
    const secondMayRead = deferred();
    const first = context.run('first', async () => {
      await secondMayRead.promise;
      expect(context.getStore()).toBe('first');
      firstMayFinish.release();
      return context.getStore();
    });
    const second = context.run('second', async () => {
      secondMayRead.release();
      await firstMayFinish.promise;
      expect(context.getStore()).toBe('second');
      return context.getStore();
    });

    await expect(Promise.all([first, second])).resolves.toEqual(['first', 'second']);
  });

  test('A-20: run preserves synchronous returns, thrown values, and rejected promises', async () => {
    const machine = createNodeMachine();
    const context = machine.createAsyncContext<string>();
    const thrown = new Error('sync failure');
    const rejected = new Error('async failure');

    expect(context.run('value', () => context.getStore())).toBe('value');
    let received: unknown;
    try {
      context.run('throw', () => { throw thrown; });
    } catch (error: unknown) {
      received = error;
    }
    expect(received).toBe(thrown);
    await expect(context.run('reject', async () => { throw rejected; })).rejects.toBe(rejected);
    expect(context.getStore()).toBeUndefined();
  });

  test('A-20: snapshots preserve structural values and graph identity while detaching copies', () => {
    const machine = createNodeMachine();
    const bytes = new Uint8Array([1, 2, 3]);
    const source: { self?: unknown; first?: unknown; second?: unknown; date: Date; values: Map<string, unknown>; bytes: Uint8Array; view: DataView } = {
      date: new Date('2020-01-02T03:04:05.000Z'),
      values: new Map(),
      bytes,
      view: new DataView(bytes.buffer, 1, 2),
    };
    source.self = source;
    const repeated = { value: 4 };
    source.first = repeated;
    source.second = repeated;
    source.values.set('repeated', repeated);
    const detached = machine.snapshot(source);

    expect(detached).not.toBe(source);
    expect(detached.self).toBe(detached);
    expect(detached.first).toBe(detached.second);
    expect(detached.values.get('repeated')).toBe(detached.first);
    expect(detached.date).toEqual(source.date);
    expect(detached.bytes).not.toBe(bytes);
    bytes[0] = 9;
    expect(detached.bytes[0]).toBe(1);
    detached.bytes[1] = 8;
    expect(source.bytes[1]).toBe(2);
    expect(detached.view.getUint8(0)).toBe(2);
  });

  test('A-20: unsupported functions, symbols, and raw shared memory fail', () => {
    const machine = createNodeMachine();
    const shared = new SharedArrayBuffer(4);

    expect(() => machine.snapshot(() => 'unsupported')).toThrow();
    expect(() => machine.snapshot({ value: Symbol('unsupported') })).toThrow();
    expect(() => machine.snapshot(shared)).toThrow();
    expect(() => machine.snapshot({ nested: new Map([['shared', shared]]) })).toThrow();
  });

  test('A-20: enumerable getters are evaluated by the V8 snapshot codec', () => {
    const machine = createNodeMachine();
    let reads = 0;
    const source = Object.defineProperty({}, 'value', {
      enumerable: true,
      get() { reads += 1; return 7; },
    });

    expect(machine.snapshot(source)).toEqual({ value: 7 });
    expect(reads).toBe(1);
  });

  test('A-20: custom prototypes, nonenumerable fields, and symbol keys are not preserved', () => {
    const machine = createNodeMachine();
    const symbolKey = Symbol('private');
    class RecordValue {
      readonly value = 'visible';
      readonly [symbolKey] = 'symbol';
    }
    const source = new RecordValue();
    Object.defineProperty(source, 'hidden', { configurable: true, enumerable: false, value: 'hidden' });

    const detached = machine.snapshot(source);
    expect(detached).not.toBeInstanceOf(RecordValue);
    expect(detached).toEqual({ value: 'visible' });
    expect(Reflect.ownKeys(detached)).toEqual(['value']);
  });
});
