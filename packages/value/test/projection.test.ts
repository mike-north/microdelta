import { describe, expect, test } from '@jest/globals';

import { encodeProjectionFact, encodeValue, normalizeProjectionFact } from '../src/index.js';
import type { IValueProjectionFact } from '../src/index.js';

describe('keyed projection content', () => {
  test('canonicalizes unique keyed values independently of input order for exhaustive unordered traversal', () => {
    const first: IValueProjectionFact = {
      descriptor: {
        address: [{ kind: 'property', key: 'profile' }],
        operation: 'value',
        traversal: { kind: 'exhaustive', complete: true },
      },
      members: [['b', { score: 2 }], ['a', { score: 1 }]],
    };
    const reordered: IValueProjectionFact = {
      ...first,
      members: [['a', { score: 1 }], ['b', { score: 2 }]],
    };

    expect(encodeProjectionFact(first)).toBe(encodeProjectionFact(reordered));
  });

  test('distinguishes selected values, addresses, incomplete coverage, and separate ordered key sequences', () => {
    const exhaustive: IValueProjectionFact = {
      descriptor: {
        address: [{ kind: 'property', key: 'name' }],
        operation: 'value',
        traversal: { kind: 'exhaustive', complete: true },
      },
      members: [['member-a', 'Ada'], ['member-b', 'Grace']],
    };
    const changed = {
      ...exhaustive,
      members: [['member-a', 'Ada'], ['member-b', 'Lin'] ] as const,
    };
    const incomplete: IValueProjectionFact = {
      descriptor: {
        ...exhaustive.descriptor,
        traversal: { kind: 'visited', complete: false, keys: ['member-a'] },
      },
      members: [['member-a', 'Ada']],
    };

    expect(encodeProjectionFact(changed)).not.toBe(encodeProjectionFact(exhaustive));
    expect(encodeProjectionFact(incomplete)).not.toBe(encodeProjectionFact(exhaustive));
    expect(encodeProjectionFact({ ...exhaustive, members: [...exhaustive.members].reverse() }))
      .toBe(encodeProjectionFact(exhaustive));
    expect(encodeValue(['member-a', 'member-b'])).not.toBe(encodeValue(['member-b', 'member-a']));
  });

  test('retains the exact visited-key sequence while canonicalizing its selected member values', () => {
    const first: IValueProjectionFact = {
      descriptor: {
        address: [],
        operation: 'value',
        traversal: { kind: 'visited', complete: false, keys: ['member-b', 'member-a'] },
      },
      members: [['member-b', { z: 1, a: 2 }], ['member-a', { name: 'Ada' }]],
    };
    const sameSequence: IValueProjectionFact = {
      ...first,
      descriptor: { ...first.descriptor, traversal: { kind: 'visited', complete: false, keys: ['member-b', 'member-a'] } },
      members: [['member-a', { name: 'Ada' }], ['member-b', { a: 2, z: 1 }]],
    };
    const differentSequence: IValueProjectionFact = {
      ...first,
      descriptor: { ...first.descriptor, traversal: { kind: 'visited', complete: false, keys: ['member-a', 'member-b'] } },
    };

    expect(encodeProjectionFact(sameSequence)).toBe(encodeProjectionFact(first));
    expect(encodeProjectionFact(differentSequence)).not.toBe(encodeProjectionFact(first));
    expect(normalizeProjectionFact(first).descriptor.traversal).toEqual(first.descriptor.traversal);
  });

  test('member insertion, deletion, and selected-value changes alter content while unrelated fields do not', () => {
    const base: IValueProjectionFact = {
      descriptor: {
        address: [{ kind: 'property', key: 'selected' }],
        operation: 'value',
        traversal: { kind: 'exhaustive', complete: true },
      },
      members: [['one', 'first'], ['two', 'second']],
    };
    const inserted: IValueProjectionFact = { ...base, members: [...base.members, ['three', 'third']] };
    const deleted: IValueProjectionFact = { ...base, members: [['one', 'first']] };
    const changed: IValueProjectionFact = { ...base, members: [['one', 'changed'], ['two', 'second']] };

    expect(encodeProjectionFact(inserted)).not.toBe(encodeProjectionFact(base));
    expect(encodeProjectionFact(deleted)).not.toBe(encodeProjectionFact(base));
    expect(encodeProjectionFact(changed)).not.toBe(encodeProjectionFact(base));
    const selectValues = (rows: readonly { readonly key: string; readonly selected: string; readonly unread: string }[]): IValueProjectionFact => ({
      descriptor: base.descriptor,
      members: rows.map(({ key, selected }) => [key, selected] as const),
    });
    expect(encodeProjectionFact(selectValues([
      { key: 'one', selected: 'first', unread: 'before' },
      { key: 'two', selected: 'second', unread: 'before' },
    ]))).toBe(encodeProjectionFact(selectValues([
      { key: 'two', selected: 'second', unread: 'after' },
      { key: 'one', selected: 'first', unread: 'after' },
    ])));
  });

  test('normalizes nested selected values as detached immutable MDP1 content', () => {
    const nested = { z: 1, a: 2 };
    const fact: IValueProjectionFact = {
      descriptor: { address: [], operation: 'value', traversal: { kind: 'exhaustive', complete: true } },
      members: [['user-a', nested]],
    };
    const normalized = normalizeProjectionFact(fact);
    const value = normalized.members[0]?.[1];
    if (value === null || typeof value !== 'object' || Array.isArray(value)) {
      throw new TypeError('Expected a normalized record member');
    }

    expect(value).not.toBe(nested);
    expect(Object.keys(value)).toEqual(['a', 'z']);
    expect(Object.isFrozen(value)).toBe(true);
    expect(encodeProjectionFact(normalized)).toBe(encodeProjectionFact(fact));
  });

  test('rejects duplicate keys and descriptors whose coverage contradicts selected members', () => {
    const base: IValueProjectionFact = {
      descriptor: {
        address: [],
        operation: 'value',
        traversal: { kind: 'visited', complete: false, keys: ['a'] },
      },
      members: [['a', 1]],
    };

    expect(() => encodeProjectionFact({ ...base, members: [['a', 1], ['a', 2]] })).toThrow(/duplicate.*a|a.*duplicate/i);
    expect(() => encodeProjectionFact({ ...base, members: [] })).toThrow(/coverage|visited|member/i);
    const malformed: IValueProjectionFact = {
      ...base,
      descriptor: { ...base.descriptor, traversal: { kind: 'visited', complete: false, keys: ['a'] } },
    };
    Object.defineProperty(malformed.descriptor, 'traversal', {
      value: { kind: 'exhaustive', complete: false }, enumerable: true, configurable: true,
    });
    expect(() => encodeProjectionFact(malformed)).toThrow(/complete|traversal/i);
  });
});
