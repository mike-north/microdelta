/**
 * Lazy tracked views read retained content node by node through a synchronous
 * source port, yet must record exactly the observations an in-memory tracked
 * wrapper records for the same operations. Navigation through containers is
 * never a whole-object observation; unread members are never requested.
 *
 * @see ../../../docs/spec/tracking.md (TRK-3 lifetimes, TRK-5 observation table, VAL-1/2/3)
 * @see ../../../docs/plans/m3-contribution-analysis.md (Nested materialization and evidence ownership)
 */
import { createHash } from 'node:crypto';
import { AsyncLocalStorage } from 'node:async_hooks';

import { describe, expect, test } from '@jest/globals';
import type { IMachine } from '@microdelta/machine';
import { encodeSelectedFact, encodeSnapshot, fingerprint, navigate, observe } from '@microdelta/value';
import type { IAddressSegment, IOperation, ISelectedFact, ISelectedNode } from '@microdelta/value';

import { createTrackingObserver } from '../src/index.js';
import type { ITracked, ITrackedNodeSource, ITrackingObservation, ITrackingObserver } from '../src/index.js';

/** Host hashing and async context only; no Tracking policy lives in the adapter. */
const machine: IMachine = {
  createAsyncContext<T>() { return new AsyncLocalStorage<T>(); },
  snapshot<T>(value: T): T { return structuredClone(value); },
  sha256(input: string): string { return createHash('sha256').update(input, 'utf8').digest('hex'); },
};

/** Render a structured address for request logs; not a semantic encoding. */
function label(address: readonly IAddressSegment[]): string {
  return address.map((segment) => segment.kind === 'property' ? `.${segment.key}` : `[${String(segment.index)}]`).join('') || '$';
}

/** One logged source request: which port operation was asked for which address. */
interface ISourceRequest { readonly port: 'node' | 'select' | 'subtree'; readonly address: string; readonly operation?: IOperation }

/**
 * An in-memory source backed by Value's own navigation and observation, with a
 * request log so tests can prove which nodes were (and were not) requested.
 */
function createSource(root: unknown): { readonly source: ITrackedNodeSource; readonly requests: ISourceRequest[] } {
  const requests: ISourceRequest[] = [];
  return {
    requests,
    source: {
      node(address): ISelectedNode {
        requests.push({ port: 'node', address: label(address) });
        return navigate(root, address);
      },
      select(address, operation): ISelectedFact {
        requests.push({ port: 'select', address: label(address), operation });
        return observe(root, address, operation);
      },
      subtree(address): unknown {
        requests.push({ port: 'subtree', address: label(address) });
        return address.length === 0 ? root : observe(root, address, 'value').fact;
      },
    },
  };
}

/** A retained contributor-activity result with unread payload beside consumed fields. */
function activityFixture(name = 'Ada'): {
  readonly profile: { readonly id: string; readonly name: string; readonly avatarUrl: string };
  readonly pullRequests: readonly { readonly number: number; readonly merged: boolean; readonly labels: readonly string[] }[];
  readonly notes: string;
} {
  return {
    profile: { id: 'gh:1001', name, avatarUrl: 'https://example.invalid/ada.png' },
    pullRequests: [
      { number: 101, merged: true, labels: ['docs'] },
      { number: 102, merged: true, labels: ['api'] },
      { number: 103, merged: false, labels: [] },
    ],
    notes: 'unread '.repeat(1000),
  };
}

type IActivity = ReturnType<typeof activityFixture>;

/** Stable comparison form of an observation list: kind, operation, address, digest. */
function evidence(observations: readonly ITrackingObservation[]): readonly string[] {
  return observations.map((observation) => `${observation.kind}:${String(observation.operation)}:${label(observation.address)}:${observation.fingerprint}`);
}

/** Independent MDO1 oracle computed directly from the original value. */
function oracle(root: unknown, address: readonly IAddressSegment[], operation: IOperation): string {
  return fingerprint(encodeSelectedFact(observe(root, address, operation)), machine);
}

describe('lazy tracked views over a node source', () => {
  const binding = { path: ['summary', 'activity'] };

  test('a nested leaf read requests only its path and records exactly one consumed leaf', () => {
    const observer = createTrackingObserver(machine);
    const value = activityFixture();
    const { source, requests } = createSource(value);
    const view = observer.materialization.lazyView<IActivity>(binding, source);

    const capture = observer.capture(() => view.profile.name);

    expect(capture.value).toBe('Ada');
    expect(capture.observations).toHaveLength(1);
    expect(capture.observations[0]).toMatchObject({
      binding,
      kind: 'fact',
      operation: 'value',
      address: [{ kind: 'property', key: 'profile' }, { kind: 'property', key: 'name' }],
      fingerprint: oracle(value, [{ kind: 'property', key: 'profile' }, { kind: 'property', key: 'name' }], 'value'),
    });
    // Root shape at creation, then one navigation per step: no sibling, root payload or subtree request.
    expect(requests).toEqual([
      { port: 'node', address: '$' },
      { port: 'node', address: '.profile' },
      { port: 'node', address: '.profile.name' },
    ]);
  });

  test('every supported operation records the same evidence as an in-memory tracked wrapper', () => {
    const prototype = { inherited: 'from prototype', box: { label: 'inherited box' } };
    /** A record whose inherited members come from a supported custom prototype. */
    interface IChild { own: string; readonly inherited: string; readonly box: { readonly label: string } }
    const child = Object.create(prototype) as IChild;
    child.own = 'own value';
    const sparse: unknown[] = new Array<unknown>(3);
    sparse[0] = 'first';
    const root = {
      profile: { name: 'Ada', id: 'gh:1' },
      pullRequests: [{ merged: true }, { merged: false }],
      sparse,
      present: ['first', undefined],
      child,
      record: { '0': 'property zero' },
      list: ['index zero'],
      special: { then: 'legitimate author field', number: Number.NaN, zero: -0 },
    };
    type IRoot = typeof root;
    /** The same author operations run against both wrappers. */
    function consume(observer: ITrackingObserver, view: ITracked<IRoot>): readonly unknown[] {
      const results: unknown[] = [view.profile.name];
      const pullRequests = view.pullRequests;
      for (let position = 0; position < pullRequests.length; position += 1) {
        results.push(pullRequests[position]?.merged);
      }
      results.push(view.sparse[1], 1 in view.sparse, view.present[1], 1 in view.present, view.sparse.length);
      results.push(view.child.inherited, view.child.box.label, 'inherited' in view.child, observer.hasOwn(view.child, 'inherited'));
      results.push(observer.hasOwn(view.child, 'own'), observer.keys(view.child), observer.keys(view.profile));
      results.push(view.record['0'], view.list[0], view.special.then, view.special.number, view.special.zero);
      results.push('missing' in view.profile, Reflect.get(view.profile, 'missing'));
      return results;
    }

    const inMemoryObserver = createTrackingObserver(machine);
    // eslint-disable-next-line microdelta/tracked-captures -- The parity fixture runs one shared operation table against an in-memory wrapper of the same fixture root.
    const inMemory = inMemoryObserver.capture(() => consume(inMemoryObserver, inMemoryObserver.tracked(root, binding)));
    const lazyObserver = createTrackingObserver(machine);
    const lazyView = lazyObserver.materialization.lazyView<IRoot>(binding, createSource(root).source);
    // eslint-disable-next-line microdelta/tracked-captures -- The parity fixture runs the same shared operation table against the lazy view.
    const lazy = lazyObserver.capture(() => consume(lazyObserver, lazyView));

    expect(lazy.value).toEqual(inMemory.value);
    expect(evidence(lazy.observations)).toEqual(evidence(inMemory.observations));
    // The comparison is meaningful: loops, lengths, presence, key order and holes were all consumed.
    expect(lazy.observations.map((observation) => observation.operation)).toEqual(expect.arrayContaining(['value', 'length', 'membership', 'own', 'keys']));
  });

  test('array length is recorded only when a consumer reads it, and loops record only visited fields', () => {
    const observer = createTrackingObserver(machine);
    const value = activityFixture();
    const { source, requests } = createSource(value);
    const view = observer.materialization.lazyView<IActivity>(binding, source);

    const first = observer.capture(() => view.pullRequests[0]?.merged);
    expect(first.observations.map((observation) => `${String(observation.operation)}${label(observation.address)}`))
      .toEqual(['value.pullRequests[0].merged']);

    const loop = observer.capture(() => {
      let merged = 0;
      for (let position = 0; position < view.pullRequests.length; position += 1) {
        if (view.pullRequests[position]?.merged === true) {
          merged += 1;
        }
      }
      return merged;
    });
    expect(loop.value).toBe(2);
    expect(loop.observations.map((observation) => `${String(observation.operation)}${label(observation.address)}`)).toEqual([
      'length.pullRequests',
      'value.pullRequests[0].merged',
      'value.pullRequests[1].merged',
      'value.pullRequests[2].merged',
    ]);
    // Labels, profile and notes were never requested from the source.
    expect(requests.some((request) => /labels|notes|profile/u.test(request.address))).toBe(false);
  });

  test('explicit output detaches a lazy subtree, records its MDS1 snapshot and loads it only then', () => {
    const observer = createTrackingObserver(machine);
    const value = activityFixture();
    const { source, requests } = createSource(value);
    const view = observer.materialization.lazyView<IActivity>(binding, source);

    const output = observer.capture(() => observer.snapshotOutput({ profile: view.profile, count: 1 }));

    expect(output.value).toEqual({ profile: value.profile, count: 1 });
    expect(Object.isFrozen(output.value.profile)).toBe(true);
    expect(observer.materialization.owns(output.value.profile)).toBe(false);
    expect(output.observations).toHaveLength(1);
    expect(output.observations[0]).toMatchObject({
      kind: 'materialized-output',
      address: [{ kind: 'property', key: 'profile' }],
      fingerprint: fingerprint(encodeSnapshot(value.profile), machine),
    });
    expect(requests.filter((request) => request.port === 'subtree')).toEqual([{ port: 'subtree', address: '.profile' }]);

    // Two navigations to the same retained subtree are the same output source.
    const repeated = observer.capture(() => {
      try {
        return observer.snapshotOutput([view.profile, view.profile]);
      } catch (error: unknown) {
        return error;
      }
    });
    expect(repeated.value).toBeInstanceOf(TypeError);
    expect(repeated.observations).toHaveLength(0);
  });

  test('lazy views are observer-owned, immutable and reject native reflection', () => {
    const observer = createTrackingObserver(machine);
    const view = observer.materialization.lazyView<IActivity>(binding, createSource(activityFixture()).source);
    const profile: object = view.profile;
    const pullRequests: object = view.pullRequests;

    expect(observer.materialization.owns(view)).toBe(true);
    expect(observer.materialization.owns(profile)).toBe(true);
    expect(createTrackingObserver(machine).materialization.owns(view)).toBe(false);
    expect(Array.isArray(pullRequests)).toBe(true);
    for (const attempt of [
      () => Reflect.set(profile, 'name', 'changed'),
      () => Reflect.defineProperty(profile, 'name', { value: 'changed' }),
      () => Reflect.deleteProperty(profile, 'name'),
      () => Reflect.setPrototypeOf(profile, null),
      () => Reflect.preventExtensions(profile),
      () => Reflect.isExtensible(profile),
      () => Reflect.ownKeys(profile),
      () => Reflect.getOwnPropertyDescriptor(profile, 'name'),
      () => Reflect.getPrototypeOf(profile),
      () => { Reflect.get(profile, Symbol.iterator); },
      () => { Reflect.get(pullRequests, 'map'); },
      () => { Reflect.get(pullRequests, '01'); },
    ]) {
      expect(attempt).toThrow(TypeError);
    }
  });

  test('a view inherited by work that outlives its capture frame fails before any source request', async () => {
    const observer = createTrackingObserver(machine);
    const { source, requests } = createSource(activityFixture());
    const view = observer.materialization.lazyView<IActivity>(binding, source);
    const errors: unknown[] = [];
    await observer.captureAsync(async () => {
      for (const attempt of [
        () => view.profile,
        () => view.pullRequests.length,
        () => 'profile' in view,
        () => observer.keys(view),
        () => observer.hasOwn(view, 'profile'),
      ]) {
        // eslint-disable-next-line microdelta/tracked-captures -- The timer deliberately runs view operations after the async observation frame has closed.
        setTimeout(() => {
          // eslint-disable-next-line microdelta/tracked-captures -- This race fixture retains each expected closed-frame error for its assertion.
          try { attempt(); } catch (error: unknown) { errors.push(error); }
        }, 0);
      }
      // eslint-disable-next-line microdelta/tracked-captures -- Yielding once lets the capture close before the scheduled late operations run.
      await Promise.resolve();
    });
    const before = requests.length;
    await new Promise((resolve) => setTimeout(resolve, 5));

    expect(errors).toHaveLength(5);
    expect(errors.every((error) => error instanceof Error && /closed/iu.test(error.message))).toBe(true);
    expect(requests.length).toBe(before);
  });

  test('reads outside any capture return values without recording evidence', () => {
    const observer = createTrackingObserver(machine);
    const view = observer.materialization.lazyView<IActivity>(binding, createSource(activityFixture()).source);
    expect(view.profile.name).toBe('Ada');
    expect(observer.capture(() => 'no reads').observations).toHaveLength(0);
  });

  test('source answers for a different address, kind or operation are rejected before recording', () => {
    const observer = createTrackingObserver(machine);
    const value = activityFixture();
    const honest = createSource(value).source;
    const wrongAddress: ITrackedNodeSource = {
      ...honest,
      node(address): ISelectedNode {
        return address.length === 0 ? honest.node(address) : honest.node([{ kind: 'property', key: 'notes' }]);
      },
    };
    const asyncOnly: ITrackedNodeSource = {
      ...honest,
      node(address): ISelectedNode {
        if (address.length === 0) {
          return honest.node(address);
        }
        const pending: unknown = Promise.resolve(honest.node(address));
        return pending as ISelectedNode;
      },
    };
    const wrongOperation: ITrackedNodeSource = {
      ...honest,
      select(address): ISelectedFact {
        return observe(value, address, 'own');
      },
    };
    for (const source of [wrongAddress, asyncOnly]) {
      const view = observer.materialization.lazyView<IActivity>(binding, source);
      const capture = observer.capture(() => {
        try { return view.profile; } catch (error: unknown) { return error; }
      });
      expect(capture.value).toBeInstanceOf(TypeError);
      expect(capture.observations).toHaveLength(0);
    }
    const view = observer.materialization.lazyView<IActivity>(binding, wrongOperation);
    const membership = observer.capture(() => {
      try { return 'profile' in view; } catch (error: unknown) { return error; }
    });
    expect(membership.value).toBeInstanceOf(TypeError);
    expect(membership.observations).toHaveLength(0);
    // A scalar root cannot become a navigable view.
    expect(() => observer.materialization.lazyView<IActivity>(binding, createSource('scalar root').source)).toThrow(TypeError);
  });
});
