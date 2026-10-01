/**
 * Waiting for storage's single-writer lease: Run Supervision's side of the
 * owner's 2026-09-30 concurrency decision (RUN-002, PUB-005, A-09).
 *
 * One fenced writer exists per store. A normal request that finds the lease
 * held by another process does not fail at once: it waits, polling the
 * writer port on the injected timer, until it holds the lease, a stop ends
 * the wait, or the operator's deadline passes, when it fails with the typed
 * {@link WriterBusyError} naming the holder. There is no default deadline.
 *
 * Responsibilities are split deliberately. This module owns only *when* to
 * try again and when to give up. Whether a try succeeds, and whether an
 * expired lease may be taken over (always with a fresh fence), stays History's
 * lease authority behind the writer port: a waiter that polls changes no
 * authority or data, and never treats an observation as permission.
 */
import type { IRunLease, IRunWriter, IWriterAttempt, IWriterWaitOptions } from './contracts.js';
import type { IAbortSignal, IRunTimer } from './control.js';
import { SupervisionError, WriterBusyError } from './errors.js';
import type { IWriterBusyObservation } from './errors.js';

/**
 * The poll interval when the operator gives none: one second. A poll is one
 * short IMMEDIATE storage transaction that persists at most the clock
 * high-water, so this costs the holder almost nothing, while a holder that
 * releases early is noticed within a second. A holder that dies is noticed
 * sooner still: a waiter also wakes exactly at the observed expiry.
 */
export const defaultWriterPollMilliseconds = 1_000;

/** A run's validated waiting policy. */
export interface IWriterWaitPolicy {
  /** The operator deadline, or undefined for none (no default). */
  readonly deadline: number | undefined;
  /** The positive poll interval in milliseconds. */
  readonly pollMilliseconds: number;
}

/**
 * Validate a run's writer-wait options once, when the run starts, so a
 * malformed deadline or interval is refused before any work.
 * @param options - The operator's options, if any.
 * @returns The validated policy.
 */
export function writerWaitPolicy(options: IWriterWaitOptions | undefined): IWriterWaitPolicy {
  if (options === undefined) {
    return Object.freeze({ deadline: undefined, pollMilliseconds: defaultWriterPollMilliseconds });
  }
  if (typeof options !== 'object' || options === null) {
    throw new SupervisionError('invalid-request', 'A run\'s writer wait must be an object');
  }
  const deadline: unknown = Reflect.get(options, 'deadline');
  const poll: unknown = Reflect.get(options, 'pollMilliseconds');
  if (deadline !== undefined && (typeof deadline !== 'number' || !Number.isSafeInteger(deadline) || deadline < 0)) {
    throw new SupervisionError('invalid-request', 'A writer wait deadline is a whole nonnegative epoch millisecond time');
  }
  if (poll !== undefined && (typeof poll !== 'number' || !Number.isSafeInteger(poll) || poll <= 0)) {
    throw new SupervisionError('invalid-request', 'A writer wait poll interval is a positive safe integer of milliseconds');
  }
  return Object.freeze({ deadline, pollMilliseconds: poll ?? defaultWriterPollMilliseconds });
}

/** What one wait for the writer lease needs from its run. */
export interface IWriterWait {
  /** The run's writer port. */
  readonly writer: IRunWriter;
  /** The run's validated policy. */
  readonly policy: IWriterWaitPolicy;
  /** Supervision's injected timer; a wait cannot happen without it. */
  readonly timer: IRunTimer | undefined;
  /** Aborts when any stop takes effect for the run. */
  readonly stop: IAbortSignal;
  /** The run, named in diagnostics. */
  readonly runId: string;
}

/**
 * When to try again after a non-granting attempt at `now`: one poll interval
 * later, or sooner at the observed holder's expiry (an expired lease can be
 * taken over at once) or at the deadline (for the final attempt). Only times
 * strictly after `now` are candidates, so a holder whose recorded expiry this
 * timer already reads as past (History measures against its persisted
 * high-water) can never cause an immediate re-poll: the waiter never spins.
 */
function nextAttemptAt(now: number, attempt: IWriterBusyObservation, policy: IWriterWaitPolicy): number {
  let next = Math.min(now + policy.pollMilliseconds, Number.MAX_SAFE_INTEGER);
  if (attempt.expiresAt !== undefined && attempt.expiresAt > now) {
    next = Math.min(next, attempt.expiresAt);
  }
  if (policy.deadline !== undefined && policy.deadline > now) {
    next = Math.min(next, policy.deadline);
  }
  return next;
}

/**
 * Sleep on the timer until `at`, or until `stop` aborts, when the sleep
 * rejects with `stopped`. Either way the timer entry and the abort listener
 * are removed, so a settled sleep retains nothing.
 */
function sleepUntil(timer: IRunTimer, at: number, stop: IAbortSignal, runId: string): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    const stopped = (): SupervisionError => new SupervisionError('stopped', `Run ${runId} is stopped: its wait for the writer lease ended`);
    if (stop.aborted) {
      reject(stopped());
      return;
    }
    let removeListener: () => void = () => undefined;
    // The pending wake-up keeps the host alive: a waiting run must not end
    // merely because nothing else is pending. A timer never fires inside
    // `schedule`, so the listener is in place before it can.
    const cancel = timer.schedule(at, () => {
      removeListener();
      resolve();
    });
    removeListener = stop.onAbort(() => {
      cancel();
      reject(stopped());
    });
  });
}

/**
 * Obtain a valid writer lease for one normal request, waiting for another
 * holder as the run's policy allows.
 *
 * Each round makes one non-blocking attempt through the writer port. A grant
 * (or renewal) ends the wait. Otherwise, in this order: a stop in force ends
 * it with `stopped`; a deadline reached ends it with {@link WriterBusyError}
 * built from this very attempt, so the holder it names is the one observed at
 * or after the deadline; and only then does the waiter sleep until its next
 * attempt. A stop arriving during the sleep ends it at once. A failure of
 * the port itself propagates unchanged: waiting cannot cure damaged storage.
 * @param wait - The run's port, policy, timer and stop signal.
 * @returns The lease History granted or renewed.
 */
export async function awaitWriter(wait: IWriterWait): Promise<IRunLease> {
  for (;;) {
    const attempt: IWriterAttempt = wait.writer.tryLease();
    if (attempt.kind === 'acquired') {
      return attempt.lease;
    }
    if (wait.stop.aborted) {
      throw new SupervisionError('stopped', `Run ${wait.runId} is stopped: it does not wait for the writer lease`);
    }
    const timer = wait.timer;
    if (timer === undefined) {
      throw new SupervisionError('invalid-request', `Run ${wait.runId} cannot wait for the writer lease without a timer`);
    }
    const now = timer.currentEpochMilliseconds();
    const deadline = wait.policy.deadline;
    if (deadline !== undefined && now >= deadline) {
      throw new WriterBusyError(attempt, deadline);
    }
    await sleepUntil(timer, nextAttemptAt(now, attempt, wait.policy), wait.stop, wait.runId);
  }
}
