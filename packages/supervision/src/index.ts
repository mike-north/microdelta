/**
 * Run Supervision: the scoped run lifetime and selected environment, admission
 * of work that Reuse Resolution could not avoid, the fixed lifecycle
 * positions observers see, each template member's, strict fold's and outcome fold's typed
 * outcome in a run, the run's permit pool and bounded fan-out window, and
 * operator stop intent: soft and hard stops, deadline escalation, the abort
 * signal bodies receive and the publication-commit rule (ARC-001, DOM-2,
 * RUN-001, RUN-002, RUN-005, RUN-010, RUN-014, RUN-015, REUSE-009, A-13,
 * A-18, A-19). Every export is a project-private `@alpha` contract;
 * spellings are not a public API.
 *
 * Supervision composes Resolution through its ports; it never decides reuse,
 * touches History, imports a host or threads a context argument through
 * author helpers. External-operation identity, retry and deferral policy
 * build on its sends and waits and are not decided here.
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
export { SupervisionError, type ISupervisionErrorCode } from './errors.js';
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
  ISendInterruption,
  ISendPhase,
  ISendRequest,
  IStrictFoldOutcome,
  ISupervision,
  ISupervisionOptions,
} from './contracts.js';
export { ordinaryLifecycle, stepLifecycle, type IStepLifecycle } from './lifecycle.js';
export { createSupervision } from './supervision.js';
