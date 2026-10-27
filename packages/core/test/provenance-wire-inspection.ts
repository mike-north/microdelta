/**
 * Independent test-only views of new provenance tuples. This reads only fields
 * needed by runtime assertions/corruption fixtures, never production decoding or
 * semantic eligibility. Full grammar/legacy expectations live in owner tests.
 */

/** @internal A named assertion view retains its exact raw tuple for deliberate fixture edits. */
export interface IWireObservationInspection {
  readonly binding: { readonly path: readonly string[] };
  readonly address: readonly { readonly kind: string; readonly key?: string; readonly index?: number }[];
  readonly kind: string;
  readonly operation: string;
  readonly tuple: readonly unknown[];
}

/** Read a data field from an opaque owner value without casting its unknown contents. */
function field(value: unknown, key: string): unknown {
  if (typeof value !== 'object' || value === null) { throw new Error('Expected wire-5 record'); }
  const descriptor = Object.getOwnPropertyDescriptor(value, key);
  return descriptor !== undefined && 'value' in descriptor ? descriptor.value as unknown : undefined;
}
/** Narrow only an array surface; structural tuple expectations are checked at their use. */
function vector(value: unknown): readonly unknown[] {
  if (!Array.isArray(value)) { throw new Error('Expected wire-5 vector'); }
  return value;
}
/** Bindings remain ordered strings; no production correspondence is inferred. */
function strings(value: unknown): readonly string[] {
  return vector(value).map((part) => { if (typeof part !== 'string') { throw new Error('Expected wire-5 string'); } return part; });
}
/** @internal Inspect literal tuple positions independently of the runtime reader. */
export function inspectProvenanceObservations(content: unknown): readonly IWireObservationInspection[] {
  return vector(field(content, 'observations')).map(value => {
    const tuple = vector(value);
    if (tuple.length !== 8) { throw new Error('Expected wire-5 observation tuple'); }
    const kind = ['fact', 'implementation', 'materialized-output', 'projection', 'collection-order', 'untracked-read'][typeof tuple[3] === 'number' ? tuple[3] : -1];
    const operation = tuple[4];
    if (kind === undefined || typeof operation !== 'string') { throw new Error('Expected wire-5 observation envelope'); }
    const address = vector(tuple[1]).map(segment => {
      const pair = vector(segment);
      if (pair.length !== 2) { throw new Error('Expected wire-5 address pair'); }
      if (pair[0] === 0 && typeof pair[1] === 'string') { return { kind: 'property', key: pair[1] }; }
      if (pair[0] === 1 && typeof pair[1] === 'number') { return { kind: 'index', index: pair[1] }; }
      throw new Error('Expected wire-5 address tag');
    });
    return { binding: { path: strings(tuple[0]) }, address, kind, operation, tuple };
  });
}
