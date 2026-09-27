/**
 * EXP-3's portable SQLite seam keeps database policy in the History candidate
 * while leaving file paths, native bindings, and process control to the harness.
 */

/** @internal SQLite values accepted by the bounded publication fixture. */
export type ISqliteValue = string | number | null | Uint8Array;

/** @internal A row contains only values SQLite returned for named columns. */
export interface ISqliteRow {
  readonly [column: string]: ISqliteValue;
}

/** @internal Results expose only the mutation fact needed by the candidate. */
export interface ISqliteRunResult {
  readonly changes: number;
}

/** @internal A prepared statement binds values separately from SQL syntax. */
export interface ISqliteStatement {
  /** Execute one mutation using the supplied bound values. */
  run(...parameters: readonly ISqliteValue[]): ISqliteRunResult;
  /** Read one row using the supplied bound values. */
  get(...parameters: readonly ISqliteValue[]): ISqliteRow | undefined;
  /** Read all rows using the supplied bound values. */
  all(...parameters: readonly ISqliteValue[]): readonly ISqliteRow[];
}

/**
 * @internal
 * Synchronous SQLite operations needed by the protocol. `transaction` must
 * serialize its callback as one database transaction and roll it back when the
 * callback throws; the Node adapter selects SQLite's immediate write mode.
 */
export interface ISqliteCapability {
  /** Run schema or fixture SQL that has no bound values. */
  exec(sql: string): void;

  /** Read one row without leaking a driver-specific row type. */
  queryOne(sql: string, parameters?: readonly ISqliteValue[]): ISqliteRow | undefined;

  /** Read all matching rows without leaking a driver-specific row type. */
  queryAll(sql: string, parameters?: readonly ISqliteValue[]): readonly ISqliteRow[];

  /** Prepare one statement while preserving the portable value and row shapes. */
  prepare(sql: string): ISqliteStatement;

  /** Apply a group of related writes atomically or leave none of them applied. */
  transaction<T>(operation: () => T): T;
}
