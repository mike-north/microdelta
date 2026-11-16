/** Owned immutable reads pay for complete validation at creation, then only selected paths. */
import { AsyncLocalStorage } from 'node:async_hooks';
import { createHash } from 'node:crypto';

import { describe, expect, jest, test } from '@jest/globals';
import type { IMachine } from '@microdelta/machine';
import { encodeSelectedFact, navigate, observe, recordFromEntries } from '@microdelta/value';
import type { ISelectedFact } from '@microdelta/value';

import { createTrackingObserver } from '../src/index.js';

/** Real host behavior keeps the work probe on the ordinary capture path. */
const machine: IMachine = {
  createAsyncContext<T>() { return new AsyncLocalStorage<T>(); },
  snapshot<T>(value: T): T { return structuredClone(value); },
  sha256(input: string): string { return createHash('sha256').update(input, 'utf8').digest('hex'); },
};

/** Delegated array-slot descriptor work, separated by ownership and reading phases. */
interface ISurfaceWork {
  readonly preparation: number;
  readonly reads: number;
  readonly frozenReads: number;
}

/**
 * Observe real descriptor work on population arrays, including Value's decoded
 * frozen root. Delegation preserves the actual descriptors and selected values;
 * the fixture never substitutes a Value or Tracking operation.
 */
function measureSurfaceWork(population: number, captures: number): ISurfaceWork {
  let preparation = 0;
  let reads = 0;
  let frozenReads = 0;
  let reading = false;
  const descriptor = Object.getOwnPropertyDescriptor;
  const probe = jest.spyOn(Object, 'getOwnPropertyDescriptor').mockImplementation((target: object, key: PropertyKey) => {
    if (Array.isArray(target) && target.length === population && /^(0|[1-9][0-9]*)$/u.test(String(key))) {
      if (reading) {
        reads += 1;
        if (Object.isFrozen(target)) {
          frozenReads += 1;
        }
      } else {
        preparation += 1;
      }
    }
    return descriptor(target, key);
  });
  try {
    const observer = createTrackingObserver(machine);
    const input = observer.tracked({ nested: { rows: Array.from({ length: population }, (_, index) => ({ score: index })) } }, { path: ['work'] });
    reading = true;
    for (let capture = 0; capture < captures; capture += 1) {
      const result = observer.capture(() => {
        let total = 0;
        // eslint-disable-next-line microdelta/tracked-captures -- The fixture fixes read count independently of the tracked population to measure actual surface work.
        for (let index = 0; index < population; index += 1) {
          total += input.nested.rows.length;
          total += input.nested.rows[index]?.score ?? 0;
          total += index in input.nested.rows ? 1 : 0;
          // eslint-disable-next-line microdelta/tracked-captures -- Deterministic index spelling selects the explicit own-presence operation under test.
          total += observer.hasOwn(input.nested.rows, String(index)) ? 1 : 0;
        }
        return total;
      });
      expect(result.value).toBe(population * population + population * (population - 1) / 2 + 2 * population);
    }
    return { preparation, reads, frozenReads };
  } finally {
    probe.mockRestore();
  }
}

describe('owned immutable observation work', () => {
  test.each([8, 32])('wide record reads do not rescan sibling fields (N=%i)', population => {
    let preparation = 0;
    let reads = 0;
    let frozenReads = 0;
    let reading = false;
    const descriptor = Object.getOwnPropertyDescriptor;
    const probe = jest.spyOn(Object, 'getOwnPropertyDescriptor').mockImplementation((target: object, key: PropertyKey) => {
      if (/^field[0-9]+$/u.test(String(key))) {
        if (reading) {
          reads += 1;
          if (Object.isFrozen(target)) {
            frozenReads += 1;
          }
        } else {
          preparation += 1;
        }
      }
      return descriptor(target, key);
    });
    try {
      const observer = createTrackingObserver(machine);
      const fields = Object.fromEntries(Array.from({ length: population }, (_, index) => [`field${index}`, index]));
      const input = observer.tracked({ fields }, { path: ['record-work'] });
      reading = true;
      for (let repetition = 0; repetition < 3; repetition += 1) {
        const capture = observer.capture(() => {
          let total = 0;
          // eslint-disable-next-line microdelta/tracked-captures -- The fixture fixes read count independently of the tracked record width to measure actual surface work.
          for (let index = 0; index < population; index += 1) {
            total += input.fields[`field${index}`] ?? 0;
            total += `field${index}` in input.fields ? 1 : 0;
            total += observer.hasOwn(input.fields, `field${index}`) ? 1 : 0;
          }
          return total;
        });
        expect(capture.value).toBe(population * (population - 1) / 2 + 2 * population);
      }
      expect(preparation).toBeGreaterThan(0);
      expect(frozenReads).toBeGreaterThan(0);
      // Three expressions, depth two, preliminary and evidence selection,
      // repeated in three separate captures; unrelated fields add no work.
      expect(reads).toBeLessThanOrEqual(3 * population * 3 * 2 * 2);
    } finally {
      probe.mockRestore();
    }
  });

  test.each([8, 32])('narrow reads follow selected paths rather than population surfaces (N=%i)', population => {
    for (const captures of [1, 3]) {
      const work = measureSurfaceWork(population, captures);
      expect(work.preparation).toBeGreaterThan(0);
      expect(work.frozenReads).toBeGreaterThan(0);
      // Each iteration issues four literal expressions, each with at most four
      // path segments. Allow one descriptor per segment for preliminary selection
      // and one for evidence selection: 4 expressions × 4 depth × 2 selections.
      expect(work.reads).toBeLessThanOrEqual(captures * population * 4 * 4 * 2);
    }
  });
});


describe('immutable ownership preserves literal Value evidence', () => {
  test('sparse positions and numeric record keys retain independently specified facts across captures', () => {
    const observer = createTrackingObserver(machine);
    const sparse = new Array<undefined>(2);
    sparse[0] = undefined;
    const input = observer.tracked({ sparse, record: { '0': undefined } }, { path: ['literal'] });
    const expected: readonly ISelectedFact[] = [
      { operation: 'container-kind', address: [{ kind: 'property', key: 'sparse' }], fact: 'array' },
      { operation: 'length', address: [{ kind: 'property', key: 'sparse' }], fact: 2 },
      { operation: 'value', address: [{ kind: 'property', key: 'sparse' }, { kind: 'index', index: 0 }], fact: undefined },
      { operation: 'value', address: [{ kind: 'property', key: 'sparse' }, { kind: 'index', index: 1 }], fact: undefined },
      { operation: 'membership', address: [{ kind: 'property', key: 'sparse' }, { kind: 'index', index: 0 }], fact: true },
      { operation: 'membership', address: [{ kind: 'property', key: 'sparse' }, { kind: 'index', index: 1 }], fact: false },
      { operation: 'own', address: [{ kind: 'property', key: 'sparse' }, { kind: 'index', index: 0 }], fact: true },
      { operation: 'own', address: [{ kind: 'property', key: 'sparse' }, { kind: 'index', index: 1 }], fact: false },
      { operation: 'container-kind', address: [{ kind: 'property', key: 'record' }], fact: 'record' },
      { operation: 'value', address: [{ kind: 'property', key: 'record' }, { kind: 'property', key: '0' }], fact: undefined },
    ];
    for (let repetition = 0; repetition < 2; repetition += 1) {
      const capture = observer.capture(() => [
        input.sparse.length, input.sparse[0], input.sparse[1],
        0 in input.sparse, 1 in input.sparse,
        observer.hasOwn(input.sparse, '0'), observer.hasOwn(input.sparse, '1'),
        input.record['0'], input.sparse.length,
      ]);
      expect(capture.value).toEqual([2, undefined, undefined, true, false, true, false, undefined, 2]);
      expect(capture.observations.map(fact => ({ operation: fact.operation, address: fact.address, encoded: fact.encoded })))
        .toEqual(expected.map(fact => ({ operation: fact.operation, address: fact.address, encoded: encodeSelectedFact(fact) })));
    }
  });

  test('bounded custom prototype lookup and insertion order survive preparation', () => {
    const observer = createTrackingObserver(machine);
    const parent = recordFromEntries([['inherited', 'parent']], null);
    const source = recordFromEntries([['zeta', 'last'], ['alpha', 'first']], parent);
    const input = observer.tracked(source, { path: ['prototype'] });
    const capture = observer.capture(() => [input['inherited'], 'inherited' in input, observer.hasOwn(input, 'inherited'), observer.keys(input)]);
    expect(capture.value).toEqual(['parent', true, false, ['zeta', 'alpha']]);
    const expected: readonly ISelectedFact[] = [
      { operation: 'value', address: [{ kind: 'property', key: 'inherited' }], fact: 'parent' },
      { operation: 'membership', address: [{ kind: 'property', key: 'inherited' }], fact: true },
      { operation: 'own', address: [{ kind: 'property', key: 'inherited' }], fact: false },
      { operation: 'keys', address: [], fact: ['zeta', 'alpha'] },
    ];
    expect(capture.observations.map(fact => fact.encoded)).toEqual(expected.map(fact => encodeSelectedFact(fact)));
  });

  test('caller mutation cannot change an owned view or seed another wrapper with the same binding', () => {
    const observer = createTrackingObserver(machine);
    const binding = { path: ['same'] };
    const source = { nested: { score: 1 }, rows: [1] };
    const old = observer.tracked(source, binding);
    source.nested.score = 2;
    source.rows.push(2);
    const fresh = observer.tracked(source, binding);
    const separate = observer.tracked({ nested: { score: 3 }, rows: [3] }, binding);
    expect(observer.capture(() => [old.nested.score, old.rows.length, fresh.nested.score, fresh.rows.length, separate.nested.score]).value)
      .toEqual([1, 1, 2, 2, 3]);
    expect(Object.isFrozen(source)).toBe(false);
    expect(Object.isFrozen(source.nested)).toBe(false);
    expect(Object.isFrozen(source.rows)).toBe(false);
    let getters = 0;
    Object.defineProperty(source.nested, 'bad', { enumerable: true, get() { getters += 1; return 7; } });
    expect(observer.capture(() => old.nested.score).value).toBe(1);
    expect(() => observer.tracked(source, binding)).toThrow(/accessor/u);
    expect(getters).toBe(0);
  });

  test.each(['accessor', 'symbol', 'extra', 'prototype'])('ordinary mutable Value surfaces are checked again after %s mutation', mutation => {
    const rows = [1];
    const root = { rows };
    const address = [{ kind: 'property', key: 'rows' }, { kind: 'index', index: 0 }] as const;
    expect(observe(root, address, 'value').fact).toBe(1);
    let getters = 0;
    if (mutation === 'accessor') {
      Object.defineProperty(rows, '0', { enumerable: true, get() { getters += 1; return 1; } });
    } else if (mutation === 'symbol') {
      Object.defineProperty(rows, Symbol('bad'), { value: 1 });
    } else if (mutation === 'extra') {
      Object.defineProperty(rows, 'extra', { enumerable: true, value: 1 });
    } else {
      Object.setPrototypeOf(rows, null);
    }
    expect(() => observe(root, address, 'value')).toThrow(TypeError);
    expect(() => navigate(root, address)).toThrow(TypeError);
    expect(() => createTrackingObserver(machine).tracked(root, { path: ['invalid'] })).toThrow(TypeError);
    expect(getters).toBe(0);
  });

  test('arbitrarily frozen unsupported input never becomes an ownership proof', () => {
    let getters = 0;
    const frozen = Object.freeze({ get selected(): number { getters += 1; return 1; } });
    expect(() => createTrackingObserver(machine).tracked(frozen, { path: ['frozen'] })).toThrow(/accessor/u);
    expect(getters).toBe(0);
  });
});
