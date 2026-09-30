/**
 * The Run Supervision engine. One supervised run is a scoped lifetime:
 *
 * - its context (volatile run id, analysis, selected environment) is attached
 *   to the run body and to every request and ordinary call through the
 *   injected asynchronous scope, so author code finds it without a parameter;
 * - it stays live until its body *and* every operation started through the
 *   run (`resolve`, `resolveMembers`, `resolveFold`, `check`, `recover`,
 *   `ordinary`) have settled, including
 *   operations started while it waits and those whose aggregate (for example
 *   a `Promise.all` with a failing sibling) the body stopped awaiting early;
 *   only then does it close, and afterwards its operations, escaped context
 *   lookups and admission decisions all fail or are denied. The body's own
 *   outcome, value or failure, is what the run reports;
 * - storage's writer lease is taken only for normal requests and released
 *   exactly once at actual close, so a refused miss, a check or a recovery
 *   never strands it and started work never loses it;
 * - admission and observer positions are Supervision's ports into Resolution:
 *   the caller's policy decides admission, and observers are captured at
 *   start, see frozen events and can neither veto nor replace work;
 * - the operator's stop controller is observed while the run is open: a soft
 *   stop cancels every later admission while admitted steps drain, and a
 *   hard stop also aborts the run's signal, which interrupts admitted bodies,
 *   sends, permit waits and waits for a time and forbids later commits (see
 *   `execution.ts`);
 * - the run owns a bounded permit pool for its sends and hands Resolution
 *   the bounded active window of member fan-out.
 *
 * Supervision never decides reuse, touches History or reads the host itself.
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
  IRequestOptions,
  IRun,
  IRunContext,
  IRunEvent,
  IRunExecution,
  IRunOptions,
  IRunResult,
  IRunScope,
  IStrictFoldOutcome,
  ISupervision,
  ISupervisionOptions,
} from './contracts.js';
import { createAbortSource, createStopController } from './control.js';
import type { IStopLevel, IStopState } from './control.js';
import { SupervisionError } from './errors.js';
import { raceAbort, runControls, supervisedExecution } from './execution.js';
import type { IRunFrame, ISupervisedRun } from './execution.js';
import { createPermitPool } from './permits.js';

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

/**
 * Classify one member's Resolution outcome as its typed member outcome
 * (CMP-8, RUN-010). An admission denial leaves the member pending, never
 * failed; a cancellation decided through Supervision's admission port is
 * cancelled; a gated-out member is skipped with its gate evidence and no
 * result; a typed Resolution failure is failed.
 */
function memberOutcome(member: IMemberResolution): IMemberOutcome {
  const { key, step, gate, outcome } = member;
  switch (outcome.kind) {
    case 'reused':
    case 'published':
      return Object.freeze({ status: 'succeeded', key, step, gate, outcome });
    case 'skipped':
      return Object.freeze({ status: 'skipped', key, step, gate: outcome.gate });
    case 'refused':
      return Object.freeze({ status: outcome.disposition === 'cancelled' ? 'cancelled' : 'pending', key, step, gate, refused: outcome.refused, reason: outcome.reason });
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

/** Report one members request: discovery in Supervision's terms and every member's typed outcome. */
function membersReport(step: string, resolved: IMembersResolution): IMembersReport {
  return Object.freeze({ template: resolved.template, step, discovery: discoveryReport(resolved.discovery), members: Object.freeze(resolved.members.map(memberOutcome)) });
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
function foldReport(resolved: IFoldResolution): IFoldReport {
  return Object.freeze({
    fold: resolved.outcome.step,
    over: resolved.over,
    discovery: discoveryReport(resolved.discovery),
    members: Object.freeze(resolved.members.map(memberOutcome)),
    outcome: strictFoldOutcome(resolved.outcome),
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
    const permits = positiveCount(runOptions.permits, 1, 'permits');
    const window = positiveCount(runOptions.window, permits, 'window');
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
    const diagnostics: string[] = [];

    /**
     * Operations started through this run that have not settled: requests,
     * ordinary work, sends and waits. The run stays live until this set is
     * empty after its body settled.
     */
    const started = new Set<Promise<unknown>>();

    const state: ISupervisedRun = {
      context,
      open: true,
      controller,
      hard: createAbortSource((error: unknown) => {
        diagnostics.push(`An abort listener of run ${context.runId} failed: ${describe(error)}`);
      }),
      stopped: createAbortSource(),
      permits: createPermitPool(permits),
      timer,
      interruptions: [],
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
    const frame: IRunFrame = Object.freeze({ run: state, attempt: undefined });

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
    /** The cancellation of new work once the run is stopped, or undefined while it is not. */
    const stopRefusal = (): IAdmissionDecision | undefined => {
      if (state.hard.signal.aborted) {
        return Object.freeze({ kind: 'cancelled', reason: `run ${context.runId} is stopped: a hard stop admits no new work` });
      }
      return state.stopped.signal.aborted ? Object.freeze({ kind: 'cancelled', reason: `run ${context.runId} is stopped: a soft stop admits no new work` }) : undefined;
    };
    /**
     * Supervision's admission port: the caller's policy while open and not
     * stopped (RUN-014: no admission after a soft stop). A policy may decide
     * asynchronously; a decision that arrives after the run closed is replaced
     * by denial, one that arrives after a stop by cancellation, and a hard
     * stop ends the wait for a pending decision at once.
     */
    const admission: IExecutionAdmission = Object.freeze({
      async admit(request: IAdmissionRequest): Promise<IAdmissionDecision> {
        if (!state.open) {
          return closedDenial();
        }
        const before = stopRefusal();
        if (before !== undefined) {
          return before;
        }
        const decided = await raceAbort(Promise.resolve(policy.admit(request)), state.hard.signal);
        if (!state.open) {
          return closedDenial();
        }
        const after = stopRefusal();
        if (after !== undefined || decided.aborted) {
          // Only a hard stop ends the wait early, and that stop cancels the work.
          return after ?? closedDenial();
        }
        return decided.value;
      },
    });
    /** Supervision's observer position for Resolution's lifecycle events. */
    const observer: ILifecycleObserver = Object.freeze({
      observe(event: ILifecycleEvent): void {
        notify(observers, Object.freeze({ kind: 'step', runId: context.runId, event }));
      },
    });
    const resolution: IResolution = runOptions.resolution(Object.freeze({ admission, observer, execution: supervisedExecution(state, enter), window }));

    /**
     * Run an operation inside this run's scope, after checking it is still
     * open, and account for it until it settles.
     */
    function within<TResult>(operation: () => TResult | Promise<TResult>): Promise<TResult> {
      return state.track(() => scope.run(frame, async () => operation()));
    }

    /**
     * Wait until every started operation, including ones started meanwhile,
     * has settled, then close the run in the same synchronous turn that
     * observes no started work. Closing there, rather than after yielding back
     * to the caller, leaves no window in which a queued call could be accepted
     * yet not waited for: every later call is rejected as new work. Stop
     * intent is no longer observed once the run has closed.
     */
    async function drainAndClose(): Promise<void> {
      while (started.size > 0) {
        await Promise.all([...started]);
      }
      state.open = false;
      unsubscribe();
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
        return within(async () => {
          const outcome = await resolution.resolve({ step, requestKey: request.requestKey, lease: writer.lease() });
          diagnostics.push(...outcome.diagnostics);
          return outcome;
        });
      },
      resolveMembers(target: IMembersTarget, request: IRequestOptions): Promise<IMembersReport> {
        return within(async () => {
          const resolved = await resolution.resolveMembers({ template: target.template, step: target.step, requestKey: request.requestKey, lease: writer.lease() });
          diagnostics.push(...resolved.diagnostics);
          return membersReport(target.step, resolved);
        });
      },
      resolveFold(step: IBindingDescriptor, request: IRequestOptions): Promise<IFoldReport> {
        return within(async () => {
          const resolved = await resolution.resolveFold({ step, requestKey: request.requestKey, lease: writer.lease() });
          diagnostics.push(...resolved.diagnostics);
          return foldReport(resolved);
        });
      },
      check(step: IBindingDescriptor): Promise<ICheckOutcome> {
        return within(() => resolution.check({ step }));
      },
      recover(step: IBindingDescriptor, request: IRequestOptions): Promise<IRecoveryResult> {
        return within(() => resolution.recover({ step, requestKey: request.requestKey }));
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
        });
      },
    });

    let value: Awaited<T>;
    /** The stop intent in force when the run closed. */
    let closingStop: IStopState = controller.state;
    try {
      value = await scope.run(frame, async () => body(live));
    } finally {
      // The body's outcome is kept; work it already started still belongs to the run.
      await drainAndClose();
      closingStop = controller.state;
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
    });
  }

  return Object.freeze({ current, execution, run });
}
