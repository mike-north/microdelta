/**
 * Contracts of Run Supervision: the scoped run lifetime it owns, the ports it
 * consumes and the operations a live run offers (ARC-001, DOM-2, RUN-001,
 * REUSE-009, basic A-19).
 *
 * Supervision owns *when* work may happen: the run's environment and
 * lifetime, admission of work Resolution could not avoid, and the positions
 * at which observers see work. It does not decide reuse (Reuse Resolution),
 * own claims or publication (Result History), or read the host directly: the
 * asynchronous scope is a structurally injected capability, so this package
 * has no Machine import and ordinary author helpers receive no context
 * parameter. A run is not a retained result; its identifier is volatile
 * metadata and never participates in reuse evidence.
 */
import type { IBindingDescriptor } from '@microdelta/definition';
import type {
  ICheckOutcome,
  IExecutionAdmission,
  ILifecycleEvent,
  ILifecycleObserver,
  IRecoveryResult,
  IResolution,
  IResolutionOutcome,
  IResolveRequest,
} from '@microdelta/resolution';

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
 * The ports Supervision hands to the Resolution it runs: its admission port
 * and its observer position. Both stay owned by Supervision.
 * @alpha
 */
export interface IResolutionPorts {
  /** Admission of work current validation could not avoid. */
  readonly admission: IExecutionAdmission;
  /** The lifecycle observer position Resolution reports to. */
  readonly observer: ILifecycleObserver;
}

/**
 * Phases of ordinary (nonmemoized) work: `begin` before the work runs, then
 * `end` after it returned or `fail` after it threw. Ordinary work has no
 * completed-result identity; these events carry no reference.
 * @alpha
 */
export type IOrdinaryPhase = 'begin' | 'end' | 'fail';

/**
 * One event offered to run observers: a framework lifecycle event of a
 * resolved step, or a phase of ordinary work. Events are frozen and name the
 * run they belong to.
 * @alpha
 */
export type IRunEvent =
  | { readonly kind: 'step'; readonly runId: string; readonly event: ILifecycleEvent }
  | { readonly kind: 'ordinary'; readonly runId: string; readonly label: string; readonly phase: IOrdinaryPhase };

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
 * A live run. Every operation executes inside the run's scope, so author code
 * it reaches can look up the run context without a parameter. After the run
 * closes, every operation rejects with `run-closed`.
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
  /** Report what a normal request would do, without admission, claims, bodies or writes. */
  check(step: IBindingDescriptor): Promise<ICheckOutcome>;
  /** Report the durable outcome of the execution a saved request key identifies, without executing (recovery entry operation). */
  recover(step: IBindingDescriptor, request: IRequestOptions): Promise<IRecoveryResult>;
  /** Run ordinary nonmemoized work, observed but with no completed-result identity. */
  ordinary<T>(label: string, work: () => T | Promise<T>): Promise<Awaited<T>>;
}

/**
 * What a completed run reports: its context, the body's value and the
 * post-commit diagnostics of every request and ordinary call it made.
 * @alpha
 */
export interface IRunResult<T> {
  /** The run's context. */
  readonly context: IRunContext;
  /** What the run body returned. */
  readonly value: T;
  /** Post-commit diagnostics, each reported once. */
  readonly diagnostics: readonly string[];
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
   * Run `body` as one supervised run. The run closes when the body settles:
   * its writer lease is released and later use of the run or its context fails.
   */
  run<T>(options: IRunOptions, body: (run: IRun) => T | Promise<T>): Promise<IRunResult<Awaited<T>>>;
}
