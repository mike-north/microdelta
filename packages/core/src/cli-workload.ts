/** Generic caller-owned workload handoff for the foreground start command. @packageDocumentation */
import type { IApplicationStatementSubmission } from './workspace.js';
import type { IWorkspace, IWorkspaceRun, IWorkspaceRunOptions } from './workspace.js';

/** Resources and composition choices prepared by the caller before one observed run. @alpha */
export interface ICliWorkloadPreparation<TInputs extends object, THelpers extends object, TResult> {
  /** The caller's existing workspace authority. */
  readonly workspace: IWorkspace;
  /** Run choices; command-owned stop and observation location are supplied at start. */
  readonly options: Omit<IWorkspaceRunOptions<TInputs, THelpers>, 'stop'> & { readonly stop?: never };
  /** The application body; its value is never serialized by the command. */
  readonly body: (run: IWorkspaceRun, application: IApplicationStatementSubmission) => TResult | Promise<TResult>;
  /** Release caller-created resources after the observed run has actually closed. */
  readonly dispose: () => void | Promise<void>;
}

/** A typed module export whose factory prepares caller resources without starting a run. @alpha */
export interface ICliWorkload<TInputs extends object, THelpers extends object, TResult> {
  /** Prepare the workload from a frozen copy of opaque application arguments. */
  readonly prepare: (applicationArguments: readonly string[]) => ICliWorkloadPreparation<TInputs, THelpers, TResult> | Promise<ICliWorkloadPreparation<TInputs, THelpers, TResult>>;
}

/** Runtime-erased boundary used after loading a trusted compiled caller module. */
interface ICliWorkloadDefinition {
  readonly prepare: (applicationArguments: readonly string[]) => unknown;
}

/**
 * Compatible facade copies recognize the same helper handoff. This semantic
 * marker is neither a sandbox boundary nor a promise of cross-version alpha
 * compatibility; the trusted factory and preparation must still satisfy this
 * installed command's contract.
 */
const workloadBrand = Symbol.for('microdelta.cli-workload');

/** Mark a factory for the CLI while preserving its input, helper, body-result and disposal contracts. @alpha */
export function defineCliWorkload<TInputs extends object, THelpers extends object, TResult>(
  factory: ICliWorkload<TInputs, THelpers, TResult>['prepare'],
): ICliWorkload<TInputs, THelpers, TResult> {
  return Object.freeze({ [workloadBrand]: true as const, prepare: factory });
}

/** Recognize the helper contract across compatible installations, retaining callable-factory validation. @internal */
export function isCliWorkload(value: unknown): value is ICliWorkloadDefinition {
  return typeof value === 'object' && value !== null && workloadBrand in value && value[workloadBrand] === true && 'prepare' in value && typeof value.prepare === 'function';
}

/** Validate only the handed-over resource shape; runtime type parameters remain caller-owned. @internal */
export function isCliWorkloadPreparation(value: unknown): value is ICliWorkloadPreparation<object, object, unknown> {
  return typeof value === 'object' && value !== null && 'workspace' in value && typeof value.workspace === 'object' && value.workspace !== null
    && 'startObserved' in value.workspace && typeof value.workspace.startObserved === 'function'
    && 'options' in value && typeof value.options === 'object' && value.options !== null
    && 'body' in value && typeof value.body === 'function'
    && 'dispose' in value && typeof value.dispose === 'function';
}
