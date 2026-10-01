/**
 * A live run's execution machinery: the run frame attached to its
 * asynchronous scope, the cancellation port Resolution runs admitted bodies
 * through, and the execution controls author code finds by scoped lookup
 * (RUN-001, RUN-002, RUN-014, RUN-015; EXP-8 mechanisms 1 and 2).
 *
 * Stop intent reaches work at exactly these points:
 *
 * - **Admission** (in the run engine): a soft stop cancels new work, except
 *   the first attempts of children an admitted, still-executing, untainted
 *   step's body demands, which belong to that step's drain unit
 *   ({@link isDraining}); a hard stop cancels everything.
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
 *   the retry they precede is forbidden. They also lend their member's window
 *   lane for their duration ({@link IMemberLane}).
 *
 * Nothing here decides reuse, touches History or reads a host timer: the
 * timer is injected.
 */
import type { IBindingDescriptor } from '@microdelta/definition';
import type { IExecutionSupervision, ISupervisedExecution } from '@microdelta/resolution';

import type { IRemoteState, IRunContext, IRunEvent, IRunExecution, ISendInterruption, ISendPhase, ISendRequest } from './contracts.js';
import { createAbortSource } from './control.js';
import type { IAbortSignal, IAbortSource, IRunTimer, IStopController, IStopState } from './control.js';
import { SupervisionError } from './errors.js';
import { createPermitPool } from './permits.js';
import type { IPermit, IPermitPool } from './permits.js';

/**
 * One admitted step's execution inside a run: which step it is, the first
 * reason stop intent refused or aborted something it did, and whether its
 * execution has ended. A tainted attempt can never publish, whatever its body
 * later returns. While an untainted attempt is still executing it is
 * *draining* under a soft stop: the children its body demands are part of its
 * drain unit and are admitted as first attempts.
 */
export interface IAttemptFrame {
  readonly step: IBindingDescriptor;
  taint: string | undefined;
  /** True once its execution returned, threw or was interrupted; a call made later belongs to no draining body. */
  ended: boolean;
}

/**
 * One fan-out member's place in the run's bounded active window. The member
 * holds a lane while it works. A timed wait lends the lane to the next
 * waiting member and, on waking, reclaims one ahead of members that have not
 * started, so a member waiting for a time never stalls its siblings and a
 * woken member never waits behind the remaining population. With several
 * waits in progress at once, the lane is lent at the first and reclaimed
 * after the last; meanwhile the member's other branches run without a lane
 * (the window bounds members holding a lane, not every branch of a body).
 */
export interface IMemberLane {
  /** The pool the lane is drawn from, lent back to and reclaimed from. */
  readonly pool: IPermitPool;
  /** The lane held now, if any. */
  permit: IPermit | undefined;
  /** Timed waits in progress in this member's work. */
  waits: number;
  /** True once the member's work settled; a late wake-up must not reclaim a lane. */
  closed: boolean;
}

/**
 * Whether an attempt is draining: executing, untainted, and so still
 * entitled under a soft stop to the first attempts of the children its body
 * demands (EXP-8: the drain unit is the admitted step attempt).
 */
export function isDraining(attempt: IAttemptFrame | undefined): boolean {
  return attempt !== undefined && attempt.taint === undefined && !attempt.ended;
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
  /** The lanes of the bounded active window of member fan-out. */
  readonly lanes: IPermitPool;
  readonly timer: IRunTimer | undefined;
  /** Every send a hard stop aborted, with its remote state, in order. */
  readonly interruptions: ISendInterruption[];
  /** Offer an event to observers; a failure becomes a diagnostic. */
  report(event: IRunEvent, position: string): void;
  /** Record a post-commit diagnostic of the run, such as a failing abort listener. */
  diagnose(message: string): void;
  /** Account for an operation until it settles, rejecting it with `run-closed` if the run already closed. */
  track<T>(operation: () => Promise<T>): Promise<T>;
  /** Why a commit may not happen now, or undefined. */
  publicationRefusal(): string | undefined;
}

/**
 * What the run's asynchronous scope carries: the run, the admitted step
 * attempt whose body is executing there, if any, the window lane of the
 * fan-out member it belongs to, if any, and the lane pool a member fan-out
 * started here draws from. A nested execution gets its own frame (inheriting
 * the member's lane and pool); the parent's is restored when it returns or
 * throws.
 *
 * Only the run's root frame draws from the run-wide window. A member's frame,
 * and the frame of a run operation started from inside a member or a step
 * attempt, each carry a single-lane pool of their own, so a fan-out started
 * there never waits for a lane that the work waiting for it holds (RUN-002's
 * nested rule): it resolves its members one at a time instead.
 */
export interface IRunFrame {
  readonly run: ISupervisedRun;
  readonly attempt: IAttemptFrame | undefined;
  readonly lane: IMemberLane | undefined;
  /** The pool a member fan-out started in this frame draws its lanes from. */
  readonly lanes: IPermitPool;
}

/**
 * The frame a run operation runs in, given the frame it was started from.
 * Started from the run body (or outside any member and attempt) it is the
 * run's root frame, whose fan-out draws from the run-wide window. Started
 * from inside a member or a step attempt (author code that kept the run and
 * called it there), it is a fresh frame with no attempt or lane and a
 * single-lane pool of its own: the caller may hold a run-wide lane while it
 * waits for this operation, so this operation's fan-out must never wait for
 * one (RUN-002's nested rule).
 * @param root - The run's root frame.
 * @param caller - The caller's frame of this run, if any.
 * @returns The operation's frame.
 */
export function operationFrame(root: IRunFrame, caller: IRunFrame | undefined): IRunFrame {
  if (caller === undefined || (caller.lane === undefined && caller.attempt === undefined)) {
    return root;
  }
  return Object.freeze({ run: root.run, attempt: undefined, lane: undefined, lanes: createPermitPool(1) });
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

/** How the port reaches the run's asynchronous scope. */
export interface IFrameAccess {
  /** This run's frame in the current asynchronous execution, if there is one. */
  current(): IRunFrame | undefined;
  /** Run work with a frame attached to its asynchronous execution. */
  enter<T>(frame: IRunFrame, work: () => Promise<T>): Promise<T>;
}

/**
 * The cancellation port Supervision hands to Resolution for one run. Each
 * execution runs in its own attempt frame inside the run's scope, inheriting
 * the window lane of the member it belongs to; each fan-out member runs in a
 * window lane.
 * @param run - The live run.
 * @param frames - Access to the run's asynchronous scope.
 * @returns The port.
 */
export function supervisedExecution(run: ISupervisedRun, frames: IFrameAccess): IExecutionSupervision {
  return Object.freeze({
    async execute<T>(step: IBindingDescriptor, work: () => Promise<T>): Promise<ISupervisedExecution<T>> {
      if (!run.open) {
        return { kind: 'interrupted', reason: `run ${run.context.runId} has closed` };
      }
      if (run.hard.signal.aborted) {
        return { kind: 'interrupted', reason: 'a hard stop interrupted the step before it started' };
      }
      const attempt: IAttemptFrame = { step, taint: undefined, ended: false };
      const current = frames.current();
      const lane = current?.lane;
      const lanes = current?.lanes ?? run.lanes;
      try {
        const raced = await raceAbort(started(() => frames.enter({ run, attempt, lane, lanes }, work)), run.hard.signal);
        if (raced.aborted) {
          return { kind: 'interrupted', reason: 'a hard stop interrupted the step' };
        }
        return attempt.taint === undefined ? { kind: 'returned', value: raced.value } : { kind: 'interrupted', reason: attempt.taint };
      } catch (error: unknown) {
        return attempt.taint === undefined ? { kind: 'threw', error } : { kind: 'interrupted', reason: attempt.taint };
      } finally {
        // Whatever the detached author code does later, this body is no longer draining.
        attempt.ended = true;
      }
    },
    async member<T>(work: () => Promise<T>): Promise<T> {
      // Queued members are served first in, first out, after any woken member
      // reclaiming a lane. After a hard stop a member no longer waits for a
      // lane: its work is refused promptly anyway.
      //
      // Invariant (RUN-002's nested rule): work run under a lane must never
      // start another member fan-out under the pool that lane came from: a
      // member holding a lane while waiting for lanes its own fan-out needs
      // can deadlock the window. The member draws from the pool of the frame
      // the fan-out started in: the run-wide window only at the run's root.
      // Its own work runs with a single-lane pool of its own, and a run
      // operation started from inside a member or attempt gets a fresh one
      // ({@link operationFrame}), so nested fan-out resolves one member at a
      // time and never waits on the lane its caller holds.
      const pool = frames.current()?.lanes ?? run.lanes;
      const lane: IMemberLane = { pool, permit: await pool.acquire(run.hard.signal), waits: 0, closed: false };
      try {
        return await frames.enter({ run, attempt: undefined, lane, lanes: createPermitPool(1) }, work);
      } finally {
        lane.closed = true;
        lane.permit?.release();
        lane.permit = undefined;
      }
    },
    publicationRefusal: (): string | undefined => run.publicationRefusal(),
  });
}

/** Lend a member's lane at the start of a timed wait (the first, when several overlap). */
function lendLane(lane: IMemberLane | undefined): void {
  if (lane === undefined || lane.closed) {
    return;
  }
  lane.waits += 1;
  if (lane.waits === 1) {
    lane.permit?.release();
    lane.permit = undefined;
  }
}

/**
 * Reclaim a lane when the last timed wait of a member ends. The reclaim has
 * priority over members that have not started: the woken member already
 * holds a claimed attempt and its evidence in memory, so with a large
 * population it must not wait behind every unstarted member. Reclaims among
 * themselves are served first in, first out. Returns false when a hard stop
 * ended that wait, so the member's work must stop.
 */
async function reclaimLane(run: ISupervisedRun, lane: IMemberLane | undefined): Promise<boolean> {
  if (lane === undefined || lane.closed) {
    return true;
  }
  lane.waits -= 1;
  if (lane.waits > 0 || lane.permit !== undefined) {
    return true;
  }
  const permit = await lane.pool.acquire(run.hard.signal, { priority: true });
  if (lane.closed) {
    // The member settled while this wait was reclaiming: hand the lane straight on.
    permit?.release();
    return true;
  }
  lane.permit = permit;
  return permit !== undefined;
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
  const { run, attempt, lane } = frame;

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
    // The send's own signal: it aborts when the run's hard signal does, and is
    // detached from the run as soon as the send settles. An adapter listener
    // that is never removed therefore stays on this short-lived signal and
    // cannot keep its closure reachable until the run closes.
    const own = createAbortSource((error: unknown) => {
      run.diagnose(`An abort listener of send ${label} failed: ${error instanceof Error ? error.message : String(error)}`);
    });
    const detach = run.hard.signal.onAbort(() => {
      own.abort();
    });
    let raced: IRaced<T>;
    try {
      raced = await raceAbort(started(() => perform(own.signal)), run.hard.signal);
    } catch (error: unknown) {
      permit.release();
      sendEvent(label, 'fail');
      throw error;
    } finally {
      detach();
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
    // A timed wait holds neither a permit nor its member's window lane (RUN-002, RUN-011).
    lendLane(lane);
    try {
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
    } catch (error: unknown) {
      // The member is stopping: it gives up the wait without taking a lane back.
      if (lane !== undefined && !lane.closed) {
        lane.waits -= 1;
      }
      throw error;
    }
    if (!await reclaimLane(run, lane)) {
      const reason = 'a hard stop ended the wait for a window lane';
      taint(attempt, reason);
      throw new SupervisionError('stopped', `The wait ended early: ${reason}`);
    }
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
