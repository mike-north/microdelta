/**
 * Type contracts for History's alpha durable authority, checked against the
 * generated alpha rollup and absent from the public tier. The runtime
 * behavior is proven by the assembly suites in `packages/core/test/durable-history`.
 */
import { expectAssignable, expectError, expectType } from 'tsd';

import type {
  IAttemptRecord,
  ICompletedEnvelope,
  ICompletedResultReference,
  IDurableHistory,
  IDurableHistoryOptions,
  IRecoveryOutcome,
  IWriterAcquisition,
  IWriterContention,
  IWriterRenewal,
  IWriterLease,
} from '../dist/api/history.alpha.js';
import { HistoryIntegrityError, StaleWriterError, openDurableHistory } from '../dist/api/history.alpha.js';
import * as publicTier from '../dist/api/history.public.js';

declare const options: IDurableHistoryOptions;
declare const history: IDurableHistory;
declare const lease: IWriterLease;
declare const acquisition: IWriterAcquisition;
declare const recovery: IRecoveryOutcome;

expectType<IDurableHistory>(openDurableHistory(options));

// Options require every injected host capability and the logical store identity.
expectError(openDurableHistory({ sqlite: options.sqlite, clock: options.clock, location: 'x', logicalStore: 'y' }));
expectError(openDurableHistory({ sqlite: options.sqlite, sha256: options.sha256, location: 'x', logicalStore: 'y' }));
expectError(openDurableHistory({ clock: options.clock, sha256: options.sha256, location: 'x', logicalStore: 'y' }));

// Only an acquired outcome carries a lease; held and contended outcomes grant nothing.
if (acquisition.kind === 'acquired') {
  expectType<IWriterLease>(acquisition.lease);
} else {
  expectType<'held' | 'contended'>(acquisition.kind);
  expectError(acquisition.lease);
}
if (acquisition.kind === 'contended') {
  // Contention names the recorded writer when it could be read, never an invented one.
  expectType<IWriterLease | undefined>(acquisition.writer);
  expectType<string>(acquisition.detail);
}

// Renewal reports a renewed lease or contention; only renewed carries a lease.
const renewal: IWriterRenewal = history.renewWriter(lease, 100);
if (renewal.kind === 'renewed') {
  expectType<IWriterLease>(renewal.lease);
} else {
  expectType<IWriterContention>(renewal);
  expectError(renewal.lease);
}
expectError<IWriterLease>(history.renewWriter(lease, 100));

// Leases, envelopes and records are read-only data.
expectError((lease.fence = 2));
declare const envelope: ICompletedEnvelope;
expectError((envelope.reference = envelope.reference));
expectType<readonly ICompletedResultReference[]>(envelope.dependencies);

// Mutations require a lease; read-only recovery and lookup do not.
expectError(history.publishAttempt(1));
expectError(history.allocateAttempt({ analysis: 'a', environment: 'e', subject: 's', version: 1, attemptKey: 'k', intentDigest: 'i' }));
expectType<IRecoveryOutcome>(history.recoverAttempt({ analysis: 'a', environment: 'e', subject: 's', version: 1, attemptKey: 'k', intentDigest: 'i' }));
// An attempt request must name both its stable key and its intent digest.
expectError(history.recoverAttempt({ analysis: 'a', environment: 'e', subject: 's', version: 1, attemptKey: 'k' }));

// Only a completed recovery exposes an exact reference.
if (recovery.kind === 'completed') {
  expectType<ICompletedResultReference>(recovery.reference);
  expectType<IAttemptRecord>(recovery.attempt);
} else if (recovery.kind === 'absent') {
  expectError(recovery.attempt);
} else {
  expectError(recovery.reference);
}

// Failure classes are Error subclasses; their runtime distinctness is asserted by the assembly suites.
expectAssignable<Error>(new HistoryIntegrityError('x'));
expectAssignable<Error>(new StaleWriterError('x'));

// The durable authority is project-private: the public tier does not export it.
expectError(publicTier.openDurableHistory);
