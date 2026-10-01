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
import type { IExecutionAttempt, IExecutionSupervision, ISupervisedExecution } from '@microdelta/resolution';

import type { IRemoteState, IRunContext, IRunEvent, IRunExecution, IRunLease, ISendInterruption, ISendPhase, ISendRequest } from './contracts.js';
import { createAbortSource } from './control.js';
import type { IAbortSignal, IAbortSource, IRunTimer, IStopController, IStopState } from './control.js';
import { SupervisionError } from './errors.js';
import type { IOperationBlock, IOperationRequest, IOperationSubject } from './operations.js';
import type { IPermit, IPermitPool } from './permits.js';

/**
 * The unsettled external-operation signal a step attempt met: a deferral
 * until a time, or an unknown outcome. Once set, the attempt is *pending*:
 * every later operation or send it makes rethrows the signal without sending
 * (EXP-8's taint guard), and its execution ends `unsettled`, so its step
 * stays pending and nothing it returns is published.
 */
export type IPendingSignal = IOperationBlock;

/**
 * One admitted step's execution inside a run: which step it is, the claimed
 * attempt it executes (its subject and History identity, when Resolution
 * claimed one), the member it works for, the first reason stop intent refused
 * or aborted something it did, the unsettled operation it met, and whether
 * its execution has ended. A tainted or pending attempt can never publish,
 * whatever its body later returns. While an untainted attempt is still
 * executing it is *draining* under a soft stop: the children its body demands
 * are part of its drain unit and are admitted as first attempts.
 */
export interface IAttemptFrame {
  readonly step: IBindingDescriptor;
  /** The claimed attempt's subject and compatibility group; the owner of its external operations. */
  readonly subject: IOperationSubject | undefined;
  /** History's identity of the claimed attempt, the step attempt identity in correlation. */
  readonly attemptId: number | undefined;
  /** The designated member key the work belongs to: its own, or its calling attempt's. */
  readonly member: string | undefined;
  taint: string | undefined;
  /** The unsettled operation the attempt met, if any. */
  pending: IPendingSignal | undefined;
  /** How many operations this attempt has minted, for their identities. */
  minted: number;
  /** True once its execution returned, threw or was interrupted; a call made later belongs to no draining body. */
  ended: boolean;
}

/**
 * One pass of a normal request: the writer lease it runs under, which its
 * external operations' journal commits also use (so a pass that lost its
 * lease can commit nothing, EXP-8 ruling R), the deferral times it met, and
 * the operation blocks of the steps it left pending, by step.
 */
export interface IRequestScope {
  readonly lease: IRunLease;
  /**
   * Steps, by {@link descriptorKey}, that settled in an earlier pass of the
   * same request (for example failed members). A later pass resumes only
   * deferred work, so admission denies these rather than executing them again.
   */
  readonly settled: ReadonlySet<string>;
  /** "Not before" times of deferred work the pass met: the run's wait ends at the earliest. */
  readonly deferrals: number[];
  /** The block that kept each step pending, by {@link descriptorKey}. */
  readonly blocks: Map<string, IOperationBlock>;
}

/** An unambiguous key of a step descriptor. */
export function descriptorKey(step: IBindingDescriptor): string {
  return JSON.stringify([step.scope, step.role, step.slot, step.template ?? null, step.collection ?? null, step.memberKey ?? null]);
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
  return attempt !== undefined && attempt.taint === undefined && attempt.pending === undefined && !attempt.ended;
}

/**
 * How one transmission (a permit-guarded send) ended:
 *
 * - `returned` / `threw`: `perform` settled on its own;
 * - `refused`: stop intent refused it before anything was sent (the attempt
 *   is tainted);
 * - `aborted`: a hard stop abandoned it in flight, with the remote state
 *   recorded (the attempt is tainted);
 * - `unrecorded`: the hook that runs just before `perform` failed, so nothing
 *   was sent.
 */
export type ITransmitted<T> =
  | { readonly kind: 'returned'; readonly value: T }
  | { readonly kind: 'threw'; readonly error: unknown }
  | { readonly kind: 'refused'; readonly reason: string }
  | { readonly kind: 'aborted'; readonly remote: IRemoteState; readonly reason: string }
  | { readonly kind: 'unrecorded'; readonly error: unknown };

/** A send request's fields, read and validated once. */
export interface ISendFields<T> {
  readonly label: string;
  readonly retry: boolean;
  readonly perform: (signal: IAbortSignal) => Promise<T>;
  readonly cancel: (() => Promise<'cancelled' | 'running'>) | undefined;
}

/**
 * What the run's external operations use of the execution controls: a
 * transmission with a hook that runs after the permit is held and stop
 * intent rechecked, synchronously just before `perform` (where the intent is
 * committed), and a stop-aware wait that holds no permit and lends the
 * member's lane.
 */
export interface IOperationTransport {
  transmit<T>(fields: ISendFields<T>, beforePerform: () => void): Promise<ITransmitted<T>>;
  sleepUntil(epochMilliseconds: number): Promise<void>;
}

/** A run's external operations, as the execution controls reach them. */
export interface IRunOperations {
  /** Perform one external operation for the attempt of `frame`. */
  call<T>(frame: IRunFrame, transport: IOperationTransport, request: IOperationRequest<T>): Promise<T>;
}

/** The error an attempt's pending signal is rethrown as, without sending. */
export function pendingError(signal: IPendingSignal): SupervisionError {
  return signal.kind === 'deferred'
    ? new SupervisionError('operation-deferred', `Operation ${signal.operation} is deferred until ${String(signal.notBefore)}; nothing is sent before then`)
    : new SupervisionError('operation-unknown', `Operation ${signal.operation} has an unknown outcome (${signal.reason}); it is not replayed`);
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
  /** The run's external operations, when assembly supplied their ports. */
  readonly operations: IRunOperations | undefined;
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
 * attempt whose body is executing there, if any, and the window lane of the
 * fan-out member it belongs to, if any. A nested execution gets its own frame
 * (inheriting the member's lane); the parent's is restored when it returns or
 * throws.
 */
export interface IRunFrame {
  readonly run: ISupervisedRun;
  readonly attempt: IAttemptFrame | undefined;
  readonly lane: IMemberLane | undefined;
  /** The normal request pass the work belongs to, if any. */
  readonly request: IRequestScope | undefined;
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
    async execute<T>(step: IBindingDescriptor, work: () => Promise<T>, claimed?: IExecutionAttempt): Promise<ISupervisedExecution<T>> {
      if (!run.open) {
        return { kind: 'interrupted', reason: `run ${run.context.runId} has closed` };
      }
      if (run.hard.signal.aborted) {
        return { kind: 'interrupted', reason: 'a hard stop interrupted the step before it started' };
      }
      const parent = frames.current();
      const attempt: IAttemptFrame = {
        step,
        subject: claimed?.subject,
        attemptId: claimed?.attemptId,
        member: step.memberKey ?? parent?.attempt?.member,
        taint: undefined,
        pending: undefined,
        minted: 0,
        ended: false,
      };
      const lane = parent?.lane;
      /** How the body ended once it settled: stop taint first, then an unsettled operation, then its own outcome. */
      const ending = (settled: ISupervisedExecution<T>): ISupervisedExecution<T> => {
        if (attempt.taint !== undefined) {
          return { kind: 'interrupted', reason: attempt.taint };
        }
        if (attempt.pending !== undefined) {
          return { kind: 'unsettled', reason: pendingError(attempt.pending).message };
        }
        return settled;
      };
      try {
        const raced = await raceAbort(started(() => frames.enter({ run, attempt, lane, request: parent?.request }, work)), run.hard.signal);
        if (raced.aborted) {
          return { kind: 'interrupted', reason: 'a hard stop interrupted the step' };
        }
        return ending({ kind: 'returned', value: raced.value });
      } catch (error: unknown) {
        return ending({ kind: 'threw', error });
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
      // Invariant (RUN-002's nested rule): the lane pool is run-wide, so work
      // run under a lane must never start another member fan-out (a nested
      // settleMembers) under the same pool: a member holding a lane while
      // waiting for lanes its own fan-out needs can deadlock the window. Today
      // members cannot trigger fan-out (folds are not children, and run
      // operations start from the run's root frame, not a member's).
      const request = frames.current()?.request;
      const lane: IMemberLane = { permit: await run.lanes.acquire(run.hard.signal), waits: 0, closed: false };
      try {
        return await frames.enter({ run, attempt: undefined, lane, request }, work);
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
  const permit = await run.lanes.acquire(run.hard.signal, { priority: true });
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

  /** Refuse a send: record it and taint the attempt. */
  const refuse = (label: string, reason: string): ITransmitted<never> => {
    sendEvent(label, 'refused');
    taint(attempt, reason);
    return { kind: 'refused', reason };
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

  /**
   * One permit-guarded transmission. `beforePerform` runs once the permit is
   * held and stop intent rechecked, in the same synchronous turn as
   * `perform`, so nothing can intervene between them: an external operation
   * commits its intent there (intent before send). If it throws, nothing is
   * sent and the permit is handed back.
   */
  async function transmit<T>(fields: ISendFields<T>, beforePerform: () => void): Promise<ITransmitted<T>> {
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
    try {
      beforePerform();
    } catch (error: unknown) {
      permit.release();
      return { kind: 'unrecorded', error };
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
      return { kind: 'threw', error };
    } finally {
      detach();
    }
    permit.release();
    if (!raced.aborted) {
      sendEvent(label, 'end');
      return { kind: 'returned', value: raced.value };
    }
    sendEvent(label, 'aborted');
    const remote = await remoteStateOf(label, cancel);
    run.report(Object.freeze({ kind: 'send', runId: run.context.runId, label, phase: 'remote-state', remote }), `send ${label} remote-state`);
    run.interruptions.push(Object.freeze({ label, remote }));
    const reason = 'a hard stop aborted a send in flight';
    taint(attempt, reason);
    return { kind: 'aborted', remote, reason };
  }

  /** One send for author code: a pending attempt rethrows its signal, and a refusal or abort fails with `stopped`. */
  async function send<T>(fields: ISendFields<T>): Promise<T> {
    if (attempt?.pending !== undefined) {
      throw pendingError(attempt.pending);
    }
    const sent = await transmit(fields, () => undefined);
    switch (sent.kind) {
      case 'returned':
        return sent.value;
      case 'threw':
        throw sent.error;
      case 'refused':
        throw new SupervisionError('stopped', `Send ${fields.label} was refused: ${sent.reason}`);
      case 'aborted':
        throw new SupervisionError('stopped', `Send ${fields.label} was aborted: ${sent.reason}`);
      case 'unrecorded':
        // No hook runs for a plain send; this is unreachable.
        throw sent.error;
      default: {
        const exhaustive: never = sent;
        return exhaustive;
      }
    }
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
    operation<T>(request: IOperationRequest<T>): Promise<T> {
      const operations = run.operations;
      const timer = run.timer;
      if (operations === undefined || timer === undefined) {
        return Promise.reject(new SupervisionError('invalid-request', 'This run has no operation ports or timer, so it offers no external operations'));
      }
      const transport: IOperationTransport = Object.freeze({
        transmit,
        sleepUntil: (epochMilliseconds: number) => sleep(epochMilliseconds, timer),
      });
      return run.track(() => operations.call(frame, transport, request));
    },
  });
}
