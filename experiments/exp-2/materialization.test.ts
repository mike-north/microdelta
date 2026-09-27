/** EXP-2 selected-loading fixtures measure real backing reads and consumed fields. */
import { createHash } from 'node:crypto';

import { describe, expect, test } from '@jest/globals';

import {
  createSyncView,
  materializeOutput,
  prepareView,
  projectUniform,
  projectVisited,
  verifyFingerprint,
} from './src/materialization.js';
import type { IAsyncFieldSource, ISyncFieldSource } from './src/materialization.js';
import type { IDigestCapability } from './src/value.js';

/** Node supplies only the experiment's host digest adapter. */
const digest: IDigestCapability = {
  sha256(input: string): string {
    return createHash('sha256').update(input, 'utf8').digest('hex');
  },
};

/** A deliberately large unread field makes full-payload reads observable. */
function syncSource(): { readonly source: ISyncFieldSource; readonly reads: string[] } {
  const reads: string[] = [];
  const fields = { name: 'Ada', city: 'Seattle', payload: 'x'.repeat(1_000_000) };
  return {
    reads,
    source: {
      fingerprint: 'stored-sha256-sidecar',
      readField(name: string): unknown {
        reads.push(name);
        return Reflect.get(fields, name);
      },
    },
  };
}

describe('fingerprint and selected materialization', () => {
  test('fingerprint-only verification makes zero payload reads; positive control really reads', () => {
    const { source, reads } = syncSource();
    expect(verifyFingerprint(source, 'stored-sha256-sidecar')).toBe(true);
    expect(verifyFingerprint(source, 'different-sidecar')).toBe(false);
    expect(reads).toEqual([]);
    const view = createSyncView(source);
    expect(view.value.name).toBe('Ada');
    expect(reads).toEqual(['name']);
    expect(view.observations.map(observation => observation.address)).toEqual([[{ kind: 'property', key: 'name' }]]);
  });

  test('two narrow consumers avoid loading a large unread sibling', () => {
    const { source, reads } = syncSource();
    const first = createSyncView(source);
    const second = createSyncView(source);
    expect(first.value.name).toBe('Ada');
    expect(second.value.city).toBe('Seattle');
    expect(reads).toEqual(['name', 'city']);
    expect(first.observations).toHaveLength(1);
    expect(second.observations).toHaveLength(1);
  });

  test('materialized pass-through output records only emitted fields', () => {
    const { source, reads } = syncSource();
    const view = createSyncView(source);
    const result = materializeOutput(view, ['name']);
    expect(result).toEqual({ name: 'Ada' });
    expect(reads).toEqual(['name']);
    expect(view.observations).toHaveLength(1);
  });

  test('lazy view rejects an object subtree instead of recording unread descendants', () => {
    const sourceValue = { nested: { name: 'Ada' } };
    const source: ISyncFieldSource = {
      fingerprint: 'sidecar',
      readField(): unknown {
        return sourceValue;
      },
    };
    const view = createSyncView(source);
    expect(() => view.value['person']).toThrow(/scalar|nested/i);
    expect(() => materializeOutput(view, ['person'])).toThrow(/scalar|nested/i);
    expect(Object.isFrozen(sourceValue)).toBe(false);
    expect(view.observations).toHaveLength(0);
  });

  test('the view cannot be used to mutate a backing value', () => {
    const { source, reads } = syncSource();
    const view = createSyncView(source);
    expect(Reflect.set(view.value, 'name', 'Eve')).toBe(false);
    expect(view.value.name).toBe('Ada');
    expect(reads).toEqual(['name']);
  });

  test('unsupported presence, enumeration, and prototype operations fail before payload reads', () => {
    const { source, reads } = syncSource();
    const view = createSyncView(source);
    expect(() => Object.hasOwn(view.value, 'name')).toThrow(/unsupported/i);
    expect(() => 'name' in view.value).toThrow(/unsupported/i);
    expect(() => Object.keys(view.value)).toThrow(/unsupported/i);
    expect((): void => { Object.getPrototypeOf(view.value); }).toThrow(/unsupported/i);
    expect(reads).toEqual([]);
    expect(view.observations).toHaveLength(0);
  });

  test('a caller cannot erase captured observations through the returned array', () => {
    const { source } = syncSource();
    const view = createSyncView(source);
    expect(view.value.name).toBe('Ada');
    const exposed = view.observations;
    expect(Object.isFrozen(exposed)).toBe(true);
    expect((): void => { Reflect.apply(Array.prototype.pop, exposed, []); }).toThrow();
    expect(view.observations).toHaveLength(1);
  });

  test('explicit async preparation retains ordinary reads for prepared scalars', async () => {
    const { source, reads } = syncSource();
    const asyncSource: IAsyncFieldSource = {
      fingerprint: source.fingerprint,
      async readField(name: string): Promise<unknown> {
        return source.readField(name);
      },
    };
    const view = await prepareView(asyncSource, ['name']);
    expect(reads).toEqual(['name']);
    expect(view.value.name).toBe('Ada');
    expect(view.observations).toHaveLength(1);
    expect(() => view.value.city).toThrow(/prepare|unprepared/i);
    expect(reads).toEqual(['name']);
  });
});

describe('collection projection boundaries', () => {
  const members = [
    { key: 'a', value: { name: 'Ada', unread: 1 } },
    { key: 'b', value: { name: 'Bob', unread: 2 } },
  ] as const;

  test('one exhaustive uniform projection is one logical dependency and ignores order/unread fields', () => {
    const first = projectUniform('people', members, 'name', digest);
    const reverse = projectUniform('people', [...members].reverse(), 'name', digest);
    const unread = projectUniform('people', [
      { key: 'a', value: { name: 'Ada', unread: 100 } },
      { key: 'b', value: { name: 'Bob', unread: 200 } },
    ], 'name', digest);
    const changed = projectUniform('people', [
      { key: 'a', value: { name: 'Grace' } },
      { key: 'b', value: { name: 'Bob' } },
    ], 'name', digest);
    expect(first.logicalDependencies).toHaveLength(1);
    expect(first.visitedKeys).toEqual([]);
    expect(first.logicalDependencies[0]?.fingerprint).toBe(reverse.logicalDependencies[0]?.fingerprint);
    expect(first.logicalDependencies[0]?.fingerprint).toBe(unread.logicalDependencies[0]?.fingerprint);
    expect(first.logicalDependencies[0]?.fingerprint).not.toBe(changed.logicalDependencies[0]?.fingerprint);
    expect(first.inspectedMembers).toBe(2);
    expect(() => projectUniform('people', [...members, members[0]], 'name', digest)).toThrow(/duplicate/i);
  });

  test('an early-stop projection retains actual visited coverage', () => {
    const visited = projectVisited('people', members.slice(0, 1), 'name', digest);
    expect(visited.visitedKeys).toEqual(['a']);
    expect(visited.logicalDependencies).toHaveLength(1);
    expect(visited.inspectedMembers).toBe(1);
    expect(visited.complete).toBe(false);
  });

  test('a selected getter is rejected without being invoked', () => {
    let calls = 0;
    const value = Object.defineProperty({}, 'name', {
      enumerable: true,
      get(): string {
        calls++;
        return 'Ada';
      },
    });
    expect(() => projectUniform('people', [{ key: 'a', value }], 'name', digest)).toThrow(/unsupported/i);
    expect(calls).toBe(0);
  });
});
