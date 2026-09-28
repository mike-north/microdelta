/**
 * Exact navigation answers what kind of node one structured address selects:
 * a scalar selected fact, or the shape of a record/array container. It is the
 * Value-owned meaning behind lazy nested views over retained results.
 *
 * @see ../../../docs/spec/tracking.md (TRK-5 observation table, VAL-1 structured addresses, EXP-2 domain)
 * @see ../../../docs/plans/m3-contribution-analysis.md (Nested materialization and evidence ownership)
 */
import { describe, expect, test } from '@jest/globals';

import { encodeSelectedFact, navigate, normalizeSelectedFact, normalizeSelectedNode, observe } from '../src/value.js';
import type { IAddressSegment, ISelectedNode } from '../src/value.js';

/** Build a structured Property segment. */
function property(key: string): IAddressSegment {
  return { kind: 'property', key };
}

/** Build a structured Index segment. */
function index(position: number): IAddressSegment {
  return { kind: 'index', index: position };
}

describe('exact node navigation', () => {
  const activity = {
    profile: { id: 'gh:1', name: 'Ada', avatarUrl: 'https://example.invalid/ada.png' },
    pullRequests: [{ number: 101, merged: true }, { number: 102, merged: false }],
  };

  test('a scalar leaf is a tagged selected value fact, identical to the Value observe fact', () => {
    const address = [property('profile'), property('name')];
    const node = navigate(activity, address);

    expect(node).toEqual({ kind: 'scalar', selected: { operation: 'value', address, fact: 'Ada' } });
    if (node.kind !== 'scalar') {
      throw new Error('expected a scalar node');
    }
    // TRK-5: a leaf read consumes exactly the value at the bound path.
    expect(encodeSelectedFact(node.selected)).toBe(encodeSelectedFact(observe(activity, address, 'value')));
  });

  test('containers are shapes, never fabricated facts: records carry no members and arrays carry only length', () => {
    expect(navigate(activity, [])).toEqual({ kind: 'record', address: [] });
    expect(navigate(activity, [property('profile')])).toEqual({ kind: 'record', address: [property('profile')] });
    expect(navigate(activity, [property('pullRequests')])).toEqual({
      kind: 'array', address: [property('pullRequests')], length: 2,
    });
    expect(navigate(activity, [property('pullRequests'), index(1)])).toEqual({
      kind: 'record', address: [property('pullRequests'), index(1)],
    });
  });

  test('navigating one member does not inspect an unsupported unread sibling', () => {
    let getterCalls = 0;
    const root = {
      profile: { name: 'Ada' },
      unread: Object.defineProperty({}, 'boom', {
        enumerable: true,
        get(): string { getterCalls += 1; return 'never'; },
      }),
    };

    expect(navigate(root, [property('profile'), property('name')])).toMatchObject({ kind: 'scalar' });
    expect(getterCalls).toBe(0);
    // The shape of the selected container itself is validated when it is navigated.
    expect(() => navigate(root, [property('unread')])).toThrow(/accessor/u);
    expect(getterCalls).toBe(0);
  });

  test('sparse holes and present undefined both select an undefined value fact', () => {
    const sparse: unknown[] = new Array<unknown>(3);
    sparse[0] = 'first';
    const root = { sparse, present: ['first', undefined, 'third'] };

    for (const key of ['sparse', 'present']) {
      const node = navigate(root, [property(key), index(1)]);
      expect(node).toEqual({ kind: 'scalar', selected: { operation: 'value', address: [property(key), index(1)], fact: undefined } });
    }
    expect(navigate(root, [property('sparse')])).toEqual({ kind: 'array', address: [property('sparse')], length: 3 });
  });

  test('supported custom prototypes resolve inherited scalars and inherited containers', () => {
    const prototype = { inherited: 'from prototype', box: { label: 'inherited box' } };
    const child: Record<string, unknown> = Object.create(prototype) as Record<string, unknown>;
    child.own = 'own value';
    const root = { child };

    expect(navigate(root, [property('child'), property('inherited')])).toMatchObject({
      kind: 'scalar', selected: { fact: 'from prototype' },
    });
    expect(navigate(root, [property('child'), property('box')])).toEqual({
      kind: 'record', address: [property('child'), property('box')],
    });
    expect(navigate(root, [property('child'), property('box'), property('label')])).toMatchObject({
      kind: 'scalar', selected: { fact: 'inherited box' },
    });
    // Intrinsic Object.prototype members remain outside the supported lookup domain.
    expect(() => navigate(root, [property('child'), property('toString')])).toThrow(/intrinsic/u);
  });

  test('Property and Index segments follow the container kind rather than their spelling', () => {
    const root = { record: { '0': 'property zero' }, list: ['index zero'] };

    expect(navigate(root, [property('record'), property('0')])).toMatchObject({ selected: { fact: 'property zero' } });
    expect(navigate(root, [property('list'), index(0)])).toMatchObject({ selected: { fact: 'index zero' } });
    expect(() => navigate(root, [property('record'), index(0)])).toThrow(/index needs array/u);
    expect(() => navigate(root, [property('list'), property('0')])).toThrow(/property needs record/u);
    expect(() => navigate(root, [property('record'), property('0'), property('length')])).toThrow(/property needs record/u);
  });

  test('a navigation root must be a supported container; scalar roots and invalid shapes fail', () => {
    expect(() => navigate('scalar root', [])).toThrow(/record or array/u);
    expect(() => navigate(undefined, [])).toThrow(/record or array/u);
    const extra: unknown[] & { extra?: string } = ['a'];
    extra.extra = 'not an index';
    expect(() => navigate({ extra }, [property('extra')])).toThrow(/extra or noncanonical array property/u);
    expect(() => navigate({ missing: undefined }, [property('missing'), property('name')])).toThrow(/property needs record/u);
  });

  test('returned nodes are frozen and detached from the caller address', () => {
    const address = [property('profile'), property('name')];
    const node: ISelectedNode = navigate(activity, address);
    address.push(property('mutated'));

    expect(Object.isFrozen(node)).toBe(true);
    if (node.kind !== 'scalar') {
      throw new Error('expected a scalar node');
    }
    expect(Object.isFrozen(node.selected)).toBe(true);
    expect(Object.isFrozen(node.selected.address)).toBe(true);
    expect(node.selected.address).toEqual([property('profile'), property('name')]);
  });
});

describe('untrusted node envelopes', () => {
  const address = [property('profile'), property('name')];

  test('a well-formed envelope is copied into a frozen detached node', () => {
    const supplied = { kind: 'scalar', selected: { operation: 'value', address: [property('profile'), property('name')], fact: 'Ada' } };
    const node = normalizeSelectedNode(supplied);
    supplied.selected.fact = 'mutated';

    expect(node).toEqual({ kind: 'scalar', selected: { operation: 'value', address, fact: 'Ada' } });
    expect(Object.isFrozen(node)).toBe(true);
    expect(normalizeSelectedNode({ kind: 'array', address: [], length: 0 })).toEqual({ kind: 'array', address: [], length: 0 });
    // Null-prototype envelopes have the same meaning as ordinary records.
    const nullPrototype = Object.assign(Object.create(null) as object, { kind: 'record', address: [] });
    expect(normalizeSelectedNode(nullPrototype)).toEqual({ kind: 'record', address: [] });
  });

  test('malformed envelopes fail without invoking accessors', () => {
    let getterCalls = 0;
    const getterBacked = Object.defineProperty({ address: [] }, 'kind', {
      enumerable: true,
      get(): string { getterCalls += 1; return 'record'; },
    });
    const sparseAddress: IAddressSegment[] = new Array<IAddressSegment>(1);
    const malformed: readonly unknown[] = [
      undefined,
      'record',
      Promise.resolve({ kind: 'record', address: [] }),
      getterBacked,
      { kind: 'record', address: [], extra: true },
      { kind: 'record', address: sparseAddress },
      { kind: 'record', address: [{ kind: 'index', index: -1 }] },
      { kind: 'record', address: [{ kind: 'property', key: 'a', index: 0 }] },
      { kind: 'array', address: [] },
      { kind: 'array', address: [], length: 1.5 },
      { kind: 'array', address: [], length: -1 },
      { kind: 'object', address: [] },
      { kind: 'scalar', selected: { operation: 'own', address, fact: true } },
      // A fabricated container shape must never travel inside a selected fact.
      { kind: 'scalar', selected: { operation: 'value', address, fact: { kind: 'record', address } } },
      { kind: 'scalar', selected: { operation: 'value', address, fact: 1n } },
      { kind: 'scalar', selected: { operation: 'value', address, fact: 'Ada', extra: true } },
      { kind: 'scalar', address, selected: { operation: 'value', address, fact: 'Ada' } },
    ];

    for (const candidate of malformed) {
      expect(() => normalizeSelectedNode(candidate)).toThrow(TypeError);
    }
    expect(getterCalls).toBe(0);
  });
});

describe('untrusted selected-fact envelopes', () => {
  const address = [property('profile'), property('name')];

  test('ordinary facts for every operation are copied into frozen detached facts', () => {
    const facts = [
      { operation: 'value', address: [property('profile'), property('name')], fact: 'Ada' },
      { operation: 'value', address: [property('missing')], fact: undefined },
      { operation: 'own', address: [property('profile'), property('name')], fact: true },
      { operation: 'membership', address: [property('profile'), index(0)], fact: false },
      { operation: 'length', address: [property('list')], fact: 3 },
      { operation: 'keys', address: [property('profile')], fact: ['zeta', 'alpha'] },
    ];
    for (const supplied of facts) {
      const normalized = normalizeSelectedFact(supplied);
      expect(normalized).toEqual(supplied);
      expect(Object.isFrozen(normalized)).toBe(true);
      expect(Object.isFrozen(normalized.address)).toBe(true);
      expect(encodeSelectedFact(normalized)).toBe(encodeSelectedFact(supplied as never));
    }
    const keys = ['zeta', 'alpha'];
    const normalized = normalizeSelectedFact({ operation: 'keys', address: [], fact: keys });
    keys.push('mutated');
    expect(normalized.fact).toEqual(['zeta', 'alpha']);
    expect(Object.isFrozen(normalized.fact)).toBe(true);
  });

  test('a supported object value fact is detached as an immutable snapshot', () => {
    const profile = { name: 'Ada', id: 'gh:1' };
    const normalized = normalizeSelectedFact({ operation: 'value', address: [property('profile')], fact: profile });
    profile.name = 'mutated';
    expect(normalized.fact).toEqual({ name: 'Ada', id: 'gh:1' });
    expect(Object.keys(normalized.fact as object)).toEqual(['name', 'id']);
    expect(Object.isFrozen(normalized.fact)).toBe(true);
  });

  test('arrays whose iteration, methods or prototype disagree with their indexed data are rejected unread', () => {
    let calls = 0;
    const iterating = ['actual'];
    Object.defineProperty(iterating, Symbol.iterator, { get(): unknown { calls += 1; return undefined; } });
    const mapping = [property('name')];
    Object.defineProperty(mapping, 'map', { value(): unknown { calls += 1; return []; } });
    const prototyped = ['actual'];
    Object.setPrototypeOf(prototyped, Object.create(Array.prototype) as object);
    const sparseKeys: string[] = new Array<string>(2);
    sparseKeys[0] = 'only';
    const malformed: readonly unknown[] = [
      { operation: 'keys', address, fact: iterating },
      { operation: 'keys', address, fact: prototyped },
      { operation: 'keys', address, fact: sparseKeys },
      { operation: 'keys', address, fact: ['dup', 'dup'] },
      { operation: 'keys', address, fact: [1] },
      { operation: 'value', address: mapping, fact: 'Ada' },
      { operation: 'own', address: prototyped, fact: true },
      { operation: 'own', address, fact: 'yes' },
      { operation: 'membership', address, fact: 1 },
      { operation: 'length', address, fact: -1 },
      { operation: 'length', address, fact: 1.5 },
      { operation: 'value', address, fact: 1n },
      { operation: 'value', address, fact: () => 'function' },
      { operation: 'value', address, fact: Object.defineProperty({}, 'name', { enumerable: true, get(): string { calls += 1; return 'Ada'; } }) },
      { operation: 'values', address, fact: 'Ada' },
      { operation: 'value', address, fact: 'Ada', extra: true },
      Promise.resolve({ operation: 'value', address, fact: 'Ada' }),
      Object.defineProperty({ address, fact: 'Ada' }, 'operation', { enumerable: true, get(): string { calls += 1; return 'value'; } }),
    ];
    for (const candidate of malformed) {
      expect(() => normalizeSelectedFact(candidate)).toThrow(TypeError);
    }
    expect(calls).toBe(0);
  });
});

