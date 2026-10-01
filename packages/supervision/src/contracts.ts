/**
 * Contracts of Run Supervision: the scoped run lifetime it owns, the ports it
 * consumes and the operations a live run offers (ARC-001, DOM-2, RUN-001,
 * RUN-002, RUN-014, RUN-015, REUSE-009, A-13, A-18, A-19).
 *
 * Supervision owns *when* work may happen: the run's environment and
 * lifetime, admission of work Resolution could not avoid, the positions at
 * which observers see work, the typed outcome of each template member, strict
 * fold and outcome fold in a run (RUN-005, RUN-010), the permits that bound
 * real sends,
 * the fan-out window, and the operator's stop intent as it reaches admission,
 * bodies, sends, waits and the publication commit. It does not decide reuse
 * (Reuse Resolution), own claims or publication (Result History), or read the
 * host directly: the asynchronous scope and the timer are structurally
 * injected capabilities, so this package has no Machine import and ordinary
 * author helpers receive no context parameter. A run is not a retained
 * result; its identifier is volatile metadata and never participates in reuse
 * evidence.
 */
import type { IBindingDescriptor } from '@microdelta/definition';
import type {
  ICheckOutcome,
  IDiscoveryOutcome,
  IExecutionAdmission,
  IExecutionSupervision,
  IFoldOutcome,
  IGateEvidence,
  IIncompleteOutcomeFoldCoverage,
  ICompleteOutcomeFoldCoverage,
  IOutcomeFoldOutcome,
  ILifecycleEvent,
  ILifecycleObserver,
  IRecoveryResult,
  IResolution,
  IResolutionOutcome,
  IResolveRequest,
  ResolutionError,
} from '@microdelta/resolution';

import type { IAbortSignal, IRunTimer, IStopController, IStopLevel, IStopState } from './control.js';

/**
 * One asynchronous scope slot: a value attached to the current asynchronous
 * execution that propagates through awaits and is isolated from concurrent
 * executions. Structurally identical to a host async context.
 * @alpha
 */
export interface IRunScope<T> {
  /** The value attached to the current asynchronous execution, if any. */
  getStore(): T | undefined;
  /** Run work with `value` attached to it and to everything it awaits. */
  run<TResult>(value: T, callback: () => TResult): TResult;
}

/**
 * The host capability Supervision needs: creating isolated asynchronous
 * scopes. Assembly supplies it (for example the Node Machine); Supervision
 * never imports a host.
 * @alpha
 */
export interface IRunScopeCapability {
  /** Create scope storage isolated from every other created scope. */
  createAsyncContext<T>(): IRunScope<T>;
}

/** Construction options of Run Supervision. @alpha */
export interface ISupervisionOptions {
  /** The structurally injected scope capability. */
  readonly context: IRunScopeCapability;
  /**
   * The structurally injected timer that waits for a time
   * ({@link IRunExecution.sleepUntil}). Without it such waits are refused as
   * an invalid request.
   */
  readonly timer?: IRunTimer;
}

/**
 * What runtime context lookup reveals about the live run: its volatile
 * identifier, the analysis (composition scope) and the selected environment.
 * Scoped access to it is not a recorded data dependency.
 * @alpha
 */
export interface IRunContext {
  /** Volatile identity of this run; never reuse evidence. */
  readonly runId: string;
  /** The analysis scope the run supervises. */
  readonly analysis: string;
  /** The environment selected for the whole run. */
  readonly environment: string;
}

/**
 * History's single-writer lease as Resolution's normal requests carry it.
 * Supervision passes it through; it authorizes storage mutation, never author
 * execution.
 * @alpha
 */
export type IRunLease = IResolveRequest['lease'];

/**
 * The run's access to storage's single-writer lease, supplied by assembly.
 * Supervision asks for the lease only for storage-mutating normal requests
 * and releases it exactly once when the run closes, so check-only and
 * recovery requests never need it and a refused miss never strands it.
 * @alpha
 */
export interface IRunWriter {
  /**
   * The currently valid lease for the next normal request, acquiring or
   * renewing it. Throws `SupervisionError('writer-unavailable')` when storage
   * reports another unexpired holder.
   */
  lease(): IRunLease;
  /** Release the lease if this run holds one. */
  release(): void;
}

/**
 * The ports Supervision hands to the Resolution it runs: its admission port,
 * its observer position, and its cancellation port with the fan-out window.
 * All stay owned by Supervision.
 * @alpha
 */
export interface IResolutionPorts {
  /**
   * Admission of work current validation could not avoid. Stop intent
   * cancels it, except that during a soft stop's drain the first attempt of a
   * child an admitted, executing step's body demands is still decided by the
   * policy.
   */
  readonly admission: IExecutionAdmission;
  /** The lifecycle observer position Resolution reports to. */
  readonly observer: ILifecycleObserver;
  /**
   * The cancellation port every admitted body and current-policy hook runs
   * through, every publication commit consults (RUN-014/015), and every
   * fan-out member resolves within (the bounded active window, RUN-002).
   */
  readonly execution: IExecutionSupervision;
}

/**
 * Phases of ordinary (nonmemoized) work: `begin` before the work runs, then
 * `end` after it returned or `fail` after it threw. Ordinary work has no
 * completed-result identity; these events carry no reference.
 * @alpha
 */
export type IOrdinaryPhase = 'begin' | 'end' | 'fail';

/**
 * What is known about a send's remote work after a hard stop aborted it
 * locally (RUN-014): the provider confirmed it `cancelled`, reported it still
 * `running`, or nothing is known (`unknown`: no provider cancellation, or no
 * answer). Never omitted, and never assumed cancelled.
 * @alpha
 */
export type IRemoteState = 'cancelled' | 'running' | 'unknown';

/**
 * Positions of one send (a permit-guarded real request):
 *
 * - `refused`: stop intent refused it before anything was sent;
 * - `begin`: it holds a permit and is being sent;
 * - `end` or `fail`: it settled on its own, successfully or not;
 * - `aborted`: a hard stop abandoned it locally while in flight;
 * - `cancel-requested`: provider cancellation was then requested;
 * - `remote-state`: the remote state was recorded.
 * @alpha
 */
export type ISendPhase = 'refused' | 'begin' | 'end' | 'fail' | 'aborted' | 'cancel-requested' | 'remote-state';

/**
 * One event offered to run observers: a framework lifecycle event of a
 * resolved step, a phase of ordinary work, a change of stop intent, or a
 * position of a send. Events are frozen, name the run they belong to, and
 * carry identifiers, levels and states only, never values (RUN-013).
 * @alpha
 */
export type IRunEvent =
  | { readonly kind: 'step'; readonly runId: string; readonly event: ILifecycleEvent }
  | { readonly kind: 'ordinary'; readonly runId: string; readonly label: string; readonly phase: IOrdinaryPhase }
  | { readonly kind: 'stop'; readonly runId: string; readonly level: Exclude<IStopLevel, 'none'>; readonly cause: IStopState['cause'] }
  | { readonly kind: 'send'; readonly runId: string; readonly label: string; readonly phase: Exclude<ISendPhase, 'remote-state'> }
  | { readonly kind: 'send'; readonly runId: string; readonly label: string; readonly phase: 'remote-state'; readonly remote: IRemoteState };

/**
 * An observer of a run. Observers cover memoized and nonmemoized work alike,
 * but they cannot authorize, veto, reorder or replace work: return values are
 * ignored. A throw before work begins stops only the affected call; a throw
 * after a commit or after ordinary work finished becomes a diagnostic.
 * @alpha
 */
export interface IRunObserver {
  /** Observe one event. */
  observe(event: IRunEvent): void;
}

/**
 * Options for one supervised run. Assembly supplies the Resolution factory
 * and writer port; the caller selects the environment and may supply an
 * admission policy and observers.
 * @alpha
 */
export interface IRunOptions {
  /** The analysis (composition scope) this run supervises. */
  readonly analysis: string;
  /** The environment selected for the whole run; a nonempty string. */
  readonly environment: string;
  /** Optional volatile run identifier; a process-local one is generated otherwise. */
  readonly runId?: string;
  /** Build the run's Resolution over Supervision's admission and observer ports. */
  readonly resolution: (ports: IResolutionPorts) => IResolution;
  /** Storage's single-writer lease for normal requests. */
  readonly writer: IRunWriter;
  /** Admission policy for work validation could not avoid; admits everything when absent. */
  readonly admission?: IExecutionAdmission;
  /** Observers, captured when the run starts. */
  readonly observers?: readonly IRunObserver[];
  /**
   * The operator's stop intent for this run. Without one the run is never
   * stopped. The same controller may be given to several runs; each run's
   * permits, waits and attempts stay its own.
   */
  readonly stop?: IStopController;
  /**
   * The run's permit pool size: how many sends may be in flight at once. A
   * permit guards only a real send, never waiting, deferral or a member's
   * subtree (RUN-002). A positive safe integer; 1 when absent, a
   * conservative default for paid providers that an operator sizes up.
   */
  readonly permits?: number;
  /**
   * The bounded active window of member fan-out: how many members of the
   * run's members requests, strict folds and outcome folds actively resolve
   * at once. Every run operation called from inside member or step work
   * (through a run the author code kept) is refused as an undeclared call
   * (CMP-9), so no fan-out ever waits for this window from inside a lane
   * holder (RUN-002). It is
   * independent of `permits`: the window bounds active member work and its
   * memory, permits bound provider requests. A member waiting for a time
   * lends its lane, so it never stalls its siblings. A positive safe integer;
   * 8 when absent.
   */
  readonly window?: number;
}

/**
 * Caller-supplied options of one top-level normal or recovery request. The
 * request key is a fresh opaque string the caller saved before starting the
 * work; it identifies the admitted executions of that request, never a cache
 * entry.
 * @alpha
 */
export interface IRequestOptions {
  /** The caller's saved request key; a nonempty opaque string. */
  readonly requestKey: string;
}

/**
 * The template step a members request resolves for every current member.
 * @alpha
 */
export interface IMembersTarget {
  /** The composed template's slot. */
  readonly template: string;
  /** One of the template's step slots. */
  readonly step: string;
}

/**
 * The typed outcome of one current member's instance in this run
 * (CMP-8, RUN-005, RUN-010). The five statuses never collapse into one
 * another:
 *
 * - `succeeded`: an accepted result exists now, reused or newly published.
 * - `skipped`: the member's gate explicitly excluded it from the required
 *   population; it has no result and nothing was admitted or retracted.
 * - `pending`: the member's required work was not completed in this run
 *   because admission denied it; never a terminal failure.
 * - `failed`: its gate failed or its resolution raised a typed failure.
 * - `cancelled`: Supervision withdrew the member's required work from this
 *   run through the admission port; terminal for a strict consumer.
 * @alpha
 */
export type IMemberOutcome =
  | {
      readonly status: 'succeeded';
      readonly key: string;
      readonly step: IBindingDescriptor;
      readonly gate: IGateEvidence | undefined;
      /** The reused or published outcome, with its exact reference. */
      readonly outcome: Extract<IResolutionOutcome, { readonly kind: 'reused' | 'published' }>;
    }
  | {
      readonly status: 'skipped';
      readonly key: string;
      readonly step: IBindingDescriptor;
      /** The gate evidence that excluded the member. */
      readonly gate: IGateEvidence;
    }
  | {
      readonly status: 'pending' | 'cancelled';
      readonly key: string;
      readonly step: IBindingDescriptor;
      readonly gate: IGateEvidence | undefined;
      /** The step whose work was refused: the instance itself or one of its children. */
      readonly refused: IBindingDescriptor;
      readonly reason: string;
    }
  | {
      readonly status: 'failed';
      readonly key: string;
      readonly step: IBindingDescriptor;
      readonly gate: IGateEvidence | undefined;
      /** The typed failure. */
      readonly error: ResolutionError;
    };

/**
 * How discovery settled for a members request, in Supervision's terms: keyed
 * (with its completion status), rejected by keying with Definition's
 * diagnostic, or not settled in this run because admission denied
 * (`pending`) or cancelled (`cancelled`) the discovery source's work.
 * @alpha
 */
export type IDiscoveryReport =
  | Extract<IDiscoveryOutcome, { readonly kind: 'keyed' | 'rejected' }>
  | {
      readonly kind: 'pending' | 'cancelled';
      readonly collection: IBindingDescriptor;
      readonly refused: IBindingDescriptor;
      readonly reason: string;
    };

/**
 * One members request's report: discovery and every current member's typed
 * outcome in canonical key order (none unless discovery keyed).
 * @alpha
 */
export interface IMembersReport {
  /** The template slot. */
  readonly template: string;
  /** The template step slot. */
  readonly step: string;
  /** How discovery settled. */
  readonly discovery: IDiscoveryReport;
  /** Every current member's typed outcome, in canonical key order. */
  readonly members: readonly IMemberOutcome[];
}

/**
 * The typed outcome of one strict fold in this run (CMP-8, RUN-010). The
 * five statuses never collapse into one another:
 *
 * - `succeeded`: the fold's result is current, reused or newly published,
 *   over a closed population whose every required member was accepted. Its
 *   outcome carries the framework's coverage (required keys, skipped keys,
 *   closure), independent of what the body reported.
 * - `waiting`: discovery is open, or a required member is pending; nothing
 *   has failed. Never terminal.
 * - `failed`: a required member failed or was cancelled, or discovery was
 *   rejected or cancelled, so strict completion is impossible in this run.
 *   It still names pending members and open discovery.
 * - `pending`: the fold was ready, but admission denied its own work; never a
 *   terminal failure.
 * - `cancelled`: the fold was ready, but Supervision withdrew its own work
 *   through the admission port; terminal for this run.
 *
 * `waiting` and `failed` never ran the fold body, admitted fold work or
 * published.
 * @alpha
 */
export type IStrictFoldOutcome =
  | {
      readonly status: 'succeeded';
      /** The reused or published outcome, with its exact reference and coverage. */
      readonly outcome: Extract<IFoldOutcome, { readonly kind: 'reused' | 'published' }>;
    }
  | {
      readonly status: 'waiting';
      /** Required members whose work was not completed in this run, in canonical key order. */
      readonly pending: readonly string[];
      /** Whether discovery has not closed in this run. */
      readonly openDiscovery: boolean;
    }
  | {
      readonly status: 'failed';
      /** Required members whose resolution failed, in canonical key order. */
      readonly failed: readonly string[];
      /** Required members whose work was cancelled, in canonical key order. */
      readonly cancelled: readonly string[];
      /** Required members whose work was not completed in this run, in canonical key order. */
      readonly pending: readonly string[];
      /** Whether discovery has not closed in this run. */
      readonly openDiscovery: boolean;
      /** Why strict completion is impossible. */
      readonly diagnostic: string;
    }
  | {
      readonly status: 'pending' | 'cancelled';
      /** The fold step whose own work was refused. */
      readonly refused: IBindingDescriptor;
      readonly reason: string;
    };

/**
 * One fold request's report: discovery, every current member's typed outcome
 * of the consumed template step in canonical key order (none unless
 * discovery keyed), and the strict fold's typed outcome.
 * @alpha
 */
export interface IFoldReport {
  /** The fold's composition-level step. */
  readonly fold: IBindingDescriptor;
  /** The template step descriptor (no member key) the fold consumes. */
  readonly over: IBindingDescriptor;
  /** How discovery settled. */
  readonly discovery: IDiscoveryReport;
  /** Every current member's typed outcome, in canonical key order. */
  readonly members: readonly IMemberOutcome[];
  /** The strict fold's typed outcome. */
  readonly outcome: IStrictFoldOutcome;
}

/**
 * The typed outcome of one outcome (tolerant) fold in this run (RUN-010). Its
 * statuses never collapse into one another, nor into a strict fold's:
 *
 * - `folded`: discovery is closed and every member has settled (succeeded,
 *   skipped, failed or cancelled), and the fold's result over those settled
 *   statuses is current, reused or newly published. Its outcome carries the
 *   framework's complete coverage, independent of what the body reported. It
 *   is not complete success: its coverage may list failed or cancelled
 *   members, which a strict fold would never fold.
 * - `waiting`: discovery is open (or its work was denied) or a member is
 *   pending, so the fold claims no complete set; it carries the partial
 *   coverage settled so far. Never terminal.
 * - `failed`: discovery was rejected or cancelled, so no population can be
 *   established in this run.
 * - `pending`: the set settled, but admission denied the fold's own work;
 *   never a terminal failure.
 * - `cancelled`: the set settled, but Supervision withdrew the fold's own
 *   work through the admission port (for example after a stop); terminal for
 *   this run.
 *
 * Only `folded` ran or reused the fold body; the others published nothing.
 * @alpha
 */
export type IOutcomeFoldRunOutcome =
  | {
      readonly status: 'folded';
      /** The reused or published outcome, with its exact reference and complete coverage. */
      readonly outcome: Extract<IOutcomeFoldOutcome, { readonly kind: 'reused' | 'published' }>;
    }
  | {
      readonly status: 'waiting';
      /** The members settled so far, the pending ones and whether discovery is open. */
      readonly coverage: IIncompleteOutcomeFoldCoverage;
    }
  | {
      readonly status: 'failed';
      /** Why no population can be established. */
      readonly diagnostic: string;
    }
  | {
      readonly status: 'pending' | 'cancelled';
      /** The fold step whose own work was refused. */
      readonly refused: IBindingDescriptor;
      readonly reason: string;
      /** The complete coverage of the settled set the fold would have folded. */
      readonly coverage: ICompleteOutcomeFoldCoverage;
    };

/**
 * One outcome fold request's report: discovery, every current member's typed
 * outcome of the consumed template step in canonical key order (none unless
 * discovery keyed), and the outcome fold's typed outcome.
 * @alpha
 */
export interface IOutcomeFoldReport {
  /** The outcome fold's composition-level step. */
  readonly fold: IBindingDescriptor;
  /** The template step descriptor (no member key) the fold consumes. */
  readonly over: IBindingDescriptor;
  /** How discovery settled. */
  readonly discovery: IDiscoveryReport;
  /** Every current member's typed outcome, in canonical key order. */
  readonly members: readonly IMemberOutcome[];
  /** The outcome fold's typed outcome. */
  readonly outcome: IOutcomeFoldRunOutcome;
}

/**
 * A live run. Every operation executes inside the run's scope, so author code
 * it reaches can look up the run context without a parameter. After the run
 * closes, every operation rejects with `run-closed`. Every operation belongs
 * to the run body: called from inside a member's work or any step attempt
 * (author code that kept the run), it rejects at once with `undeclared-call`
 * (CMP-9), because what it resolves or reads would enter no evidence of the
 * calling body. Read-only inspection outside a run is unaffected.
 * @alpha
 */
export interface IRun {
  /** The run's context. */
  readonly context: IRunContext;
  /**
   * Whether the run still accepts work: true until its body and every
   * operation started through this run have settled, false afterwards.
   */
  readonly open: boolean;
  /** Resolve one step under current policy (normal entry operation). */
  resolve(step: IBindingDescriptor, request: IRequestOptions): Promise<IResolutionOutcome>;
  /**
   * Resolve one template step for every current member of its keyed
   * collection and report each member's typed outcome. Members progress
   * independently: one member's failure, refusal or skip, and open discovery,
   * never prevent another member whose evidence is ready from completing. A
   * run-level failure (the admission port or an observer failing, damaged
   * History, a wrong request) rejects the whole request instead of failing
   * any member.
   */
  resolveMembers(target: IMembersTarget, request: IRequestOptions): Promise<IMembersReport>;
  /**
   * Resolve one strict fold and report it: every current member of the
   * consumed template step progresses independently first, then the fold
   * fails, waits, or is validated or executed. A failed or waiting fold runs
   * no body, admits no fold work and publishes nothing.
   */
  resolveFold(step: IBindingDescriptor, request: IRequestOptions): Promise<IFoldReport>;
  /**
   * Resolve one outcome (tolerant) fold and report it: every current member
   * of the consumed template step progresses independently first; then,
   * while discovery is open or a member is pending, the fold waits with the
   * coverage settled so far, and once every member of a closed population has
   * settled it is validated or executed over their settled statuses. A
   * waiting or failed outcome fold runs no body, admits no fold work and
   * publishes nothing.
   */
  resolveOutcomeFold(step: IBindingDescriptor, request: IRequestOptions): Promise<IOutcomeFoldReport>;
  /** Report what a normal request would do, without admission, claims, bodies or writes. */
  check(step: IBindingDescriptor): Promise<ICheckOutcome>;
  /** Report the durable outcome of the execution a saved request key identifies, without executing (recovery entry operation). */
  recover(step: IBindingDescriptor, request: IRequestOptions): Promise<IRecoveryResult>;
  /** Run ordinary nonmemoized work, observed but with no completed-result identity. */
  ordinary<T>(label: string, work: () => T | Promise<T>): Promise<Awaited<T>>;
  /**
   * Assert that the current call is a declared one. Invoked from inside a
   * member's work or a step attempt of this open run, it records the run
   * diagnostic and throws the CMP-9 refusal, `SupervisionError('undeclared-call')`;
   * otherwise it returns. The facade's synchronous exact `read` calls it
   * first, so that result read obeys the same rule as the run's own
   * operations.
   *
   * It is `@alpha` rather than `@internal` only because the facade is a
   * separate package that consumes Supervision's generated alpha
   * declarations, from which API Extractor trims `@internal` members; it is
   * not meant for authors.
   * @param operation - The operation's name, for the diagnostic.
   */
  assertDeclaredCall(operation: string): void;
}

/**
 * A send a hard stop aborted, with its recorded remote state.
 * @alpha
 */
export interface ISendInterruption {
  /** The send's identifier label. */
  readonly label: string;
  /** What is known about its remote work. */
  readonly remote: IRemoteState;
}

/**
 * What a completed run reports: its context, the body's value, the
 * post-commit diagnostics of every request and ordinary call it made, the
 * stop intent in force when it closed, and every send a hard stop aborted.
 * @alpha
 */
export interface IRunResult<T> {
  /** The run's context. */
  readonly context: IRunContext;
  /** What the run body returned. */
  readonly value: T;
  /** Post-commit diagnostics, each reported once. */
  readonly diagnostics: readonly string[];
  /** The stop intent in force when the run closed. */
  readonly stop: IStopState;
  /** Every send a hard stop aborted, in order, with its remote state. */
  readonly interruptions: readonly ISendInterruption[];
}

/**
 * One real, permit-guarded send: the constrained request a permit exists for,
 * such as one call to a paid provider. It is the primitive an external
 * operation handle builds on; it records no operation identity itself.
 * @alpha
 */
export interface ISendRequest<T> {
  /**
   * An identifier naming the send in events, for example `assess`. It must
   * never embed a value (RUN-013).
   */
  readonly label: string;
  /**
   * Whether this send repeats an earlier attempt of the same work. Any stop
   * refuses a retry; only a hard stop refuses a draining step's first attempt.
   */
  readonly retry?: boolean;
  /**
   * Perform the send. It receives the send's own abort signal, which aborts
   * when a hard stop takes effect for the run and is detached from the run
   * once the send settles; the adapter should abandon its request when it
   * aborts.
   */
  perform(signal: IAbortSignal): Promise<T>;
  /**
   * Ask the provider to cancel the remote work after a local abort, where
   * the provider supports it: resolves `cancelled` when confirmed, `running`
   * when the work continues. Absent, or failing, the remote state is `unknown`.
   * The send, and so its run, does not settle until this answers, so an
   * adapter must bound it (for example with its own timeout that resolves
   * `running` or rejects) rather than wait indefinitely for the provider.
   */
  cancel?(): Promise<'cancelled' | 'running'>;
}

/**
 * The live run's execution controls, as author code and adapters find them
 * through scoped lookup: stop intent, its abort signal, permit-guarded sends
 * and stop-aware waiting. Each run's controls are its own (RUN-001); `step`
 * attributes them to the admitted step whose body is running, if any.
 * @alpha
 */
export interface IRunExecution {
  /** The run's volatile identifier. */
  readonly runId: string;
  /** The admitted step whose body this execution belongs to; undefined outside one. */
  readonly step: IBindingDescriptor | undefined;
  /**
   * The run's stop intent now. It stays readable after the run closes (it is
   * the operator's controller state); only `send` and `sleepUntil` then fail.
   */
  readonly stop: IStopState;
  /**
   * Aborts when a hard stop takes effect for the run. It stays readable after
   * the run closes, and a stop requested after the close no longer aborts it.
   */
  readonly signal: IAbortSignal;
  /**
   * Perform one send holding one of the run's permits.
   *
   * - A hard stop refuses it, and a soft stop refuses a retry, or any send
   *   outside an admitted step. A step attempt whose earlier send or wait was
   *   refused or aborted sends nothing more.
   * - Waiting for a permit holds none; a hard stop ends the wait (a permit
   *   granted afterwards is handed straight back).
   * - A hard stop aborts it in flight: the permit is released, provider
   *   cancellation is requested where supported, and the remote state is
   *   recorded.
   *
   * A refusal or abort rejects with `SupervisionError('stopped')`, and the
   * step attempt it belonged to can no longer publish; a send's own failure
   * rejects with its error. After the run closes it rejects with `run-closed`.
   */
  send<T>(request: ISendRequest<T>): Promise<T>;
  /**
   * Wait, holding no permit, until the wall clock reaches
   * `epochMilliseconds`: the wait before a retry or a deferred resumption.
   * A fan-out member lends its window lane for the wait and, on waking,
   * reclaims one ahead of members that have not started (wakers among
   * themselves first in, first out), so it never stalls its siblings. While
   * the lane is lent, other branches of the member's body (for example the
   * other side of `Promise.all([sleepUntil(t), send(...)])`) keep running
   * without one: the window bounds members holding a lane, not every branch
   * of a member's body, while permits still bound the actual sends. Because
   * a stop forbids the retry the wait precedes, any stop ends the wait at
   * once with `SupervisionError('stopped')`, and the step attempt can no
   * longer publish.
   */
  sleepUntil(epochMilliseconds: number): Promise<void>;
}

/**
 * Run Supervision over one injected scope capability.
 * @alpha
 */
export interface ISupervision {
  /**
   * The live run's context in the current asynchronous execution. Fails with
   * `outside-run`, `run-closed` or `composition-phase` rather than guessing.
   */
  current(): IRunContext;
  /**
   * The live run's execution controls in the current asynchronous execution,
   * attributed to the admitted step whose body is running there, if any.
   * Fails as {@link ISupervision.current} does.
   */
  execution(): IRunExecution;
  /**
   * Run `body` as one supervised run. The run stays live until the body and
   * every operation started through the run (including operations started
   * while it waits) have settled; it closes in the same turn that observes no
   * started work, so any operation is either accepted and waited for, or
   * rejected before starting. Closing releases the writer lease; afterwards
   * the run's operations and context lookups fail and admission is denied.
   * While the run is open, its stop controller governs it: a soft stop
   * cancels later admissions while admitted steps drain, and a hard stop
   * also interrupts bodies, sends and waits and forbids later commits (see
   * {@link IRunExecution}). The returned result carries the body's own value
   * (or rejects with the body's own failure), the diagnostics of all
   * participating work, the stop intent in force at close and every send a
   * hard stop aborted.
   */
  run<T>(options: IRunOptions, body: (run: IRun) => T | Promise<T>): Promise<IRunResult<Awaited<T>>>;
}
