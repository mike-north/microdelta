/**
 * The facade's alpha authoring vocabulary. Authors declare sources, memos and
 * their fixed composition with Definition's builders bound to Reuse
 * Resolution's binding family, so callbacks receive tracked current inputs and
 * helpers, a source's eligible previous carrier and outcome constructors, and
 * a memo's declared child handles. Every type here is a facade-local `@alpha`
 * alias of its owner's contract, declared locally so the default public
 * declaration view never references a sibling's project-private surface.
 * Spellings are not a public API.
 */
import { declarations } from '@microdelta/definition';
import type {
  IBindingDescriptor,
  IChildResult as IDefinitionChildResult,
  IComposition as IDefinitionComposition,
  IDeclarations,
  IDeclaredCallHandle as IDefinitionDeclaredCallHandle,
} from '@microdelta/definition';
import { sourceOutcome as resolutionSourceOutcome } from '@microdelta/resolution';
import type {
  IPreviousResult as IResolutionPreviousResult,
  IResolutionFamily,
  IResultView as IResolutionResultView,
  ISourceOutcome as IResolutionSourceOutcome,
  ISourceOutcomes as IResolutionSourceOutcomes,
  ITrackedHelpers as IResolutionTrackedHelpers,
} from '@microdelta/resolution';
import type { ITrackedView as ITrackingView } from '@microdelta/tracking';

/**
 * The binding family of the workspace authoring path for an author's declared
 * input record and helper record.
 * @alpha
 */
export type IAuthoringFamily<TInputs extends object, THelpers extends object> = IResolutionFamily<TInputs, THelpers>;

/**
 * Builders bound to one analysis's declared inputs and helpers: `source`,
 * `memo`, `compose`, and the invocation bridge the workspace uses.
 * @alpha
 */
export type IAuthoring<TInputs extends object, THelpers extends object> = IDeclarations<IAuthoringFamily<TInputs, THelpers>>;

/**
 * A frozen composition minted by an {@link IAuthoring} instance.
 * @alpha
 */
export type IComposition<TInputs extends object, THelpers extends object> = IDefinitionComposition<IAuthoringFamily<TInputs, THelpers>>;

/**
 * A structural step address: analysis scope, role, slot and explicit member key.
 * @alpha
 */
export type IStepDescriptor = IBindingDescriptor;

/**
 * A current input or helper as author code receives it: a tracked view whose
 * consumed fields (or actual calls) become evidence.
 * @alpha
 */
export type ITrackedView<T> = ITrackingView<T>;

/** Declared helpers as tracked functions. @alpha */
export type ITrackedHelpers<THelpers extends object> = IResolutionTrackedHelpers<THelpers>;

/** A lazy view over one exact retained result. @alpha */
export type IResultView<T> = IResolutionResultView<T>;

/** A source's eligible previous result carrier. @alpha */
export type IPreviousResult<T> = IResolutionPreviousResult<T>;

/** A minted source outcome: fresh data or explicit retention. @alpha */
export type ISourceOutcome<T> = IResolutionSourceOutcome<T>;

/** Constructors of the only outcomes a source may return. @alpha */
export type ISourceOutcomes = IResolutionSourceOutcomes;

/** A declared, argument-free child call handle. @alpha */
export type IDeclaredCallHandle<T> = IDefinitionDeclaredCallHandle<T>;

/** The immutable `{ data }` carrier a declared child call resolves to. @alpha */
export type IChildResult<T> = IDefinitionChildResult<T>;

/**
 * Create builders for one analysis, bound to the workspace authoring family.
 * Share the instance between declarations, `compose` and the workspace run
 * that executes the composition.
 * @returns Family-bound Definition builders.
 * @alpha
 */
export function authoring<TInputs extends object, THelpers extends object>(): IAuthoring<TInputs, THelpers> {
  return declarations<IAuthoringFamily<TInputs, THelpers>>();
}

/**
 * The fresh-data and explicit-retention constructors, for source adapters
 * implemented as declared helpers. Source callbacks also receive them as
 * `outcome` in their context.
 * @alpha
 */
export const sourceOutcome: ISourceOutcomes = resolutionSourceOutcome;
