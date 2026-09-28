/**
 * Source and memoized step declarations, and the Definition-owned records that
 * retain their typed invocation closures.
 *
 * A declaration describes work that may be invoked: its complete opaque author
 * subject, compatibility version, the actual author callbacks and, for memoized
 * work, the sibling source declarations it may call. Declaring never invokes a
 * callback. Author callback contexts are computed from a facade-supplied
 * binding family, so Definition never imports Tracking (ARC-003).
 *
 * Owners that reconnect a step by descriptor see only its erased declaration.
 * The precise callback types survive in the step's record: closures created
 * while the author's types were known, which pair the actual callback with the
 * context Definition assembles and hand both to a Resolution-owned rank-2
 * invoker. Definition assembles contexts mechanically; it never selects
 * previous results, evaluates policy, captures observations or executes a body.
 */
import { DefinitionError } from './errors.js';
import type { IApply, IBindingFamily } from './family.js';
import type {
  IChildResult,
  IDeclaredCallHandle,
  IDeclaredInvocationRequest,
  IDirectChildWitness,
  IInvocationPort,
  IInvocationScope,
} from './invocation.js';

/**
 * Nominal brand for Definition-minted declarations, with an invariant family
 * marker so a declaration of one family cannot enter another's composition.
 * Neither property exists at runtime; ownership is proven by Definition's registry.
 * @alpha
 */
export interface IDeclarationBrand<TFamily extends IBindingFamily> {
  readonly __microdeltaDeclaration: unique symbol;
  readonly __microdeltaFamily?: (family: TFamily) => TFamily;
}

/**
 * Author context for a source `run`: the facade's source bindings plus the
 * eligible previous-result carrier Resolution selected, or `undefined`.
 * @alpha
 */
export type ISourceRunContext<TFamily extends IBindingFamily, TResult> = TFamily['source'] & {
  readonly previous: IApply<TFamily['previous'], TResult> | undefined;
};

/**
 * Author context for a source `finality` hook, which is only evaluated for an
 * eligible previous result and therefore always receives its carrier.
 * @alpha
 */
export type IFinalityContext<TFamily extends IBindingFamily, TResult> = TFamily['source'] & {
  readonly previous: IApply<TFamily['previous'], TResult>;
};

/**
 * A source declaration with its result type erased: identity, subject, version
 * and the actual callbacks, whose contexts owners cannot construct.
 * @alpha
 */
export interface IAnySourceDeclaration<TFamily extends IBindingFamily> extends IDeclarationBrand<TFamily> {
  readonly kind: 'source';
  /** Complete opaque author subject, retained exactly. */
  readonly subject: string;
  /** Positive safe-integer compatibility group. */
  readonly version: number;
  /** Display metadata only. */
  readonly label: string | undefined;
  /** The author's actual check/retrieval callback. */
  readonly run: (context: never) => unknown;
  /** The author's actual finality hook, when declared. */
  readonly finality: ((context: never) => unknown) | undefined;
}

/**
 * A source declaration carrying its declared result type.
 * @alpha
 */
export interface ISourceDeclaration<TFamily extends IBindingFamily, TResult> extends IAnySourceDeclaration<TFamily> {
  readonly run: (context: ISourceRunContext<TFamily, TResult>) => IApply<TFamily['outcomes'], TResult>;
  readonly finality: ((context: IFinalityContext<TFamily, TResult>) => unknown) | undefined;
}

/**
 * The result type a source declaration of this family produces.
 * @alpha
 */
export type IResultOf<TFamily extends IBindingFamily, TDeclaration> =
  TDeclaration extends ISourceDeclaration<TFamily, infer TResult> ? TResult : never;

/**
 * A memo's children: each key is a sibling slot name (the structural edge) and
 * each value is the source declaration that slot must hold (the typed link).
 * @alpha
 */
export type IChildDeclarations<TFamily extends IBindingFamily> = { readonly [slot: string]: IAnySourceDeclaration<TFamily> };

/**
 * Declared handles, typed by each child's selected view.
 * @alpha
 */
export type ICalls<TFamily extends IBindingFamily, TChildren extends IChildDeclarations<TFamily>> = {
  readonly [K in keyof TChildren]: IDeclaredCallHandle<IApply<TFamily['views'], IResultOf<TFamily, TChildren[K]>>>;
};

/**
 * Author context for a memo `run`: the facade's memo bindings plus Definition's declared calls.
 * @alpha
 */
export type IMemoRunContext<TFamily extends IBindingFamily, TChildren extends IChildDeclarations<TFamily>> = TFamily['memo'] & {
  readonly calls: ICalls<TFamily, TChildren>;
};

/**
 * A memo declaration with its child and result types erased.
 * @alpha
 */
export interface IAnyMemoDeclaration<TFamily extends IBindingFamily> extends IDeclarationBrand<TFamily> {
  readonly kind: 'memo';
  /** Complete opaque author subject, retained exactly. */
  readonly subject: string;
  /** Positive safe-integer compatibility group. */
  readonly version: number;
  /** Display metadata only. */
  readonly label: string | undefined;
  /** Frozen sibling slot names this computation may call. */
  readonly children: readonly string[];
  /** The author's actual computation callback. */
  readonly run: (context: never) => unknown;
}

/**
 * A memo declaration carrying its typed children and result type.
 * @alpha
 */
export interface IMemoDeclaration<TFamily extends IBindingFamily, TChildren extends IChildDeclarations<TFamily>, TResult>
  extends IAnyMemoDeclaration<TFamily> {
  readonly run: (context: IMemoRunContext<TFamily, TChildren>) => TResult;
}

/**
 * Any step declaration of one family.
 * @alpha
 */
export type IStepDeclaration<TFamily extends IBindingFamily> = IAnySourceDeclaration<TFamily> | IAnyMemoDeclaration<TFamily>;

/**
 * Author options for a retained source.
 * @alpha
 */
export interface ISourceOptions<TFamily extends IBindingFamily, TResult> {
  /** Complete opaque author identity of this work's history, unique within its analysis scope. */
  readonly subject: string;
  /** Compatibility group; a positive safe integer, default 1. */
  readonly version?: number;
  /** Display metadata only; never identity or correspondence. */
  readonly label?: string;
  /** The author's check/retrieval callback. */
  readonly run: (context: ISourceRunContext<TFamily, TResult>) => IApply<TFamily['outcomes'], TResult>;
  /** The author's optional current finality hook. */
  readonly finality?: (context: IFinalityContext<TFamily, TResult>) => unknown;
}

/**
 * Author options for a memoized computation.
 * @alpha
 */
export interface IMemoOptions<TFamily extends IBindingFamily, TChildren extends IChildDeclarations<TFamily>, TResult> {
  /** Complete opaque author identity of this work's history, unique within its analysis scope. */
  readonly subject: string;
  /** Compatibility group; a positive safe integer, default 1. */
  readonly version?: number;
  /** Display metadata only; never identity or correspondence. */
  readonly label?: string;
  /** Each sibling slot name mapped to the source declaration occupying it. */
  readonly children?: TChildren;
  /** The author's computation callback. */
  readonly run: (context: IMemoRunContext<TFamily, TChildren>) => TResult;
}

/**
 * Resolution's rank-2 invoker. Definition hands it the actual author callback
 * and the context assembled for it; both types are opaque to the invoker, so
 * it can wrap the call (tracking, capture, admission) but cannot invent or
 * substitute the context.
 * @alpha
 */
export interface IAuthorInvoker<TOutcome> {
  <TContext, TResult>(callback: (context: TContext) => TResult, context: TContext): TOutcome;
}

/**
 * Resolution's supplier of the eligible previous-result carrier for a source.
 * Resolution selects the eligible result and keeps its exact target; Definition
 * only passes the returned carrier to the author callback.
 * @alpha
 */
export interface IPreviousSupplier<TFamily extends IBindingFamily> {
  /** The immutable carrier for this source declaration's selected previous result. */
  carrier<TResult>(declaration: ISourceDeclaration<TFamily, TResult>): IApply<TFamily['previous'], TResult>;
}

/** A source step's record: its erased declaration and typed invocation closures. */
export interface ISourceRecord<TFamily extends IBindingFamily> {
  readonly kind: 'source';
  readonly declaration: IAnySourceDeclaration<TFamily>;
  /** Pair the actual `run` with its assembled context and hand both to the invoker. */
  apply<TOutcome>(bindings: TFamily['source'], previous: IPreviousSupplier<TFamily> | undefined, invoke: IAuthorInvoker<TOutcome>): TOutcome;
  /** Pair the actual `finality` with its assembled context; absent hooks reject. */
  applyFinality<TOutcome>(bindings: TFamily['source'], previous: IPreviousSupplier<TFamily>, invoke: IAuthorInvoker<TOutcome>): TOutcome;
  /** Dispatch a call of this source as a declared child, typed by its result. */
  dispatch(port: IInvocationPort<TFamily>, scope: IInvocationScope, witness: IDirectChildWitness): Promise<IChildResult<unknown>>;
}

/** A memo step's record: its erased declaration, pinned children and typed invocation closure. */
export interface IMemoRecord<TFamily extends IBindingFamily> {
  readonly kind: 'memo';
  readonly declaration: IAnyMemoDeclaration<TFamily>;
  /** Each sibling slot mapped to the exact source declaration pinned for it. */
  readonly children: ReadonlyMap<string, IAnySourceDeclaration<TFamily>>;
  /** Pair the actual `run` with bindings plus minted calls and hand both to the invoker. */
  apply<TOutcome>(bindings: TFamily['memo'], mint: (slot: string) => IDeclaredCallHandle<unknown>, invoke: IAuthorInvoker<TOutcome>): TOutcome;
}

/** Any step record. */
export type IStepRecord<TFamily extends IBindingFamily> = ISourceRecord<TFamily> | IMemoRecord<TFamily>;

/** One builder instance's records, keyed by the declarations it minted. */
export type IDeclarationRecords<TFamily extends IBindingFamily> = WeakMap<object, IStepRecord<TFamily>>;

/** Every Definition-minted declaration, across builder instances. */
const minted = new WeakSet<object>();

/** Freeze a constructed declaration and attach its type-level brand. */
function mint<TDeclaration extends object>(value: Omit<TDeclaration, keyof IDeclarationBrand<IBindingFamily>>): TDeclaration {
  Object.freeze(value);
  minted.add(value);
  // The brand is type-level only; this module is its sole minting authority.
  return value as TDeclaration;
}

/**
 * Declare a retained source in one builder instance without invoking any callback.
 * @param records - The builder instance's records.
 * @param options - The author's subject, version, callbacks and label.
 * @returns A frozen Definition-owned declaration.
 */
export function declareSource<TFamily extends IBindingFamily, TResult>(
  records: IDeclarationRecords<TFamily>,
  options: ISourceOptions<TFamily, TResult>,
): ISourceDeclaration<TFamily, TResult> {
  const read = readOptions(options);
  if (read.has('children')) {
    reject('illegal-edge', 'Sources declare no child edges in M3.');
  }
  checkCallback(read, 'run', true);
  checkCallback(read, 'finality', false);
  // Both were just proven to be own data properties holding functions, or an
  // absent finality with no inherited property either, so reading them runs no
  // author code and adopts nothing unvalidated.
  const { run, finality } = options;
  const declaration = mint<ISourceDeclaration<TFamily, TResult>>({
    kind: 'source',
    subject: subjectOption(read),
    version: versionOption(read),
    label: labelOption(read),
    run,
    finality,
  });
  const record: ISourceRecord<TFamily> = {
    kind: 'source',
    declaration,
    apply<TOutcome>(bindings: TFamily['source'], previous: IPreviousSupplier<TFamily> | undefined, invoke: IAuthorInvoker<TOutcome>): TOutcome {
      checkBindings(bindings, 'previous');
      const carrier = previous === undefined ? undefined : checkCarrier(previous.carrier(declaration));
      const context: ISourceRunContext<TFamily, TResult> = { ...bindings, previous: carrier };
      Object.freeze(context);
      return invoke(run, context);
    },
    applyFinality<TOutcome>(bindings: TFamily['source'], previous: IPreviousSupplier<TFamily>, invoke: IAuthorInvoker<TOutcome>): TOutcome {
      if (finality === undefined) {
        reject('invalid-callback', `Source ${declaration.subject} declares no finality hook.`);
      }
      checkBindings(bindings, 'previous');
      const context: IFinalityContext<TFamily, TResult> = { ...bindings, previous: checkCarrier(previous.carrier(declaration)) };
      Object.freeze(context);
      return invoke(finality, context);
    },
    dispatch(port: IInvocationPort<TFamily>, scope: IInvocationScope, witness: IDirectChildWitness): Promise<IChildResult<unknown>> {
      const request: IDeclaredInvocationRequest<TFamily, TResult> = { scope, witness, child: declaration };
      Object.freeze(request);
      return port.dispatch(request);
    },
  };
  records.set(declaration, record);
  return declaration;
}

/**
 * Declare a memoized computation and its typed children in one builder instance
 * without invoking any callback.
 * @param records - The builder instance's records.
 * @param options - The author's subject, version, children, callback and label.
 * @returns A frozen Definition-owned declaration.
 */
export function declareMemo<TFamily extends IBindingFamily, TChildren extends IChildDeclarations<TFamily>, TResult>(
  records: IDeclarationRecords<TFamily>,
  options: IMemoOptions<TFamily, TChildren, TResult>,
): IMemoDeclaration<TFamily, TChildren, TResult> {
  const read = readOptions(options);
  checkCallback(read, 'run', true);
  const subject = subjectOption(read);
  const version = versionOption(read);
  const label = labelOption(read);
  checkChildRecord(read);
  // `run` and `children` were just proven to be own data properties of the
  // expected shape (or children absent without an inherited property), so
  // reading them runs no author code and adopts no unvalidated edge.
  const { run, children } = options;
  const entries: [string, IAnySourceDeclaration<TFamily>][] = children === undefined ? [] : Object.entries(children);
  for (const [slot, child] of entries) {
    if (slot === '') {
      reject('illegal-edge', 'A child slot name must be nonempty.');
    }
    const childRecord = records.get(child);
    if (childRecord === undefined) {
      reject('forged-declaration', `Child ${slot} is not a declaration this family minted.`);
    }
    if (childRecord.kind !== 'source') {
      reject('illegal-edge', `Child ${slot} must be a source declaration.`);
    }
  }
  const slots = Object.freeze(entries.map(([slot]) => slot));
  const declaration = mint<IMemoDeclaration<TFamily, TChildren, TResult>>({
    kind: 'memo',
    subject,
    version,
    label,
    children: slots,
    run,
  });
  const record: IMemoRecord<TFamily> = {
    kind: 'memo',
    declaration,
    children: new Map(entries),
    apply<TOutcome>(bindings: TFamily['memo'], mintHandle: (slot: string) => IDeclaredCallHandle<unknown>, invoke: IAuthorInvoker<TOutcome>): TOutcome {
      checkBindings(bindings, 'calls');
      // A null prototype makes every nonempty slot name, including `__proto__`,
      // an own data entry rather than a write to an inherited accessor.
      const calls: Record<string, IDeclaredCallHandle<unknown>> = Object.create(null) as Record<string, IDeclaredCallHandle<unknown>>;
      for (const slot of slots) {
        Object.defineProperty(calls, slot, { value: mintHandle(slot), enumerable: true, writable: false, configurable: false });
      }
      Object.freeze(calls);
      const present = Object.keys(calls).sort();
      const declared = [...slots].sort();
      if (present.length !== declared.length || present.some((slot, index) => slot !== declared[index])) {
        reject('illegal-edge', 'Minted calls must match the declared child slots exactly.');
      }
      // The one structural assertion: the keys were just verified to be exactly
      // the declared child slots, and each handle dispatches only its pinned
      // sibling, whose port contract yields the family view of that child.
      const typed = calls as ICalls<TFamily, TChildren>;
      const context: IMemoRunContext<TFamily, TChildren> = { ...bindings, calls: typed };
      Object.freeze(context);
      return invoke(run, context);
    },
  };
  records.set(declaration, record);
  return declaration;
}

/**
 * Whether a value is a declaration minted by Definition; structural look-alikes are not.
 * @param value - Any value.
 * @returns True only for Definition-minted declarations.
 * @alpha
 */
export function isDeclaration(value: unknown): boolean {
  return typeof value === 'object' && value !== null && minted.has(value);
}

/** Reject a construction error with its Definition code. */
export function reject(code: DefinitionError['code'], message: string): never {
  throw new DefinitionError(code, message);
}

/** An author options record's own data properties, read without invoking accessors. */
type IReadOptions = ReadonlyMap<string, unknown>;

/**
 * Read an author options record through its own property descriptors. An
 * accessor on a callback option is an unsupported callback form; on any other
 * option it is an invalid value for that option. Getters are never invoked.
 */
function readOptions(options: unknown): IReadOptions {
  if (typeof options !== 'object' || options === null) {
    reject('invalid-subject', 'Declaration options must be a record with a complete subject.');
  }
  const read = new Map<string, unknown>();
  for (const [key, descriptor] of Object.entries(Object.getOwnPropertyDescriptors(options))) {
    if (!('value' in descriptor)) {
      reject(optionErrorCode(key), `Declaration option ${key} must be a data property, not an accessor.`);
    }
    read.set(key, descriptor.value);
  }
  // Recognized options must be own properties. An inherited option would be
  // read by the typed property access that follows validation, running a
  // prototype getter or silently adopting a callback or edge nobody validated.
  // The `in` check inspects the prototype chain without invoking accessors.
  for (const key of declarationOptions) {
    if (!read.has(key) && key in options) {
      reject(optionErrorCode(key), `Declaration option ${key} must be an own property, not inherited.`);
    }
  }
  return read;
}

/** Every option a source or memo declaration recognizes. */
const declarationOptions = ['subject', 'version', 'label', 'run', 'finality', 'children'] as const;

/** The Definition error code for an unusable value of one declaration option. */
function optionErrorCode(key: string): DefinitionError['code'] {
  return key === 'run' || key === 'finality' ? 'invalid-callback'
    : key === 'version' ? 'invalid-version'
      : key === 'children' ? 'illegal-edge'
        : 'invalid-subject';
}

/** RES-001: a subject is a complete nonempty author string, retained exactly. */
function subjectOption(read: IReadOptions): string {
  const subject = read.get('subject');
  if (typeof subject !== 'string' || subject.length === 0) {
    reject('invalid-subject', 'A declaration requires a complete nonempty subject string.');
  }
  return subject;
}

/** REUSE-008: a positive safe integer compatibility group, defaulting to 1. */
function versionOption(read: IReadOptions): number {
  if (!read.has('version') || read.get('version') === undefined) {
    return 1;
  }
  const version = read.get('version');
  if (typeof version !== 'number' || !Number.isSafeInteger(version) || version < 1) {
    reject('invalid-version', 'A compatibility version must be a positive safe integer.');
  }
  return version;
}

/** Display labels are optional strings with no identity meaning. */
function labelOption(read: IReadOptions): string | undefined {
  const label = read.get('label');
  if (label !== undefined && typeof label !== 'string') {
    reject('invalid-subject', 'A display label must be a string when present.');
  }
  return label;
}

/** Callbacks are directly supplied functions; an optional callback may be absent. */
function checkCallback(read: IReadOptions, key: 'run' | 'finality', required: boolean): void {
  const value = read.get(key);
  if (value === undefined && !required) {
    return;
  }
  if (typeof value !== 'function') {
    reject('invalid-callback', `Declaration option ${key} must be a function.`);
  }
}

/**
 * Whether a value is a plain record whose every declared field survives the
 * collection Definition performs on it (`Object.entries` for memo children,
 * object spread for callback contexts): a non-array object with the ordinary or
 * a null prototype, string keys only, and only enumerable own data properties.
 * Anything else would lose declared meaning (hidden fields, prototype methods,
 * array length) or run author code, so it is rejected before affected work.
 * Inspecting descriptors never invokes accessors.
 */
function isPlainRecord(value: unknown): value is Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return false;
  }
  const prototype: unknown = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) {
    return false;
  }
  for (const key of Reflect.ownKeys(value)) {
    const descriptor = typeof key === 'string' ? Object.getOwnPropertyDescriptor(value, key) : undefined;
    if (descriptor === undefined || !('value' in descriptor) || descriptor.enumerable !== true) {
      return false;
    }
  }
  return true;
}

/** Memo children are a plain record, so every declared slot becomes an edge. */
function checkChildRecord(read: IReadOptions): void {
  const children = read.get('children');
  if (children !== undefined && !isPlainRecord(children)) {
    reject('illegal-edge', 'Memo children must be a plain record of enumerable sibling slot names to source declarations.');
  }
}

/**
 * Facade bindings must be a plain record, so every declared field reaches the
 * callback context, and must not claim the context name Definition supplies.
 * Field values are never read.
 */
function checkBindings(bindings: object, reserved: 'previous' | 'calls'): void {
  if (!isPlainRecord(bindings)) {
    reject('invalid-bindings', 'Bindings must be a plain record of enumerable own data fields.');
  }
  if (Object.hasOwn(bindings, reserved)) {
    reject('invalid-bindings', `Bindings cannot supply the reserved context name ${reserved}.`);
  }
}

/**
 * A supplied previous carrier must be an immutable record with an own `data`
 * data property. Its data is passed through unread; the exact eligible result
 * it stands for stays with Resolution.
 */
function checkCarrier<TCarrier>(carrier: TCarrier): TCarrier {
  if (typeof carrier !== 'object' || carrier === null || !Object.isFrozen(carrier)) {
    reject('invalid-previous', 'A previous-result carrier must be a frozen record.');
  }
  const data = Object.getOwnPropertyDescriptor(carrier, 'data');
  if (data === undefined || !('value' in data)) {
    reject('invalid-previous', 'A previous-result carrier must hold its result in an own data property.');
  }
  return carrier;
}
