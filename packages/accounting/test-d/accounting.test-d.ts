/**
 * Type contracts for Accounting's alpha surface: a usage gap cannot be read as
 * zero (an incomplete summary always names at least one unknown request, a
 * known one names none), acknowledgment outcomes are a closed union, writes
 * take no writer lease or fence, recorded facts are read-only, and the SQLite
 * adapter needs only the Machine SQLite capability.
 *
 * @see ../../../docs/spec/operations.md (ACC-003, ACC-005, ACC-006, ACC-007)
 */
import { expectAssignable, expectError, expectNotAssignable, expectType } from 'tsd';
import type { ISqliteCapability } from '@microdelta/machine';

import { AccountingDurabilityUnknownError, UnattributableUsageError, openDurableAccounting } from '../dist/src/index.js';
import type {
  IDurableAccounting,
  IEstimateOutcome,
  IRecordedEstimate,
  IUnattributableReason,
  IUnknownUsage,
  IUsageAcknowledgment,
  IUsageIntent,
  IUsageIntentOutcome,
  IUsageQuantity,
  IUsageReport,
  IUsageSummary,
} from '../dist/src/index.js';

declare const sqlite: ISqliteCapability;
declare const accounting: IDurableAccounting;
declare const summary: IUsageSummary;
declare const acknowledgment: IUsageAcknowledgment;

// The adapter is assembled from the Machine SQLite capability alone.
expectType<IDurableAccounting>(openDurableAccounting({ sqlite, location: '/tmp/accounting.sqlite', logicalStore: 'store' }));
expectError(openDurableAccounting({ location: '/tmp/accounting.sqlite', logicalStore: 'store' }));
expectError(openDurableAccounting({ sqlite, location: '/tmp/accounting.sqlite' }));

const intent = { environment: 'production', operation: 'op-1', requestAttempt: 'req-1', attribution: { run: 'run-1', member: null, stepAttempt: null } } as const;
expectType<IUsageIntentOutcome>(accounting.recordUsageIntent(intent));
expectAssignable<IUsageIntentOutcome>('recorded');
expectAssignable<IUsageIntentOutcome>('duplicate');
expectNotAssignable<IUsageIntentOutcome>('pending');
// A request attempt is named `requestAttempt`; the old `request` spelling is not accepted.
expectNotAssignable<IUsageIntent>({ environment: 'production', operation: 'op-1', request: 'req-1', attribution: { run: 'run-1', member: null, stepAttempt: null } });
// Attribution names the run explicitly; member and step attempt are explicit nulls when absent.
expectError(accounting.recordUsageIntent({ environment: 'production', operation: 'op-1', requestAttempt: 'req-1', attribution: { run: 'run-1' } }));

const report: IUsageReport = { environment: 'production', operation: 'op-1', requestAttempt: 'req-1', report: 'usage-1', quantities: [{ unit: 'tokens', amount: 1 }] };
expectType<IUsageAcknowledgment>(accounting.acknowledgeUsage(report));
// Accounting writes are keyed facts: they take no writer lease or fence.
expectError(accounting.acknowledgeUsage({ ...report, lease: { holder: 'run-1', fence: 1, expiresAt: 0 } }));
expectError(accounting.acknowledgeUsage({ ...report, fence: 1 }));

// Acknowledgment outcomes are a closed union.
switch (acknowledgment.kind) {
  case 'acknowledged':
  case 'duplicate':
  case 'conflict':
    expectType<IUsageReport['quantities']>(acknowledgment.report.quantities);
    break;
  default:
    expectType<never>(acknowledgment);
}

// A usage gap cannot be read as zero: the discriminant carries the unknown list.
if (summary.status === 'incomplete') {
  expectType<IUnknownUsage>(summary.unknown[0]);
} else {
  expectType<'complete'>(summary.status);
  expectType<readonly []>(summary.unknown);
}
expectNotAssignable<IUsageSummary>({
  environment: 'production', status: 'incomplete', unknown: [], observed: [], operations: 1, requestAttempts: 1, reports: 0, estimates: [],
});
expectNotAssignable<IUsageSummary>({
  environment: 'production',
  status: 'complete',
  unknown: [{ operation: 'op-1', requestAttempt: 'req-1', attribution: { run: 'run-1', member: null, stepAttempt: null } }],
  observed: [],
  operations: 1,
  requestAttempts: 1,
  reports: 0,
  estimates: [],
});

// Observations and estimates are separate, read-only collections.
expectType<readonly IUsageQuantity[]>(summary.observed);
expectType<readonly IRecordedEstimate[]>(summary.estimates);
expectNotAssignable<IUsageQuantity[]>(summary.observed);
expectNotAssignable<IRecordedEstimate[]>(summary.estimates);
expectError((summary.observed[0] ?? { unit: 'tokens', amount: 0 }).amount = 1);

// A summary is always scoped to one environment.
expectType<IUsageSummary>(accounting.summarizeUsage({ environment: 'production', run: 'run-1' }));
expectError(accounting.summarizeUsage({ run: 'run-1' }));

declare const estimateOutcome: IEstimateOutcome;
if (estimateOutcome.kind === 'conflict') {
  expectType<IRecordedEstimate>(estimateOutcome.estimate);
}

// Refusals and unknown durability are distinguishable classes.
declare const refusal: UnattributableUsageError;
expectType<IUnattributableReason>(refusal.reason);
expectAssignable<Error>(new AccountingDurabilityUnknownError('commit unconfirmed', new Error('io')));
