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
import { StaleWriterError, openDurableHistory } from '@microdelta/history';
import type { ICompletedResultReference as IHistoryReference, IDurableHistory, IWriterLease } from '@microdelta/history';
import { createNodeClock, createNodeSqlite } from '@microdelta/machine-node';
import { ResolutionError as ResolutionErrorClass, createResolution } from '@microdelta/resolution';
import {
  SupervisionError as SupervisionErrorClass,
  createSupervision,
  ordinaryLifecycle as supervisionOrdinaryLifecycle,
  stepLifecycle as supervisionStepLifecycle,
} from '@microdelta/supervision';
import type { IRunWriter } from '@microdelta/supervision';
import { createTrackingObserver } from '@microdelta/tracking';
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

/** The default writer lease duration: long enough for one normal request, renewed on the next. */
const defaultLeaseMilliseconds = 30_000;

/**
 * The facade's one Run Supervision, over the Node Machine's asynchronous
 * context supplied structurally. `currentRun()` and every workspace run share
 * it, so author code finds whichever run is live in its asynchronous execution.
 */
const supervision = createSupervision({ context: machine });

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
        history.releaseWriter(lease);
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
      return supervision.run({
        analysis: composition.scope,
        environment: runOptions.environment,
        ...(runOptions.runId === undefined ? {} : { runId: runOptions.runId }),
        ...(runOptions.admission === undefined ? {} : { admission: runOptions.admission }),
        ...(runOptions.observers === undefined ? {} : { observers: runOptions.observers }),
        // The holder names this process's run for diagnostics; History's fence, not the name, orders writers.
        writer: writerFor(history, `microdelta-run:${composition.scope}`, leaseMilliseconds),
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
        }),
      }, async (live) => {
        /** Whether this run's body is still executing; reads belong to their own live run. */
        let active = true;
        const run: IWorkspaceRun = Object.freeze({
          context: live.context,
          resolve: live.resolve,
          check: live.check,
          recover: live.recover,
          ordinary: live.ordinary,
          read<TData>(reference: ICompletedResultReference): TData {
            if (!active) {
              throw new SupervisionErrorClass('run-closed', `Run ${live.context.runId} has closed and accepts no new work`);
            }
            // The exact-reference reader validates store and scope and never retargets; the static type is the caller's claim about its own result.
            return deepFreeze(history.reader.readSubtree(reference, [])) as TData;
          },
        });
        try {
          return await body(run);
        } finally {
          active = false;
        }
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
