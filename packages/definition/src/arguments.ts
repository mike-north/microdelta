/**
 * Runtime arguments of declared calls and the `forward` origins that name
 * current bindings.
 *
 * An argument-bearing call records one recipe per argument (the EXP-4 argument
 * recipe, CMP-7). A Definition-minted `forward` token records a structural
 * origin (an input path, the member binding, or an earlier child call of the
 * same invocation plus a path) that Resolution resolves again from current
 * bindings. Any other supported plain data is a derived value retained as its
 * canonical MDS1 encoding. A value that is not supported plain data (a
 * function, symbol, accessor-bearing record and so on) is recorded as
 * unreconstructible, never rejected; the child can never observe it. A raw
 * tracked view is a live observation of a current binding and must be passed
 * through `forward`; passing one directly is rejected before dispatch, because
 * retaining its value would silently turn a tracked binding into untracked data.
 */
import { encodeSnapshot } from '@microdelta/value';

import { reject } from './declaration.js';
import type { IChildResult, IInvocationScope } from './invocation.js';
import type { IArgumentPathSegment, IArgumentRecipe, IForwardOrigin, IInvocationArguments, IUnreconstructibleReason } from './witness.js';

/**
 * Nominal brand for Definition-minted forward tokens.
 * @alpha
 */
export interface IForwardedBrand {
  /** Type-level nominal marker; absent at runtime. */
  readonly __microdeltaForwarded: unique symbol;
}

/**
 * A forwarded argument: a structural origin in the calling invocation whose
 * current value the child receives. `T` is the value type the author asserts
 * the origin holds, written explicitly or taken from the parameter the token
 * fills. Definition cannot check it against the runtime value; it is an author
 * statement, not a verified inference.
 * @alpha
 */
export interface IForwarded<T = unknown> extends IForwardedBrand {
  /** The structural origin recorded in the witness. */
  readonly origin: IForwardOrigin;
  /** Type-level value marker only; absent at runtime. */
  readonly __microdeltaForwardedValue?: T;
}

/**
 * One author path segment into a forwarded binding: a string is a property key
 * and a non-negative safe integer is an array index.
 * @alpha
 */
export type IPathInput = readonly (string | number)[];

/**
 * Minting of forwarded argument origins.
 * @alpha
 */
export interface IForward {
  /** Forward a path within a declared composition input slot. */
  input<T = unknown>(slot: string, path?: IPathInput): IForwarded<T>;
  /** Forward a path within the calling step's member binding; only a template instance has one. */
  member<T = unknown>(path?: IPathInput): IForwarded<T>;
  /** Forward a path within the output of an earlier declared call of the same invocation. */
  child<T = unknown>(result: IChildResult<unknown>, path?: IPathInput): IForwarded<T>;
}

/**
 * One argument position of an argument-bearing handle: plain data (derived) or
 * a forwarded origin of the same declared type.
 * @alpha
 */
export type IHandleArgument<T> = T | IForwarded<T>;

/**
 * The runtime arguments of a handle whose slot declares `TParameters`.
 * @alpha
 */
export type IHandleArguments<TParameters extends readonly unknown[]> = {
  readonly [K in keyof TParameters]: IHandleArgument<TParameters[K]>;
};

/** A forward token's origin, and for a child origin the invocation whose call produced it. */
interface IForwardState {
  readonly origin: IForwardOrigin;
  readonly scope: IInvocationScope | undefined;
}

/** Definition-minted forward tokens; look-alikes are absent and become ordinary data. */
const forwardTokens = new WeakMap<object, IForwardState>();

/** Genuine child-result carriers: the invocation and call position that produced each. */
const carriers = new WeakMap<object, { readonly scope: IInvocationScope; readonly index: number }>();

/**
 * Remember which call of which invocation produced a child-result carrier, so
 * `forward.child` can name that call by position.
 */
export function registerCarrier(carrier: object, scope: IInvocationScope, index: number): void {
  carriers.set(carrier, { scope, index });
}

/** Normalize an author path into structured segments, reading only own data elements. */
function pathOf(path: unknown): readonly IArgumentPathSegment[] {
  if (path === undefined) {
    return Object.freeze([]);
  }
  if (!Array.isArray(path)) {
    return reject('invalid-argument', 'A forward path must be an array of property keys and array indexes.');
  }
  const segments: IArgumentPathSegment[] = [];
  for (let position = 0; position < path.length; position++) {
    const descriptor = Object.getOwnPropertyDescriptor(path, String(position));
    const value: unknown = descriptor !== undefined && 'value' in descriptor ? descriptor.value : undefined;
    if (typeof value === 'string') {
      segments.push(Object.freeze({ kind: 'property', key: value }));
    } else if (typeof value === 'number' && Number.isSafeInteger(value) && value >= 0) {
      segments.push(Object.freeze({ kind: 'index', index: value }));
    } else {
      reject('invalid-argument', `Forward path segment ${String(position)} must be a string key or a non-negative safe integer index.`);
    }
  }
  return Object.freeze(segments);
}

/** Mint a frozen forward token. */
function token<T>(origin: IForwardOrigin, scope: IInvocationScope | undefined): IForwarded<T> {
  const minted = Object.freeze({ origin: Object.freeze(origin) });
  forwardTokens.set(minted, { origin: minted.origin, scope });
  // The brand and value marker are type-level only; this module is their sole minting authority.
  return minted as IForwarded<T>;
}

/**
 * Forwarded origin minting. Origins are validated for shape when minted and
 * for membership in the calling invocation when a handle records them.
 * @alpha
 */
export const forward: IForward = Object.freeze({
  input<T = unknown>(slot: string, path?: IPathInput): IForwarded<T> {
    if (typeof slot !== 'string' || slot.length === 0) {
      reject('invalid-argument', 'forward.input needs a nonempty input slot name.');
    }
    return token<T>({ binding: 'input', slot, path: pathOf(path) }, undefined);
  },
  member<T = unknown>(path?: IPathInput): IForwarded<T> {
    return token<T>({ binding: 'member', path: pathOf(path) }, undefined);
  },
  child<T = unknown>(result: IChildResult<unknown>, path?: IPathInput): IForwarded<T> {
    const produced = typeof result === 'object' && result !== null ? carriers.get(result) : undefined;
    if (produced === undefined) {
      reject('invalid-argument', 'forward.child needs the result object a declared call returned, not a copy or look-alike.');
    }
    return token<T>({ binding: 'child', call: produced.index, path: pathOf(path) }, produced.scope);
  },
});

/** What recording needs to know about the calling invocation; supplied by the handle. */
export interface IArgumentContext {
  /** The calling invocation. */
  readonly scope: IInvocationScope;
  /**
   * Whether the calling step has a member binding to forward from. Only a
   * template instance has one; explicit members and composition-level steps
   * do not.
   */
  readonly memberBinding: boolean;
  /** Whether an input slot is declared by the composition. */
  inputDeclared(slot: string): boolean;
  /** The port's tracked-view recognizer. */
  isTrackedView(value: unknown): boolean;
  /** The port's justification for derived arguments made now. */
  justified(): boolean;
}

/** The diagnostic for a raw tracked view, pointing authors to `forward`. */
const trackedViewDiagnostic =
  'A tracked view cannot be passed as a call argument; pass its origin with forward.input, forward.member or forward.child so the child observes the current binding.';

/** Prototypes that end a supported plain-data prototype walk. */
const intrinsicPrototypes: ReadonlySet<object> = new Set([Object.prototype, Array.prototype, Function.prototype]);

/**
 * Whether a tracked view is reachable through a value's prototype chain. Each
 * prototype is checked before its own prototype is read, so a tracked view's
 * traps never run.
 */
function inheritsTrackedView(value: object, isTrackedView: (value: unknown) => boolean): boolean {
  for (let prototype = Reflect.getPrototypeOf(value); prototype !== null && !intrinsicPrototypes.has(prototype); prototype = Reflect.getPrototypeOf(prototype)) {
    if (isTrackedView(prototype)) {
      return true;
    }
  }
  return false;
}

/**
 * Find a raw tracked view (directly, nested, or through a prototype chain) or a
 * nested forward token inside an argument without reading through either.
 * Only own data properties are traversed; accessors are left for Value's
 * encoder to reject without invoking them.
 */
function containsLiveValue(value: unknown, isTrackedView: (value: unknown) => boolean, seen: Set<object>): 'tracked' | 'forward' | undefined {
  if ((typeof value !== 'object' && typeof value !== 'function') || value === null || seen.has(value)) {
    return undefined;
  }
  if (isTrackedView(value)) {
    return 'tracked';
  }
  if (forwardTokens.has(value)) {
    return 'forward';
  }
  seen.add(value);
  if (inheritsTrackedView(value, isTrackedView)) {
    return 'tracked';
  }
  if (typeof value === 'function') {
    return undefined;
  }
  for (const key of Reflect.ownKeys(value)) {
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (descriptor !== undefined && 'value' in descriptor) {
      const found = containsLiveValue(descriptor.value, isTrackedView, seen);
      if (found !== undefined) {
        return found;
      }
    }
  }
  return undefined;
}

/**
 * Validate a forward token's origin against the calling invocation. Member
 * origins require a template instance's member binding; no parent recorded
 * here has one, so they are rejected before any call position is consumed.
 */
function forwardedRecipe(state: IForwardState, context: IArgumentContext, position: number): IArgumentRecipe {
  const { origin } = state;
  switch (origin.binding) {
    case 'input':
      if (!context.inputDeclared(origin.slot)) {
        reject('invalid-argument', `Argument ${String(position)} forwards input ${origin.slot}, which this composition does not declare.`);
      }
      break;
    case 'member':
      if (!context.memberBinding) {
        reject('invalid-argument', `Argument ${String(position)} forwards the member binding, but member origins require a template instance; explicit members and composition-level steps have no member binding.`);
      }
      break;
    case 'child':
      if (state.scope !== context.scope) {
        reject('invalid-argument', `Argument ${String(position)} forwards a result from another invocation; only earlier calls of the same invocation can be forwarded.`);
      }
      break;
    default: {
      const exhaustive: never = origin;
      return exhaustive;
    }
  }
  return Object.freeze({ form: 'forwarded', origin });
}

/**
 * The stable reason an argument is not supported plain data: the first
 * function, symbol, bigint or accessor found walking own properties, otherwise
 * `unsupported-value` (for example a class instance, cycle or non-plain object).
 */
function unreconstructibleReason(value: unknown, seen: Set<object>): IUnreconstructibleReason | undefined {
  switch (typeof value) {
    case 'function':
      return 'function';
    case 'symbol':
      return 'symbol';
    case 'bigint':
      return 'bigint';
    case 'object':
      break;
    default:
      return undefined;
  }
  if (value === null || seen.has(value)) {
    return undefined;
  }
  seen.add(value);
  for (const key of Reflect.ownKeys(value)) {
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (descriptor === undefined) {
      continue;
    }
    const found = 'value' in descriptor ? unreconstructibleReason(descriptor.value, seen) : 'accessor';
    if (found !== undefined) {
      return found;
    }
  }
  return undefined;
}

/** One argument after classification: a validated forwarded recipe, or plain data still to encode. */
type IClassified = { readonly recipe: IArgumentRecipe } | { readonly value: unknown };

/**
 * Record one call's runtime arguments as recipes, or reject before dispatch.
 * A first pass classifies every argument and validates every forwarded origin,
 * so a rejection never follows any encoding or any justification query; only
 * then are plain values encoded.
 * @param values - The call's runtime arguments, in position order.
 * @param context - The calling invocation's recording context.
 * @returns The empty form for no arguments, otherwise one recipe per position.
 */
export function recordArguments(values: readonly unknown[], context: IArgumentContext): IInvocationArguments {
  const classified = values.map((value, position): IClassified => {
    const state = typeof value === 'object' && value !== null ? forwardTokens.get(value) : undefined;
    if (state !== undefined) {
      return { recipe: forwardedRecipe(state, context, position) };
    }
    const live = containsLiveValue(value, context.isTrackedView, new Set());
    if (live === 'tracked') {
      reject('invalid-argument', `Argument ${String(position)}: ${trackedViewDiagnostic}`);
    }
    if (live === 'forward') {
      reject('invalid-argument', `Argument ${String(position)} nests a forward origin inside data; pass forwarded origins as whole arguments.`);
    }
    return { value };
  });
  let justified: boolean | undefined;
  const recipes = classified.map((entry): IArgumentRecipe => {
    if ('recipe' in entry) {
      return entry.recipe;
    }
    let encoded: string;
    try {
      encoded = encodeSnapshot(entry.value);
    } catch {
      return Object.freeze({ form: 'unreconstructible', reason: unreconstructibleReason(entry.value, new Set()) ?? 'unsupported-value' });
    }
    justified ??= context.justified() === true;
    return Object.freeze({ form: 'derived', value: encoded, justified });
  });
  const [first, ...rest] = recipes;
  const list: readonly [IArgumentRecipe, ...IArgumentRecipe[]] | undefined = first === undefined ? undefined : [first, ...rest];
  return list === undefined ? Object.freeze({ form: 'empty' }) : Object.freeze(list);
}
