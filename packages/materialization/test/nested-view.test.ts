/**
 * Nested selected materialization over exact retained results. A lazy view
 * navigates node by node through History's optional navigation capability;
 * only consumed leaves, lengths, presence and key order become observations,
 * and metadata comparison never falls back to payload reads.
 *
 * @see ../../../docs/spec/tracking.md (TRK-5 observation table, VAL-1/2/3, EXP-2 access decision)
 * @see ../../../docs/spec/execution.md (RES-002 exact references, RES-003 immutable envelopes)
 * @see ../../../docs/spec/domain.md (DOM-3 selected loading)
 * @see ../../../docs/plans/m3-contribution-analysis.md (Nested materialization and evidence ownership)
 */
import { createHash } from 'node:crypto';
import { AsyncLocalStorage } from 'node:async_hooks';

import { describe, expect, test } from '@jest/globals';
import type {
  ICompletedNavigationReader,
  ICompletedResultReader,
  ICompletedResultReference,
  ISelectedFingerprintResolution,
} from '@microdelta/history';
import { encodeSelectedFact, encodeSnapshot, fingerprint, navigate, observe } from '@microdelta/value';
import type { IAddressSegment, IOperation, ISelectedFact, ISelectedNode } from '@microdelta/value';
import { createTrackingObserver } from '@microdelta/tracking';
import type { ICurrentFactResolution, ITrackingObservation, ITrackingObserverHost } from '@microdelta/tracking';

import { createMaterialization } from '../src/index.js';
import type { IMaterializedView } from '../src/index.js';

/** Host hashing and async context only. */
const machine: ITrackingObserverHost = {
  createAsyncContext<T>() { return new AsyncLocalStorage<T>(); },
  sha256(input: string): string { return createHash('sha256').update(input, 'utf8').digest('hex'); },
};

/** Stable diagnostic rendering of a structured address for request logs. */
function label(address: readonly IAddressSegment[]): string {
  return address.map((segment) => segment.kind === 'property' ? `.${segment.key}` : `[${String(segment.index)}]`).join('') || '$';
}

/** Compact observation rendering: operation and address, in first-consumption order. */
function consumed(observations: readonly ITrackingObservation[]): readonly string[] {
  return observations.map((observation) => `${String(observation.operation)}${label(observation.address)}`);
}

/** Independent MDO1 oracle computed from the original fixture value, never from the reader. */
function oracle(root: unknown, address: readonly IAddressSegment[], operation: IOperation): string {
  return fingerprint(encodeSelectedFact(observe(root, address, operation)), machine);
}

/** Fixture contributor activity: consumed profile/PR/review fields beside deliberately unread payload. */
function activity(overrides: { readonly name?: string; readonly avatarUrl?: string; readonly notes?: string; readonly merged?: readonly boolean[] } = {}): Record<string, unknown> {
  const merged = overrides.merged ?? [true, true, false];
  return {
    contributor: 'person:ada',
    profile: { id: 'gh:1001', name: overrides.name ?? 'Ada', avatarUrl: overrides.avatarUrl ?? 'https://example.invalid/ada.png' },
    pullRequests: merged.map((isMerged, position) => ({ number: 101 + position, merged: isMerged, labels: ['label-a', 'label-b'] })),
    reviews: [{ id: 'r1', state: 'submitted' }, { id: 'r2', state: 'submitted' }],
    notes: overrides.notes ?? 'unread payload '.repeat(4096),
  };
}

/** One request to the fake reader; payload requests are the ones that return stored content. */
interface IReaderRequest {
  readonly port: 'readNode' | 'readSelected' | 'readSubtree' | 'resolveFingerprint';
  readonly locator: string;
  readonly address: string;
  readonly operation?: string;
}

/**
 * A scoped in-memory reader over exact immutable snapshots. Locators carry a
 * store scope; a locator for another scope or an unknown result is an integrity
 * failure, never a miss. Fingerprint metadata is computed from Value semantics
 * as an in-memory stand-in for an index; the SQLite experiment proves the
 * no-payload property against real storage.
 */
function createNestedReader(scope = 'store:a'): {
  readonly reader: ICompletedResultReader & ICompletedNavigationReader;
  readonly publish: (key: string, value: Record<string, unknown>) => ICompletedResultReference;
  readonly requests: IReaderRequest[];
  readonly payloadRequests: () => number;
} {
  const snapshots = new Map<string, Record<string, unknown>>();
  const requests: IReaderRequest[] = [];
  const resolve = (reference: ICompletedResultReference): Record<string, unknown> => {
    const [referenceScope, key] = reference.locator.split('#');
    if (referenceScope !== scope) {
      throw new TypeError(`Reference ${reference.locator} belongs to a different store scope`);
    }
    const snapshot = key === undefined ? undefined : snapshots.get(key);
    if (snapshot === undefined) {
      throw new Error(`Missing exact completed result ${reference.locator}`);
    }
    return snapshot;
  };
  return {
    requests,
    payloadRequests: () => requests.filter((request) => request.port !== 'resolveFingerprint').length,
    publish(key, value) {
      snapshots.set(key, value);
      return Object.freeze({ kind: 'completed-result', locator: `${scope}#${key}` });
    },
    reader: {
      readNode(reference, address): ISelectedNode {
        requests.push({ port: 'readNode', locator: reference.locator, address: label(address) });
        return navigate(resolve(reference), address);
      },
      readSubtree(reference, address): unknown {
        requests.push({ port: 'readSubtree', locator: reference.locator, address: label(address) });
        const root = resolve(reference);
        return address.length === 0 ? root : observe(root, address, 'value').fact;
      },
      readSelected(reference, request): ISelectedFact {
        requests.push({ port: 'readSelected', locator: reference.locator, address: label(request.address), operation: request.operation });
        return observe(resolve(reference), request.address, request.operation);
      },
      resolveFingerprint(reference, request): ISelectedFingerprintResolution {
        requests.push({ port: 'resolveFingerprint', locator: reference.locator, address: request.kind === 'projection' ? label(request.descriptor.address) : label(request.address) });
        const root = resolve(reference);
        try {
          if (request.kind === 'selected') {
            return { kind: 'compatible', fingerprint: oracle(root, request.address, request.operation) };
          }
          if (request.kind === 'materialized-output') {
            const subtree = request.address.length === 0 ? root : observe(root, request.address, 'value').fact;
            return { kind: 'compatible', fingerprint: fingerprint(encodeSnapshot(subtree), machine) };
          }
          return { kind: 'unavailable' };
        } catch (error: unknown) {
          if (error instanceof TypeError) {
            return { kind: 'incompatible' };
          }
          throw error;
        }
      },
    },
  };
}

/** Build a view-capable Materialization with a fresh observer over the supplied reader. */
function setup(reader: ICompletedResultReader & ICompletedNavigationReader = createNestedReader().reader): {
  readonly tracking: ReturnType<typeof createTrackingObserver>;
  readonly materialization: ReturnType<typeof createMaterialization>;
} {
  const tracking = createTrackingObserver(machine);
  return { tracking, materialization: createMaterialization({ tracking, reader, navigationReader: reader }) };
}

/** The declared author view of contributor activity used by summary helpers. */
interface IActivityView {
  readonly contributor: string;
  readonly profile: { readonly id: string; readonly name: string; readonly avatarUrl: string };
  readonly pullRequests: readonly { readonly number: number; readonly merged: boolean; readonly labels: readonly string[] }[];
  readonly reviews: readonly { readonly id: string; readonly state: string }[];
  readonly notes: string;
}

const binding = { path: ['person:ada', 'summary', 'activity'] };
const unavailableFallback = { resolve: (): ICurrentFactResolution => ({ kind: 'unavailable' }) };

describe('nested selected materialization', () => {
  test('a nested name returns exactly one consumed leaf and requests only its path', () => {
    const exact = createNestedReader();
    const value = activity();
    const reference = exact.publish('A', value);
    const { tracking, materialization } = setup(exact.reader);

    const view = materialization.materializeView<IActivityView>(reference, binding);
    const capture = tracking.capture(() => view.profile.name);

    expect(capture.value).toBe('Ada');
    expect(consumed(capture.observations)).toEqual(['value.profile.name']);
    expect(capture.observations[0]?.fingerprint).toBe(oracle(value, [{ kind: 'property', key: 'profile' }, { kind: 'property', key: 'name' }], 'value'));
    expect(exact.requests.map((request) => `${request.port}${request.address}`)).toEqual([
      'readNode$', 'readNode.profile', 'readNode.profile.name',
    ]);
    // Unread siblings (avatar, notes, pull requests, reviews) were neither read nor observed.
    expect(exact.requests.some((request) => /avatar|notes|pullRequests|reviews/u.test(request.address))).toBe(false);
  });

  test('indexed loops record length only when read and each visited selected field', () => {
    const exact = createNestedReader();
    const value = activity();
    const { tracking, materialization } = setup(exact.reader);
    const view = materialization.materializeView<IActivityView>(exact.publish('A', value), binding);

    const capture = tracking.capture(() => {
      const pullRequests = view.pullRequests;
      let merged = 0;
      for (let position = 0; position < pullRequests.length; position += 1) {
        if (pullRequests[position]?.merged === true) {
          merged += 1;
        }
      }
      return { authored: pullRequests.length, merged, reviews: view.reviews.length };
    });

    expect(capture.value).toEqual({ authored: 3, merged: 2, reviews: 2 });
    expect(consumed(capture.observations)).toEqual([
      'length.pullRequests',
      'value.pullRequests[0].merged',
      'value.pullRequests[1].merged',
      'value.pullRequests[2].merged',
      'length.reviews',
    ]);
    expect(capture.observations[1]?.fingerprint).toBe(oracle(value, [
      { kind: 'property', key: 'pullRequests' }, { kind: 'index', index: 0 }, { kind: 'property', key: 'merged' },
    ], 'value'));
    expect(exact.requests.some((request) => /labels|notes|profile/u.test(request.address))).toBe(false);
  });

  test('consumed changes invalidate, unread changes do not, and comparison reads no payload', () => {
    const exact = createNestedReader();
    const referenceA = exact.publish('A', activity());
    const renamed = exact.publish('renamed', activity({ name: 'Ada Lovelace' }));
    const unreadOnly = exact.publish('unread-only', activity({ avatarUrl: 'https://example.invalid/new.png', notes: 'changed' }));
    const mergedChanged = exact.publish('merged-changed', activity({ merged: [true, false, false] }));
    const { tracking, materialization } = setup(exact.reader);
    const view = materialization.materializeView<IActivityView>(referenceA, binding);
    const capture = tracking.capture(() => {
      let merged = 0;
      for (let position = 0; position < view.pullRequests.length; position += 1) {
        merged += view.pullRequests[position]?.merged === true ? 1 : 0;
      }
      return `${view.profile.name}:${merged}`;
    });

    let current = referenceA;
    const provider = materialization.currentProvider(() => current, unavailableFallback);
    const payloadBefore = exact.payloadRequests();
    expect(tracking.compareCurrent(capture, provider).kind).toBe('equal');
    current = unreadOnly;
    expect(tracking.compareCurrent(capture, provider).kind).toBe('equal');
    current = renamed;
    expect(tracking.compareCurrent(capture, provider)).toMatchObject({ kind: 'changed', observation: { address: [{ key: 'profile' }, { key: 'name' }] } });
    current = mergedChanged;
    expect(tracking.compareCurrent(capture, provider)).toMatchObject({ kind: 'changed', observation: { operation: 'value' } });
    expect(exact.payloadRequests()).toBe(payloadBefore);
  });

  test('container-kind changes can never compare equal', () => {
    const exact = createNestedReader();
    const referenceA = exact.publish('A', activity());
    const profileArray = exact.publish('profile-array', { ...activity(), profile: ['Ada'] });
    const nameRecord = exact.publish('name-record', { ...activity(), profile: { name: { given: 'Ada' } } });
    const pullRequestsRecord = exact.publish('prs-record', { ...activity(), pullRequests: { length: 3 } });
    const { tracking, materialization } = setup(exact.reader);
    const view = materialization.materializeView<IActivityView>(referenceA, binding);
    const nameCapture = tracking.capture(() => view.profile.name);
    const lengthCapture = tracking.capture(() => view.pullRequests.length);

    let current = referenceA;
    const provider = materialization.currentProvider(() => current, unavailableFallback);
    current = profileArray;
    expect(tracking.compareCurrent(nameCapture, provider).kind).toBe('incompatible');
    current = nameRecord;
    expect(tracking.compareCurrent(nameCapture, provider).kind).toBe('changed');
    current = pullRequestsRecord;
    expect(tracking.compareCurrent(lengthCapture, provider).kind).toBe('incompatible');
  });

  test('an old exact reference never follows the current reference', () => {
    const exact = createNestedReader();
    const referenceA = exact.publish('A', activity());
    const referenceB = exact.publish('B', activity({ name: 'Grace' }));
    const { tracking, materialization } = setup(exact.reader);
    const mutableReference = { kind: 'completed-result' as const, locator: referenceA.locator };
    const view = materialization.materializeView<IActivityView>(mutableReference, binding);
    mutableReference.locator = referenceB.locator;

    let current: ICompletedResultReference = referenceA;
    const provider = materialization.currentProvider(() => current, unavailableFallback);
    const capture = tracking.capture(() => view.profile.name);
    current = referenceB;

    expect(view.profile.name).toBe('Ada');
    expect(tracking.compareCurrent(capture, provider).kind).toBe('changed');
    expect(exact.requests.filter((request) => request.port !== 'resolveFingerprint').every((request) => request.locator === referenceA.locator)).toBe(true);
  });

  test('missing, wrong-scope and incompatible content fail without observations', () => {
    const exact = createNestedReader('store:a');
    const reference = exact.publish('A', activity());
    const { tracking, materialization } = setup(exact.reader);
    const candidates: readonly ICompletedResultReference[] = [
      { kind: 'completed-result', locator: 'store:a#missing' },
      { kind: 'completed-result', locator: 'store:b#A' },
    ];
    // eslint-disable-next-line microdelta/tracked-captures -- The fixture iterates untracked failing references; each attempt must record nothing.
    const failures = tracking.capture(() => candidates.map((candidate) => {
      try {
        // eslint-disable-next-line microdelta/tracked-captures -- This fixture deliberately dispatches missing and wrong-scope references to prove failure records nothing.
        return materialization.materializeView<IActivityView>(candidate, binding);
      } catch (error: unknown) {
        return error;
      }
    }));
    expect(failures.value.map((failure) => failure instanceof Error ? failure.message : 'no error'))
      .toEqual([expect.stringMatching(/Missing exact/u), expect.stringMatching(/different store scope/u)]);
    expect(failures.observations).toHaveLength(0);

    // The declared type deliberately claims a member the retained result lacks.
    const view = materialization.materializeView<{ readonly profile: { readonly missing: { readonly name: string } }; readonly pullRequests: readonly string[] }>(reference, binding);
    for (const attempt of [
      () => view.profile.missing.name,
      () => { Reflect.get(view.pullRequests, 'map'); },
    ]) {
      const capture = tracking.capture(() => {
        // eslint-disable-next-line microdelta/tracked-captures -- Each table entry reads a branded view through a deliberately unsupported path.
        try { return attempt(); } catch (error: unknown) { return error; }
      });
      expect(capture.value).toBeInstanceOf(TypeError);
    }
    // A scalar result root has no member address and cannot be a navigable view.
    const scalarRoot = exact.publish('scalar', { value: 'x' });
    const scalarReader: ICompletedResultReader & ICompletedNavigationReader = {
      ...exact.reader,
      readNode: (_reference, address) => navigate('scalar root', address),
    };
    expect(() => setup(scalarReader).materialization.materializeView<object>(scalarRoot, binding)).toThrow(TypeError);
  });

  test('malformed reader envelopes are rejected before any observation or accessor call', () => {
    const exact = createNestedReader();
    const reference = exact.publish('A', activity());
    let getterCalls = 0;
    const address = [{ kind: 'property' as const, key: 'profile' }, { kind: 'property' as const, key: 'name' }];
    const malformed: readonly ((requested: readonly IAddressSegment[]) => unknown)[] = [
      () => undefined,
      (requested) => Promise.resolve(navigate(activity(), requested)),
      (requested) => ({ ...navigate(activity(), requested), extra: true }),
      () => ({ kind: 'scalar', selected: { operation: 'value', address: [{ kind: 'property', key: 'notes' }], fact: 'x' } }),
      () => ({ kind: 'scalar', selected: { operation: 'value', address, fact: { kind: 'record', address } } }),
      () => ({ kind: 'array', address, length: -1 }),
      () => Object.defineProperty({ address }, 'kind', { enumerable: true, get(): string { getterCalls += 1; return 'record'; } }),
    ];
    for (const answer of malformed) {
      const reader: ICompletedResultReader & ICompletedNavigationReader = {
        ...exact.reader,
        readNode(exactReference, requested): ISelectedNode {
          if (requested.length < 2) {
            return exact.reader.readNode(exactReference, requested);
          }
          const node: unknown = answer(requested);
          return node as ISelectedNode;
        },
      };
      const { tracking, materialization } = setup(reader);
      const view = materialization.materializeView<IActivityView>(reference, binding);
      const capture = tracking.capture(() => {
        try { return view.profile.name; } catch (error: unknown) { return error; }
      });
      expect(capture.value).toBeInstanceOf(TypeError);
      expect(capture.observations).toHaveLength(0);
    }
    expect(getterCalls).toBe(0);

    const badSelection: ICompletedResultReader & ICompletedNavigationReader = {
      ...exact.reader,
      readSelected: (_reference, request) => ({ operation: request.operation, address: request.address, fact: 'yes' }),
    };
    const { tracking, materialization } = setup(badSelection);
    const view = materialization.materializeView<IActivityView>(reference, binding);
    const membership = tracking.capture(() => {
      try { return 'name' in view.profile; } catch (error: unknown) { return error; }
    });
    expect(membership.value).toBeInstanceOf(TypeError);
    expect(membership.observations).toHaveLength(0);
  });

  test('reader facts are consumed exactly as validated: inconsistent arrays are rejected before observation', () => {
    const exact = createNestedReader();
    const reference = exact.publish('A', activity());
    let iteratorCalls = 0;
    let mapCalls = 0;
    const inventedKeys = (): string[] => {
      const keys = ['id', 'name', 'avatarUrl'];
      Object.defineProperty(keys, Symbol.iterator, {
        get(): () => Iterator<string> { iteratorCalls += 1; return function* invented(): Generator<string> { yield 'invented'; }; },
      });
      return keys;
    };
    const inventedAddress = (address: readonly IAddressSegment[]): IAddressSegment[] => {
      const copy = [...address];
      Object.defineProperty(copy, 'map', { value(): unknown[] { mapCalls += 1; return [['property', 'invented']]; } });
      return copy;
    };
    const reader: ICompletedResultReader & ICompletedNavigationReader = {
      ...exact.reader,
      readSelected(_reference, request): ISelectedFact {
        return request.operation === 'keys'
          ? { operation: 'keys', address: request.address, fact: inventedKeys() }
          : { operation: request.operation, address: inventedAddress(request.address), fact: request.operation === 'value' ? 'person:ada' : true };
      },
    };
    const { tracking, materialization } = setup(reader);
    const view = materialization.materializeView<IActivityView>(reference, binding);
    const scalar = materialization.materialize<{ readonly contributor: string }>(reference, binding);

    for (const attempt of [() => tracking.keys(view.profile), () => 'name' in view.profile, () => scalar.contributor]) {
      const capture = tracking.capture(() => {
        // eslint-disable-next-line microdelta/tracked-captures -- Each table entry reads through a deliberately inconsistent reader answer.
        try { return attempt(); } catch (error: unknown) { return error; }
      });
      expect(capture.value).toBeInstanceOf(TypeError);
      expect(capture.observations).toHaveLength(0);
    }
    expect(iteratorCalls).toBe(0);
    expect(mapCalls).toBe(0);
  });

  test('member order returned to the author is the recorded indexed sequence; inconsistent arrays are rejected', () => {
    const { tracking, materialization } = setup();
    let iteratorCalls = 0;
    const keys = ['user-a', 'user-b'];
    Object.defineProperty(keys, Symbol.iterator, {
      get(): () => Iterator<string> { iteratorCalls += 1; return function* invented(): Generator<string> { yield 'invented'; }; },
    });
    const collection = { path: ['roster'] };

    const inconsistent = tracking.capture(() => {
      // eslint-disable-next-line microdelta/tracked-captures -- The inconsistent order must be rejected before it is returned or recorded.
      try { return materialization.observeMemberOrder(collection, keys); } catch (error: unknown) { return error; }
    });
    expect(inconsistent.value).toBeInstanceOf(TypeError);
    expect(inconsistent.observations).toHaveLength(0);
    // Outside any capture nothing is recorded, but the author must still never receive an invented order.
    expect(() => materialization.observeMemberOrder(collection, keys)).toThrow(TypeError);
    expect(iteratorCalls).toBe(0);

    // eslint-disable-next-line microdelta/tracked-captures -- An ordinary untracked member order is returned and recorded unchanged.
    const ordinary = tracking.capture(() => materialization.observeMemberOrder(collection, ['user-a', 'user-b']));
    expect(ordinary.value).toEqual(['user-a', 'user-b']);
    expect(Object.isFrozen(ordinary.value)).toBe(true);
    expect(ordinary.observations[0]?.selection).toEqual({ kind: 'collection-order', keys: ['user-a', 'user-b'], encodingVersion: 'MDV1' });
  });

  test('views reject mutation and native reflection and are owned by the composed observer', () => {
    const exact = createNestedReader();
    const { tracking, materialization } = setup(exact.reader);
    const view = materialization.materializeView<IActivityView>(exact.publish('A', activity()), binding);
    const profile: object = view.profile;

    expect(tracking.materialization.owns(view)).toBe(true);
    expect(tracking.materialization.owns(profile)).toBe(true);
    expect(tracking.keys(view.profile)).toEqual(['id', 'name', 'avatarUrl']);
    for (const attempt of [
      () => Reflect.set(profile, 'name', 'changed'),
      () => Reflect.deleteProperty(profile, 'name'),
      () => Reflect.defineProperty(profile, 'x', { value: 1 }),
      () => Reflect.setPrototypeOf(profile, null),
      () => Object.keys(profile),
      () => { Object.getPrototypeOf(profile); },
      () => JSON.stringify(profile),
    ]) {
      expect(attempt).toThrow(TypeError);
    }
  });

  test('explicit wrapper output detaches the subtree and records its MDS1 fact for later comparison', () => {
    const exact = createNestedReader();
    const value = activity();
    const referenceA = exact.publish('A', value);
    const avatarChanged = exact.publish('avatar', activity({ avatarUrl: 'https://example.invalid/new.png' }));
    const notesChanged = exact.publish('notes', activity({ notes: 'different unread notes' }));
    const { tracking, materialization } = setup(exact.reader);
    const view = materialization.materializeView<IActivityView>(referenceA, binding);

    const output = tracking.capture(() => materialization.materializeOutput({ author: view.profile }));

    expect(output.value).toEqual({ author: value.profile });
    expect(tracking.materialization.owns(output.value.author)).toBe(false);
    expect(Object.isFrozen(output.value.author)).toBe(true);
    expect(output.observations).toHaveLength(1);
    expect(output.observations[0]).toMatchObject({
      kind: 'materialized-output',
      address: [{ kind: 'property', key: 'profile' }],
      fingerprint: fingerprint(encodeSnapshot(value.profile), machine),
    });
    let current = referenceA;
    const provider = materialization.currentProvider(() => current, unavailableFallback);
    expect(tracking.compareCurrent(output, provider).kind).toBe('equal');
    current = notesChanged;
    expect(tracking.compareCurrent(output, provider).kind).toBe('equal');
    // The output materialized the whole profile, so an avatar change is now a consumed change.
    current = avatarChanged;
    expect(tracking.compareCurrent(output, provider).kind).toBe('changed');

    const wrongKind: ICompletedResultReader & ICompletedNavigationReader = { ...exact.reader, readSubtree: () => ['not', 'a', 'record'] };
    const unsupported: ICompletedResultReader & ICompletedNavigationReader = { ...exact.reader, readSubtree: () => ({ name: () => 'function' }) };
    for (const reader of [wrongKind, unsupported]) {
      const bad = setup(reader);
      const badView = bad.materialization.materializeView<IActivityView>(referenceA, binding);
      const capture = bad.tracking.capture(() => {
        // eslint-disable-next-line microdelta/tracked-captures -- The fixture composes a deliberately faulty reader to prove output validation records nothing.
        try { return bad.materialization.materializeOutput({ author: badView.profile }); } catch (error: unknown) { return error; }
      });
      expect(capture.value).toBeInstanceOf(TypeError);
      expect(capture.observations).toHaveLength(0);
    }
  });

  test('views read after their capture frame closes fail before any reader request', async () => {
    const exact = createNestedReader();
    const { tracking, materialization } = setup(exact.reader);
    const reference = exact.publish('A', activity());
    const errors: unknown[] = [];
    await tracking.captureAsync(async () => {
      // eslint-disable-next-line microdelta/tracked-captures -- The fixture creates the view inside the frame so late work inherits that frame.
      const view = materialization.materializeView<IActivityView>(reference, binding);
      // eslint-disable-next-line microdelta/tracked-captures -- The timer deliberately runs view operations after the async observation frame has closed.
      setTimeout(() => {
        // eslint-disable-next-line microdelta/tracked-captures -- This race fixture retains each expected closed-frame error for its assertion.
        try { void view.profile; } catch (error: unknown) { errors.push(error); }
        // eslint-disable-next-line microdelta/tracked-captures -- Creating a view from a closed inherited frame must also fail before any reader request.
        try { materialization.materializeView<IActivityView>(reference, binding); } catch (error: unknown) { errors.push(error); }
      }, 0);
      // eslint-disable-next-line microdelta/tracked-captures -- Yielding once lets the capture close before the scheduled late operations run.
      await Promise.resolve();
    });
    const before = exact.requests.length;
    await new Promise((resolve) => setTimeout(resolve, 5));

    expect(errors).toHaveLength(2);
    expect(errors.every((error) => error instanceof Error && /closed/iu.test(error.message))).toBe(true);
    expect(exact.requests.length).toBe(before);
  });

  test('scalar-only readers keep their existing behavior and cannot create nested views', () => {
    const exact = createNestedReader();
    const reference = exact.publish('A', activity());
    const tracking = createTrackingObserver(machine);
    const scalarOnly = createMaterialization({ tracking, reader: exact.reader });

    const scalarView = scalarOnly.materialize<{ readonly contributor: string; readonly profile: object }>(reference, binding);
    expect(scalarView.contributor).toBe('person:ada');
    expect(() => { Reflect.get(scalarView, 'profile'); }).toThrow(/nested/u);
    const before = exact.requests.length;
    expect(() => scalarOnly.materializeView<IActivityView>(reference, binding)).toThrow(/navigation/u);
    expect(exact.requests.length).toBe(before);
  });
});

describe('asynchronous invocation transport', () => {
  test('an ordinary result carrier around a view adds no phantom then observation', async () => {
    const exact = createNestedReader();
    const { tracking, materialization } = setup(exact.reader);
    const reference = exact.publish('A', activity());

    const capture = await tracking.captureAsync(async () => {
      // This stands in for a declared child handle, which returns an ordinary carrier around the selected view.
      const invocation = async (): Promise<{ readonly data: IMaterializedView<IActivityView> }> =>
        // eslint-disable-next-line microdelta/tracked-captures -- The carrier wraps a view of an exact fixture reference, as a resolved child invocation would.
        Object.freeze({ data: materialization.materializeView<IActivityView>(reference, binding) });
      const { data } = await invocation();
      return data.profile.name;
    });

    expect(capture.value).toBe('Ada');
    expect(consumed(capture.observations)).toEqual(['value.profile.name']);
    expect(exact.requests.some((request) => request.address === '.then')).toBe(false);
  });

  test('resolving a view directly probes then, which is why transport uses a carrier', async () => {
    const exact = createNestedReader();
    const { tracking, materialization } = setup(exact.reader);
    const reference = exact.publish('A', activity());

    const capture = await tracking.captureAsync(async () => {
      // eslint-disable-next-line microdelta/tracked-captures -- Negative control: an invocation that resolves the view itself instead of a carrier.
      const direct = async (): Promise<IMaterializedView<IActivityView>> => materialization.materializeView<IActivityView>(reference, binding);
      const data = await direct();
      return data.profile.name;
    });

    // Negative control: Promise resolution reads `then` through the ordinary getter.
    expect(consumed(capture.observations)).toEqual(['value.then', 'value.profile.name']);
  });

  test('a legitimate author field named then remains ordinary data', () => {
    const exact = createNestedReader();
    const { tracking, materialization } = setup(exact.reader);
    const reference = exact.publish('then', { then: 'author data', nested: { then: 42 } });
    const view = materialization.materializeView<{ readonly then: string; readonly nested: { readonly then: number } }>(reference, binding);

    const capture = tracking.capture(() => `${view.then}:${view.nested.then}`);

    expect(capture.value).toBe('author data:42');
    expect(consumed(capture.observations)).toEqual(['value.then', 'value.nested.then']);
  });

  test('asynchronous-only storage cannot pose as a synchronous navigation reader', () => {
    const exact = createNestedReader();
    const reference = exact.publish('A', activity());
    const asyncReader: ICompletedResultReader & ICompletedNavigationReader = {
      ...exact.reader,
      readNode(exactReference, address): ISelectedNode {
        const pending: unknown = Promise.resolve(exact.reader.readNode(exactReference, address));
        return pending as ISelectedNode;
      },
    };
    const { tracking, materialization } = setup(asyncReader);
    const capture = tracking.capture(() => {
      // eslint-disable-next-line microdelta/tracked-captures -- The fixture composes an asynchronous-only reader to prove creation fails before any observation.
      try { return materialization.materializeView<IActivityView>(reference, binding); } catch (error: unknown) { return error; }
    });
    expect(capture.value).toBeInstanceOf(TypeError);
    expect(capture.observations).toHaveLength(0);
  });
});
