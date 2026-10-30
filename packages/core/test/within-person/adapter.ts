/**
 * The bounded fixed-data response adapter. It sees only advertised query,
 * revision, member identity and exhaustion facts. Definition remains responsible
 * for whole-snapshot member keying; a missing key is never repaired or dropped.
 */
import type { ITraversalAdaptation } from '../../src/index.js';

/** Exactly one person/repository/window is permitted throughout this fixture. */
export const fixedQuery = Object.freeze({ person: 'fixture/person:1', repository: 'fixture/repo', window: '2026-W42' });

/** Member identity is separate from the optional key deliberately tested by Definition negatives. */
export interface IPr {
  readonly id?: string;
  readonly identity: string;
  readonly number: number;
}

/** An ordinary collection source will freshly publish this captured evidence. */
export interface IFrontier {
  readonly members: readonly IPr[];
  readonly status: 'open' | 'complete';
  readonly revision: string;
}

/** Advertised service facts contain no private complete-manifest hint. */
export interface IPage {
  readonly query: typeof fixedQuery;
  readonly revision: string;
  readonly members: readonly IPr[];
  readonly continuation: string | undefined;
  readonly exhausted: boolean;
}

/** Refusal stays an adapter failure, never successful empty discovery. */
function invalid(): never { throw new Error('The fixed response is inconsistent or malformed'); }

/** Only own data fields are inspected; an accessor is not an advertised fact. */
function field(value: unknown, key: string): unknown {
  if (typeof value !== 'object' || value === null) { return invalid(); }
  const descriptor = Object.getOwnPropertyDescriptor(value, key);
  if (descriptor === undefined || !('value' in descriptor)) { return invalid(); }
  return descriptor.value;
}

/** Preserve malformed key absence for the owning keying boundary, while checking identity facts. */
function member(value: unknown): IPr {
  const identity = field(value, 'identity');
  const number = field(value, 'number');
  if (typeof identity !== 'string' || identity.length === 0 || !Number.isSafeInteger(number) || typeof number !== 'number' || number <= 0) { return invalid(); }
  if (typeof value !== 'object' || value === null) { return invalid(); }
  const key = Object.getOwnPropertyDescriptor(value, 'id');
  if (key === undefined) { return { identity, number }; }
  if (!('value' in key) || typeof key.value !== 'string' || key.value.length === 0) { return invalid(); }
  return { id: key.value, identity, number };
}

/** Read one bounded member list without assuming a previous author object's type. */
function members(value: unknown): readonly IPr[] {
  if (!Array.isArray(value) || value.length > 4) { return invalid(); }
  return value.map((entry: unknown) => member(entry));
}

/** Validate the same fixed query rather than trusting a matching revision alone. */
function query(value: unknown): void {
  if (field(value, 'person') !== fixedQuery.person || field(value, 'repository') !== fixedQuery.repository || field(value, 'window') !== fixedQuery.window) { invalid(); }
}

/**
 * Adapt exactly one accepted response and the preceding frontier. Legitimate
 * repeated qualified IDs coalesce only when their advertised identity agrees;
 * neither page movement nor overlap changes an existing member's identity.
 */
export function adaptPage(page: object, previous: object | undefined): ITraversalAdaptation {
  query(field(page, 'query'));
  const revision = field(page, 'revision');
  const continuation = field(page, 'continuation');
  const exhausted = field(page, 'exhausted');
  if (typeof revision !== 'string' || revision.length === 0 || typeof exhausted !== 'boolean') { return invalid(); }
  if (exhausted ? continuation !== undefined : typeof continuation !== 'string' || continuation.length === 0) { return invalid(); }
  const before = previous === undefined ? [] : members(field(previous, 'members'));
  if (previous !== undefined && (field(previous, 'revision') !== revision || field(previous, 'status') !== 'open')) { return invalid(); }
  const combined: IPr[] = [...before];
  for (const current of members(field(page, 'members'))) {
    const same = current.id === undefined ? undefined : combined.find(prior => prior.id === current.id);
    if (same === undefined) { combined.push(current); }
    else if (same.identity !== current.identity || same.number !== current.number) { return invalid(); }
  }
  if (combined.length > 4) { return invalid(); }
  const frontier: IFrontier = { revision, members: combined, status: exhausted ? 'complete' : 'open' };
  return exhausted ? { kind: 'complete', frontier } : { kind: 'continue', frontier, continuation: ['continuation'] };
}
