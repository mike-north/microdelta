/**
 * Node's timer for Machine's portable timer capability. It schedules one
 * callback for a wall-clock time and exists so contexts wait for a time (a
 * stop deadline, a "not before T" wait) without touching Node timers.
 *
 * Node's `setTimeout` measures elapsed time, not wall-clock time, and fires
 * after one millisecond for any delay beyond 2^31 - 1. So a wait is armed in
 * slices no longer than that limit, and every wake-up re-reads the wall
 * clock: the callback runs only once the clock reads at or after the
 * requested time, otherwise the remaining time is armed again. A timer
 * without keep-alive is unreferenced, so it never holds the process open on
 * its own.
 * @packageDocumentation
 */
import type { ITimerCapability, ITimerOptions } from '@microdelta/machine';

import { _createNodeClockImplementation } from './clock.js';

/** The longest delay Node's `setTimeout` honours; longer delays fire after 1 ms. */
const nodeMaximumDelayMilliseconds = 2_147_483_647;

/** Host limits of the Node timer, overridable only by this package's conformance tests. @internal */
export interface _INodeTimerLimits {
  /** The longest single host delay Node honours; longer waits are split. */
  readonly maximumDelayMilliseconds?: number;
}

/** Bind the portable timer contract to Node's timers and epoch clock. @internal */
export function _createNodeTimerImplementation(limits: _INodeTimerLimits = {}): ITimerCapability {
  const maximumDelay = limits.maximumDelayMilliseconds ?? nodeMaximumDelayMilliseconds;
  const clock = _createNodeClockImplementation();
  return Object.freeze({
    currentEpochMilliseconds(): number {
      return clock.currentEpochMilliseconds();
    },
    schedule(epochMilliseconds: number, callback: () => void, options: ITimerOptions = {}): () => void {
      if (!Number.isSafeInteger(epochMilliseconds)) {
        throw new RangeError(`Timer time ${String(epochMilliseconds)} is not a safe integer of epoch milliseconds`);
      }
      const keepAlive = options.keepAlive !== false;
      /** Whether the callback ran or the timer was cancelled; either way nothing more happens. */
      let finished = false;
      let handle: ReturnType<typeof setTimeout> | undefined;
      /** Arm one host slice toward the requested time, never longer than Node honours. */
      const arm = (): void => {
        const remaining = Math.max(0, epochMilliseconds - clock.currentEpochMilliseconds());
        const slice = setTimeout(wake, Math.min(remaining, maximumDelay));
        if (!keepAlive) {
          slice.unref();
        }
        handle = slice;
      };
      /** A host wake-up: fire only when the wall clock has reached the time, otherwise re-arm. */
      function wake(): void {
        handle = undefined;
        if (finished) {
          return;
        }
        if (clock.currentEpochMilliseconds() >= epochMilliseconds) {
          finished = true;
          callback();
          return;
        }
        arm();
      }
      arm();
      return (): void => {
        if (finished) {
          return;
        }
        finished = true;
        if (handle !== undefined) {
          clearTimeout(handle);
          handle = undefined;
        }
      };
    },
  });
}
