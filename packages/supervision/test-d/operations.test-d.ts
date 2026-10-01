/**
 * Type contracts for external operations: an operation keeps its result type
 * and needs a name, a binding and a perform function; an adapter classifies
 * each response as one of four closed kinds; the event schema has fields for
 * identifiers, closed status and reason codes, times, usage and remote state
 * only, never a binding, argument, value, provider body or error message
 * (RUN-013); a pending member names the block that holds it back; the ports
 * are structural; an operator settlement is resolve or abandon.
 *
 * @see ../../../docs/spec/operations.md (RUN-011, RUN-012, RUN-013)
 * @see ../../../experiments/exp-8/decision.md (mechanism 7)
 */
import { expectAssignable, expectError, expectNotAssignable, expectType } from 'tsd';

import { operationJournalDeclaration } from '../dist/src/index.js';
import type {
  IDeferralMode,
  IMemberOutcome,
  IOperationAccounting,
  IOperationBlock,
  IOperationEvent,
  IOperationJournalPort,
  IOperationRequest,
  IOperationResponse,
  IOperationSettlement,
  IOperationView,
  IRun,
  IRunEvent,
  IRunExecution,
  IRunOptions,
  IRunResult,
  IWaitEvent,
} from '../dist/src/index.js';

declare const execution: IRunExecution;
declare const run: IRun;
declare const event: IOperationEvent;
declare const result: IRunResult<string>;

// An operation keeps its result type.
const request: IOperationRequest<{ readonly verdict: string }> = {
  name: 'assess',
  binding: 'sha256:abc',
  perform: () => Promise.resolve({ kind: 'succeeded', value: { verdict: 'ok' } }),
};
expectType<Promise<{ readonly verdict: string }>>(execution.operation(request));
// It needs a name, a binding and a perform function.
expectError(execution.operation({ name: 'assess', perform: () => Promise.resolve({ kind: 'unknown' }) }));
expectError(execution.operation({ name: 'assess', binding: 'b' }));
// The retry policy and safety bases are optional and typed.
expectAssignable<IOperationRequest<number>>({ ...request, perform: () => Promise.resolve({ kind: 'succeeded', value: 1 }), safeToRepeat: true, retry: { maxAttempts: 3, backoffMilliseconds: 1_000, rateLimitRetries: 2 } });
expectError<IOperationRequest<number>>({ ...request, perform: () => Promise.resolve({ kind: 'succeeded', value: 1 }), retry: { maxAttempts: '3' } });

// Responses are four closed kinds; a value only on success.
expectAssignable<IOperationResponse<number>>({ kind: 'succeeded', value: 1, usage: { report: 'r', quantities: [{ unit: 'tokens', amount: 3 }] } });
expectAssignable<IOperationResponse<number>>({ kind: 'failed', transient: true });
expectAssignable<IOperationResponse<number>>({ kind: 'rate-limited', retryAt: 1_767_225_600_000 });
expectAssignable<IOperationResponse<number>>({ kind: 'unknown' });
expectNotAssignable<IOperationResponse<number>>({ kind: 'retry' });
expectNotAssignable<IOperationResponse<number>>({ kind: 'failed', value: 1 });

// Events carry identifiers, codes, times and usage only.
expectType<string>(event.operation);
expectType<string>(event.name);
expectType<number>(event.at);
expectType<string | undefined>(event.requestAttempt);
expectType<string | undefined>(event.stepAttempt);
expectType<string | undefined>(event.member);
expectError(event.binding);
expectError(event.value);
expectError(event.arguments);
expectError(event.body);
expectError(event.message);
expectError(event.error);
expectAssignable<IRunEvent>(event);
declare const wait: IWaitEvent;
expectType<number>(wait.until);
expectAssignable<IRunEvent>(wait);
expectError(wait.value);

// A pending member may name the block that holds it back.
declare const member: Extract<IMemberOutcome, { readonly status: 'pending' | 'cancelled' }>;
expectType<IOperationBlock | undefined>(member.blocked);
expectAssignable<IOperationBlock>({ kind: 'deferred', operation: 'op-1-1', notBefore: 1 });
expectAssignable<IOperationBlock>({ kind: 'unknown-outcome', operation: 'op-1-1', reason: 'not-repeat-safe' });
expectNotAssignable<IOperationBlock>({ kind: 'unknown-outcome', operation: 'op-1-1', reason: 'other' });

// The run reports the time it waits until.
expectType<number | undefined>(result.waitingUntil);

// Deferral modes are closed.
expectAssignable<IDeferralMode>('sleep');
expectAssignable<IDeferralMode>('exit');
expectNotAssignable<IDeferralMode>('wait');
expectAssignable<Pick<IRunOptions, 'deferral'>>({ deferral: 'exit' });

// Operator settlement: resolve with an outcome, or abandon.
expectAssignable<IOperationSettlement>({ action: 'resolve', operation: 'op-1-1', operator: 'operator.ada', outcome: 'succeeded' });
expectAssignable<IOperationSettlement>({ action: 'abandon', operation: 'op-1-1', operator: 'operator.ada' });
expectNotAssignable<IOperationSettlement>({ action: 'resolve', operation: 'op-1-1', operator: 'operator.ada' });
expectNotAssignable<IOperationSettlement>({ action: 'retry', operation: 'op-1-1', operator: 'operator.ada' });
expectType<Promise<IOperationView>>(run.settleOperation({ action: 'abandon', operation: 'op-1-1', operator: 'operator.ada' }));
expectType<Promise<readonly IOperationView[]>>(run.inspectOperations({ status: 'unknown' }));
declare const view: IOperationView;
expectError(view.binding);

// The ports are structural: any object with the right members fits, without naming History or Accounting.
expectAssignable<IOperationJournalPort>({
  commit: () => [],
  read: () => undefined,
  list: () => [],
});
expectAssignable<IOperationAccounting>({
  recordUsageIntent: () => 'recorded' as const,
  acknowledgeUsage: () => ({ kind: 'acknowledged' as const }),
});
expectNotAssignable<IOperationAccounting>({ recordUsageIntent: () => 'recorded' as const });
expectType<readonly { readonly format: string; readonly versions: readonly number[] }[]>(operationJournalDeclaration.formats);
