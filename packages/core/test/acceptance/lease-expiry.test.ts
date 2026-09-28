/**
 * The acceptance suites' wait for a killed writer's stored lease to expire
 * (`lease-expiry.ts`), exercised with simulated clocks so its bound can be
 * shown without changing the host clock. The wait ends once the host wall
 * clock passes the stored expiry plus a margin, as History's expiry rule
 * requires; independently of wall-clock progress, its total duration is
 * bounded by a monotonic budget, so a host clock that steps backward cannot
 * keep it waiting. Every failure names the stored holder, its expiry and the
 * host time.
 *
 * @see ../../../../docs/plans/m3-contribution-analysis.md (History, host operations and durable records)
 */
import { describe, expect, test } from '@jest/globals';
import type { IWriterLease } from '@microdelta/history';

import { outlastStoredLease } from './lease-expiry.js';
import type { IWaitClock } from './lease-expiry.js';

/** The recorded lease of a killed holder, expiring at wall time 10 000. */
const killed: IWriterLease = Object.freeze({ holder: 'microdelta-run:killed', fence: 7, expiresAt: 10_000 });

/** A wait budget of one 2 s lease plus the 50 ms margin, as the crash suite uses. */
const limits = { marginMilliseconds: 50, budgetMilliseconds: 2_050 } as const;

/**
 * A simulated host. Sleeping advances the monotonic clock by the requested
 * time and the wall clock by that time plus `wallStepPerSleep` (negative for
 * a clock stepped backward during each sleep). A simulated run that has spent
 * far beyond any budget stops with a distinct escape error, so a wait that
 * never ends on its own cannot hang the test.
 */
function simulatedHost(options: { readonly wallStart: number; readonly wallStepPerSleep: number }): IWaitClock & { readonly slept: () => number } {
  let wall = options.wallStart;
  let monotonic = 0;
  const escapeAfter = 100 * limits.budgetMilliseconds;
  return {
    wallNow: () => wall,
    monotonicNow: () => monotonic,
    sleep: (milliseconds: number) => {
      if (monotonic > escapeAfter) {
        throw new Error(`simulation escape: still waiting after ${String(monotonic)} simulated ms`);
      }
      monotonic += milliseconds;
      wall += milliseconds + options.wallStepPerSleep;
    },
    slept: () => monotonic,
  };
}

/** The message of the error `attempt` must throw. */
function failure(attempt: () => void): string {
  let thrown: unknown;
  try {
    attempt();
  } catch (error: unknown) {
    thrown = error;
  }
  expect(thrown).toBeInstanceOf(Error);
  return thrown instanceof Error ? thrown.message : '';
}

describe('waiting out a killed writer\'s stored lease', () => {
  test('ends once the wall clock is past the stored expiry plus the margin, re-reading the unchanged holder', () => {
    const host = simulatedHost({ wallStart: 8_500, wallStepPerSleep: 0 });
    let reads = 0;
    outlastStoredLease(() => {
      reads += 1;
      return killed;
    }, limits, host);
    expect(host.wallNow()).toBeGreaterThanOrEqual(killed.expiresAt + limits.marginMilliseconds);
    expect(host.slept()).toBe(killed.expiresAt + limits.marginMilliseconds - 8_500);
    expect(reads).toBe(2);
  });

  test('does not wait when the stored expiry has already passed', () => {
    const host = simulatedHost({ wallStart: 20_000, wallStepPerSleep: 0 });
    outlastStoredLease(() => killed, limits, host);
    expect(host.slept()).toBe(0);
  });

  test('stops within its monotonic budget when the wall clock keeps stepping backward, naming holder, expiry, host time and elapsed budget', () => {
    const host = simulatedHost({ wallStart: 8_500, wallStepPerSleep: -2_000 });
    const message = failure(() => {
      outlastStoredLease(() => killed, limits, host);
    });
    expect(message).toMatch(/microdelta-run:killed\/7 expiring at 10000/u);
    expect(message).toMatch(/host time -?\d+/u);
    expect(message).toMatch(/after \d+ ms of the 2050 ms wait budget/u);
    expect(host.slept()).toBeLessThanOrEqual(limits.budgetMilliseconds);
  });

  test('fails at once when the stored expiry lies beyond the budget', () => {
    const host = simulatedHost({ wallStart: 1_000, wallStepPerSleep: 0 });
    const message = failure(() => {
      outlastStoredLease(() => killed, limits, host);
    });
    expect(message).toMatch(/microdelta-run:killed\/7 expiring at 10000 lies 9000 ms after host time 1000/u);
    expect(host.slept()).toBe(0);
  });

  test('fails when no writer holder is recorded', () => {
    const message = failure(() => {
      outlastStoredLease(() => undefined, limits, simulatedHost({ wallStart: 8_500, wallStepPerSleep: 0 }));
    });
    expect(message).toMatch(/no writer holder is recorded at host time 8500/u);
  });

  test('fails when the recorded holder changes while waiting', () => {
    let reads = 0;
    const message = failure(() => {
      outlastStoredLease(() => {
        reads += 1;
        return reads === 1 ? killed : { holder: 'microdelta-run:other', fence: 8, expiresAt: 12_000 };
      }, limits, simulatedHost({ wallStart: 9_000, wallStepPerSleep: 0 }));
    });
    expect(message).toMatch(/the stored writer changed while waiting for microdelta-run:killed\/7 expiring at 10000/u);
    expect(message).toMatch(/microdelta-run:other/u);
  });
});
