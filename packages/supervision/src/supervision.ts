/**
 * The Run Supervision engine. One supervised run is a scoped lifetime:
 *
 * - its context (volatile run id, analysis, selected environment) is attached
 *   to the run body and to every request and ordinary call through the
 *   injected asynchronous scope, so author code finds it without a parameter;
 * - it stays live until its body *and* every operation started through the
 *   run (`resolve`, `resolveMembers`, `resolveFold`, `resolveOutcomeFold`, `check`, `recover`,
 *   `ordinary`) have settled, including
 *   operations started while it waits and those whose aggregate (for example
 *   a `Promise.all` with a failing sibling) the body stopped awaiting early;
 *   only then does it close, and afterwards its operations, escaped context
 *   lookups and admission decisions all fail or are denied. The body's own
 *   outcome, value or failure, is what the run reports;
 * - storage's writer lease is taken only for normal requests and released
 *   exactly once at actual close, so a refused miss, a check or a recovery
 *   never strands it and started work never loses it. A normal request that
 *   finds another process holding it waits under the operator's policy (no
 *   default deadline) and fails with a typed writer-busy error at the
 *   deadline (see `writer.ts`); History alone decides any takeover;
 * - admission and observer positions are Supervision's ports into Resolution:
 *   the caller's policy decides admission, and observers are captured at
 *   start, see frozen events and can neither veto nor replace work;
 * - the operator's stop controller is observed while the run is open: a soft
 *   stop cancels every later admission while admitted steps drain, and a
 *   hard stop also aborts the run's signal, which interrupts admitted bodies,
 *   sends, permit waits and waits for a time and forbids later commits (see
 *   `execution.ts`);
 * - the run owns a bounded permit pool for its sends and hands Resolution
 *   the bounded active window of member fan-out;
 * - when assembly supplies operation ports, the run offers external
 *   operations (see `operation-engine.ts`): its admission honors each step's
 *   unsettled operations before the policy decides, and each normal request
 *   runs in passes. A pass that left work deferred until a later time ends
 *   with that work pending; once only deferred work remains the run releases
 *   the writer lease and, in sleep mode, waits for the earliest time (any
 *   stop ends the wait) and runs another pass, or in exit mode returns,
 *   reporting the time it waits until.
 *
 * Supervision never decides reuse, touches History rows or reads the host
 * itself; it persists operations only through its journal and accounting
 * ports.
 */
import { isComposing } from '@microdelta/definition';
import type { IBindingDescriptor } from '@microdelta/definition';
import type {
  IAdmissionDecision,
  IAdmissionRequest,
  ICheckOutcome,
  IDiscoveryOutcome,
  IExecutionAdmission,
  IFoldOutcome,
  IFoldResolution,
  ILifecycleEvent,
  ILifecycleObserver,
  IMemberResolution,
  IMembersResolution,
  IOutcomeFoldOutcome,
  IOutcomeFoldResolution,
  IRecoveryResult,
  IResolution,
  IResolutionOutcome,
} from '@microdelta/resolution';

import type {
  IDiscoveryReport,
  IFoldReport,
  IMemberOutcome,
  IMembersReport,
  IMembersTarget,
  IOrdinaryPhase,
  IOutcomeFoldReport,
  IOutcomeFoldRunOutcome,
  IRequestOptions,
  IRun,
  IRunContext,
  IRunEvent,
  IRunExecution,
  IRunLease,
  IRunOperationName,
  IRunOptions,
  IRunResult,
  IRunScope,
  IStrictFoldOutcome,
  ISupervision,
  ISupervisionOptions,
} from './contracts.js';
import { createAbortSource, createStopController } from './control.js';
import type { IRunTimer, IStopLevel, IStopState } from './control.js';
import { SupervisionError } from './errors.js';
import { descriptorKey, isDraining, raceAbort, runControls, supervisedExecution } from './execution.js';
import type { IAttemptFrame, IFrameAccess, IRequestScope, IRunFrame, ISupervisedRun } from './execution.js';
import { createOperationEngine } from './operation-engine.js';
import type { IOperationEngine } from './operation-engine.js';
import type { IDeferralMode, IOperationSettlement, IOperationStatus, IOperationView, IWaitEvent } from './operations.js';
import { createPermitPool } from './permits.js';
import { awaitWriter, writerWaitPolicy } from './writer.js';

/**
 * The default size of a run's permit pool: one send in flight at a time. It
 * bounds provider requests, and is deliberately conservative for paid
 * providers; an operator sizes it to the provider's concurrency limit.
 */
const defaultPermits = 1;

/**
 * The default size of a run's bounded active window of member fan-out. It is
 * independent of the permit pool because the two bound different things:
 * permits bound concurrent provider requests, while the window bounds how
 * many members are actively resolving at once, and so the member work,
 * validation and in-flight evidence held in memory. A window wider than the
 * permit pool lets members that are validating, reusing results or waiting
 * for a permit progress while others send, so one slow or waiting member
 * never stalls its siblings (a member in a timed wait also lends its lane).
 * Eight keeps that concurrency, and the memory of in-flight members, modest
 * for a single-process run; it matches EXP-8's evaluated default for
 * concurrently admitted steps. Operators widen it for large fan-outs.
 */
const defaultWindow = 8;

/**
 * One normal request run in passes: one pass under a lease and request key,
 * the report of a pass given the previous pass's report, the steps a pass
 * settled (which later passes do not execute again), and whether a report is
 * final (no wait could change it).
 */
interface IPasses<P, R> {
  pass(lease: IRunLease, requestKey: string): Promise<P>;
  report(result: P, scope: IRequestScope, previous: R | undefined): R;
  settled(report: R): readonly string[];
  final(report: R): boolean;
}

/**
 * The separator of a derived pass key. A caller's request key for a normal
 * request may not contain it, so a derived key never collides with a key a
 * caller chose (a recovery request may name a derived key).
 */
const passSeparator = '#pass:';

/**
 * The request key of one pass of a normal request. The first pass uses the
 * caller's saved key unchanged; a later pass, after a deferral's wait, admits
 * its executions under `<key>#pass:<n>`, because a request key identifies
 * the admitted executions of one pass and each identified execution is never
 * re-admitted. A caller recovering a resumed request derives the same keys.
 */
function passKey(requestKey: string, pass: number): string {
  return pass === 1 ? requestKey : `${requestKey}${passSeparator}${String(pass)}`;
}

/**
 * A run's positive count option (its permits or window), or `fallback` when
 * absent. Anything but a positive safe integer is an invalid request.
 */
function positiveCount(value: unknown, fallback: number, name: string): number {
  if (value === undefined) {
    return fallback;
  }
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value <= 0) {
    throw new SupervisionError('invalid-request', `A run's ${name} must be a positive safe integer`);
  }
  return value;
}

/** An observer's `observe` function as captured when its run started. */
type ICapturedObserver = (event: IRunEvent) => void;

/** A readable diagnostic from any thrown value. */
function describe(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/** Whether a value is a nonempty string. */
function nonempty(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0;
}

/** Admits everything; used when the caller supplies no policy. */
const admitAll: IExecutionAdmission = Object.freeze({
  admit: (): IAdmissionDecision => Object.freeze({ kind: 'admitted' }),
});

/**
 * Capture each observer's `observe` function now, so replacing it on the
 * observer object later cannot change what this run reports to.
 */
function captureObservers(observers: IRunOptions['observers']): readonly ICapturedObserver[] {
  if (observers === undefined) {
    return [];
  }
  if (!Array.isArray(observers)) {
    throw new SupervisionError('invalid-request', 'Run observers must be an array');
  }
  return Object.freeze(observers.map((observer: unknown): ICapturedObserver => {
    const observe: unknown = typeof observer === 'object' && observer !== null ? Reflect.get(observer, 'observe') : undefined;
    if (typeof observe !== 'function') {
      throw new SupervisionError('invalid-request', 'Every run observer must have an observe function');
    }
    return (event: IRunEvent): void => {
      // The return value is deliberately discarded: observers cannot veto work.
      Reflect.apply(observe, observer, [event]);
    };
  }));
}

/**
 * Offer one event to every captured observer. Every observer sees the event
 * even when an earlier one throws; the first failure is then rethrown so the
 * owning position decides whether it stops a call or becomes a diagnostic.
 */
function notify(observers: readonly ICapturedObserver[], event: IRunEvent): void {
  let failure: { readonly error: unknown } | undefined;
  for (const observe of observers) {
    try {
      observe(event);
    } catch (error: unknown) {
      failure ??= { error };
    }
  }
  if (failure !== undefined) {
    throw failure.error;
  }
}

/** Every {@link IRunOperationName}, for the runtime check of untyped callers. */
const runOperationNames: ReadonlySet<string> = new Set<IRunOperationName>(['check', 'inspectOperations', 'ordinary', 'read', 'recover', 'resolve', 'resolveFold', 'resolveMembers', 'resolveOutcomeFold', 'settleOperation']);

/**
 * Classify one member's Resolution outcome as its typed member outcome
 * (CMP-8, RUN-010). An admission denial leaves the member pending, never
 * failed; a cancellation decided through Supervision's admission port is
 * cancelled; a gated-out member is skipped with its gate evidence and no
 * result; a typed Resolution failure is failed.
 */
function memberOutcome(member: IMemberResolution, scope: IRequestScope | undefined): IMemberOutcome {
  const { key, step, gate, outcome } = member;
  switch (outcome.kind) {
    case 'reused':
    case 'published':
      return Object.freeze({ status: 'succeeded', key, step, gate, outcome });
    case 'skipped':
      return Object.freeze({ status: 'skipped', key, step, gate: outcome.gate });
    case 'refused': {
      const status = outcome.disposition === 'cancelled' ? 'cancelled' : 'pending';
      // A pending member names the unsettled external operation that holds it back, when one does.
      const blocked = status === 'pending' ? scope?.blocks.get(descriptorKey(outcome.refused)) : undefined;
      return Object.freeze({ status, key, step, gate, refused: outcome.refused, reason: outcome.reason, ...(blocked === undefined ? {} : { blocked }) });
    }
    case 'failed':
      return Object.freeze({ status: 'failed', key, step, gate, error: outcome.error });
    default: {
      const exhaustive: never = outcome;
      return exhaustive;
    }
  }
}

/** How discovery settled, in Supervision's terms: refused discovery work is pending when denied and cancelled when cancelled. */
function discoveryReport(discovery: IDiscoveryOutcome): IDiscoveryReport {
  return discovery.kind === 'refused'
    ? Object.freeze({ kind: discovery.disposition === 'cancelled' ? 'cancelled' : 'pending', collection: discovery.collection, refused: discovery.refused, reason: discovery.reason })
    : discovery;
}

/**
 * Every member's typed outcome in one pass. A member whose step a later pass
 * did not re-present, because it settled in an earlier pass of the same
 * request, keeps that earlier outcome.
 */
function passMembers(resolved: readonly IMemberResolution[], scope: IRequestScope | undefined, previous: readonly IMemberOutcome[] | undefined): readonly IMemberOutcome[] {
  const earlier = new Map((previous ?? []).map((member) => [member.key, member]));
  return Object.freeze(resolved.map((member) => {
    const outcome = memberOutcome(member, scope);
    const kept = outcome.status === 'pending' && scope?.settled.has(descriptorKey(outcome.refused)) === true ? earlier.get(outcome.key) : undefined;
    return kept ?? outcome;
  }));
}

/**
 * The steps whose members settled in a pass without being held back by an
 * unsettled external operation: failed members, whose step a later pass of
 * the same request must not execute again (a failure is final for the run;
 * only deferred work resumes, EXP-8 mechanism 3).
 */
function settledSteps(members: readonly IMemberOutcome[]): readonly string[] {
  return members.flatMap((member) => member.status === 'failed' ? [descriptorKey(member.step)] : []);
}

/** Report one members request: discovery in Supervision's terms and every member's typed outcome. */
function membersReport(step: string, resolved: IMembersResolution, scope: IRequestScope | undefined, previous?: readonly IMemberOutcome[]): IMembersReport {
  return Object.freeze({ template: resolved.template, step, discovery: discoveryReport(resolved.discovery), members: passMembers(resolved.members, scope, previous) });
}

/**
 * Classify a strict fold's Resolution outcome as its typed fold outcome
 * (CMP-8, RUN-010). A reused or published fold succeeded with its exact
 * outcome and coverage; a readiness failure or wait keeps its key lists and
 * open discovery; the fold's own refused work is pending when denied, never
 * failed, and cancelled when cancelled.
 */
function strictFoldOutcome(outcome: IFoldOutcome): IStrictFoldOutcome {
  switch (outcome.kind) {
    case 'reused':
    case 'published':
      return Object.freeze({ status: 'succeeded', outcome });
    case 'waiting':
      return Object.freeze({ status: 'waiting', pending: outcome.pending, openDiscovery: outcome.openDiscovery });
    case 'failed':
      return Object.freeze({ status: 'failed', failed: outcome.failed, cancelled: outcome.cancelled, pending: outcome.pending, openDiscovery: outcome.openDiscovery, diagnostic: outcome.diagnostic });
    case 'refused':
      return Object.freeze({ status: outcome.disposition === 'cancelled' ? 'cancelled' : 'pending', refused: outcome.refused, reason: outcome.reason });
    default: {
      const exhaustive: never = outcome;
      return exhaustive;
    }
  }
}

/** Report one fold request: discovery and every member in Supervision's terms, and the fold's typed outcome. */
function foldReport(resolved: IFoldResolution, scope: IRequestScope | undefined, previous?: readonly IMemberOutcome[]): IFoldReport {
  return Object.freeze({
    fold: resolved.outcome.step,
    over: resolved.over,
    discovery: discoveryReport(resolved.discovery),
    members: passMembers(resolved.members, scope, previous),
    outcome: strictFoldOutcome(resolved.outcome),
  });
}

/**
 * Classify an outcome fold's Resolution outcome as its typed run outcome
 * (RUN-010). A reused or published fold folded its settled set, with its
 * exact outcome and complete coverage; a wait keeps its partial coverage; a
 * population that cannot be established is failed; the fold's own refused
 * work is pending when denied, never failed, and cancelled when cancelled.
 */
function outcomeFoldRunOutcome(outcome: IOutcomeFoldOutcome): IOutcomeFoldRunOutcome {
  switch (outcome.kind) {
    case 'reused':
    case 'published':
      return Object.freeze({ status: 'folded', outcome });
    case 'waiting':
      return Object.freeze({ status: 'waiting', coverage: outcome.coverage });
    case 'failed':
      return Object.freeze({ status: 'failed', diagnostic: outcome.diagnostic });
    case 'refused':
      return Object.freeze({ status: outcome.disposition === 'cancelled' ? 'cancelled' : 'pending', refused: outcome.refused, reason: outcome.reason, coverage: outcome.coverage });
    default: {
      const exhaustive: never = outcome;
      return exhaustive;
    }
  }
}

/** Report one outcome fold request: discovery and every member in Supervision's terms, and the fold's typed outcome. */
function outcomeFoldReport(resolved: IOutcomeFoldResolution, scope: IRequestScope | undefined, previous?: readonly IMemberOutcome[]): IOutcomeFoldReport {
  return Object.freeze({
    fold: resolved.outcome.step,
    over: resolved.over,
    discovery: discoveryReport(resolved.discovery),
    members: passMembers(resolved.members, scope, previous),
    outcome: outcomeFoldRunOutcome(resolved.outcome),
  });
}

/**
 * Create Run Supervision over an injected scope capability.
 * @param options - The structurally injected scope capability.
 * @returns The Supervision contract.
 * @alpha
 */
export function createSupervision(options: ISupervisionOptions): ISupervision {
  const scope: IRunScope<IRunFrame> = options.context.createAsyncContext<IRunFrame>();
  const timer = options.timer;
  /** Process-local counter for generated run identifiers (volatile metadata). */
  let generated = 0;

  /** Run work with `frame` attached to its asynchronous execution. */
  const enter = <TWork>(frame: IRunFrame, work: () => Promise<TWork>): Promise<TWork> => scope.run(frame, work);

  /** The live frame of the current asynchronous execution, or the reason there is none. */
  function liveFrame(): IRunFrame {
    if (isComposing()) {
      throw new SupervisionError('composition-phase', 'Runtime context cannot be looked up while a composition is being constructed');
    }
    const frame = scope.getStore();
    if (frame === undefined) {
      throw new SupervisionError('outside-run', 'Runtime context was looked up outside a live run');
    }
    if (!frame.run.open) {
      throw new SupervisionError('run-closed', `Run ${frame.run.context.runId} has closed; its context is no longer available`);
    }
    return frame;
  }

  function current(): IRunContext {
    return liveFrame().run.context;
  }

  function execution(): IRunExecution {
    return runControls(liveFrame());
  }

  async function run<T>(runOptions: IRunOptions, body: (run: IRun) => T | Promise<T>): Promise<IRunResult<Awaited<T>>> {
    if (isComposing()) {
      throw new SupervisionError('composition-phase', 'A run cannot start while a composition is being constructed');
    }
    if (!nonempty(runOptions.analysis) || !nonempty(runOptions.environment)) {
      throw new SupervisionError('invalid-request', 'A run needs a nonempty analysis and environment');
    }
    if (runOptions.runId !== undefined && !nonempty(runOptions.runId)) {
      throw new SupervisionError('invalid-request', 'A supplied run identifier must be a nonempty string');
    }
    if (typeof runOptions.resolution !== 'function' || typeof runOptions.writer !== 'object' || runOptions.writer === null) {
      throw new SupervisionError('invalid-request', 'A run needs a Resolution factory and a writer port');
    }
    const permits = positiveCount(runOptions.permits, defaultPermits, 'permits');
    const window = positiveCount(runOptions.window, defaultWindow, 'window');
    const deferral: IDeferralMode = runOptions.deferral ?? 'sleep';
    if (deferral !== 'sleep' && deferral !== 'exit') {
      throw new SupervisionError('invalid-request', 'A run\'s deferral mode must be "sleep" or "exit"');
    }
    const operationPorts = runOptions.operations;
    if (operationPorts !== undefined && (typeof operationPorts !== 'object' || operationPorts === null || typeof Reflect.get(operationPorts, 'journal') !== 'object' || typeof Reflect.get(operationPorts, 'accounting') !== 'object')) {
      throw new SupervisionError('invalid-request', 'A run\'s operation ports need a journal and an accounting port');
    }
    // The type requires the random source; untyped configuration without one is refused here.
    const randomPort: unknown = operationPorts === undefined ? undefined : Reflect.get(operationPorts, 'random');
    const random = operationPorts !== undefined && typeof randomPort === 'object' && randomPort !== null && typeof Reflect.get(randomPort, 'randomIdentifier') === 'function' ? operationPorts.random : undefined;
    if (operationPorts !== undefined && (timer === undefined || random === undefined)) {
      throw new SupervisionError('invalid-request', 'External operations need the Supervision\'s timer and random identifier source');
    }
    const controller = runOptions.stop ?? createStopController();
    if (typeof controller !== 'object' || controller === null || typeof Reflect.get(controller, 'subscribe') !== 'function') {
      throw new SupervisionError('invalid-request', 'A run\'s stop must be a stop controller');
    }
    generated += 1;
    const context: IRunContext = Object.freeze({
      runId: runOptions.runId ?? `run:${String(generated)}`,
      analysis: runOptions.analysis,
      environment: runOptions.environment,
    });
    const observers = captureObservers(runOptions.observers);
    const policy = runOptions.admission ?? admitAll;
    const writer = runOptions.writer;
    const writerPolicy = writerWaitPolicy(runOptions.writerWait);
    const diagnostics: string[] = [];
    /** The stop intent in force when the run closed; captured in the turn that closes it. */
    let closingStop: IStopState = controller.state;
    /** Where a failing listener of one of the run's abort signals is reported: a diagnostic, never a failure of the stop. */
    const listenerFailure = (signal: string) => (error: unknown): void => {
      diagnostics.push(`A ${signal} listener of run ${context.runId} failed: ${describe(error)}`);
    };

    /**
     * Operations started through this run that have not settled: requests,
     * ordinary work, sends and waits. The run stays live until this set is
     * empty after its body settled.
     */
    const started = new Set<Promise<unknown>>();

    /**
     * The run's external operations, over the ports assembly supplied. Its
     * observer position and diagnostics are the run's; it is created before
     * the run state so the execution controls can reach it.
     */
    const engine: IOperationEngine | undefined = operationPorts === undefined || timer === undefined || random === undefined ? undefined : createOperationEngine({
      context,
      ports: operationPorts,
      random,
      timer,
      report: (event, position) => {
        state.report(event, position);
      },
      diagnose: (message) => {
        diagnostics.push(message);
      },
    });

    const state: ISupervisedRun = {
      context,
      open: true,
      controller,
      hard: createAbortSource(listenerFailure('hard stop')),
      stopped: createAbortSource(listenerFailure('stop')),
      permits: createPermitPool(permits),
      lanes: createPermitPool(window),
      timer,
      operations: engine,
      interruptions: [],
      diagnose(message: string): void {
        diagnostics.push(message);
      },
      report(event: IRunEvent, position: string): void {
        try {
          notify(observers, event);
        } catch (error: unknown) {
          diagnostics.push(`Run observer failed at ${position}: ${describe(error)}`);
        }
      },
      track<TResult>(operation: () => Promise<TResult>): Promise<TResult> {
        if (!state.open) {
          return Promise.reject(new SupervisionError('run-closed', `Run ${context.runId} has closed and accepts no new work`));
        }
        const pending = operation();
        const settled = pending.then(() => undefined, () => undefined);
        started.add(settled);
        void settled.then(() => started.delete(settled));
        return pending;
      },
      publicationRefusal(): string | undefined {
        if (!state.open) {
          return `run ${context.runId} has closed`;
        }
        return state.hard.signal.aborted ? 'a hard stop took effect before the publication commit' : undefined;
      },
    };
    const frame: IRunFrame = Object.freeze({ run: state, attempt: undefined, lane: undefined, request: undefined });
    /** Access to this run's frames in the shared scope; a frame of another run is not this run's. */
    const frames: IFrameAccess = Object.freeze({
      current: (): IRunFrame | undefined => {
        const store = scope.getStore();
        return store?.run === state ? store : undefined;
      },
      enter,
    });

    /**
     * Observe the operator's stop intent while the run is open: report each
     * new level to observers, then abort the run's signals. A hard stop
     * aborts `hard` before `stopped`, so everything a stop ends sees the
     * level that ended it. After the run closes nothing is observed.
     */
    let observedLevel: IStopLevel = 'none';
    const observeStop = (next: IStopState): void => {
      if (!state.open || next.level === 'none') {
        return;
      }
      if (next.level !== observedLevel) {
        observedLevel = next.level;
        state.report(Object.freeze({ kind: 'stop', runId: context.runId, level: next.level, cause: next.cause }), `stop ${next.level}`);
      }
      if (next.level === 'hard') {
        state.hard.abort();
      }
      state.stopped.abort();
    };
    const unsubscribe = controller.subscribe(observeStop);
    observeStop(controller.state);

    /** The denial for work presented to, or decided after, a closed run. */
    const closedDenial = (): IAdmissionDecision => Object.freeze({ kind: 'denied', reason: `run ${context.runId} has closed` });
    /**
     * The cancellation of work stop intent forbids, or undefined when it may
     * be decided by the policy. A hard stop cancels everything. A soft stop
     * cancels new work, except the first attempt of a child that `demandedBy`
     * (the step attempt whose executing body requested it) is still draining:
     * that child belongs to the admitted step's drain unit.
     */
    const stopRefusal = (demandedBy: IAttemptFrame | undefined): IAdmissionDecision | undefined => {
      if (state.hard.signal.aborted) {
        return Object.freeze({ kind: 'cancelled', reason: `run ${context.runId} is stopped: a hard stop admits no new work` });
      }
      if (!state.stopped.signal.aborted || isDraining(demandedBy)) {
        return undefined;
      }
      return Object.freeze({ kind: 'cancelled', reason: `run ${context.runId} is stopped: a soft stop admits no new work` });
    };
    /**
     * Supervision's admission port: the caller's policy while open and not
     * stopped (RUN-014: no admission after a soft stop), and, during a soft
     * stop's drain, for the children an admitted step's executing body
     * demands (EXP-8: the drain unit is the admitted step attempt). Admission
     * is always of a first attempt: retries and deferred resumptions are
     * refused at the send and wait they need. A policy may decide
     * asynchronously; a decision that arrives after the run closed is replaced
     * by denial, one that arrives when stop intent forbids the work by
     * cancellation, and a hard stop ends the wait for a pending decision at
     * once.
     */
    const admission: IExecutionAdmission = Object.freeze({
      async admit(request: IAdmissionRequest): Promise<IAdmissionDecision> {
        if (!state.open) {
          return closedDenial();
        }
        // The body (if any) whose execution demands this work, as its asynchronous context carries it.
        const caller = frames.current();
        const demandedBy = caller?.attempt;
        const before = stopRefusal(demandedBy);
        if (before !== undefined) {
          return before;
        }
        // A later pass resumes only deferred work: a step that settled in an earlier pass of the request is not executed again.
        if (caller?.request?.settled.has(descriptorKey(request.step)) === true) {
          return Object.freeze({ kind: 'denied', reason: `run ${context.runId} settled this step in an earlier pass of the request` });
        }
        // A deferral not yet due, or an unknown outcome that may not be retried, holds the step pending before any claim (RUN-011/012).
        const blocked = engine?.admit(request, caller?.request, state.stopped.signal.aborted);
        if (blocked !== undefined) {
          return blocked;
        }
        const decided = await raceAbort(Promise.resolve(policy.admit(request)), state.hard.signal);
        if (!state.open) {
          return closedDenial();
        }
        const after = stopRefusal(demandedBy);
        if (after !== undefined || decided.aborted) {
          // Only a hard stop ends the wait early, and that stop cancels the work.
          return after ?? closedDenial();
        }
        return decided.value;
      },
    });
    /**
     * The one wait for the writer lease in progress, shared by every normal
     * request that starts while it lasts, so concurrent requests of one run
     * poll storage once per interval and proceed with the same lease.
     */
    let writerWait: Promise<IRunLease> | undefined;
    /**
     * A valid writer lease for the next normal request: renewed or acquired
     * at once when possible, otherwise waited for under the run's policy. Any
     * stop ends a wait, as it ends a wait for a time: the request it precedes
     * has not started, and stop intent forbids the new work it would bring.
     */
    const writerLease = (): Promise<IRunLease> => {
      if (writerWait !== undefined) {
        return writerWait;
      }
      const pending = awaitWriter({ writer, policy: writerPolicy, timer, stop: state.stopped.signal, runId: context.runId });
      writerWait = pending;
      const finished = (): void => {
        if (writerWait === pending) {
          writerWait = undefined;
        }
      };
      pending.then(finished, finished);
      return pending;
    };
    /** Supervision's observer position for Resolution's lifecycle events. */
    const observer: ILifecycleObserver = Object.freeze({
      observe(event: ILifecycleEvent): void {
        notify(observers, Object.freeze({ kind: 'step', runId: context.runId, event }));
      },
    });
    const resolution: IResolution = runOptions.resolution(Object.freeze({ admission, observer, execution: supervisedExecution(state, frames) }));

    /**
     * The refusal of a run operation called from inside a member's work or a
     * step attempt (any admitted body, a fold's included) of this open run,
     * or undefined when it may proceed. Every run operation resolves or reads
     * framework results, and whatever such a call obtained would enter no
     * evidence of the calling body: it is an undeclared call (CMP-9). The
     * refusal is decided synchronously, before any admission, claim or lane,
     * so it never waits; because of it, a lane holder can never await the
     * run-wide lane pool (RUN-002's nested rule). It is recorded as a run
     * diagnostic naming the operation and the calling step by identifiers
     * only. A closed run's operations are left to report `run-closed`.
     */
    function undeclaredCall(operation: IRunOperationName): SupervisionError | undefined {
      const caller = frames.current();
      if (!state.open || caller === undefined || (caller.attempt === undefined && caller.lane === undefined)) {
        return undefined;
      }
      const step = caller.attempt?.step;
      const inside = step === undefined ? 'member work' : `the step attempt of ${step.slot}${step.memberKey === undefined ? '' : `/${step.memberKey}`}`;
      const message = `Run ${context.runId} refused ${operation} from inside ${inside}: an undeclared call (CMP-9)`;
      diagnostics.push(message);
      return new SupervisionError('undeclared-call', message);
    }

    /**
     * Run the operation `name` inside this run's scope, after refusing an
     * undeclared call and checking the run is still open, and account for it
     * until it settles.
     */
    function within<TResult>(operation: () => TResult | Promise<TResult>, name: IRunOperationName): Promise<TResult> {
      const refusal = undeclaredCall(name);
      if (refusal !== undefined) {
        return Promise.reject(refusal);
      }
      return state.track(() => scope.run(frame, async () => operation()));
    }

    /**
     * Wait until every started operation, including ones started meanwhile,
     * has settled, then close the run in the same synchronous turn that
     * observes no started work. Closing there, rather than after yielding back
     * to the caller, leaves no window in which a queued call could be accepted
     * yet not waited for: every later call is rejected as new work. The stop
     * intent in force is captured in that same turn, and is no longer
     * observed once the run has closed.
     */
    async function drainAndClose(): Promise<void> {
      while (started.size > 0) {
        await Promise.all([...started]);
      }
      state.open = false;
      closingStop = controller.state;
      unsubscribe();
    }

    /** Normal request passes in progress (not sleeping), and requests asleep until a deferral is due. */
    const passes = { active: 0, sleeping: 0 };
    /** The earliest "not before" time of deferred work this run left waiting, if any. */
    let waitingUntil: number | undefined;

    /**
     * Release the writer lease once only deferred work remains: no normal
     * request pass is active and at least one request waits for a deferral
     * (EXP-8 resolution 1). Returns whether the lease is now free of this run.
     */
    function releaseIfOnlyDeferred(): boolean {
      if (passes.active > 0) {
        return false;
      }
      try {
        writer.release();
        return true;
      } catch (error: unknown) {
        diagnostics.push(`Run ${context.runId} could not release its writer for a deferral: ${describe(error)}`);
        return false;
      }
    }

    /** Wait until `until`, holding nothing; any stop ends the wait. Resolves whether the time came. */
    function sleepForDeferral(until: number, clock: IRunTimer): Promise<boolean> {
      return new Promise<boolean>((resolve) => {
        let cancel: () => void = () => undefined;
        const remove = state.stopped.signal.onAbort(() => {
          cancel();
          resolve(false);
        });
        cancel = clock.schedule(until, () => {
          remove();
          resolve(true);
        }, { keepAlive: true });
      });
    }

    /** Offer one wait event. */
    function waitEvent(phase: IWaitEvent['phase'], until: number, released: boolean): void {
      state.report(Object.freeze({ kind: 'wait', runId: context.runId, phase, until, released }), `wait ${phase}`);
    }

    /**
     * Run one normal request in passes, each under a fresh lease and its own
     * request scope. A pass that met no deferral is final. Otherwise, in exit
     * mode or under stop intent, the request returns with the deferred work
     * pending and the run reports the time it waits until; in sleep mode it
     * releases the lease once only deferred work remains, waits for the
     * earliest time and runs another pass, in which the deferred work is
     * admitted again under the same operation identities. Each pass admits
     * its executions under its own request key (see {@link passKey}).
     */
    async function inPasses<P, R>(requestKey: string, request: IPasses<P, R>): Promise<R> {
      const callerKey: unknown = requestKey;
      if (typeof callerKey === 'string' && callerKey.includes(passSeparator)) {
        throw new SupervisionError('invalid-request', `A normal request's key may not contain the reserved pass separator ${passSeparator}`);
      }
      let previous: R | undefined;
      let waited: number | undefined;
      let settled: ReadonlySet<string> = new Set();
      for (let number = 1; ; number += 1) {
        const lease = await leaseForPass(number);
        if (lease === undefined) {
          // Woken while another holder has the writer lease and the run has no deadline: return waiting, as exit mode does.
          const until = waited ?? timer?.currentEpochMilliseconds() ?? 0;
          waitingUntil = Math.min(waitingUntil ?? until, until);
          waitEvent('writer-busy', until, true);
          if (previous === undefined) {
            throw new SupervisionError('invalid-request', 'A first pass has no earlier report');
          }
          return previous;
        }
        const requestScope: IRequestScope = { lease, deferrals: [], blocks: new Map(), settled };
        passes.active += 1;
        let result: P;
        try {
          result = await scope.run({ run: state, attempt: undefined, lane: undefined, request: requestScope }, () => request.pass(lease, passKey(requestKey, number)));
        } finally {
          passes.active -= 1;
          // Another request may be asleep for a deferral: once no pass is active, only deferred work remains.
          if (passes.sleeping > 0) {
            releaseIfOnlyDeferred();
          }
        }
        const reported = request.report(result, requestScope, previous);
        if (requestScope.deferrals.length === 0 || request.final(reported)) {
          return reported;
        }
        previous = reported;
        settled = new Set([...settled, ...request.settled(reported)]);
        const until = Math.min(...requestScope.deferrals);
        waited = until;
        if (deferral === 'exit' || timer === undefined || state.stopped.signal.aborted) {
          waitingUntil = Math.min(waitingUntil ?? until, until);
          waitEvent(deferral === 'exit' || timer === undefined ? 'exiting' : 'stopped', until, releaseIfOnlyDeferred());
          return reported;
        }
        passes.sleeping += 1;
        let came: boolean;
        let released: boolean;
        try {
          released = releaseIfOnlyDeferred();
          waitEvent('sleeping', until, released);
          came = await sleepForDeferral(until, timer);
        } finally {
          passes.sleeping -= 1;
        }
        if (!came) {
          waitingUntil = Math.min(waitingUntil ?? until, until);
          waitEvent('stopped', until, released);
          return reported;
        }
        waitEvent('resumed', until, false);
      }
    }

    /**
     * The writer lease for one pass; the only place passes obtain it.
     *
     * - A first pass takes it as every normal request does: through the run's
     *   wait for the writer lease, under its `writerWait` policy.
     * - A later pass, waking after a deferral's wait, does the same when the
     *   run has a `writerWait` deadline: it waits for the lease up to that
     *   deadline and fails with `WriterBusyError` there, as any request does.
     * - Without a deadline, a waking pass makes one attempt. Another holder
     *   (`held`) or storage contention (`contended`) returns undefined: the
     *   request then returns waiting, as exit mode does, its time already
     *   passed ("eligible since T"), rather than waiting indefinitely for a
     *   lease another process may keep for a long time.
     */
    async function leaseForPass(number: number): Promise<IRunLease | undefined> {
      if (number === 1 || writerPolicy.deadline !== undefined) {
        return writerLease();
      }
      const attempt = writer.tryLease();
      return attempt.kind === 'acquired' ? attempt.lease : undefined;
    }

    /** The run's operation engine, or the refusal of an operator action on a run without one. */
    function operationsOf(action: string): IOperationEngine {
      if (engine === undefined) {
        throw new SupervisionError('invalid-request', `${action} needs operation ports and a timer, which this run was not given`);
      }
      return engine;
    }

    /** Offer a post-work ordinary event; a failure there is a diagnostic. */
    function afterOrdinary(label: string, phase: IOrdinaryPhase): void {
      try {
        notify(observers, Object.freeze({ kind: 'ordinary', runId: context.runId, label, phase }));
      } catch (error: unknown) {
        diagnostics.push(`Run observer failed at ${phase} of ordinary work ${label}: ${describe(error)}`);
      }
    }

    const live: IRun = Object.freeze({
      context,
      get open(): boolean {
        return state.open;
      },
      resolve(step: IBindingDescriptor, request: IRequestOptions): Promise<IResolutionOutcome> {
        return within(() => inPasses(request.requestKey, {
          pass: async (lease, requestKey) => {
            const outcome = await resolution.resolve({ step, requestKey, lease });
            diagnostics.push(...outcome.diagnostics);
            return outcome;
          },
          report: (outcome) => outcome,
          // A failed step rejects the request instead of reporting, so nothing settles that a later pass could re-execute.
          settled: () => [],
          final: () => false,
        }), 'resolve');
      },
      resolveMembers(target: IMembersTarget, request: IRequestOptions): Promise<IMembersReport> {
        return within(() => inPasses(request.requestKey, {
          pass: async (lease, requestKey) => {
            const resolved = await resolution.resolveMembers({ template: target.template, step: target.step, requestKey, lease });
            diagnostics.push(...resolved.diagnostics);
            return resolved;
          },
          report: (resolved, requestScope, previous) => membersReport(target.step, resolved, requestScope, previous?.members),
          settled: (reported) => settledSteps(reported.members),
          final: () => false,
        }), 'resolveMembers');
      },
      resolveFold(step: IBindingDescriptor, request: IRequestOptions): Promise<IFoldReport> {
        return within(() => inPasses(request.requestKey, {
          pass: async (lease, requestKey) => {
            const resolved = await resolution.resolveFold({ step, requestKey, lease });
            diagnostics.push(...resolved.diagnostics);
            return resolved;
          },
          report: (resolved, requestScope, previous) => foldReport(resolved, requestScope, previous?.members),
          settled: (reported) => settledSteps(reported.members),
          // A strict fold that has failed cannot complete by waiting: the deferred work stays for a later run.
          final: (reported) => reported.outcome.status === 'failed',
        }), 'resolveFold');
      },
      resolveOutcomeFold(step: IBindingDescriptor, request: IRequestOptions): Promise<IOutcomeFoldReport> {
        return within(() => inPasses(request.requestKey, {
          pass: async (lease, requestKey) => {
            const resolved = await resolution.resolveOutcomeFold({ step, requestKey, lease });
            diagnostics.push(...resolved.diagnostics);
            return resolved;
          },
          report: (resolved, requestScope, previous) => outcomeFoldReport(resolved, requestScope, previous?.members),
          settled: (reported) => settledSteps(reported.members),
          // A population that cannot be established is not repaired by waiting.
          final: (reported) => reported.outcome.status === 'failed',
        }), 'resolveOutcomeFold');
      },
      check(step: IBindingDescriptor): Promise<ICheckOutcome> {
        return within(() => resolution.check({ step }), 'check');
      },
      recover(step: IBindingDescriptor, request: IRequestOptions): Promise<IRecoveryResult> {
        return within(() => resolution.recover({ step, requestKey: request.requestKey }), 'recover');
      },
      ordinary<TWork>(label: string, work: () => TWork | Promise<TWork>): Promise<Awaited<TWork>> {
        return within(async (): Promise<Awaited<TWork>> => {
          if (!nonempty(label)) {
            throw new SupervisionError('invalid-request', 'Ordinary work needs a nonempty label');
          }
          try {
            notify(observers, Object.freeze({ kind: 'ordinary', runId: context.runId, label, phase: 'begin' }));
          } catch (error: unknown) {
            throw new SupervisionError('observer-failure', `Run observer failed before ordinary work ${label}: ${describe(error)}`, error);
          }
          let value: Awaited<TWork>;
          try {
            value = await work();
          } catch (error: unknown) {
            afterOrdinary(label, 'fail');
            throw error;
          }
          afterOrdinary(label, 'end');
          return value;
        }, 'ordinary');
      },
      assertDeclaredCall(operation: IRunOperationName): void {
        // Checked at runtime too: untyped callers may pass any value, which must never reach a diagnostic.
        const named: unknown = operation;
        if (typeof named !== 'string' || !runOperationNames.has(named)) {
          throw new SupervisionError('invalid-request', 'assertDeclaredCall needs a run operation name');
        }
        const refusal = undeclaredCall(operation);
        if (refusal !== undefined) {
          throw refusal;
        }
      },
      inspectOperations(query?: { readonly status?: IOperationStatus }): Promise<readonly IOperationView[]> {
        return within(() => operationsOf('Inspecting operations').inspect(query?.status), 'inspectOperations');
      },
      settleOperation(settlement: IOperationSettlement): Promise<IOperationView> {
        // An operator's settlement is recorded under the writer lease, obtained as any normal request obtains it.
        return within(async () => operationsOf('Settling an operation').settle(settlement, await writerLease()), 'settleOperation');
      },
    });

    let value: Awaited<T>;
    try {
      value = await scope.run(frame, async () => body(live));
    } finally {
      // The body's outcome is kept; work it already started still belongs to the run.
      await drainAndClose();
      try {
        writer.release();
      } catch (error: unknown) {
        diagnostics.push(`Run ${context.runId} could not release its writer: ${describe(error)}`);
      }
    }
    return Object.freeze({
      context,
      value,
      diagnostics: Object.freeze([...diagnostics]),
      stop: closingStop,
      interruptions: Object.freeze([...state.interruptions]),
      waitingUntil,
    });
  }

  return Object.freeze({ current, execution, run });
}
