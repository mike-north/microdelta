/**
 * Resolution-private ordered-tuple spelling of historical observations. This
 * representation retains fields independently; it never infers correspondence,
 * freshness, finality or equality from a producer's usual coincidences. Semantic
 * provenance validation remains a separate owner responsibility. Other Resolution
 * record formats do not use this codec.
 * @packageDocumentation
 */
import { ResolutionError } from './errors.js';

/** Private observation discriminants are independent of selection discriminants. */
const kinds = ['fact', 'implementation', 'materialized-output', 'projection', 'collection-order', 'untracked-read'] as const;
/** Selected operation tags have no authority over the separate arbitrary outer operation. */
const operations = ['value', 'own', 'membership', 'length', 'keys', 'container-kind'] as const;
/** The semantic variants remain independent of the outer provenance wire revision. */
type ISemanticVersion = 1 | 2 | 3 | 4;
/** @internal Expanded private candidate content, or an honest compatibility miss before interpretation. */
export type IWireReading = { readonly status: 'supported'; readonly semanticVersion: ISemanticVersion; readonly content: unknown } | { readonly status: 'unsupported'; readonly detail: string };

/** Known current-generation tuple corruption has the existing Resolution classification. */
function malformed(detail: string): never { throw new ResolutionError('integrity', `Stored Resolution tuple provenance is malformed: ${detail}`); }
/** Compatibility inspection reads only own data, never a user accessor. */
function field(value: unknown, key: string): unknown {
  if (typeof value !== 'object' || value === null) { return undefined; }
  const descriptor = Object.getOwnPropertyDescriptor(value, key);
  return descriptor !== undefined && 'value' in descriptor ? descriptor.value as unknown : undefined;
}
/** Empty strings remain meaningful wherever the existing semantic reader accepts them. */
function text(value: unknown, detail: string): string { if (typeof value !== 'string') { return malformed(detail); } return value; }
/** Index meaning includes negative zero; no arithmetic or JSON normalization is applied. */
function index(value: unknown): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0) { return malformed('index'); }
  return value;
}
/**
 * Validate an ordinary semantic vector's own surface while preserving holes.
 * Dense structural tuples are checked separately. Present undefined is never a
 * hole: its element reader must decide whether that value belongs to its domain.
 */
function vector(value: unknown): readonly unknown[] {
  if (!Array.isArray(value) || Object.getPrototypeOf(value) !== Array.prototype) { return malformed('vector'); }
  for (const key of Reflect.ownKeys(value)) {
    if (key === 'length') { continue; }
    if (typeof key !== 'string') { return malformed('vector symbol'); }
    const position = Number(key);
    if (!Number.isSafeInteger(position) || position < 0 || String(position) !== key || position >= value.length) { return malformed('vector property'); }
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (descriptor === undefined || !('value' in descriptor) || !descriptor.enumerable) { return malformed('vector slot'); }
  }
  return value as readonly unknown[];
}
/** Copy only occupied own slots; spread and Array.from would destroy hole meaning. */
function mapVector(value: unknown, read: (item: unknown) => unknown): readonly unknown[] {
  const input = vector(value); const result = new Array<unknown>(input.length);
  for (let position = 0; position < input.length; position++) {
    const descriptor = Object.getOwnPropertyDescriptor(input, String(position));
    if (descriptor !== undefined && 'value' in descriptor) {
      const item: unknown = descriptor.value; result[position] = read(item);
    }
  }
  return result;
}
/** A fixed structural tuple cannot omit a slot even when semantic vectors may. */
function tuple(value: unknown, arity: number): readonly unknown[] {
  const result = vector(value);
  if (result.length !== arity) { return malformed('tuple arity'); }
  for (let position = 0; position < arity; position++) { if (!Object.hasOwn(result, position)) { return malformed('tuple hole'); } }
  return result;
}
/** Binding and collection key vectors retain both their order and occupied positions. */
function strings(value: unknown): readonly unknown[] { return mapVector(value, (item) => text(item, 'string vector')); }
/** Property/index distinction and both addresses survive independently. */
function encodeAddress(value: unknown): readonly unknown[] {
  return mapVector(value, (segment) => {
    const kind = field(segment, 'kind');
    if (kind === 'property') { return [0, text(field(segment, 'key'), 'property key')]; }
    if (kind === 'index') { return [1, index(field(segment, 'index'))]; }
    return malformed('address kind');
  });
}
/** Decode a semantic address without densifying its vector or conflating -0 and +0. */
function decodeAddress(value: unknown): readonly unknown[] {
  return mapVector(value, (segment) => {
    const entry = tuple(segment, 2);
    if (entry[0] === 0) { return { kind: 'property', key: text(entry[1], 'property key') }; }
    if (entry[0] === 1) { return { kind: 'index', index: index(entry[1]) }; }
    return malformed('address tag');
  });
}
/** A finite tag table represents only the selected operation, never outer operation policy. */
function operationTag(value: unknown): number {
  const operation = text(value, 'selected operation'); const tag = operations.findIndex((candidate) => candidate === operation);
  if (tag < 0) { return malformed('selected operation'); } return tag;
}
/** Existing fixed selection constants may be represented by the discriminant without loss. */
function version(value: unknown, expected: string): void { if (field(value, 'encodingVersion') !== expected) { malformed('selection encoding version'); } }
/** Pack every request variant; only constants already required by its semantic reader are implicit. */
function encodeSelection(value: unknown): readonly unknown[] {
  switch (field(value, 'kind')) {
    case 'selected': version(value, 'MDO1'); return [0, operationTag(field(value, 'operation')), encodeAddress(field(value, 'address'))];
    case 'implementation': version(value, 'MDF1'); return [1, encodeAddress(field(value, 'address'))];
    case 'materialized-output': version(value, 'MDS1'); return [2, encodeAddress(field(value, 'address'))];
    case 'projection': {
      version(value, 'MDP1'); const descriptor = field(value, 'descriptor'); const traversal = field(descriptor, 'traversal');
      if (field(descriptor, 'operation') !== 'value') { return malformed('projection operation'); }
      const kind = field(traversal, 'kind');
      const packed = kind === 'exhaustive' && field(traversal, 'complete') === true ? [0]
        : kind === 'visited' && field(traversal, 'complete') === false ? [1, strings(field(traversal, 'keys'))] : malformed('projection traversal');
      return [3, encodeAddress(field(descriptor, 'address')), packed];
    }
    case 'collection-order': version(value, 'MDV1'); return [4, strings(field(value, 'keys'))];
    case 'untracked-read': version(value, 'MDU1'); return [5, encodeAddress(field(value, 'address'))];
    default: return malformed('selection kind');
  }
}
/** Expand exact tuple alternatives; an unknown discriminant is corruption, not a guessed selection. */
function decodeSelection(value: unknown): Record<string, unknown> {
  const input = vector(value);
  switch (input[0]) {
    case 0: {
      const entry = tuple(input, 3); const tag = index(entry[1]); const operation = operations[tag];
      if (operation === undefined) { return malformed('selected operation tag'); }
      return { kind: 'selected', operation, address: decodeAddress(entry[2]), encodingVersion: 'MDO1' };
    }
    case 1: return { kind: 'implementation', address: decodeAddress(tuple(input, 2)[1]), encodingVersion: 'MDF1' };
    case 2: return { kind: 'materialized-output', address: decodeAddress(tuple(input, 2)[1]), encodingVersion: 'MDS1' };
    case 3: {
      const entry = tuple(input, 3); const traversal = vector(entry[2]);
      const copied = traversal[0] === 0 ? (tuple(traversal, 1), { kind: 'exhaustive', complete: true })
        : traversal[0] === 1 ? { kind: 'visited', complete: false, keys: strings(tuple(traversal, 2)[1]) } : malformed('projection traversal tag');
      return { kind: 'projection', descriptor: { address: decodeAddress(entry[1]), operation: 'value', traversal: copied }, encodingVersion: 'MDP1' };
    }
    case 4: return { kind: 'collection-order', keys: strings(tuple(input, 2)[1]), encodingVersion: 'MDV1' };
    case 5: return { kind: 'untracked-read', address: decodeAddress(tuple(input, 2)[1]), encodingVersion: 'MDU1' };
    default: return malformed('selection tag');
  }
}
/** Fingerprints are retained evidence, not recomputed authorizations for the encoded fact. */
function fingerprint(value: unknown): string { const result = text(value, 'fingerprint'); if (!/^[0-9a-f]{64}$/u.test(result)) { return malformed('fingerprint'); } return result; }
/** @internal Pack all eight fields, retaining absent/empty text and independent operation/address/kind. */
export function _encodeObservation(value: unknown): unknown {
  const kind = text(field(value, 'kind'), 'observation kind'); const tag = kinds.findIndex((candidate) => candidate === kind);
  if (tag < 0) { return malformed('observation kind'); }
  const selection = encodeSelection(field(value, 'selection')); const encodingVersion = text(field(value, 'encodingVersion'), 'observation version');
  if (field(decodeSelection(selection), 'encodingVersion') !== encodingVersion) { return malformed('observation version'); }
  const encoded = field(value, 'encoded');
  return [strings(field(field(value, 'binding'), 'path')), encodeAddress(field(value, 'address')), selection, tag,
    text(field(value, 'operation'), 'outer operation'), encodingVersion, encoded === undefined ? [] : [text(encoded, 'encoded fact')], fingerprint(field(value, 'fingerprint'))];
}
/** @internal Expand tuples to the existing plain observation spelling; semantic policy stays separate. */
export function _decodeObservation(value: unknown): unknown {
  const entry = tuple(value, 8); const kind = kinds[index(entry[3])]; if (kind === undefined) { return malformed('observation kind tag'); }
  const selection = decodeSelection(entry[2]); const encodingVersion = text(entry[5], 'observation version');
  if (selection['encodingVersion'] !== encodingVersion) { return malformed('observation version'); }
  const option = vector(entry[6]);
  if (option.length > 1 || (option.length === 1 && !Object.hasOwn(option, 0))) { return malformed('encoded option'); }
  const encoded = option.length === 0 ? undefined : text(option[0], 'encoded fact');
  return { binding: { path: strings(entry[0]) }, address: decodeAddress(entry[1]), selection, kind,
    operation: text(entry[4], 'outer operation'), encodingVersion, ...(encoded === undefined ? {} : { encoded }), fingerprint: fingerprint(entry[7]) };
}
/** Variant-specific plain fields keep witnesses opaque and retain their existing semantic spelling. */
function content(value: unknown, semanticVersion: ISemanticVersion, encode: boolean): unknown {
  const observations = mapVector(field(value, 'observations'), encode ? _encodeObservation : _decodeObservation);
  const prefix = { trackingSemantics: 2, ...(encode ? { semanticVersion } : {}), kind: text(field(value, 'kind'), 'provenance kind'), step: field(value, 'step') };
  if (semanticVersion === 1) { return { ...prefix, observations, children: field(value, 'children') }; }
  if (semanticVersion === 2) { return { ...prefix, observations, calls: field(value, 'calls') }; }
  return { ...prefix, over: field(value, 'over'), observations, membership: field(value, 'membership') };
}
/** @internal Encode provenance only, keeping semantic version independent of the wire revision. */
export function _encodeProvenanceContent(value: unknown, semanticVersion: ISemanticVersion): unknown {
  if (field(value, 'trackingSemantics') !== 2) { return malformed('tracking generation'); }
  return content(value, semanticVersion, true);
}
/**
 * @internal Compatibility precedes any semantic-body interpretation. This private
 * reader is not production dispatch and cannot turn an unsupported generation or
 * future semantic variant into integrity damage by inspecting its body first.
 */
export function _readCandidateProvenance(value: unknown): IWireReading {
  if (field(value, 'format') !== 'microdelta.resolution.provenance' || field(value, 'formatVersion') !== 5) { return { status: 'unsupported', detail: 'provenance wire is not supported' }; }
  const stored = field(value, 'content');
  if (field(stored, 'trackingSemantics') !== 2) { return { status: 'unsupported', detail: 'provenance tracking semantics are not supported' }; }
  const semanticVersion = field(stored, 'semanticVersion');
  if (typeof semanticVersion !== 'number' || !Number.isSafeInteger(semanticVersion) || semanticVersion <= 0) { return malformed('semantic version'); }
  if (semanticVersion !== 1 && semanticVersion !== 2 && semanticVersion !== 3 && semanticVersion !== 4) { return { status: 'unsupported', detail: 'provenance semantic variant is not supported' }; }
  return { status: 'supported', semanticVersion, content: content(stored, semanticVersion, false) };
}
