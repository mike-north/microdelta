/**
 * Reuse Resolution: current candidate eligibility, current source policy,
 * direct-child and nested validation with consumed-output cutoff, keyed
 * template instances, strict fold readiness and verification, honest misses,
 * and execution through injected admission and History ports (ARC-001/006,
 * REUSE-001–009, RES-004/005/007, CMP-8, RUN-010). Every export is a
 * project-private `@alpha` contract; spellings are not a public API.
 *
 * Resolution never mutates History rows directly, never stores a finality
 * answer, and never replays a body as validation. Admission policy and run
 * lifetime belong to Run Supervision; storage consistency to History.
 * @packageDocumentation
 */
export { ResolutionError, type IResolutionErrorCode } from './errors.js';
export type {
  ICallView,
  IPreviousResult,
  IResolutionFamily,
  IResolutionOutcomes,
  IResolutionPrevious,
  IResolutionViews,
  IResultView,
  ISourceBindings,
  IStepBindings,
  ITrackedHelpers,
  IUntrackedRead,
} from './family.js';
export { sourceOutcome, type ISourceOutcome, type ISourceOutcomeBrand, type ISourceOutcomes } from './outcome.js';
export type {
  IAdmissionDecision,
  IAdmissionRequest,
  ICandidateMiss,
  ICheckOutcome,
  ICheckRequest,
  IDiscoveryOutcome,
  IExecutionAdmission,
  IFoldCoverage,
  IFoldOutcome,
  IFoldRequest,
  IFoldResolution,
  IGateEvidence,
  ILifecycleEvent,
  ILifecycleObserver,
  ILifecyclePhase,
  IMemberFailure,
  IMemberResolution,
  IMembersRequest,
  IMembersResolution,
  IOutcomeEvidence,
  IRecoverRequest,
  IRecoveryResult,
  IRefusalDisposition,
  IResolution,
  IResolutionHistory,
  IResolutionHost,
  IResolutionOptions,
  IResolutionOutcome,
  IResolveRequest,
  IReuseBasis,
  IStepKind,
} from './contracts.js';
export { createResolution } from './resolution.js';
