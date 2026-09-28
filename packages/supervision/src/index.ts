/**
 * Run Supervision: the scoped run lifetime and selected environment, admission
 * of work that Reuse Resolution could not avoid, and the fixed lifecycle
 * positions observers see (ARC-001, DOM-2, RUN-001, REUSE-009, basic A-19).
 * Every export is a project-private `@alpha` contract; spellings are not a
 * public API.
 *
 * Supervision composes Resolution through its ports; it never decides reuse,
 * touches History, imports a host or threads a context argument through
 * author helpers. Retry, cancellation, scheduling and fanout breadth remain
 * later work.
 * @packageDocumentation
 */
export { SupervisionError, type ISupervisionErrorCode } from './errors.js';
export type {
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
  ISupervision,
  ISupervisionOptions,
} from './contracts.js';
export { ordinaryLifecycle, stepLifecycle, type IStepLifecycle } from './lifecycle.js';
export { createSupervision } from './supervision.js';
