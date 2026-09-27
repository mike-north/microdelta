/**
 * EXP-2's selected-field candidate compares synchronous indexed access with
 * explicit asynchronous preparation. This is not a production storage API.
 * @packageDocumentation
 */
import { decodeValue, encodeValue, fingerprint, observe, recordFromEntries } from './value.js';
import type { IDigestCapability, IObservation } from './value.js';

/** Metadata is readable without opening any payload field. */
export interface ISyncFieldSource {
  readonly fingerprint: string;
  /** Read one field from a backing source with synchronous selected access. */
  readField(name: string): unknown;
}

/** A remote-like backing source must explicitly prepare fields before sync reads. */
export interface IAsyncFieldSource {
  readonly fingerprint: string;
  /** Read one selected field asynchronously. */
  readField(name: string): Promise<unknown>;
}

/** A view records the exact field reads made through its ordinary scalar surface. */
export interface IFieldView {
  readonly value: Readonly<Record<string, unknown>>;
  readonly observations: readonly IObservation[];
}

/** A uniform projection binds one collection and one selected field. */
export interface IProjection {
  readonly logicalDependencies: readonly { readonly fingerprint: string }[];
  readonly inspectedMembers: number;
  readonly visitedKeys: readonly string[];
  readonly complete: boolean;
}

/** Fingerprint metadata verification must never call the payload reader. */
export function verifyFingerprint(source: ISyncFieldSource, expected: string): boolean {
  return source.fingerprint === expected;
}

/** Build a read surface without claiming a primitive can itself be proxied. */
function fieldView(read: (name: string) => unknown): IFieldView {
  const observations: IObservation[] = [];
  const value = new Proxy<Record<string, unknown>>(Object.freeze(recordFromEntries([], null)), {
    get(_target, property): unknown {
      if (typeof property !== 'string') {
        throw new TypeError('Unsupported symbol field access');
      }
      // A selected subtree becomes a detached immutable snapshot; unread
      // siblings in the backing source are never passed through this boundary.
      const selected = decodeValue(encodeValue(read(property)));
      observations.push(observe(recordFromEntries([[property, selected]], null), [{ kind: 'property', key: property }], 'value'));
      return selected;
    },
  });
  return { value, observations };
}

/** A synchronous source can satisfy an unpredicted field read immediately. */
export function createSyncView(source: ISyncFieldSource): IFieldView {
  return fieldView((name: string): unknown => source.readField(name));
}

/** Async preparation creates a later ordinary scalar-read surface. */
export async function prepareView(source: IAsyncFieldSource, names: readonly string[]): Promise<IFieldView> {
  const selected = new Map<string, unknown>();
  for (const name of new Set(names)) {
    const value = await source.readField(name);
    selected.set(name, decodeValue(encodeValue(value)));
  }
  return fieldView((name: string): unknown => {
    if (!selected.has(name)) {
      throw new TypeError(`Unprepared field ${name}; async backing cannot satisfy a synchronous getter`);
    }
    return selected.get(name);
  });
}

/** Materializing a result consumes only its selected output fields. */
export function materializeOutput(view: IFieldView, names: readonly string[]): Record<string, unknown> {
  const entries = names.map((name): readonly [string, unknown] => [name, view.value[name]]);
  return Object.freeze(recordFromEntries(entries, Object.prototype as object));
}

/** One selected member fact is all a uniform projection may inspect. */
function project(
  collection: string,
  members: readonly { readonly key: string; readonly value: Readonly<Record<string, unknown>> }[],
  field: string,
  digest: IDigestCapability,
  complete: boolean,
): IProjection {
  const keys = new Set<string>();
  const facts: Array<readonly [string, string]> = [];
  for (const member of members) {
    if (keys.has(member.key)) {
      throw new TypeError(`Duplicate collection key ${member.key} in ${collection}`);
    }
    keys.add(member.key);
    const selected = observe(member.value, [{ kind: 'property', key: field }], 'value').fact;
    facts.push([member.key, encodeValue(selected)]);
  }
  const canonicalFacts = [...facts].sort(([left], [right]) => left < right ? -1 : left > right ? 1 : 0);
  const encoded = `MDP1|${JSON.stringify([collection, field, complete, canonicalFacts])}`;
  return {
    logicalDependencies: [{ fingerprint: fingerprint(encoded, digest) }],
    inspectedMembers: facts.length,
    visitedKeys: complete ? [] : members.map(member => member.key),
    complete,
  };
}

/** Exhaustive uniform members can form one logical dependency. */
export function projectUniform(
  collection: string,
  members: readonly { readonly key: string; readonly value: Readonly<Record<string, unknown>> }[],
  field: string,
  digest: IDigestCapability,
): IProjection {
  return project(collection, members, field, digest, true);
}

/** Early termination retains its actual visited coverage. */
export function projectVisited(
  collection: string,
  members: readonly { readonly key: string; readonly value: Readonly<Record<string, unknown>> }[],
  field: string,
  digest: IDigestCapability,
): IProjection {
  return project(collection, members, field, digest, false);
}
