/**
 * Shared exact-result correspondence for writable History and finite selection.
 * A locator must agree with the selected store and its completed immutable row;
 * neither a missing result nor incompatible storage can fall back to current.
 * @packageDocumentation
 */
import type { ISqliteRow } from '@microdelta/machine';

import type { ICompletedResultReference } from '../completed-results.js';
import type { IHistoryScope } from './contracts.js';
import { HistoryIntegrityError } from './errors.js';
import { parseReference } from './locator.js';
import { indexVersion } from './selected-index.js';

/** The canonical immutable payload encoding written and read by this History schema. @internal */
export const payloadEncoding = 'MDS1';

/** One exact id lookup includes the completed-attempt and stored-format witnesses. @internal */
export const completedResultQuery = String.raw`/* reference */ SELECT r.result_id, r.analysis, r.environment, r.encoding, r.index_version, a.state
      FROM history_results r LEFT JOIN history_attempts a ON a.attempt_id = r.result_id WHERE r.result_id = ?`;

/** Validated storage identity, distinct from a current evaluation's acceptance. @internal */
export interface IResolvedCompletedResult {
  readonly resultId: number;
  readonly scope: IHistoryScope;
}

/**
 * Validate the canonical reference before interpreting its exact stored row.
 * The lookup is History-owned and has no candidate search or fallback policy.
 * @internal
 */
export function resolveCompletedResult(
  reference: ICompletedResultReference,
  logicalStore: string,
  lookup: (resultId: number) => ISqliteRow | undefined,
  expectedScope?: IHistoryScope,
): IResolvedCompletedResult {
  const parts = parseReference(reference);
  if (parts.logicalStore !== logicalStore) {
    throw new HistoryIntegrityError('Completed-result reference belongs to a different logical store');
  }
  if (expectedScope !== undefined && (parts.analysis !== expectedScope.analysis || parts.environment !== expectedScope.environment)) {
    throw new HistoryIntegrityError('Completed-result reference belongs to a different analysis or environment');
  }
  const row = lookup(parts.resultId);
  if (row === undefined) {
    throw new HistoryIntegrityError(`Missing exact completed result ${reference.locator}`);
  }
  if (row.analysis !== parts.analysis || row.environment !== parts.environment) {
    throw new HistoryIntegrityError('Completed-result reference scope does not match the stored result');
  }
  if (row.encoding !== payloadEncoding || row.index_version !== indexVersion) {
    throw new HistoryIntegrityError(`Stored result uses unsupported encoding ${String(row.encoding)} or index version ${String(row.index_version)}`);
  }
  if (row.state !== 'completed') {
    throw new HistoryIntegrityError('Stored result is not backed by a completed attempt');
  }
  return { resultId: parts.resultId, scope: { analysis: parts.analysis, environment: parts.environment } };
}
