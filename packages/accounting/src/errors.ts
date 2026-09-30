/**
 * Distinct failure classes of Resource Accounting. A caller must be able to
 * tell a refused fact (unattributable usage, a conflicting intent) from
 * unsupported storage, corrupted storage and a write whose durability is
 * unknown, because each calls for a different response. Malformed arguments
 * fail with `TypeError` before any storage is touched.
 * @packageDocumentation
 */

/**
 * Why a usage report could not be attributed to recorded work in its
 * environment: no request of the named operation was ever opened
 * (`unknown-operation`), the operation is known but the named request was
 * never opened (`unknown-request`), or the named request was opened for a
 * different operation (`request-of-another-operation`).
 * @alpha
 */
export type IUnattributableReason = 'unknown-operation' | 'unknown-request' | 'request-of-another-operation';

/**
 * A usage report was refused because it does not name an opened request of the
 * named operation in its environment. Nothing was recorded. Accounting never
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
 * An intent reused a request identity already opened in its environment for a
 * different operation or attribution. A request identity names one request
 * attempt; it cannot stand for another. Nothing was recorded.
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
 * A write's transaction ran to completion but its commit did not confirm, so
 * the fact may or may not be durable. No acknowledgment was issued. Because
 * every Accounting write is an idempotent keyed fact, redelivering the same
 * fact resolves the question: it returns a duplicate if the first write
 * landed, and records it otherwise (ACC-007).
 * @alpha
 */
export class AccountingDurabilityUnknownError extends Error {
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
