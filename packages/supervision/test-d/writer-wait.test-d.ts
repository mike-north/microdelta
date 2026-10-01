/**
 * Type contracts for waiting for the writer lease: the writer port only tries
 * and reports a closed set of outcomes, a held outcome always names its
 * holder, the operator's wait policy is optional data with no required
 * deadline, and the writer-busy error is a typed Supervision error carrying
 * the observation it gave up on.
 *
 * @see ../../../docs/spec/operations.md (RUN-002 owner decision)
 * @see ../../../docs/spec/execution.md (PUB-005)
 */
import { expectAssignable, expectError, expectNotAssignable, expectType } from 'tsd';

import { SupervisionError, WriterBusyError } from '../dist/src/index.js';
import type { IPromotionRecord, IPromotionRequest, IRun, IRunLease, IRunOperationName, IRunPromotionPort, IRunOptions, IRunWriter, ISupervisionErrorCode, IWriterAttempt, IWriterBusyObservation, IWriterWaitOptions } from '../dist/src/index.js';

declare const lease: IRunLease;
declare const attempt: IWriterAttempt;
declare const busy: WriterBusyError;
declare const writer: IRunWriter;
declare const options: IRunOptions;
declare const run: IRun;

// The port's one try returns an outcome; it is not a lease getter.
expectType<IWriterAttempt>(writer.tryLease());
expectNotAssignable<IRunWriter>({ lease: (): IRunLease => lease, release: (): void => undefined });
expectAssignable<IRunWriter>({ tryLease: (): IWriterAttempt => ({ kind: 'acquired', lease }), release: (): void => undefined });

// The outcomes are closed and discriminated; only a grant carries a lease.
expectType<'acquired' | 'held' | 'contended'>(attempt.kind);
if (attempt.kind === 'held') {
  expectType<string>(attempt.holder);
  expectType<number>(attempt.expiresAt);
  expectError(attempt.lease);
}
if (attempt.kind === 'contended') {
  expectType<string | undefined>(attempt.holder);
  expectType<string>(attempt.detail);
}
expectNotAssignable<IWriterAttempt>({ kind: 'held', expiresAt: 1 });
expectNotAssignable<IWriterAttempt>({ kind: 'waiting' });
expectNotAssignable<IWriterBusyObservation>({ kind: 'acquired', lease });

// The operator's policy is optional; there is no required deadline.
expectAssignable<IWriterWaitOptions>({});
expectAssignable<IWriterWaitOptions>({ deadline: 1, pollMilliseconds: 250 });
expectNotAssignable<IWriterWaitOptions>({ deadline: '2026-09-30' });
expectType<IWriterWaitOptions | undefined>(options.writerWait);

// Writer-busy is a typed Supervision error with the observation it gave up on.
expectAssignable<SupervisionError>(busy);
expectType<ISupervisionErrorCode>(busy.code);
expectAssignable<ISupervisionErrorCode>('writer-busy');
expectNotAssignable<ISupervisionErrorCode>('writer-unavailable');
expectType<string | undefined>(busy.holder);
expectType<number | undefined>(busy.expiresAt);
expectType<number>(busy.deadline);
expectType<boolean>(busy.contended);
expectType<boolean>(busy.heldByThisRun);
// A contended try must say whether the recorded writer is the run's own lease.
expectNotAssignable<IWriterAttempt>({ kind: 'contended', holder: undefined, expiresAt: undefined, detail: 'busy' });
expectAssignable<IWriterAttempt>({ kind: 'contended', holder: undefined, expiresAt: undefined, detail: 'busy', heldByThisRun: false });
expectType<WriterBusyError>(new WriterBusyError({ kind: 'held', holder: 'run:other', expiresAt: 2 }, 1));
expectError(new WriterBusyError({ kind: 'acquired', lease }, 1));
expectError(new WriterBusyError({ kind: 'held', holder: 'run:other', expiresAt: 2 }));

// A promotion is a named run operation over the structural promotion port; reading promotions is one too.
declare const promotionRequest: IPromotionRequest;
expectType<Promise<IPromotionRecord>>(run.promote(promotionRequest));
expectType<Promise<readonly IPromotionRecord[]>>(run.promotions());
expectAssignable<IRunOperationName>('promote');
expectAssignable<IRunOperationName>('promotions');
expectNotAssignable<IRunOperationName>('withWriterLease');
expectError(run.withWriterLease);
expectError(run.promote({ references: [], evidence: { format: 'f', formatVersion: 1, content: null } }));
expectType<IRunPromotionPort | undefined>(options.promotion);
