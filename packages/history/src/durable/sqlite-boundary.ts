/**
 * History's narrow Machine SQLite boundary. It translates exhausted host
 * contention without changing transaction callbacks, domain failures, or
 * the connection's atomicity and fencing semantics.
 * @packageDocumentation
 */
import { SqliteBusyError } from '@microdelta/machine';
import type { ISqliteCapability, ISqliteConnection, ISqliteStatement, ISqliteSynchronousResult } from '@microdelta/machine';

import { HistoryBusyError } from './errors.js';

/** Only errors translated here attest that Machine's SQLite boundary was busy. */
const boundaryFailures = new WeakSet<HistoryBusyError>();

/** Whether this exact failure came from History's wrapped SQLite capability. */
export function isHistorySqliteBoundaryBusy(error: unknown): error is HistoryBusyError {
  return error instanceof HistoryBusyError && boundaryFailures.has(error);
}

/** Preserve the host cause while marking the translated instance for lease policy. */
function historyBusy(cause: SqliteBusyError): HistoryBusyError {
  const failure = new HistoryBusyError(cause.message, cause);
  boundaryFailures.add(failure);
  return failure;
}

/** Translate only Machine's typed exhausted contention, preserving its identity as the cause. */
function atBoundary<T>(operation: () => T): T {
  try {
    return operation();
  } catch (error: unknown) {
    if (error instanceof SqliteBusyError) {
      throw historyBusy(error);
    }
    throw error;
  }
}

/** Wrap one prepared statement, leaving bound values and returned rows unchanged. */
function historyStatement(statement: ISqliteStatement): ISqliteStatement {
  return {
    run: (...values) => atBoundary(() => statement.run(...values)),
    get: (...values) => atBoundary(() => statement.get(...values)),
    all: (...values) => atBoundary(() => statement.all(...values)),
  };
}

/**
 * Open a connection whose SQLite calls use History's typed busy failure.
 * A busy error thrown by a transaction callback remains that callback's
 * exact error, even when it is itself a Machine SqliteBusyError.
 */
export function openHistorySqlite(sqlite: ISqliteCapability, location: string): ISqliteConnection {
  const connection = atBoundary(() => sqlite.openSqlite(location));
  return {
    exec: (sql) => atBoundary(() => connection.exec(sql)),
    prepare: (sql) => historyStatement(atBoundary(() => connection.prepare(sql))),
    transaction: <T>(operation: () => T & ISqliteSynchronousResult<T>): T => {
      let callbackFailed = false;
      let callbackError: unknown;
      try {
        return connection.transaction<T>(() => {
          try {
            return operation();
          } catch (error: unknown) {
            callbackFailed = true;
            callbackError = error;
            throw error;
          }
        });
      } catch (error: unknown) {
        if (callbackFailed && error === callbackError) {
          throw error;
        }
        if (error instanceof SqliteBusyError) {
          throw historyBusy(error);
        }
        throw error;
      }
    },
    close: () => atBoundary(() => connection.close()),
  };
}
