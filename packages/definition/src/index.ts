/**
 * Definition & Binding: frozen declarations, the fixed step graph, current
 * structural correspondence, declared child-call handles and the invocation
 * bridge that pairs a reconnected step's actual author callback with its
 * assembled context for Resolution's invoker. Function names remain
 * presentation and diagnostic labels only; they never establish Definition
 * identity or binding correspondence. This package does not store results,
 * decide reuse, select previous results, capture observations or execute
 * author callbacks itself.
 * @packageDocumentation
 */
export { DefinitionError, type IDefinitionErrorCode } from './errors.js';
export type { IBindingDescriptor, IBindingRole } from './descriptor.js';
export type { IApply, IBindingFamily, IPreviousCarrierFamily, ITypeFamily } from './family.js';
export {
  isDeclaration,
  type IAnyMemoDeclaration,
  type IAnySourceDeclaration,
  type IAuthorInvoker,
  type ICalls,
  type IChildDeclarations,
  type IDeclarationBrand,
  type IFinalityContext,
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
  type ITopology,
  type IWitnessResolution,
} from './composition.js';
export {
  describeHandle,
  type IChildResult,
  type IDeclaredCallBrand,
  type IDeclaredCallHandle,
  type IDeclaredInvocationRequest,
  type IDirectChildWitness,
  type IEmptyArguments,
  type IInvocation,
  type IInvocationPort,
  type IInvocationScope,
  type IMemoInvocation,
  type ISourceInvocation,
} from './invocation.js';

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
