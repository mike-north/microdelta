/**
 * Type contracts of the facade's operational surface, as its generated alpha
 * declarations describe it:
 *
 * - Accounting is injected through a structural port: Resource Accounting's
 *   durable adapter satisfies it, so the published facade never names the
 *   Accounting package, yet a caller can hand that adapter to a workspace;
 * - a run selects its deferral mode, and its result reports when deferred
 *   work waits until;
 * - the run offers recorded promotion, the promotions into its environment
 *   and its environment's usage summary, but never hands out the writer
 *   lease itself;
 * - the operation handle's request and response shapes are facade aliases.
 *
 * @see ../../../docs/spec/operations.md (RUN-011, RUN-012, RUN-017, ACC-005)
 */
import type { IDurableAccounting } from '@microdelta/accounting';
import type { IDurableHistory } from '@microdelta/history';
import type { IRunPromotionPort } from '@microdelta/supervision';
import { expectAssignable, expectError, expectNotAssignable, expectType } from 'tsd';

import type {
  IDeferralMode,
  IOperationAccounting,
  IOperationEvent,
  IOperationRequest,
  IOperationResponse,
  IOperationView,
  IPromotionEvent,
  IPromotionRecord,
  IRunEvent,
  IRunResult,
  IUsageEstimate,
  IUsageSummary,
  IWaitEvent,
  IWorkspaceAccounting,
  IWorkspaceOptions,
  IWorkspaceRun,
  IWorkspaceRunOptions,
} from '../dist/api/microdelta.alpha.js';

declare const durable: IDurableAccounting;
declare const history: IDurableHistory;
declare const run: IWorkspaceRun;
declare const result: IRunResult<unknown>;
declare const runOptions: IWorkspaceRunOptions<object, object>;
declare const event: IRunEvent;

// Accounting's durable adapter is a structural Accounting port of the facade, and of Supervision's operation port the facade names.
expectAssignable<IWorkspaceAccounting>(durable);
expectAssignable<IOperationAccounting>(durable);
// History's durable store satisfies Supervision's structural promotion port, which the facade hands it as.
expectAssignable<IRunPromotionPort>(history);
expectNotAssignable<IRunPromotionPort>({ promoteResults: history.promoteResults });
expectAssignable<IWorkspaceOptions>({ location: 'store.sqlite', logicalStore: 'store:a', accounting: durable });
expectAssignable<IWorkspaceOptions>({ location: 'store.sqlite', logicalStore: 'store:a' });
// A port without a summary accessor is not enough for the facade.
expectNotAssignable<IWorkspaceAccounting>({ recordUsageIntent: durable.recordUsageIntent, acknowledgeUsage: durable.acknowledgeUsage });

// The deferral mode is closed.
expectType<IDeferralMode | undefined>(runOptions.deferral);
expectAssignable<IDeferralMode>('exit');
expectNotAssignable<IDeferralMode>('wait');
expectType<number | undefined>(result.waitingUntil);

// Promotion, promotions and usage are run operations; the lease is never handed out.
expectType<Promise<IPromotionRecord>>(run.promote({ into: 'env:production', references: [], evidence: { format: 'example.promotion', formatVersion: 1, content: null } }));
expectError(run.promote({ references: [], evidence: { format: 'example.promotion', formatVersion: 1, content: null } }));
expectType<Promise<readonly IPromotionRecord[]>>(run.promotions());
expectType<IUsageSummary>(run.usage());
expectType<IUsageSummary>(run.usage({ member: 'pr-1' }));
expectError(run.usage({ environment: 'env:other' }));
expectError(run.withWriterLease);
expectType<Promise<readonly IOperationView[]>>(run.inspectOperations());

// A summary keeps unknown usage apart from observed quantities, and estimates apart from both.
declare const summary: IUsageSummary;
expectType<readonly IUsageEstimate[]>(summary.estimates);
expectType<string>(summary.estimates[0]?.basis.format ?? '');
expectType<'complete' | 'incomplete'>(summary.status);
expectType<string>(summary.unknown[0]?.operation ?? '');

// The operation handle's shapes are facade aliases an author can name.
expectAssignable<IOperationRequest<number>>({ name: 'assess', binding: 'sha256:1', perform: () => Promise.resolve<IOperationResponse<number>>({ kind: 'succeeded', value: 1 }) });
expectNotAssignable<IOperationRequest<number>>({ name: 'assess', perform: () => Promise.resolve<IOperationResponse<number>>({ kind: 'succeeded', value: 1 }) });
expectAssignable<IOperationResponse<number>>({ kind: 'rate-limited', retryAt: 1 });

// Operation and wait events are members of the run's event union.
if (event.kind === 'operation') {
  expectType<IOperationEvent>(event);
}
if (event.kind === 'wait') {
  expectType<IWaitEvent>(event);
}
if (event.kind === 'promotion') {
  expectType<IPromotionEvent>(event);
  expectError(event.evidence);
}
