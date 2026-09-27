/** EXP-2 acceptance fixtures assert literal facts before choosing an encoding. */
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';

import { describe, expect, test } from '@jest/globals';

import {
  decodeValue,
  decodeSnapshot,
  encodeObservation,
  encodeSnapshot,
  encodeValue,
  fingerprint,
  observe,
  recordFromEntries,
} from './src/value.js';
import type { IDigestCapability, IObservation } from './src/value.js';

/** The test adapter keeps host hashing out of the portable candidate. */
const digest: IDigestCapability = {
  sha256(input: string): string {
    return createHash('sha256').update(input, 'utf8').digest('hex');
  },
};

/** Direct vectors must pass before a matching candidate digest counts as evidence. */
test('Node digest adapter conforms to independent SHA-256 vectors', () => {
  expect(digest.sha256('')).toBe('e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855');
  expect(digest.sha256('abc')).toBe('ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
});

describe('literal observation facts', () => {
  test('a value read equates missing and present undefined, while own presence does not', () => {
    const missing = {};
    const present = { optional: undefined };
    const address = [{ kind: 'property', key: 'optional' }] as const;
    expect(encodeObservation(observe(missing, address, 'value'))).toBe(encodeObservation(observe(present, address, 'value')));
    expect(encodeObservation(observe(missing, address, 'own'))).not.toBe(encodeObservation(observe(present, address, 'own')));
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

  test('an object numeric key and an array index have different structured addresses', () => {
    const property = observe({ '0': 'x' }, [{ kind: 'property', key: '0' }], 'value');
    const index = observe(['x'], [{ kind: 'index', index: 0 }], 'value');
    expect(property.fact).toBe(index.fact);
    expect(encodeObservation(property)).not.toBe(encodeObservation(index));
    expect(() => observe({ '0': 'x' }, [{ kind: 'index', index: 0 }], 'value')).toThrow();
    expect(() => observe(['x'], [{ kind: 'property', key: '0' }], 'value')).toThrow();
  });

  test('holes and undefined agree as reads but differ in presence and whole-array structure', () => {
    const hole = new Array<unknown>(1);
    const present = [undefined];
    const slot = [{ kind: 'index', index: 0 }] as const;
    expect(encodeObservation(observe(hole, slot, 'value'))).toBe(encodeObservation(observe(present, slot, 'value')));
    expect(observe(hole, slot, 'own').fact).toBe(false);
    expect(observe(present, slot, 'own').fact).toBe(true);
    expect(encodeValue(hole)).not.toBe(encodeValue(present));
    expect(observe(hole, [], 'length').fact).toBe(1);
    expect(encodeObservation(observe([9], [], 'length'))).toBe(encodeObservation(observe(hole, [], 'length')));
  });

  test('unordered dictionary content ignores insertion order; ordered enumeration records it', () => {
    const first = recordFromEntries([['a', 1], ['b', 2]], null);
    const reverse = recordFromEntries([['b', 2], ['a', 1]], null);
    expect(encodeValue(first)).toBe(encodeValue(reverse));
    expect(encodeObservation(observe(first, [], 'keys'))).not.toBe(encodeObservation(observe(reverse, [], 'keys')));
  });

  test('snapshot transport preserves later explicit enumeration while equality stays unordered', () => {
    const reverse = recordFromEntries([['b', 2], ['a', 1]], null);
    const forward = recordFromEntries([['a', 1], ['b', 2]], null);
    expect(encodeValue(reverse)).toBe(encodeValue(forward));
    const revived = decodeSnapshot(encodeSnapshot(reverse));
    expect(observe(revived, [], 'keys').fact).toEqual(['b', 'a']);
    expect(encodeObservation(observe(revived, [], 'keys'))).toBe(encodeObservation(observe(reverse, [], 'keys')));
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
    expect(encodeObservation(observe(before, address, 'value'))).toBe(encodeObservation(observe(changedUnread, address, 'value')));
  });

  test('pass-through output observes only its selected materialized fields', () => {
    const source = { name: 'Ada', huge: 'unread' };
    const name = observe(source, [{ kind: 'property', key: 'name' }], 'value');
    expect(encodeObservation(name)).toBe(encodeObservation(observe({ name: 'Ada', huge: 'changed' }, name.address, 'value')));
    expect(encodeObservation(name)).not.toBe(encodeObservation(observe({ name: 'Grace', huge: 'unread' }, name.address, 'value')));
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

  test('an independent Node process computes the same canonical bytes and SHA-256', () => {
    const value = recordFromEntries([['0', -0], ['name', 'Ada']], null);
    const local = encodeValue(value);
    const moduleUrl = new URL('./src/value.js', import.meta.url).href;
    const script = `import { createHash } from 'node:crypto'; import { encodeValue, recordFromEntries } from ${JSON.stringify(moduleUrl)}; const encoded = encodeValue(recordFromEntries([['name', 'Ada'], ['0', -0]], null)); process.stdout.write(JSON.stringify([encoded, createHash('sha256').update(encoded, 'utf8').digest('hex')]));`;
    const output = execFileSync(process.execPath, ['--input-type=module', '-e', script], { encoding: 'utf8' });
    expect(JSON.parse(output)).toEqual([local, fingerprint(local, digest)]);
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
    const value: IObservation = { operation: 'value', address, fact: true };
    const own: IObservation = { operation: 'own', address, fact: true };
    expect(fingerprint(encodeObservation(value), digest)).not.toBe(fingerprint(encodeObservation(own), digest));
    expect(encodeObservation(value)).not.toBe(encodeObservation({ ...value, address: [{ kind: 'property', key: 'x' }, { kind: 'property', key: 'y' }] }));
  });

  test('observation schema rejects malformed operation facts and addresses', () => {
    expect(() => encodeObservation({ operation: 'own', address: [{ kind: 'property', key: 'x' }], fact: 1 })).toThrow();
    expect(() => encodeObservation({ operation: 'length', address: [], fact: -1 })).toThrow();
    expect(() => encodeObservation({ operation: 'value', address: [{ kind: 'index', index: -1 }], fact: 'x' })).toThrow();
  });

  test('decoded snapshots cannot mutate retained record or array content', () => {
    const decoded = decodeValue(encodeValue({ child: [1, { name: 'Ada' }] }));
    expect(Object.isFrozen(decoded)).toBe(true);
    const child = observe(decoded, [{ kind: 'property', key: 'child' }], 'value').fact;
    expect(Object.isFrozen(child)).toBe(true);
    expect(encodeValue(decoded)).toBe(encodeValue({ child: [1, { name: 'Ada' }] }));
  });
});
