/**
 * Run Supervision: the scoped run lifetime and selected environment, admission
 * of work that Reuse Resolution could not avoid, the fixed lifecycle
 * positions observers see, each template member's, strict fold's and outcome fold's typed
 * outcome in a run, the run's permit pool and bounded fan-out window, and
 * operator stop intent: soft and hard stops, deadline escalation, the abort
 * signal bodies receive and the publication-commit rule, and a normal
 * request's wait for storage's writer lease until the operator's deadline,
 * with its typed writer-busy outcome (ARC-001, DOM-2,
 * RUN-001, RUN-002, RUN-005, RUN-010, RUN-014, RUN-015, REUSE-009, A-13,
 * A-18, A-19). Every export is a project-private `@alpha` contract;
 * spellings are not a public API.
 *
 * Supervision composes Resolution through its ports; it never decides reuse,
 * touches History, imports a host or threads a context argument through
 * author helpers. External operations (RUN-011/012/013) persist through
 * structural ports that History's operation journal and Accounting's durable
 * adapter satisfy: intent before send, retry and durable deferral, no blind
 * replay, operator settlement and privacy-restricted events. Promotions
 * between environments are recorded under the writer lease through a
 * structural promotion port that History's durable store satisfies.
 * @packageDocumentation
 */
export {
  createStopController,
  type IAbortSignal,
  type IRunTimer,
  type IStopCause,
  type IStopController,
  type IStopControllerOptions,
  type IStopLevel,
  type IStopRequest,
  type IStopState,
} from './control.js';
export { SupervisionError, WriterBusyError, type ISupervisionErrorCode, type IWriterBusyObservation } from './errors.js';
export type {
  IDiscoveryReport,
  IFoldReport,
  IMemberOutcome,
  IMembersReport,
  IMembersTarget,
  IOrdinaryPhase,
  IOutcomeFoldReport,
  IOutcomeFoldRunOutcome,
  IRemoteState,
  IRequestOptions,
  IResolutionPorts,
  IRun,
  IRunContext,
  IRunEvent,
  IRunExecution,
  IRunLease,
  IRunObserver,
  IRunOperationName,
  IRunOptions,
  IRunResult,
  IRunScope,
  IRunScopeCapability,
  IRunWriter,
  IWriterAttempt,
  IWriterWaitOptions,
  ISendInterruption,
  ISendPhase,
  ISendRequest,
  IStrictFoldOutcome,
  ISupervision,
  ISupervisionOptions,
} from './contracts.js';
export { ordinaryLifecycle, stepLifecycle, type IStepLifecycle } from './lifecycle.js';
export {
  blocksCollection,
  blocksFormat,
  operationFormat,
  operationJournalDeclaration,
  operationsCollection,
  type IAttemptUsage,
  type IDeferralMode,
  type IJournalEntry,
  type IJournalLocation,
  type IJournalRecordValue,
  type IJournalWriteRequest,
  type IOperationAccounting,
  type IOperationAttribution,
  type IOperationBlock,
  type IOperationEvent,
  type IOperationJournalPort,
  type IOperationPhase,
  type IOperationQuantity,
  type IOperationReason,
  type IOperationRemoteState,
  type IOperationRequest,
  type IOperationResponse,
  type IOperationRetryPolicy,
  type IOperationSend,
  type IOperationSettlement,
  type IOperationSettlementRecord,
  type IOperationStatus,
  type IOperationSubject,
  type IOperationUsage,
  type IOperationView,
  type IRequestAttemptStatus,
  type IRequestAttemptView,
  type IRunOperationPorts,
  type IRunRandom,
  type IWaitEvent,
} from './operations.js';
export type {
  IPromotionEvent,
  IPromotionEvidence,
  IPromotionRecord,
  IPromotionRequest,
  IPromotionScope,
  IRunPromotionPort,
  IRunResultReference,
} from './promotion.js';
export { createSupervision } from './supervision.js';
