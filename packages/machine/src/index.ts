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
 * Repeated entries into fresh contexts must not leave one distinct host context
 * per completed entry in a continuing caller once results become unreachable.
 * The consumer, not this host facility, owns when a propagated value closes.
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
 * Computes SHA-256 over the UTF-8 bytes of supplied canonical evidence.
 * Machine supplies hashing only; callers define the meaning and framing of
 * the input before it crosses this host boundary.
 * @alpha
 */
export interface ISha256Capability {
  /** Return the lowercase hexadecimal SHA-256 digest of the input text. */
  sha256(input: string): string;
}

/**
 * The host contract aggregates the capabilities selected by current runtime
 * consumers. Assembly supplies the adapter; canonical meaning remains owned by
 * Value Semantics and other context contracts. Durable SQLite storage, the
 * clock and the timer are separate capabilities, injected only where a
 * consumer needs them, so existing Machine consumers and test hosts are
 * unaffected by them. Epoch and elapsed clocks remain separately injected
 * capabilities because they represent different time domains.
 * @alpha
 */
export interface IMachine extends IAsyncContextCapability, ISnapshotCapability, ISha256Capability {}

/**
 * One value that crosses the SQLite host boundary, either as a bound parameter
 * or as a returned cell: text, a finite number, SQL NULL, or a BLOB copied into
 * a plain `Uint8Array`. A returned INTEGER is exact because values outside the
 * safe-integer range fail instead of being rounded. Booleans, bigints,
 * `undefined`, non-finite numbers and objects are outside the domain and are
 * refused at runtime even when a caller bypasses these types.
 * @alpha
 */
export type ISqliteValue = string | number | null | Uint8Array;

/**
 * One result row keyed by result column name. Rows are transport data owned by
 * the caller; they carry no driver type, prototype behavior or live link to
 * stored content.
 * @alpha
 */
export interface ISqliteRow {
  /** The value SQLite returned for the named result column. */
  readonly [column: string]: ISqliteValue;
}

/**
 * The only mutation fact a statement run reports. Row identifiers and other
 * driver details stay inside the host.
 * @alpha
 */
export interface ISqliteRunResult {
  /** Rows inserted, updated or deleted directly by the statement. */
  readonly changes: number;
}

/**
 * One prepared SQL statement bound to the connection that prepared it. Values
 * are always bound positionally and never interpolated into SQL text. Every
 * call fails once the owning connection is closed, and fails when it is made by
 * work inherited from an already ended transaction callback.
 * @alpha
 */
export interface ISqliteStatement {
  /** Execute the statement for its effect and report how many rows changed. */
  run(...values: readonly ISqliteValue[]): ISqliteRunResult;
  /** Return the first result row, or `undefined` when the statement yields none. */
  get(...values: readonly ISqliteValue[]): ISqliteRow | undefined;
  /** Return every result row in the order SQLite produced them. */
  all(...values: readonly ISqliteValue[]): readonly ISqliteRow[];
}

/**
 * Makes a transaction callback's return type unusable when it is, or may be, a
 * Promise or other thenable. A transaction commits when its callback returns;
 * an asynchronous callback would return before its awaited work, so such
 * results are rejected at compile time and, independently, at runtime.
 *
 * Any union constituent with a callable `then` rejects the whole result, so
 * `number | Promise<number>` is refused like `Promise<number>`. Results the
 * compiler cannot classify, `any` and `unknown`, are left to the runtime check
 * rather than rejecting ordinary untyped data.
 * @alpha
 */
export type ISqliteSynchronousResult<T> = 0 extends 1 & T
  ? unknown
  : [Extract<T, { readonly then: (...parameters: never[]) => unknown }>] extends [never] ? unknown : never;

/**
 * An open connection to one persistent local SQLite database file. The caller
 * that opened it owns it and must close it. The host selects durable
 * configuration for every connection: selected persistent journaling, FULL synchronous
 * commits, enforced foreign keys and a bounded wait on a locked database.
 * Callers supply every SQL statement and schema; the connection has no
 * knowledge of what the tables mean. A statement, exec or transaction that
 * cannot get a lock within the bounded wait fails with `SqliteBusyError`.
 *
 * Transactions are synchronous, top-level and IMMEDIATE: the write lock is
 * taken before the callback runs, the callback's writes commit together when
 * it returns, and all of them roll back when it throws. Nesting is refused
 * rather than given savepoint semantics. Calls through the connection or its
 * statements made by asynchronous work that a callback left behind fail after
 * the transaction ends. This protects only this connection's storage: it does
 * not prevent other effects of that leftover JavaScript.
 * @alpha
 */
export interface ISqliteConnection {
  /** Execute SQL text that takes no bound values, such as schema statements. */
  exec(sql: string): void;

  /** Prepare one statement for repeated execution with bound values. */
  prepare(sql: string): ISqliteStatement;

  /**
   * Run `operation` inside one IMMEDIATE transaction and return its result.
   * A value thrown by `operation` rolls back every write and is rethrown
   * unchanged. A Promise or thenable result, or a returned object or function
   * whose `then` cannot be inspected, rolls back and fails with `TypeError`;
   * an error raised while inspecting that `then` is not rethrown. A call made
   * while this connection's transaction callback is running fails without
   * invoking `operation`.
   */
  transaction<T>(operation: () => T & ISqliteSynchronousResult<T>): T;

  /**
   * Release the database file. Closing again has no effect; any later use of
   * the connection or its statements fails. Closing from inside a transaction
   * callback fails, which rolls that transaction back if the failure propagates,
   * and work that outlived a transaction callback cannot close the connection.
   */
  close(): void;
}

/**
 * The SQLite capability gave up waiting for another connection, possibly in
 * another process, to release a lock it needs. A host raises it, instead of
 * any driver-specific error, when its bounded busy wait is exhausted while
 * opening a store or running a statement or transaction. The failed operation
 * had no effect, so the caller may retry it or report contention to its own
 * caller; telling a busy store apart from a broken one is the purpose of this
 * type. Hosts never use it for corruption, misuse or other failures.
 * @alpha
 */
export class SqliteBusyError extends Error {
  /** How long, in milliseconds, the host waited before giving up. */
  public readonly waitedMilliseconds: number;

  /** Create a busy-exhaustion failure that records the wait that was spent. */
  public constructor(message: string, waitedMilliseconds: number, options?: ErrorOptions) {
    super(message, options);
    this.name = 'SqliteBusyError';
    this.waitedMilliseconds = waitedMilliseconds;
  }
}

/**
 * A host-proven finite refusal of side-effect-free SQLite inspection. Domain
 * owners interpret the result; this class carries no schema or run meaning.
 * @alpha
 */
export class SqliteReadError extends Error {
  /** Why the host could not perform a read without changing the file. */
  public readonly code: 'absent' | 'unsupported' | 'corrupt' | 'recovery-required';

  /** Preserve the host cause for diagnostics without exposing it in a reader protocol. */
  public constructor(code: SqliteReadError['code'], message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = 'SqliteReadError';
    this.code = code;
  }
}

/**
 * Opens persistent local SQLite databases for a consumer that owns its own
 * SQL and schema, such as History's durable authority. Opening fails for a
 * directory, a missing parent directory, a file that is not a SQLite database,
 * or a location that cannot hold a persistent write-ahead-logged database,
 * including `:memory:` and the empty path. Opening never silently weakens the
 * host's durable configuration. In the default open-or-create mode, processes
 * opening one new store at the same time all succeed within the bounded busy
 * wait or fail with `SqliteBusyError`. Exclusive creation instead refuses an
 * existing pathname before the driver can touch its bytes or journal.
 * @alpha
 */
export interface ISqliteCapability {
  /** Open or create the database file at `location` and return its owned connection. */
  openSqlite(location: string, options?: ISqliteOpenOptions): ISqliteConnection;
}

/**
 * Reads the host's current wall-clock time. Each reading is one observation in
 * whole UTC milliseconds since the Unix epoch, always a finite safe integer.
 * Readings are not monotonic: the host clock can move backwards or jump
 * forwards between readings, and the capability reports that movement
 * unchanged. Deciding how such movement affects leases or other ownership is
 * the consumer's policy, not the clock's.
 * @alpha
 */
export interface IClockCapability {
  /** Return the current UTC epoch time in whole milliseconds, or throw if the host cannot provide one. */
  currentEpochMilliseconds(): number;
}

/**
 * Measures elapsed process-local time without assigning a UTC epoch meaning.
 * Readings are supported safe whole milliseconds and never decrease during
 * this process lifetime. The origin is arbitrary and readings must not be
 * persisted or ordered against readings from another process. This separate
 * capability lets consumers measure durations without interpreting wall-clock
 * corrections reported unchanged by {@link IClockCapability}.
 * @alpha
 */
export interface IElapsedClockCapability {
  /** Return nondecreasing elapsed milliseconds from this process-local origin, or throw if the host cannot provide one. */
  currentElapsedMilliseconds(): number;
}

/**
 * Options of one scheduled timer.
 * @alpha
 */
export interface ITimerOptions {
  /**
   * Whether the pending timer by itself keeps the host alive. Defaults to
   * true, so a waiting run does not end merely because nothing else is
   * pending. A deadline that must never prolong the host's life passes false:
   * it still fires on time whenever other work keeps the host running.
   */
  readonly keepAlive?: boolean;
}

/**
 * Schedules a callback for a future wall-clock time, measured by the same
 * whole-millisecond UTC epoch readings as {@link IClockCapability}. It exists
 * so contexts can wait for a time (a stop deadline, a "not before T" wait)
 * without reading host timers themselves, and so tests can substitute a
 * controlled implementation.
 *
 * A scheduled callback runs at most once, never synchronously inside
 * `schedule`, and only after a clock reading at or after the requested time:
 * a host timer that fires early, or a clock that moved backwards, re-arms
 * rather than firing. A time already reached fires as soon as the host
 * allows. Waits longer than the host's own timer range are supported.
 * @alpha
 */
export interface ITimerCapability extends IClockCapability {
  /**
   * Call `callback` once when the clock first reads at or after
   * `epochMilliseconds`. Returns a function that cancels the pending call;
   * cancelling after the call ran, or twice, does nothing. Throws a
   * `RangeError` for a time that is not a safe integer of epoch milliseconds.
   */
  schedule(epochMilliseconds: number, callback: () => void, options?: ITimerOptions): () => void;
}

/**
 * Supplies unguessable identifiers from the host's cryptographically secure
 * random source. It exists so a context can mint an identity that must never
 * collide with one minted by another store, process or host, such as a
 * provider idempotency key, without reading host randomness itself, and so
 * tests can substitute a deterministic implementation.
 *
 * Each identifier is exactly 32 lowercase hexadecimal characters carrying 128
 * independent random bits. It names nothing and carries no value. A host that
 * cannot supply secure randomness throws rather than returning a weaker or
 * repeated identifier.
 * @alpha
 */
export interface IRandomIdentifierCapability {
  /** Return a fresh identifier of 32 lowercase hexadecimal characters, or throw. */
  randomIdentifier(): string;
}

/** A statement restricted to inspecting existing rows; never a mutation port. @alpha */
export interface ISqliteReadStatement {
  /** Read at most one row from a read-only statement. */
  get(...values: readonly ISqliteValue[]): ISqliteRow | undefined;
  /** Read all matching rows from a read-only statement. */
  all(...values: readonly ISqliteValue[]): readonly ISqliteRow[];
}

/** An existing rollback-journal SQLite file opened without filesystem or configuration writes. @alpha */
export interface ISqliteReader {
  /** Prepare a read-only statement; mutation statements are refused. */
  prepare(sql: string): ISqliteReadStatement;
  /** Release this handle; repeated close is harmless. */
  close(): void;
}

/** Inspection-only storage authority, separate from writable database creation. @alpha */
export interface ISqliteReadCapability {
  /**
   * Open an existing rollback-journal file read-only; missing files and WAL files fail without mutation.
   * Cooperative owners preserve pathname and journal layout from preflight through
   * driver open and throughout handle lifetime.
   */
  openSqliteReader(location: string): ISqliteReader;
}

/** Host journal selection for dedicated storage; schema and retention remain caller-owned. @alpha */
export interface ISqliteOpenOptions {
  /**
   * WAL is the default. DELETE uses rollback journaling with FULL synchronous
   * commits, allowing side-effect-free readers but permitting reader/writer
   * contention. DELETE refuses existing WAL files instead of changing them.
   * Cooperative owners must keep the pathname and journal layout stable from
   * preflight through opening and for the lifetime of every handle.
   */
  readonly journalMode: 'wal' | 'delete';
  /**
   * Reserve a new pathname atomically before SQLite can open or configure it.
   * An existing artifact, including another owner's SQLite file, is refused
   * without mutation. If later initialization fails, the empty reserved file
   * remains for its caller to manage rather than risking deletion of a
   * pathname another process may have replaced.
   */
  readonly creation?: 'exclusive';
}

/**
 * One command process's argument snapshot and byte-stream/status mechanics.
 * Consumers own argument grammar, document framing and status meanings. Writing
 * completes the supplied text or throws; selecting a status does not terminate
 * the process or bypass its remaining cleanup. No command or domain dispatch
 * capability is implied by this host port.
 * @alpha
 */
export interface ICommandProcessCapability {
  /** Detached arguments after the executable and entrypoint, in their original order. */
  readonly arguments: readonly string[];
  /** Write all supplied text to the command's standard output. */
  writeStdout(text: string): void;
  /** Write all supplied text to the command's standard diagnostic stream. */
  writeStderr(text: string): void;
  /** Select a whole exit status from 0 through 255 for natural process termination. */
  setExitCode(code: number): void;
}
