/**
 * Own presence is an owner operation, distinct from inherited membership and
 * value reads. These controls protect the narrow authoring capability's
 * delegated semantics, rejection boundary, and existing capture lifetime.
 */
import { AsyncLocalStorage } from 'node:async_hooks';
import { createHash } from 'node:crypto';

import { describe, expect, test } from '@jest/globals';
import type { IMachine } from '@microdelta/machine';
import { navigate, observe, recordFromEntries } from '@microdelta/value';

import { createTrackingObserver } from '../src/index.js';
import type { ITracked, ITrackedNodeSource, ITrackingObserver } from '../src/index.js';

/** Host facilities contain no own-presence policy. */
const machine: IMachine = {
  createAsyncContext<T>() { return new AsyncLocalStorage<T>(); },
  snapshot<T>(value: T): T { return structuredClone(value); },
  sha256(input: string): string { return createHash('sha256').update(input, 'utf8').digest('hex'); },
};

/** Local and retained views must agree without a payload-wide read during selection. */
function view(observer: ITrackingObserver, root: object, lazy: boolean): ITracked<object> {
  if (!lazy) {
    return observer.tracked(root, { path: ['config'] });
  }
  const source: ITrackedNodeSource = {
    node: (address) => navigate(root, address),
    select: (address, operation) => observe(root, address, operation),
    subtree: () => { throw new Error('Own presence must not request a subtree'); },
  };
  return observer.materialization.lazyView({ path: ['config'] }, source);
}

/** Exercise untyped caller input without changing the supported TypeScript signature. */
function untypedOwn(observer: ITrackingObserver, value: unknown, key: unknown): unknown {
  return Reflect.apply(observer.hasOwn, observer, [value, key]);
}

/** A supported custom prototype distinguishes membership from own presence. */
function inheritedRecord(): object {
  return recordFromEntries([], { optional: undefined });
}

describe.each([false, true])('own presence with lazy=%s', (lazy) => {
  test('TRK-5: inherited presence stays not-own while own undefined is own', () => {
    const observer = createTrackingObserver(machine);
    for (const [root, own, membership] of [
      [{}, false, false],
      [inheritedRecord(), false, true],
      [{ optional: undefined }, true, true],
    ] as const) {
      const tracked = view(observer, root, lazy);
      const captured = observer.capture(() => ({ own: observer.hasOwn(tracked, 'optional'), membership: 'optional' in tracked }));
      expect(captured.value).toEqual({ own, membership });
      expect(captured.observations.map((entry) => entry.operation)).toEqual(['own', 'membership']);
      expect(captured.observations.map((entry) => entry.address)).toEqual([
        [{ kind: 'property', key: 'optional' }], [{ kind: 'property', key: 'optional' }],
      ]);
    }
    const intrinsic = view(observer, {}, lazy);
    expect(observer.capture(() => [observer.hasOwn(intrinsic, 'toString'), 'toString' in intrinsic]).value).toEqual([false, true]);
    const shadowed = view(observer, { toString: undefined }, lazy);
    expect(observer.capture(() => observer.hasOwn(shadowed, 'toString')).value).toBe(true);
  });

  test('TRK-5: supported array own-presence uses canonical positions, never array length or prototype names', () => {
    const observer = createTrackingObserver(machine);
    const tracked = view(observer, [undefined], lazy);
    expect(observer.capture(() => [observer.hasOwn(tracked, '0'), observer.hasOwn(tracked, '1')]).value).toEqual([true, false]);
    for (const key of ['length', 'map', '-1', '01', '1.0', '9007199254740992']) {
      // eslint-disable-next-line microdelta/tracked-captures -- This negative matrix intentionally varies unsupported array key data.
      expect(() => observer.capture(() => observer.hasOwn(tracked, key))).toThrow(TypeError);
    }
  });

  test('unsupported key inputs reject without coercion inside and outside captures', () => {
    const observer = createTrackingObserver(machine);
    const tracked = view(observer, {}, lazy);
    let coercions = 0;
    const hostileKey = { toString(): string { coercions++; return 'missing'; } };
    for (const key of [0, null, undefined, Symbol('missing'), hostileKey]) {
      expect(() => untypedOwn(observer, tracked, key)).toThrow(TypeError);
      // eslint-disable-next-line microdelta/tracked-captures -- An untyped boundary probe deliberately feeds invalid key data to the owner operation.
      expect(() => observer.capture(() => untypedOwn(observer, tracked, key))).toThrow(TypeError);
    }
    expect(coercions).toBe(0);
  });

  test('native reflection directs workspace authors to an accessible callback capability', () => {
    const observer = createTrackingObserver(machine);
    const tracked = view(observer, {}, lazy);
    expect(() => Object.hasOwn(tracked, 'optional')).toThrow(/callback.*hasOwn/u);
  });

  test('foreign and raw values cannot become false ownership facts', () => {
    const observer = createTrackingObserver(machine);
    const foreign = view(createTrackingObserver(machine), {}, lazy);
    for (const value of [foreign, {}, undefined, null, 1, 'record']) {
      expect(() => untypedOwn(observer, value, 'optional')).toThrow(/observer-owned/u);
    }
  });

  test('ordinary own-presence observations follow the current capture across awaits and nested captures', async () => {
    const observer = createTrackingObserver(machine);
    const tracked = view(observer, { outer: undefined, inner: undefined }, lazy);
    const capture = await observer.captureAsync(async () => {
      await undefined;
      const nested = observer.capture(() => observer.hasOwn(tracked, 'inner'));
      return { nested, own: observer.hasOwn(tracked, 'outer') };
    });
    expect(capture.value.own).toBe(true);
    expect(capture.value.nested.value).toBe(true);
    expect(capture.value.nested.observations.map((entry) => entry.address)).toEqual([[{ kind: 'property', key: 'inner' }]]);
    expect(capture.observations.map((entry) => entry.address)).toEqual([[{ kind: 'property', key: 'outer' }]]);
  });

  test('concurrent captures retain only their own selected presence facts', async () => {
    const observer = createTrackingObserver(machine);
    const tracked = view(observer, { left: undefined }, lazy);
    const [left, right] = await Promise.all([
      observer.captureAsync(async () => { await undefined; return observer.hasOwn(tracked, 'left'); }),
      observer.captureAsync(async () => { await undefined; return observer.hasOwn(tracked, 'right'); }),
    ]);
    expect(left.value).toBe(true);
    expect(right.value).toBe(false);
    expect(left.observations.map((entry) => entry.address)).toEqual([[{ kind: 'property', key: 'left' }]]);
    expect(right.observations.map((entry) => entry.address)).toEqual([[{ kind: 'property', key: 'right' }]]);
  });

  test('unsupported receiver surfaces cannot produce a false own-presence fact', () => {
    const observer = createTrackingObserver(machine);
    const accessor = Object.defineProperty({}, 'optional', { enumerable: true, get: () => undefined });
    for (const root of [accessor, new Map(), { [Symbol('field')]: undefined }]) {
      expect(() => observer.hasOwn(view(observer, root, lazy), 'optional')).toThrow();
    }
  });

  test('a continuation inherited from a closed capture cannot observe own presence', async () => {
    const observer = createTrackingObserver(machine);
    const tracked = view(observer, {}, lazy);
    let release: () => void = () => { throw new Error('Barrier not initialized'); };
    const barrier = new Promise<void>((resolve) => { release = resolve; });
    let late: Promise<unknown> = Promise.resolve();
    observer.capture(() => {
      // eslint-disable-next-line microdelta/tracked-captures -- The deferred test barrier intentionally resumes an owner operation in its closed capture.
      late = barrier.then(() => observer.hasOwn(tracked, 'optional')).catch((error: unknown) => error);
    });
    release();
    const error = await late;
    expect(error).toBeInstanceOf(Error);
    expect(error instanceof Error && error.message).toMatch(/closed/u);
  });
});


/** Local input wrapping validates its complete snapshot; lazy selection must not scan unrelated payloads. */
test('unsupported nested input values reject at the local snapshot boundary', () => {
  const observer = createTrackingObserver(machine);
  expect(() => observer.tracked({ nested: 1n }, { path: ['config'] })).toThrow();
});
