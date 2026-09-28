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
  ICheckOutcome as IResolutionCheckOutcome,
  IAdmissionDecision as IResolutionAdmissionDecision,
  IAdmissionRequest as IResolutionAdmissionRequest,
  IExecutionAdmission,
  ILifecycleEvent as IResolutionLifecycleEvent,
  ILifecyclePhase as IResolutionLifecyclePhase,
  IRecoveryResult as IResolutionRecoveryResult,
  IResolutionErrorCode as IResolutionErrorCodeOf,
  IResolutionOutcome as IResolutionOutcomeOf,
} from '@microdelta/resolution';
import type { ICompletedResultReference as IHistoryReference } from '@microdelta/history';
import { ResolutionError as ResolutionErrorClass } from '@microdelta/resolution';
import {
  SupervisionError as SupervisionErrorClass,
  ordinaryLifecycle as supervisionOrdinaryLifecycle,
  stepLifecycle as supervisionStepLifecycle,
} from '@microdelta/supervision';
import type {
  IOrdinaryPhase as ISupervisionOrdinaryPhase,
  IRequestOptions as ISupervisionRequestOptions,
  IRun,
  IRunContext as ISupervisionRunContext,
  IRunEvent as ISupervisionRunEvent,
  IRunObserver as ISupervisionRunObserver,
  IRunResult as ISupervisionRunResult,
  ISupervisionErrorCode as ISupervisionErrorCodeOf,
} from '@microdelta/supervision';

import type { IAuthoring, IComposition } from './authoring.js';

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
   * Positive safe-integer writer lease duration in milliseconds, renewed on
   * every normal request of a run. Defaults to 30 seconds.
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
}

/**
 * A live workspace run: Supervision's run operations plus an exact read of a
 * completed result's data for ordinary work such as report assembly.
 * @alpha
 */
export interface IWorkspaceRun extends IRun {
  /**
   * The deeply frozen data of one exact completed result in this workspace.
   * It is an exact-reference read: it records no acceptance, observation or
   * dependency, and a missing or wrong-store reference fails rather than
   * retargeting.
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
  /** Run `body` as one supervised run over `options.composition`. */
  run<TInputs extends object, THelpers extends object, T>(
    options: IWorkspaceRunOptions<TInputs, THelpers>,
    body: (run: IWorkspaceRun) => T | Promise<T>,
  ): Promise<IRunResult<Awaited<T>>>;
  /** Close the store file; later runs fail. */
  close(): void;
}

/**
 * Open a workspace over one durable History store file.
 * @param options - Store location, logical identity and writer lease duration.
 * @returns The workspace.
 * @alpha
 */
export function openWorkspace(options: IWorkspaceOptions): IWorkspace {
  void options;
  throw new Error('The workspace run path is not implemented yet');
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
  throw new Error('The workspace run path is not implemented yet');
}
