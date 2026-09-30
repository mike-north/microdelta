/**
 * Owner tests for how the SQLite adapter classifies a failed write
 * transaction. The host's typed busy error means the write did no work and is
 * reported as Accounting's own busy failure carrying it as the cause; any
 * other failure during the work is passed through unchanged (nothing was
 * written); any other failure after the work completed is a commit whose
 * outcome is unknown. Contended writes over real SQLite in separate processes
 * run in the facade's assembly suite (`packages/core/test/accounting`).
 *
 * @see ../../../docs/spec/operations.md (ACC-007)
 * @see ../../machine/src/index.ts (SqliteBusyError: the failed operation had no effect)
 */
import { describe, expect, test } from '@jest/globals';
import { SqliteBusyError } from '@microdelta/machine';

import { AccountingBusyError, AccountingDurabilityUnknownError } from '../src/errors.js';
import { writeFailure } from '../src/sqlite/index.js';

describe('write failure classification', () => {
  test.each([false, true])('a typed busy failure is AccountingBusyError whether or not the work had completed (%s)', (workCompleted) => {
    const busy = new SqliteBusyError('SQLite store stayed busy for 512 ms: database is locked', 512);
    const failure = writeFailure('usage intent req-1', busy, workCompleted);
    expect(failure).toBeInstanceOf(AccountingBusyError);
    if (failure instanceof AccountingBusyError) {
      expect(failure.cause).toBe(busy);
      expect(failure.waitedMilliseconds).toBe(512);
      expect(failure.message).toMatch(/usage intent req-1 was not recorded/u);
    }
  });

  test('any other failure while the work runs is passed through unchanged', () => {
    const refusal = new TypeError('refused before any write');
    expect(writeFailure('usage report usage-1', refusal, false)).toBe(refusal);
  });

  test('any other failure after the work completed is a commit of unknown durability', () => {
    const commit = new Error('disk I/O error');
    const failure = writeFailure('usage report usage-1', commit, true);
    expect(failure).toBeInstanceOf(AccountingDurabilityUnknownError);
    expect(failure).toMatchObject({ cause: commit });
  });

  test('a busy-looking error that is not the host\'s typed error is not treated as contention', () => {
    const raw = Object.assign(new Error('database is locked'), { name: 'SqliteError', code: 'SQLITE_BUSY' });
    expect(writeFailure('estimate estimate-1', raw, false)).toBe(raw);
  });
});
