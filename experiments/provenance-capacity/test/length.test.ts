/** Outcome controls for exact MDS1 sizing, deliberately separate from the production codec. */
import { describe, expect, test } from '@jest/globals';
import { encodeSnapshot } from '@microdelta/value';
import { digitSum, exactAdd, snapshotLengths } from '../src/length.js';

/** Compare tiny generated canonical transport in both JavaScript and byte units. */
function compare(value: unknown): void {
  const canonical = encodeSnapshot(value);
  expect(snapshotLengths(value)).toEqual({ utf16: canonical.length, utf8: Buffer.byteLength(canonical) });
}

describe('restricted provenance canonical length', () => {
  test.each([{}, [], { z: ['ASCII', 1, -0], a: {} }, 'quote" slash\\ newline\n', 'é', '😀', '\ud800', '\u0000\b\t\r\f'])('matches actual generated codec for %p', compare);
  test('preserves own order and distinguishes ordinary/null prototype markers', () => {
    const bare: object = Object.create(null) as object;
    Object.defineProperty(bare, 'b', { value: 'é', enumerable: true });
    compare(bare);
    compare({ z: 2, a: 1 });
    expect(snapshotLengths(bare).utf16).not.toBe(snapshotLengths({ b: 'é' }).utf16);
  });
  test.each([9, 10, 99, 100, 999, 1000, 9999, 10000, 99999, 100000])('counts width boundary %i without allocating a population', (n) => {
    compare({ index: n, key: `acme/widget#${String(n)}` });
    expect(digitSum(n, n)).toBe(String(n).length);
    expect(digitSum(n - 1, n)).toBe(String(n - 1).length + String(n).length);
  });
  test('sums index/ordinal groups and rejects unsafe arithmetic', () => {
    expect(digitSum(0, 12)).toBe(16);
    expect(digitSum(1, 150000)).toBe(788895);
    expect(() => exactAdd(Number.MAX_SAFE_INTEGER, 1)).toThrow();
    expect(() => digitSum(-1, 12)).toThrow();
    expect(() => digitSum(2, 1)).toThrow();
  });
  test('UTF8-as-UTF16 and omitted repeated address contributions fail controls', () => {
    const unicode = snapshotLengths({ text: 'é😀' });
    expect(unicode.utf8).not.toBe(unicode.utf16);
    const repeated = { address: ['rows', 10], selection: { address: ['rows', 10] } };
    expect(snapshotLengths(repeated).utf16).not.toBe(snapshotLengths({ address: ['rows', 10], selection: {} }).utf16);
  });
  test.each([undefined, null, true, 1.5, Number.NaN, Number.POSITIVE_INFINITY, Number.MAX_SAFE_INTEGER + 1, 1n, () => 1, new Date(), new Array<unknown>(2), Object.assign([], { extra: 1 })])('rejects unsupported helper input %p', (value) => {
    expect(() => snapshotLengths(value)).toThrow();
  });
  test('rejects accessors, nonenumerables, symbols, cycles and shared references', () => {
    const shared = {};
    const cycle: { self?: unknown } = {}; cycle.self = cycle;
    for (const value of [Object.defineProperty({}, 'x', { get: () => 1, enumerable: true }), Object.defineProperty({}, 'x', { value: 1 }), { [Symbol('x')]: 1 }, cycle, [shared, shared]]) {
      expect(() => snapshotLengths(value)).toThrow();
    }
  });
});
