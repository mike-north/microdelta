/**
 * Node's wall clock for Machine's portable clock capability. Each reading is
 * one host observation in whole UTC epoch milliseconds. The clock neither
 * smooths nor orders readings: backward or forward host movement is reported
 * unchanged, and History owns any high-water, rollback or lease policy.
 * @packageDocumentation
 */
import type { IClockCapability } from '@microdelta/machine';

/** Bind the portable clock contract to the host's epoch-millisecond clock. @internal */
export function _createNodeClockImplementation(): IClockCapability {
  return Object.freeze({
    currentEpochMilliseconds(): number {
      const reading = Date.now();
      if (!Number.isSafeInteger(reading)) {
        throw new RangeError(`Host clock reading ${String(reading)} is not a safe integer of epoch milliseconds`);
      }
      return reading;
    },
  });
}
