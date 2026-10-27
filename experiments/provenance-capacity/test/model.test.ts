/** Parametric totals must recover tiny generated transports before extrapolation. */
import { expect, test } from '@jest/globals';
import { encodeSnapshot } from '@microdelta/value';
import { coldProvenance } from '../src/guards.js';
import { canonicalModel } from '../src/model.js';

test('independent digit-width model matches tiny actual codec at all permitted shape sizes', () => {
  for (const n of [1, 2, 8, 32, 100]) {
    expect(canonicalModel(n)).toBe(encodeSnapshot(coldProvenance(n, 'a'.repeat(64))).length);
  }
  expect(() => canonicalModel(0)).toThrow();
  expect(() => canonicalModel(Number.MAX_SAFE_INTEGER)).toThrow();
});

test('matches the three retained ASCII scalar measurements without loading their cells', () => {
  for (const [n, observations, characters] of [[12, 51, 46575], [1000, 4003, 3733553], [10000, 40003, 37456556]]) {
    if (n === undefined || observations === undefined || characters === undefined) { throw new Error('measurement fixture'); }
    expect(4 * n + 3).toBe(observations);
    expect(canonicalModel(n)).toBe(characters);
  }
  // This is arithmetic over the proven source shape, not an observed full-size cell.
  expect(canonicalModel(150000)).toBe(564696559);
});
