/** Independent tuple/component outcomes precede assembly accounting implementation. */
import { expect, test } from '@jest/globals';
import { encodeSnapshot } from '@microdelta/value';
import { coldProvenance } from '../src/guards.js';
import { snapshotLengths } from '../src/length.js';
import { expectedColdTuple, isolatedRow, measureActualTuple, tupleCapacity, tupleLedger, tupleModel } from '../src/tuple-accounting.js';

/** A fixture digest with no private database meaning. */
const digest = 'a'.repeat(64);

test('literal Value grammar includes empty/present/number/-0 and Unicode widths', () => {
  for (const [value, literal] of [
    [[], 'MDS1|["a",[]]'], [[''], 'MDS1|["a",[["s",""]]]'], [[0, 'x'], 'MDS1|["a",[["d","0"],["s","x"]]]'],
    [[1, 0], 'MDS1|["a",[["d","1"],["d","0"]]]'], [[1, -0], 'MDS1|["a",[["d","1"],["d","-0"]]]'],
  ] as const) {
    expect(encodeSnapshot(value)).toBe(literal);
    expect(snapshotLengths(value)).toEqual({ utf16: literal.length, utf8: Buffer.byteLength(literal) });
  }
  for (const value of [['é'], ['😀'], ['\ud800'], ['\u0000"\\']]) {
    const text = encodeSnapshot(value);
    expect(snapshotLengths(value)).toEqual({ utf16: text.length, utf8: Buffer.byteLength(text) });
  }
});

test('literal cold tuple keeps eight slots and independent selected address', () => {
  const root = expectedColdTuple(1, digest);
  if (typeof root !== 'object' || root === null || !('observations' in root) || !Array.isArray(root.observations)) { throw new Error('expected root'); }
  expect(Object.keys(root)).toEqual(['trackingSemantics', 'semanticVersion', 'kind', 'step', 'observations', 'children']);
  expect(root.observations[1]).toEqual([['inputs'], [[0, 'rows']], [0, 5, [[0, 'rows']]], 0, 'container-kind', 'MDO1', [expect.stringContaining('container-kind')], expect.stringMatching(/^[0-9a-f]{64}$/u)]);
  expect(root.observations).toHaveLength(7);
  expect(() => expectedColdTuple(101, digest)).toThrow();
});

test('component ledger predicts complete tiny transports without fitting population differences', () => {
  const ledger = tupleLedger();
  expect(ledger.prefix).toHaveLength(3); expect(ledger.rows).toHaveLength(4);
  expect(ledger.rowScaffold).toBe(ledger.rows.reduce((sum, units) => sum + units, 0) + 4 - 14);
  expect(ledger.fixedScaffold).toBe(ledger.root + ledger.prefix.reduce((sum, units) => sum + units, 0) + 2 - 1);
  for (const n of [1, 2, 8, 12, 32, 100]) {
    const actual = expectedColdTuple(n, digest); const encoded = encodeSnapshot(actual);
    expect(measureActualTuple(actual, n, digest)).toEqual({ utf16: encoded.length, utf8: Buffer.byteLength(encoded), canonicalSha256: expect.stringMatching(/^[a-f0-9]{64}$/u) });
    expect(tupleModel(n)).toBe(encoded.length); expect(encoded.length).toBeLessThan(1048576);
  }
  for (const n of [0, -1, 1.5, Number.MAX_SAFE_INTEGER]) { expect(() => tupleModel(n)).toThrow(); }
});

test('omission/address/order/operation changes cannot replace actual output; capacity is strict', () => {
  const valid = expectedColdTuple(2, digest);
  const text = JSON.stringify(valid);
  for (const mode of ['omit', 'order', 'operation', 'address']) {
    const parsed: unknown = JSON.parse(text);
    if (typeof parsed !== 'object' || parsed === null || !('observations' in parsed) || !Array.isArray(parsed.observations)) { throw new Error('test root'); }
    const observations = parsed.observations;
    if (mode === 'omit') { observations.splice(1, 1); }
    else if (mode === 'order') { const first: unknown = observations[1]; const second: unknown = observations[2]; observations[1] = second; observations[2] = first; }
    else if (Array.isArray(observations[1])) {
      if (mode === 'operation') { observations[1][4] = 'value'; }
      else if (Array.isArray(observations[1][2])) { observations[1][2][2] = []; }
    }
    expect(() => measureActualTuple(parsed, 2, digest)).toThrow();
  }
  expect(() => measureActualTuple(coldProvenance(2, digest), 2, digest)).toThrow();
  expect(() => tupleCapacity(150000, tupleModel(150000))).toThrow();
  const capacity = tupleCapacity(150000, tupleModel(150000) + 1);
  expect(capacity.canonicalMargin).toBe(1); expect(capacity.bodyMargin).toBe(6); expect(capacity.canonical - capacity.body).toBe(5);
});

test('individual rows cross all decimal boundaries without constructing those populations', () => {
  for (const index of [8, 9, 10, 98, 99, 100, 998, 999, 1000, 9998, 9999, 10000, 99998, 99999, 100000]) {
    const row = isolatedRow(index);
    const canonical = encodeSnapshot(row);
    expect(row).toHaveLength(4);
    expect(snapshotLengths(row)).toEqual({ utf16: canonical.length, utf8: Buffer.byteLength(canonical) });
    // Four bodies plus three commas are wrapped in an eight-unit array body
    // and five-unit prefix. Ledger rowScaffold includes four commas instead.
    const predicted = tupleLedger().rowScaffold + 12 * String(index).length + 2 * String(index + 1).length + 12;
    expect(canonical.length).toBe(predicted);
    expect(canonical.length).not.toBe(predicted - String(index).length);
  }
  for (const index of [-1, 1.5, Number.MAX_SAFE_INTEGER]) { expect(() => isolatedRow(index)).toThrow(); }
});
