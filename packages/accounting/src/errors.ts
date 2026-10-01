/**
 * Distinct failure classes of Resource Accounting. A caller must be able to
 * tell a refused fact (unattributable usage, a conflicting intent) from
 * unsupported storage, corrupted storage, a write that could not get the write
 * lock and a write whose durability is unknown, because each calls for a
 * different response. Malformed arguments fail with `TypeError` before any
 * storage is touched.
 * @packageDocumentation
 */
import type { SqliteBusyError } from '@microdelta/machine';

/**
 * Why a usage report could not be attributed to recorded work in its
 * environment: no usage intent names the operation (`unknown-operation`), the
 * operation has intents but none for the named request attempt
 * (`unknown-request-attempt`), or the named request attempt's intent is for a
 * different operation (`request-attempt-of-another-operation`).
 * @alpha
 */
export type IUnattributableReason = 'unknown-operation' | 'unknown-request-attempt' | 'request-attempt-of-another-operation';

/**
 * A usage report was refused because it does not name a recorded request
 * attempt of the named operation in its environment. Nothing was recorded. Accounting never
 * guesses an attribution for usage it cannot place (ACC-002).
 * @alpha
 */
export class UnattributableUsageError extends Error {
  /** Why the report could not be attributed. */
  public readonly reason: IUnattributableReason;

  /** Create a refusal naming its reason. */
  public constructor(reason: IUnattributableReason, message: string) {
    super(message);
    this.name = 'UnattributableUsageError';
    this.reason = reason;
  }
}

/**
 * A usage intent reused a request attempt identity already recorded in its
 * environment for a different operation or attribution. A request attempt
 * identity names one request attempt; it cannot stand for another. Nothing was
 * recorded.
 * @alpha
 */
export class UsageIntentConflictError extends Error {
  /** Create a conflict rejection with a diagnostic message. */
  public constructor(message: string) {
    super(message);
    this.name = 'UsageIntentConflictError';
  }
}

/**
 * A write could not get the store's write lock within the host's bounded busy
 * wait, because another connection, possibly in another process, held it. The
 * write did no work: nothing was recorded and no acknowledgment was issued,
 * so the same fact may be redelivered later. The host's typed
 * {@link @microdelta/machine#SqliteBusyError} is its `cause`. Accounting names
 * contention itself so that its consumers can tell a busy store from a broken
 * one without depending on the Machine contract.
 * @alpha
 */
export class AccountingBusyError extends Error {
  /** How long, in milliseconds, the host waited for the lock before giving up. */
  public readonly waitedMilliseconds: number;

  /** The host's busy failure this error reports. */
  public declare readonly cause: SqliteBusyError;

  /** Create a busy failure that carries the host's typed busy error as its cause. */
  public constructor(message: string, cause: SqliteBusyError) {
    super(message, { cause });
    this.name = 'AccountingBusyError';
    this.waitedMilliseconds = cause.waitedMilliseconds;
  }
}

/**
 * A write's transaction ran to completion but its commit did not confirm, so
 * the fact may or may not be durable. No acknowledgment was issued. Because
 * every Accounting write is an idempotent keyed fact, redelivering the same
 * fact resolves the question: it returns a duplicate if the first write
 * landed, and records it otherwise (ACC-007).
 * @alpha
 */
export class AccountingDurabilityUnknownError extends Error {
  /**
   * The structural mark of this failure: the write may have landed. Consumers
   * that cannot depend on this package, such as Run Supervision, read it to
   * tell a write that may be durable from one that recorded nothing.
   */
  public readonly durability = 'unknown' as const;

  /** Create a durability-unknown failure carrying the storage error as its cause. */
  public constructor(message: string, cause: unknown) {
    super(message, { cause });
    this.name = 'AccountingDurabilityUnknownError';
  }
}

/**
 * The SQLite file does not hold exactly Accounting's supported schema for the
 * requested logical store. Unknown, incomplete, foreign or differently
 * versioned storage is rejected before any work rather than migrated by guess.
 * @alpha
 */
export class AccountingSchemaError extends Error {
  /** Create a schema rejection with a diagnostic message. */
  public constructor(message: string) {
    super(message);
    this.name = 'AccountingSchemaError';
  }
}

/**
 * Stored accounting content contradicts Accounting's invariants, such as a
 * malformed cell or an undecodable estimate basis. Accounting never repairs
 * such a failure by guessing.
 * @alpha
 */
export class AccountingIntegrityError extends Error {
  /** Create an integrity failure with a diagnostic message. */
  public constructor(message: string) {
    super(message);
    this.name = 'AccountingIntegrityError';
  }
}
