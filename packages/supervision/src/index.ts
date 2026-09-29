/**
 * Run Supervision: the scoped run lifetime and selected environment, admission
 * of work that Reuse Resolution could not avoid, the fixed lifecycle
 * positions observers see, and each template member's and strict fold's typed
 * outcome in a run (ARC-001, DOM-2, RUN-001, RUN-005, RUN-010, REUSE-009,
 * basic A-19). Every
 * export is a project-private `@alpha` contract; spellings are not a public
 * API.
 *
 * Supervision composes Resolution through its ports; it never decides reuse,
 * touches History, imports a host or threads a context argument through
 * author helpers. Retry, wait and cancellation mechanics and scheduling
 * remain later work; a cancellation is only an admission decision here.
 * @packageDocumentation
 */
export { SupervisionError, type ISupervisionErrorCode } from './errors.js';
export type {
  IDiscoveryReport,
  IFoldReport,
  IMemberOutcome,
  IMembersReport,
  IMembersTarget,
  IOrdinaryPhase,
  IRequestOptions,
  IResolutionPorts,
  IRun,
  IRunContext,
  IRunEvent,
  IRunLease,
  IRunObserver,
  IRunOptions,
  IRunResult,
  IRunScope,
  IRunScopeCapability,
  IRunWriter,
  IStrictFoldOutcome,
  ISupervision,
  ISupervisionOptions,
} from './contracts.js';
export { ordinaryLifecycle, stepLifecycle, type IStepLifecycle } from './lifecycle.js';
export { createSupervision } from './supervision.js';
