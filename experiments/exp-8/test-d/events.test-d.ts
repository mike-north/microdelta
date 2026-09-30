/**
 * EXP-8 type contracts: the inspection event schema admits identifiers, closed
 * status and reason codes, timings, usage figures and exact references only;
 * diagnostics have no free-form message; an operation declaration's retry
 * policy is explicit.
 */
import { expectAssignable, expectError, expectNotAssignable } from 'tsd';

import type { IDiagnostic, IEvent, IEventFields, IMemberOutcome, IOperationDeclaration, IReasonCode } from '../src/protocol.js';

declare const base: IEvent;

/** A well-formed event: identifiers, status, reason, usage figures and a reference. */
expectAssignable<IEvent>({
  sequence: 1,
  at: 0,
  kind: 'published',
  runId: 'run-1',
  member: 'm-ok',
  stepAttemptId: 'step-2',
  reference: 'result-9',
  status: 'completed',
  quantities: { tokens: 100 },
});

/** No payload-bearing field exists on an event. */
expectError<IEvent>({ ...base, output: { summary: 'x' } });
expectError<IEvent>({ ...base, binding: { prompt: 'x' } });
expectError<IEvent>({ ...base, message: 'provider said x' });
expectError<IEventFields>({ kind: 'request-settled', body: 'x' });

/** Reasons and statuses are closed vocabularies, not free text. */
expectNotAssignable<IReasonCode>('connection reset: provider body');
expectError<IEvent>({ ...base, status: 'provider body text' });

/** Usage figures are numbers by unit; a value smuggled into a quantity is refused. */
expectError<IEvent>({ ...base, quantities: { tokens: 'x' } });

/** A diagnostic is a code plus identifiers; there is no message. */
expectAssignable<IDiagnostic>({ code: 'observer-failed', at: 0, observer: 0, sequence: 3 });
expectError<IDiagnostic>({ code: 'observer-failed', at: 0, message: 'boom' });

/** A retry policy states both limits; a bare flag is not a policy. */
expectAssignable<IOperationDeclaration>({ name: 'summarize', binding: null, retry: { maxAttempts: 2, backoffMs: 0 } });
expectError<IOperationDeclaration>({ name: 'summarize', binding: null, retry: true });

/** Outcomes: waiting always states its time; unknown-outcome names its operation. */
expectAssignable<IMemberOutcome>({ status: 'waiting', notBefore: 1 });
expectNotAssignable<IMemberOutcome>({ status: 'waiting' });
expectNotAssignable<IMemberOutcome>({ status: 'unknown-outcome' });
