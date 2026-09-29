/**
 * The microdelta entry. Its public surface preserves the scaffold's Store
 * factory, composing its required host capability at the application boundary.
 * Its project-private `@alpha` surface is the workspace authoring and run path:
 * authoring builders (including keyed collections, gated fanout templates,
 * supplied step slots, forwarded arguments and strict folds), durable
 * workspaces supervised by Run Supervision, the normal, members, fold and
 * recovery entry operations with their typed reports, and runtime context
 * lookup. Context
 * code may use owner contracts directly, never this assembly facade.
 * @packageDocumentation
 */
import { createMemoryStore as createHistoryMemoryStore } from '@microdelta/history';
import type { MemoryStoreOptions, Store } from '@microdelta/history';

import { machine } from './host.js';

/**
 * Create the existing non-durable memory store with Node's detached snapshot
 * capability supplied by assembly.
 * @public
 */
export function createMemoryStore(options: MemoryStoreOptions = {}): Store {
  return createHistoryMemoryStore(machine, options);
}

export {
  DuplicateRowError,
  FingerprintAlgorithmMismatchError,
  InvalidStorePatchError,
  MissingRowError,
} from '@microdelta/history';
export type {
  Divergence,
  FieldRow,
  Fingerprint,
  GenerationPatch,
  GenerationRow,
  GenerationState,
  Identity,
  MemoryStoreOptions,
  Outcome,
  Path,
  RecordedRead,
  ResultKey,
  Store,
  StoreMetadata,
  Subject,
  SubjectPatch,
  SubjectRow,
} from '@microdelta/history';

export {
  authoring,
  sourceOutcome,
  type IAnyTemplateDeclaration,
  type IAuthoring,
  type IAuthoringFamily,
  type IChildResult,
  type ICollectionResult,
  type ICollectionStatus,
  type IComposition,
  type IDeclaredCallHandle,
  type IDerivedArguments,
  type IFoldDeclaration,
  type IFoldEntry,
  type IForward,
  type IForwarded,
  type IKeyedMember,
  type IKeyedSnapshot,
  type IKeyingDiagnostic,
  type IKeyingFailure,
  type IMemberBinding,
  type IMemberBuilder,
  type IPathInput,
  type IPreviousResult,
  type IResultView,
  type ISkippedEntry,
  type ISlotSubject,
  type ISourceOutcome,
  type ISourceOutcomes,
  type IStepDescriptor,
  type IStepSlot,
  type ISucceededEntry,
  type ISuppliedStepDeclaration,
  type ISuppliedStepRegistration,
  type ITrackedHelpers,
  type ITrackedView,
  type IUntrackedRead,
} from './authoring.js';
export {
  ResolutionError,
  SupervisionError,
  currentRun,
  openWorkspace,
  ordinaryLifecycle,
  stepLifecycle,
  type IAdmissionDecision,
  type IAdmissionPolicy,
  type IAdmissionRequest,
  type ICandidateMiss,
  type ICheckOutcome,
  type ICompletedResultReference,
  type IDiscoveryReport,
  type IFoldCoverage,
  type IFoldOutcome,
  type IFoldReport,
  type IGateEvidence,
  type ILifecycleEvent,
  type ILifecyclePhase,
  type IMemberOutcome,
  type IMembersReport,
  type IMembersTarget,
  type IOrdinaryPhase,
  type IRecoveryResult,
  type IRequestOptions,
  type IResolutionErrorCode,
  type IResolutionOutcome,
  type IRunContext,
  type IRunEvent,
  type IRunObserver,
  type IRunResult,
  type IStrictFoldOutcome,
  type ISupervisionErrorCode,
  type IWorkspace,
  type IWorkspaceOptions,
  type IWorkspaceRun,
  type IWorkspaceRunOptions,
} from './workspace.js';
