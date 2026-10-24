/** Production value contracts preserve selected semantics independently of experiment source. */
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';

import { describe, expect, test } from '@jest/globals';
import type { ISha256Capability } from '@microdelta/machine';

import {
  decodeValue,
  decodeSnapshot,
  encodeSelectedFact,
  encodeSnapshot,
  encodeValue,
  fingerprint,
  observe,
  observePrepared,
  prepareValue,
  preparedRoot,
  recordFromEntries,
} from '../src/value.js';
import type { IPreparedValue, ISelectedFact } from '../src/value.js';

/** The test adapter keeps host hashing out of the portable candidate. */
const digest: ISha256Capability = {
  sha256(input: string): string {
    return createHash('sha256').update(input, 'utf8').digest('hex');
  },
};

/** Direct vectors must pass before a matching candidate digest counts as evidence. */
test('Node digest adapter conforms to independent SHA-256 vectors', () => {
  expect(digest.sha256('')).toBe('e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855');
  expect(digest.sha256('abc')).toBe('ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
});

describe('Value-owned prepared snapshots', () => {
  test('preserve independent selected facts and exact snapshot meaning for sparse nested arrays', () => {
    const sparse = new Array<unknown>(6);
    sparse[0] = undefined;
    sparse[3] = -0;
    sparse[5] = Number.NaN;
    const grandparent = { inherited: 'grandparent' };
    const parent = Object.create(grandparent) as { inherited: string; shadowed: string };
    parent.inherited = 'parent';
    parent.shadowed = 'from parent';
    const custom = Object.create(parent) as { own: string };
    custom.own = 'own value';
    const nullPrototype = Object.create(null) as { member: string };
    nullPrototype.member = 'null-prototype value';
    const source = { list: sparse, nested: [{ value: 'Ada' }], custom, nullPrototype, zeta: 1, alpha: 2 };
    const sourceEncoding = encodeSnapshot(source);
    const prepared = prepareValue(source);
    const root = preparedRoot(prepared);
    const oracle = decodeSnapshot(sourceEncoding);
    const requests = [
      { address: [{ kind: 'property', key: 'list' }], operation: 'value' },
      { address: [{ kind: 'property', key: 'list' }], operation: 'length' },
      { address: [{ kind: 'property', key: 'list' }, { kind: 'index', index: 0 }], operation: 'value' },
      { address: [{ kind: 'property', key: 'list' }, { kind: 'index', index: 1 }], operation: 'own' },
      { address: [{ kind: 'property', key: 'list' }, { kind: 'index', index: 3 }], operation: 'value' },
      { address: [{ kind: 'property', key: 'list' }, { kind: 'index', index: 5 }], operation: 'value' },
      { address: [{ kind: 'property', key: 'nested' }, { kind: 'index', index: 0 }, { kind: 'property', key: 'value' }], operation: 'value' },
      { address: [{ kind: 'property', key: 'custom' }, { kind: 'property', key: 'inherited' }], operation: 'value' },
      { address: [{ kind: 'property', key: 'custom' }, { kind: 'property', key: 'inherited' }], operation: 'own' },
      { address: [{ kind: 'property', key: 'custom' }, { kind: 'property', key: 'inherited' }], operation: 'membership' },
      { address: [{ kind: 'property', key: 'nullPrototype' }, { kind: 'property', key: 'missing' }], operation: 'membership' },
      { address: [], operation: 'keys' },
    ] as const;

    expect(encodeSnapshot(root)).toBe(sourceEncoding);
    expect(Object.isFrozen(source)).toBe(false);
    expect(Object.isFrozen(sparse)).toBe(false);
    expect(Object.isFrozen(root)).toBe(true);
    const preparedList = observePrepared(prepared, [{ kind: 'property', key: 'list' }], 'value').fact;
    expect(Object.isFrozen(preparedList)).toBe(true);
    for (const request of requests) {
      expect(encodeSelectedFact(observePrepared(prepared, request.address, request.operation)))
        .toBe(encodeSelectedFact(observe(oracle, request.address, request.operation)));
    }
  });

  test('owns a detached immutable copy and does not trust the caller after preparation', () => {
    const source = { rows: [{ value: 'before' }] };
    const prepared = prepareValue(source);
    const root = preparedRoot(prepared);
    const row = source.rows[0];
    if (row === undefined) {
      throw new Error('Expected fixture row');
    }
    row.value = 'after';

    expect(observePrepared(prepared, [{ kind: 'property', key: 'rows' }, { kind: 'index', index: 0 }, { kind: 'property', key: 'value' }], 'value').fact)
      .toBe('before');
    expect(Object.isFrozen(source)).toBe(false);
    expect(Object.isFrozen(root)).toBe(true);
  });

  test('reject malformed values at preparation and reject fabricated runtime tokens', () => {
    const accessor: unknown[] = [];
    Object.defineProperty(accessor, '0', { enumerable: true, get: () => 'must not run' });
    accessor.length = 1;
    const cyclic: unknown[] = [];
    cyclic.push(cyclic);
    const shared = { value: true };
    const sharedReference = [shared, shared];
    const withSymbol: unknown[] = [];
    Object.defineProperty(withSymbol, Symbol('unsupported'), { value: true });
    const withExtraProperty: unknown[] = [];
    Object.defineProperty(withExtraProperty, 'extra', { value: true });
    const alteredPrototype = new Proxy(new Array<unknown>(), {
      getPrototypeOf: (): object => Object.freeze({ marker: true }),
    });

    for (const value of [accessor, cyclic, sharedReference, withSymbol, withExtraProperty, alteredPrototype]) {
      expect(() => prepareValue(value)).toThrow(TypeError);
    }

    // This deliberately evades the opaque compile-time brand to prove the Value runtime guard.
    const fabricated = Object.create(null) as IPreparedValue;
    expect(() => preparedRoot(fabricated)).toThrow(TypeError);
    expect(() => observePrepared(fabricated, [], 'value')).toThrow(TypeError);
  });
});

describe('literal observation facts', () => {
  test.each(['constructor', '__proto__', 'toString', 'hasOwnProperty'])(
    '%s presence on an ordinary record selects a boolean, while its intrinsic value stays unsupported',
    (key) => {
      const address = [{ kind: 'property', key }] as const;
      expect(observe({}, address, 'own')).toEqual({ operation: 'own', address, fact: false });
      expect(observe({}, address, 'membership')).toEqual({ operation: 'membership', address, fact: true });
      expect(encodeSelectedFact(observe({}, address, 'own'))).not.toBe(encodeSelectedFact(observe({}, address, 'membership')));
      expect(() => observe({}, address, 'value')).toThrow(/intrinsic/u);
    },
  );

  test('own-to-inherited and null-ending transitions retain literal presence semantics', () => {
    const address = [{ kind: 'property', key: 'constructor' }] as const;
    const own = { constructor: 'shadow', sibling: 1 };
    const inherited = { sibling: 2 };
    const nullEnding = recordFromEntries([['sibling', 3]], null);
    expect(observe(own, address, 'own').fact).toBe(true);
    expect(observe(own, address, 'membership').fact).toBe(true);
    expect(observe(inherited, address, 'own').fact).toBe(false);
    expect(observe(inherited, address, 'membership').fact).toBe(true);
    expect(observe(nullEnding, address, 'own').fact).toBe(false);
    expect(observe(nullEnding, address, 'membership').fact).toBe(false);
    expect(observe(own, address, 'value').fact).toBe('shadow');
  });

  test('presence respects supported custom prototype data and rejects unsafe surfaces without invoking getters', () => {
    const address = [{ kind: 'property', key: 'constructor' }] as const;
    const custom = recordFromEntries([['constructor', 'custom data']], Object.prototype);
    const child = recordFromEntries([], custom);
    expect(observe(child, address, 'own').fact).toBe(false);
    expect(observe(child, address, 'membership').fact).toBe(true);
    expect(observe(child, address, 'value').fact).toBe('custom data');
    const intrinsicThroughCustom = recordFromEntries([], recordFromEntries([['other', 1]], Object.prototype));
    expect(observe(intrinsicThroughCustom, address, 'own').fact).toBe(false);
    expect(observe(intrinsicThroughCustom, address, 'membership').fact).toBe(true);
    expect(() => observe(intrinsicThroughCustom, address, 'value')).toThrow(/intrinsic/u);

    let getterCalls = 0;
    const accessor = Object.defineProperty({}, 'constructor', {
      enumerable: true,
      get(): string { getterCalls += 1; return 'unsafe'; },
    });
    const classInstance = new (class Example { readonly member = 'data'; })();
    const native = new Date(0);
    const third = recordFromEntries([], recordFromEntries([], recordFromEntries([], recordFromEntries([], null))));
    for (const candidate of [accessor, classInstance, native, third]) {
      expect(() => observe(candidate, address, 'own')).toThrow(TypeError);
      expect(() => observe(candidate, address, 'membership')).toThrow(TypeError);
    }
    expect(getterCalls).toBe(0);
  });

  test('a value read equates missing and present undefined, while own presence does not', () => {
    const missing = {};
    const present = { optional: undefined };
    const address = [{ kind: 'property', key: 'optional' }] as const;
    expect(encodeSelectedFact(observe(missing, address, 'value'))).toBe(encodeSelectedFact(observe(present, address, 'value')));
    expect(encodeSelectedFact(observe(missing, address, 'own'))).not.toBe(encodeSelectedFact(observe(present, address, 'own')));
  });

  test('own presence and inherited membership remain distinct facts', () => {
    const parent = recordFromEntries([['flag', undefined]], null);
    const child = recordFromEntries([], parent);
    const address = [{ kind: 'property', key: 'flag' }] as const;
    expect(observe(child, address, 'own').fact).toBe(false);
    expect(observe(child, address, 'membership').fact).toBe(true);
    expect(observe(child, address, 'value').fact).toBeUndefined();
    expect(observe({}, address, 'membership').fact).toBe(false);
  });

  test('validates each record surface once before resolving inherited lookup', () => {
    const validationScans = { root: 0, inherited: 0 };
    const inheritedTarget = recordFromEntries([['flag', true]], null);
    // Proxy traps instrument reflective validation only; their targets remain supported records.
    const inherited = new Proxy(inheritedTarget, {
      ownKeys(target): ArrayLike<string | symbol> {
        validationScans.inherited += 1;
        return Reflect.ownKeys(target);
      },
    });
    const rootTarget = recordFromEntries([], inherited);
    const root = new Proxy(rootTarget, {
      ownKeys(target): ArrayLike<string | symbol> {
        validationScans.root += 1;
        return Reflect.ownKeys(target);
      },
    });

    expect(observe(root, [{ kind: 'property', key: 'flag' }], 'membership').fact).toBe(true);
    // One symbol-key scan and one string-key scan validate each chain node.
    expect(validationScans).toEqual({ root: 2, inherited: 2 });
  });

  test('selected descriptor failures keep the root-relative location without invoking a getter', () => {
    const target = Object.create(null) as object;
    let getterCalls = 0;
    let descriptorReads = 0;
    Object.defineProperty(target, 'profile.name', {
      configurable: true,
      enumerable: true,
      get(): string {
        getterCalls += 1;
        return 'Ada';
      },
    });
    // The first descriptor view lets chain validation finish; the second exposes
    // a selected accessor so the lookup boundary must report its actual location.
    const unstable = new Proxy(target, {
      getOwnPropertyDescriptor(record, key): PropertyDescriptor | undefined {
        if (key === 'profile.name') {
          descriptorReads += 1;
          if (descriptorReads === 1) {
            return { configurable: true, enumerable: true, writable: true, value: 'Ada' };
          }
        }
        return Reflect.getOwnPropertyDescriptor(record, key);
      },
    });

    expect(() => observe(unstable, [{ kind: 'property', key: 'profile.name' }], 'value'))
      .toThrow('Unsupported value at $.profile.name: accessor');
    expect(getterCalls).toBe(0);
  });

  test('nested selected accessor errors retain property and array segments without invoking getters', () => {
    let getterCalls = 0;
    const person = Object.defineProperty(Object.create(null) as object, 'name', {
      enumerable: true,
      get(): string {
        getterCalls += 1;
        return 'Ada';
      },
    });
    const address = [
      { kind: 'property', key: 'groups' },
      { kind: 'index', index: 0 },
      { kind: 'property', key: 'person' },
      { kind: 'property', key: 'name' },
    ] as const;

    expect(() => observe({ groups: [{ person }] }, address, 'value'))
      .toThrow('Unsupported value at $.groups[0].person.name: nonenumerable or accessor property');
    expect(getterCalls).toBe(0);
  });

  test('nested keys errors identify the selected target, including array paths', () => {
    const groups = [{ members: ['Ada'] }];
    const address = [
      { kind: 'property', key: 'groups' },
      { kind: 'index', index: 0 },
      { kind: 'property', key: 'members' },
    ] as const;

    expect(() => observe({ groups }, address, 'keys'))
      .toThrow('Unsupported value at $.groups[0].members: keys needs a record');
  });

  test('nested length errors identify the selected target, including array paths', () => {
    const groups = [{ person: { name: 'Ada' } }];
    const address = [
      { kind: 'property', key: 'groups' },
      { kind: 'index', index: 0 },
      { kind: 'property', key: 'person' },
    ] as const;

    expect(() => observe({ groups }, address, 'length'))
      .toThrow('Unsupported value at $.groups[0].person: length needs an array');
  });

  test('nested array surface errors retain the array address', () => {
    const invalidArray = ['Ada'];
    Object.setPrototypeOf(invalidArray, null);
    const address = [
      { kind: 'property', key: 'groups' },
      { kind: 'index', index: 0 },
    ] as const;

    expect(() => observe({ groups: [invalidArray] }, address, 'length'))
      .toThrow('Unsupported value at $.groups[0]: array prototype');
  });

  test('property lookup validates the full supported record chain before resolving', () => {
    const getter = Object.defineProperty({ selected: 'Ada' }, 'hiddenGetter', {
      enumerable: true,
      get: () => 'unobserved',
    });
    const symbolKey = { selected: 'Ada', [Symbol('extra')]: true };
    const nonenumerable = Object.defineProperty({ selected: 'Ada' }, 'hidden', { value: true });
    const first = recordFromEntries([], null);
    const second = recordFromEntries([], first);
    const third = recordFromEntries([], second);
    const tooDeep = recordFromEntries([], third);
    const selected = [{ kind: 'property', key: 'selected' }] as const;

    expect(() => observe(getter, selected, 'value')).toThrow(/\$\.hiddenGetter: nonenumerable or accessor property/u);
    expect(() => observe(symbolKey, selected, 'value')).toThrow(/\$: user symbol key/u);
    expect(() => observe(nonenumerable, selected, 'value')).toThrow(/\$\.hidden: nonenumerable or accessor property/u);
    expect(() => observe(tooDeep, selected, 'value')).toThrow(/prototype depth/u);
  });

  test('an object numeric key and an array index have different structured addresses', () => {
    const property = observe({ '0': 'x' }, [{ kind: 'property', key: '0' }], 'value');
    const index = observe(['x'], [{ kind: 'index', index: 0 }], 'value');
    expect(property.fact).toBe(index.fact);
    expect(encodeSelectedFact(property)).not.toBe(encodeSelectedFact(index));
    expect(() => observe({ '0': 'x' }, [{ kind: 'index', index: 0 }], 'value')).toThrow();
    expect(() => observe(['x'], [{ kind: 'property', key: '0' }], 'value')).toThrow();
  });

  test('holes and undefined agree as reads but differ in presence and whole-array structure', () => {
    const hole = new Array<unknown>(1);
    const present = [undefined];
    const slot = [{ kind: 'index', index: 0 }] as const;
    expect(encodeSelectedFact(observe(hole, slot, 'value'))).toBe(encodeSelectedFact(observe(present, slot, 'value')));
    expect(observe(hole, slot, 'own').fact).toBe(false);
    expect(observe(present, slot, 'own').fact).toBe(true);
    expect(encodeValue(hole)).not.toBe(encodeValue(present));
    expect(observe(hole, [], 'length').fact).toBe(1);
    expect(encodeSelectedFact(observe([9], [], 'length'))).toBe(encodeSelectedFact(observe(hole, [], 'length')));
  });

  test('unordered dictionary content ignores insertion order; ordered enumeration records it', () => {
    const first = recordFromEntries([['a', 1], ['b', 2]], null);
    const reverse = recordFromEntries([['b', 2], ['a', 1]], null);
    expect(encodeValue(first)).toBe(encodeValue(reverse));
    expect(encodeSelectedFact(observe(first, [], 'keys'))).not.toBe(encodeSelectedFact(observe(reverse, [], 'keys')));
  });

  test('snapshot transport preserves later explicit enumeration while equality stays unordered', () => {
    const reverse = recordFromEntries([['b', 2], ['a', 1]], null);
    const forward = recordFromEntries([['a', 1], ['b', 2]], null);
    expect(encodeValue(reverse)).toBe(encodeValue(forward));
    const revived = decodeSnapshot(encodeSnapshot(reverse));
    expect(observe(revived, [], 'keys').fact).toEqual(['b', 'a']);
    expect(encodeSelectedFact(observe(revived, [], 'keys'))).toBe(encodeSelectedFact(observe(reverse, [], 'keys')));
    expect(encodeSnapshot(reverse)).not.toBe(encodeSnapshot(forward));
    expect(() => decodeSnapshot(encodeValue(reverse))).toThrow(/version/i);
  });

  test('plain nested observation selects a leaf without sibling inflation', () => {
    const address = [
      { kind: 'property', key: 'person' },
      { kind: 'property', key: 'name' },
    ] as const;
    const before = { person: { name: 'Ada', unread: 1 } };
    const changedUnread = { person: { name: 'Ada', unread: 2 } };
    expect(encodeSelectedFact(observe(before, address, 'value'))).toBe(encodeSelectedFact(observe(changedUnread, address, 'value')));
  });

  test('pass-through output observes only its selected materialized fields', () => {
    const source = { name: 'Ada', huge: 'unread' };
    const name = observe(source, [{ kind: 'property', key: 'name' }], 'value');
    expect(encodeSelectedFact(name)).toBe(encodeSelectedFact(observe({ name: 'Ada', huge: 'changed' }, name.address, 'value')));
    expect(encodeSelectedFact(name)).not.toBe(encodeSelectedFact(observe({ name: 'Grace', huge: 'unread' }, name.address, 'value')));
  });

  test('navigation does not encode unread descendants, while explicit object facts encode all descendants', () => {
    const source: { child: { name: string; unsupported: unknown } } = { child: { name: 'Ada', unsupported: () => 'unread' } };
    const childAddress = [{ kind: 'property', key: 'child' }] as const;
    const nameAddress = [...childAddress, { kind: 'property', key: 'name' }] as const;

    expect(observe(source, nameAddress, 'value').fact).toBe('Ada');
    const selectedChild = observe(source, childAddress, 'value');
    expect(() => encodeSelectedFact(selectedChild)).toThrow(/unsupported/i);

    source.child.unsupported = 'now supported';
    const encoded = encodeSelectedFact(selectedChild);
    source.child.name = 'Grace';
    expect(encoded).toBe(encodeSelectedFact({ ...selectedChild, fact: { name: 'Ada', unsupported: 'now supported' } }));
  });
});

describe('canonical supported domain', () => {
  test('round trips supported edge values with stable fingerprints', () => {
    const values: readonly unknown[] = [
      undefined, null, true, false, '', 'a.b[0]', '\ud800',
      0, -0, Number.NaN, Infinity, -Infinity, 1.5,
      [], [undefined], new Array<unknown>(1), { a: 1, b: undefined },
      recordFromEntries([['inherited', 2]], recordFromEntries([['base', 1]], null)),
    ];
    for (const value of values) {
      const encoded = encodeValue(value);
      expect(encodeValue(decodeValue(encoded))).toBe(encoded);
      const snapshot = encodeSnapshot(value);
      expect(encodeSnapshot(decodeSnapshot(snapshot))).toBe(snapshot);
      expect(fingerprint(encoded, digest)).toBe(fingerprint(encodeValue(decodeValue(encoded)), digest));
    }
    expect(encodeValue(-0)).not.toBe(encodeValue(0));
    expect(encodeValue(Number.NaN)).toBe(encodeValue(Number.NaN));
    expect(encodeValue(Infinity)).not.toBe(encodeValue(-Infinity));
  });

  test('bounded custom prototype depth preserves supported inherited lookup', () => {
    const base = recordFromEntries([['name', 'Ada']], null);
    const second = recordFromEntries([], base);
    const root = recordFromEntries([], second);
    const address = [{ kind: 'property', key: 'name' }] as const;

    expect(observe(root, address, 'membership').fact).toBe(true);
    expect(observe(root, address, 'own').fact).toBe(false);
    expect(observe(root, address, 'value').fact).toBe('Ada');
    expect(encodeSnapshot(decodeSnapshot(encodeSnapshot(root)))).toBe(encodeSnapshot(root));
    expect(() => encodeValue(recordFromEntries([], root))).toThrow(/prototype depth/iu);
  });

  test('array objects are rejected as custom record prototypes', () => {
    const value = Object.create([]) as Record<string, unknown>;

    expect(() => encodeValue(value)).toThrow(/prototype/i);
    expect(() => encodeSnapshot(value)).toThrow(/prototype/i);
  });

  test('an independent Node process preserves canonical bytes and snapshot lookup meaning', () => {
    const value = recordFromEntries([['b', 2], ['a', 1]], null);
    const local = encodeValue(value);
    const snapshot = encodeSnapshot(value);
    const moduleUrl = new URL('../src/value.js', import.meta.url).href;
    const script = `import { createHash } from 'node:crypto'; import { decodeSnapshot, encodeSnapshot, encodeValue, observe, recordFromEntries } from ${JSON.stringify(moduleUrl)}; const value = recordFromEntries([['a', 1], ['b', 2]], null); const revived = decodeSnapshot(${JSON.stringify(snapshot)}); process.stdout.write(JSON.stringify([encodeValue(value), createHash('sha256').update(encodeValue(value), 'utf8').digest('hex'), encodeSnapshot(revived), observe(revived, [], 'keys').fact]));`;
    const output = execFileSync(process.execPath, ['--input-type=module', '-e', script], { encoding: 'utf8' });
    expect(JSON.parse(output)).toEqual([local, fingerprint(local, digest), snapshot, ['b', 'a']]);
  });

  test('fingerprinting delegates only the supplied canonical text to Machine', () => {
    let received = '';
    const capability: ISha256Capability = {
      sha256(input: string): string {
        received = input;
        return 'a'.repeat(64);
      },
    };
    const canonical = encodeSelectedFact(observe({ value: 'Ada' }, [{ kind: 'property', key: 'value' }], 'value'));
    expect(fingerprint(canonical, capability)).toBe('a'.repeat(64));
    expect(received).toBe(canonical);
    expect(() => fingerprint(canonical, { sha256: () => 'invalid' })).toThrow(/sha-256 adapter output/iu);
  });

  test('unsupported native, callable, symbol, accessor, hidden, cyclic, and shared data fail explicitly', () => {
    class Named { readonly value = 1; }
    const getter = Object.defineProperty({}, 'x', { enumerable: true, get: () => 1 });
    const hidden = Object.defineProperty({}, 'x', { enumerable: false, value: 1 });
    const symbolKey = { [Symbol('key')]: 1 };
    const cycle: { self?: unknown } = {};
    cycle.self = cycle;
    const shared = { value: 1 };
    const unsupported: readonly unknown[] = [
      1n, Symbol('value'), () => 1, new Date(), new Map(), new Set(), new Named(),
      getter, hidden, symbolKey, cycle, { a: shared, b: shared },
    ];
    for (const value of unsupported) {
      expect(() => encodeValue(value)).toThrow(/unsupported|cycle|shared/i);
    }
  });

  test('selected reads reject unsupported container shapes before returning a scalar', () => {
    class Named { readonly name = 'Ada'; }
    const extended = ['Ada'];
    Object.defineProperty(extended, 'extra', { enumerable: true, value: 1 });
    expect(() => observe(new Named(), [{ kind: 'property', key: 'name' }], 'value')).toThrow(/unsupported/i);
    expect(() => observe(extended, [{ kind: 'index', index: 0 }], 'value')).toThrow(/unsupported/i);
  });

  test('duplicate keys and malformed canonical records fail rather than replacing an earlier value', () => {
    expect(() => recordFromEntries([['x', 1], ['x', 2]], null)).toThrow(/duplicate/i);
    expect(() => decodeValue('MDV1|["o",[["x",["d","1"]],["x",["d","2"]]],["p-null"]]')).toThrow(/duplicate/i);
    expect(() => decodeValue('MDV1|["o",[["z",["d","1"]],["a",["d","2"]]],["p-null"]]')).toThrow(/noncanonical/i);
    expect(() => decodeValue('MDV9|N')).toThrow(/version/i);
    expect(() => decodeSnapshot('MDS1|["o",[["x",["d","1"]],["x",["d","2"]]],["p-null"]]')).toThrow(/duplicate/i);
    expect(() => decodeSnapshot('MDS1|["a",["bad"]')).toThrow();
    expect(() => decodeSnapshot('MDS9|["n"]')).toThrow(/version/i);
  });

  test('digest input includes operation, address, fact, and format version', () => {
    const address = [{ kind: 'property', key: 'x.y' }] as const;
    const value: ISelectedFact = { operation: 'value', address, fact: true };
    const own: ISelectedFact = { operation: 'own', address, fact: true };
    expect(fingerprint(encodeSelectedFact(value), digest)).not.toBe(fingerprint(encodeSelectedFact(own), digest));
    expect(encodeSelectedFact(value)).not.toBe(encodeSelectedFact({ ...value, address: [{ kind: 'property', key: 'x' }, { kind: 'property', key: 'y' }] }));
  });

  test('observation schema rejects malformed operation facts and addresses', () => {
    expect(() => encodeSelectedFact({ operation: 'own', address: [{ kind: 'property', key: 'x' }], fact: 1 })).toThrow();
    expect(() => encodeSelectedFact({ operation: 'length', address: [], fact: -1 })).toThrow();
    expect(() => encodeSelectedFact({ operation: 'value', address: [{ kind: 'index', index: -1 }], fact: 'x' })).toThrow();
  });

  test('key enumeration evidence requires dense unique string keys', () => {
    const sparse = new Array<unknown>(1);
    expect(() => encodeSelectedFact({ operation: 'keys', address: [], fact: sparse })).toThrow(/key enumeration/i);
    expect(() => encodeSelectedFact({ operation: 'keys', address: [], fact: ['name', 'name'] })).toThrow(/key enumeration/i);
    expect(() => encodeSelectedFact({ operation: 'keys', address: [], fact: ['name', 'email'] })).not.toThrow();
  });

  test('decoded snapshots cannot mutate retained record or array content', () => {
    const decoded = decodeValue(encodeValue({ child: [1, { name: 'Ada' }] }));
    expect(Object.isFrozen(decoded)).toBe(true);
    const child = observe(decoded, [{ kind: 'property', key: 'child' }], 'value').fact;
    expect(Object.isFrozen(child)).toBe(true);
    expect(encodeValue(decoded)).toBe(encodeValue({ child: [1, { name: 'Ada' }] }));
  });

  test('direct snapshot decoding creates a frozen detached value', () => {
    const source = { child: [1, { name: 'Ada' }] };
    const decoded = decodeSnapshot(encodeSnapshot(source));
    const child = observe(decoded, [{ kind: 'property', key: 'child' }], 'value').fact;
    source.child[1] = { name: 'Grace' };

    expect(decoded).not.toBe(source);
    expect(Object.isFrozen(decoded)).toBe(true);
    expect(Object.isFrozen(child)).toBe(true);
    expect(encodeSnapshot(decoded)).toBe(encodeSnapshot({ child: [1, { name: 'Ada' }] }));
  });
});

/** Kind evidence is bounded and still uses the supported Value navigation domain. */
test('container-kind selects only the supported discriminant and rejects unsupported container surfaces', () => {
  const address = [{ kind: 'property', key: 'detail' }] as const;
  expect(observe({ detail: { name: 'Ada' } }, address, 'container-kind').fact).toBe('record');
  expect(observe({ detail: ['Ada'] }, address, 'container-kind').fact).toBe('array');
  expect(observe({ detail: null }, address, 'container-kind').fact).toBe('scalar');
  expect(observe({}, address, 'container-kind').fact).toBe('scalar');
  expect(() => observe({ detail: new Date(0) }, address, 'container-kind')).toThrow(TypeError);
});
