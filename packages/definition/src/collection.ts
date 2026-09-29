/**
 * Keyed collections and member keying (COL-1, CMP-4).
 *
 * A keyed collection is a retained source whose result carries its discovered
 * members and a completion status. The source declares which member field is
 * the designated identity; a fanout template may instead supply an explicit
 * custom-key function. Keying turns one collection snapshot into member keys in
 * canonical order before any gate or member body runs. It is all-or-nothing: a
 * missing, non-string, empty or duplicate key rejects the whole snapshot with a
 * diagnostic naming the collection, the key and the custom-key option, so no
 * member work can be admitted for a partially keyed population. Array position
 * is never identity, and prototype-named keys are ordinary keys.
 *
 * Definition only keys a snapshot Resolution supplies; it never runs discovery,
 * reads the retained result itself, decides freshness or admits member work.
 */
import type { ISourceDeclaration } from './declaration.js';
import { DefinitionError } from './errors.js';
import type { IBindingFamily } from './family.js';
import { thrownDetail } from './thrown.js';

/**
 * Whether discovery reported its member list as closed (`complete`) or as
 * possibly incomplete (`open`). Only a complete collection can support a strict
 * consumer's claim of coverage.
 * @alpha
 */
export type ICollectionStatus = 'complete' | 'open';

/**
 * The result shape of a keyed collection source: the discovered member records,
 * in whatever order discovery produced them, and the completion status. Order
 * is not identity; members are keyed by designated identity or a custom key.
 * @alpha
 */
export interface ICollectionResult<TMember> {
  /** Discovered member records. */
  readonly members: readonly TMember[];
  /** Whether discovery closed its member list. */
  readonly status: ICollectionStatus;
}

/**
 * The fields of a member record that may serve as its designated identity:
 * fields whose declared value is a string (possibly absent, which fails keying
 * for that snapshot rather than silently substituting a position).
 * @alpha
 */
export type IIdentityField<TMember> = {
  [K in keyof TMember]-?: [Exclude<TMember[K], undefined>] extends [never] ? never
    : Exclude<TMember[K], undefined> extends string ? K : never;
}[keyof TMember] & string;

/**
 * The `collection` option of a source, available only when its declared result
 * is a keyed collection: it names the member field that is designated identity.
 * @alpha
 */
export type ICollectionOptions<TResult> = TResult extends ICollectionResult<infer TMember>
  ? { readonly identity: IIdentityField<TMember> }
  : never;

/**
 * The keyed-collection marker Definition retains on a collection source
 * declaration: the designated identity field, copied and frozen at declaration.
 * @alpha
 */
export interface ICollectionIdentity {
  /** The member field whose string value is each member's default key. */
  readonly identity: string;
}

/**
 * The member record type of a keyed collection source declaration, or `never`
 * when the declaration's result is not a keyed collection.
 * @alpha
 */
export type IMemberOf<TFamily extends IBindingFamily, TCollection> =
  TCollection extends ISourceDeclaration<TFamily, infer TResult>
    ? TResult extends ICollectionResult<infer TMember> ? TMember : never
    : never;

/**
 * One keyed member of a snapshot: its key and the snapshot's member record,
 * passed through unread beyond what keying required.
 * @alpha
 */
export interface IKeyedMember {
  /** The member key: designated identity or the custom key's result. */
  readonly key: string;
  /** The member record exactly as the snapshot supplied it. */
  readonly member: unknown;
}

/**
 * Why a snapshot could not be keyed.
 *
 * - `malformed-snapshot`: the snapshot is not `{ members: [record, ...], status: 'complete' | 'open' }`; a hole, `null` or non-record member counts.
 * - `missing-key`: a member record has no own designated identity field, or the custom key returned `undefined`.
 * - `non-string-key`: a member's key is present but not a string.
 * - `empty-key`: a member's key is the empty string.
 * - `duplicate-key`: two members share one key.
 * - `key-function-failed`: the template's custom-key function threw.
 * @alpha
 */
export type IKeyingFailure = 'malformed-snapshot' | 'missing-key' | 'non-string-key' | 'empty-key' | 'duplicate-key' | 'key-function-failed';

/**
 * A keying rejection. It names the collection binding, the template, the key
 * (when one was produced), the designated identity field consulted (absent
 * when a custom key was used) and whether a custom key was in effect; the
 * message always points to the template's custom-key option. When several
 * members fail, the reported failure is the first by reason precedence
 * (`malformed-snapshot`, `key-function-failed`, `missing-key`,
 * `non-string-key`, `empty-key`, `duplicate-key`) and then by least key in
 * canonical order, so the diagnostic never depends on discovery order.
 * @alpha
 */
export interface IKeyingDiagnostic {
  /** Why keying failed. */
  readonly reason: IKeyingFailure;
  /** The template whose key strategy was applied. */
  readonly template: string;
  /** The composition-level slot of the keyed collection. */
  readonly collection: string;
  /** The offending string key, for duplicate and empty keys. */
  readonly key: string | undefined;
  /** The designated identity field, when keying used it. */
  readonly identity: string | undefined;
  /** Whether the template's custom-key function produced the keys. */
  readonly customKey: boolean;
  /** Human-readable diagnostic naming the collection, the key and the custom-key option. */
  readonly message: string;
}

/**
 * The outcome of keying one collection snapshot: every member keyed, in
 * canonical key order, with the snapshot's completion status; or a rejection
 * of the whole snapshot. A rejection carries no partial member list.
 * @alpha
 */
export type IKeyedSnapshot =
  | {
    readonly status: 'keyed';
    /** The template whose key strategy was applied. */
    readonly template: string;
    /** The composition-level slot of the keyed collection. */
    readonly collection: string;
    /** The snapshot's completion status. */
    readonly completion: ICollectionStatus;
    /** Every member, keyed and in canonical (code-unit) key order. */
    readonly members: readonly IKeyedMember[];
  }
  | { readonly status: 'rejected'; readonly diagnostic: IKeyingDiagnostic };

/**
 * One template's key strategy over its collection binding. The custom key is
 * the author's function with its member type erased; it is invoked only with
 * a member record of a snapshot Resolution supplied as that collection's
 * result, which is the trusted caller contract of keying.
 */
export interface IKeyStrategy {
  readonly template: string;
  readonly collection: string;
  readonly identity: string;
  readonly customKey: ((member: never) => unknown) | undefined;
}

/**
 * Key one collection snapshot under a template's strategy. The snapshot and
 * its member records are read only through own data properties, so keying
 * never runs a getter or consults a prototype. Every member must be a record
 * (a non-null, non-array object); a hole, `null` or any other member makes the
 * snapshot malformed before any author key function runs. The custom key,
 * when declared, is the one author callback keying invokes: pure author keying
 * over the member record, where a throw rejects the snapshot rather than
 * escaping. A rejection is deterministic regardless of discovery order: every
 * member's failure is collected, then the reported one is chosen by a fixed
 * reason precedence and, within a reason, by the least key or detail in
 * canonical order.
 * @param strategy - The template's key strategy and collection binding.
 * @param snapshot - The collection result Resolution supplies.
 * @returns Every member keyed in canonical order, or a whole-snapshot rejection.
 */
export function keySnapshot(strategy: IKeyStrategy, snapshot: unknown): IKeyedSnapshot {
  const members = ownData(snapshot, 'members');
  const completion = ownData(snapshot, 'status');
  if (Array.isArray(snapshot) || !members.present || !Array.isArray(members.value) || !completion.present ||
      (completion.value !== 'complete' && completion.value !== 'open')) {
    return rejection(strategy, { reason: 'malformed-snapshot', key: undefined, detail: undefined });
  }
  const list: readonly unknown[] = members.value;
  const records: object[] = [];
  for (let index = 0; index < list.length; index++) {
    const element = Object.getOwnPropertyDescriptor(list, index);
    // A hole is an absent record: it has no identity, and its position never becomes one.
    const member: unknown = element !== undefined && 'value' in element ? element.value : undefined;
    if (typeof member !== 'object' || member === null || Array.isArray(member)) {
      return rejection(strategy, { reason: 'malformed-snapshot', key: undefined, detail: undefined });
    }
    records.push(member);
  }
  const failures: IFailure[] = [];
  const keyed = new Map<string, object>();
  const duplicates = new Set<string>();
  for (const member of records) {
    const derived = memberKey(strategy, member);
    if (derived.status === 'failed') {
      failures.push(derived.failure);
    } else if (keyed.has(derived.key)) {
      duplicates.add(derived.key);
    } else {
      // A Map keeps `__proto__`, `constructor` and similar keys as ordinary entries.
      keyed.set(derived.key, member);
    }
  }
  for (const key of duplicates) {
    failures.push({ reason: 'duplicate-key', key, detail: undefined });
  }
  const [reported] = failures.sort(compareFailures);
  if (reported !== undefined) {
    return rejection(strategy, reported);
  }
  const ordered = [...keyed.keys()].sort(compareKeys).map(key => Object.freeze({ key, member: keyed.get(key) }));
  return Object.freeze({
    status: 'keyed',
    template: strategy.template,
    collection: strategy.collection,
    completion: completion.value,
    members: Object.freeze(ordered),
  });
}

/** One member's keying failure, before a single one is chosen for the diagnostic. */
interface IFailure {
  readonly reason: IKeyingFailure;
  readonly key: string | undefined;
  readonly detail: string | undefined;
}

/** Fixed reason precedence: a failing key function first, duplicates last. */
const failurePrecedence: readonly IKeyingFailure[] = ['malformed-snapshot', 'key-function-failed', 'missing-key', 'non-string-key', 'empty-key', 'duplicate-key'];

/** Order failures by reason precedence, then least key, then least detail, all in canonical order. */
function compareFailures(left: IFailure, right: IFailure): number {
  return failurePrecedence.indexOf(left.reason) - failurePrecedence.indexOf(right.reason)
    || compareKeys(left.key ?? '', right.key ?? '')
    || compareKeys(left.detail ?? '', right.detail ?? '');
}

/** Canonical key order: UTF-16 code-unit order, independent of locale and discovery order. */
function compareKeys(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

/** Derive one member's key, or its failure. */
function memberKey(strategy: IKeyStrategy, member: object):
  | { readonly status: 'keyed'; readonly key: string }
  | { readonly status: 'failed'; readonly failure: IFailure } {
  let raw: unknown;
  if (strategy.customKey === undefined) {
    raw = ownData(member, strategy.identity).value;
  } else {
    try {
      // Trusted caller contract: the member is a record of this collection's result.
      raw = Reflect.apply(strategy.customKey, undefined, [member]);
    } catch (error: unknown) {
      return { status: 'failed', failure: { reason: 'key-function-failed', key: undefined, detail: thrownDetail(error) } };
    }
  }
  if (raw === undefined) {
    return { status: 'failed', failure: { reason: 'missing-key', key: undefined, detail: undefined } };
  }
  if (typeof raw !== 'string') {
    return { status: 'failed', failure: { reason: 'non-string-key', key: undefined, detail: raw === null ? 'null' : typeof raw } };
  }
  if (raw.length === 0) {
    return { status: 'failed', failure: { reason: 'empty-key', key: raw, detail: undefined } };
  }
  return { status: 'keyed', key: raw };
}

/** Build a frozen whole-snapshot rejection whose message names the collection, the key and the custom-key option. */
function rejection(strategy: IKeyStrategy, failure: IFailure): IKeyedSnapshot {
  const { reason, key, detail } = failure;
  const custom = strategy.customKey !== undefined;
  const origin = custom ? 'the custom key' : `designated identity field ${JSON.stringify(strategy.identity)}`;
  const where = `Collection ${strategy.collection} (template ${strategy.template})`;
  const remedy = custom ? "Revise the template's `key` option." : "Declare a custom key with the template's `key` option.";
  const problems: Readonly<Record<IKeyingFailure, string>> = {
    'malformed-snapshot': "was not supplied as { members: [record, ...], status: 'complete' | 'open' }.",
    'missing-key': custom ? 'has a member for which the custom key returned no key.' : `has a member without ${origin}.`,
    'non-string-key': `has a member whose key from ${origin} is ${detail ?? 'not a string'}, not a string.`,
    'empty-key': `has a member with an empty key from ${origin}.`,
    'duplicate-key': `has duplicate member key ${JSON.stringify(key)} from ${origin}; member keys must be unique.`,
    'key-function-failed': `could not be keyed because the custom key threw: ${detail ?? 'unknown failure'}.`,
  };
  const diagnostic: IKeyingDiagnostic = Object.freeze({
    reason,
    template: strategy.template,
    collection: strategy.collection,
    key,
    identity: custom ? undefined : strategy.identity,
    customKey: custom,
    message: `${where} ${problems[reason]} No member of this snapshot is keyed. ${remedy}`,
  });
  return Object.freeze({ status: 'rejected', diagnostic });
}

/**
 * Read one own data property without invoking accessors or consulting the
 * prototype chain. A non-object, an absent own property and an accessor all
 * report absence.
 */
function ownData(value: unknown, key: string): { readonly present: boolean; readonly value: unknown } {
  if (typeof value !== 'object' || value === null) {
    return { present: false, value: undefined };
  }
  const descriptor = Object.getOwnPropertyDescriptor(value, key);
  return descriptor !== undefined && 'value' in descriptor ? { present: true, value: descriptor.value } : { present: false, value: undefined };
}

/**
 * Read and validate a source's `collection` option: a plain record whose own
 * `identity` data property is a nonempty string. Accessors are rejected
 * without being invoked, and the author's record is never retained.
 * @param value - The captured option value, or undefined when absent.
 * @returns The frozen keyed-collection marker, or undefined for an ordinary source.
 */
export function collectionOption(value: unknown): ICollectionIdentity | undefined {
  if (value === undefined) {
    return undefined;
  }
  const prototype: unknown = typeof value === 'object' && value !== null ? Object.getPrototypeOf(value) : undefined;
  if (Array.isArray(value) || (prototype !== Object.prototype && prototype !== null)) {
    throw new DefinitionError('invalid-collection', 'A collection option must be a plain record naming the designated identity field.');
  }
  const identity = ownData(value, 'identity');
  if (!identity.present || typeof identity.value !== 'string' || identity.value.length === 0) {
    throw new DefinitionError('invalid-collection', 'A collection must name its designated identity field as a nonempty own string property `identity`.');
  }
  return Object.freeze({ identity: identity.value });
}
