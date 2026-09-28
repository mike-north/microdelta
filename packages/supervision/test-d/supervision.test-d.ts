/**
 * Type contracts for Supervision's alpha surface: the scope capability is
 * structural (any host async context fits, nothing Machine-specific is
 * required), run operations take caller request options and return
 * Resolution's typed outcomes, observers are observe-only, and the run
 * context is read-only.
 *
 * @see ../../../docs/spec/operations.md (RUN-001)
 * @see ../../../docs/plans/m3-contribution-analysis.md (Supervision and actual consumer path)
 */
import { expectAssignable, expectError, expectNotAssignable, expectType } from 'tsd';
import type { IBindingDescriptor } from '@microdelta/definition';
import type { ICheckOutcome, ILifecyclePhase, IRecoveryResult, IResolutionOutcome } from '@microdelta/resolution';

import { SupervisionError, createSupervision, ordinaryLifecycle, stepLifecycle } from '../dist/src/index.js';
import type { IOrdinaryPhase, IRun, IRunContext, IRunEvent, IRunObserver, IRunResult, IRunScopeCapability, ISupervisionErrorCode } from '../dist/src/index.js';

declare const step: IBindingDescriptor;
declare const run: IRun;

// Any structurally matching async-context host fits; no Machine type is named.
const scopes = {
  createAsyncContext<T>(): { getStore(): T | undefined; run<R>(value: T, callback: () => R): R } {
    throw new Error('type-only');
  },
};
expectAssignable<IRunScopeCapability>(scopes);
expectError(createSupervision({ context: { createAsyncContext: () => ({ getStore: () => undefined }) } }));

// Operations take caller request options and return Resolution's outcomes.
expectType<Promise<IResolutionOutcome>>(run.resolve(step, { requestKey: 'request:1' }));
expectType<Promise<ICheckOutcome>>(run.check(step));
expectType<Promise<IRecoveryResult>>(run.recover(step, { requestKey: 'request:1' }));
expectError(run.resolve(step));
expectError(run.resolve(step, {}));
expectType<Promise<number>>(run.ordinary('count', () => 1));
expectType<Promise<string>>(run.ordinary('text', async () => 'report'));

// The run context is read-only volatile metadata.
declare const context: IRunContext;
expectError((context as { readonly environment: string }).environment = 'other');
expectType<string>(context.environment);

// Observers are observe-only: no next(), no replacement of work.
expectAssignable<IRunObserver>({ observe: (event: IRunEvent): void => void event });
expectNotAssignable<IRunObserver>({ wrap: (next: () => void): void => next() });

// Results carry the body's awaited value and diagnostics.
declare const result: IRunResult<string>;
expectType<string>(result.value);
expectType<readonly string[]>(result.diagnostics);

// Errors carry a closed code set.
declare const failure: SupervisionError;
expectType<ISupervisionErrorCode>(failure.code);
expectAssignable<ISupervisionErrorCode>('outside-run');
expectNotAssignable<ISupervisionErrorCode>('retry');

// Fixed positions are published read-only.
expectAssignable<readonly ILifecyclePhase[]>(stepLifecycle);
expectNotAssignable<ILifecyclePhase[]>(stepLifecycle);
expectType<readonly IOrdinaryPhase[]>(ordinaryLifecycle);
expectNotAssignable<IOrdinaryPhase[]>(ordinaryLifecycle);

// The published step positions are the exact ordered literals, and every
// phase Resolution can emit is listed: a new phase must be placed explicitly.
expectType<'verify'>(stepLifecycle[0]);
expectType<'abandon'>(stepLifecycle[9]);
declare const unlisted: Exclude<ILifecyclePhase, (typeof stepLifecycle)[number]>;
expectType<never>(unlisted);

// A run's open state is observable but only Supervision changes it.
expectType<boolean>(run.open);
expectError((run as { readonly open: boolean }).open = false);
