/**
 * Source-capable callable declarations. A source slot fixes a possible edge,
 * while its binding computes each call's author-owned history subject. The
 * implementation has no children: Resolution supplies tracked argument views,
 * selects an eligible previous carrier, and applies the current source policy.
 * These declarations never select freshness, execute transport, or store data.
 */
import { checkCarrier, checkBindings, checkCallback, labelOption, mint, readOptions, reject, versionOption } from './declaration.js';
import type { IAuthorInvoker, IDeclarationBrand, IDeclarationRecords } from './declaration.js';
import type { IApply, IBindingFamily } from './family.js';
import type { IArgumentViews, ISlotSubject, IStepSlotOptions, ISuppliedStepRegistrationBrand } from './slot.js';
import { isRunOf, isSubjectCallback, registerSupply } from './slot.js';

/** Nominal source-slot identity, distinct from an executable declaration. @alpha */
export interface ISourceSlotBrand<TFamily extends IBindingFamily> {
  readonly __microdeltaSourceSlot: unique symbol;
  readonly __microdeltaFamily?: (family: TFamily) => TFamily;
}

/** A Definition-minted callable source token, separate from memo step slots. @alpha */
export interface IAnySourceSlot<TFamily extends IBindingFamily> extends ISourceSlotBrand<TFamily> {
  readonly kind: 'source-slot';
  readonly slot: string;
}

/** The argument/result contract of a possible source call. @alpha */
export interface ISourceSlot<TFamily extends IBindingFamily, TParameters extends readonly unknown[], TResult> extends IAnySourceSlot<TFamily> {
  readonly __microdeltaSignature?: (parameters: TParameters) => TResult;
}

/** Current source bindings plus this call's tracked positional arguments. @alpha */
export type ISuppliedSourceRunContext<TFamily extends IBindingFamily, TParameters extends readonly unknown[], TResult> = TFamily['source'] & {
  readonly args: IArgumentViews<TFamily, TParameters>;
  readonly previous: IApply<TFamily['previous'], TResult> | undefined;
};

/** A current finality check always has an eligible previous carrier. @alpha */
export type ISuppliedSourceFinalityContext<TFamily extends IBindingFamily, TParameters extends readonly unknown[], TResult> = TFamily['source'] & {
  readonly args: IArgumentViews<TFamily, TParameters>;
  readonly previous: IApply<TFamily['previous'], TResult>;
};

/** Source implementation identity without an author history subject of its own. @alpha */
export interface IAnySuppliedSourceDeclaration<TFamily extends IBindingFamily> extends IDeclarationBrand<TFamily> {
  readonly kind: 'supplied-source';
  readonly version: number;
  readonly label: string | undefined;
  readonly run: (context: never) => unknown;
  readonly finality: ((context: never) => unknown) | undefined;
}

/** A supplied source returns the existing explicit source-outcome protocol. @alpha */
export interface ISuppliedSourceDeclaration<TFamily extends IBindingFamily, TParameters extends readonly unknown[], TResult> extends IAnySuppliedSourceDeclaration<TFamily> {
  readonly run: (context: ISuppliedSourceRunContext<TFamily, TParameters, TResult>) => IApply<TFamily['outcomes'], TResult> | Promise<IApply<TFamily['outcomes'], TResult>>;
  readonly finality: ((context: ISuppliedSourceFinalityContext<TFamily, TParameters, TResult>) => unknown) | undefined;
}

/** Policy callbacks for a source whose subject is computed at each call. @alpha */
export interface ISuppliedSourceOptions<TFamily extends IBindingFamily, TParameters extends readonly unknown[], TResult> {
  readonly version?: number;
  readonly label?: string;
  readonly run: (context: ISuppliedSourceRunContext<TFamily, TParameters, TResult>) => IApply<TFamily['outcomes'], TResult> | Promise<IApply<TFamily['outcomes'], TResult>>;
  readonly finality?: (context: ISuppliedSourceFinalityContext<TFamily, TParameters, TResult>) => unknown;
}

/** Composition binding that cannot substitute a memo for source policy. @alpha */
export interface ISupplySourceOptions<TFamily extends IBindingFamily, TParameters extends readonly unknown[], TResult> {
  readonly slot: ISourceSlot<TFamily, TParameters, TResult>;
  readonly declaration: ISuppliedSourceDeclaration<TFamily, TParameters, TResult>;
  readonly subject: ISlotSubject<TParameters>;
}

/** A source binding preserves its source kind throughout composition registration. @alpha */
export interface ISuppliedSourceRegistration<TFamily extends IBindingFamily> extends ISuppliedStepRegistrationBrand<TFamily> {
  readonly slot: string;
  readonly declaration: IAnySuppliedSourceDeclaration<TFamily>;
}

/** Resolution alone constructs argument views for the current source call. @alpha */
export interface ISourceArgumentSupplier<TFamily extends IBindingFamily> {
  views<TParameters extends readonly unknown[], TResult>(declaration: ISuppliedSourceDeclaration<TFamily, TParameters, TResult>): IArgumentViews<TFamily, TParameters>;
}

/** Resolution selects the eligible exact previous result before any hook. @alpha */
export interface ISourcePreviousSupplier<TFamily extends IBindingFamily> {
  carrier<TResult>(declaration: ISuppliedSourceDeclaration<TFamily, never, TResult>): IApply<TFamily['previous'], TResult>;
}

/** Typed callback closures retained only by the owning builder instance. */
export interface ISuppliedSourceRecord<TFamily extends IBindingFamily> {
  readonly kind: 'supplied-source';
  readonly declaration: IAnySuppliedSourceDeclaration<TFamily>;
  apply<TOutcome>(bindings: TFamily['source'], previous: ISourcePreviousSupplier<TFamily> | undefined, args: ISourceArgumentSupplier<TFamily>, invoke: IAuthorInvoker<TOutcome>): TOutcome;
  applyFinality<TOutcome>(bindings: TFamily['source'], previous: ISourcePreviousSupplier<TFamily>, args: ISourceArgumentSupplier<TFamily>, invoke: IAuthorInvoker<TOutcome>): TOutcome;
}

/** Minted tokens are recognized by identity rather than their public shape. */
const tokens = new WeakMap<object, string>();

/** Recognize a genuine possible source edge without invoking author code. */
export function sourceSlotName(value: unknown): string | undefined {
  return typeof value === 'object' && value !== null ? tokens.get(value) : undefined;
}

/** Declare a source edge without running its implementation or subject function. */
export function declareSourceSlot<TFamily extends IBindingFamily, TParameters extends readonly unknown[], TResult>(options: IStepSlotOptions): ISourceSlot<TFamily, TParameters, TResult> {
  const read = readOptions(options);
  const slot = read.get('slot');
  if (typeof slot !== 'string' || slot.length === 0) { return reject('invalid-descriptor', 'A source slot name must be a nonempty string.'); }
  const token = Object.freeze({ kind: 'source-slot' as const, slot });
  tokens.set(token, slot);
  // The brand and signature exist only in types; this registry is their sole minting authority.
  return token as ISourceSlot<TFamily, TParameters, TResult>;
}

/** Declare source policy while preserving the author's exact callback types. */
export function declareSuppliedSource<TFamily extends IBindingFamily, TParameters extends readonly unknown[], TResult>(records: IDeclarationRecords<TFamily>, options: ISuppliedSourceOptions<TFamily, TParameters, TResult>): ISuppliedSourceDeclaration<TFamily, TParameters, TResult> {
  const read = readOptions(options);
  if (read.has('subject')) { reject('invalid-subject', 'A callable source gets its subject from its slot binding.'); }
  if (read.has('children') || read.has('collection') || read.has('over')) { reject('illegal-edge', 'A callable source declares no children or collection.'); }
  checkCallback(read, 'run', true);
  checkCallback(read, 'finality', false);
  const run = read.get('run');
  const finality = read.get('finality');
  if (!isRunOf<ISuppliedSourceRunContext<TFamily, TParameters, TResult>, IApply<TFamily['outcomes'], TResult> | Promise<IApply<TFamily['outcomes'], TResult>>>(run)) { return reject('invalid-callback', 'A supplied source run must be a function.'); }
  if (finality !== undefined && !isRunOf<ISuppliedSourceFinalityContext<TFamily, TParameters, TResult>, unknown>(finality)) { return reject('invalid-callback', 'A supplied source finality must be a function.'); }
  const declaration = mint<ISuppliedSourceDeclaration<TFamily, TParameters, TResult>>({ kind: 'supplied-source', version: versionOption(read), label: labelOption(read), run, finality });
  const argumentsOf = (bindings: object, args: ISourceArgumentSupplier<TFamily>): IArgumentViews<TFamily, TParameters> => {
    checkBindings(bindings, 'args');
    checkBindings(bindings, 'previous');
    const views = args.views(declaration);
    if (!Array.isArray(views) || !Object.isFrozen(views)) { reject('invalid-bindings', 'Source argument views must be a frozen array.'); }
    return views;
  };
  const record: ISuppliedSourceRecord<TFamily> = {
    kind: 'supplied-source', declaration,
    apply(bindings, previous, args, invoke) {
      const context: ISuppliedSourceRunContext<TFamily, TParameters, TResult> = { ...bindings, args: argumentsOf(bindings, args), previous: previous === undefined ? undefined : checkCarrier(previous.carrier(declaration)) };
      return invoke(run, Object.freeze(context));
    },
    applyFinality(bindings, previous, args, invoke) {
      if (finality === undefined) { return reject('invalid-callback', 'This callable source declares no finality hook.'); }
      const context: ISuppliedSourceFinalityContext<TFamily, TParameters, TResult> = { ...bindings, args: argumentsOf(bindings, args), previous: checkCarrier(previous.carrier(declaration)) };
      return invoke(finality, Object.freeze(context));
    },
  };
  records.set(declaration, record);
  return declaration;
}

/** Bind only a source implementation to a genuine source token. */
export function declareSupplySource<TFamily extends IBindingFamily, TParameters extends readonly unknown[], TResult>(records: IDeclarationRecords<TFamily>, options: ISupplySourceOptions<TFamily, TParameters, TResult>): ISuppliedSourceRegistration<TFamily> {
  const read = readOptions(options);
  const slot = sourceSlotName(read.get('slot'));
  const declaration = read.get('declaration');
  const record = typeof declaration === 'object' && declaration !== null ? records.get(declaration) : undefined;
  if (slot === undefined || record?.kind !== 'supplied-source') { return reject('forged-declaration', 'A source binding requires a source slot and source implementation from this family.'); }
  const subject = read.get('subject');
  if (!isSubjectCallback(subject)) { return reject('invalid-subject', 'A callable source requires an author subject function.'); }
  return registerSupply<TFamily, IAnySuppliedSourceDeclaration<TFamily>>(slot, record.declaration, subject);
}
