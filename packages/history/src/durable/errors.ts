/**
 * Distinct failure classes of the durable History authority. Diagnostics must
 * distinguish stale ownership, conflicting execution identity, invalid
 * lifecycle transitions, unsupported storage and integrity failures rather
 * than report a generic miss (execution.md, required validation fixtures).
 * None of these classes extends `TypeError`, so a reader never mistakes a
 * storage failure for Value's rejection of a selection's shape.
 * @packageDocumentation
 */

/**
 * The store's contents contradict History's invariants or the caller's exact
 * reference: a malformed, missing or wrong-scope reference, a dangling
 * dependency, or index/payload content that does not match its digests.
 * History never repairs such a failure by following a current pointer or
 * recomputing.
 * @alpha
 */
export class HistoryIntegrityError extends Error {
  /** Create an integrity failure with a diagnostic message. */
  public constructor(message: string) {
    super(message);
    this.name = 'HistoryIntegrityError';
  }
}

/**
 * The SQLite file does not hold exactly History's supported schema for the
 * requested logical store: unknown, incomplete, foreign or differently
 * versioned storage is rejected before any work rather than migrated by guess.
 * @alpha
 */
export class HistorySchemaError extends Error {
  /** Create a schema rejection with a diagnostic message. */
  public constructor(message: string) {
    super(message);
    this.name = 'HistorySchemaError';
  }
}

/**
 * A presented writer lease no longer matches the durable holder, fence or
 * unexpired lease, so the mutation was rejected with no change other than the
 * observed clock high-water (PUB-002).
 * @alpha
 */
export class StaleWriterError extends Error {
  /** Create a stale-ownership rejection with a diagnostic message. */
  public constructor(message: string) {
    super(message);
    this.name = 'StaleWriterError';
  }
}

/**
 * An attempt key is already bound to a different execution intent, version
 * or scoped subject. The key identifies one execution; it cannot serve another.
 * @alpha
 */
export class AttemptConflictError extends Error {
  /** Create an execution-identity conflict with a diagnostic message. */
  public constructor(message: string) {
    super(message);
    this.name = 'AttemptConflictError';
  }
}

/**
 * A lifecycle operation was requested from a state that does not permit it,
 * such as staging a completed attempt or publishing one that was never staged.
 * @alpha
 */
export class AttemptStateError extends Error {
  /** Create an invalid-transition rejection with a diagnostic message. */
  public constructor(message: string) {
    super(message);
    this.name = 'AttemptStateError';
  }
}

/**
 * The injected clock failed to produce a nonnegative safe-integer epoch
 * millisecond reading, so the time-dependent operation was refused unchanged.
 * @alpha
 */
export class HistoryClockError extends Error {
  /** Create a clock refusal with a diagnostic message. */
  public constructor(message: string) {
    super(message);
    this.name = 'HistoryClockError';
  }
}
