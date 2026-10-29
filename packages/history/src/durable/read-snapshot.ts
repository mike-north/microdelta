/**
 * History's finite read ownership: physical scope acquisition, translated SQL
 * calls and independent release attempts surround one synchronous owner query.
 * Domain validation and answer normalization belong to the supplied internal
 * operation; no physical lifetime or release control is passed to that operation.
 * @packageDocumentation
 */
import type { ISqliteCoordinatedReadCapability, ISqliteReadStatement, ISqliteValue } from '@microdelta/machine';

import { _atHistorySqliteBoundary } from './sqlite-boundary.js';

/** Only readonly queries are available to History's schema and selected index. @internal */
export interface IHistoryReadPort {
  /** Prepare an owner-defined readonly query within the active physical scope. */
  prepare(sql: string): ISqliteReadStatement;
}

/** A thrown undefined is a failure, distinct from returning undefined. */
type IReadOutcome<T> =
  | { readonly kind: 'returned'; readonly value: T }
  | { readonly kind: 'threw'; readonly error: unknown };

/** Retain a synchronous completion without interpreting an arbitrary thrown value. */
function completion<T>(operation: () => T): IReadOutcome<T> {
  try { return { kind: 'returned', value: operation() }; }
  catch (error: unknown) { return { kind: 'threw', error }; }
}

/**
 * Finish one synchronous owner operation before either returning its answer or
 * throwing its causal failures. Every acquired scope receives both release
 * attempts; failed release cannot become ordinary success. The internal caller
 * must fully normalize its answer rather than return a storage capability.
 * @internal
 */
export function withHistoryReadSnapshot<T>(
  sqlite: ISqliteCoordinatedReadCapability,
  location: string,
  operation: (read: IHistoryReadPort) => T,
): T {
  const scope = _atHistorySqliteBoundary(() => sqlite.openSqliteCoordinatedRead(location));
  const read: IHistoryReadPort = Object.freeze({
    prepare(sql: string): ISqliteReadStatement {
      const statement = _atHistorySqliteBoundary(() => scope.prepare(sql));
      return Object.freeze({
        get: (...values: readonly ISqliteValue[]) => _atHistorySqliteBoundary(() => statement.get(...values)),
        all: (...values: readonly ISqliteValue[]) => _atHistorySqliteBoundary(() => statement.all(...values)),
      });
    },
  });
  const result = completion(() => {
    _atHistorySqliteBoundary(() => scope.begin());
    return operation(read);
  });
  const failures: unknown[] = result.kind === 'threw' ? [result.error] : [];
  for (const release of [() => scope.end(), () => scope.close()]) {
    const released = completion(() => _atHistorySqliteBoundary(release));
    if (released.kind === 'threw') { failures.push(released.error); }
  }
  if (failures.length === 1) { throw failures[0]; }
  if (failures.length > 1) { throw new AggregateError(failures, 'History selection and release failed'); }
  if (result.kind === 'returned') { return result.value; }
  throw result.error;
}
