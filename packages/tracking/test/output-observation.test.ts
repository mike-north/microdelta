import { describe, expect, test } from '@jest/globals';
import { createHash } from 'node:crypto';
import { AsyncLocalStorage } from 'node:async_hooks';
import type { IMachine } from '@microdelta/machine';
import type { IValueProjectionFact } from '@microdelta/value';

import { createTrackingObserver } from '../src/index.js';

/** Provide portable hashing and async-context capabilities to the observer. */
const machine: IMachine = {
  createAsyncContext<T>() { return new AsyncLocalStorage<T>(); },
  snapshot<T>(value: T): T { return structuredClone(value); },
  sha256(input: string): string { return createHash('sha256').update(input, 'utf8').digest('hex'); },
};

describe('explicit tracked-output observation', () => {
  test('pass-through stays neutral until snapshotOutput explicitly detaches the selected subtree', () => {
    const observer = createTrackingObserver(machine);
    const tracked = observer.tracked({ profile: { name: 'Ada', tags: ['author'] }, unread: 'large' }, { path: ['input'] });
    const passThrough = observer.capture(() => tracked);
    expect(passThrough.observations).toHaveLength(0);

    const outputCapture = observer.capture(() => observer.snapshotOutput(tracked.profile));
    expect(outputCapture.value).toEqual({ name: 'Ada', tags: ['author'] });
    expect(observer.materialization.owns(outputCapture.value)).toBe(false);
    expect(outputCapture.observations).toHaveLength(1);
    expect(outputCapture.observations[0]).toMatchObject({ kind: 'materialized-output', address: [{ kind: 'property', key: 'profile' }] });
    expect(Object.isFrozen(outputCapture.value)).toBe(true);
  });

  test('ordinary local containers are copied without an external dependency and supported shape is preserved', () => {
    const observer = createTrackingObserver(machine);
    const prototype = Object.assign(Object.create(null) as { readonly marker?: string }, { marker: 'custom' });
    const sparse = new Array<number>(3);
    sparse[2] = 7;
    const source = Object.assign(Object.create(prototype) as { readonly before?: string; readonly sparse: number[]; readonly after: string }, { after: 'end', sparse });
    Object.defineProperty(source, 'before', { value: 'first', enumerable: true, configurable: true, writable: true });
    const keys = Object.keys(source);
    // eslint-disable-next-line microdelta/tracked-captures -- This runtime test verifies plain local output is copied without claiming a tracked dependency.
    const capture = observer.capture(() => observer.snapshotOutput(source));

    expect(capture.observations).toHaveLength(0);
    expect(Object.keys(capture.value)).toEqual(keys);
    expect(Object.getPrototypeOf(capture.value)).toEqual({ marker: 'custom' });
    expect(0 in capture.value.sparse).toBe(false);
    expect(2 in capture.value.sparse).toBe(true);
    expect(capture.value.sparse[2]).toBe(7);
    expect(Object.isFrozen(capture.value.sparse)).toBe(true);
  });

  test('rejects cycles, repeated references, and accessors without invoking getters or recording fabricated output facts', () => {
    const observer = createTrackingObserver(machine);
    const tracked = observer.tracked({ subtree: { value: 1 } }, { path: ['input'] });
    const shared = { value: 1 };
    const cyclic: { self?: unknown } = {};
    cyclic.self = cyclic;
    let getterCalls = 0;
    const accessor = Object.defineProperty({}, 'value', { enumerable: true, get() { getterCalls += 1; return 1; } });

    for (const rejected of [
      () => observer.snapshotOutput({ left: shared, right: shared }),
      () => observer.snapshotOutput(cyclic),
      () => observer.snapshotOutput(accessor),
      () => observer.snapshotOutput({ left: tracked.subtree, right: tracked.subtree }),
    ]) {
      const capture = observer.capture(() => {
        try {
          // eslint-disable-next-line microdelta/tracked-captures -- This runtime test invokes each deliberately invalid output to prove validation rejects it before recording evidence.
          return rejected();
        } catch (error: unknown) {
          return error;
        }
      });
      expect(capture.value).toBeInstanceOf(TypeError);
      expect(capture.observations.some(observation => observation.kind === 'materialized-output')).toBe(false);
    }
    expect(getterCalls).toBe(0);
  });

  test('supports output of a previously selected scalar without enumerating unread siblings', () => {
    const observer = createTrackingObserver(machine);
    const tracked = observer.tracked({ name: 'Ada', sibling: { unread: true } }, { path: ['input'] });
    const capture = observer.capture(() => observer.snapshotOutput({ name: tracked.name }));

    expect(capture.value).toEqual({ name: 'Ada' });
    expect(capture.observations).toHaveLength(1);
    expect(capture.observations[0]?.address).toEqual([{ kind: 'property', key: 'name' }]);
  });

  test('keeps keyed content and used member order as separate observation facts', () => {
    const observer = createTrackingObserver(machine);
    const binding = { path: ['inputs', 'roster'] };
    const projection: IValueProjectionFact = {
      descriptor: {
        address: [{ kind: 'property', key: 'name' }],
        operation: 'value',
        traversal: { kind: 'exhaustive', complete: true },
      },
      members: [['user-a', 'Ada'], ['user-b', 'Grace']],
    };
    const capture = observer.capture(() => {
      // eslint-disable-next-line microdelta/tracked-captures -- This runtime test records a deliberately assembled Value fact through Tracking's internal port.
      observer.materialization.recordProjection(binding, projection);
      // eslint-disable-next-line microdelta/tracked-captures -- This runtime test records explicit member order through Tracking's internal port.
      observer.materialization.recordCollectionOrder(binding, ['user-a', 'user-b']);
      return 'done';
    });

    expect(capture.observations.map(item => item.kind)).toEqual(['projection', 'collection-order']);
    expect(capture.observations[0]?.encodingVersion).toBe('MDP1');
    expect(capture.observations[1]?.encodingVersion).toBe('MDV1');
    expect(capture.observations[0]?.fingerprint).not.toBe(capture.observations[1]?.fingerprint);
  });

  test('rejects the materialization bridge on unowned values', () => {
    const observer = createTrackingObserver(machine);
    const other = createTrackingObserver(machine);
    const foreign = other.tracked({ name: 'not tracked' }, { path: ['foreign'] });
    expect(() => observer.materialization.read(foreign, 'name')).toThrow(/observer-owned/i);
  });
});
