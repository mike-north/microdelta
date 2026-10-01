/**
 * Supplied callable step slots.
 *
 * A step slot is a structural, composition-wide place (for example `assessor`)
 * where a supplied step implementation belongs. A parent memo names the slot
 * among its children; composition binds exactly one current supplied step
 * declaration to it, together with an author subject function over the
 * call's derived argument values (CMP-3, the EXP-4 supplied-callable
 * selection). The slot token carries the call signature only at the type level;
 * at runtime it is just its slot name. Exchanging implementation A for B is a
 * child implementation change, never a parent graph change: evidence names the
 * slot descriptor, and a call's history subject comes only from the bound
 * subject function and the call's derived values, so it is identical across
 * implementations.
 *
 * A supplied step declaration is memoized work with no subject of its own: its
 * history subject is computed per call from the slot binding. It receives the
 * facade's memo bindings plus the call's argument views, and declares no
 * children. Declaring or binding never invokes a callback.
 */
import { decodeSnapshot } from '@microdelta/value';

import type { IScopedSubject } from './composition.js';
import type { IAuthorInvoker, IDeclarationBrand, IDeclarationRecords } from './declaration.js';
import { checkBindings, checkCallback, labelOption, mint, readOptions, reject, versionOption } from './declaration.js';
import type { DefinitionError } from './errors.js';
import type { IApply, IBindingFamily } from './family.js';
import { thrownDetail } from './thrown.js';
import type { IInvocationArguments } from './witness.js';

/**
 * Nominal brand for Definition-minted step slot tokens, with an invariant family marker.
 * @alpha
 */
export interface IStepSlotBrand<TFamily extends IBindingFamily> {
  /** Type-level nominal marker; absent at runtime. */
  readonly __microdeltaStepSlot: unique symbol;
  /** Type-level invariant family marker; absent at runtime. */
  readonly __microdeltaFamily?: (family: TFamily) => TFamily;
}

/**
 * A step slot token with its call signature erased.
 * @alpha
 */
export interface IAnyStepSlot<TFamily extends IBindingFamily> extends IStepSlotBrand<TFamily> {
  /** Discriminates a slot token from declarations. */
  readonly kind: 'step-slot';
  /** The composition-wide callable slot name this token denotes. */
  readonly slot: string;
}

/**
 * A step slot token carrying its call signature: the runtime argument types a
 * caller passes and the result type the supplied implementation produces.
 * @alpha
 */
export interface IStepSlot<TFamily extends IBindingFamily, TParameters extends readonly unknown[], TResult> extends IAnyStepSlot<TFamily> {
  /** Type-level signature only; absent at runtime. */
  readonly __microdeltaSignature?: (parameters: TParameters) => TResult;
}

/**
 * Author options for a step slot.
 * @alpha
 */
export interface IStepSlotOptions {
  /** The composition-wide callable slot name, a nonempty string. */
  readonly slot: string;
}

/**
 * The views a supplied step reads its call arguments through, one per argument
 * position, typed by the facade's view family.
 * @alpha
 */
export type IArgumentViews<TFamily extends IBindingFamily, TParameters extends readonly unknown[]> = {
  readonly [K in keyof TParameters]: IApply<TFamily['views'], TParameters[K]>;
};

/**
 * Author context for a supplied step `run`: the facade's memo bindings plus the call's argument views.
 * @alpha
 */
export type ISuppliedStepRunContext<TFamily extends IBindingFamily, TParameters extends readonly unknown[]> = TFamily['memo'] & {
  readonly args: IArgumentViews<TFamily, TParameters>;
};

/**
 * A supplied step declaration with its signature erased.
 * @alpha
 */
export interface IAnySuppliedStepDeclaration<TFamily extends IBindingFamily> extends IDeclarationBrand<TFamily> {
  /** Discriminates a supplied step from source and memo declarations. */
  readonly kind: 'supplied-step';
  /** Positive safe-integer compatibility group. */
  readonly version: number;
  /** Display metadata only. */
  readonly label: string | undefined;
  /** The author's actual computation callback. */
  readonly run: (context: never) => unknown;
}

/**
 * A supplied step declaration carrying its call signature.
 * @alpha
 */
export interface ISuppliedStepDeclaration<TFamily extends IBindingFamily, TParameters extends readonly unknown[], TResult>
  extends IAnySuppliedStepDeclaration<TFamily> {
  /**
   * The author's actual computation callback, typed by its call signature.
   * Like a memo body it may be asynchronous (for example one awaited external
   * operation per call); the call's result is its settled value.
   */
  readonly run: (context: ISuppliedStepRunContext<TFamily, TParameters>) => TResult | Promise<TResult>;
}

/**
 * Author options for a supplied step implementation. It has no subject: each
 * call's history subject comes from the slot binding's subject function.
 * @alpha
 */
export interface ISuppliedStepOptions<TFamily extends IBindingFamily, TParameters extends readonly unknown[], TResult> {
  /** Compatibility group; a positive safe integer, default 1. */
  readonly version?: number;
  /** Display metadata only; never identity or correspondence. */
  readonly label?: string;
  /** The author's computation callback; it may be asynchronous, and the call's result is its settled value. */
  readonly run: (context: ISuppliedStepRunContext<TFamily, TParameters>) => TResult | Promise<TResult>;
}

/**
 * The derived argument values of one call, by position. A position whose
 * argument was forwarded or unreconstructible is absent (a hole), never
 * `undefined`, so it cannot be mistaken for a derived `undefined`. Values are
 * frozen copies decoded from the recorded canonical encoding.
 * @alpha
 */
export type IDerivedArguments<TParameters extends readonly unknown[]> = {
  readonly [K in keyof TParameters]?: TParameters[K];
};

/**
 * An author function computing the complete history subject of one slot call
 * from its derived argument values only.
 * @alpha
 */
export type ISlotSubject<TParameters extends readonly unknown[]> = (derived: IDerivedArguments<TParameters>) => string;

/**
 * Author options binding one supplied step to a slot.
 * @alpha
 */
export interface ISupplyOptions<TFamily extends IBindingFamily, TParameters extends readonly unknown[], TResult> {
  /** The slot being supplied. */
  readonly slot: IStepSlot<TFamily, TParameters, TResult>;
  /** The supplied implementation. */
  readonly declaration: ISuppliedStepDeclaration<TFamily, TParameters, TResult>;
  /** The subject function for every call through the slot. */
  readonly subject: ISlotSubject<TParameters>;
}

/**
 * Nominal brand for Definition-minted supply registrations.
 * @alpha
 */
export interface ISuppliedStepRegistrationBrand<TFamily extends IBindingFamily> {
  /** Type-level nominal marker; absent at runtime. */
  readonly __microdeltaSupply: unique symbol;
  /** Type-level invariant family marker; absent at runtime. */
  readonly __microdeltaFamily?: (family: TFamily) => TFamily;
}

/**
 * A frozen binding of one supplied step to one slot, registered with `compose`.
 * @alpha
 */
export interface ISuppliedStepRegistration<TFamily extends IBindingFamily> extends ISuppliedStepRegistrationBrand<TFamily> {
  /** The supplied callable slot name. */
  readonly slot: string;
  /** The supplied implementation. */
  readonly declaration: IAnySuppliedStepDeclaration<TFamily>;
}

/**
 * Resolution's supplier of a supplied step's argument views. Resolution
 * reconstructs and tracks the arguments; Definition only places them in the
 * author context.
 * @alpha
 */
export interface IArgumentSupplier<TFamily extends IBindingFamily> {
  /** The argument views for this supplied declaration's current call. */
  views<TParameters extends readonly unknown[]>(declaration: ISuppliedStepDeclaration<TFamily, TParameters, unknown>): IArgumentViews<TFamily, TParameters>;
}

/** A supplied step's record: its erased declaration and typed invocation closure. */
export interface ISuppliedStepRecord<TFamily extends IBindingFamily> {
  readonly kind: 'supplied-step';
  readonly declaration: IAnySuppliedStepDeclaration<TFamily>;
  /** Pair the actual `run` with bindings plus the supplied argument views and hand both to the invoker. */
  apply<TOutcome>(bindings: TFamily['memo'], args: IArgumentSupplier<TFamily>, invoke: IAuthorInvoker<TOutcome>): TOutcome;
}

/** An author subject function, validated as callable and never invoked while composing. */
export type ISubjectCallback = (...arguments_: never[]) => unknown;

/** What one Definition-minted supply registration binds, kept private to Definition. */
export interface ISupplyState {
  readonly slot: string;
  /** The supplied declaration; composition re-reads its record from its own builder instance. */
  readonly declaration: object;
  readonly subject: ISubjectCallback;
}

/** Slot names of Definition-minted step slot tokens; look-alikes are absent. */
const slotTokens = new WeakMap<object, string>();

/** Definition-minted supply registrations; look-alikes are absent. */
const supplies = new WeakMap<object, ISupplyState>();

/**
 * The slot name of a Definition-minted step slot token.
 * @returns The slot name, or undefined for anything else, including look-alikes.
 */
export function stepSlotName(value: unknown): string | undefined {
  return typeof value === 'object' && value !== null ? slotTokens.get(value) : undefined;
}

/**
 * The binding a Definition-minted supply registration carries.
 * @returns The binding, or undefined for anything else, including look-alikes.
 */
export function supplyState(value: unknown): ISupplyState | undefined {
  return typeof value === 'object' && value !== null ? supplies.get(value) : undefined;
}

/** Whether a value can be called as an author subject function. */
function isSubjectCallback(value: unknown): value is ISubjectCallback {
  return typeof value === 'function';
}

/**
 * Read one own data option without running accessors. An accessor or an
 * inherited option is an unsupported shape for that option.
 */
function ownOption(options: unknown, key: string, code: DefinitionError['code']): unknown {
  if (typeof options !== 'object' || options === null) {
    return reject(code, 'Options must be a record.');
  }
  const descriptor = Object.getOwnPropertyDescriptor(options, key);
  if (descriptor === undefined) {
    return key in options ? reject(code, `Option ${key} must be an own property, not inherited.`) : undefined;
  }
  return 'value' in descriptor ? descriptor.value : reject(code, `Option ${key} must be a data property, not an accessor.`);
}

/**
 * Declare a step slot token. Only its slot name exists at runtime.
 * @param options - The author's slot name.
 * @returns A frozen Definition-minted token.
 */
export function declareStepSlot<TFamily extends IBindingFamily, TParameters extends readonly unknown[], TResult>(
  options: IStepSlotOptions,
): IStepSlot<TFamily, TParameters, TResult> {
  const slot = ownOption(options, 'slot', 'invalid-descriptor');
  if (typeof slot !== 'string' || slot.length === 0) {
    return reject('invalid-descriptor', 'A step slot name must be a nonempty string.');
  }
  const token = Object.freeze({ kind: 'step-slot' as const, slot });
  slotTokens.set(token, slot);
  // The brand and signature are type-level only; this module is their sole minting authority.
  return token as IStepSlot<TFamily, TParameters, TResult>;
}

/**
 * Narrow the captured `run` option to the callback type the author declared it
 * under. Runtime can only prove it is a function; its parameter and result
 * types are the author's own declaration, exactly as when read from `options`.
 */
function isRunOf<TContext, TResult>(value: unknown): value is (context: TContext) => TResult {
  return typeof value === 'function';
}

/** Whether argument views are a frozen array, so the author context cannot be altered afterwards. */
function isFrozenArray(value: unknown): boolean {
  return Array.isArray(value) && Object.isFrozen(value);
}

/**
 * Declare a supplied step implementation in one builder instance without
 * invoking any callback. It has no subject, children or finality hook.
 * @param records - The builder instance's records.
 * @param options - The author's version, label and callback.
 * @returns A frozen Definition-owned declaration.
 */
export function declareSuppliedStep<TFamily extends IBindingFamily, TParameters extends readonly unknown[], TResult>(
  records: IDeclarationRecords<TFamily>,
  options: ISuppliedStepOptions<TFamily, TParameters, TResult>,
): ISuppliedStepDeclaration<TFamily, TParameters, TResult> {
  const read = readOptions(options);
  if (read.has('subject')) {
    reject('invalid-subject', 'A supplied step has no subject of its own; each call\'s subject comes from its slot binding.');
  }
  if (read.has('children')) {
    reject('illegal-edge', 'A supplied step declares no children.');
  }
  if (read.has('finality')) {
    reject('invalid-callback', 'A supplied step declares no finality hook.');
  }
  checkCallback(read, 'run', true);
  const version = versionOption(read);
  const label = labelOption(read);
  // Use the one captured value that was validated; re-reading `options` could
  // observe a different value (for example through a proxy) than was checked.
  const run = read.get('run');
  if (!isRunOf<ISuppliedStepRunContext<TFamily, TParameters>, TResult>(run)) {
    return reject('invalid-callback', 'Declaration option run must be a function.');
  }
  const declaration = mint<ISuppliedStepDeclaration<TFamily, TParameters, TResult>>({ kind: 'supplied-step', version, label, run });
  const record: ISuppliedStepRecord<TFamily> = {
    kind: 'supplied-step',
    declaration,
    apply<TOutcome>(bindings: TFamily['memo'], args: IArgumentSupplier<TFamily>, invoke: IAuthorInvoker<TOutcome>): TOutcome {
      checkBindings(bindings, 'args');
      const views = args.views(declaration);
      if (!isFrozenArray(views)) {
        reject('invalid-bindings', 'Argument views must be a frozen array with one view per argument position.');
      }
      const context: ISuppliedStepRunContext<TFamily, TParameters> = { ...bindings, args: views };
      Object.freeze(context);
      return invoke(run, context);
    },
  };
  records.set(declaration, record);
  return declaration;
}

/**
 * Bind a supplied step and its subject function to a slot. Binding validates
 * ownership and shape only; it never invokes the implementation or the subject.
 * @param records - The builder instance's records.
 * @param options - The slot, implementation and subject function.
 * @returns A frozen Definition-minted registration for `compose`.
 */
export function declareSupply<TFamily extends IBindingFamily, TParameters extends readonly unknown[], TResult>(
  records: IDeclarationRecords<TFamily>,
  options: ISupplyOptions<TFamily, TParameters, TResult>,
): ISuppliedStepRegistration<TFamily> {
  const slot = stepSlotName(ownOption(options, 'slot', 'forged-declaration'));
  if (slot === undefined) {
    return reject('forged-declaration', 'A supply names a step slot token Definition did not mint.');
  }
  const candidate = ownOption(options, 'declaration', 'forged-declaration');
  const record = typeof candidate === 'object' && candidate !== null ? records.get(candidate) : undefined;
  if (record?.kind !== 'supplied-step') {
    return reject('forged-declaration', `The implementation supplied to ${slot} is not a supplied step this family minted.`);
  }
  const subject = ownOption(options, 'subject', 'invalid-subject');
  if (!isSubjectCallback(subject)) {
    return reject('invalid-subject', `The subject of slot ${slot} must be a function over the call's derived values.`);
  }
  const registration = Object.freeze({ slot, declaration: record.declaration });
  supplies.set(registration, Object.freeze({ slot, declaration: record.declaration, subject }));
  // The brand is type-level only; this module is its sole minting authority.
  return registration as ISuppliedStepRegistration<TFamily>;
}

/**
 * The derived values of one call's recipes by position, each a frozen copy
 * decoded from its canonical encoding. Forwarded and unreconstructible
 * positions are holes (never `undefined`), and the empty form yields an empty
 * list. Definition owns the recipe encoding, so this is the one place a
 * recorded derived value is decoded: slot subjects use it, and Resolution uses
 * it to rebuild a call's arguments without running the parent. Whether a
 * value is justified remains Resolution's judgment.
 * @param arguments_ - The call's argument recipes.
 * @returns A frozen sparse list of derived values.
 * @alpha
 */
export function derivedArguments(arguments_: IInvocationArguments): readonly unknown[] {
  const derived: unknown[] = [];
  if (!('form' in arguments_)) {
    derived.length = arguments_.length;
    arguments_.forEach((recipe, position) => {
      if (recipe.form === 'derived') {
        derived[position] = decodeDerived(recipe.value, position);
      }
    });
  }
  return Object.freeze(derived);
}

/**
 * The scoped history subject of one slot call: the bound subject function
 * applied to the call's derived values by position (see
 * {@link derivedArguments}). Forwarded and unreconstructible positions are
 * holes, so neither can influence the subject; nothing about the supplied
 * implementation is consulted.
 * @param scope - The analysis scope that qualifies the subject.
 * @param subject - The slot binding's author subject function.
 * @param arguments_ - The call's argument recipes.
 * @returns The complete scoped subject.
 */
export function slotSubject(scope: string, subject: ISubjectCallback, arguments_: IInvocationArguments): IScopedSubject {
  const derived = derivedArguments(arguments_);
  let computed: unknown;
  try {
    computed = Reflect.apply(subject, undefined, [derived]);
  } catch (error: unknown) {
    return reject('invalid-subject', `The slot subject function failed: ${describe(error)}`);
  }
  if (typeof computed !== 'string' || computed.length === 0) {
    return reject('invalid-subject', 'A slot subject function must return a complete nonempty subject string.');
  }
  return Object.freeze({ scope, subject: computed });
}

/** Decode one derived value's canonical encoding into a frozen copy. */
function decodeDerived(encoded: string, position: number): unknown {
  try {
    return decodeSnapshot(encoded);
  } catch (error: unknown) {
    return reject('invalid-argument', `Derived argument ${String(position)} is not canonical MDS1 data: ${describe(error)}`);
  }
}

/** A readable diagnostic from any thrown value, computed without running author code or throwing. */
function describe(error: unknown): string {
  return thrownDetail(error);
}
