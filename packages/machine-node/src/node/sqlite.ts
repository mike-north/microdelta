/**
 * Node's binding of Machine's portable SQLite capability to the pinned
 * better-sqlite3 driver. This module is the only production code allowed to
 * import that native driver. It owns host concerns only: durable connection
 * configuration, value transport between the driver and portable types, the
 * synchronous IMMEDIATE transaction boundary and connection lifetime. Callers
 * own every SQL statement, schema and meaning of stored data.
 *
 * Host limitations: every call is synchronous and blocks the Node event loop,
 * including up to the bounded busy wait on a locked database. Lifetime checks
 * cover only calls that inherit an ended transaction's asynchronous context;
 * other JavaScript effects of such leftover work are not prevented.
 * @packageDocumentation
 */
import { AsyncLocalStorage } from 'node:async_hooks';
import { types } from 'node:util';

import Database from 'better-sqlite3';

import { SqliteBusyError } from '@microdelta/machine';
import type { ISqliteCapability, ISqliteConnection, ISqliteRow, ISqliteRunResult, ISqliteStatement, ISqliteSynchronousResult, ISqliteValue } from '@microdelta/machine';

/** The bounded wait, in milliseconds, before a locked database fails with SQLITE_BUSY. */
const busyTimeoutMilliseconds = 500;

/**
 * The durable configuration applied to every connection, and the value each
 * setting must read back as before the connection is handed to a caller.
 * WAL lets readers proceed beside one writer, FULL (2) syncs every commit,
 * foreign keys are enforced, and lock waits are bounded.
 */
const selectedConfiguration: readonly { readonly assignment: string; readonly setting: string; readonly expected: string | number }[] = [
  { assignment: 'journal_mode = WAL', setting: 'journal_mode', expected: 'wal' },
  { assignment: 'synchronous = FULL', setting: 'synchronous', expected: 2 },
  { assignment: 'foreign_keys = ON', setting: 'foreign_keys', expected: 1 },
  { assignment: `busy_timeout = ${String(busyTimeoutMilliseconds)}`, setting: 'busy_timeout', expected: busyTimeoutMilliseconds },
];

/** The longest pause, in milliseconds, between attempts to configure a store that is busy. */
const maximumRetryPauseMilliseconds = 10;

/** Locations that cannot hold the persistent WAL file this capability promises. */
const nonPersistentLocations: ReadonlySet<string> = new Set(['', ':memory:']);

/**
 * The lifetime of one transaction callback, carried through asynchronous work
 * that the callback starts. It is live only while the callback runs.
 */
interface ITransactionLifetime {
  live: boolean;
}

/** Bind the portable SQLite contract to the native driver. @internal */
export function _createNodeSqliteImplementation(): ISqliteCapability {
  return Object.freeze({
    openSqlite(location: string): ISqliteConnection {
      return openConnection(location);
    },
  });
}

/** The driver error's `name`, stable across every copy of the driver module. */
const driverErrorName = 'SqliteError';

/** Code prefix shared by `SQLITE_BUSY` and its extended variants such as `SQLITE_BUSY_SNAPSHOT`. */
const busyCodePrefix = 'SQLITE_BUSY';

/**
 * Recognize a driver failure that means another connection holds a lock this
 * one needs: `SQLITE_BUSY` and its extended variants. Other failures, such as
 * corruption or misuse, are never contention.
 *
 * Classification is by the error's stable meaning (`name` and string `code`),
 * deliberately not `instanceof Database.SqliteError`. The driver module can be
 * loaded more than once in a process (for example, once per Jest suite), yet
 * the native addon keeps throwing the error class from the first copy it saw,
 * so class identity says nothing reliable about whether an error came from the
 * driver. Nor is `instanceof Error` trusted, since a native addon's errors can
 * come from another realm. An error that merely mentions busy in its message
 * is not busy.
 * @internal
 */
export function _isDriverBusy(error: unknown): boolean {
  return typeof error === 'object'
    && error !== null
    && 'name' in error
    && error.name === driverErrorName
    && 'code' in error
    && typeof error.code === 'string'
    && error.code.startsWith(busyCodePrefix);
}

/** Describe exhausted contention as the portable typed failure, keeping the driver error as its cause. */
function busyFailure(error: unknown, startedAt: number): SqliteBusyError {
  const waited = Date.now() - startedAt;
  const reason = error instanceof Error ? error.message : 'the database is locked';
  return new SqliteBusyError(`SQLite store stayed busy for ${String(waited)} ms: ${reason}`, waited, { cause: error });
}

/**
 * Run one driver call and surface contention as {@link SqliteBusyError}. The
 * driver already waited out the connection's busy timeout before failing, so
 * a busy error here means the budget is spent. Every other failure, including
 * values thrown by caller code, passes through unchanged.
 * @internal
 */
export function _typedBusy<T>(operation: () => T): T {
  const startedAt = Date.now();
  try {
    return operation();
  } catch (error: unknown) {
    throw _isDriverBusy(error) ? busyFailure(error, startedAt) : error;
  }
}

/** Block this thread for `milliseconds` without spinning; the capability is synchronous by contract. */
function pause(milliseconds: number): void {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(Int32Array.BYTES_PER_ELEMENT)), 0, 0, milliseconds);
}

/**
 * Repeat an idempotent setup step while the store is busy, until the busy
 * budget measured from `startedAt` is spent. SQLite does not always run its
 * busy handler: changing a file's journal mode to WAL needs exclusive access,
 * and when another connection holds a lock the engine may fail at once rather
 * than wait, to avoid a deadlock. Concurrent first opens of a new store hit
 * exactly that, so waiting inside the driver is not enough and the whole step
 * is retried with short randomized pauses that de-synchronize the contenders.
 * Once the budget is spent the last contention is reported as
 * {@link SqliteBusyError}.
 */
function retryWhileBusy(startedAt: number, step: () => void): void {
  for (;;) {
    try {
      step();
      return;
    } catch (error: unknown) {
      if (!_isDriverBusy(error)) {
        throw error;
      }
      if (Date.now() - startedAt >= busyTimeoutMilliseconds) {
        throw busyFailure(error, startedAt);
      }
      pause(1 + Math.floor(Math.random() * maximumRetryPauseMilliseconds));
    }
  }
}

/**
 * Open and configure one database file. Processes may open the same new store
 * at once: configuration is retried within the busy budget, and a spent budget
 * fails with {@link SqliteBusyError}, never a raw driver error. A failure after the driver opened the
 * file closes that handle before rethrowing; files themselves are never
 * removed, because an existing file may hold another owner's data.
 */
function openConnection(location: string): ISqliteConnection {
  if (nonPersistentLocations.has(location)) {
    throw new TypeError(`SQLite location ${JSON.stringify(location)} cannot hold a persistent write-ahead-logged database`);
  }
  const startedAt = Date.now();
  const driver = _typedBusy(() => new Database(location, { timeout: busyTimeoutMilliseconds }));
  try {
    retryWhileBusy(startedAt, () => {
      for (const { assignment, setting, expected } of selectedConfiguration) {
        driver.pragma(assignment);
        const actual = driver.pragma(setting, { simple: true });
        if (actual !== expected) {
          throw new Error(`SQLite ${setting} read back ${String(actual)} instead of the selected ${String(expected)}`);
        }
      }
    });
  } catch (error: unknown) {
    driver.close();
    throw error;
  }
  return createConnection(driver);
}

/**
 * Wrap one configured driver handle. The wrapper owns three pieces of state:
 * whether the handle is closed, whether a transaction callback is running, and
 * an async-context slot identifying calls inherited from a transaction callback.
 * The slot is private to this connection, so lifetime checks never affect
 * another connection.
 */
function createConnection(driver: Database.Database): ISqliteConnection {
  let closed = false;
  let inTransaction = false;
  const inherited = new AsyncLocalStorage<ITransactionLifetime>();

  /** Refuse calls on a closed connection or from work outliving its transaction callback. */
  function assertUsable(): void {
    if (inherited.getStore()?.live === false) {
      throw new Error('SQLite connection call came from work that outlived its transaction callback');
    }
    if (closed) {
      throw new Error('SQLite connection is closed');
    }
  }

  const connection: ISqliteConnection = {
    exec(sql: string): void {
      assertUsable();
      _typedBusy(() => { driver.exec(sql); });
    },

    prepare(sql: string): ISqliteStatement {
      assertUsable();
      return createStatement(_typedBusy(() => driver.prepare(sql)), assertUsable);
    },

    transaction<T>(operation: () => T & ISqliteSynchronousResult<T>): T {
      assertUsable();
      if (inTransaction) {
        throw new Error('SQLite transactions cannot be nested');
      }
      const lifetime: ITransactionLifetime = { live: true };
      inTransaction = true;
      try {
        return _typedBusy(() => inherited.run(lifetime, () => driver.transaction(() => {
          const result = operation();
          if (types.isPromise(result)) {
            containNativeRejection(result);
            throw new TypeError('SQLite transaction callbacks must be synchronous; a Promise result was rolled back');
          }
          if (isThenable(result)) {
            throw new TypeError('SQLite transaction callbacks must be synchronous; a thenable result, or one whose then cannot be inspected, was rolled back');
          }
          return result;
        }).immediate()));
      } finally {
        lifetime.live = false;
        inTransaction = false;
      }
    },

    close(): void {
      if (inherited.getStore()?.live === false) {
        throw new Error('SQLite connection cannot be closed by work that outlived its transaction callback');
      }
      if (closed) {
        return;
      }
      if (inTransaction) {
        throw new Error('SQLite connection cannot be closed inside its transaction callback');
      }
      driver.close();
      closed = true;
    },
  };
  return Object.freeze(connection);
}

/**
 * Wrap one prepared driver statement. Integers are read as exact bigints and
 * narrowed to safe numbers; result rows are read as arrays and rebuilt from
 * column names so every column, including names such as `__proto__`, becomes
 * an own data property.
 */
function createStatement(statement: Database.Statement<unknown[], unknown>, assertUsable: () => void): ISqliteStatement {
  statement.safeIntegers(true);
  if (statement.reader) {
    statement.raw(true);
  }

  /** Validate a call's bound values after confirming the connection may be used. */
  function prepareCall(values: readonly ISqliteValue[]): readonly ISqliteValue[] {
    assertUsable();
    values.forEach(assertBindable);
    return values;
  }

  return Object.freeze({
    run(...values: readonly ISqliteValue[]): ISqliteRunResult {
      const result = _typedBusy(() => statement.run(...prepareCall(values)));
      return { changes: result.changes };
    },
    get(...values: readonly ISqliteValue[]): ISqliteRow | undefined {
      const cells: unknown = _typedBusy(() => statement.get(...prepareCall(values)));
      return cells === undefined ? undefined : toRow(statement, cells);
    },
    all(...values: readonly ISqliteValue[]): readonly ISqliteRow[] {
      const rows: readonly unknown[] = _typedBusy(() => statement.all(...prepareCall(values)));
      return rows.map((cells) => toRow(statement, cells));
    },
  });
}

/**
 * Refuse a bound value outside the portable domain before the driver can
 * coerce it: non-finite numbers, booleans, bigints, `undefined` and objects
 * other than a `Uint8Array` fail with `TypeError`.
 */
function assertBindable(value: unknown, index: number): void {
  if (typeof value === 'string' || value === null || isUint8Array(value)) {
    return;
  }
  if (typeof value === 'number' && Number.isFinite(value)) {
    return;
  }
  throw new TypeError(`SQLite bound value ${String(index + 1)} is outside the portable value domain`);
}

/** Rebuild a raw driver row as a plain object keyed by the statement's result columns. */
function toRow(statement: Database.Statement<unknown[], unknown>, cells: unknown): ISqliteRow {
  if (!Array.isArray(cells)) {
    throw new TypeError('SQLite returned a row that is not a column array');
  }
  const columns = statement.columns();
  if (columns.length !== cells.length) {
    throw new TypeError('SQLite returned a row whose width differs from its result columns');
  }
  return Object.fromEntries(columns.map((column, index): readonly [string, ISqliteValue] => [column.name, toValue(column.name, cells[index])]));
}

/**
 * Convert one driver cell to the portable domain: text, finite numbers and
 * null pass through, integers must be safe, and blobs become detached plain
 * `Uint8Array` copies.
 */
function toValue(column: string, cell: unknown): ISqliteValue {
  if (typeof cell === 'string' || cell === null) {
    return cell;
  }
  if (typeof cell === 'number') {
    // SQLite REAL values can overflow to an infinity; like NaN, it is outside
    // the portable finite-number domain and is refused rather than returned.
    if (!Number.isFinite(cell)) {
      throw new RangeError(`SQLite column ${column} holds a non-finite real`);
    }
    return cell;
  }
  if (typeof cell === 'bigint') {
    if (cell > BigInt(Number.MAX_SAFE_INTEGER) || cell < BigInt(Number.MIN_SAFE_INTEGER)) {
      throw new RangeError(`SQLite column ${column} holds an integer outside the safe integer range`);
    }
    return Number(cell);
  }
  if (ArrayBuffer.isView(cell)) {
    return new Uint8Array(cell.buffer, cell.byteOffset, cell.byteLength).slice();
  }
  throw new TypeError(`SQLite column ${column} returned a value outside the portable value domain`);
}

/** Recognize any realm's `Uint8Array`, including Node's `Buffer` subclass. */
function isUint8Array(value: unknown): value is Uint8Array {
  return types.isUint8Array(value);
}

/**
 * Recognize a non-native result the transaction boundary must refuse as
 * asynchronous: an object or function with a callable `then`, or one whose
 * `then` cannot be inspected because reading it throws. The inspection error
 * is not propagated; the caller refuses the result with its own `TypeError`.
 * Native Promises are recognized earlier by their internal slot, so a Promise
 * whose own `then` is shadowed or throws is never judged here. Reading `then`
 * may run a foreign getter; the function itself is never called.
 */
function isThenable(value: unknown): boolean {
  if ((typeof value !== 'object' && typeof value !== 'function') || value === null) {
    return false;
  }
  let then: unknown;
  try {
    then = Reflect.get(value, 'then');
  } catch {
    return true;
  }
  return typeof then === 'function';
}

/**
 * Attach a no-op rejection handler to a native Promise, from any realm, so its
 * later rejection cannot become an unhandled rejection after the transaction
 * has already failed. The intrinsic `Promise.prototype.then` registers the
 * handler on the Promise's internal reaction list without reading the
 * instance's own `then`. It still resolves the species constructor through the
 * instance's `constructor`; if that lookup throws, the refusal stands and the
 * rejection is left uncontained. Foreign thenables are never passed here:
 * invoking their `then` would run arbitrary code, and they cannot produce an
 * unhandled rejection.
 */
function containNativeRejection(value: Promise<unknown>): void {
  try {
    void Promise.prototype.then.call(value, undefined, () => undefined);
  } catch {
    // Containment is best effort; the transaction is already being refused.
  }
}
