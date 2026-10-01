/**
 * Type contracts for History's alpha operation journal, environment-scoped
 * acceptances and recorded promotion, checked against the generated alpha
 * rollup and absent from the public tier. Runtime behavior is proven by the
 * assembly suites in `packages/core/test/journal`.
 */
import { expectAssignable, expectError, expectType } from 'tsd';

import type {
  IAcceptanceRecord,
  ICompletedResultReference,
  IDurableHistory,
  IJournalRecord,
  IOperationJournal,
  IPromotionRecord,
  IVersionedRecord,
  IWriterLease,
} from '../dist/api/history.alpha.js';
import { JournalConflictError, JournalVersionError } from '../dist/api/history.alpha.js';
import * as publicTier from '../dist/api/history.public.js';

declare const history: IDurableHistory;
declare const lease: IWriterLease;
declare const reference: ICompletedResultReference;
declare const record: IVersionedRecord;

const journal = history.openJournal({ formats: [{ format: 'owner.operation', versions: [1] }] });
expectType<IOperationJournal>(journal);

// A journal port must declare its formats and versions.
expectError(history.openJournal({}));
expectError(history.openJournal({ formats: [{ format: 'owner.operation' }] }));

// Commits require the writer lease, a namespace and compare-and-set expectations; reads do not need a lease.
expectType<readonly IJournalRecord[]>(journal.commit(lease, { analysis: 'a', environment: 'e', writes: [{ collection: 'operations', key: 'k', expectedRevision: 0, record }] }));
expectError(journal.commit({ analysis: 'a', environment: 'e', writes: [{ collection: 'operations', key: 'k', expectedRevision: 0, record }] }));
expectError(journal.commit(lease, { writes: [{ collection: 'operations', key: 'k', expectedRevision: 0, record }] }));
expectError(journal.commit(lease, { analysis: 'a', environment: 'e', writes: [{ collection: 'operations', key: 'k', record }] }));
// A record is addressed by an owner-named collection, never by its format tag.
expectError(journal.commit(lease, { analysis: 'a', environment: 'e', writes: [{ key: 'k', expectedRevision: 0, record }] }));
expectType<IJournalRecord | undefined>(journal.read({ analysis: 'a', environment: 'e', collection: 'operations', key: 'k' }));
expectError(journal.read({ analysis: 'a', environment: 'e', format: 'owner.operation', key: 'k' }));
expectType<readonly IJournalRecord[]>(journal.list({ analysis: 'a', environment: 'e', collection: 'operations' }));
expectError(journal.list({ analysis: 'a', environment: 'e', format: 'owner.operation' }));
declare const listed: IJournalRecord;
expectType<string>(listed.collection);

// Journal and promotion records are read-only data.
declare const stored: IJournalRecord;
expectError((stored.revision = 2));
expectError((stored.record = record));
declare const promotion: IPromotionRecord;
expectError((promotion.target = { analysis: 'a', environment: 'production' }));
expectType<readonly ICompletedResultReference[]>(promotion.references);

// Promotion requires the writer lease and names its target scope explicitly; reading promotions does not.
expectType<IPromotionRecord>(history.promoteResults(lease, { target: { analysis: 'a', environment: 'production' }, references: [reference], evidence: record }));
expectError(history.promoteResults({ target: { analysis: 'a', environment: 'production' }, references: [reference], evidence: record }));
expectError(history.promoteResults(lease, { analysis: 'a', environment: 'production', references: [reference], evidence: record }));
expectError(history.promoteResults(lease, { target: { analysis: 'a' }, references: [reference], evidence: record }));
expectType<readonly IPromotionRecord[]>(history.readPromotions({ target: { analysis: 'a', environment: 'production' } }));
expectType<readonly IPromotionRecord[]>(history.readPromotions({ target: { analysis: 'a', environment: 'production' }, reference }));
expectError(history.readPromotions({ analysis: 'a', environment: 'production' }));

// The accepting environment is always explicit: never inferred from the accepted reference.
expectType<IAcceptanceRecord>(history.recordAcceptance(lease, { reference, evidence: record, dependencies: [], environment: 'production' }));
expectError(history.recordAcceptance(lease, { reference, evidence: record, dependencies: [] }));
declare const acceptance: IAcceptanceRecord;
expectType<string>(acceptance.environment);
expectType<readonly IAcceptanceRecord[]>(history.readAcceptances(reference, 'production'));
expectError(history.readAcceptances(reference));

// Failure classes are Error subclasses; their runtime distinctness is asserted by the assembly suites.
expectAssignable<Error>(new JournalConflictError('x'));
expectAssignable<Error>(new JournalVersionError('x'));

// The journal and promotion surfaces are project-private: the public tier does not export them.
expectError(publicTier.JournalConflictError);
expectError(publicTier.JournalVersionError);
