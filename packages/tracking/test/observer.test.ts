import { createHash } from 'node:crypto';
import { AsyncLocalStorage } from 'node:async_hooks';

import { describe, expect, test } from '@jest/globals';
import type { IMachine } from '@microdelta/machine';
import { encodeProjectionFact, observe, type ISelectedFact, type IValueProjectionFact } from '@microdelta/value';
import { createTrackingObserver } from '../src/index.js';
import type { ICurrentFactRequest, ICurrentFactResolution, IObservationCapture, ITrackingBinding } from '../src/index.js';

/** Supply only host facilities; this test adapter has no Tracking policy. */
const machine: IMachine = {
  createAsyncContext<T>() { return new AsyncLocalStorage<T>(); },
  snapshot<T>(value: T): T { return structuredClone(value); },
  sha256(input: string): string { return createHash('sha256').update(input, 'utf8').digest('hex'); },
};

/** A caller-owned binding catalog supplies the current source fact by structural binding. */
function createProvider(): {
  readonly provider: {
      resolve(binding: ITrackingBinding, request: ICurrentFactRequest): ICurrentFactResolution;
  };
  readonly set: (binding: string, root: unknown) => void;
} {
  const roots = new Map<string, unknown>();
  return {
    provider: {
      resolve(binding, request): ICurrentFactResolution {
        const key = binding.path.join('/');
        const root = roots.get(key);
        if (root === undefined) {
          return { kind: 'unavailable' };
        }
        if (request.kind === 'implementation') {
          return { kind: 'available', fact: root };
        }
        if (request.kind === 'selected') {
          return { kind: 'available', fact: observe(root, request.address, request.operation) };
        }
        return { kind: 'unavailable' };
      },
    },
    set(binding, root) {
      roots.set(binding, root);
    },
  };
}

describe('semantic tracking observer', () => {
  const observer = createTrackingObserver(machine);
  const binding = { path: ['analysis', 'author'] };

  test('tracked containers navigate without whole-tree reads; pass-through is observed only by the callee', () => {
    const tracked = observer.tracked({ author: { name: 'Ada', unread: 'v1' } }, binding);
    const capture = observer.capture(() => {
      function assess(input: typeof tracked): string { return input.author.name; }
      return assess(tracked);
    });

    expect(capture.value).toBe('Ada');
    expect(capture.observations).toHaveLength(1);
    expect(capture.observations[0]?.address).toEqual([
      { kind: 'property', key: 'author' },
      { kind: 'property', key: 'name' },
    ]);
    expect(capture.observations[0]?.kind).toBe('fact');
  });

  test('returning a tracked input preserves the same wrapper and does not imply materialization', () => {
    const tracked = observer.tracked({ name: 'Ada', unread: { detail: 'not consumed' } }, binding);
    const capture = observer.capture(() => tracked);
    expect(capture.value).toBe(tracked);
    expect(capture.observations).toHaveLength(0);
    expect(observer.materialization.owns(capture.value)).toBe(true);
    // eslint-disable-next-line microdelta/tracked-captures -- This runtime assertion deliberately enters a lower-level materialization read through the observer capability.
    const output = observer.capture(() => observer.materialization.read(capture.value, 'name'));
    expect(output.value).toBe('Ada');
    expect(output.observations).toHaveLength(1);
  });

  test('materialization reads reject unowned and foreign-observer values', () => {
    const untracked = { name: 'untracked' };
    const otherObserver = createTrackingObserver(machine);
    const foreign = otherObserver.tracked({ name: 'foreign' }, binding);
    expect(() => { Reflect.apply(observer.materialization.read, observer.materialization, [untracked, 'name']); })
      .toThrow(/observer-owned|owned/i);
    expect(() => { Reflect.apply(observer.materialization.read, observer.materialization, [foreign, 'name']); })
      .toThrow(/observer-owned|owned/i);
  });

  test('detached materialization record capabilities retain selected facts, projections, and collection order', () => {
    const { recordSelected, recordProjection, recordCollectionOrder } = observer.materialization;
    const selected: ISelectedFact = {
      operation: 'value',
      address: [{ kind: 'property', key: 'name' }],
      fact: 'Ada',
    };
    const projection: IValueProjectionFact = {
      descriptor: {
        address: [{ kind: 'property', key: 'name' }],
        operation: 'value',
        traversal: { kind: 'exhaustive', complete: true },
      },
      members: [['user-a', 'Ada']],
    };
    const captures = [
      // eslint-disable-next-line microdelta/tracked-captures -- The runtime fixture verifies an extracted materialization recorder retains its observer context.
      observer.capture(() => recordSelected(binding, selected)),
      // eslint-disable-next-line microdelta/tracked-captures -- The runtime fixture verifies an extracted materialization recorder retains its observer context.
      observer.capture(() => recordProjection(binding, projection)),
      // eslint-disable-next-line microdelta/tracked-captures -- The runtime fixture verifies an extracted materialization recorder retains its observer context.
      observer.capture(() => recordCollectionOrder(binding, ['user-a', 'user-b'])),
    ];

    expect(captures.map(capture => capture.observations.length)).toEqual([1, 1, 1]);
    expect(captures.map(capture => capture.observations[0]?.kind))
      .toEqual(['fact', 'projection', 'collection-order']);
    expect(captures[0]?.observations[0]).toMatchObject({
      address: selected.address,
      operation: 'value',
      selection: { kind: 'selected', operation: 'value', address: selected.address },
    });
    expect(captures[1]?.observations[0]).toMatchObject({
      selection: { kind: 'projection', descriptor: projection.descriptor },
    });
    expect(captures[2]?.observations[0]).toMatchObject({
      selection: { kind: 'collection-order', keys: ['user-a', 'user-b'] },
    });
  });

  test('materialization record capabilities leave inputs untouched when no capture frame is active', () => {
    let digestCalls = 0;
    let inspections = 0;
    const host: IMachine = {
      ...machine,
      sha256(input: string): string {
        digestCalls += 1;
        return machine.sha256(input);
      },
    };
    const isolated = createTrackingObserver(host);
    const inspectable = <T extends object>(value: T): T => new Proxy(value, {
      get(target, property, receiver): unknown {
        inspections += 1;
        return Reflect.get(target, property, receiver);
      },
      getOwnPropertyDescriptor(target, property): PropertyDescriptor | undefined {
        inspections += 1;
        return Reflect.getOwnPropertyDescriptor(target, property);
      },
      ownKeys(target): Array<string | symbol> {
        inspections += 1;
        return Reflect.ownKeys(target);
      },
    });
    const { recordSelected, recordProjection, recordCollectionOrder } = isolated.materialization;
    const selected: ISelectedFact = inspectable({
      operation: 'value',
      address: [{ kind: 'property', key: 'name' }],
      fact: 'Ada',
    });
    const projection: IValueProjectionFact = inspectable({
      descriptor: {
        address: [{ kind: 'property', key: 'name' }],
        operation: 'value',
        traversal: { kind: 'exhaustive', complete: true },
      },
      members: [['author-1', 'Ada']],
    });
    const keys = inspectable(['author-1']);
    const suppliedBinding: ITrackingBinding = inspectable({ path: ['analysis', 'author'] });

    expect(() => recordSelected(suppliedBinding, selected)).not.toThrow();
    expect(() => recordProjection(suppliedBinding, projection)).not.toThrow();
    expect(() => recordCollectionOrder(suppliedBinding, keys)).not.toThrow();
    expect(inspections).toBe(0);
    expect(digestCalls).toBe(0);
  });

  test('detached materialization record capabilities reject closed inherited frames before inspecting content', async () => {
    let digestCalls = 0;
    let contentReads = 0;
    const host: IMachine = {
      ...machine,
      sha256(input: string): string {
        digestCalls += 1;
        return machine.sha256(input);
      },
    };
    const isolated = createTrackingObserver(host);
    const { recordSelected, recordProjection, recordCollectionOrder } = isolated.materialization;
    const selected: ISelectedFact = {
      get operation(): 'value' { contentReads += 1; return 'value'; },
      address: [{ kind: 'property', key: 'name' }],
      fact: 'Ada',
    };
    const projection: IValueProjectionFact = {
      get descriptor(): IValueProjectionFact['descriptor'] {
        contentReads += 1;
        return {
          address: [{ kind: 'property', key: 'name' }],
          operation: 'value',
          traversal: { kind: 'exhaustive', complete: true },
        };
      },
      members: [['user-a', 'Ada']],
    };
    const keys = new Proxy(['user-a', 'user-b'], {
      get(target, property, receiver): unknown {
        contentReads += 1;
        return Reflect.get(target, property, receiver);
      },
    });
    let release: () => void = () => undefined;
    const gate = new Promise<void>(resolve => { release = resolve; });
    let detached: Promise<readonly unknown[]> = Promise.resolve([]);

    await isolated.captureAsync(async () => {
      detached = (async () => {
        // eslint-disable-next-line microdelta/tracked-captures -- This deferred test barrier runs recorder attempts only after the owning capture closes.
        await gate;
        const attempts = [
          // eslint-disable-next-line microdelta/tracked-captures -- This test deliberately calls an extracted recorder after its capture frame closes.
          Promise.resolve().then(() => recordSelected(binding, selected)),
          // eslint-disable-next-line microdelta/tracked-captures -- This test deliberately calls an extracted recorder after its capture frame closes.
          Promise.resolve().then(() => recordProjection(binding, projection)),
          // eslint-disable-next-line microdelta/tracked-captures -- This test deliberately calls an extracted recorder after its capture frame closes.
          Promise.resolve().then(() => recordCollectionOrder(binding, keys)),
        ];
        // eslint-disable-next-line microdelta/tracked-captures -- Native promise aggregation is only test scheduling for late recorder rejection.
        return Promise.all(attempts.map(attempt => attempt.catch((error: unknown) => error)));
      })();
    });

    release();
    const errors = await detached;
    expect(errors).toHaveLength(3);
    expect(errors.every(error => error instanceof Error && /closed/i.test(error.message))).toBe(true);
    expect(contentReads).toBe(0);
    expect(digestCalls).toBe(0);
  });

  test('synchronous capture rejects promises and ordinary thenable results', () => {
    // eslint-disable-next-line microdelta/tracked-captures -- This runtime negative case passes a native Promise through the synchronous boundary to prove rejection.
    expect(() => observer.capture(() => Promise.resolve('later'))).toThrow(/captureAsync/i);
    expect(() => observer.capture(() => ({ then: () => undefined }))).toThrow(/captureAsync/i);
  });

  test('async wrapper pass-through preserves Promise assimilation reads as actual observations', async () => {
    const tracked = observer.tracked({ name: 'Ada' }, binding);
    const capture = await observer.captureAsync(async () => tracked);
    expect(capture.value).toBe(tracked);
    expect(capture.observations.map(item => item.address)).toEqual([[{ kind: 'property', key: 'then' }]]);
  });

  test('async capture passes tracked functions through without invoking or observing them', async () => {
    let calls = 0;
    let ownThenReads = 0;
    let ownThenCalls = 0;
    const implementation = () => { calls += 1; return 'called'; };
    // eslint-disable-next-line microdelta/tracked-captures -- The test tracks a side-effecting callable to verify Promise assimilation does not invoke it.
    const trackedFunction = observer.tracked(implementation, binding);
    const accessorImplementation = () => { calls += 1; return 'accessor called'; };
    // A configurable custom then getter stays opaque and must not run during Promise assimilation.
    Object.defineProperty(accessorImplementation, 'then', {
      configurable: true,
      get() {
        ownThenReads += 1;
        return () => { ownThenCalls += 1; };
      },
    });
    // eslint-disable-next-line microdelta/tracked-captures -- The test tracks an accessor-bearing callable to verify Promise assimilation does not inspect it.
    const trackedAccessorFunction = observer.tracked(accessorImplementation, binding);
    const direct = await observer.captureAsync(async () => trackedFunction);
    // eslint-disable-next-line microdelta/tracked-captures -- Native Promise resolution is the runtime assimilation path under test.
    const resolved = await observer.captureAsync(async () => Promise.resolve(trackedFunction));
    // eslint-disable-next-line microdelta/tracked-captures -- Native Promise chaining is the runtime assimilation path under test.
    const chained = await observer.captureAsync(async () => Promise.resolve('ready').then(() => trackedFunction));
    // eslint-disable-next-line microdelta/tracked-captures -- Native Promise resolution is the runtime assimilation path under test.
    const accessor = await observer.captureAsync(async () => Promise.resolve(trackedAccessorFunction));

    for (const capture of [direct, resolved, chained]) {
      expect(capture.value).toBe(trackedFunction);
      expect(capture.observations).toHaveLength(0);
    }
    expect(accessor.value).toBe(trackedAccessorFunction);
    expect(accessor.observations).toHaveLength(0);
    expect(calls).toBe(0);
    expect(ownThenReads).toBe(0);
    expect(ownThenCalls).toBe(0);
    expect(Reflect.get(trackedFunction, 'then')).toBeUndefined();
  });

  test('rejects non-configurable own then lookup without changing ordinary function calls', async () => {
    let calls = 0;
    const implementation = () => { calls += 1; return 'called'; };
    Object.defineProperty(implementation, 'then', { configurable: false, value: () => undefined });
    // eslint-disable-next-line microdelta/tracked-captures -- The test tracks a callable with a non-configurable then property to verify assimilation rejection.
    const trackedFunction = observer.tracked(implementation, binding);

    expect(trackedFunction()).toBe('called');
    await expect(observer.captureAsync(async () => trackedFunction)).rejects.toThrow(/non-configurable then/i);
    expect(calls).toBe(1);
  });

  test('copies registration bindings and retained facts so later source mutation cannot retarget evidence', () => {
    const suppliedBinding = { path: ['analysis', 'author'] };
    const supplied = { name: 'Ada' };
    const tracked = observer.tracked(supplied, suppliedBinding);
    suppliedBinding.path[1] = 'different';
    supplied.name = 'Grace';

    const capture = observer.capture(() => tracked.name);
    expect(capture.value).toBe('Ada');
    expect(capture.observations[0]?.binding).toEqual({ path: ['analysis', 'author'] });
    expect(Object.isFrozen(capture.observations)).toBe(true);
    expect(Object.isFrozen(capture.observations[0]?.binding)).toBe(true);
  });

  test('rejects binding accessors and sparse correspondence paths instead of executing or guessing them', () => {
    const accessor = Object.defineProperty({}, 'path', { get: () => ['analysis', 'author'] });
    const sparsePath: string[] = new Array<string>(1);
    expect(() => { Reflect.apply(observer.tracked, observer, [{ name: 'Ada' }, accessor]); }).toThrow(/binding|path/i);
    expect(() => { Reflect.apply(observer.tracked, observer, [{ name: 'Ada' }, { path: sparsePath }]); }).toThrow(/binding|path/i);
  });

  test('compares selected facts through current bindings while preserving original evidence', () => {
    const source = createProvider();
    // eslint-disable-next-line microdelta/tracked-captures -- This runtime fixture creates the tracked wrapper inside capture to verify current-comparison evidence.
    const captured = observer.capture(() => observer.tracked({ name: 'Ada' }, binding).name);
    source.set('analysis/author', { name: 'Ada' });
    expect(observer.compareCurrent(captured, source.provider)).toMatchObject({ kind: 'equal' });

    source.set('analysis/author', { name: 'Grace' });
    expect(observer.compareCurrent(captured, source.provider)).toMatchObject({ kind: 'changed' });
    expect(captured.observations[0]?.encoded).toContain('Ada');
    expect(observer.compareCurrent(captured, { resolve: () => ({ kind: 'unavailable' }) }).kind).toBe('unavailable');
    expect(observer.compareCurrent(captured, { resolve: () => ({ kind: 'ambiguous' }) }).kind).toBe('ambiguous');
  });

  test('membership evidence ignores unrelated additions and changes when the selected member is removed', () => {
    const source = createProvider();
    const tracked = observer.tracked({ a: 1 }, binding);
    const captured = observer.capture(() => 'a' in tracked);

    source.set('analysis/author', { a: 1, b: 2 });
    expect(observer.compareCurrent(captured, source.provider).kind).toBe('equal');

    source.set('analysis/author', { b: 2 });
    expect(observer.compareCurrent(captured, source.provider).kind).toBe('changed');
  });

  test('explicit identity reads ignore unread names but change when the identity changes', () => {
    const source = createProvider();
    const tracked = observer.tracked({ id: 'author-1', name: 'Ada' }, binding);
    const captured = observer.capture(() => tracked.id);

    source.set('analysis/author', { id: 'author-2', name: 'Ada' });
    expect(observer.compareCurrent(captured, source.provider).kind).toBe('changed');

    source.set('analysis/author', { id: 'author-1', name: 'Grace' });
    expect(observer.compareCurrent(captured, source.provider).kind).toBe('equal');
  });

  test('matches selected addresses by segment meaning rather than object member order', () => {
    // eslint-disable-next-line microdelta/tracked-captures -- This fixture compares runtime addresses supplied by an external binding.
    const propertyCapture = observer.capture(() => observer.tracked({ name: 'Ada' }, binding).name);
    // eslint-disable-next-line microdelta/tracked-captures -- This fixture compares runtime indices supplied by an external binding.
    const indexCapture = observer.capture(() => observer.tracked(['Ada'], binding)[0]);
    const compareFact = <T,>(capture: IObservationCapture<T>, fact: ISelectedFact) => observer.compareCurrent(capture, {
      resolve: () => ({ kind: 'available', fact }),
    });

    expect(compareFact(propertyCapture, {
      operation: 'value', address: [{ key: 'name', kind: 'property' }], fact: 'Ada',
    }).kind).toBe('equal');
    expect(compareFact(indexCapture, {
      operation: 'value', address: [{ index: 0, kind: 'index' }], fact: 'Ada',
    }).kind).toBe('equal');

    expect(compareFact(propertyCapture, {
      operation: 'value', address: [{ key: 'other', kind: 'property' }], fact: 'Ada',
    }).kind).toBe('incompatible');
    expect(compareFact(propertyCapture, {
      operation: 'value', address: [{ index: 0, kind: 'index' }], fact: 'Ada',
    }).kind).toBe('incompatible');
    expect(compareFact(indexCapture, {
      operation: 'value', address: [{ index: 1, kind: 'index' }], fact: 'Ada',
    }).kind).toBe('incompatible');
    expect(compareFact(indexCapture, {
      operation: 'value', address: [{ key: '0', kind: 'property' }], fact: 'Ada',
    }).kind).toBe('incompatible');
  });

  test('classifies unsupported selected provider payloads as incompatible', () => {
    // eslint-disable-next-line microdelta/tracked-captures -- This runtime fixture captures a value to test malformed current provider payloads.
    const captured = observer.capture(() => observer.tracked({ name: 'Ada' }, binding).name);
    const malformed = {
      operation: 'value',
      address: [{ kind: 'property', key: 'name' }],
      fact: () => 'functions are not selected value data',
    };

    expect(observer.compareCurrent(captured, {
      resolve: () => ({ kind: 'available', fact: malformed }),
    }).kind).toBe('incompatible');
  });

  test('classifies malformed selected envelopes and addresses as incompatible', () => {
    // eslint-disable-next-line microdelta/tracked-captures -- This runtime fixture captures a value to test malformed current provider metadata.
    const captured = observer.capture(() => observer.tracked({ name: 'Ada' }, binding).name);
    const sparseAddress = new Array<unknown>(1);
    const malformed: unknown[] = [
      { operation: 'not-an-operation', address: [{ kind: 'property', key: 'name' }], fact: 'Ada' },
      { operation: 'value', address: sparseAddress, fact: 'Ada' },
      { operation: 'value', address: [{ kind: 'index', index: -1 }], fact: 'Ada' },
      { operation: 'value', address: [{ kind: 'property', key: 'name', extra: true }], fact: 'Ada' },
    ];

    for (const fact of malformed) {
      expect(observer.compareCurrent(captured, {
        resolve: () => ({ kind: 'available', fact }),
      }).kind).toBe('incompatible');
    }
  });

  test('compares an exact compatible fingerprint request without asking for payload and rejects mismatched metadata descriptors', () => {
    // eslint-disable-next-line microdelta/tracked-captures -- This runtime case creates its tracked wrapper inside capture to exercise fingerprint-only comparison.
    const captured = observer.capture(() => observer.tracked({ name: 'Ada' }, binding).name);
    const expected = captured.observations[0];
    if (expected === undefined) { throw new Error('Expected selected evidence'); }
    let resolutions = 0;
    const sameSelection: ICurrentFactResolution = {
      kind: 'compatible-fingerprint',
      selection: expected.selection,
      encodingVersion: 'MDO1',
      fingerprint: expected.fingerprint,
    };
    const equal = observer.compareCurrent(captured, {
      resolve(_binding, request) {
        resolutions += 1;
        expect(request).toEqual(expected.selection);
        return sameSelection;
      },
    });
    expect(equal.kind).toBe('equal');
    expect(resolutions).toBe(1);

    const differentFingerprint = `${expected.fingerprint.startsWith('0') ? '1' : '0'}${expected.fingerprint.slice(1)}`;
    expect(observer.compareCurrent(captured, {
      resolve(_binding, request) {
        return { kind: 'compatible-fingerprint', selection: request, encodingVersion: 'MDO1', fingerprint: differentFingerprint };
      },
    }).kind).toBe('changed');
    expect(observer.compareCurrent(captured, {
      resolve(_binding, request) {
        return {
          kind: 'compatible-fingerprint',
          selection: { ...request, address: [{ kind: 'property', key: 'other' }] },
          encodingVersion: 'MDO1',
          fingerprint: expected.fingerprint,
        };
      },
    }).kind).toBe('incompatible');
  });

  test('rejects accessor-backed current fact envelopes without invoking provider getters', () => {
    // eslint-disable-next-line microdelta/tracked-captures -- This runtime case creates its tracked wrapper inside capture while testing malformed current evidence.
    const captured = observer.capture(() => observer.tracked({ name: 'Ada' }, binding).name);
    let getterCalls = 0;
    const badOperation = Object.defineProperties({}, {
      operation: { enumerable: true, get() { getterCalls += 1; return 'value'; } },
      address: { enumerable: true, value: [{ kind: 'property', key: 'name' }] },
      fact: { enumerable: true, value: 'Ada' },
    });
    const badSegment = {
      operation: 'value',
      address: [{
        get kind(): 'property' { getterCalls += 1; return 'property'; },
        key: 'name',
      }],
      fact: 'Ada',
    };

    for (const fact of [badOperation, badSegment]) {
      expect(observer.compareCurrent(captured, {
        resolve: () => ({ kind: 'available', fact }),
      }).kind).toBe('incompatible');

    }
    expect(getterCalls).toBe(0);
  });

  test('rebinding an intermediate object keeps equal consumed values and compares later changes at the new path', () => {
    const source = createProvider();
    // eslint-disable-next-line microdelta/tracked-captures -- This runtime fixture creates the tracked wrapper inside capture to verify rebinding evidence.
    const captured = observer.capture(() => observer.tracked({ author: { id: 'a', name: 'Ada' } }, binding).author.name);
    const original = captured.observations[0];
    source.set('analysis/author', { author: { id: 'b', name: 'Ada' } });
    expect(observer.compareCurrent(captured, source.provider)).toMatchObject({ kind: 'equal' });

    source.set('analysis/author', { author: { id: 'b', name: 'Grace' } });
    expect(observer.compareCurrent(captured, source.provider)).toMatchObject({ kind: 'changed' });
    expect(captured.observations[0]).toBe(original);
    expect(original?.encoded).toContain('Ada');
  });

  test('compares absent and present undefined as the same value read, preserving falsey values literally', () => {
    const absentInput: { flag?: undefined } = {};
    // eslint-disable-next-line microdelta/tracked-captures -- This comparison test intentionally observes a pre-existing optional input through runtime wrapper registration.
    const absent = observer.capture(() => observer.tracked(absentInput, binding).flag);
    // eslint-disable-next-line microdelta/tracked-captures -- This comparison test intentionally registers a literal wrapper during capture to compare absent and present values.
    const present = observer.capture(() => observer.tracked({ flag: undefined }, binding).flag);
    expect(absent.observations[0]?.fingerprint).toBe(present.observations[0]?.fingerprint);

    // eslint-disable-next-line microdelta/tracked-captures -- This runtime comparison intentionally constructs a tracked wrapper inside the observation boundary.
    const zero = observer.capture(() => observer.tracked({ flag: 0 }, binding).flag);
    // eslint-disable-next-line microdelta/tracked-captures -- This runtime comparison intentionally constructs a tracked wrapper inside the observation boundary.
    const empty = observer.capture(() => observer.tracked({ flag: '' }, binding).flag);
    expect(zero.observations[0]?.fingerprint).not.toBe(empty.observations[0]?.fingerprint);
  });

  test('retains distinct consumed facts when wrappers share one structural address', () => {
    const zero = observer.tracked({ flag: 0 }, binding);
    const empty = observer.tracked({ flag: '' }, binding);
    const capture = observer.capture(() => [zero.flag, empty.flag]);
    const source = createProvider();
    source.set('analysis/author', { flag: 0 });

    expect(capture.observations).toHaveLength(2);
    expect(observer.compareCurrent(capture, source.provider).kind).toBe('changed');
  });

  test('array length and positional reads remain separate; native reflection rejects the non-enumerable length case', () => {
    const tracked = observer.tracked(['a', 'b'], binding);
    const length = observer.capture(() => tracked.length);
    const position = observer.capture(() => tracked[0]);
    expect(length.observations[0]?.operation).toBe('length');
    expect(position.observations[0]?.address).toEqual([{ kind: 'index', index: 0 }]);
    // eslint-disable-next-line microdelta/tracked-captures -- The runtime negative case proves native key reflection is rejected by the tracked proxy.
    expect(() => observer.capture(() => Object.keys(tracked))).toThrow(/unsupported|reflection/i);
    // eslint-disable-next-line microdelta/tracked-captures -- The runtime negative case proves native own-property reflection is rejected by the tracked proxy.
    expect(() => observer.capture(() => Object.hasOwn(tracked, 'length'))).toThrow(/unsupported|reflection/i);
    expect(() => observer.hasOwn(tracked, '01')).toThrow(/index|unsupported/i);
    expect(() => observer.hasOwn(tracked, '-0')).toThrow(/index|unsupported/i);
    expect(() => observer.hasOwn(tracked, '')).toThrow(/index|unsupported/i);
  });

  test('explicit keys, own-property checks, and inherited membership keep their operation meanings', () => {
    const inherited = Object.create({ inherited: undefined }) as { readonly own?: number; readonly inherited?: undefined };
    Object.assign(inherited, { own: 1 });
    const tracked = observer.tracked(inherited, binding);
    const capture = observer.capture(() => ({ keys: observer.keys(tracked), own: observer.hasOwn(tracked, 'own'), inherited: 'inherited' in tracked }));
    expect(capture.value).toEqual({ keys: ['own'], own: true, inherited: true });
    expect(capture.observations.map(item => item.operation)).toEqual(['keys', 'own', 'membership']);
  });

  test('called functions record implementation evidence; uncalled functions do not and calls are not memoized', () => {
    let calls = 0;
    const unused = observer.tracked(() => 'unused', binding);
    function implementation(value: number): number {
      // eslint-disable-next-line microdelta/tracked-captures -- The runtime test counts intentionally untracked side effects to prove tracked calls are not memoized.
      calls++;
      return value + 1;
    }
    const fn = observer.tracked(implementation, binding);
    const noCall = observer.capture(() => unused);
    expect(noCall.observations).toHaveLength(0);
    const capture = observer.capture(() => [fn(1), fn(1)]);
    expect(capture.value).toEqual([2, 2]);
    expect(calls).toBe(2);
    expect(capture.observations.filter(item => item.kind === 'implementation')).toHaveLength(1);
    const source = createProvider();
    source.set('analysis/author', implementation);
    expect(observer.compareCurrent(capture, source.provider).kind).toBe('equal');
    source.set('analysis/author', (value: number) => value + 2);
    expect(observer.compareCurrent(capture, source.provider).kind).toBe('changed');
  });

  test('uninspectable current implementation replacements are unavailable without executing them', () => {
    let replacementCalls = 0;
    const original = observer.tracked(() => 'original', binding);
    const capture = observer.capture(() => original());
    const boundReplacement = function replacement(): string {
      replacementCalls += 1;
      return 'replacement';
    }.bind(undefined);

    for (const replacement of [Math.max, boundReplacement]) {
      const comparison = observer.compareCurrent(capture, {
        resolve: () => ({ kind: 'available', fact: replacement }),
      });
      expect(comparison.kind).toBe('unavailable');
    }
    expect(replacementCalls).toBe(0);
  });

  test('current implementation comparison preserves host digest failures', () => {
    const failure = new TypeError('host digest failed');
    let digestUnavailable = false;
    const host: IMachine = {
      ...machine,
      sha256(input: string): string {
        if (digestUnavailable) {
          throw failure;
        }
        return machine.sha256(input);
      },
    };
    const isolated = createTrackingObserver(host);
    const tracked = isolated.tracked(() => 'original', binding);
    const capture = isolated.capture(() => tracked());
    const replacement = (): string => 'replacement';
    digestUnavailable = true;

    expect(() => isolated.compareCurrent(capture, {
      resolve: () => ({ kind: 'available', fact: replacement }),
    })).toThrow(failure);
  });

  test('classifies unsupported materialized output as incompatible', () => {
    // eslint-disable-next-line microdelta/tracked-captures -- This runtime fixture captures materialized output to test unsupported current payload classification.
    const outputCapture = observer.capture(() => observer.snapshotOutput(observer.tracked({ result: 'Ada' }, binding)));

    expect(observer.compareCurrent(outputCapture, {
      resolve: () => ({ kind: 'available', fact: () => 'functions are not materialized data' }),
    }).kind).toBe('incompatible');
  });

  test('classifies unsupported collection order as incompatible', () => {
    // eslint-disable-next-line microdelta/tracked-captures -- This runtime fixture captures collection order to test unsupported current order data.
    const orderCapture = observer.capture(() => observer.materialization.recordCollectionOrder(binding, ['member-a', 'member-b']));
    const unsupportedOrder = ['member-a', 'member-b'];
    Object.defineProperty(unsupportedOrder, 'hidden', { value: 'outside selected order data' });

    expect(observer.compareCurrent(orderCapture, {
      resolve: () => ({ kind: 'available', fact: unsupportedOrder }),
    }).kind).toBe('incompatible');
  });

  test('materialized output and collection order digest failures remain host errors', () => {
    const failure = new TypeError('host digest failed');
    let digestUnavailable = false;
    const host: IMachine = {
      ...machine,
      sha256(input: string): string {
        if (digestUnavailable) {
          throw failure;
        }
        return machine.sha256(input);
      },
    };
    const isolated = createTrackingObserver(host);
    const tracked = isolated.tracked({ result: 'Ada' }, binding);
    const outputCapture = isolated.capture(() => isolated.snapshotOutput(tracked));
    // eslint-disable-next-line microdelta/tracked-captures -- This host-failure fixture must record collection-order evidence through the real capture path.
    const orderCapture = isolated.capture(() => isolated.materialization.recordCollectionOrder(binding, ['member-a', 'member-b']));
    digestUnavailable = true;

    expect(() => isolated.compareCurrent(outputCapture, {
      resolve: () => ({ kind: 'available', fact: { result: 'Ada' } }),
    })).toThrow(failure);
    expect(() => isolated.compareCurrent(orderCapture, {
      resolve: () => ({ kind: 'available', fact: ['member-a', 'member-b'] }),
    })).toThrow(failure);
  });

  test('selected fact digest failures remain host errors', () => {
    const failure = new TypeError('host digest failed');
    let digestUnavailable = false;
    const host: IMachine = {
      ...machine,
      sha256(input: string): string {
        if (digestUnavailable) {
          throw failure;
        }
        return machine.sha256(input);
      },
    };
    const isolated = createTrackingObserver(host);
    const tracked = isolated.tracked({ name: 'Ada' }, binding);
    const capture = isolated.capture(() => tracked.name);
    const currentFact = {
      operation: 'value',
      address: [{ kind: 'property', key: 'name' }],
      fact: 'Ada',
    };
    digestUnavailable = true;

    expect(() => isolated.compareCurrent(capture, {
      resolve: () => ({ kind: 'available', fact: currentFact }),
    })).toThrow(failure);
  });

  test('function-source fingerprints preserve distinct unpaired UTF-16 surrogate code units', () => {
    const highSurrogate = String.fromCharCode(0xd800);
    const lowSurrogate = String.fromCharCode(0xd801);
    // Dynamic construction is necessary because UTF-8 source files cannot contain lone surrogates directly.
    const high = new Function(`return '${highSurrogate}'`) as () => string;
    const low = new Function(`return '${lowSurrogate}'`) as () => string;
    expect(Function.prototype.toString.call(high)).not.toBe(Function.prototype.toString.call(low));
    expect(machine.sha256(Function.prototype.toString.call(high))).toBe(machine.sha256(Function.prototype.toString.call(low)));

    const capture = observer.capture(() => {
      // eslint-disable-next-line microdelta/tracked-captures -- This runtime fixture registers dynamically constructed functions to compare their source fingerprints.
      const first = observer.tracked(high, binding);
      // eslint-disable-next-line microdelta/tracked-captures -- This runtime fixture registers dynamically constructed functions to compare their source fingerprints.
      const second = observer.tracked(low, binding);
      return [first(), second()];
    });
    const implementations = capture.observations.filter(item => item.kind === 'implementation');
    expect(implementations).toHaveLength(2);
    expect(implementations[0]?.fingerprint).not.toBe(implementations[1]?.fingerprint);
  });

  test('rejects callable forms without source evidence and unsupported function metadata or construction', () => {
    const original = function add(value: number): number { return value + 1; };
    const bound = original.bind(undefined);
    // eslint-disable-next-line microdelta/tracked-captures -- The runtime negative case proves native builtins are rejected as tracked functions.
    expect(() => observer.tracked(Math.max, binding)).toThrow(/source|native/i);
    // eslint-disable-next-line microdelta/tracked-captures -- The runtime negative case proves bound functions are rejected as tracked functions.
    expect(() => observer.tracked(bound, binding)).toThrow(/source|native/i);

    let constructed = false;
    function ConstructorLike(): void { constructed = true; }
    const tracked = observer.tracked(ConstructorLike, binding);
    expect(() => { Reflect.construct(tracked, []); }).toThrow(/construct|ordinary call/i);
    expect(constructed).toBe(false);
    expect(() => { Reflect.get(tracked, 'name'); }).toThrow(/function|metadata|property/i);
    expect(() => Reflect.set(tracked, 'extra', true)).toThrow(/immutable|property|function/i);
  });

  test('inspectable function text containing native-code wording remains supported', () => {
    const literal = observer.tracked(() => '[native code]', binding);
    const block = observer.tracked(() => { return '[native code]'; }, binding);
    expect(literal()).toBe('[native code]');
    expect(block()).toBe('[native code]');
  });

  test('cached derivations replay successful and failed semantic observations, including nested derivations', () => {
    const source = observer.tracked({ enabled: true, left: 'yes', right: 'no' }, binding);
    const input = observer.local.cell(source);
    let calls = 0;
    // eslint-disable-next-line microdelta/tracked-captures -- This runtime cache test counts deliberate closure side effects to verify only stale derivations rerun.
    const child = observer.derived(() => { calls++; return input.get().enabled ? input.get().left : input.get().right; });
    const parent = observer.derived(() => child.get());
    const first = observer.capture(() => parent.get());
    const cached = observer.capture(() => parent.get());
    expect(first.observations.map(item => item.fingerprint)).toEqual(cached.observations.map(item => item.fingerprint));
    expect(calls).toBe(1);

    const failure = new Error('selected branch failed');
    // eslint-disable-next-line microdelta/tracked-captures -- This runtime failure replay test deliberately closes over the exact error object it throws.
    const throws = observer.derived(() => { input.get().enabled; throw failure; });
    const catching = observer.derived(() => {
      try {
        throws.get();
      } catch (error: unknown) {
        // eslint-disable-next-line microdelta/tracked-captures -- The runtime failure replay test compares the captured error with its original test-owned object.
        if (error !== failure) { throw error; }
      }
      return 'caught';
    });
    const firstFailure = observer.capture(() => catching.get());
    const cachedFailure = observer.capture(() => catching.get());
    expect(firstFailure.value).toBe('caught');
    expect(firstFailure.observations.map(item => item.fingerprint)).toEqual(cachedFailure.observations.map(item => item.fingerprint));
  });

  test('cached derivations replay materialized output, projection, and order facts on both success and failure', () => {
    const source = observer.tracked({ profile: { name: 'Ada' } }, binding);
    const projection = {
      descriptor: {
        address: [{ kind: 'property' as const, key: 'name' }],
        operation: 'value' as const,
        traversal: { kind: 'exhaustive' as const, complete: true as const },
      },
      members: [['user-a', 'Ada']] as const,
    };
    const keys = ['user-a', 'user-b'];
    let successCalls = 0;
    const success = observer.derived(() => {
      // eslint-disable-next-line microdelta/tracked-captures -- This counter is the runtime proof that cached derivation bodies do not replay.
      successCalls += 1;
      observer.snapshotOutput(source.profile);
      // eslint-disable-next-line microdelta/tracked-captures -- This runtime test exercises Tracking's internal projection-recording port directly.
      observer.materialization.recordProjection(binding, projection);
      // eslint-disable-next-line microdelta/tracked-captures -- This runtime test exercises Tracking's internal member-order recording port directly.
      observer.materialization.recordCollectionOrder(binding, keys);
      return 'complete';
    });
    const firstSuccess = observer.capture(() => success.get());
    const cachedSuccess = observer.capture(() => success.get());

    expect(firstSuccess.value).toBe('complete');
    expect(firstSuccess.observations.map(item => item.kind).sort())
      .toEqual(['collection-order', 'materialized-output', 'projection']);
    expect(cachedSuccess.observations.map(item => item.fingerprint))
      .toEqual(firstSuccess.observations.map(item => item.fingerprint));
    expect(successCalls).toBe(1);

    const failure = new Error('cached selected projection failed');
    let failureCalls = 0;
    const failed = observer.derived(() => {
      // eslint-disable-next-line microdelta/tracked-captures -- This counter proves a cached failure body is not executed a second time.
      failureCalls += 1;
      observer.snapshotOutput(source.profile);
      // eslint-disable-next-line microdelta/tracked-captures -- This runtime test exercises Tracking's internal projection-recording port directly.
      observer.materialization.recordProjection(binding, projection);
      // eslint-disable-next-line microdelta/tracked-captures -- This runtime test exercises Tracking's internal member-order recording port directly.
      observer.materialization.recordCollectionOrder(binding, keys);
      // eslint-disable-next-line microdelta/tracked-captures -- This exact error is the cached failure identity under test.
      throw failure;
    });
    const captureFailure = () => observer.capture(() => {
      try {
        failed.get();
      } catch (error: unknown) {
        // eslint-disable-next-line microdelta/tracked-captures -- The runtime test compares replayed failure identity with its original test-owned error.
        if (error !== failure) { throw error; }
      }
      return 'caught';
    });
    const firstFailure = captureFailure();
    const cachedFailure = captureFailure();

    expect(firstFailure.value).toBe('caught');
    expect(firstFailure.observations.map(item => item.kind).sort())
      .toEqual(['collection-order', 'materialized-output', 'projection']);
    expect(cachedFailure.observations.map(item => item.fingerprint))
      .toEqual(firstFailure.observations.map(item => item.fingerprint));
    expect(failureCalls).toBe(1);
  });

  test('retains only projection descriptor and digest while keeping visited coverage explicit', () => {
    const selectedPayload = 'SELECTED-MEMBER-PAYLOAD-'.concat('x'.repeat(256));
    const exhaustive: IValueProjectionFact = {
      descriptor: {
        address: [{ kind: 'property' as const, key: 'name' }],
        operation: 'value',
        traversal: { kind: 'exhaustive', complete: true },
      },
      members: Array.from({ length: 64 }, (_unused, index) => [`member-${index}`, `${selectedPayload}-${index}`] as const),
    };
    // eslint-disable-next-line microdelta/tracked-captures -- This runtime assertion exercises Tracking's internal projection-recording port directly.
    const captured = observer.capture(() => observer.materialization.recordProjection(binding, exhaustive));
    expect(captured.observations).toHaveLength(1);
    const projection = captured.observations[0];
    expect(projection?.kind).toBe('projection');
    expect(projection?.fingerprint).toMatch(/^[0-9a-f]{64}$/u);
    expect(projection && 'encoded' in projection).toBe(false);
    expect(JSON.stringify(projection)).not.toContain(selectedPayload);

    const small: IValueProjectionFact = { ...exhaustive, members: exhaustive.members.slice(0, 1) };
    // eslint-disable-next-line microdelta/tracked-captures -- This runtime assertion exercises Tracking's internal projection-recording port directly.
    const capturedSmall = observer.capture(() => observer.materialization.recordProjection(binding, small));
    expect(JSON.stringify(capturedSmall.observations[0])).toHaveLength(JSON.stringify(projection).length);
    const current = (fact: IValueProjectionFact): { resolve: (_binding: ITrackingBinding, request: ICurrentFactRequest) => ICurrentFactResolution } => ({
      resolve(_binding, request) {
        return request.kind === 'projection' ? { kind: 'available', fact } : { kind: 'unavailable' };
      },
    });
    expect(observer.compareCurrent(captured, current(exhaustive)).kind).toBe('equal');
    expect(observer.compareCurrent(captured, current({ ...exhaustive, members: [...exhaustive.members, ['new-member', 'new value']] })).kind)
      .toBe('changed');

    const visited: IValueProjectionFact = {
      descriptor: {
        ...exhaustive.descriptor,
        traversal: { kind: 'visited', complete: false, keys: ['member-7', 'member-2'] },
      },
      members: [['member-7', selectedPayload], ['member-2', `${selectedPayload}-2`]],
    };
    // eslint-disable-next-line microdelta/tracked-captures -- This runtime assertion exercises Tracking's internal projection-recording port directly.
    const capturedVisited = observer.capture(() => observer.materialization.recordProjection(binding, visited));
    expect(capturedVisited.observations).toHaveLength(1);
    expect(capturedVisited.observations[0]?.selection).toMatchObject({
      kind: 'projection',
      descriptor: { traversal: { kind: 'visited', complete: false, keys: ['member-7', 'member-2'] } },
    });
    expect(JSON.stringify(capturedVisited.observations[0])).not.toContain(selectedPayload);
  });

  test('classifies a valid projection with a different selected address or traversal as incompatible before hashing', () => {
    const failure = new TypeError('projection comparison must not hash a mismatched selection');
    let digestUnavailable = false;
    const host: IMachine = {
      ...machine,
      sha256(input: string): string {
        if (digestUnavailable) {
          throw failure;
        }
        return machine.sha256(input);
      },
    };
    const isolated = createTrackingObserver(host);
    const exhaustive: IValueProjectionFact = {
      descriptor: {
        address: [
          { kind: 'property', key: 'profile' },
          { kind: 'property', key: 'name' },
        ],
        operation: 'value',
        traversal: { kind: 'exhaustive', complete: true },
      },
      members: [['member-a', 'Ada'], ['member-b', 'Bo']],
    };
    const capture = isolated.capture(() => isolated.materialization.recordProjection(binding, exhaustive));
    digestUnavailable = true;
    const changedAddress: IValueProjectionFact = {
      ...exhaustive,
      descriptor: {
        ...exhaustive.descriptor,
        address: [
          { kind: 'property', key: 'profile' },
          { kind: 'property', key: 'age' },
        ],
      },
    };
    const changedTraversal: IValueProjectionFact = {
      ...exhaustive,
      descriptor: {
        ...exhaustive.descriptor,
        traversal: { kind: 'visited', complete: false, keys: ['member-a'] },
      },
      members: [['member-a', 'Ada']],
    };

    for (const fact of [changedAddress, changedTraversal]) {
      expect(isolated.compareCurrent(capture, {
        resolve: () => ({ kind: 'available', fact }),
      }).kind).toBe('incompatible');
    }
  });

  test('projection descriptors compare semantically while matching changed content still hashes', () => {
    const failure = new TypeError('projection digest failed');
    let digestUnavailable = false;
    const host: IMachine = {
      ...machine,
      sha256(input: string): string {
        if (digestUnavailable) {
          throw failure;
        }
        return machine.sha256(input);
      },
    };
    const isolated = createTrackingObserver(host);
    const capturedFact: IValueProjectionFact = {
      descriptor: {
        address: [{ kind: 'property', key: 'name' }],
        operation: 'value',
        traversal: { kind: 'exhaustive', complete: true },
      },
      members: [['member-a', 'Ada'], ['member-b', 'Bo']],
    };
    const capture = isolated.capture(() => isolated.materialization.recordProjection(binding, capturedFact));
    const semanticallyEqual: IValueProjectionFact = {
      descriptor: {
        traversal: { complete: true, kind: 'exhaustive' },
        operation: 'value',
        address: [{ key: 'name', kind: 'property' }],
      },
      members: [['member-b', 'Bo'], ['member-a', 'Ada']],
    };
    const changedContent: IValueProjectionFact = {
      ...semanticallyEqual,
      members: [['member-b', 'Bo'], ['member-a', 'Grace']],
    };
    const compare = (fact: IValueProjectionFact) => isolated.compareCurrent(capture, {
      resolve: () => ({ kind: 'available', fact }),
    });

    expect(compare(semanticallyEqual).kind).toBe('equal');
    expect(compare(changedContent).kind).toBe('changed');
    digestUnavailable = true;
    expect(() => compare(changedContent)).toThrow(failure);
  });

  test('projection descriptor comparison accepts Value-normalized null-prototype records', () => {
    const ordinary: IValueProjectionFact = {
      descriptor: {
        address: [{ kind: 'property', key: 'name' }],
        operation: 'value',
        traversal: { kind: 'exhaustive', complete: true },
      },
      members: [['member-a', 'Ada']],
    };
    const segment: IValueProjectionFact['descriptor']['address'][number] = { kind: 'property', key: 'name' };
    const traversal: IValueProjectionFact['descriptor']['traversal'] = { kind: 'exhaustive', complete: true };
    Object.setPrototypeOf(segment, null);
    Object.setPrototypeOf(traversal, null);
    const descriptor: IValueProjectionFact['descriptor'] = {
      address: [segment],
      operation: 'value',
      traversal,
    };
    Object.setPrototypeOf(descriptor, null);
    const nullPrototype: IValueProjectionFact = { descriptor, members: [['member-a', 'Ada']] };
    const capture = observer.capture(() => observer.materialization.recordProjection(binding, ordinary));

    expect(encodeProjectionFact(nullPrototype)).toBe(encodeProjectionFact(ordinary));
    expect(observer.compareCurrent(capture, {
      resolve: () => ({ kind: 'available', fact: nullPrototype }),
    }).kind).toBe('equal');
  });

  test('visited projection selection preserves ordered keys, membership, and completion semantics', () => {
    const selected: IValueProjectionFact = {
      descriptor: {
        address: [{ kind: 'property', key: 'name' }],
        operation: 'value',
        traversal: { kind: 'visited', complete: false, keys: ['member-a', 'member-b'] },
      },
      members: [['member-a', 'Ada'], ['member-b', 'Bo']],
    };
    const capture = observer.capture(() => observer.materialization.recordProjection(binding, selected));
    const reorderedVisitedKeys: IValueProjectionFact = {
      ...selected,
      descriptor: {
        ...selected.descriptor,
        traversal: { kind: 'visited', complete: false, keys: ['member-b', 'member-a'] },
      },
      members: [['member-b', 'Bo'], ['member-a', 'Ada']],
    };
    const differentVisitedMembers: IValueProjectionFact = {
      ...selected,
      descriptor: {
        ...selected.descriptor,
        traversal: { kind: 'visited', complete: false, keys: ['member-a', 'member-c'] },
      },
      members: [['member-a', 'Ada'], ['member-c', 'Cy']],
    };
    const exhaustive: IValueProjectionFact = {
      ...selected,
      descriptor: {
        ...selected.descriptor,
        traversal: { kind: 'exhaustive', complete: true },
      },
    };

    for (const fact of [reorderedVisitedKeys, differentVisitedMembers, exhaustive]) {
      expect(observer.compareCurrent(capture, {
        resolve: () => ({ kind: 'available', fact }),
      }).kind).toBe('incompatible');
    }
  });

  test('local replacement invalidates tags and replaces the semantic branch observations', () => {
    const input = observer.local.cell(observer.tracked({ enabled: true, left: 'yes', right: 'no' }, binding));
    const output = observer.derived(() => input.get().enabled ? input.get().left : input.get().right);
    const first = observer.capture(() => output.get());
    input.set(observer.tracked({ enabled: false, left: 'yes', right: 'no' }, binding));
    const second = observer.capture(() => output.get());
    expect(second.value).toBe('no');
    expect(first.observations.map(item => item.address)).not.toEqual(second.observations.map(item => item.address));
  });

  test('closed inherited frames reject first and dirty derived evaluation before callbacks run', async () => {
    let firstCalls = 0;
    // eslint-disable-next-line microdelta/tracked-captures -- This runtime test counts calls while a closed frame must reject without evaluating its scalar derivation.
    const first = observer.derived(() => { firstCalls += 1; return firstCalls; });
    const state = observer.local.cell('initial');
    let dirtyCalls = 0;
    // eslint-disable-next-line microdelta/tracked-captures -- This runtime counterexample verifies scalar-cell reads are rejected after frame closure.
    const dirty = observer.derived(() => { dirtyCalls += 1; return state.get(); });
    expect(dirty.get()).toBe('initial');
    state.set('updated');

    let release: () => void = () => undefined;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    const detached: Promise<void>[] = [];
    const errors: unknown[] = [];
    await observer.captureAsync(async () => {
      // eslint-disable-next-line microdelta/tracked-captures -- The runtime test retains detached promises so it can release and inspect them after the capture closes.
      detached.push((async () => {
        // eslint-disable-next-line microdelta/tracked-captures -- This detached continuation waits on a test-controlled gate after its capture closes.
        await gate;
        // eslint-disable-next-line microdelta/tracked-captures -- This detached continuation collects its expected closed-frame error for the assertion below.
        try { first.get(); } catch (error: unknown) { errors.push(error); }
      })());
      // eslint-disable-next-line microdelta/tracked-captures -- The runtime test retains detached promises so it can release and inspect them after the capture closes.
      detached.push((async () => {
        // eslint-disable-next-line microdelta/tracked-captures -- This detached continuation waits on a test-controlled gate after its capture closes.
        await gate;
        // eslint-disable-next-line microdelta/tracked-captures -- This detached continuation collects its expected closed-frame error for the assertion below.
        try { dirty.get(); } catch (error: unknown) { errors.push(error); }
      })());
    });

    release();
    await Promise.all(detached);
    expect(errors).toHaveLength(2);
    expect(errors.every((error) => error instanceof Error && /closed/i.test(error.message))).toBe(true);
    expect(firstCalls).toBe(0);
    expect(dirtyCalls).toBe(1);
  });

  test('async capture isolates concurrent frames and rejects detached reads after closure', async () => {
    const a = observer.tracked({ value: 'a' }, { path: ['a'] });
    const b = observer.tracked({ value: 'b' }, { path: ['b'] });
    let resume: (() => void) | undefined;
    const gate = new Promise<void>(resolve => { resume = resolve; });
    let detached: Promise<string> | undefined;
    // eslint-disable-next-line microdelta/tracked-captures -- The runtime race fixture deliberately detaches a continuation behind a test-controlled gate and uses native Promise scheduling.
    const first = observer.captureAsync(async () => { detached = (async () => { await gate; return a.value; })(); await Promise.resolve(); return a.value; });
    // eslint-disable-next-line microdelta/tracked-captures -- Native Promise scheduling is the mechanism under test for concurrent async capture isolation.
    const second = observer.captureAsync(async () => { await Promise.resolve(); return b.value; });
    const [aResult, bResult] = await Promise.all([first, second]);
    resume?.();
    await expect(detached).rejects.toThrow(/closed|late/i);
    expect(aResult.observations.map(item => item.binding)).toEqual([{ path: ['a'] }]);
    expect(bResult.observations).toHaveLength(1);
  });

  test('async tracked calls preserve post-await reads and nested failure restores the parent capture', async () => {
    const input = observer.tracked({ value: 'after await' }, { path: ['async'] });
    const asyncCall = observer.tracked(async () => {
      // eslint-disable-next-line microdelta/tracked-captures -- Native Promise scheduling is the mechanism under test for a tracked async callback.
      await Promise.resolve();
      return input.value;
    }, { path: ['async-call'] });
    const failure = new Error('nested capture failed');
    const postFailure = observer.tracked({ parentOnly: 'parent after inner failure' }, { path: ['async-parent'] });
    const capture = await observer.captureAsync(async () => {
      const value = await asyncCall();
      const nestedFailure = observer.captureAsync(async () => {
        // eslint-disable-next-line microdelta/tracked-captures -- Native Promise scheduling drives the nested async failure restoration assertion.
        await Promise.resolve();
        void input.value;
        // eslint-disable-next-line microdelta/tracked-captures -- The runtime test throws its exact captured error object through the nested async boundary.
        throw failure;
      });
      // eslint-disable-next-line microdelta/tracked-captures -- Jest's assertion helper inspects the deliberate nested failure as part of this runtime test.
      await expect(nestedFailure).rejects.toBe(failure);
      // eslint-disable-next-line microdelta/tracked-captures -- Native Promise scheduling is the mechanism under test for parent-frame restoration.
      await Promise.resolve();
      void postFailure.parentOnly;
      return value;
    });
    expect(capture.value).toBe('after await');
    expect(capture.observations.map(item => item.kind)).toEqual(['implementation', 'fact', 'fact']);
    expect(capture.observations[2]?.address).toEqual([{ kind: 'property', key: 'parentOnly' }]);
  });

  test('primitive and class inputs fail at runtime', () => {
    expect(() => { Reflect.apply(observer.tracked, observer, [3, binding]); }).toThrow(/object|function/i);
    expect(() => { Reflect.apply(observer.tracked, observer, [null, binding]); }).toThrow(/object|function/i);
    class Unsupported { readonly value = 1; }
    expect(() => observer.tracked(new Unsupported(), binding)).toThrow(/plain|unsupported/i);
    expect(() => observer.tracked(Unsupported, binding)).toThrow(/class|unsupported/i);
    // Keep the comment spelling intact; the TypeScript compiler inserts spaces into inline class syntax.
    const createCommentedClass = new Function('return class/**/C {}') as () => new () => object;
    expect(Function.prototype.toString.call(createCommentedClass())).toContain('class/**/C');
    expect(() => observer.tracked(createCommentedClass(), binding)).toThrow(/class|unsupported/i);
  });
});
