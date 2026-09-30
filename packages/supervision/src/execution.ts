/**
 * A live run's execution machinery: the run frame attached to its
 * asynchronous scope, the cancellation port Resolution runs admitted bodies
 * through, and the execution controls author code finds by scoped lookup
 * (RUN-001, RUN-002, RUN-014, RUN-015; EXP-8 mechanisms 1 and 2).
 *
 * Stop intent reaches work at exactly these points:
 *
 * - **Admitted bodies** run through {@link supervisedExecution}, each in its
 *   own attempt frame. A hard stop interrupts the wait for a body at once,
 *   even one that never settles (arbitrary JavaScript is not forcibly
 *   cancelled; its later result is simply never used). A body whose send or
 *   wait was refused or aborted is *tainted*: whatever it returns or throws,
 *   its execution ends `interrupted`, so partial work is never published.
 * - **The publication commit** asks {@link ISupervisedRun.publicationRefusal}
 *   in the same synchronous turn as the commit: a hard stop effective before
 *   it discards the output, one after it cannot undo it.
 * - **Sends** hold one permit each, and only while in flight. A hard stop
 *   refuses new sends, ends permit waits and aborts sends in flight (then asks
 *   the provider to cancel where it can and records the remote state). A soft
 *   stop refuses retries and any send outside an admitted step, while a
 *   draining step's first attempts proceed. A tainted attempt sends nothing
 *   more.
 * - **Waits for a time** hold no permit and end at once on any stop, because
 *   the retry they precede is forbidden.
 *
 * Nothing here decides reuse, touches History or reads a host timer: the
 * timer is injected.
 */
import type { IBindingDescriptor } from '@microdelta/definition';
import type { IExecutionSupervision, ISupervisedExecution } from '@microdelta/resolution';

import type { IRemoteState, IRunContext, IRunEvent, IRunExecution, ISendInterruption, ISendPhase, ISendRequest } from './contracts.js';
import type { IAbortSignal, IAbortSource, IRunTimer, IStopController, IStopState } from './control.js';
import { SupervisionError } from './errors.js';
import type { IPermitPool } from './permits.js';

/**
 * One admitted step's execution inside a run: which step it is, and the
 * first reason stop intent refused or aborted something it did. A tainted
 * attempt can never publish, whatever its body later returns.
 */
export interface IAttemptFrame {
  readonly step: IBindingDescriptor;
  taint: string | undefined;
}

/**
 * Everything one live run owns for execution control. `hard` aborts on a hard
 * stop, `stopped` on any stop; both are observed only while the run is open,
 * so a stop requested after it closed never reaches its (finished) work.
 */
export interface ISupervisedRun {
  readonly context: IRunContext;
  /** False once the body and every started operation settled. */
  open: boolean;
  readonly controller: IStopController;
  readonly hard: IAbortSource;
  readonly stopped: IAbortSource;
  readonly permits: IPermitPool;
  readonly timer: IRunTimer | undefined;
  /** Every send a hard stop aborted, with its remote state, in order. */
  readonly interruptions: ISendInterruption[];
  /** Offer an event to observers; a failure becomes a diagnostic. */
  report(event: IRunEvent, position: string): void;
  /** Account for an operation until it settles, rejecting it with `run-closed` if the run already closed. */
  track<T>(operation: () => Promise<T>): Promise<T>;
  /** Why a commit may not happen now, or undefined. */
  publicationRefusal(): string | undefined;
}

/**
 * What the run's asynchronous scope carries: the run, and the admitted
 * step attempt whose body is executing there, if any. A nested execution
 * gets its own frame; the parent's is restored when it returns or throws.
 */
export interface IRunFrame {
  readonly run: ISupervisedRun;
  readonly attempt: IAttemptFrame | undefined;
}

/** How a promise raced against a signal settled. */
type IRaced<T> = { readonly aborted: false; readonly value: T } | { readonly aborted: true };

/**
 * Race pending work against a signal. The signal wins even if the work never
 * settles; the work's later rejection is still handled, so it can never
 * surface as an unhandled rejection.
 */
export function raceAbort<T>(pending: Promise<T>, signal: IAbortSignal): Promise<IRaced<T>> {
  return new Promise<IRaced<T>>((resolve, reject) => {
    const remove = signal.onAbort(() => {
      resolve({ aborted: true });
    });
    pending.then((value) => {
      remove();
      resolve({ aborted: false, value });
    }, (error: unknown) => {
      remove();
      reject(error);
    });
  });
}

/** Start work that may throw synchronously, as a promise. */
function started<T>(work: () => T | Promise<T>): Promise<T> {
  try {
    return Promise.resolve(work());
  } catch (error: unknown) {
    return Promise.reject(error);
  }
}

/** The stop level the run observes now, for reasons: `soft` or `hard` once stopped. */
function observedLevel(run: ISupervisedRun): 'none' | 'soft' | 'hard' {
  return run.hard.signal.aborted ? 'hard' : run.stopped.signal.aborted ? 'soft' : 'none';
}

/**
 * The cancellation port Supervision hands to Resolution for one run. Each
 * execution runs in its own attempt frame inside the run's scope.
 * @param run - The live run.
 * @param enter - Run work with a frame attached to its asynchronous execution.
 * @returns The port.
 */
export function supervisedExecution(run: ISupervisedRun, enter: <T>(frame: IRunFrame, work: () => Promise<T>) => Promise<T>): IExecutionSupervision {
  return Object.freeze({
    async execute<T>(step: IBindingDescriptor, work: () => Promise<T>): Promise<ISupervisedExecution<T>> {
      if (!run.open) {
        return { kind: 'interrupted', reason: `run ${run.context.runId} has closed` };
      }
      if (run.hard.signal.aborted) {
        return { kind: 'interrupted', reason: 'a hard stop interrupted the step before it started' };
      }
      const attempt: IAttemptFrame = { step, taint: undefined };
      try {
        const raced = await raceAbort(started(() => enter({ run, attempt }, work)), run.hard.signal);
        if (raced.aborted) {
          return { kind: 'interrupted', reason: 'a hard stop interrupted the step' };
        }
        return attempt.taint === undefined ? { kind: 'returned', value: raced.value } : { kind: 'interrupted', reason: attempt.taint };
      } catch (error: unknown) {
        return attempt.taint === undefined ? { kind: 'threw', error } : { kind: 'interrupted', reason: attempt.taint };
      }
    },
    publicationRefusal: (): string | undefined => run.publicationRefusal(),
  });
}

/** Mark an attempt as unable to publish, keeping its first reason. */
function taint(attempt: IAttemptFrame | undefined, reason: string): void {
  if (attempt !== undefined) {
    attempt.taint ??= reason;
  }
}

/** A send request's fields, read and validated once. */
interface ISendFields<T> {
  readonly label: string;
  readonly retry: boolean;
  readonly perform: (signal: IAbortSignal) => Promise<T>;
  readonly cancel: (() => Promise<'cancelled' | 'running'>) | undefined;
}

/** Read and validate a send request. */
function sendFields<T>(request: ISendRequest<T>): ISendFields<T> {
  const label: unknown = typeof request === 'object' && request !== null ? request.label : undefined;
  const retry: unknown = typeof request === 'object' && request !== null ? request.retry : undefined;
  const perform: unknown = typeof request === 'object' && request !== null ? request.perform : undefined;
  const cancel: unknown = typeof request === 'object' && request !== null ? request.cancel : undefined;
  if (typeof label !== 'string' || label.length === 0) {
    throw new SupervisionError('invalid-request', 'A send needs a nonempty identifier label');
  }
  if (typeof perform !== 'function' || (retry !== undefined && typeof retry !== 'boolean') || (cancel !== undefined && typeof cancel !== 'function')) {
    throw new SupervisionError('invalid-request', `Send ${label} needs a perform function, an optional boolean retry and an optional cancel function`);
  }
  // Validated just above; the request's own declared types describe these members.
  return { label, retry: retry === true, perform: request.perform.bind(request), cancel: request.cancel?.bind(request) };
}

/**
 * The run's execution controls as seen from one frame: the run and, when the
 * lookup happened inside an admitted body, that step attempt.
 * @param frame - The frame the controls were looked up in.
 * @returns The controls.
 */
export function runControls(frame: IRunFrame): IRunExecution {
  const { run, attempt } = frame;

  /** Offer one send event. */
  const sendEvent = (label: string, phase: Exclude<ISendPhase, 'remote-state'>): void => {
    run.report(Object.freeze({ kind: 'send', runId: run.context.runId, label, phase }), `send ${label} ${phase}`);
  };

  /** Why stop intent refuses a send now, or undefined. */
  const sendRefusal = (retry: boolean): string | undefined => {
    if (attempt?.taint !== undefined) {
      return attempt.taint;
    }
    const level = observedLevel(run);
    if (level === 'hard') {
      return 'a hard stop refuses new sends';
    }
    if (level === 'soft' && retry) {
      return 'a soft stop refuses retries';
    }
    if (level === 'soft' && attempt === undefined) {
      return 'a soft stop admits no new work outside an admitted step';
    }
    return undefined;
  };

  /** Refuse a send: record it, taint the attempt and fail with `stopped`. */
  const refuse = (label: string, reason: string): never => {
    sendEvent(label, 'refused');
    taint(attempt, reason);
    throw new SupervisionError('stopped', `Send ${label} was refused: ${reason}`);
  };

  /** Ask the provider about aborted remote work, where it can say. */
  const remoteStateOf = async (label: string, cancel: ISendFields<unknown>['cancel']): Promise<IRemoteState> => {
    if (cancel === undefined) {
      return 'unknown';
    }
    sendEvent(label, 'cancel-requested');
    try {
      const answer: unknown = await cancel();
      return answer === 'cancelled' || answer === 'running' ? answer : 'unknown';
    } catch {
      return 'unknown';
    }
  };

  async function send<T>(fields: ISendFields<T>): Promise<T> {
    const { label, retry, perform, cancel } = fields;
    const before = sendRefusal(retry);
    if (before !== undefined) {
      return refuse(label, before);
    }
    // A retry, or a send outside an admitted step, is refused by any stop; a draining step's first attempt only by a hard stop.
    const permit = await run.permits.acquire(retry || attempt === undefined ? run.stopped.signal : run.hard.signal);
    const after = sendRefusal(retry);
    if (permit === undefined || after !== undefined) {
      // A permit granted after the stop is handed straight back.
      permit?.release();
      return refuse(label, after ?? 'a hard stop ended the wait for a permit');
    }
    sendEvent(label, 'begin');
    let raced: IRaced<T>;
    try {
      raced = await raceAbort(started(() => perform(run.hard.signal)), run.hard.signal);
    } catch (error: unknown) {
      permit.release();
      sendEvent(label, 'fail');
      throw error;
    }
    permit.release();
    if (!raced.aborted) {
      sendEvent(label, 'end');
      return raced.value;
    }
    sendEvent(label, 'aborted');
    const remote = await remoteStateOf(label, cancel);
    run.report(Object.freeze({ kind: 'send', runId: run.context.runId, label, phase: 'remote-state', remote }), `send ${label} remote-state`);
    run.interruptions.push(Object.freeze({ label, remote }));
    const reason = 'a hard stop aborted a send in flight';
    taint(attempt, reason);
    throw new SupervisionError('stopped', `Send ${label} was aborted: ${reason}`);
  }

  async function sleep(epochMilliseconds: number, timer: IRunTimer): Promise<void> {
    const level = observedLevel(run);
    const before = attempt?.taint ?? (level === 'none' ? undefined : `a ${level} stop refuses the wait`);
    if (before !== undefined) {
      taint(attempt, before);
      throw new SupervisionError('stopped', `The wait was refused: ${before}`);
    }
    await new Promise<void>((resolve, reject) => {
      let cancelTimer: () => void = () => undefined;
      const remove = run.stopped.signal.onAbort(() => {
        cancelTimer();
        const reason = `a ${observedLevel(run)} stop ended the wait`;
        taint(attempt, reason);
        reject(new SupervisionError('stopped', `The wait ended early: ${reason}`));
      });
      cancelTimer = timer.schedule(epochMilliseconds, () => {
        remove();
        resolve();
      }, { keepAlive: true });
    });
  }

  return Object.freeze({
    runId: run.context.runId,
    step: attempt?.step,
    get stop(): IStopState {
      return run.controller.state;
    },
    signal: run.hard.signal,
    send<T>(request: ISendRequest<T>): Promise<T> {
      let fields: ISendFields<T>;
      try {
        fields = sendFields(request);
      } catch (error: unknown) {
        return Promise.reject(error);
      }
      return run.track(() => send(fields));
    },
    sleepUntil(epochMilliseconds: number): Promise<void> {
      if (!Number.isSafeInteger(epochMilliseconds)) {
        return Promise.reject(new SupervisionError('invalid-request', 'A wait needs a whole epoch millisecond time'));
      }
      const timer = run.timer;
      if (timer === undefined) {
        return Promise.reject(new SupervisionError('invalid-request', 'This Supervision has no timer to wait with'));
      }
      return run.track(() => sleep(epochMilliseconds, timer));
    },
  });
}
