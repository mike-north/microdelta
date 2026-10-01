/**
 * The workspace alpha run path: the facade's assembly of the owner
 * implementations into the actual authoring path. A workspace is one durable
 * History store opened over Node's SQLite and clock capabilities; each run is
 * supervised by Run Supervision, whose Resolution resolves steps against that
 * store with Tracking evidence and Materialization views. The facade composes
 * owners only: it adds no policy, no cache and no seventh authority. Every
 * export is a facade-local `@alpha` declaration; spellings are not a public API.
 *
 * The operational surface (M5) is assembled here too. When the caller supplies
 * a Resource Accounting port, every run receives Supervision's operation
 * ports: History's operation journal and the host's random source, which the
 * facade builds, and the caller's Accounting port. Accounting is injected
 * through Supervision's structural port (plus a summary accessor) so that the
 * published facade takes no runtime or type dependency on the Accounting
 * package. Runs also offer recorded promotion between environments, under the
 * writer lease Supervision obtains, and the run environment's usage summary.
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
import { openDurableHistory } from '@microdelta/history';
import type {
  ICompletedResultReference as IHistoryReference,
  IPromotionRecord as IHistoryPromotionRecord,
  IVersionedRecord as IHistoryVersionedRecord,
} from '@microdelta/history';
import { canonicalNodeLocation, createNodeClock, createNodeSqlite, createNodeTimer } from '@microdelta/machine-node';
import { ResolutionError as ResolutionErrorClass, createResolution } from '@microdelta/resolution';
import {
  SupervisionError as SupervisionErrorClass,
  WriterBusyError as WriterBusyErrorClass,
  createStopController as createSupervisionStopController,
  createSupervision,
  operationJournalDeclaration,
  ordinaryLifecycle as supervisionOrdinaryLifecycle,
  stepLifecycle as supervisionStepLifecycle,
} from '@microdelta/supervision';
import type {
  IAbortSignal as ISupervisionAbortSignal,
  IAttemptUsage as ISupervisionAttemptUsage,
  IDeferralMode as ISupervisionDeferralMode,
  IOperationAccounting,
  IOperationAttribution as ISupervisionOperationAttribution,
  IOperationBlock as ISupervisionOperationBlock,
  IOperationEvent as ISupervisionOperationEvent,
  IOperationPhase as ISupervisionOperationPhase,
  IOperationQuantity as ISupervisionOperationQuantity,
  IOperationReason as ISupervisionOperationReason,
  IOperationRemoteState as ISupervisionOperationRemoteState,
  IOperationRequest as ISupervisionOperationRequest,
  IOperationResponse as ISupervisionOperationResponse,
  IOperationRetryPolicy as ISupervisionOperationRetryPolicy,
  IOperationSend as ISupervisionOperationSend,
  IOperationSettlement as ISupervisionOperationSettlement,
  IOperationSettlementRecord as ISupervisionOperationSettlementRecord,
  IOperationStatus as ISupervisionOperationStatus,
  IOperationSubject as ISupervisionOperationSubject,
  IOperationUsage as ISupervisionOperationUsage,
  IOperationView as ISupervisionOperationView,
  IRequestAttemptStatus as ISupervisionRequestAttemptStatus,
  IRequestAttemptView as ISupervisionRequestAttemptView,
  IRunOperationPorts,
  IWaitEvent as ISupervisionWaitEvent,
  IRemoteState as ISupervisionRemoteState,
  IRunExecution as ISupervisionRunExecution,
  ISendInterruption as ISupervisionSendInterruption,
  ISendPhase as ISupervisionSendPhase,
  ISendRequest as ISupervisionSendRequest,
  IStopCause as ISupervisionStopCause,
  IStopController as ISupervisionStopController,
  IStopLevel as ISupervisionStopLevel,
  IStopRequest as ISupervisionStopRequest,
  IStopState as ISupervisionStopState,
  IWriterWaitOptions as ISupervisionWriterWaitOptions,
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
import { machine, random } from './host.js';
import { writerFor } from './writer.js';

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

/**
 * How a run's normal request waits when another process holds the store's
 * writer lease: the operator's deadline (there is none by default) and the
 * poll interval (one second by default).
 * @alpha
 */
export type IWriterWaitOptions = ISupervisionWriterWaitOptions;

/**
 * The live run's execution controls: stop intent, abort signal, permit-guarded
 * sends, stop-aware waits, and `operation`, the handle through which author
 * code makes one declared external operation (see {@link IOperationRequest}).
 * @alpha
 */
export type IRunExecution = ISupervisionRunExecution;

/**
 * One external operation an author asks the live run to perform through
 * `currentExecution().operation(request)`: an identifier name, a binding
 * digest of the request (never its value), its safety declarations and retry
 * policy, and `perform`, which sends one request attempt. A stable operation
 * identity is persisted before every send, and usage is counted once
 * (RUN-012, ACC-007). It is available only in workspaces given an Accounting
 * port.
 * @alpha
 */
export type IOperationRequest<T> = ISupervisionOperationRequest<T>;

/** What one request attempt's send receives: the operation and attempt identities, the idempotency key when declared, and the abort signal. @alpha */
export type IOperationSend = ISupervisionOperationSend;

/** How one request attempt answered: succeeded, failed, rate-limited (optionally with a retry time) or unknown, each with any usage report. @alpha */
export type IOperationResponse<T> = ISupervisionOperationResponse<T>;

/** One usage report of a request attempt: the provider's report identity and its quantities. @alpha */
export type IOperationUsage = ISupervisionOperationUsage;

/** One reported usage quantity; its unit is an identifier. @alpha */
export type IOperationQuantity = ISupervisionOperationQuantity;

/** An author's retry policy for one operation: transient attempts, backoff and the rate-limit retry cap. @alpha */
export type IOperationRetryPolicy = ISupervisionOperationRetryPolicy;

/** The status of one external operation as the journal records it. @alpha */
export type IOperationStatus = ISupervisionOperationStatus;

/** The status of one request attempt of an external operation. @alpha */
export type IRequestAttemptStatus = ISupervisionRequestAttemptStatus;

/** Whether a request attempt's usage was acknowledged, left unrecorded, or none was reported. @alpha */
export type IAttemptUsage = ISupervisionAttemptUsage;

/** What is known about an aborted request attempt's remote work: cancelled, running or unknown. @alpha */
export type IOperationRemoteState = ISupervisionOperationRemoteState;

/** The History subject of the step attempt that made an operation. @alpha */
export type IOperationSubject = ISupervisionOperationSubject;

/** One request attempt as an operator inspects it, with the run, step attempt and usage it is attributed to. @alpha */
export type IRequestAttemptView = ISupervisionRequestAttemptView;

/** The operator's recorded settlement of an unknown operation. @alpha */
export type IOperationSettlementRecord = ISupervisionOperationSettlementRecord;

/** One external operation as an operator inspects it: identities, status, attempts and settlement, never values. @alpha */
export type IOperationView = ISupervisionOperationView;

/** An operator's settlement of an unknown operation: resolve it with the learned outcome (and any usage), or abandon it. @alpha */
export type IOperationSettlement = ISupervisionOperationSettlement;

/** What holds a pending member back: a deferral not yet due, or an unknown outcome awaiting the operator. @alpha */
export type IOperationBlock = ISupervisionOperationBlock;

/** One correlated, privacy-restricted operation event, as run observers see it. @alpha */
export type IOperationEvent = ISupervisionOperationEvent;

/** The closed phases of operation events. @alpha */
export type IOperationPhase = ISupervisionOperationPhase;

/** The closed reason codes of operation events. @alpha */
export type IOperationReason = ISupervisionOperationReason;

/** A run's wait for deferred work: sleeping, exiting, resumed or stopped, with the time it waits until. @alpha */
export type IWaitEvent = ISupervisionWaitEvent;

/**
 * How a normal request treats deferred work once only deferred work remains:
 * `sleep` (the default) waits until the earliest time and resumes; `exit`
 * returns and reports that time as the run result's `waitingUntil`.
 * @alpha
 */
export type IDeferralMode = ISupervisionDeferralMode;

/** The run, member and step attempt a usage observation is attributed to. @alpha */
export type IOperationAttribution = ISupervisionOperationAttribution;

/**
 * Narrows a usage summary within the run's environment: to one member,
 * operation, run or step attempt. The environment is always the run's own.
 * @alpha
 */
export interface IUsageFilter {
  readonly member?: string;
  readonly operation?: string;
  readonly run?: string;
  readonly stepAttempt?: string;
}

/** One usage summary query of the Accounting port: an environment and an optional narrowing. @alpha */
export interface IUsageQuery extends IUsageFilter {
  /** The environment whose usage is summarized; summaries never mix environments. */
  readonly environment: string;
}

/** One request attempt whose usage is unknown: its intent was recorded, but no report was acknowledged. Unknown is never zero. @alpha */
export interface IUnknownUsage {
  readonly operation: string;
  readonly requestAttempt: string;
  readonly attribution: IOperationAttribution;
}

/**
 * Resource Accounting's summary of one environment, as the facade reads it
 * structurally: observed quantities summed by unit with every report counted
 * once, kept apart from the request attempts whose usage is unknown, and the
 * counts behind them. `complete` holds exactly when nothing is unknown; an
 * observed total is never a bill (ACC-003, ACC-005).
 * @alpha
 */
export interface IUsageSummary {
  readonly environment: string;
  readonly status: 'complete' | 'incomplete';
  readonly observed: readonly IOperationQuantity[];
  readonly unknown: readonly IUnknownUsage[];
  /** How many operations recorded usage intent. */
  readonly operations: number;
  /** How many usage reports were acknowledged. */
  readonly reports: number;
  /** How many request attempts recorded usage intent. */
  readonly requestAttempts: number;
}

/**
 * The caller-supplied Resource Accounting port of a workspace: Supervision's
 * structural accounting port, through which runs record usage intent before
 * each send and acknowledge usage reports, plus the summary accessor the
 * facade surfaces through {@link IWorkspaceRun.usage}. Accounting's durable
 * adapter satisfies it. The caller opens and closes it; the workspace never
 * does.
 * @alpha
 */
export interface IWorkspaceAccounting extends IOperationAccounting {
  /** Summarize one environment's usage. */
  summarizeUsage(query: IUsageQuery): IUsageSummary;
}

/** The versioned evidence a promotion records: why the operator promoted, in the caller's own format. @alpha */
export type IPromotionEvidence = IHistoryVersionedRecord;

/**
 * One recorded promotion: exact results of other environments admitted into
 * a target environment of the same analysis, with its evidence and the
 * writer fence it was recorded under. Promoted results keep their original
 * provenance.
 * @alpha
 */
export type IPromotionRecord = IHistoryPromotionRecord;

/**
 * An operator's request to promote exact results of the run's analysis into
 * another environment (RUN-017 owner decision): trial work satisfies
 * production only through such an explicit, recorded promotion.
 * @alpha
 */
export interface IPromotionRequest {
  /** The environment the results are promoted into; never the environment they were published in. */
  readonly into: string;
  /** The exact completed results promoted, each named once. */
  readonly references: readonly ICompletedResultReference[];
  /** Why the operator promoted them. */
  readonly evidence: IPromotionEvidence;
}

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
 * The typed writer-busy outcome: a normal request waited for the store's
 * writer lease until the operator's deadline passed. It names the holder its
 * final attempt observed, with that holder's expiry, or reports that storage
 * stayed too busy to decide (`contended`) with the writer recorded then.
 * @alpha
 */
export const WriterBusyError: typeof WriterBusyErrorClass = WriterBusyErrorClass;
/** The instance type of the `WriterBusyError` class. @alpha */
export type WriterBusyError = WriterBusyErrorClass;

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
  /**
   * The caller's Resource Accounting port. With it, every run of the
   * workspace offers external operations (`currentExecution().operation`),
   * operator inspection and settlement, and usage summaries; the workspace
   * builds History's operation journal and the host's random source itself.
   * Without it, those fail with `invalid-request`.
   */
  readonly accounting?: IWorkspaceAccounting;
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
  /**
   * Optional volatile run identifier. When absent, the facade mints
   * `run:<32 hex digits>` from 128 random host bits, unique per run across
   * processes and hosts. A caller that supplies one must keep it unique per
   * run: retries and usage are correlated by run identity.
   */
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
  /**
   * How a normal request waits while another run, in this or another
   * process, holds the store's writer lease. Without a deadline it waits until
   * it holds the lease or a stop ends the wait; at the deadline it fails with
   * `WriterBusyError`. Check-only and recovery requests never wait.
   */
  readonly writerWait?: IWriterWaitOptions;
  /**
   * What a normal request does once only deferred work remains: sleep until
   * the earliest "not before" time and resume (the default), or exit and
   * report that time as the result's `waitingUntil`.
   */
  readonly deferral?: IDeferralMode;
}

/**
 * A live workspace run: Supervision's run operations plus an exact read of a
 * completed result's data for ordinary work such as report assembly, recorded
 * promotion, and its environment's usage summary. It omits Supervision's
 * declared-call check and its operator work under the writer lease, which only
 * the facade's own handle uses: the lease is never handed to callers.
 * @alpha
 */
export interface IWorkspaceRun extends Omit<IRun, 'assertDeclaredCall' | 'withWriterLease'> {
  /**
   * The deeply frozen data of one exact completed result in this workspace.
   * It is an exact-reference read: it records no acceptance, observation or
   * dependency, and a missing or wrong-store reference fails rather than
   * retargeting. It fails with `run-closed` once the run has actually closed.
   */
  read<T>(reference: ICompletedResultReference): T;
  /**
   * Promote exact results of this run's analysis into `request.into`, recorded
   * by History under the store's writer lease, which the run obtains as a
   * normal request does (waiting under `writerWait`, failing with
   * `WriterBusyError` at the operator's deadline). Afterwards those results
   * are candidates there, with their original provenance; nothing else
   * changes. History refuses a reference of another analysis or one
   * published in the target environment. Like every run operation it is
   * refused as an undeclared call inside member or step work.
   */
  promote(request: IPromotionRequest): Promise<IPromotionRecord>;
  /** The promotions recorded into this run's environment, in order. Read-only; it needs no writer lease. */
  promotions(): readonly IPromotionRecord[];
  /**
   * Resource Accounting's usage summary of this run's environment, optionally
   * narrowed, read through the workspace's Accounting port. Read-only.
   * Fails with `invalid-request` when the workspace has no Accounting port,
   * and with `run-closed` once the run has closed.
   */
  usage(filter?: IUsageFilter): IUsageSummary;
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
   * holds it, this run's normal requests wait for it under
   * `options.writerWait`, taking it over through History's fencing once the
   * holder releases it or its lease expires, and fail with
   * `WriterBusyError` naming the holder if the operator's deadline
   * passes first. `check` and `recover` never wait. A run cannot start from
   * inside an open run over the same store file, including that run's
   * ordinary work and author code, whichever workspace object opened the file
   * and however its location was spelled, and also when runs over other
   * stores stand between them: it would wait for the lease its own caller
   * holds, so it is refused at once with `invalid-request`. A run over another
   * store, or one started after the outer run closed, is unaffected. The run stays live, with its context,
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

/** Node's timer, which arms stop deadlines, waits for a time and paces waits for the writer lease. */
const timer = createNodeTimer();

/**
 * The facade's one Run Supervision, over the Node Machine's asynchronous
 * context and timer supplied structurally. `currentRun()`,
 * `currentExecution()` and every workspace run share it, so author code finds
 * whichever run is live in its asynchronous execution.
 */
const supervision = createSupervision({ context: machine, timer });

/** Where one live workspace run stands: the store it writes and the run it was started inside, if any. */
interface ILiveRun {
  /** The canonical location of the store file the run's workspace opened. */
  readonly store: string;
  /** The live run whose asynchronous context started this one, of any workspace. */
  readonly parent: IRunContext | undefined;
}

/**
 * Every workspace run in this process whose body has started and that has
 * not yet settled, across all workspace objects, since they share the one
 * Supervision above. Runs are keyed by their context, the object
 * `currentRun()` returns, and record their store and their enclosing run, so
 * a nested run is recognized by its store however many workspace objects, and
 * runs over other stores, stand between them. An entry is removed when its run
 * settles; a closed run is never found anyway, because lookups inside it fail
 * with `run-closed`, so removal only keeps this registry from growing with
 * every run a process ever started.
 */
const liveRuns = new Map<IRunContext, ILiveRun>();

/** The live run of the current asynchronous execution, of any workspace, or undefined outside one. */
function currentLiveRun(): IRunContext | undefined {
  try {
    return supervision.current();
  } catch (error: unknown) {
    // Outside any live run, inside a closed one, or while composing: no run encloses the caller.
    if (error instanceof SupervisionErrorClass) {
      return undefined;
    }
    throw error;
  }
}

/**
 * The open run over `store` that encloses `context`, directly or through
 * runs over other stores, if any. A run started there would wait for the
 * writer lease its own caller holds, and with no default deadline it would
 * wait forever.
 */
function enclosingRunOver(store: string, context: IRunContext | undefined): IRunContext | undefined {
  for (let current = context; current !== undefined; current = liveRuns.get(current)?.parent) {
    if (liveRuns.get(current)?.store === store) {
      return current;
    }
  }
  return undefined;
}

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
  /**
   * The store's file identity, however the caller spelled its location:
   * workspace objects over one file share one writer lease, so they share one
   * key for nested-run refusal. The file exists once History has opened it.
   */
  const store = canonicalNodeLocation(options.location);
  const accounting = options.accounting;
  if (accounting !== undefined && (typeof accounting !== 'object' || accounting === null || typeof Reflect.get(accounting, 'summarizeUsage') !== 'function')) {
    history.close();
    throw new SupervisionErrorClass('invalid-request', 'A workspace Accounting port needs Supervision\'s accounting port and a usage summary accessor');
  }
  /**
   * Supervision's operation ports, when the caller supplied Accounting: the
   * workspace's History operation journal, the caller's Accounting port, and
   * the host's random source for operation identities. Shared by every run.
   */
  const operations: IRunOperationPorts | undefined = accounting === undefined
    ? undefined
    : Object.freeze({ journal: history.openJournal(operationJournalDeclaration), accounting, random });
  let open = true;

  return Object.freeze({
    logicalStore: history.logicalStore,
    run<TInputs extends object, THelpers extends object, T>(
      runOptions: IWorkspaceRunOptions<TInputs, THelpers>,
      body: (run: IWorkspaceRun) => T | Promise<T>,
    ): Promise<IRunResult<Awaited<T>>> {
      if (!open) {
        return Promise.reject(new SupervisionErrorClass('invalid-request', 'This workspace has been closed'));
      }
      const parent = currentLiveRun();
      const enclosing = enclosingRunOver(store, parent);
      if (enclosing !== undefined) {
        return Promise.reject(new SupervisionErrorClass(
          'invalid-request',
          `A workspace run cannot start inside an open run over the same store (${enclosing.runId}): it would wait for the writer lease that run holds`,
        ));
      }
      const { authoring, composition } = runOptions;
      // A volatile identity for this run, used for its writer holder, context and operation correlation; never
      // reuse evidence. Minted from 128 random host bits, so no two runs of any process or host share one.
      const runId = runOptions.runId ?? `run:${random.randomIdentifier()}`;
      /** This run's context once its body has started. */
      let started: IRunContext | undefined;
      const settled = supervision.run({
        analysis: composition.scope,
        environment: runOptions.environment,
        runId,
        ...(runOptions.admission === undefined ? {} : { admission: runOptions.admission }),
        ...(runOptions.observers === undefined ? {} : { observers: runOptions.observers }),
        ...(runOptions.stop === undefined ? {} : { stop: runOptions.stop }),
        ...(runOptions.permits === undefined ? {} : { permits: runOptions.permits }),
        ...(runOptions.window === undefined ? {} : { window: runOptions.window }),
        ...(runOptions.writerWait === undefined ? {} : { writerWait: runOptions.writerWait }),
        ...(runOptions.deferral === undefined ? {} : { deferral: runOptions.deferral }),
        ...(operations === undefined ? {} : { operations }),
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
        started = live.context;
        liveRuns.set(live.context, Object.freeze({ store, parent }));
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
          // Without the caller's Accounting port the run has no operation ports, so these fail with `invalid-request`.
          inspectOperations: live.inspectOperations,
          settleOperation: live.settleOperation,
          promote(request: IPromotionRequest): Promise<IPromotionRecord> {
            // History records the promotion under the lease Supervision obtained; the facade only composes the two.
            return live.withWriterLease((lease) => history.promoteResults(lease, {
              target: { analysis: live.context.analysis, environment: request.into },
              references: request.references,
              evidence: request.evidence,
            }));
          },
          promotions(): readonly IPromotionRecord[] {
            if (!live.open) {
              throw new SupervisionErrorClass('run-closed', `Run ${live.context.runId} has closed and accepts no new work`);
            }
            return history.readPromotions({ target: { analysis: live.context.analysis, environment: live.context.environment } });
          },
          usage(filter: IUsageFilter = {}): IUsageSummary {
            if (!live.open) {
              throw new SupervisionErrorClass('run-closed', `Run ${live.context.runId} has closed and accepts no new work`);
            }
            if (accounting === undefined) {
              throw new SupervisionErrorClass('invalid-request', 'Usage summaries need the workspace\'s Accounting port, which this workspace was not given');
            }
            // The run's own environment always wins: a summary never reads another environment's usage.
            return accounting.summarizeUsage({ ...filter, environment: live.context.environment });
          },
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
      // Forgetting a settled run only bounds the registry's memory: a closed run
      // can no longer enclose anything, since lookups inside it fail with run-closed.
      const forget = (): void => {
        if (started !== undefined) {
          liveRuns.delete(started);
        }
      };
      settled.then(forget, forget);
      return settled;
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
