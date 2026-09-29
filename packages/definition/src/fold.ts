/**
 * Strict fold declarations (CMP-8, RUN-010).
 *
 * A strict fold is a composition-level memoized step over one fanout template's
 * member step, named as `{ template, step }`. Its author callback receives one
 * explicit keyed entry per current member in canonical key order: `succeeded`
 * with the member's result view, or `skipped` with no data at all. Reading data
 * from a skipped entry throws, so a gated-out member can never be mistaken for
 * a successful empty result. Definition validates and assembles those entries
 * from outcomes Resolution supplies; it never decides readiness, waits, fails
 * or publishes a fold, and never selects the member results themselves.
 */
import {
  checkBindings,
  checkCallback,
  labelOption,
  mint,
  readOptions,
  reject,
  subjectOption,
  versionOption,
  type IAuthorInvoker,
  type IDeclarationBrand,
  type IDeclarationRecords,
  type IResultOf,
} from './declaration.js';
import type { IBindingDescriptor } from './descriptor.js';
import type { IApply, IBindingFamily } from './family.js';
import type { IInvocationScope } from './invocation.js';
import type { IAnyTemplateDeclaration, ITemplateRecords } from './template.js';

/**
 * A member whose required result was accepted, with its result view.
 * @alpha
 */
export interface ISucceededEntry<T> {
  /** The member key. */
  readonly key: string;
  readonly status: 'succeeded';
  /** The member step's result view. */
  readonly data: T;
}

/**
 * A member its gate excluded from the required population. It carries no data:
 * the type has no `data` property, and reading `data` at runtime throws a
 * `skipped-member` DefinitionError, so a skip is never mistaken for a
 * successful empty result.
 * @alpha
 */
export interface ISkippedEntry {
  /** The member key. */
  readonly key: string;
  readonly status: 'skipped';
}

/**
 * One explicit keyed member entry of a strict fold.
 * @alpha
 */
export type IFoldEntry<T> = ISucceededEntry<T> | ISkippedEntry;

/**
 * The step record of a template declaration.
 * @alpha
 */
export type IStepsOf<TTemplate> = TTemplate extends { readonly steps: infer TSteps } ? TSteps : never;

/**
 * Author context for a strict fold: the facade's memo bindings plus explicit
 * keyed member entries in canonical key order.
 * @alpha
 */
export type IFoldRunContext<TFamily extends IBindingFamily, TMemberResult> = TFamily['memo'] & {
  readonly members: readonly IFoldEntry<IApply<TFamily['views'], TMemberResult>>[];
};

/**
 * The template step a strict fold consumes.
 * @alpha
 */
export interface IFoldOver<TTemplate, TStep extends string> {
  /** The fanout template. */
  readonly template: TTemplate;
  /** One of the template's step slots. */
  readonly step: TStep;
}

/**
 * Author options for a strict fold.
 * @alpha
 */
export interface IFoldOptions<
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
  /** The template step whose member results the fold consumes. */
  readonly over: IFoldOver<TTemplate, TStep>;
  /** The author's fold callback. */
  readonly run: (context: IFoldRunContext<TFamily, IResultOf<TFamily, IStepsOf<TTemplate>[TStep]>>) => TResult;
}

/**
 * A strict fold declaration with its member and result types erased.
 * @alpha
 */
export interface IAnyFoldDeclaration<TFamily extends IBindingFamily> extends IDeclarationBrand<TFamily> {
  readonly kind: 'fold';
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
 * A strict fold declaration carrying its member result and own result types.
 * @alpha
 */
export interface IFoldDeclaration<TFamily extends IBindingFamily, TMemberResult, TResult> extends IAnyFoldDeclaration<TFamily> {
  readonly run: (context: IFoldRunContext<TFamily, TMemberResult>) => TResult;
}

/**
 * Resolution's supplier of the explicit member outcomes for one fold
 * invocation: every current member as `succeeded` with its view or `skipped`
 * with no data. Definition validates, orders and freezes them.
 * @alpha
 */
export interface IFoldMemberSupplier<TFamily extends IBindingFamily> {
  /** The member outcomes for this fold declaration. */
  outcomes<TMemberResult>(fold: IFoldDeclaration<TFamily, TMemberResult, unknown>): readonly IFoldEntry<IApply<TFamily['views'], TMemberResult>>[];
}

/**
 * A live strict fold invocation.
 * @alpha
 */
export interface IFoldInvocation<TFamily extends IBindingFamily> extends IInvocationScope {
  readonly kind: 'fold';
  /** The template step descriptor (no member key) the fold consumes. */
  readonly over: IBindingDescriptor;
  /** Hand the actual author `run` and its context (bindings plus keyed entries) to the invoker. */
  apply<TOutcome>(bindings: TFamily['memo'], members: IFoldMemberSupplier<TFamily>, invoke: IAuthorInvoker<TOutcome>): TOutcome;
}

/**
 * One strict fold in a frozen composition's topology.
 * @alpha
 */
export interface IFoldTopology {
  /** The fold's composition-level step descriptor. */
  readonly fold: IBindingDescriptor;
  /** The template step descriptor it consumes. */
  readonly over: IBindingDescriptor;
}

/** A fold step's record: its erased declaration and typed invocation closure. */
export interface IFoldRecord<TFamily extends IBindingFamily> {
  readonly kind: 'fold';
  readonly declaration: IAnyFoldDeclaration<TFamily>;
  /** Pair the actual `run` with bindings plus explicit keyed entries and hand both to the invoker. */
  apply<TOutcome>(bindings: TFamily['memo'], members: IFoldMemberSupplier<TFamily>, invoke: IAuthorInvoker<TOutcome>): TOutcome;
}

/**
 * Declare a strict fold over a template step without invoking any callback.
 * The template must be one this builder instance minted and the step one of
 * its declared step slots; the `over` record is copied and frozen.
 * @param records - The builder instance's declaration records.
 * @param templates - The builder instance's template records.
 * @param options - The author's subject, version, label, `over` and callback.
 * @returns The frozen fold declaration.
 */
export function declareFold<
  TFamily extends IBindingFamily,
  TTemplate extends IAnyTemplateDeclaration<TFamily>,
  TStep extends keyof IStepsOf<TTemplate> & string,
  TResult,
>(
  records: IDeclarationRecords<TFamily>,
  templates: ITemplateRecords<TFamily>,
  options: IFoldOptions<TFamily, TTemplate, TStep, TResult>,
): IFoldDeclaration<TFamily, IResultOf<TFamily, IStepsOf<TTemplate>[TStep]>, TResult> {
  const read = readOptions(options);
  // Options of other declaration kinds never apply to a fold.
  if (read.has('children')) {
    reject('illegal-edge', 'A fold declares no child edges; it consumes the template step named by `over`.');
  }
  if (read.has('collection')) {
    reject('invalid-collection', 'Only a source declares a keyed collection.');
  }
  if (read.has('finality')) {
    reject('invalid-callback', 'Only a source declares a finality hook.');
  }
  checkCallback(read, 'run', true);
  const subject = subjectOption(read);
  const version = versionOption(read);
  const label = labelOption(read);
  const over = read.get('over');
  if (typeof over !== 'object' || over === null) {
    return reject('illegal-edge', 'A fold must name the template step it consumes as { template, step }.');
  }
  const template = ownData(over, 'template');
  const step = ownData(over, 'step');
  const templateRecord = typeof template === 'object' && template !== null ? templates.get(template) : undefined;
  if (templateRecord === undefined) {
    return reject('forged-declaration', 'A fold must consume a template this family minted.');
  }
  if (typeof step !== 'string' || !templateRecord.steps.has(step)) {
    return reject('illegal-edge', `A fold must consume a declared step of template ${templateRecord.declaration.slot}.`);
  }
  // `run` was just proven to be an own data property holding a function.
  const { run } = options;
  const declaration = mint<IFoldDeclaration<TFamily, IResultOf<TFamily, IStepsOf<TTemplate>[TStep]>, TResult>>({
    kind: 'fold',
    subject,
    version,
    label,
    over: Object.freeze({ template: templateRecord.declaration, step }),
    run,
  });
  const record: IFoldRecord<TFamily> = {
    kind: 'fold',
    declaration,
    apply<TOutcome>(bindings: TFamily['memo'], members: IFoldMemberSupplier<TFamily>, invoke: IAuthorInvoker<TOutcome>): TOutcome {
      checkBindings(bindings, 'members');
      const context: IFoldRunContext<TFamily, IResultOf<TFamily, IStepsOf<TTemplate>[TStep]>> = {
        ...bindings,
        members: foldEntries(members.outcomes(declaration)),
      };
      Object.freeze(context);
      return invoke(run, context);
    },
  };
  records.set(declaration, record);
  return declaration;
}

/**
 * Validate Resolution-supplied member outcomes and rebuild them as frozen,
 * explicit entries in canonical key order. Each entry must be an own-data
 * record with a nonempty string key unique among the entries; a succeeded
 * entry must carry its own `data`, and a skipped entry must carry none.
 * Accessors are never invoked. Data is passed through unread.
 */
function foldEntries<T>(outcomes: readonly IFoldEntry<T>[]): readonly IFoldEntry<T>[] {
  // Checked through an untyped alias: narrowing the typed array itself would widen its entries to `any`.
  const supplied: unknown = outcomes;
  if (!Array.isArray(supplied)) {
    return reject('invalid-members', 'Fold member outcomes must be an array of explicit keyed entries.');
  }
  const entries = new Map<string, IFoldEntry<T>>();
  for (let index = 0; index < outcomes.length; index++) {
    const element = Object.getOwnPropertyDescriptor(outcomes, index);
    const entry = element !== undefined && 'value' in element ? outcomes[index] : undefined;
    if (typeof entry !== 'object' || entry === null || !hasOwnData(entry, 'key') || !hasOwnData(entry, 'status')) {
      return reject('invalid-members', 'Each fold member outcome must be a record with own key and status data properties.');
    }
    const { key } = entry;
    if (typeof key !== 'string' || key.length === 0 || entries.has(key)) {
      return reject('invalid-members', 'Fold member keys must be unique nonempty strings.');
    }
    if (entry.status === 'succeeded' && hasOwnData(entry, 'data')) {
      entries.set(key, Object.freeze({ key, status: 'succeeded', data: entry.data }));
    } else if (entry.status === 'skipped' && !('data' in entry)) {
      entries.set(key, skippedEntry(key));
    } else {
      return reject('invalid-members', `Fold member ${key} must be succeeded with its own data or skipped with no data.`);
    }
  }
  // Canonical key order: UTF-16 code units, independent of supply order.
  return Object.freeze([...entries.keys()].sort((left, right) => (left < right ? -1 : left > right ? 1 : 0)).flatMap(key => entries.get(key) ?? []));
}

/** A frozen skipped entry whose non-enumerable `data` throws when read (CMP-8). */
function skippedEntry(key: string): ISkippedEntry {
  const entry: ISkippedEntry = { key, status: 'skipped' };
  Object.defineProperty(entry, 'data', {
    enumerable: false,
    get(): never {
      return reject('skipped-member', `Member ${key} was skipped by its gate and carries no data.`);
    },
  });
  return Object.freeze(entry);
}

/** Whether a value has an own data property; accessors and inherited properties do not count. */
function hasOwnData(value: object, key: string): boolean {
  const descriptor = Object.getOwnPropertyDescriptor(value, key);
  return descriptor !== undefined && 'value' in descriptor;
}

/** An own data property's value, or undefined; accessors are never invoked. */
function ownData(value: object, key: string): unknown {
  const descriptor = Object.getOwnPropertyDescriptor(value, key);
  return descriptor !== undefined && 'value' in descriptor ? descriptor.value : undefined;
}
