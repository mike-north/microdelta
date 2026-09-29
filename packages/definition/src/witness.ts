/**
 * Versioned invocation witnesses: the durable, process-independent description
 * of one declared child call, and the parser that reads it back from untrusted
 * durable data.
 *
 * Version 1 is the M3 direct-child witness: an argument-free call of a sibling
 * source, with no call position. Version 2 is the nested invocation witness: it
 * adds the call's position in its parent invocation's call order and one
 * argument recipe per runtime argument, describing how that argument can be
 * reconstructed without running the parent (CMP-7, the EXP-4 argument recipe).
 * A witness names structural slots only (parent step, child step or supplied
 * step slot); it never names a supplied implementation, a display label, a
 * function, a subject, a hash or an ordinal outside the call order (CMP-6).
 *
 * Definition records witnesses and parses them; it does not decide whether a
 * recipe still justifies reuse. Resolution owns that judgment. Parsing never
 * guesses: unknown versions, unknown argument or recipe forms, and malformed
 * data are reported as unsupported with a precise reason (REUSE-007).
 */
import { decodeSnapshot } from '@microdelta/value';

import type { IBindingDescriptor } from './descriptor.js';

/**
 * The explicit argument-free form: a positive, checked statement that the
 * child receives no runtime arguments, not an absence of argument evidence.
 * @alpha
 */
export interface IEmptyArguments {
  readonly form: 'empty';
}

/**
 * One segment of a structured address inside a forwarded binding. A property
 * segment names a string key (including keys such as `"0"`); an index segment
 * names an array position. The two are distinct and never normalized into each
 * other.
 * @alpha
 */
export type IArgumentPathSegment =
  | { readonly kind: 'property'; readonly key: string }
  | { readonly kind: 'index'; readonly index: number };

/**
 * The structural origin of a forwarded argument in its calling invocation.
 * Each is resolved again from current bindings when evidence is validated; a
 * stored value is never substituted.
 *
 * - `input`: a path within a declared composition input slot.
 * - `member`: a path within the calling step's member binding.
 * - `child`: a path within the output of an earlier child call of the same
 *   parent invocation, named by that call's position in the call order.
 * @alpha
 */
export type IForwardOrigin =
  | { readonly binding: 'input'; readonly slot: string; readonly path: readonly IArgumentPathSegment[] }
  | { readonly binding: 'member'; readonly path: readonly IArgumentPathSegment[] }
  | { readonly binding: 'child'; readonly call: number; readonly path: readonly IArgumentPathSegment[] };

/**
 * An argument forwarded from a current binding, identified by its origin
 * rather than its value. `justified` is supplied by the caller from the parent
 * frame's observed untracked-read state at the moment of the call: a path
 * chosen after such a read is unjustified, exactly as a derived value is.
 * Definition carries it and never computes it.
 * @alpha
 */
export interface IForwardedRecipe {
  /** Discriminates the recipe form. */
  readonly form: 'forwarded';
  /** The structural origin, resolved again from current bindings. */
  readonly origin: IForwardOrigin;
  /** Whether the path was chosen with no observed untracked read earlier in the calling frame. */
  readonly justified: boolean;
}

/**
 * An argument derived by the parent body and retained as its canonical MDS1
 * snapshot encoding. `justified` is supplied by the caller from the parent
 * frame's observed untracked-read state at the moment of the call; Definition
 * carries it and never computes it.
 * @alpha
 */
export interface IDerivedRecipe {
  /** Discriminates the recipe form. */
  readonly form: 'derived';
  /** Canonical MDS1 encoding of the argument value. */
  readonly value: string;
  /** Whether the parent's recorded evidence can justify this value. */
  readonly justified: boolean;
}

/**
 * An argument that cannot be retained as supported data (for example a
 * function, a symbol or an accessor-bearing record). Only the reason is kept;
 * the child can never observe the value, and validation of the parent is
 * always an honest miss.
 * @alpha
 */
export interface IUnreconstructibleRecipe {
  /** Discriminates the recipe form. */
  readonly form: 'unreconstructible';
  /** Why no value was retained, from a closed vocabulary; for diagnostics only. */
  readonly reason: IUnreconstructibleReason;
}

/**
 * The closed, durable vocabulary of why an argument is unreconstructible. It
 * is evidence, so it never carries an encoder's message text.
 *
 * - `function`: the argument is, or contains, a function.
 * - `symbol`: the argument is, or contains, a symbol value.
 * - `bigint`: the argument is, or contains, a bigint.
 * - `accessor`: the argument contains an accessor property.
 * - `unsupported-value`: any other value outside supported plain data.
 * @alpha
 */
export type IUnreconstructibleReason = 'function' | 'symbol' | 'bigint' | 'accessor' | 'unsupported-value';

/** Every member of the unreconstructible-reason vocabulary. */
const unreconstructibleReasons: ReadonlySet<string> = new Set(['function', 'symbol', 'bigint', 'accessor', 'unsupported-value']);

/** Whether untrusted text is a known unreconstructible reason. */
export function isUnreconstructibleReason(value: unknown): value is IUnreconstructibleReason {
  return typeof value === 'string' && unreconstructibleReasons.has(value);
}

/**
 * How one runtime argument of a nested call can be supplied again.
 * @alpha
 */
export type IArgumentRecipe = IForwardedRecipe | IDerivedRecipe | IUnreconstructibleRecipe;

/**
 * The arguments of one call: the explicit empty form, or a non-empty ordered
 * recipe list with one recipe per argument position.
 * @alpha
 */
export type IInvocationArguments = IEmptyArguments | readonly [IArgumentRecipe, ...IArgumentRecipe[]];

/**
 * The M3 durable description of one direct child call: its structural parent
 * and child step slots and its argument form. Exact result references and
 * consumed outputs are added by Resolution, not Definition.
 * @alpha
 */
export interface IDirectChildWitness {
  /** The M3 witness version. */
  readonly version: 1;
  /** The calling step slot. */
  readonly parent: IBindingDescriptor;
  /** The called sibling step slot. */
  readonly child: IBindingDescriptor;
  /** Always the explicit empty form. */
  readonly arguments: IEmptyArguments;
}

/**
 * The versioned nested invocation witness: structural parent and child slots,
 * the call's zero-based position in its parent invocation's call order
 * (repeated calls to one slot each take their own position) and its argument
 * recipe. The child is a sibling step slot or a supplied step slot descriptor,
 * never the implementation bound to that slot.
 * @alpha
 */
export interface INestedInvocationWitness {
  /** The nested witness version. */
  readonly version: 2;
  /** The calling step slot. */
  readonly parent: IBindingDescriptor;
  /** The called sibling step slot or supplied step slot. */
  readonly child: IBindingDescriptor;
  /** Zero-based position of this call in the parent invocation's call order. */
  readonly index: number;
  /** The explicit empty form, or one recipe per argument position. */
  readonly arguments: IInvocationArguments;
}

/**
 * Any supported invocation witness version.
 * @alpha
 */
export type IInvocationWitness = IDirectChildWitness | INestedInvocationWitness;

/**
 * Why durable witness data is unsupported evidence.
 *
 * - `malformed`: required structure is absent or has the wrong type or range.
 * - `witness-version`: the version is not one Definition reads.
 * - `argument-form`: the argument form is unknown or not permitted for the version or edge.
 * - `recipe-form`: a recipe or forwarded origin has an unknown form.
 * @alpha
 */
export type IUnsupportedWitnessReason = 'malformed' | 'witness-version' | 'argument-form' | 'recipe-form';

/** The outcome of parsing untrusted witness data. */
export type IParsedWitness =
  | { readonly status: 'parsed'; readonly witness: IInvocationWitness }
  | { readonly status: 'unsupported'; readonly reason: IUnsupportedWitnessReason };

/** Parsing stops at the first unsupported field; the reason travels unchanged. */
class UnsupportedWitness extends Error {
  public readonly reason: IUnsupportedWitnessReason;

  public constructor(reason: IUnsupportedWitnessReason) {
    super(reason);
    this.reason = reason;
  }
}

/** Abandon parsing with one precise reason. */
function unsupported(reason: IUnsupportedWitnessReason): never {
  throw new UnsupportedWitness(reason);
}

/**
 * Read one own data property of untrusted input through its descriptor, so an
 * accessor or an inherited property never runs author code. Returns undefined
 * for a non-object, an absent own property or an accessor.
 */
export function ownData(value: unknown, key: string): unknown {
  if (typeof value !== 'object' || value === null) {
    return undefined;
  }
  const descriptor = Object.getOwnPropertyDescriptor(value, key);
  return descriptor !== undefined && 'value' in descriptor ? descriptor.value : undefined;
}

/**
 * Copy untrusted descriptor data into a frozen descriptor, or report it
 * malformed. Fields are read only as own data properties. A template step
 * carries both a nonempty template slot and a nonempty collection binding,
 * only in the step role, and its member key, when present, is nonempty; any
 * other combination of the template fields is malformed.
 */
export function copyDescriptor(value: unknown): IBindingDescriptor | undefined {
  if (typeof value !== 'object' || value === null) {
    return undefined;
  }
  for (const key of ['scope', 'role', 'slot', 'memberKey', 'template', 'collection']) {
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (descriptor !== undefined && !('value' in descriptor)) {
      return undefined;
    }
  }
  const scope = ownData(value, 'scope');
  const role = ownData(value, 'role');
  const slot = ownData(value, 'slot');
  const memberKey = ownData(value, 'memberKey');
  const template = ownData(value, 'template');
  const collection = ownData(value, 'collection');
  if (typeof scope !== 'string' || (role !== 'input' && role !== 'callable' && role !== 'step') || typeof slot !== 'string') {
    return undefined;
  }
  if (memberKey !== undefined && typeof memberKey !== 'string') {
    return undefined;
  }
  const keyed = memberKey === undefined ? {} : { memberKey };
  if (template === undefined && collection === undefined) {
    return Object.freeze({ scope, role, slot, ...keyed });
  }
  if (role !== 'step' || typeof template !== 'string' || template.length === 0 ||
      typeof collection !== 'string' || collection.length === 0 || memberKey === '') {
    return undefined;
  }
  return Object.freeze({ scope, role, slot, ...keyed, template, collection });
}

/** Whether a descriptor addresses a fanout template step or instance. */
export function isTemplateDescriptor(descriptor: IBindingDescriptor): boolean {
  return descriptor.template !== undefined || descriptor.collection !== undefined;
}

/** Whether untrusted data is a record whose own keys are exactly `keys`, all data properties. */
function exactRecord(value: unknown, keys: readonly string[]): boolean {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return false;
  }
  const own = Reflect.ownKeys(value);
  return own.length === keys.length && keys.every(key => {
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    return descriptor !== undefined && 'value' in descriptor;
  });
}

/** The only fields a version-1 witness record may carry. */
const directWitnessKeys: ReadonlySet<string> = new Set(['version', 'parent', 'child', 'arguments']);

/** The only fields a version-2 witness record may carry. */
const nestedWitnessKeys: ReadonlySet<string> = new Set(['version', 'parent', 'child', 'index', 'arguments']);

/**
 * Whether a witness record carries only known fields, each an own data
 * property. An extra field may belong to a format Definition does not read, so
 * it makes the record malformed rather than silently ignored.
 */
function onlyDataKeys(value: unknown, allowed: ReadonlySet<string>): boolean {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return false;
  }
  return Reflect.ownKeys(value).every(key => {
    const descriptor = typeof key === 'string' && allowed.has(key) ? Object.getOwnPropertyDescriptor(value, key) : undefined;
    return descriptor !== undefined && 'value' in descriptor;
  });
}

/** A non-negative safe integer, the only valid call position or array index. */
export function isPosition(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;
}

/** Copy an untrusted array without invoking accessors, or report it malformed. */
function arrayOf(value: unknown): readonly unknown[] {
  if (!Array.isArray(value)) {
    return unsupported('malformed');
  }
  const length = ownData(value, 'length');
  if (!isPosition(length)) {
    return unsupported('malformed');
  }
  const items: unknown[] = [];
  for (let index = 0; index < length; index++) {
    const descriptor = Object.getOwnPropertyDescriptor(value, String(index));
    if (descriptor === undefined || !('value' in descriptor)) {
      return unsupported('malformed');
    }
    items.push(descriptor.value);
  }
  return items;
}

/** Parse one structured path segment. */
function segment(value: unknown): IArgumentPathSegment {
  const kind = ownData(value, 'kind');
  if (kind === 'property' && exactRecord(value, ['kind', 'key'])) {
    const key = ownData(value, 'key');
    return typeof key === 'string' ? Object.freeze({ kind: 'property', key }) : unsupported('malformed');
  }
  if (kind === 'index' && exactRecord(value, ['kind', 'index'])) {
    const index = ownData(value, 'index');
    return isPosition(index) ? Object.freeze({ kind: 'index', index }) : unsupported('malformed');
  }
  return unsupported('malformed');
}

/** Parse a forwarded origin; `call` must name an earlier position than the witness's own. */
function origin(value: unknown, index: number): IForwardOrigin {
  if (typeof value !== 'object' || value === null) {
    return unsupported('malformed');
  }
  const binding = ownData(value, 'binding');
  if (binding !== 'input' && binding !== 'member' && binding !== 'child') {
    return typeof binding === 'string' ? unsupported('recipe-form') : unsupported('malformed');
  }
  const path = Object.freeze(arrayOf(ownData(value, 'path')).map(segment));
  switch (binding) {
    case 'input': {
      const slot = ownData(value, 'slot');
      return exactRecord(value, ['binding', 'slot', 'path']) && typeof slot === 'string' && slot.length > 0
        ? Object.freeze({ binding, slot, path })
        : unsupported('malformed');
    }
    case 'member':
      return exactRecord(value, ['binding', 'path']) ? Object.freeze({ binding, path }) : unsupported('malformed');
    case 'child': {
      const call = ownData(value, 'call');
      return exactRecord(value, ['binding', 'call', 'path']) && isPosition(call) && call < index
        ? Object.freeze({ binding, call, path })
        : unsupported('malformed');
    }
    default: {
      const exhaustive: never = binding;
      return exhaustive;
    }
  }
}

/** Whether an encoded value is canonical MDS1 snapshot text. */
function isCanonicalSnapshot(encoded: string): boolean {
  try {
    decodeSnapshot(encoded);
    return true;
  } catch {
    return false;
  }
}

/** Parse one argument recipe. */
function recipe(value: unknown, index: number): IArgumentRecipe {
  const form = ownData(value, 'form');
  switch (form) {
    case 'forwarded': {
      const justified = ownData(value, 'justified');
      return exactRecord(value, ['form', 'origin', 'justified']) && typeof justified === 'boolean'
        ? Object.freeze({ form, origin: origin(ownData(value, 'origin'), index), justified })
        : unsupported('malformed');
    }
    case 'derived': {
      const encoded = ownData(value, 'value');
      const justified = ownData(value, 'justified');
      return exactRecord(value, ['form', 'value', 'justified']) && typeof encoded === 'string' && typeof justified === 'boolean' &&
        isCanonicalSnapshot(encoded)
        ? Object.freeze({ form, value: encoded, justified })
        : unsupported('malformed');
    }
    case 'unreconstructible': {
      const reason = ownData(value, 'reason');
      return exactRecord(value, ['form', 'reason']) && isUnreconstructibleReason(reason)
        ? Object.freeze({ form, reason })
        : unsupported('malformed');
    }
    default:
      return typeof form === 'string' ? unsupported('recipe-form') : unsupported('malformed');
  }
}

/** Parse the version-2 argument form: exactly `{ form: 'empty' }` or a non-empty recipe list. */
function invocationArguments(value: unknown, index: number): IInvocationArguments {
  if (Array.isArray(value)) {
    const [first, ...rest] = arrayOf(value).map(item => recipe(item, index));
    if (first === undefined) {
      return unsupported('argument-form');
    }
    const recipes: readonly [IArgumentRecipe, ...IArgumentRecipe[]] = [first, ...rest];
    return Object.freeze(recipes);
  }
  if (exactRecord(value, ['form']) && ownData(value, 'form') === 'empty') {
    return Object.freeze({ form: 'empty' });
  }
  return unsupported('argument-form');
}

/**
 * Parse untrusted durable witness data. The version is read first: anything
 * but 1 or 2 is an unsupported version before any other field is parsed. Then
 * the record must carry only that version's fields, then its structure, then
 * the version's own fields. Version 1 keeps its M3 meaning exactly: its
 * argument form must be `{ form: 'empty' }`, and a descriptor carrying
 * template fields makes it malformed, since template instances only ever
 * emit version 2.
 * @param witness - Untrusted durable data.
 * @returns The parsed, frozen witness or a precise unsupported reason.
 */
export function parseWitness(witness: unknown): IParsedWitness {
  const version = ownData(witness, 'version');
  if (version !== 1 && version !== 2) {
    return { status: 'unsupported', reason: 'witness-version' };
  }
  if (!onlyDataKeys(witness, version === 1 ? directWitnessKeys : nestedWitnessKeys)) {
    return { status: 'unsupported', reason: 'malformed' };
  }
  const parent = copyDescriptor(ownData(witness, 'parent'));
  const child = copyDescriptor(ownData(witness, 'child'));
  if (parent === undefined || child === undefined) {
    return { status: 'unsupported', reason: 'malformed' };
  }
  const argumentsForm = ownData(witness, 'arguments');
  if (version === 1) {
    // Version 1 keeps its exact M3 meaning: template instances only ever emit version 2.
    if (isTemplateDescriptor(parent) || isTemplateDescriptor(child)) {
      return { status: 'unsupported', reason: 'malformed' };
    }
    if (!exactRecord(argumentsForm, ['form']) || ownData(argumentsForm, 'form') !== 'empty') {
      return { status: 'unsupported', reason: 'argument-form' };
    }
    return { status: 'parsed', witness: Object.freeze({ version, parent, child, arguments: Object.freeze({ form: 'empty' }) }) };
  }
  const index = ownData(witness, 'index');
  if (!isPosition(index)) {
    return { status: 'unsupported', reason: 'malformed' };
  }
  try {
    const parsedArguments = invocationArguments(argumentsForm, index);
    return { status: 'parsed', witness: Object.freeze({ version, parent, child, index, arguments: parsedArguments }) };
  } catch (error: unknown) {
    if (error instanceof UnsupportedWitness) {
      return { status: 'unsupported', reason: error.reason };
    }
    throw error;
  }
}
