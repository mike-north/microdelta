/**
 * Timer conformance for the Node Machine adapter. A scheduled callback runs
 * at most once, never synchronously, and only once the capability's own clock
 * reads at or after the requested whole-millisecond UTC epoch time: an early
 * host wake-up or a clock moved backwards re-arms instead of firing, and
 * waits beyond Node's 32-bit timer range are split rather than fired early.
 * A timer scheduled without keep-alive never holds a process open on its own.
 *
 * Timing cases run under Jest's modern fake timers, which drive both
 * `setTimeout` and `Date.now`, so no assertion depends on real elapsed time.
 * The keep-alive cases run a real child process, because only a real event
 * loop can show whether a pending timer holds it open.
 *
 * @see https://nodejs.org/api/timers.html#settimeoutcallback-delay-args
 * @see https://nodejs.org/api/timers.html#timeoutunref
 * @see https://tc39.es/ecma262/#sec-time-values-and-time-range
 */
import { spawnSync } from 'node:child_process';

import { afterEach, beforeEach, describe, expect, jest, test } from '@jest/globals';

import { createNodeTimer } from '../src/index.js';
import { _createNodeTimerImplementation } from '../src/node/timer.js';

/** A fixed epoch origin for every fake-clock case: 2026-01-01T00:00:00Z. */
const T0 = Date.UTC(2026, 0, 1);

/** The built adapter entry the child processes import. */
const entry = new URL('../src/index.js', import.meta.url).href;

beforeEach(() => {
  jest.useFakeTimers({ now: T0 });
});

afterEach(() => {
  jest.useRealTimers();
});

describe('Node timer capability conformance', () => {
  test('its clock is the wall clock in whole epoch milliseconds', () => {
    expect(createNodeTimer().currentEpochMilliseconds()).toBe(T0);
  });

  test('a callback runs once when the clock reaches the requested time, and not before', () => {
    const calls: number[] = [];
    createNodeTimer().schedule(T0 + 1_000, () => calls.push(Date.now()));
    jest.advanceTimersByTime(999);
    expect(calls).toEqual([]);
    jest.advanceTimersByTime(1);
    expect(calls).toEqual([T0 + 1_000]);
    jest.advanceTimersByTime(10_000);
    expect(calls).toEqual([T0 + 1_000]);
  });

  test('a time already reached fires asynchronously, never inside schedule', () => {
    const calls: string[] = [];
    createNodeTimer().schedule(T0 - 5_000, () => calls.push('fired'));
    expect(calls).toEqual([]);
    jest.advanceTimersByTime(0);
    expect(calls).toEqual(['fired']);
  });

  test('cancelling prevents the call; cancelling twice or after the call does nothing', () => {
    const timer = createNodeTimer();
    const calls: string[] = [];
    const cancel = timer.schedule(T0 + 100, () => calls.push('cancelled one'));
    cancel();
    cancel();
    const later = timer.schedule(T0 + 200, () => calls.push('kept'));
    jest.advanceTimersByTime(1_000);
    later();
    expect(calls).toEqual(['kept']);
  });

  test('a clock moved backwards before the wake-up re-arms instead of firing early', () => {
    const calls: number[] = [];
    createNodeTimer().schedule(T0 + 1_000, () => calls.push(Date.now()));
    // The host clock jumps back 500 ms; the host timer still wakes 1000 ms after scheduling.
    jest.setSystemTime(T0 - 500);
    jest.advanceTimersByTime(1_000);
    expect(Date.now()).toBe(T0 + 500);
    expect(calls).toEqual([]);
    jest.advanceTimersByTime(499);
    expect(calls).toEqual([]);
    jest.advanceTimersByTime(1);
    expect(calls).toEqual([T0 + 1_000]);
  });

  test('a wait longer than the host timer range is split and fires on time', () => {
    // A 1-second host range stands in for Node's 2^31 - 1 ms limit.
    const timer = _createNodeTimerImplementation({ maximumDelayMilliseconds: 1_000 });
    const calls: number[] = [];
    timer.schedule(T0 + 2_500, () => calls.push(Date.now()));
    jest.advanceTimersByTime(2_499);
    expect(calls).toEqual([]);
    jest.advanceTimersByTime(1);
    expect(calls).toEqual([T0 + 2_500]);
  });

  test('a thirty-day wait fires at thirty days, not at Node\'s overflow fallback of one millisecond', () => {
    const thirtyDays = 30 * 24 * 60 * 60 * 1_000;
    const calls: number[] = [];
    createNodeTimer().schedule(T0 + thirtyDays, () => calls.push(Date.now()));
    jest.advanceTimersByTime(thirtyDays - 1);
    expect(calls).toEqual([]);
    jest.advanceTimersByTime(1);
    expect(calls).toEqual([T0 + thirtyDays]);
  });

  test.each([
    ['NaN', Number.NaN],
    ['infinity', Number.POSITIVE_INFINITY],
    ['a fractional millisecond', T0 + 0.5],
    ['an unsafe integer', 2 ** 53],
  ])('a requested time of %s is refused', (_label, time) => {
    expect(() => createNodeTimer().schedule(time, () => undefined)).toThrow(RangeError);
  });
});

describe('Node timer keep-alive (real child processes)', () => {
  /** Run a child that imports the built adapter and runs `script`; returns its exit and output. */
  function child(script: string): { readonly status: number | null; readonly stdout: string; readonly elapsed: number } {
    jest.useRealTimers();
    const started = Date.now();
    const spawned = spawnSync(process.execPath, ['--input-type=module', '-e', `const { createNodeTimer } = await import(${JSON.stringify(entry)});\n${script}`], { encoding: 'utf8', timeout: 20_000 });
    return { status: spawned.status, stdout: spawned.stdout, elapsed: Date.now() - started };
  }

  test('a timer without keep-alive never holds the process open by itself', () => {
    const run = child('createNodeTimer().schedule(Date.now() + 60_000, () => console.log("fired"), { keepAlive: false }); console.log("scheduled");');
    expect(run.status).toBe(0);
    expect(run.stdout.trim()).toBe('scheduled');
    // Far less than the 60-second wait: the pending timer did not keep the child alive.
    expect(run.elapsed).toBeLessThan(15_000);
  });

  test('a timer with the default keep-alive holds the process open until it fires', () => {
    const run = child('createNodeTimer().schedule(Date.now() + 200, () => console.log("fired")); console.log("scheduled");');
    expect(run.status).toBe(0);
    expect(run.stdout.trim().split('\n')).toEqual(['scheduled', 'fired']);
  });
});
