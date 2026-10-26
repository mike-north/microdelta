/**
 * Node's implementation of the portable Machine host contracts. Durable SQLite
 * storage, the wall clock, the timer and the random identifier source are separate factories so assembly
 * injects them only into the consumers that need them, leaving
 * {@link createNodeMachine} and its existing consumers unchanged.
 * {@link canonicalNodeLocation} names a store file canonically, so assembly
 * can recognize two handles over one file without reading the host itself.
 * @packageDocumentation
 */
import type { IClockCapability, IElapsedClockCapability, IMachine, IRandomIdentifierCapability, ISqliteReadCapability, ISqliteCapability, ITimerCapability } from '@microdelta/machine';

import { _createNodeClockImplementation } from './node/clock.js';
import { _createNodeElapsedClockImplementation } from './node/elapsed-clock.js';
import { _canonicalNodeLocationImplementation } from './node/location.js';
import { _createNodeMachineImplementation } from './node/index.js';
import { _createNodeRandomImplementation } from './node/random.js';
import { _createNodeSqliteImplementation, _createNodeSqliteReaderImplementation } from './node/sqlite.js';
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
 * uses the selected journal mode (WAL by default), FULL synchronous, foreign-key and bounded-busy-wait
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
 * Create Node's process-local elapsed clock, which measures nondecreasing
 * whole milliseconds from an arbitrary origin using the monotonic host timer.
 * @alpha
 */
export function createNodeElapsedClock(): IElapsedClockCapability {
  return _createNodeElapsedClockImplementation();
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
 * The canonical location of an existing local store file: its absolute real
 * path, with supported symbolic links and redundant segments resolved.
 * Relative and absolute spellings of that path share a canonical location;
 * distinct hard-linked names remain distinct paths. Assembly uses this
 * pathname identity to recognize handles opened through supported aliases.
 * A location naming no existing file throws.
 * @alpha
 */
export function canonicalNodeLocation(location: string): string {
  return _canonicalNodeLocationImplementation(location);
}

/**
 * Create Node's random identifier source: 128 bits from Node's
 * cryptographically secure generator as 32 lowercase hexadecimal characters.
 * @alpha
 */
export function createNodeRandom(): IRandomIdentifierCapability {
  return _createNodeRandomImplementation();
}

/**
 * Create inspection-only access to existing rollback-journal SQLite files, with no creation,
 * schema initialization or journal-mode assignment during opening. WAL files
 * are refused before SQLite can create coordination sidecars. Cooperative owners
 * preserve pathname and journal layout from preflight through driver open and
 * throughout handle lifetime; this preflight does not lock the filesystem.
 * @alpha
 */
export function createNodeSqliteReader(): ISqliteReadCapability {
  return _createNodeSqliteReaderImplementation();
}
