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
import { HistoryBusyError } from '../dist/api/microdelta.alpha.js';

// The reusable source policy is an internal alpha contract, not a default public-package type.
// @ts-expect-error: The generated public tier must not export source retry policies.
export type { ISourceRetryPolicy as IPublicRetryPolicyMustRemainHidden } from 'microdelta';
// @ts-expect-error: The generated public tier must not expose retry decision observations.
export type { IRetryDecisionInput as IPublicRetryInputMustRemainHidden } from 'microdelta';

import type {
  IDeferralMode,
  IOperationAccounting,
  IOperationEvent,
  IOperationRequest,
  IOperationResponse,
  IRetryDecision,
  IRetryDecisionInput,
  IRetryAttemptSummary,
  IRetryFacts,
  IRetryHistory,
  IRetryOutcome,
  IRetrySourceScope,
  ISourceRetryPolicy,
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

// The facade carries History's exact alpha busy class to callers of durable workspaces.
expectAssignable<Error>(HistoryBusyError.prototype);

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

// Source policies see bounded readonly facts and same-operation attempt history.
declare const retryInput: IRetryDecisionInput;
declare const retryHistory: IRetryHistory;
declare const retryFacts: IRetryFacts;
const retrySource: IRetrySourceScope = { source: 'catalog', service: 'catalog-api', connection: 'org-a-read' };
const sourcePolicy: ISourceRetryPolicy = {
  id: 'catalog-retry',
  scope: retrySource,
  decide: (input) => input.outcome.kind === 'unknown' ? { kind: 'retry-now' } : { kind: 'stop' },
};
expectType<readonly IRetryDecisionInput['history']['prior'][number][]>(retryHistory.prior);
expectType<IRetryAttemptSummary | undefined>(retryHistory.prior[0]);
expectType<IRetryOutcome>(retryInput.outcome);
expectError(retryHistory.prior = []);
expectType<readonly string[] | undefined>(retryFacts.conditions);
expectType<IRetryDecision | Promise<IRetryDecision>>(sourcePolicy.decide(retryInput));
expectNotAssignable<IRetryDecision>({ kind: 'no-opinion' });
expectNotAssignable<IRetryDecision>({ kind: 'retry-now', maxAttempts: 99 });
expectNotAssignable<IRetryFacts>({ headers: { authorization: 'secret' } });
expectAssignable<IOperationRequest<number>>({
  name: 'catalog-read', binding: 'sha256:request', retrySource,
  perform: () => Promise.resolve({ kind: 'failed', transient: false, retryFacts: { httpStatus: 404, conditions: ['resource-expected-later'] } }),
});
expectAssignable<Pick<IWorkspaceRunOptions<object, object>, 'retryPolicies'>>({ retryPolicies: [sourcePolicy] });

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
