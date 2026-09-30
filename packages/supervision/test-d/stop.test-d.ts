/**
 * Type contracts for operator stop intent, sends and the cancellation port:
 * a stop request names only a soft or hard level, and a deadline is a number;
 * stop state is read-only; the abort signal a body receives cannot be
 * aborted by it; a send keeps its result type and needs a perform function;
 * run events about stops and sends carry identifiers, levels and states only,
 * never values (RUN-013); the timer is structural, so the Machine timer fits
 * without Supervision naming it.
 *
 * @see ../../../docs/spec/operations.md (RUN-013, RUN-014)
 */
import { expectAssignable, expectError, expectNotAssignable, expectType } from 'tsd';
import type { IExecutionSupervision, ISupervisedExecution } from '@microdelta/resolution';

import { createStopController } from '../dist/src/index.js';
import type {
  IAbortSignal,
  IRemoteState,
  IResolutionPorts,
  IRunEvent,
  IRunExecution,
  IRunResult,
  IRunTimer,
  ISendInterruption,
  ISendRequest,
  IStopController,
  IStopLevel,
  IStopRequest,
  IStopState,
} from '../dist/src/index.js';

declare const execution: IRunExecution;
declare const controller: IStopController;
declare const result: IRunResult<string>;
declare const ports: IResolutionPorts;

// Stop requests: only soft or hard; a deadline is epoch milliseconds.
expectAssignable<IStopRequest>({ level: 'soft' });
expectAssignable<IStopRequest>({ level: 'soft', deadline: 1_767_225_600_000 });
expectAssignable<IStopRequest>({ level: 'hard' });
expectNotAssignable<IStopRequest>({ level: 'none' });
expectNotAssignable<IStopRequest>({ level: 'pause' });
expectNotAssignable<IStopRequest>({ level: 'soft', deadline: '10m' });

// Stop state is read-only intent.
expectType<IStopLevel>(controller.state.level);
expectType<IStopState>(result.stop);
expectError((controller.state.level = 'none'));
expectType<void>(controller.request({ level: 'soft' }));
expectType<() => void>(controller.subscribe((state: IStopState) => { void state; }));

// The signal is observe-only: it has no abort operation.
expectType<boolean>(execution.signal.aborted);
expectNotAssignable<{ abort(): void }>(execution.signal);
expectType<() => void>(execution.signal.onAbort(() => undefined));
expectError((execution.signal.aborted = true));

// Sends keep their result type; perform is required and receives the signal.
expectType<Promise<number>>(execution.send({ label: 'assess', perform: (signal: IAbortSignal) => Promise.resolve(signal.aborted ? 0 : 1) }));
expectType<Promise<string>>(execution.send({ label: 'assess', retry: true, perform: () => Promise.resolve('ok'), cancel: () => Promise.resolve('cancelled' as const) }));
expectError(execution.send({ label: 'assess' }));
expectNotAssignable<ISendRequest<number>>({ label: 'assess', perform: () => Promise.resolve(1), cancel: () => Promise.resolve('gone') });
expectType<Promise<void>>(execution.sleepUntil(1_767_225_600_000));

// Stop and send events carry no value fields.
expectAssignable<IRunEvent>({ kind: 'stop', runId: 'run:1', level: 'soft', cause: 'operator' });
expectNotAssignable<IRunEvent>({ kind: 'stop', runId: 'run:1', level: 'none', cause: undefined });
expectAssignable<IRunEvent>({ kind: 'send', runId: 'run:1', label: 'assess', phase: 'begin' });
expectAssignable<IRunEvent>({ kind: 'send', runId: 'run:1', label: 'assess', phase: 'remote-state', remote: 'unknown' });
expectNotAssignable<IRunEvent>({ kind: 'send', runId: 'run:1', label: 'assess', phase: 'remote-state' });
expectNotAssignable<IRunEvent>({ kind: 'send', runId: 'run:1', label: 'assess', phase: 'end', value: 42 });
expectNotAssignable<IRunEvent>({ kind: 'send', runId: 'run:1', label: 'assess', phase: 'fail', message: 'provider said no' });

// Remote state is exactly cancelled, running or unknown, and an interruption records it.
expectAssignable<IRemoteState>('unknown');
expectNotAssignable<IRemoteState>('omitted');
expectType<readonly ISendInterruption[]>(result.interruptions);

// The cancellation port Resolution receives is Resolution's own contract.
expectType<IExecutionSupervision>(ports.execution);
expectType<number>(ports.window);
expectAssignable<ISupervisedExecution<number>>({ kind: 'interrupted', reason: 'a hard stop interrupted the step' });

// The timer is structural: any clock with one-shot scheduling fits.
const timer = {
  currentEpochMilliseconds: (): number => 0,
  schedule: (epochMilliseconds: number, callback: () => void, options?: { readonly keepAlive?: boolean }): (() => void) => {
    void epochMilliseconds;
    void callback;
    void options;
    return () => undefined;
  },
};
expectAssignable<IRunTimer>(timer);
expectType<IStopController>(createStopController({ timer }));
expectType<IStopController>(createStopController());
