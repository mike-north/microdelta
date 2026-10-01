/**
 * The workspace alpha run path: the facade's assembly of the owner
 * implementations into the actual authoring path. A workspace is one durable
 * History store opened over Node's SQLite and clock capabilities; each run is
 * supervised by Run Supervision, whose Resolution resolves steps against that
 * store with Tracking evidence and Materialization views. The facade composes
 * owners only: it adds no policy, no cache and no seventh authority. Every
 * export is a facade-local `@alpha` declaration; spellings are not a public API.
 */
import type {
  ICandidateMiss as IResolutionCandidateMiss,
  ICheckOutcome as IResolutionCheckOutcome,
  IAdmissionDecision as IResolutionAdmissionDecision,
  IAdmissionRequest as IResolutionAdmissionRequest,
  IExecutionAdmission,
  IFoldCoverage as IResolutionFoldCoverage,
  IFoldOutcome as IResolutionFoldOutcome,
  ICompleteOutcomeFoldCoverage as IResolutionCompleteOutcomeFoldCoverage,
  IIncompleteOutcomeFoldCoverage as IResolutionIncompleteOutcomeFoldCoverage,
  IOutcomeFoldCoverage as IResolutionOutcomeFoldCoverage,
  IOutcomeFoldOutcome as IResolutionOutcomeFoldOutcome,
  IGateEvidence as IResolutionGateEvidence,
  ILifecycleEvent as IResolutionLifecycleEvent,
  ILifecyclePhase as IResolutionLifecyclePhase,
  IRecoveryResult as IResolutionRecoveryResult,
  IResolutionErrorCode as IResolutionErrorCodeOf,
  IResolutionOutcome as IResolutionOutcomeOf,
} from '@microdelta/resolution';
import { StaleWriterError, openDurableHistory } from '@microdelta/history';
import type { ICompletedResultReference as IHistoryReference, IDurableHistory, IWriterLease } from '@microdelta/history';
import { createNodeClock, createNodeSqlite, createNodeTimer } from '@microdelta/machine-node';
import { ResolutionError as ResolutionErrorClass, createResolution } from '@microdelta/resolution';
import {
  SupervisionError as SupervisionErrorClass,
  createStopController as createSupervisionStopController,
  createSupervision,
  ordinaryLifecycle as supervisionOrdinaryLifecycle,
  stepLifecycle as supervisionStepLifecycle,
} from '@microdelta/supervision';
import type {
  IAbortSignal as ISupervisionAbortSignal,
  IRemoteState as ISupervisionRemoteState,
  IRunExecution as ISupervisionRunExecution,
  IRunWriter,
  ISendInterruption as ISupervisionSendInterruption,
  ISendPhase as ISupervisionSendPhase,
  ISendRequest as ISupervisionSendRequest,
  IStopCause as ISupervisionStopCause,
  IStopController as ISupervisionStopController,
  IStopLevel as ISupervisionStopLevel,
  IStopRequest as ISupervisionStopRequest,
  IStopState as ISupervisionStopState,
} from '@microdelta/supervision';
import { createTrackingObserver } from '@microdelta/tracking';
import type {
  IOrdinaryPhase as ISupervisionOrdinaryPhase,
  IRequestOptions as ISupervisionRequestOptions,
  IRun,
  IRunContext as ISupervisionRunContext,
  IDiscoveryReport as ISupervisionDiscoveryReport,
  IFoldReport as ISupervisionFoldReport,
  IMemberOutcome as ISupervisionMemberOutcome,
  IMembersReport as ISupervisionMembersReport,
  IMembersTarget as ISupervisionMembersTarget,
  IOutcomeFoldReport as ISupervisionOutcomeFoldReport,
  IOutcomeFoldRunOutcome as ISupervisionOutcomeFoldRunOutcome,
  IRunEvent as ISupervisionRunEvent,
  IRunObserver as ISupervisionRunObserver,
  IRunResult as ISupervisionRunResult,
  IStrictFoldOutcome as ISupervisionStrictFoldOutcome,
  ISupervisionErrorCode as ISupervisionErrorCodeOf,
} from '@microdelta/supervision';

import type { IAuthoring, IComposition } from './authoring.js';
import { machine } from './host.js';

/** An exact reference to one completed result. @alpha */
export type ICompletedResultReference = IHistoryReference;

/** The outcome of a normal request: reused, published or refused, with its exact reference when it has one. @alpha */
export type IResolutionOutcome = IResolutionOutcomeOf;

/** The outcome of a check-only request. @alpha */
export type ICheckOutcome = IResolutionCheckOutcome;

/** The durable outcome of one identified admitted execution. @alpha */
export type IRecoveryResult = IResolutionRecoveryResult;

/** One request for new work presented to admission. @alpha */
export type IAdmissionRequest = IResolutionAdmissionRequest;

/** An admission decision; denial is an ordinary typed outcome. @alpha */
export type IAdmissionDecision = IResolutionAdmissionDecision;

/** A caller's admission policy for work validation could not avoid. @alpha */
export type IAdmissionPolicy = IExecutionAdmission;

/** One framework lifecycle event of a resolved step. @alpha */
export type ILifecycleEvent = IResolutionLifecycleEvent;

/** One framework lifecycle position of a resolved step. @alpha */
export type ILifecyclePhase = IResolutionLifecyclePhase;

/** A phase of ordinary nonmemoized work. @alpha */
export type IOrdinaryPhase = ISupervisionOrdinaryPhase;

/** The live run's context: volatile run id, analysis and selected environment. @alpha */
export type IRunContext = ISupervisionRunContext;

/** One event offered to run observers. @alpha */
export type IRunEvent = ISupervisionRunEvent;

/** The template step a members request resolves for every current member. @alpha */
export type IMembersTarget = ISupervisionMembersTarget;

/** One current template member's typed outcome in a run: succeeded, skipped, pending, failed or cancelled. @alpha */
export type IMemberOutcome = ISupervisionMemberOutcome;

/** How discovery settled for a members request: keyed, rejected, pending or cancelled. @alpha */
export type IDiscoveryReport = ISupervisionDiscoveryReport;

/** One members request's report: discovery and every current member's typed outcome in canonical key order. @alpha */
export type IMembersReport = ISupervisionMembersReport;

/** The evidence of one template instance's settled gate: its selection and the facts it read in its own frame. @alpha */
export type IGateEvidence = IResolutionGateEvidence;

/**
 * One strict fold request's report: how discovery settled, every current
 * member's typed outcome in canonical key order, and the fold's typed outcome.
 * @alpha
 */
export type IFoldReport = ISupervisionFoldReport;

/**
 * A strict fold's typed outcome in a run: `succeeded` with its settled
 * reference and coverage, `waiting` on pending members or open discovery,
 * `failed` naming failed, cancelled and pending keys, or `pending` or
 * `cancelled` when the fold's own work was refused. Only `succeeded` ran or
 * reused the fold.
 * @alpha
 */
export type IStrictFoldOutcome = ISupervisionStrictFoldOutcome;

/** Resolution's settled fold outcome, carried by a succeeded {@link IStrictFoldOutcome}. @alpha */
export type IFoldOutcome = IResolutionFoldOutcome;

/**
 * Framework coverage of a reused or published strict fold: the required and
 * skipped member keys and discovery closure, derived from the delivered
 * members rather than anything the fold body reports.
 * @alpha
 */
export type IFoldCoverage = IResolutionFoldCoverage;

/**
 * One outcome (tolerant) fold request's report: how discovery settled, every
 * current member's typed outcome in canonical key order, and the outcome
 * fold's typed outcome.
 * @alpha
 */
export type IOutcomeFoldReport = ISupervisionOutcomeFoldReport;

/**
 * An outcome fold's typed outcome in a run: `folded` with its settled
 * reference and complete coverage (which may list failed and cancelled
 * members, so it is never strict complete success), `waiting` with the
 * partial coverage while discovery is open or a member is pending, `failed`
 * when no population can be established, or `pending` or `cancelled` when
 * the fold's own work was refused. Only `folded` ran or reused the fold.
 * @alpha
 */
export type IOutcomeFoldRunOutcome = ISupervisionOutcomeFoldRunOutcome;

/** Resolution's settled outcome fold outcome, carried by a folded {@link IOutcomeFoldRunOutcome}. @alpha */
export type IOutcomeFoldOutcome = IResolutionOutcomeFoldOutcome;

/**
 * Framework coverage of an outcome fold: every current member in exactly one
 * of succeeded, skipped, failed, cancelled or pending, whether discovery is
 * open, and whether the set is complete (closed and nothing pending). Derived
 * from how members settled, never from what the fold body reports.
 * @alpha
 */
export type IOutcomeFoldCoverage = IResolutionOutcomeFoldCoverage;

/** Coverage of an outcome fold whose closed population has completely settled: nothing pending, discovery closed. @alpha */
export type ICompleteOutcomeFoldCoverage = IResolutionCompleteOutcomeFoldCoverage;

/** Coverage of an outcome fold whose set has not settled: discovery open or a member pending. @alpha */
export type IIncompleteOutcomeFoldCoverage = IResolutionIncompleteOutcomeFoldCoverage;

/** Why one earlier candidate result was not reused. @alpha */
export type ICandidateMiss = IResolutionCandidateMiss;

/** An observe-only run observer. @alpha */
export type IRunObserver = ISupervisionRunObserver;

/** Caller-supplied options of one top-level normal or recovery request. @alpha */
export type IRequestOptions = ISupervisionRequestOptions;

/** What a completed run reports. @alpha */
export type IRunResult<T> = ISupervisionRunResult<T>;

/** Resolution failure codes. @alpha */
export type IResolutionErrorCode = IResolutionErrorCodeOf;

/** Supervision failure codes. @alpha */
export type ISupervisionErrorCode = ISupervisionErrorCodeOf;

/** The stop level in force: none, soft (drain) or hard (abort). @alpha */
export type IStopLevel = ISupervisionStopLevel;

/** Why a stop level holds: the operator, or an operator deadline that escalated a soft stop. @alpha */
export type IStopCause = ISupervisionStopCause;

/** One operator stop request, with an optional deadline for a soft stop. @alpha */
export type IStopRequest = ISupervisionStopRequest;

/** The stop intent in force: level, cause and armed deadline. @alpha */
export type IStopState = ISupervisionStopState;

/** Operator stop intent given to runs; created by {@link createStopController}. @alpha */
export type IStopController = ISupervisionStopController;

/** The portable cooperative abort signal a hard stop aborts. @alpha */
export type IAbortSignal = ISupervisionAbortSignal;

/** What is known about an aborted send's remote work: cancelled, running or unknown. @alpha */
export type IRemoteState = ISupervisionRemoteState;

/** One real, permit-guarded send performed through {@link IRunExecution}. @alpha */
export type ISendRequest<T> = ISupervisionSendRequest<T>;

/** A position of one send, as run observers see it. @alpha */
export type ISendPhase = ISupervisionSendPhase;

/** A send a hard stop aborted, with its recorded remote state. @alpha */
export type ISendInterruption = ISupervisionSendInterruption;

/** The live run's execution controls: stop intent, abort signal, permit-guarded sends and stop-aware waits. @alpha */
export type IRunExecution = ISupervisionRunExecution;

/**
 * A failed resolution; `code` names the violated contract.
 * @alpha
 */
export const ResolutionError: typeof ResolutionErrorClass = ResolutionErrorClass;
/** The instance type of the `ResolutionError` class. @alpha */
export type ResolutionError = ResolutionErrorClass;

/**
 * A failed supervision request; `code` names the violated run contract.
 * @alpha
 */
export const SupervisionError: typeof SupervisionErrorClass = SupervisionErrorClass;
/** The instance type of the `SupervisionError` class. @alpha */
export type SupervisionError = SupervisionErrorClass;

/**
 * The fixed, framework-owned positions of one resolved step, in order.
 * Observers see events at these positions; nothing can add, reorder or
 * replace them.
 * @alpha
 */
export const stepLifecycle: readonly ILifecyclePhase[] = supervisionStepLifecycle;

/**
 * The fixed positions of ordinary nonmemoized work.
 * @alpha
 */
export const ordinaryLifecycle: readonly IOrdinaryPhase[] = supervisionOrdinaryLifecycle;

/**
 * Options for opening a workspace over one durable History store file.
 * @alpha
 */
export interface IWorkspaceOptions {
  /** The SQLite file location. Moving the file does not change its logical store. */
  readonly location: string;
  /** The logical store identity this file holds, or is created to hold. */
  readonly logicalStore: string;
  /**
   * Positive safe-integer writer lease duration in milliseconds, renewed when
   * each normal request of a run starts. Defaults to 30 seconds. It is not
   * renewed while one request runs: a single request (a source check or
   * summary body) that outlives the lease fails with History's stale-writer
   * error and leaves its attempt incomplete and recoverable. Choose a lease
   * longer than the slowest single request.
   */
  readonly leaseMilliseconds?: number;
}

/**
 * Options for one workspace run over an author's composition.
 * @alpha
 */
export interface IWorkspaceRunOptions<TInputs extends object, THelpers extends object> {
  /** The builders that minted the composition. */
  readonly authoring: IAuthoring<TInputs, THelpers>;
  /** The frozen current composition; its scope is the analysis. */
  readonly composition: IComposition<TInputs, THelpers>;
  /** The environment selected for the whole run. */
  readonly environment: string;
  /** Optional volatile run identifier. */
  readonly runId?: string;
  /** Admission policy for work validation could not avoid; admits everything when absent. */
  readonly admission?: IAdmissionPolicy;
  /** Observers, captured when the run starts. */
  readonly observers?: readonly IRunObserver[];
  /** The operator's stop intent for this run, from {@link createStopController}; never stopped when absent. */
  readonly stop?: IStopController;
  /**
   * How many sends may be in flight at once (the run's permit pool). A
   * permit guards only a real send, never waiting. Defaults to 1.
   */
  readonly permits?: number;
  /**
   * How many fan-out members actively resolve at once, independent of
   * `permits`; a member waiting for a time lends its lane. Defaults to 8.
   */
  readonly window?: number;
}

/**
 * A live workspace run: Supervision's run operations plus an exact read of a
 * completed result's data for ordinary work such as report assembly. It omits
 * Supervision's declared-call check, which only the facade's own handle uses.
 * @alpha
 */
export interface IWorkspaceRun extends Omit<IRun, 'assertDeclaredCall'> {
  /**
   * The deeply frozen data of one exact completed result in this workspace.
   * It is an exact-reference read: it records no acceptance, observation or
   * dependency, and a missing or wrong-store reference fails rather than
   * retargeting. It fails with `run-closed` once the run has actually closed.
   */
  read<T>(reference: ICompletedResultReference): T;
}

/**
 * One durable History store opened for supervised runs.
 * @alpha
 */
export interface IWorkspace {
  /** The logical store identity the file holds. */
  readonly logicalStore: string;
  /**
   * Run `body` as one supervised run over `options.composition`. One run at a
   * time holds the store's writer: while another run of this or any process
   * holds it, this run's normal requests fail with `writer-unavailable`, while
   * `check` and `recover` still work. The run stays live, with its context,
   * exact reads and writer, until the body and every operation started
   * through the run have settled, even when the body stopped awaiting them
   * early (for example a `Promise.all` whose sibling failed); the body's own
   * value or failure is what the run reports. After that actual closure, run
   * operations, context lookups and admission decisions are rejected or denied.
   */
  run<TInputs extends object, THelpers extends object, T>(
    options: IWorkspaceRunOptions<TInputs, THelpers>,
    body: (run: IWorkspaceRun) => T | Promise<T>,
  ): Promise<IRunResult<Awaited<T>>>;
  /** Close the store file; later runs fail. Close only after every run has settled: closing under a live run fails its later requests. */
  close(): void;
}

/** The default writer lease duration: long enough for one normal request, renewed on the next. */
const defaultLeaseMilliseconds = 30_000;

/** Node's timer, which arms stop deadlines and waits for a time. */
const timer = createNodeTimer();

/**
 * The facade's one Run Supervision, over the Node Machine's asynchronous
 * context and timer supplied structurally. `currentRun()`,
 * `currentExecution()` and every workspace run share it, so author code finds
 * whichever run is live in its asynchronous execution.
 */
const supervision = createSupervision({ context: machine, timer });

/** Deeply freeze decoded result data so a read can never be mutated into looking current. */
function deepFreeze<T>(value: T): T {
  if (typeof value === 'object' && value !== null && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const key of Reflect.ownKeys(value)) {
      deepFreeze(Reflect.get(value, key));
    }
  }
  return value;
}

/**
 * History's single-writer lease as one run's writer port: acquired on the
 * run's first normal request, renewed on each later one, released once when
 * the run closes. A lease that expired between requests is not renewable; it
 * is dropped and a fresh lease with a new fence is acquired, so History's
 * fencing (not this port) still rejects anything the stale lease might have
 * written. Another unexpired holder makes normal requests fail with
 * `writer-unavailable`; it never blocks check-only or recovery requests.
 */
function writerFor(history: IDurableHistory, holder: string, leaseMilliseconds: number): IRunWriter {
  let held: IWriterLease | undefined;
  return Object.freeze({
    lease(): IWriterLease {
      if (held !== undefined) {
        try {
          held = history.renewWriter(held, leaseMilliseconds);
          return held;
        } catch (error: unknown) {
          if (!(error instanceof StaleWriterError)) {
            throw error;
          }
          held = undefined;
        }
      }
      const acquisition = history.acquireWriter({ holder, leaseMilliseconds });
      if (acquisition.kind !== 'acquired') {
        throw new SupervisionErrorClass('writer-unavailable', `History's writer lease is held by ${acquisition.holder} until ${String(acquisition.expiresAt)}`);
      }
      held = acquisition.lease;
      return held;
    },
    release(): void {
      if (held !== undefined) {
        const lease = held;
        held = undefined;
        try {
          history.releaseWriter(lease);
        } catch (error: unknown) {
          // An expired lease is no longer held by anyone on this run's behalf; there is nothing to release.
          if (!(error instanceof StaleWriterError)) {
            throw error;
          }
        }
      }
    },
  });
}

/**
 * Open a workspace over one durable History store file.
 * @param options - Store location, logical identity and writer lease duration.
 * @returns The workspace.
 * @alpha
 */
export function openWorkspace(options: IWorkspaceOptions): IWorkspace {
  const leaseMilliseconds = options.leaseMilliseconds ?? defaultLeaseMilliseconds;
  if (!Number.isSafeInteger(leaseMilliseconds) || leaseMilliseconds <= 0) {
    throw new SupervisionErrorClass('invalid-request', 'A workspace writer lease must be a positive safe integer of milliseconds');
  }
  const history = openDurableHistory({
    sqlite: createNodeSqlite(),
    clock: createNodeClock(),
    sha256: machine,
    location: options.location,
    logicalStore: options.logicalStore,
  });
  let open = true;
  /** Process-local counter distinguishing this workspace's runs. */
  let runCounter = 0;

  return Object.freeze({
    logicalStore: history.logicalStore,
    run<TInputs extends object, THelpers extends object, T>(
      runOptions: IWorkspaceRunOptions<TInputs, THelpers>,
      body: (run: IWorkspaceRun) => T | Promise<T>,
    ): Promise<IRunResult<Awaited<T>>> {
      if (!open) {
        return Promise.reject(new SupervisionErrorClass('invalid-request', 'This workspace has been closed'));
      }
      const { authoring, composition } = runOptions;
      runCounter += 1;
      // A volatile identity for this run, used for its writer holder and context; never reuse evidence.
      const runId = runOptions.runId ?? `run:${String(runCounter)}:${composition.scope}`;
      return supervision.run({
        analysis: composition.scope,
        environment: runOptions.environment,
        runId,
        ...(runOptions.admission === undefined ? {} : { admission: runOptions.admission }),
        ...(runOptions.observers === undefined ? {} : { observers: runOptions.observers }),
        ...(runOptions.stop === undefined ? {} : { stop: runOptions.stop }),
        ...(runOptions.permits === undefined ? {} : { permits: runOptions.permits }),
        ...(runOptions.window === undefined ? {} : { window: runOptions.window }),
        // The holder names this run for diagnostics; History's fence, not the name, orders writers.
        writer: writerFor(history, `microdelta-run:${runId}`, leaseMilliseconds),
        resolution: (ports) => createResolution({
          declarations: authoring,
          composition,
          bindings: { inputs: composition.topology.inputs, helpers: composition.topology.helpers },
          environment: runOptions.environment,
          history,
          tracking: createTrackingObserver(machine),
          host: machine,
          admission: ports.admission,
          observer: ports.observer,
          execution: ports.execution,
        }),
      }, (live) => {
        const run: IWorkspaceRun = Object.freeze({
          context: live.context,
          get open(): boolean {
            return live.open;
          },
          resolve: live.resolve,
          resolveMembers: live.resolveMembers,
          resolveFold: live.resolveFold,
          resolveOutcomeFold: live.resolveOutcomeFold,
          check: live.check,
          recover: live.recover,
          ordinary: live.ordinary,
          // The workspace supplies no operation ports yet, so these fail with `invalid-request`.
          inspectOperations: live.inspectOperations,
          settleOperation: live.settleOperation,
          read<TData>(reference: ICompletedResultReference): TData {
            // An exact read is a result read, so it obeys the run's undeclared-call rule (CMP-9).
            live.assertDeclaredCall('read');
            // Reads belong to their own run, for exactly Supervision's lifetime of it.
            if (!live.open) {
              throw new SupervisionErrorClass('run-closed', `Run ${live.context.runId} has closed and accepts no new work`);
            }
            // The exact-reference reader validates store and scope and never retargets; the static type is the caller's claim about its own result.
            return deepFreeze(history.reader.readSubtree(reference, [])) as TData;
          },
        });
        return body(run);
      });
    },
    close(): void {
      if (open) {
        open = false;
        history.close();
      }
    },
  });
}

/**
 * The live run's context in the current asynchronous execution, for author
 * and helper code that needs the selected environment without a parameter.
 * Fails outside a live run, from a callback that escaped a closed run, and
 * while a composition is being constructed.
 * @returns The live run's context.
 * @alpha
 */
export function currentRun(): IRunContext {
  return supervision.current();
}

/**
 * The live run's execution controls in the current asynchronous execution:
 * its stop intent and abort signal, permit-guarded sends and stop-aware
 * waits, attributed to the admitted step whose body is running there. Fails
 * as {@link currentRun} does.
 * @returns The live run's execution controls.
 * @alpha
 */
export function currentExecution(): IRunExecution {
  return supervision.execution();
}

/**
 * Create an operator stop controller whose deadlines are armed on Node's
 * timer. Give it to one or more runs; a first interrupt typically requests a
 * soft stop (optionally with a deadline) and a second a hard stop.
 * @returns A controller with nothing stopped.
 * @alpha
 */
export function createStopController(): IStopController {
  return createSupervisionStopController({ timer });
}
