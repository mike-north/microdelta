/**
 * Shared fixtures for the operation-journal and environment-namespace suites.
 * They compose History's durable authority with Node's real SQLite capability
 * through the durable-history support module and add only the illustrative
 * owner-defined record formats and environment scopes those suites use.
 * History must treat every format here as opaque data.
 * @packageDocumentation
 */
import type {
  IAttemptRequest,
  ICompletedResultReference,
  IDurableHistory,
  IHistoryScope,
  IJournalFormat,
  IVersionedRecord,
  IWriterLease,
} from '@microdelta/history';

/** The analysis every environment below belongs to. */
export const analysis = 'analysis:contributors';

/** A trial environment of the analysis. */
export const trial: IHistoryScope = Object.freeze({ analysis, environment: 'env:trial' });

/** The production environment of the same analysis. */
export const production: IHistoryScope = Object.freeze({ analysis, environment: 'env:production' });

/** An illustrative Supervision operation-record format; History must not interpret it. */
export const operationFormat = 'test.supervision.operation';

/** An illustrative Supervision deferral-record format, a separate collection. */
export const deferralFormat = 'test.supervision.deferral';

/** A port declaration that understands only version 1 of both formats. */
export const versionOne: readonly IJournalFormat[] = Object.freeze([
  { format: operationFormat, versions: [1] },
  { format: deferralFormat, versions: [1] },
]);

/** An operation record of the given version and content. */
export function operation(content: unknown, formatVersion = 1): IVersionedRecord {
  return { format: operationFormat, formatVersion, content };
}

/** A deferral record of the given content. */
export function deferral(content: unknown): IVersionedRecord {
  return { format: deferralFormat, formatVersion: 1, content };
}

/** Acquire the writer or fail the test. */
export function acquire(history: IDurableHistory, holder = 'writer', leaseMilliseconds = 10_000): IWriterLease {
  const acquisition = history.acquireWriter({ holder, leaseMilliseconds });
  if (acquisition.kind !== 'acquired') {
    throw new Error(`expected to acquire, observed ${JSON.stringify(acquisition)}`);
  }
  return acquisition.lease;
}

/** An attempt request for one subject in one environment. */
export function attempt(scope: IHistoryScope, subject: string, attemptKey: string, overrides: Partial<IAttemptRequest> = {}): IAttemptRequest {
  return { ...scope, subject, version: 1, attemptKey, intentDigest: `intent:${attemptKey}`, ...overrides };
}

/** Allocate, stage and publish one result in `scope`; returns its exact reference. */
export function publish(
  history: IDurableHistory,
  lease: IWriterLease,
  scope: IHistoryScope,
  subject: string,
  options: { readonly key: string; readonly payload?: unknown; readonly dependencies?: readonly ICompletedResultReference[] },
): ICompletedResultReference {
  const allocated = history.allocateAttempt(lease, attempt(scope, subject, options.key));
  history.stageAttempt(lease, {
    attemptId: allocated.attemptId,
    payload: options.payload ?? { label: options.key },
    provenance: { format: 'test.resolution.provenance', formatVersion: 1, content: { label: options.key } },
    dependencies: options.dependencies ?? [],
  });
  return history.publishAttempt(lease, allocated.attemptId);
}

/** Versioned acceptance evidence in an illustrative Resolution format. */
export function acceptanceEvidence(check: string): IVersionedRecord {
  return { format: 'test.acceptance', formatVersion: 1, content: { check } };
}

/** Versioned promotion evidence in an illustrative operator format. */
export function promotionEvidence(reason: string): IVersionedRecord {
  return { format: 'test.promotion', formatVersion: 1, content: { reason, promotedBy: 'operator:ada' } };
}
