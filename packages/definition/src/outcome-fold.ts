/**
 * Outcome (tolerant) fold declarations (RUN-010).
 *
 * An outcome fold is a composition-level memoized step over one fanout
 * template's member step, named as `{ template, step }` exactly as a strict
 * fold names it, but with a different contract. A strict fold consumes the
 * complete success of its required population; an outcome fold consumes
 * every member's *settled status*, so authors can report failures and
 * statistics or select successful results explicitly. Its author callback
 * receives one explicit keyed entry per current member in canonical key
 * order: `succeeded` with the member's result view, or `skipped`, `failed` or
 * `cancelled` with no data at all. Reading data from a data-free entry
 * throws, so none is ever mistaken for a successful empty result.
 *
 * Definition validates and assembles those entries from outcomes Resolution
 * supplies. It never decides that members have settled, that discovery is
 * closed, or that the fold may run or publish: Resolution runs an outcome
 * fold's body only once discovery is closed and every member has settled,
 * and an unsettled (pending) member never reaches it as an entry. Like a
 * strict fold, an outcome fold is never a child, a member step or a template
 * step, so resolving it never starts a fan-out inside another member's work.
 */
import { checkBindings, mint, readOptions, type IAuthorInvoker, type IDeclarationBrand, type IDeclarationRecords, type IResultOf } from './declaration.js';
import type { IBindingDescriptor } from './descriptor.js';
import type { IApply, IBindingFamily } from './family.js';
import { foldCommon, settledEntries, type IFoldOver, type IOutcomeEntry, type IStepsOf } from './fold.js';
import type { IInvocationScope } from './invocation.js';
import type { IAnyTemplateDeclaration, ITemplateRecords } from './template.js';

/**
 * Author context for an outcome fold: the facade's memo bindings plus one
 * explicit keyed entry per current member, carrying its settled status, in
 * canonical key order.
 * @alpha
 */
export type IOutcomeFoldRunContext<TFamily extends IBindingFamily, TMemberResult> = TFamily['memo'] & {
  readonly members: readonly IOutcomeEntry<IApply<TFamily['views'], TMemberResult>>[];
};

/**
 * Author options for an outcome fold.
 * @alpha
 */
export interface IOutcomeFoldOptions<
  TFamily extends IBindingFamily,
  TTemplate extends IAnyTemplateDeclaration<TFamily>,
  TStep extends keyof IStepsOf<TTemplate> & string,
  TResult,
> {
  /** Complete opaque author identity of this work's history, unique within its analysis scope. */
  readonly subject: string;
  /** Compatibility group; a positive safe integer, default 1. */
  readonly version?: number;
  /** Display metadata only; never identity or correspondence. */
  readonly label?: string;
  /** The template step whose members' settled statuses the fold consumes. */
  readonly over: IFoldOver<TTemplate, TStep>;
  /** The author's fold callback. */
  readonly run: (context: IOutcomeFoldRunContext<TFamily, IResultOf<TFamily, IStepsOf<TTemplate>[TStep]>>) => TResult;
}

/**
 * An outcome fold declaration with its member and result types erased.
 * @alpha
 */
export interface IAnyOutcomeFoldDeclaration<TFamily extends IBindingFamily> extends IDeclarationBrand<TFamily> {
  readonly kind: 'outcome-fold';
  /** Complete opaque author subject, retained exactly. */
  readonly subject: string;
  /** Positive safe-integer compatibility group. */
  readonly version: number;
  /** Display metadata only. */
  readonly label: string | undefined;
  /** The template and step slot the fold consumes, frozen. */
  readonly over: IFoldOver<IAnyTemplateDeclaration<TFamily>, string>;
  /** The author's actual fold callback. */
  readonly run: (context: never) => unknown;
}

/**
 * An outcome fold declaration carrying its member result and own result types.
 * @alpha
 */
export interface IOutcomeFoldDeclaration<TFamily extends IBindingFamily, TMemberResult, TResult> extends IAnyOutcomeFoldDeclaration<TFamily> {
  readonly run: (context: IOutcomeFoldRunContext<TFamily, TMemberResult>) => TResult;
}

/**
 * Resolution's supplier of the explicit member outcomes for one outcome fold
 * invocation: every current member with its settled status, `succeeded` with
 * its view and every other status with no data. Definition validates, orders
 * and freezes them.
 * @alpha
 */
export interface IOutcomeFoldMemberSupplier<TFamily extends IBindingFamily> {
  /** The member outcomes for this outcome fold declaration. */
  outcomes<TMemberResult>(fold: IOutcomeFoldDeclaration<TFamily, TMemberResult, unknown>): readonly IOutcomeEntry<IApply<TFamily['views'], TMemberResult>>[];
}

/**
 * A live outcome fold invocation.
 * @alpha
 */
export interface IOutcomeFoldInvocation<TFamily extends IBindingFamily> extends IInvocationScope {
  readonly kind: 'outcome-fold';
  /** The template step descriptor (no member key) the fold consumes. */
  readonly over: IBindingDescriptor;
  /** Hand the actual author `run` and its context (bindings plus settled keyed entries) to the invoker. */
  apply<TOutcome>(bindings: TFamily['memo'], members: IOutcomeFoldMemberSupplier<TFamily>, invoke: IAuthorInvoker<TOutcome>): TOutcome;
}

/** An outcome fold step's record: its erased declaration and typed invocation closure. */
export interface IOutcomeFoldRecord<TFamily extends IBindingFamily> {
  readonly kind: 'outcome-fold';
  readonly declaration: IAnyOutcomeFoldDeclaration<TFamily>;
  /** Pair the actual `run` with bindings plus explicit settled entries and hand both to the invoker. */
  apply<TOutcome>(bindings: TFamily['memo'], members: IOutcomeFoldMemberSupplier<TFamily>, invoke: IAuthorInvoker<TOutcome>): TOutcome;
}

/** Every settled status an outcome fold's entries carry; pending or unresolved work is never one. */
const settledStatuses: ReadonlySet<IOutcomeEntry<unknown>['status']> = new Set(['succeeded', 'skipped', 'failed', 'cancelled'] as const);

/**
 * Declare an outcome fold over a template step without invoking any callback.
 * The template must be one this builder instance minted and the step one of
 * its declared step slots, exactly as for a strict fold; the `over` record is
 * copied and frozen.
 * @param records - The builder instance's declaration records.
 * @param templates - The builder instance's template records.
 * @param options - The author's subject, version, label, `over` and callback.
 * @returns The frozen outcome fold declaration.
 */
export function declareOutcomeFold<
  TFamily extends IBindingFamily,
  TTemplate extends IAnyTemplateDeclaration<TFamily>,
  TStep extends keyof IStepsOf<TTemplate> & string,
  TResult,
>(
  records: IDeclarationRecords<TFamily>,
  templates: ITemplateRecords<TFamily>,
  options: IOutcomeFoldOptions<TFamily, TTemplate, TStep, TResult>,
): IOutcomeFoldDeclaration<TFamily, IResultOf<TFamily, IStepsOf<TTemplate>[TStep]>, TResult> {
  const common = foldCommon(readOptions(options), templates);
  // `run` was just proven to be an own data property holding a function.
  const { run } = options;
  const declaration = mint<IOutcomeFoldDeclaration<TFamily, IResultOf<TFamily, IStepsOf<TTemplate>[TStep]>, TResult>>({ kind: 'outcome-fold', ...common, run });
  const record: IOutcomeFoldRecord<TFamily> = {
    kind: 'outcome-fold',
    declaration,
    apply<TOutcome>(bindings: TFamily['memo'], members: IOutcomeFoldMemberSupplier<TFamily>, invoke: IAuthorInvoker<TOutcome>): TOutcome {
      checkBindings(bindings, 'members');
      const context: IOutcomeFoldRunContext<TFamily, IResultOf<TFamily, IStepsOf<TTemplate>[TStep]>> = {
        ...bindings,
        members: settledEntries(members.outcomes(declaration), settledStatuses),
      };
      Object.freeze(context);
      return invoke(run, context);
    },
  };
  records.set(declaration, record);
  return declaration;
}
