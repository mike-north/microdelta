/**
 * Node's implementation of the portable Machine host contracts. Durable SQLite
 * storage, the wall clock, the timer and the random identifier source are separate factories so assembly
 * injects them only into the consumers that need them, leaving
 * {@link createNodeMachine} and its existing consumers unchanged.
 * @packageDocumentation
 */
import type { IClockCapability, IMachine, IRandomIdentifierCapability, ISqliteCapability, ITimerCapability } from '@microdelta/machine';

import { _createNodeClockImplementation } from './node/clock.js';
import { _createNodeMachineImplementation } from './node/index.js';
import { _createNodeRandomImplementation } from './node/random.js';
import { _createNodeSqliteImplementation } from './node/sqlite.js';
import { _createNodeTimerImplementation } from './node/timer.js';

/**
 * Create the Node adapter selected by application assembly. Each call returns
 * fresh async-context storage while sharing no caller-visible mutable state.
 * @alpha
 */
export function createNodeMachine(): IMachine {
  return _createNodeMachineImplementation();
}

/**
 * Create Node's persistent local SQLite capability. Every connection it opens
 * uses the selected WAL, FULL synchronous, foreign-key and bounded-busy-wait
 * configuration; callers own their SQL, schema and connection lifetime.
 * @alpha
 */
export function createNodeSqlite(): ISqliteCapability {
  return _createNodeSqliteImplementation();
}

/**
 * Create Node's wall clock, which reports whole UTC epoch milliseconds as
 * unadjusted observations.
 * @alpha
 */
export function createNodeClock(): IClockCapability {
  return _createNodeClockImplementation();
}

/**
 * Create Node's timer: the wall clock plus one-shot callbacks scheduled for a
 * wall-clock time, re-armed rather than fired early, over any wait length.
 * @alpha
 */
export function createNodeTimer(): ITimerCapability {
  return _createNodeTimerImplementation();
}

/**
 * Create Node's random identifier source: 128 bits from Node's
 * cryptographically secure generator as 32 lowercase hexadecimal characters.
 * @alpha
 */
export function createNodeRandom(): IRandomIdentifierCapability {
  return _createNodeRandomImplementation();
}
