/**
 * Busy classification must follow the error's stable meaning (`name` and `code`),
 * not the identity of the driver's error class: a driver module can be loaded
 * more than once while the native addon keeps throwing the first copy's class.
 *
 * @see https://www.sqlite.org/rescode.html#busy
 * @see https://github.com/WiseLibs/better-sqlite3/blob/master/docs/api.md#class-sqliteerror
 */
import { describe, expect, test } from '@jest/globals';

import { SqliteBusyError } from '@microdelta/machine';

import { _isDriverBusy, _typedBusy } from '../src/node/sqlite.js';

/** A class structurally identical to the driver's, but not created by the module machine-node imported. */
class ForeignSqliteError extends Error {
  readonly code: string;
  constructor(message: string, code: string) {
    super(message);
    this.name = 'SqliteError';
    this.code = code;
  }
}

/** Run `operation` and return what it threw, failing the test if it did not throw. */
function thrownBy(operation: () => unknown): unknown {
  try {
    operation();
  } catch (error: unknown) {
    return error;
  }
  throw new Error('expected the operation to throw');
}

describe('SQLite busy classification', () => {
  test.each(['SQLITE_BUSY', 'SQLITE_BUSY_RECOVERY', 'SQLITE_BUSY_SNAPSHOT', 'SQLITE_BUSY_TIMEOUT'])(
    'a foreign-class driver error with code %s is busy (issue 131: instanceof missed it)',
    (code) => {
      expect(_isDriverBusy(new ForeignSqliteError('database is locked', code))).toBe(true);
    },
  );

  test('a foreign-class SQLITE_BUSY surfaces as SqliteBusyError with the driver error as cause (issue 131)', () => {
    const foreign = new ForeignSqliteError('database is locked', 'SQLITE_BUSY');
    const thrown = thrownBy(() => _typedBusy(() => {
      throw foreign;
    }));
    expect(thrown).toBeInstanceOf(SqliteBusyError);
    expect(thrown instanceof Error ? thrown.cause : undefined).toBe(foreign);
  });

  test('a driver error with a different code is not busy even if its message says locked', () => {
    expect(_isDriverBusy(new ForeignSqliteError('database is locked', 'SQLITE_CORRUPT'))).toBe(false);
    expect(_isDriverBusy(new ForeignSqliteError('database is locked', 'SQLITE_LOCKED'))).toBe(false);
  });

  test('a BUSY code on an error that is not named SqliteError is not busy', () => {
    const impostor = Object.assign(new Error('database is locked'), { code: 'SQLITE_BUSY' });
    expect(_isDriverBusy(impostor)).toBe(false);
  });

  test('a non-driver error, with or without a busy-looking message, is not busy', () => {
    expect(_isDriverBusy(new Error('SQLITE_BUSY: database is locked'))).toBe(false);
    expect(_isDriverBusy('SQLITE_BUSY')).toBe(false);
    expect(_isDriverBusy(null)).toBe(false);
    expect(_isDriverBusy(undefined)).toBe(false);
    expect(_isDriverBusy({ name: 'SqliteError', code: 7 })).toBe(false);
  });

  test('a non-busy failure passes through typedBusy unchanged', () => {
    const other = new ForeignSqliteError('malformed', 'SQLITE_CORRUPT');
    expect(thrownBy(() => _typedBusy(() => {
      throw other;
    }))).toBe(other);
  });
});
