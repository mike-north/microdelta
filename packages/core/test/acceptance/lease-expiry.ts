/**
 * Waiting out a killed writer's recorded lease in the acceptance suites. A
 * process killed at a History commit boundary leaves its writer row behind;
 * a later normal request can take the writer only once History treats that
 * stored lease as expired. This module blocks the parent until then, reading
 * the stored row only (it never acquires, renews or releases the writer), and
 * fails with the evidence it has rather than waiting without bound.
 *
 * History evaluates "now" as the larger of the host clock reading and its
 * persisted time high-water, and a lease is expired once that "now" reaches
 * the stored `expiresAt`. The parent and every worker read the same host
 * clock, so once the parent's reading passes the stored expiry, any later
 * History reading does too, unless the host clock steps backward.
 *
 * The clock and sleep are passed in so the wait's bound can be exercised
 * with simulated clocks; the suites use {@link hostWaitClock}.
 */
import type { IWriterLease } from '@microdelta/history';

/** The time sources and blocking sleep one wait uses. */
export interface IWaitClock {
  /** Host wall-clock epoch milliseconds: the clock History's lease expiry is measured against. */
  wallNow(): number;
  /** A monotonic reading in milliseconds, unaffected by wall-clock steps; only differences are meaningful. */
  monotonicNow(): number;
  /** Block the calling thread for about `milliseconds`. */
  sleep(milliseconds: number): void;
}

/** A shared cell used only as a blocking-wait target; nothing ever notifies it. */
const sleeper = new Int32Array(new SharedArrayBuffer(4));

/** The real host: `Date.now`, `performance.now` and a synchronous thread block. */
export const hostWaitClock: IWaitClock = Object.freeze({
  wallNow: () => Date.now(),
  monotonicNow: () => performance.now(),
  sleep: (milliseconds: number) => {
    Atomics.wait(sleeper, 0, 0, milliseconds);
  },
});

/** Bounds of one wait. */
export interface IExpiryWaitLimits {
  /** How far past the stored expiry the wait ends, so it never ends on the expiry millisecond itself. */
  readonly marginMilliseconds: number;
  /** The most the wait may take; also the furthest ahead a stored expiry (plus margin) may lie. */
  readonly budgetMilliseconds: number;
}

/** A writer lease as a diagnostic names it. */
function describeLease(lease: IWriterLease): string {
  return `${lease.holder}/${String(lease.fence)} expiring at ${String(lease.expiresAt)}`;
}

/**
 * Block until the host clock is past the recorded writer lease's expiry plus
 * a margin. Fails, naming the stored holder, its expiry and the host time,
 * when no holder is recorded, when the stored expiry lies further ahead than
 * the budget allows (it is not the lease the caller expects), when the
 * budget is spent on the monotonic clock before the wall clock reaches the
 * expiry (the host clock moved backward), or when the recorded holder
 * changes while waiting.
 * @param read - Reads the recorded writer lease without taking the writer.
 * @param limits - Margin and budget of this wait.
 * @param clock - Time sources and sleep; the host's by default.
 */
export function outlastStoredLease(read: () => IWriterLease | undefined, limits: IExpiryWaitLimits, clock: IWaitClock = hostWaitClock): void {
  const stored = read();
  if (stored === undefined) {
    throw new Error(`no writer holder is recorded at host time ${String(clock.wallNow())}; a killed run's lease was expected`);
  }
  const deadline = stored.expiresAt + limits.marginMilliseconds;
  const now = clock.wallNow();
  if (deadline - now > limits.budgetMilliseconds) {
    throw new Error(`stored writer ${describeLease(stored)} lies ${String(stored.expiresAt - now)} ms after host time ${String(now)}: beyond the ${String(limits.budgetMilliseconds)} ms wait budget`);
  }
  // Wall-clock progress alone cannot bound the wait: a backward step moves the
  // deadline further away. The monotonic budget bounds it regardless.
  const started = clock.monotonicNow();
  for (let remaining = deadline - clock.wallNow(); remaining > 0; remaining = deadline - clock.wallNow()) {
    const elapsed = clock.monotonicNow() - started;
    if (elapsed >= limits.budgetMilliseconds) {
      throw new Error(`stored writer ${describeLease(stored)} had not expired at host time ${String(clock.wallNow())} after ${String(Math.round(elapsed))} ms of the ${String(limits.budgetMilliseconds)} ms wait budget (monotonic)`);
    }
    clock.sleep(Math.min(remaining, limits.budgetMilliseconds - elapsed));
  }
  const after = read();
  if (after?.holder !== stored.holder || after.fence !== stored.fence || after.expiresAt !== stored.expiresAt) {
    throw new Error(`the stored writer changed while waiting for ${describeLease(stored)}: now ${JSON.stringify(after)} at host time ${String(clock.wallNow())}`);
  }
}
