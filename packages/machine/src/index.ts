/**
 * Portable contracts for the host facilities selected by microdelta contexts.
 * These declarations contain no Node types so context implementations can be
 * checked with only ECMAScript library declarations.
 * @packageDocumentation
 */

/**
 * A scoped value that follows asynchronous work created by its callback.
 * `run` preserves the callback's return value and exact thrown or rejected error;
 * a nested call restores the surrounding value after its callback completes.
 * @alpha
 */
export interface IAsyncContext<T> {
  /** Read the value attached to the current asynchronous execution, if any. */
  getStore(): T | undefined;

  /** Run work in an isolated context whose value propagates through awaits. */
  run<TResult>(value: T, callback: () => TResult): TResult;
}

/**
 * Creates independent async contexts without deciding how consumers manage
 * their scoped state or the lifetime of that state.
 * @alpha
 */
export interface IAsyncContextCapability {
  /** Create context storage isolated from every other created context. */
  createAsyncContext<T>(): IAsyncContext<T>;
}

/**
 * Produces a synchronous detached copy of primitives, arrays, ordinary objects'
 * enumerable string-keyed properties, Date, RegExp, Map, Set, ArrayBuffer, and
 * typed-array/DataView contents. It preserves cycles and repeated references
 * within one copy and isolates both input and returned snapshots. Functions,
 * symbols, and raw SharedArrayBuffer values fail. Getters may run; nonenumerable
 * and symbol-keyed properties and arbitrary class prototypes are not preserved.
 * This contract defines neither durable encoding nor canonical identity. It is
 * public because History's direct memory-store constructor requires injection.
 * @public
 */
export interface ISnapshotCapability {
  /** Return a detached copy or throw before a caller mutates owned state. */
  snapshot<T>(value: T): T;
}

/**
 * The small host contract required by current tracking and memory-store code.
 * Contexts receive only the capability they use; assembly selects an adapter.
 * @alpha
 */
export interface IMachine extends IAsyncContextCapability, ISnapshotCapability {}
