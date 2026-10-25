/**
 * Elapsed-clock conformance is independent of wall time: readings are safe,
 * whole, nondecreasing process-local milliseconds and have no epoch meaning.
 * @packageDocumentation
 */
import { afterEach, describe, expect, jest, test } from '@jest/globals';
import { performance } from 'node:perf_hooks';

import type { IElapsedClockCapability } from '@microdelta/machine';
import { createNodeElapsedClock } from '../src/index.js';

/** Assert the output invariant expected of any host elapsed-clock capability. */
function expectValidElapsedReadings(clock: IElapsedClockCapability): void {
  let previous = -1;
  for (let sample = 0; sample < 3; sample += 1) {
    const current = clock.currentElapsedMilliseconds();
    expect(Number.isSafeInteger(current)).toBe(true);
    expect(current).toBeGreaterThanOrEqual(0);
    expect(current).toBeGreaterThanOrEqual(previous);
    previous = current;
  }
}

/** A deliberately controlled source makes invalid host conformance observable. */
function controlledElapsedClock(readings: readonly number[]): IElapsedClockCapability {
  let index = 0;
  return {
    currentElapsedMilliseconds(): number {
      const reading = readings[index];
      if (reading === undefined) {
        throw new Error('Controlled elapsed clock exhausted its readings');
      }
      index += 1;
      return reading;
    },
  };
}

describe('Node elapsed clock capability conformance', () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  test('Node supplies supported, whole, nondecreasing process-local milliseconds', () => {
    expectValidElapsedReadings(createNodeElapsedClock());
  });

  test('all handles in one process share the same elapsed-time origin', async () => {
    const first = createNodeElapsedClock();
    await new Promise<void>((resolve) => setTimeout(resolve, 2));
    const firstReading = first.currentElapsedMilliseconds();
    const secondReading = createNodeElapsedClock().currentElapsedMilliseconds();

    expect(secondReading).toBeGreaterThanOrEqual(firstReading);
  });

  test('staggered handles read directly from the same Node process time origin', () => {
    let hostNow = 10_000;
    jest.spyOn(performance, 'now').mockImplementation(() => hostNow);
    const first = createNodeElapsedClock();
    hostNow = 10_025;
    const firstReading = first.currentElapsedMilliseconds();
    const second = createNodeElapsedClock();
    const secondReading = second.currentElapsedMilliseconds();

    expect(firstReading).toBe(10_025);
    expect(secondReading).toBe(10_025);
  });

  test.each([
    ['non-finite', [0, Number.NaN, 2]],
    ['fractional', [0, 1.5, 2]],
    ['unsafe', [0, 2 ** 53, 2]],
    ['decreasing', [2, 1, 3]],
  ] as const)('conformance rejects %s host readings', (_label, readings) => {
    expect(() => expectValidElapsedReadings(controlledElapsedClock(readings))).toThrow();
  });

  test('epoch corrections do not alter an independent elapsed-time source', () => {
    let epoch = 10_000;
    let elapsed = 0;
    const clock = {
      currentEpochMilliseconds: (): number => epoch,
      currentElapsedMilliseconds: (): number => elapsed,
    };

    expect(clock.currentElapsedMilliseconds()).toBe(0);
    epoch = 2_000;
    elapsed = 1;
    expect(clock.currentEpochMilliseconds()).toBe(2_000);
    expect(clock.currentElapsedMilliseconds()).toBe(1);
    epoch = 50_000;
    elapsed = 2;
    expect(clock.currentEpochMilliseconds()).toBe(50_000);
    expect(clock.currentElapsedMilliseconds()).toBe(2);
  });
});
