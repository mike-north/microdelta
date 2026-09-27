import { createHash } from 'node:crypto';
import { AsyncLocalStorage } from 'node:async_hooks';
import { describe, expect, test } from '@jest/globals';
import type { ICompletedResultReader, ICompletedResultReference } from '@microdelta/history';
import { encodeSelectedFact, fingerprint, observe } from '@microdelta/value';
import type { IAddressSegment, IOperation, ISelectedFact, IValueProjectionDescriptor, IValueProjectionFact } from '@microdelta/value';
import type { ITrackingObserverHost } from '@microdelta/tracking';
import { createTrackingObserver } from '@microdelta/tracking';
import type { ICurrentFactProvider, ICurrentFactResolution } from '@microdelta/tracking';

import { createMaterialization } from '../src/index.js';

/** Supply host hashing/context behavior while keeping the result reader a test-owned fake. */
const machine: ITrackingObserverHost = {
  createAsyncContext<T>() { return new AsyncLocalStorage<T>(); },
  sha256(input: string): string { return createHash('sha256').update(input, 'utf8').digest('hex'); },
};

/** Separate immutable snapshots from an independently pre-indexed metadata-only fingerprint table. */
function createExactReader(): {
  readonly reader: ICompletedResultReader;
  readonly reads: () => number;
  readonly selectedAddresses: () => readonly string[];
  readonly setMetadataAvailable: (available: boolean) => void;
} {
  const snapshots = new Map<string, Readonly<Record<string, unknown>>>([
    ['A', Object.freeze({ name: 'Ada', role: 'author', profile: Object.freeze({ color: 'blue' }), large: Object.freeze({ payload: 'A'.repeat(2048) }) })],
    ['B', Object.freeze({ name: 'Grace', role: 'engineer', profile: Object.freeze({ color: 'green' }), large: Object.freeze({ payload: 'B'.repeat(2048) }) })],
  ]);
  const selectedFingerprints = new Map<string, string>();
  for (const [locator, snapshot] of snapshots) {
    for (const key of ['name', 'role']) {
      const request = { kind: 'selected', operation: 'value', address: [{ kind: 'property', key }], encoding: 'MDO1' } as const;
      const selected = observe(snapshot, request.address, request.operation);
      selectedFingerprints.set(JSON.stringify([locator, request]), fingerprint(encodeSelectedFact(selected), machine));
    }
  }
  let selectedReads = 0;
  const addresses: string[] = [];
  let metadataAvailable = true;
  const resolve = (reference: ICompletedResultReference): Readonly<Record<string, unknown>> => {
    if (reference.kind !== 'completed-result' || !snapshots.has(reference.locator)) {
      throw new TypeError(`Unknown completed-result locator ${reference.locator}`);
    }
    return snapshots.get(reference.locator) as Readonly<Record<string, unknown>>;
  };
  return {
    reader: {
      readSelected(reference: ICompletedResultReference, request): ISelectedFact {
        selectedReads += 1;
        addresses.push(request.address.map((segment) => segment.kind === 'property' ? segment.key : `[${segment.index}]`).join('.'));
        return observeForTest(resolve(reference), request.address, request.operation);
      },
      resolveFingerprint(reference, request) {
        if (!metadataAvailable) {
          return { kind: 'unavailable' };
        }
        const fingerprintValue = selectedFingerprints.get(JSON.stringify([reference.locator, request]));
        return fingerprintValue === undefined
          ? { kind: 'unavailable' }
          : { kind: 'compatible', fingerprint: fingerprintValue };
      },
    },
    reads: () => selectedReads,
    selectedAddresses: () => Object.freeze([...addresses]),
    setMetadataAvailable(available) { metadataAvailable = available; },
  };
}

/** Test helper delegates exact selected semantics to the Value-owned observer. */
function observeForTest(root: unknown, address: readonly IAddressSegment[], operation: IOperation): ISelectedFact {
  return observe(root, address, operation);
}

/** Exercise JavaScript-only access that the scalar view intentionally omits from its TypeScript surface. */
function readUnsupportedProperty(value: object, key: string): void {
  Reflect.get(value, key);
}

/** Read keys from a projection member after the encoder guarantees supported data. */
function recordKeys(value: unknown): readonly string[] {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new TypeError('Expected a projected record value');
  }
  return Object.keys(value);
}

describe('selected materialization', () => {
  test('compatible metadata comparisons dispatch against current exact references without payload fallback', () => {
    const tracking = createTrackingObserver(machine);
    const exact = createExactReader();
    const materialization = createMaterialization({ tracking, reader: exact.reader });
    const referenceA: ICompletedResultReference = { kind: 'completed-result', locator: 'A' };
    const referenceB: ICompletedResultReference = { kind: 'completed-result', locator: 'B' };
    const viewA = materialization.materialize<{ readonly name: string; readonly role: string; readonly large: object }>(referenceA, { path: ['step', 'author'] });
    const before = exact.reads();
    const nameCapture = tracking.capture(() => viewA.name);
    const roleCapture = tracking.capture(() => viewA.role);
    expect(exact.reads()).toBe(before + 2);
    expect(exact.selectedAddresses()).toEqual(['name', 'role']);

    let currentReference = referenceA;
    const provider = materialization.currentProvider(
      () => currentReference,
      { resolve: (): ICurrentFactResolution => ({ kind: 'unavailable' }) },
    );
    const beforeComparison = exact.reads();
    expect(tracking.compareCurrent(nameCapture, provider).kind).toBe('equal');
    expect(tracking.compareCurrent(roleCapture, provider).kind).toBe('equal');
    expect(exact.reads()).toBe(beforeComparison);

    currentReference = referenceB;
    expect(viewA.name).toBe('Ada');
    expect(exact.reads()).toBe(beforeComparison + 1);
    const beforeChangedComparison = exact.reads();
    expect(tracking.compareCurrent(nameCapture, provider).kind).toBe('changed');
    expect(tracking.compareCurrent(roleCapture, provider).kind).toBe('changed');
    expect(exact.reads()).toBe(beforeChangedComparison);

    exact.setMetadataAvailable(false);
    expect(tracking.compareCurrent(nameCapture, provider).kind).toBe('unavailable');
    expect(exact.reads()).toBe(beforeChangedComparison);

    // Two narrow selections leave the large sibling untouched during reads and comparison.
    expect(exact.selectedAddresses()).toEqual(['name', 'role', 'name']);
    expect(exact.reads()).toBe(beforeChangedComparison);
  });

  test('inherited closed frames reject all explicit materialization before any work', async () => {
    const tracking = createTrackingObserver(machine);
    const exact = createExactReader();
    const materialization = createMaterialization({ tracking, reader: exact.reader });
    const reference: ICompletedResultReference = { kind: 'completed-result', locator: 'A' };
    const scalar = materialization.materialize<{ readonly name: string }>(reference, { path: ['step'] });
    const tracked = tracking.tracked({ subtree: { value: 'tracked' } }, { path: ['inputs'] });
    const projection: IValueProjectionFact = {
      descriptor: { address: [], operation: 'value', traversal: { kind: 'exhaustive', complete: true } },
      members: [['one', 'value']],
    };
    const errors: unknown[] = [];
    await tracking.captureAsync(async () => {
      for (const attempt of [
        () => scalar.name,
        // eslint-disable-next-line microdelta/tracked-captures -- This runtime race fixture tries an already assembled projection after its capture frame closes.
        () => materialization.project({ path: ['collection'] }, projection),
        () => materialization.observeMemberOrder({ path: ['collection'] }, ['one']),
        () => materialization.materializeOutput(tracked.subtree),
        () => materialization.materializeOutput({ local: 'only' }),
      ]) {
        // eslint-disable-next-line microdelta/tracked-captures -- The timer deliberately invokes captured work after the async observation frame has closed.
        setTimeout(() => {
          try { attempt(); } catch (error: unknown) {
            // eslint-disable-next-line microdelta/tracked-captures -- This runtime race fixture retains each expected closed-frame error for its assertion.
            errors.push(error);
          }
        }, 0);
      }
    });
    const reads = exact.reads();
    await new Promise((resolve) => setTimeout(resolve, 5));
    expect(errors).toHaveLength(5);
    expect(errors.every((error) => error instanceof Error && /closed/i.test(error.message))).toBe(true);
    expect(exact.reads()).toBe(reads);
  });

  test('loads only selected top-level scalars from the exact saved reference and records them in Tracking', () => {
    const tracking = createTrackingObserver(machine);
    const exact = createExactReader();
    const materialization = createMaterialization({ tracking, reader: exact.reader });
    const referenceA: ICompletedResultReference = { kind: 'completed-result', locator: 'A' };
    const referenceB: ICompletedResultReference = { kind: 'completed-result', locator: 'B' };
    const viewA = materialization.materialize<{ readonly name: string; readonly large: object }>(referenceA, { path: ['step', 'author'] });
    const readsBefore = exact.reads();
    const capture = tracking.capture(() => viewA.name);

    expect(capture.value).toBe('Ada');
    expect(capture.observations).toHaveLength(1);
    expect(capture.observations[0]).toMatchObject({ kind: 'fact', address: [{ kind: 'property', key: 'name' }] });
    expect(exact.reads()).toBe(readsBefore + 1);
    expect(() => readUnsupportedProperty(viewA, 'large')).toThrow(/scalar|nested|supported/i);
    expect(tracking.materialization.owns(viewA)).toBe(false);
    let currentReference = referenceA;
    const provider: ICurrentFactProvider = materialization.currentProvider(
      () => currentReference,
      { resolve: (): ICurrentFactResolution => ({ kind: 'unavailable' }) },
    );
    const beforeMetadataComparison = exact.reads();
    expect(tracking.compareCurrent(capture, provider).kind).toBe('equal');
    currentReference = referenceB;
    expect(tracking.compareCurrent(capture, provider).kind).toBe('changed');
    exact.setMetadataAvailable(false);
    expect(tracking.compareCurrent(capture, provider).kind).toBe('unavailable');
    expect(exact.reads()).toBe(beforeMetadataComparison);
    const viewB = materialization.materialize<{ readonly name: string }>(referenceB, { path: ['step', 'author'] });
    expect(viewB.name).toBe('Grace');
    expect(exact.reads()).toBe(beforeMetadataComparison + 1);
  });

  test('copies a validated locator when a lazy scalar view is created', () => {
    const tracking = createTrackingObserver(machine);
    const exact = createExactReader();
    const materialization = createMaterialization({ tracking, reader: exact.reader });
    const mutableReference = { kind: 'completed-result' as const, locator: 'A' };
    const view = materialization.materialize<{ readonly name: string }>(mutableReference, { path: ['step'] });
    mutableReference.locator = 'B';

    expect(view.name).toBe('Ada');
  });

  test('rejects getter-backed address segments without evaluating malformed reader data', () => {
    const tracking = createTrackingObserver(machine);
    const exact = createExactReader();
    let getterCalls = 0;
    const reader: ICompletedResultReader = {
      ...exact.reader,
      readSelected(reference, request): ISelectedFact {
        const valid = exact.reader.readSelected(reference, request);
        return {
          ...valid,
          address: [{
            get kind(): 'property' { getterCalls += 1; return 'property'; },
            key: 'name',
          }],
        };
      },
    };
    const materialization = createMaterialization({ tracking, reader });
    const view = materialization.materialize<{ readonly name: string }>(
      { kind: 'completed-result', locator: 'A' }, { path: ['step'] },
    );

    expect(() => view.name).toThrow(/address|data|segment/i);
    expect(getterCalls).toBe(0);
  });

  test('materializeOutput preserves tracking pass-through semantics and delegates to detached output observation', () => {
    const tracking = createTrackingObserver(machine);
    const materialization = createMaterialization({ tracking, reader: createExactReader().reader });
    const tracked = tracking.tracked({ profile: { color: 'blue', extra: 'preserved' }, sibling: 'unread' }, { path: ['inputs'] });
    const passThrough = tracking.capture(() => tracked);
    const output = tracking.capture(() => materialization.materializeOutput(tracked.profile));

    expect(passThrough.observations).toHaveLength(0);
    expect(output.value).toEqual({ color: 'blue', extra: 'preserved' });
    expect(output.observations).toHaveLength(1);
    expect(output.observations[0]).toMatchObject({ kind: 'materialized-output', address: [{ kind: 'property', key: 'profile' }] });
    expect(tracking.materialization.owns(output.value)).toBe(false);
  });

  test('records one aggregate projection fact, canonicalizing unordered exhaustive member order', () => {
    const tracking = createTrackingObserver(machine);
    const materialization = createMaterialization({ tracking, reader: createExactReader().reader });
    const binding = { path: ['step', 'roster'] };
    const descriptor: IValueProjectionDescriptor = {
      address: [{ kind: 'property', key: 'name' }], operation: 'value',
      traversal: { kind: 'exhaustive', complete: true },
    };
    const a: IValueProjectionFact = { descriptor, members: [['user-a', 'Ada'], ['user-b', 'Grace']] };
    const b: IValueProjectionFact = { descriptor, members: [['user-b', 'Grace'], ['user-a', 'Ada']] };
    // eslint-disable-next-line microdelta/tracked-captures -- This runtime test supplies explicit untracked fixture metadata to verify canonical projection ordering.
    const first = tracking.capture(() => materialization.project(binding, a));
    // eslint-disable-next-line microdelta/tracked-captures -- This runtime test supplies explicit untracked fixture metadata to verify canonical projection ordering.
    const reordered = tracking.capture(() => materialization.project(binding, b));

    expect(first.observations).toHaveLength(1);
    expect(first.observations[0]?.kind).toBe('projection');
    expect(first.observations[0]?.fingerprint).toBe(reordered.observations[0]?.fingerprint);
    expect(first.value.members.map(([key]) => key)).toEqual(['user-a', 'user-b']);
    expect(reordered.value.members.map(([key]) => key)).toEqual(['user-a', 'user-b']);

    const ordered = tracking.capture(() => {
      // eslint-disable-next-line microdelta/tracked-captures -- This runtime test supplies fixture projection data directly to check order as a separate observation.
      materialization.project(binding, a);
      // eslint-disable-next-line microdelta/tracked-captures -- This runtime test checks an explicit fixture binding as the separate order dependency.
      return materialization.observeMemberOrder(binding, ['user-a', 'user-b']);
    });
    const reversed = tracking.capture(() => {
      // eslint-disable-next-line microdelta/tracked-captures -- This runtime test supplies fixture projection data directly to check order as a separate observation.
      materialization.project(binding, b);
      // eslint-disable-next-line microdelta/tracked-captures -- This runtime test checks an explicit fixture binding as the separate order dependency.
      return materialization.observeMemberOrder(binding, ['user-b', 'user-a']);
    });
    expect(ordered.observations.map((observation) => observation.kind)).toEqual(['projection', 'collection-order']);
    expect(ordered.observations[0]?.fingerprint).toBe(reversed.observations[0]?.fingerprint);
    expect(ordered.observations[1]?.fingerprint).not.toBe(reversed.observations[1]?.fingerprint);
  });

  test('reads a projection only through its separately supplied exact reader capability', () => {
    const tracking = createTrackingObserver(machine);
    const reference: ICompletedResultReference = { kind: 'completed-result', locator: 'saved-A' };
    const descriptor: IValueProjectionDescriptor = {
      address: [{ kind: 'property', key: 'name' }], operation: 'value',
      traversal: { kind: 'visited', complete: false, keys: ['user-a'] },
    };
    let dispatched: ICompletedResultReference | undefined;
    let requested: IValueProjectionDescriptor | undefined;
    const projectionReader = {
      readProjection(exact: ICompletedResultReference, selected: IValueProjectionDescriptor): IValueProjectionFact {
        dispatched = exact;
        requested = selected;
        return { descriptor: selected, members: [['user-a', 'Ada']] };
      },
    };
    const materialization = createMaterialization({ tracking, reader: createExactReader().reader, projectionReader });
    // eslint-disable-next-line microdelta/tracked-captures -- This runtime test injects exact saved-result metadata to verify reader selection.
    const capture = tracking.capture(() => materialization.projectFrom(reference, { path: ['roster'] }, descriptor));

    expect(dispatched).toEqual(reference);
    expect(requested).toEqual(descriptor);
    expect(capture.value.members).toEqual([['user-a', 'Ada']]);
    expect(capture.observations).toHaveLength(1);
    expect(capture.observations[0]?.kind).toBe('projection');
  });

  test('returns nested selected records in the same canonical order as their content fact', () => {
    const tracking = createTrackingObserver(machine);
    const materialization = createMaterialization({ tracking, reader: createExactReader().reader });
    const descriptor: IValueProjectionDescriptor = {
      address: [], operation: 'value', traversal: { kind: 'exhaustive', complete: true },
    };
    const first = materialization.project({ path: ['roster'] }, {
      descriptor, members: [['user-a', { z: 1, a: 2 }]],
    });
    const reordered = materialization.project({ path: ['roster'] }, {
      descriptor, members: [['user-a', { a: 2, z: 1 }]],
    });

    expect(recordKeys(first.members[0]?.[1])).toEqual(['a', 'z']);
    expect(recordKeys(reordered.members[0]?.[1])).toEqual(['a', 'z']);
  });

  test('requires projection capability and rejects mismatched reader selections without observations', () => {
    const tracking = createTrackingObserver(machine);
    const exact = createExactReader();
    const reference: ICompletedResultReference = { kind: 'completed-result', locator: 'saved-A' };
    const descriptor: IValueProjectionDescriptor = {
      address: [], operation: 'value', traversal: { kind: 'exhaustive', complete: true },
    };
    const withoutProjection = createMaterialization({ tracking, reader: exact.reader });
    const unavailable = tracking.capture(() => {
      // eslint-disable-next-line microdelta/tracked-captures -- This runtime test passes explicit saved metadata to assert refusal without projection capability.
      try { return withoutProjection.projectFrom(reference, { path: ['roster'] }, descriptor); }
      catch (error: unknown) { return error; }
    });
    expect(unavailable.value).toBeInstanceOf(TypeError);
    expect(unavailable.observations).toHaveLength(0);

    const projectionReader = {
      readProjection(_exact: ICompletedResultReference, requested: IValueProjectionDescriptor): IValueProjectionFact {
        return {
          descriptor: { ...requested, address: [{ kind: 'property', key: 'different' }] },
          members: [['user-a', 'Ada']],
        };
      },
    };
    const withProjection = createMaterialization({ tracking, reader: exact.reader, projectionReader });
    const mismatched = tracking.capture(() => {
      // eslint-disable-next-line microdelta/tracked-captures -- This runtime test passes explicit saved metadata to verify mismatched selections are rejected.
      try { return withProjection.projectFrom(reference, { path: ['roster'] }, descriptor); }
      catch (error: unknown) { return error; }
    });
    expect(mismatched.value).toBeInstanceOf(TypeError);
    expect(mismatched.observations).toHaveLength(0);
  });

  test('rejects duplicate keys and false exhaustive coverage with collection context', () => {
    const tracking = createTrackingObserver(machine);
    const materialization = createMaterialization({ tracking, reader: createExactReader().reader });
    const binding = { path: ['step', 'roster'] };
    const descriptor: IValueProjectionDescriptor = {
      address: [], operation: 'value', traversal: { kind: 'visited', complete: false, keys: ['user-a'] },
    };
    const duplicate: IValueProjectionFact = { descriptor, members: [['user-a', 'Ada'], ['user-a', 'Grace']] };
    const missing: IValueProjectionFact = { descriptor, members: [] };

    for (const fact of [duplicate, missing]) {
      const capture = tracking.capture(() => {
        // eslint-disable-next-line microdelta/tracked-captures -- This runtime test injects deliberately malformed projection facts to verify validation.
        try { return materialization.project(binding, fact); } catch (error: unknown) { return error; }
      });
      expect(capture.value).toBeInstanceOf(TypeError);
      expect((capture.value as Error).message).toMatch(/roster|user-a/i);
      expect(capture.observations).toHaveLength(0);
    }
  });

  test('preserves collection context and records nothing when projection content is unsupported', () => {
    const tracking = createTrackingObserver(machine);
    const materialization = createMaterialization({ tracking, reader: createExactReader().reader });
    const fact: IValueProjectionFact = {
      descriptor: { address: [], operation: 'value', traversal: { kind: 'exhaustive', complete: true } },
      members: [['user-a', () => 'unsupported data function']],
    };
    const capture = tracking.capture(() => {
      try {
        return materialization.project({ path: ['step', 'roster'] }, fact);
      } catch (error: unknown) {
        return error;
      }
    });

    expect(capture.value).toBeInstanceOf(TypeError);
    expect((capture.value as Error).message).toMatch(/Invalid projection for collection step\.roster: Unsupported value/u);
    expect(capture.observations).toHaveLength(0);
  });
});
