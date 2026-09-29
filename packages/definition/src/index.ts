/**
 * Definition & Binding: frozen declarations, the fixed step graph (including
 * keyed fanout templates, their gates and strict folds), current structural
 * correspondence, member keying, supplied step slots, declared child-call handles
 * with their argument recipes and versioned invocation witnesses, and the
 * invocation bridge that pairs a reconnected step's actual author callback with
 * its assembled context for Resolution's invoker. Function names remain
 * presentation and diagnostic labels only; they never establish Definition
 * identity or binding correspondence. This package does not store results,
 * decide reuse or argument justification, select previous results, capture
 * observations or execute step bodies itself.
 * @packageDocumentation
 */
export { DefinitionError, type IDefinitionErrorCode } from './errors.js';
export type {
  ICollectionIdentity,
  ICollectionOptions,
  ICollectionResult,
  ICollectionStatus,
  IIdentityField,
  IKeyedMember,
  IKeyedSnapshot,
  IKeyingDiagnostic,
  IKeyingFailure,
  IMemberOf,
} from './collection.js';
export type { IBindingDescriptor, IBindingRole } from './descriptor.js';
export type { IApply, IBindingFamily, IPreviousCarrierFamily, ITypeFamily } from './family.js';
export {
  isDeclaration,
  type IAnyMemoDeclaration,
  type IAnySourceDeclaration,
  type IAuthorInvoker,
  type ICallOf,
  type ICalls,
  type IChildDeclaration,
  type IChildDeclarations,
  type IDeclarationBrand,
  type IFinalityContext,
  type IMemberBinding,
  type IMemoDeclaration,
  type IMemoOptions,
  type IMemoRunContext,
  type IPreviousSupplier,
  type IResultOf,
  type ISourceDeclaration,
  type ISourceOptions,
  type ISourceRunContext,
  type IStepDeclaration,
} from './declaration.js';
export { declarations, type IDeclarations } from './declarations.js';
export {
  gateOutcome,
  type IAnyTemplateDeclaration,
  type IGateContext,
  type IGateInvocation,
  type IGateOutcome,
  type IGateSettlement,
  type IKeyedCollectionCheck,
  type IMemberBuilder,
  type IMemberSubject,
  type IMemberSubjectBrand,
  type IMemberSupplier,
  type ITemplateBrand,
  type ITemplateDeclaration,
  type ITemplateMemoOptions,
  type ITemplateOptions,
  type ITemplateSourceOptions,
  type ITemplateStepDeclaration,
  type ITemplateSteps,
  type ITemplateTopology,
} from './template.js';
export type {
  IAnyFoldDeclaration,
  IFoldDeclaration,
  IFoldEntry,
  IFoldInvocation,
  IFoldMemberSupplier,
  IFoldOptions,
  IFoldOver,
  IFoldRunContext,
  IFoldTopology,
  ISkippedEntry,
  IStepsOf,
  ISucceededEntry,
} from './fold.js';

export {
  type IBindingResolution,
  type IBindingTarget,
  type ICallableTarget,
  type IComposition,
  type ICompositionBrand,
  type ICompositionOptions,
  type IDeclaredEdge,
  type IHelperRegistration,
  type IInputRegistration,
  type IInputTarget,
  type IMemberRegistration,
  type IScopedSubject,
  type IStepRegistration,
  type IStepTarget,
  type ISuppliedStepTarget,
  type ITopology,
  type IWitnessResolution,
  isComposing,
} from './composition.js';
export {
  describeHandle,
  type IChildResult,
  type IDeclaredCallBrand,
  type IDeclaredCallDescription,
  type IDeclaredCallHandle,
  type IDeclaredInvocationRequest,
  type IInvocation,
  type IInvocationPort,
  type IInvocationScope,
  type IMemoCallRequest,
  type IMemoInvocation,
  type ISourceCallRequest,
  type ISourceInvocation,
  type ISuppliedCallRequest,
  type ISuppliedInvocation,
} from './invocation.js';
export type {
  IArgumentPathSegment,
  IArgumentRecipe,
  IDerivedRecipe,
  IDirectChildWitness,
  IEmptyArguments,
  IForwardedRecipe,
  IForwardOrigin,
  IInvocationArguments,
  IInvocationWitness,
  INestedInvocationWitness,
  IUnreconstructibleReason,
  IUnreconstructibleRecipe,
  IUnsupportedWitnessReason,
} from './witness.js';
export {
  derivedArguments,
  type IAnyStepSlot,
  type IAnySuppliedStepDeclaration,
  type IArgumentSupplier,
  type IArgumentViews,
  type IDerivedArguments,
  type ISlotSubject,
  type IStepSlot,
  type IStepSlotBrand,
  type IStepSlotOptions,
  type ISuppliedStepDeclaration,
  type ISuppliedStepOptions,
  type ISuppliedStepRegistration,
  type ISuppliedStepRegistrationBrand,
  type ISuppliedStepRunContext,
  type ISupplyOptions,
} from './slot.js';
export type { IForward, IForwarded, IForwardedBrand, IHandleArgument, IHandleArguments, IPathInput } from './arguments.js';

/**
 * Exact synthetic names rejected when deriving a step's name (NM-1 and NM-2).
 * Explicit overrides are intentional author declarations and bypass this list.
 * The array is frozen so tooling and callers share an immutable vocabulary.
 * @alpha
 */
export const syntheticNames: readonly string[] = Object.freeze(['', 'anonymous', 'default']);

/**
 * Prefixes identifying synthetic function names, including names made by bind.
 * Kept separate from exact names so a declared name such as `boundary` survives.
 * @alpha
 */
export const syntheticNamePrefixes: readonly string[] = Object.freeze(['bound ']);

/**
 * Return an explicit name or the non-synthetic name already declared by the author.
 *
 * An override is present whenever it is not `undefined`, including an empty string.
 * A missing, malformed, or inaccessible function name reports absence; callers
 * decide whether that absence is fatal. This operation never invokes the function.
 * Function names can change under minification and never establish a durable
 * subject or current-binding identity. Callers use this result as a label only.
 *
 * @param fn - A function or class whose existing name should be inspected.
 * @param override - An author-supplied name that takes precedence over inference.
 * @returns The existing name, or `undefined` when no usable name is available.
 * @alpha
 */
export function nameOf(fn: Function, override?: string): string | undefined {
  if (override !== undefined) {
    return override;
  }

  // Callable proxies and configurable name accessors may throw even for a valid
  // Function. NM-1 assigns fatal-name decisions to callers, so report absence.
  try {
    const name: unknown = fn.name;
    if (typeof name !== 'string' || syntheticNames.includes(name)) {
      return undefined;
    }
    if (syntheticNamePrefixes.some((prefix: string): boolean => name.startsWith(prefix))) {
      return undefined;
    }
    return name;
  } catch {
    return undefined;
  }
}
