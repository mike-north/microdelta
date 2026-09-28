/**
 * Selected facts supplied from outside Tracking (lazy node sources, the
 * materialization record bridge and current-fact providers) must be consumed
 * exactly as validated. A provider array whose iteration, `map` or prototype
 * behavior differs from its indexed own data must be rejected before any
 * observation is recorded or any value is returned to the author, so the
 * returned value, the recorded evidence and the validated fact cannot diverge.
 *
 * @see ../../../docs/spec/tracking.md (TRK-5 observation table, VAL-1/2)
 */
import { createHash } from 'node:crypto';
import { AsyncLocalStorage } from 'node:async_hooks';

import { describe, expect, test } from '@jest/globals';
import type { IMachine } from '@microdelta/machine';
import { navigate, observe } from '@microdelta/value';
import type { IAddressSegment, ISelectedFact, ISelectedNode } from '@microdelta/value';

import { createTrackingObserver } from '../src/index.js';
import type { ICurrentFactResolution, ITrackedNodeSource } from '../src/index.js';

/** Host hashing and async context only. */
const machine: IMachine = {
  createAsyncContext<T>() { return new AsyncLocalStorage<T>(); },
  snapshot<T>(value: T): T { return structuredClone(value); },
  sha256(input: string): string { return createHash('sha256').update(input, 'utf8').digest('hex'); },
};

const binding = { path: ['summary', 'activity'] };
const root = { profile: { actual: 'kept', name: 'Ada' } };
type IRoot = typeof root;

/** An array whose own iterator getter yields a value its indexed data does not contain. */
function inventingIterator(values: readonly string[]): { readonly array: string[]; readonly calls: () => number } {
  let calls = 0;
  const array = [...values];
  Object.defineProperty(array, Symbol.iterator, {
    get(): () => Iterator<string> {
      calls += 1;
      return function* invented(): Generator<string> { yield 'invented'; };
    },
  });
  return { array, calls: () => calls };
}

/** An address array whose own `map` answers a different address than its indexed segments. */
function inventingMap(address: readonly IAddressSegment[]): { readonly array: IAddressSegment[]; readonly calls: () => number } {
  let calls = 0;
  const array = [...address];
  Object.defineProperty(array, 'map', {
    value(): unknown[] {
      calls += 1;
      return [['property', 'invented']];
    },
  });
  return { array, calls: () => calls };
}

/** A source over `root` whose selected facts are replaced by a supplied answer. */
function sourceAnswering(answer: (address: readonly IAddressSegment[], operation: 'own' | 'membership' | 'keys') => unknown): ITrackedNodeSource {
  return {
    node: (address): ISelectedNode => navigate(root, address),
    select: (address, operation): ISelectedFact => answer(address, operation) as ISelectedFact,
    subtree: (address): unknown => observe(root, address, 'value').fact,
  };
}

describe('selected facts from outside Tracking are consumed exactly as validated', () => {
  test('a key enumeration whose iterator invents a key is rejected before observation', () => {
    const observer = createTrackingObserver(machine);
    const keys = inventingIterator(['actual', 'name']);
    const view = observer.materialization.lazyView<IRoot>(binding, sourceAnswering((address) => ({ operation: 'keys', address, fact: keys.array })));

    const capture = observer.capture(() => {
      try { return observer.keys(view.profile); } catch (error: unknown) { return error; }
    });

    expect(capture.value).toBeInstanceOf(TypeError);
    expect(capture.observations).toHaveLength(0);
    expect(keys.calls()).toBe(0);
  });

  test('a presence fact whose address map invents another address is rejected before observation', () => {
    const observer = createTrackingObserver(machine);
    const answers: { readonly calls: () => number }[] = [];
    const view = observer.materialization.lazyView<IRoot>(binding, sourceAnswering((address, operation) => {
      const invented = inventingMap(address);
      answers.push(invented);
      return { operation, address: invented.array, fact: true };
    }));

    for (const attempt of [() => 'actual' in view.profile, () => observer.hasOwn(view.profile, 'actual')]) {
      const capture = observer.capture(() => {
        // eslint-disable-next-line microdelta/tracked-captures -- Each table entry reads a branded view through a deliberately inconsistent source answer.
        try { return attempt(); } catch (error: unknown) { return error; }
      });
      expect(capture.value).toBeInstanceOf(TypeError);
      expect(capture.observations).toHaveLength(0);
    }
    expect(answers).toHaveLength(2);
    expect(answers.every((answer) => answer.calls() === 0)).toBe(true);
  });

  test('a key sequence with a substituted array prototype is rejected before observation', () => {
    const observer = createTrackingObserver(machine);
    const view = observer.materialization.lazyView<IRoot>(binding, sourceAnswering((address) => {
      const fact = ['actual', 'name'];
      Object.setPrototypeOf(fact, Object.create(Array.prototype) as object);
      return { operation: 'keys', address, fact };
    }));

    const capture = observer.capture(() => {
      try { return observer.keys(view.profile); } catch (error: unknown) { return error; }
    });

    expect(capture.value).toBeInstanceOf(TypeError);
    expect(capture.observations).toHaveLength(0);
  });

  test('ordinary key and presence facts from a source are still returned and recorded as supplied', () => {
    const observer = createTrackingObserver(machine);
    const view = observer.materialization.lazyView<IRoot>(binding, sourceAnswering((address, operation) => observe(root, address, operation)));

    const capture = observer.capture(() => [observer.keys(view.profile), 'actual' in view.profile, observer.hasOwn(view.profile, 'name')]);

    expect(capture.value).toEqual([['actual', 'name'], true, true]);
    expect(capture.observations.map((observation) => observation.operation)).toEqual(['keys', 'membership', 'own']);
  });

  test('the materialization record bridge rejects a selected fact whose address map disagrees with its segments', () => {
    const observer = createTrackingObserver(machine);
    const address = inventingMap([{ kind: 'property', key: 'name' }]);
    const keys = inventingIterator(['name']);
    const facts: readonly ISelectedFact[] = [
      { operation: 'value', address: address.array, fact: 'Ada' },
      { operation: 'keys', address: [], fact: keys.array },
    ];

    for (const fact of facts) {
      const capture = observer.capture(() => {
        // eslint-disable-next-line microdelta/tracked-captures -- Each untracked malformed fact must be rejected before it becomes evidence.
        try { observer.materialization.recordSelected(binding, fact); return 'recorded'; } catch (error: unknown) { return error; }
      });
      expect(capture.value).toBeInstanceOf(TypeError);
      expect(capture.observations).toHaveLength(0);
    }
    expect(address.calls()).toBe(0);
    expect(keys.calls()).toBe(0);
  });

  test('a current provider fact whose address map disagrees with its segments is incompatible, not changed', () => {
    const observer = createTrackingObserver(machine);
    const tracked = observer.tracked(root, binding);
    const capture = observer.capture(() => tracked.profile.name);
    const requested = [{ kind: 'property' as const, key: 'profile' }, { kind: 'property' as const, key: 'name' }];
    const address = inventingMap(requested);

    const outcome = observer.compareCurrent(capture, {
      resolve: (): ICurrentFactResolution => ({ kind: 'available', fact: { operation: 'value', address: address.array, fact: 'Ada' } }),
    });

    expect(outcome.kind).toBe('incompatible');
    expect(address.calls()).toBe(0);
  });

  test('a collection order whose iterator invents a key is rejected before it is recorded', () => {
    const observer = createTrackingObserver(machine);
    const keys = inventingIterator(['user-a', 'user-b']);

    const capture = observer.capture(() => {
      // eslint-disable-next-line microdelta/tracked-captures -- The inconsistent sequence must be rejected before it becomes evidence.
      try { observer.materialization.recordCollectionOrder(binding, keys.array); return 'recorded'; } catch (error: unknown) { return error; }
    });

    expect(capture.value).toBeInstanceOf(TypeError);
    expect(capture.observations).toHaveLength(0);
    expect(keys.calls()).toBe(0);
    // An ordinary sequence is still recorded exactly as supplied.
    // eslint-disable-next-line microdelta/tracked-captures -- The control records an explicit untracked ordinary key sequence.
    const ordinary = observer.capture(() => { observer.materialization.recordCollectionOrder(binding, ['user-a', 'user-b']); });
    expect(ordinary.observations[0]?.selection).toEqual({ kind: 'collection-order', keys: ['user-a', 'user-b'], encodingVersion: 'MDV1' });
  });

  test('a current projection whose descriptor address map disagrees with its segments is incompatible, not changed', () => {
    const observer = createTrackingObserver(machine);
    const descriptor = { address: [{ kind: 'property' as const, key: 'name' }], operation: 'value' as const, traversal: { kind: 'exhaustive' as const, complete: true as const } };
    // eslint-disable-next-line microdelta/tracked-captures -- The fixture records an explicit untracked projection as the observed evidence.
    const capture = observer.capture(() => { observer.materialization.recordProjection(binding, { descriptor, members: [['user-a', 'Ada']] }); });
    // The indexed segment says `title`; the own `map` claims the observed `name` address.
    const address: IAddressSegment[] = [{ kind: 'property', key: 'title' }];
    Object.defineProperty(address, 'map', { value(): unknown[] { return [{ kind: 'property', key: 'name' }]; } });

    const outcome = observer.compareCurrent(capture, {
      resolve: (): ICurrentFactResolution => ({
        kind: 'available',
        fact: { descriptor: { ...descriptor, address }, members: [['user-a', 'Ada']] },
      }),
    });

    expect(outcome.kind).toBe('incompatible');
  });
});
