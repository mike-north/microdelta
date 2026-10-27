/** Row and retained-observation guards must reject evidence substitution, not merely count it. */
import { expect, test } from '@jest/globals';
import { coldProvenance, validateColdProvenance, validateScalarRows } from '../src/guards.js';

/** A scalar-only fixture models an exactly pinned cold locator, never a later current row. */
const row = { result: 7, subject: 'listing', version: 1, publication: 7, format: 'microdelta.resolution.provenance', formatVersion: 1, prefix: 'MDS1|', characters: 100, bytes: 100, observations: 51 };
test('requires exactly one pinned scalar row and a measured cap before cell return', () => {
  expect(validateScalarRows([row], 7, 12)).toEqual(row);
  for (const rows of [[], [row, row], [{ ...row, result: 8 }], [{ ...row, subject: 'other' }], [{ ...row, version: 2 }], [{ ...row, format: 'other' }], [{ ...row, formatVersion: 2 }], [{ ...row, observations: 50 }], [{ ...row, bytes: 101 }]]) {
    expect(() => validateScalarRows(rows, 7, 12)).toThrow();
  }
  expect(() => validateScalarRows([{ ...row, cell: 'x'.repeat(1025) }], 7, 12, 1024)).toThrow();
});
test('requires every ordered binding/address/selection/operation/encoded fact and fingerprint', () => {
  const value = coldProvenance(2, 'a'.repeat(64));
  expect(() => validateColdProvenance(value, 2)).not.toThrow();
  expect(() => validateColdProvenance({ ...value, observations: value.observations.slice(1) }, 2)).toThrow();
  const altered = value.observations.map((observation, index) => index === 4 ? { ...observation, selection: { ...observation.selection, address: [] } } : observation);
  expect(() => validateColdProvenance({ ...value, observations: altered }, 2)).toThrow();
  expect(() => validateColdProvenance({ ...value, observations: [...value.observations].reverse() }, 2)).toThrow();
});
