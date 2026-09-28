/**
 * Clock conformance for the Node Machine adapter. A reading is one host
 * observation in integer UTC epoch milliseconds. The capability does not smooth,
 * clamp or order readings: backward/forward movement and lease eligibility are
 * History policy, so the adapter must pass such observations through unchanged
 * while refusing values outside the stated domain.
 *
 * @see https://tc39.es/ecma262/#sec-time-values-and-time-range
 * @see https://tc39.es/ecma262/#sec-date.now
 */
import { afterEach, describe, expect, jest, test } from '@jest/globals';

import { createNodeClock } from '../src/index.js';

afterEach(() => {
  jest.restoreAllMocks();
});

describe('Node clock capability conformance', () => {
  test('a reading is a safe integer of UTC epoch milliseconds bracketed by independent host readings', () => {
    const clock = createNodeClock();
    const before = new Date().getTime();
    const reading = clock.currentEpochMilliseconds();
    const after = new Date().getTime();

    expect(Number.isSafeInteger(reading)).toBe(true);
    expect(reading).toBeGreaterThanOrEqual(before);
    expect(reading).toBeLessThanOrEqual(after);
  });

  test('host observations moving backwards are reported unchanged rather than corrected', () => {
    const clock = createNodeClock();
    jest.spyOn(Date, 'now').mockReturnValueOnce(2_000).mockReturnValueOnce(1_000);

    expect([clock.currentEpochMilliseconds(), clock.currentEpochMilliseconds()]).toEqual([2_000, 1_000]);
  });

  test.each([
    ['NaN', Number.NaN],
    ['infinity', Number.POSITIVE_INFINITY],
    ['a fractional millisecond', 1.5],
    ['an unsafe integer', 2 ** 53],
    ['a negative unsafe integer', -(2 ** 53)],
  ])('a host reading of %s is refused instead of returned', (_label, hostReading) => {
    const clock = createNodeClock();
    jest.spyOn(Date, 'now').mockReturnValue(hostReading);

    expect(() => clock.currentEpochMilliseconds()).toThrow(RangeError);
  });
});
