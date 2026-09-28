/**
 * The microdelta entry. Its public surface preserves the scaffold's Store
 * factory, composing its required host capability at the application boundary.
 * Its project-private `@alpha` surface is the workspace authoring and run path:
 * authoring builders, durable workspaces supervised by Run Supervision, the
 * normal and recovery entry operations and runtime context lookup. Context
 * code may use owner contracts directly, never this assembly facade.
 * @packageDocumentation
 */
import { createMemoryStore as createHistoryMemoryStore } from '@microdelta/history';
import type { MemoryStoreOptions, Store } from '@microdelta/history';
import { createNodeMachine } from '@microdelta/machine-node';

/** The default facade's host is selected once by assembly and passed explicitly. */
const machine = createNodeMachine();

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
  type IAuthoring,
  type IAuthoringFamily,
  type IChildResult,
  type IComposition,
  type IDeclaredCallHandle,
  type IPreviousResult,
  type IResultView,
  type ISourceOutcome,
  type ISourceOutcomes,
  type IStepDescriptor,
  type ITrackedHelpers,
  type ITrackedView,
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
  type ICheckOutcome,
  type ICompletedResultReference,
  type ILifecycleEvent,
  type ILifecyclePhase,
  type IOrdinaryPhase,
  type IRecoveryResult,
  type IRequestOptions,
  type IResolutionErrorCode,
  type IResolutionOutcome,
  type IRunContext,
  type IRunEvent,
  type IRunObserver,
  type IRunResult,
  type ISupervisionErrorCode,
  type IWorkspace,
  type IWorkspaceOptions,
  type IWorkspaceRun,
  type IWorkspaceRunOptions,
} from './workspace.js';
