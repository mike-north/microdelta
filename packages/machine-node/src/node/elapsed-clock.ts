/** Node binding for Machine's process-local elapsed-time contract. @packageDocumentation */
import { performance } from 'node:perf_hooks';

import type { IElapsedClockCapability } from '@microdelta/machine';

/**
 * Bind the portable elapsed clock to Node's monotonic performance counter.
 * Node's performance counter already shares one arbitrary process origin across
 * handles and module instances. Flooring preserves the portable whole-ms
 * contract; a new process establishes an unrelated origin. This capability
 * never reads or combines UTC epoch time.
 * @internal
 */
export function _createNodeElapsedClockImplementation(): IElapsedClockCapability {
  let previous = 0;

  return Object.freeze({
    currentElapsedMilliseconds(): number {
      const reading = Math.floor(performance.now());
      if (!Number.isSafeInteger(reading) || reading < previous) {
        throw new RangeError(`Host elapsed clock reading ${String(reading)} is not a nondecreasing safe integer of milliseconds`);
      }
      previous = reading;
      return reading;
    },
  });
}
