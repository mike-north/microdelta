/**
 * The facade's alpha authoring vocabulary. Authors declare sources, memos and
 * their fixed composition with Definition's builders bound to Reuse
 * Resolution's binding family, so callbacks receive tracked current inputs and
 * helpers, a source's eligible previous carrier and outcome constructors, and
 * a memo's declared child handles.
 *
 * The same builders declare keyed composition: a collection source whose
 * result is a keyed member list with a completion status, a fanout template
 * built once against a symbolic member (keyed by designated identity or a
 * custom key, optionally gated), member steps that read their member through
 * the member binding, supplied step slots bound at composition, canonical
 * `forward` origins for arguments, the observed untracked read, and strict
 * folds and outcome (tolerant) folds over a template step's members.
 *
 * Every type here is a facade-local `@alpha` alias of its owner's contract,
 * declared locally so the default public declaration view never references a
 * sibling's project-private surface. Spellings are not a public API.
 */
import { declarations } from '@microdelta/definition';
import type {
  IAnyTemplateDeclaration as IDefinitionAnyTemplateDeclaration,
  IBindingDescriptor,
  IChildResult as IDefinitionChildResult,
  ICollectionResult as IDefinitionCollectionResult,
  ICollectionStatus as IDefinitionCollectionStatus,
  IComposition as IDefinitionComposition,
  IDeclarations,
  IDeclaredCallHandle as IDefinitionDeclaredCallHandle,
  IDerivedArguments as IDefinitionDerivedArguments,
  ICancelledEntry as IDefinitionCancelledEntry,
  IFailedEntry as IDefinitionFailedEntry,
  IFoldDeclaration as IDefinitionFoldDeclaration,
  IFoldEntry as IDefinitionFoldEntry,
  IOutcomeEntry as IDefinitionOutcomeEntry,
  IOutcomeFoldDeclaration as IDefinitionOutcomeFoldDeclaration,
  IForward as IDefinitionForward,
  IForwarded as IDefinitionForwarded,
  IKeyedMember as IDefinitionKeyedMember,
  IKeyedSnapshot as IDefinitionKeyedSnapshot,
  IKeyingDiagnostic as IDefinitionKeyingDiagnostic,
  IKeyingFailure as IDefinitionKeyingFailure,
  IMemberBinding as IDefinitionMemberBinding,
  IMemberBuilder as IDefinitionMemberBuilder,
  IPathInput as IDefinitionPathInput,
  ISkippedEntry as IDefinitionSkippedEntry,
  ISlotSubject as IDefinitionSlotSubject,
  IStepSlot as IDefinitionStepSlot,
  ISucceededEntry as IDefinitionSucceededEntry,
  ISuppliedStepDeclaration as IDefinitionSuppliedStepDeclaration,
  ISuppliedStepRegistration as IDefinitionSuppliedStepRegistration,
} from '@microdelta/definition';
import { sourceOutcome as resolutionSourceOutcome } from '@microdelta/resolution';
import type {
  IPreviousResult as IResolutionPreviousResult,
  IResolutionFamily,
  IResultView as IResolutionResultView,
  ISourceOutcome as IResolutionSourceOutcome,
  ISourceOutcomes as IResolutionSourceOutcomes,
  ITrackedHelpers as IResolutionTrackedHelpers,
  IUntrackedRead as IResolutionUntrackedRead,
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
 * `memo`, `template`, `fold`, `outcomeFold`, `stepSlot`, `suppliedStep`, `supply`, the
 * canonical `forward` origins, `compose`, and the invocation bridge the
 * workspace uses.
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
 * The observed untracked read every step callback receives as `untracked`:
 * it reads one member of a tracked value without making the value evidence,
 * and records that such a read happened, so arguments derived after it are
 * never justified from recorded evidence alone.
 * @alpha
 */
export type IUntrackedRead = IResolutionUntrackedRead;

/**
 * Whether discovery closed its member list (`complete`) or may still be
 * missing members (`open`). Only a complete list supports a strict fold's
 * coverage.
 * @alpha
 */
export type ICollectionStatus = IDefinitionCollectionStatus;

/**
 * The result a keyed collection source returns: the discovered member records
 * in discovery order and the completion status. Order is never identity.
 * @alpha
 */
export type ICollectionResult<TMember> = IDefinitionCollectionResult<TMember>;

/**
 * The builder a template's step factory receives: member sources and memos
 * bound to the symbolic member, and member subjects that each instance
 * completes with its key (`prefix:key`).
 * @alpha
 */
export type IMemberBuilder<TInputs extends object, THelpers extends object, TMember> = IDefinitionMemberBuilder<IAuthoringFamily<TInputs, THelpers>, TMember>;

/**
 * The member binding a template's gate and member steps receive as `member`:
 * a tracked view of the instance's current member record.
 * @alpha
 */
export type IMemberBinding<TInputs extends object, THelpers extends object, TMember> = IDefinitionMemberBinding<IAuthoringFamily<TInputs, THelpers>, TMember>;

/** Any template declaration of one analysis, as a composition registers it. @alpha */
export type IAnyTemplateDeclaration<TInputs extends object, THelpers extends object> = IDefinitionAnyTemplateDeclaration<IAuthoringFamily<TInputs, THelpers>>;

/**
 * A declared callable step slot: a memo calls it with arguments, and the
 * composition supplies the step implementation bound to it.
 * @alpha
 */
export type IStepSlot<TInputs extends object, THelpers extends object, TParameters extends readonly unknown[], TResult> = IDefinitionStepSlot<IAuthoringFamily<TInputs, THelpers>, TParameters, TResult>;

/** A supplied step implementation, receiving its arguments as views. @alpha */
export type ISuppliedStepDeclaration<TInputs extends object, THelpers extends object, TParameters extends readonly unknown[], TResult> = IDefinitionSuppliedStepDeclaration<IAuthoringFamily<TInputs, THelpers>, TParameters, TResult>;

/** The binding of one supplied implementation to a step slot, as a composition registers it. @alpha */
export type ISuppliedStepRegistration<TInputs extends object, THelpers extends object> = IDefinitionSuppliedStepRegistration<IAuthoringFamily<TInputs, THelpers>>;

/** A slot call's derived argument values; forwarded positions are absent. @alpha */
export type IDerivedArguments<TParameters extends readonly unknown[]> = IDefinitionDerivedArguments<TParameters>;

/** Computes a supplied call's complete history subject from its derived arguments only. @alpha */
export type ISlotSubject<TParameters extends readonly unknown[]> = IDefinitionSlotSubject<TParameters>;

/**
 * Canonical forwarded-argument origins: a declared input, the member binding
 * or an earlier child call's result, each with a structural path. A
 * forwarded argument is identified by its origin and re-resolved from current
 * bindings on validation.
 * @alpha
 */
export type IForward = IDefinitionForward;

/** A forwarded argument token minted by {@link IForward}. @alpha */
export type IForwarded<T = unknown> = IDefinitionForwarded<T>;

/** A structural path of property names and array indices. @alpha */
export type IPathInput = IDefinitionPathInput;

/** A strict fold declaration over one template step. @alpha */
export type IFoldDeclaration<TInputs extends object, THelpers extends object, TMemberResult, TResult> = IDefinitionFoldDeclaration<IAuthoringFamily<TInputs, THelpers>, TMemberResult, TResult>;

/**
 * One explicit keyed entry a strict fold body receives per current member,
 * in canonical key order: succeeded with a view of the member's result, or
 * skipped by its gate with no data.
 * @alpha
 */
export type IFoldEntry<T> = IDefinitionFoldEntry<T>;

/** A succeeded strict fold entry. @alpha */
export type ISucceededEntry<T> = IDefinitionSucceededEntry<T>;

/** A strict fold entry for a member its gate skipped; it carries no data. @alpha */
export type ISkippedEntry = IDefinitionSkippedEntry;

/**
 * An outcome (tolerant) fold declaration over one template step: its body
 * receives every member's settled status rather than requiring complete
 * success (RUN-010).
 * @alpha
 */
export type IOutcomeFoldDeclaration<TInputs extends object, THelpers extends object, TMemberResult, TResult> = IDefinitionOutcomeFoldDeclaration<IAuthoringFamily<TInputs, THelpers>, TMemberResult, TResult>;

/**
 * One explicit keyed entry an outcome fold body receives per current member,
 * in canonical key order, with its settled status: succeeded with a view of
 * the member's result, or skipped, failed or cancelled with no data. A
 * pending member is never an entry: the body runs only once every member has
 * settled.
 * @alpha
 */
export type IOutcomeEntry<T> = IDefinitionOutcomeEntry<T>;

/** An outcome fold entry for a member whose work failed in this pass; it carries no data. @alpha */
export type IFailedEntry = IDefinitionFailedEntry;

/** An outcome fold entry for a member whose work was cancelled for this run; settled, never a success, and it carries no data. @alpha */
export type ICancelledEntry = IDefinitionCancelledEntry;

/** One collection snapshot keyed by a composition's template, or its keying rejection. @alpha */
export type IKeyedSnapshot = IDefinitionKeyedSnapshot;

/** One keyed member of a snapshot. @alpha */
export type IKeyedMember = IDefinitionKeyedMember;

/** Why a collection snapshot could not be keyed; it names the collection, the key and the custom-key option. @alpha */
export type IKeyingDiagnostic = IDefinitionKeyingDiagnostic;

/** The keying failure reasons. @alpha */
export type IKeyingFailure = IDefinitionKeyingFailure;

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
