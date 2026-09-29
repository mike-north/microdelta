/**
 * EXP-4 nested invocation record v2 (candidate 1). It extends the M3
 * direct-child witness with an ordered call index and one argument recipe per
 * argument. Records hold structural descriptors and canonical facts only; no
 * closure, live object or process-local token is ever retained.
 */
import type { IPath } from './data.js';
import { descriptorKey } from './definition.js';
import type { IDescriptor } from './definition.js';

/**
 * One ordered fact. `read` is the frame's own evidence at an `input`, `member`,
 * `members` or `argument` path; `child-read` is a consumed output fact of an
 * earlier child call; `untracked` marks a peek that yielded no fact.
 * @internal
 */
export type IObservation =
  | { readonly kind: 'read'; readonly path: IPath; readonly fact: string }
  | { readonly kind: 'child-read'; readonly call: number; readonly path: IPath; readonly fact: string }
  | { readonly kind: 'untracked'; readonly path: IPath };

/**
 * How one argument can be supplied again without running the parent.
 * `forwarded` names a structural origin resolved from current bindings;
 * `derived` records a canonical value and whether recorded evidence could
 * justify it; `unreconstructible` records only why no value was kept.
 * @internal
 */
export type IArgumentRecipe =
  | { readonly form: 'forwarded'; readonly origin: IPath }
  | { readonly form: 'derived'; readonly value: string; readonly justified: boolean }
  | { readonly form: 'unreconstructible'; readonly reason: string };

/** The M3 `empty` form is kept distinct from a non-empty ordered recipe list. @internal */
export type IArguments =
  | { readonly form: 'empty' }
  | { readonly form: 'list'; readonly items: readonly IArgumentRecipe[] };

/** One recorded child call in parent call order, with the exact child result it consumed. @internal */
export interface IChildCall {
  readonly index: number;
  readonly child: IDescriptor;
  readonly arguments: IArguments;
  readonly identity: string;
  readonly reference: string;
}

/**
 * One retained execution: its history identity, structural descriptor,
 * observed implementation, consumed structural bindings, ordered facts and
 * child calls, canonical output and exact reference. Fixture data, not a
 * selected durable schema.
 * @internal
 */
export interface IInvocationRecord {
  readonly version: 2;
  readonly identity: string;
  readonly descriptor: IDescriptor;
  readonly implementation: string;
  readonly consumed: readonly IDescriptor[];
  readonly observations: readonly IObservation[];
  readonly calls: readonly IChildCall[];
  readonly output: string;
  readonly reference: string;
}

/** A record before History assigns its exact reference. @internal */
export type IUnreferencedRecord = Omit<IInvocationRecord, 'reference'>;

/**
 * Why a retained candidate was not accepted. Binding and argument reasons are
 * insufficient evidence; `changed-*` reasons are observed changed content.
 * @internal
 */
export type IMissReason =
  | 'no-history'
  | 'changed-implementation'
  | 'changed-evidence'
  | 'changed-child-output'
  | 'missing-binding'
  | 'ambiguous-binding'
  | 'unjustified-argument'
  | 'unreconstructible-argument'
  | 'child-failed';

/**
 * History identity: the structural descriptor plus the canonical digest of
 * derived-argument values by position. Forwarded arguments are identified by
 * origin inside the recipe and observed by the child, so their current values
 * never enter identity; unreconstructible arguments have no value to digest.
 * @internal
 */
export function historyIdentity(descriptor: IDescriptor, args: IArguments): string {
  const derived = args.form === 'empty'
    ? []
    : args.items.flatMap((item, index) => item.form === 'derived' ? [[index, item.value]] : []);
  return `${descriptorKey(descriptor)}|${JSON.stringify(derived)}`;
}

/** Untrusted JSON narrowing without casts. */
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    && Object.getPrototypeOf(value) === Object.prototype && Object.getOwnPropertySymbols(value).length === 0;
}

/** Reject a malformed field with its name; a damaged record is never partially trusted. */
function malformed(field: string): never {
  throw new TypeError(`EXP-4 malformed invocation record: ${field}`);
}

/** Read a required string field. */
function text(value: unknown, field: string): string {
  return typeof value === 'string' ? value : malformed(field);
}

/** Read a list field. */
function list(value: unknown, field: string): readonly unknown[] {
  return Array.isArray(value) ? value : malformed(field);
}

/** A binding path contains only strings and safe-integer indexes. */
function path(value: unknown, field: string): IPath {
  const segments = list(value, field);
  return Object.freeze(segments.map(segment => typeof segment === 'string' || (typeof segment === 'number' && Number.isSafeInteger(segment))
    ? segment
    : malformed(field)));
}

/** Parse the descriptor grammar, dropping nothing and inventing nothing. */
function descriptor(value: unknown, field: string): IDescriptor {
  if (!isRecord(value)) {
    return malformed(field);
  }
  const role = value.role;
  if (role !== 'input' && role !== 'collection' && role !== 'callable' && role !== 'step') {
    return malformed(`${field}.role`);
  }
  const parsed: { -readonly [K in keyof IDescriptor]: IDescriptor[K] } = {
    scope: text(value.scope, `${field}.scope`),
    role,
    slot: text(value.slot, `${field}.slot`),
  };
  for (const optional of ['template', 'collection', 'memberKey'] as const) {
    if (value[optional] !== undefined) {
      parsed[optional] = text(value[optional], `${field}.${optional}`);
    }
  }
  return Object.freeze(parsed);
}

/** Parse one ordered observation. */
function observation(value: unknown): IObservation {
  if (!isRecord(value)) {
    return malformed('observation');
  }
  const at = path(value.path, 'observation.path');
  switch (value.kind) {
    case 'read':
      return Object.freeze({ kind: 'read', path: at, fact: text(value.fact, 'observation.fact') });
    case 'child-read':
      return typeof value.call === 'number' && Number.isSafeInteger(value.call) && value.call >= 0
        ? Object.freeze({ kind: 'child-read', call: value.call, path: at, fact: text(value.fact, 'observation.fact') })
        : malformed('observation.call');
    case 'untracked':
      return Object.freeze({ kind: 'untracked', path: at });
    default:
      return malformed('observation.kind');
  }
}

/** Parse one argument recipe. */
function recipe(value: unknown): IArgumentRecipe {
  if (!isRecord(value)) {
    return malformed('argument');
  }
  switch (value.form) {
    case 'forwarded':
      return Object.freeze({ form: 'forwarded', origin: path(value.origin, 'argument.origin') });
    case 'derived':
      return typeof value.justified === 'boolean'
        ? Object.freeze({ form: 'derived', value: text(value.value, 'argument.value'), justified: value.justified })
        : malformed('argument.justified');
    case 'unreconstructible':
      return Object.freeze({ form: 'unreconstructible', reason: text(value.reason, 'argument.reason') });
    default:
      return malformed('argument.form');
  }
}

/** Parse the argument form: `empty` or a non-empty ordered list. */
function argumentsOf(value: unknown): IArguments {
  if (!isRecord(value)) {
    return malformed('arguments');
  }
  if (value.form === 'empty') {
    return Object.freeze({ form: 'empty' });
  }
  const items = value.form === 'list' ? list(value.items, 'arguments.items') : malformed('arguments.form');
  return items.length > 0 ? Object.freeze({ form: 'list', items: Object.freeze(items.map(recipe)) }) : malformed('arguments.items');
}

/** Parse one recorded child call; its index must equal its position. */
function childCall(value: unknown, position: number): IChildCall {
  if (!isRecord(value) || value.index !== position) {
    return malformed('call.index');
  }
  return Object.freeze({
    index: position,
    child: descriptor(value.child, 'call.child'),
    arguments: argumentsOf(value.arguments),
    identity: text(value.identity, 'call.identity'),
    reference: text(value.reference, 'call.reference'),
  });
}

/**
 * Parse an untrusted durable record. Anything outside the v2 grammar is
 * rejected rather than coerced, so fixture history can never become evidence
 * by a cast.
 * @internal
 */
export function parseRecord(value: unknown): IInvocationRecord {
  if (!isRecord(value) || value.version !== 2) {
    return malformed('version');
  }
  return Object.freeze({
    version: 2,
    identity: text(value.identity, 'identity'),
    descriptor: descriptor(value.descriptor, 'descriptor'),
    implementation: text(value.implementation, 'implementation'),
    consumed: Object.freeze(list(value.consumed, 'consumed').map(item => descriptor(item, 'consumed'))),
    observations: Object.freeze(list(value.observations, 'observations').map(observation)),
    calls: Object.freeze(list(value.calls, 'calls').map(childCall)),
    output: text(value.output, 'output'),
    reference: text(value.reference, 'reference'),
  });
}
