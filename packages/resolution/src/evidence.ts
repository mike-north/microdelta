/**
 * Resolution's durable evidence formats. History stores these as versioned
 * opaque records and never interprets them; Resolution alone defines and
 * reads them (plan: "History, host operations and durable records").
 *
 * - **Provenance** (`microdelta.resolution.provenance`, version 1) is the
 *   immutable historical truth of one execution: the step it ran for, the
 *   Tracking observations its own capture recorded (its actually called
 *   implementation, consumed inputs, called helpers and consumed child output
 *   facts) and, for a memo, one entry per direct child call with the
 *   structural witness, the exact child result it read and the output binding
 *   its child observations use. A child's own implementation and reads are in
 *   the child's provenance, never flattened into the parent's.
 * - **Acceptance** (`microdelta.resolution.acceptance`, version 1) records a
 *   current verification of an existing result: its basis and the current
 *   work or children it followed. It never rewrites provenance (RES-007).
 * - **Attempt ending** (`microdelta.resolution.attempt-ending`, version 1)
 *   records why an admitted attempt ended without a new result.
 *
 * A record in an unknown format or version is unsupported evidence, an honest
 * miss. A record that claims this format but whose own structure is malformed
 * is integrity damage. A direct-child witness is kept as untrusted durable data
 * and judged by Definition's reconnection instead: an unknown witness version
 * or argument form, or a malformed witness, cannot justify current
 * correspondence and is an honest miss (REUSE-007), never a guess.
 */
import type { IBindingDescriptor } from '@microdelta/definition';
import type { ICompletedResultReference, ICompletedEnvelope, IVersionedRecord } from '@microdelta/history';
import type { IAddressSegment, ICurrentFactRequest, ITrackingBinding, ITrackingObservation } from '@microdelta/tracking';

import { ResolutionError } from './errors.js';

/** The provenance format identity and its only supported version. */
export const provenanceFormat = 'microdelta.resolution.provenance';
/** The acceptance format identity. */
export const acceptanceFormat = 'microdelta.resolution.acceptance';
/** The attempt-ending format identity. */
export const endingFormat = 'microdelta.resolution.attempt-ending';
/** The version every Resolution record format currently uses. */
export const formatVersion = 1;

/**
 * Tracking binding paths Resolution assigns, as structural correspondence
 * Resolution resolves again for current facts. `self` is the author callback
 * of the step being validated; `inputs` the declared input record; a
 * `callable` path names one declared helper slot; a `child` path names the
 * direct child slot whose output a memo consumed; `previous` is a source's
 * eligible previous result, which is history rather than a current input.
 */
export const bindingPaths = Object.freeze({
  self: Object.freeze(['self']),
  inputs: Object.freeze(['inputs']),
  previous: Object.freeze(['previous']),
  callable: (slot: string): readonly string[] => Object.freeze(['callable', slot]),
  child: (slot: string): readonly string[] => Object.freeze(['child', slot]),
});

/** One recorded direct child call of a memo execution. */
export interface IChildEvidence {
  /** The memo's child slot. */
  readonly slot: string;
  /** The Definition witness, retained as untrusted durable data for reconnection. */
  readonly witness: unknown;
  /** The exact child result the execution read. */
  readonly reference: ICompletedResultReference;
  /** The binding the memo's child output observations use. */
  readonly binding: ITrackingBinding;
}

/** Parsed provenance of one completed result. */
export interface IProvenance {
  readonly kind: 'source' | 'memo';
  readonly step: IBindingDescriptor;
  readonly observations: readonly ITrackingObservation[];
  readonly children: readonly IChildEvidence[];
}

/** The outcome of reading a candidate's provenance. */
export type IProvenanceReading =
  | { readonly status: 'supported'; readonly provenance: IProvenance }
  | { readonly status: 'unsupported'; readonly detail: string };

/** Build the stored provenance record of one execution. */
export function provenanceRecord(provenance: IProvenance): IVersionedRecord {
  return {
    format: provenanceFormat,
    formatVersion,
    content: {
      kind: provenance.kind,
      step: plainDescriptor(provenance.step),
      observations: provenance.observations.map(plainObservation),
      children: provenance.children.map((child) => ({ slot: child.slot, witness: child.witness, reference: plainReference(child.reference), binding: { path: [...child.binding.path] } })),
    },
  };
}

/** Build a stored acceptance record. */
export function acceptanceRecord(content: {
  readonly basis: 'finality' | 'check' | 'validated';
  readonly step: IBindingDescriptor;
  readonly observations?: readonly ITrackingObservation[];
  readonly children?: readonly { readonly slot: string; readonly reference: ICompletedResultReference }[];
}): IVersionedRecord {
  return {
    format: acceptanceFormat,
    formatVersion,
    content: {
      basis: content.basis,
      step: plainDescriptor(content.step),
      observations: (content.observations ?? []).map(plainObservation),
      children: (content.children ?? []).map((child) => ({ slot: child.slot, reference: plainReference(child.reference) })),
    },
  };
}

/** Build a stored attempt-ending record. */
export function endingRecord(content: { readonly ending: 'retained' | 'failed' | 'child-refused' | 'observer-failure'; readonly detail: string; readonly reference?: ICompletedResultReference }): IVersionedRecord {
  return {
    format: endingFormat,
    formatVersion,
    content: {
      ending: content.ending,
      detail: content.detail,
      ...(content.reference === undefined ? {} : { reference: plainReference(content.reference) }),
    },
  };
}

/** An address as plain stored data. */
function plainAddress(address: readonly IAddressSegment[]): Record<string, unknown>[] {
  return address.map((segment) => segment.kind === 'property' ? { kind: 'property', key: segment.key } : { kind: 'index', index: segment.index });
}

/** A Tracking selection as plain stored data. */
function plainSelection(request: ICurrentFactRequest): Record<string, unknown> {
  switch (request.kind) {
    case 'selected':
      return { kind: request.kind, operation: request.operation, address: plainAddress(request.address), encodingVersion: request.encodingVersion };
    case 'implementation':
    case 'materialized-output':
      return { kind: request.kind, address: plainAddress(request.address), encodingVersion: request.encodingVersion };
    case 'projection': {
      const traversal = request.descriptor.traversal;
      return {
        kind: request.kind,
        descriptor: {
          address: plainAddress(request.descriptor.address),
          operation: request.descriptor.operation,
          traversal: traversal.kind === 'exhaustive' ? { kind: 'exhaustive', complete: true } : { kind: 'visited', complete: false, keys: [...traversal.keys] },
        },
        encodingVersion: request.encodingVersion,
      };
    }
    case 'collection-order':
      return { kind: request.kind, keys: [...request.keys], encodingVersion: request.encodingVersion };
    default: {
      const exhaustive: never = request;
      return exhaustive;
    }
  }
}

/**
 * An observation as plain stored data. Tracking shares immutable descriptors
 * between observations; canonical Value encoding stores trees, so every
 * record gets its own copy of each nested part.
 */
function plainObservation(item: ITrackingObservation): Record<string, unknown> {
  return {
    binding: { path: [...item.binding.path] },
    address: plainAddress(item.address),
    selection: plainSelection(item.selection),
    kind: item.kind,
    operation: item.operation,
    encodingVersion: item.encodingVersion,
    ...(item.encoded === undefined ? {} : { encoded: item.encoded }),
    fingerprint: item.fingerprint,
  };
}

/** A descriptor as plain stored data. */
function plainDescriptor(descriptor: IBindingDescriptor): Record<string, string> {
  return {
    scope: descriptor.scope,
    role: descriptor.role,
    slot: descriptor.slot,
    ...(descriptor.memberKey === undefined ? {} : { memberKey: descriptor.memberKey }),
  };
}

/** A reference as plain stored data. */
function plainReference(reference: ICompletedResultReference): Record<string, string> {
  return { kind: reference.kind, locator: reference.locator };
}

/** Integrity damage inside a record that claims a supported Resolution format. */
function malformed(detail: string): never {
  throw new ResolutionError('integrity', `Stored Resolution provenance is malformed: ${detail}`);
}

/** Read one own data property without invoking accessors. */
function field(value: unknown, key: string): unknown {
  if (typeof value !== 'object' || value === null) {
    return undefined;
  }
  const descriptor = Object.getOwnPropertyDescriptor(value, key);
  return descriptor !== undefined && 'value' in descriptor ? descriptor.value as unknown : undefined;
}

/** A nonempty string field. */
function text(value: unknown, what: string): string {
  if (typeof value !== 'string') {
    return malformed(`${what} is not a string`);
  }
  return value;
}

/** A dense array field. */
function list(value: unknown, what: string): readonly unknown[] {
  if (!Array.isArray(value)) {
    return malformed(`${what} is not an array`);
  }
  return value;
}

/** A string array. */
function strings(value: unknown, what: string): readonly string[] {
  return Object.freeze(list(value, what).map((item) => text(item, what)));
}

/** A structured Value address. */
function address(value: unknown): readonly IAddressSegment[] {
  return Object.freeze(list(value, 'address').map((segment): IAddressSegment => {
    const kind = field(segment, 'kind');
    if (kind === 'property') {
      return Object.freeze({ kind: 'property', key: text(field(segment, 'key'), 'address key') });
    }
    const index = field(segment, 'index');
    if (kind === 'index' && typeof index === 'number' && Number.isSafeInteger(index) && index >= 0) {
      return Object.freeze({ kind: 'index', index });
    }
    return malformed('address segment');
  }));
}

/** The selected operations Tracking records. */
const operations = new Set(['value', 'own', 'membership', 'length', 'keys']);

/** One Tracking selection, copied and checked. */
function selection(value: unknown): ICurrentFactRequest {
  const kind = field(value, 'kind');
  const encodingVersion = field(value, 'encodingVersion');
  switch (kind) {
    case 'selected': {
      const operation = field(value, 'operation');
      if (typeof operation !== 'string' || !operations.has(operation) || encodingVersion !== 'MDO1') {
        return malformed('selected request');
      }
      return Object.freeze({ kind, operation: operation as 'value' | 'own' | 'membership' | 'length' | 'keys', address: address(field(value, 'address')), encodingVersion });
    }
    case 'implementation':
      return encodingVersion === 'MDF1' ? Object.freeze({ kind, address: address(field(value, 'address')), encodingVersion }) : malformed('implementation request');
    case 'materialized-output':
      return encodingVersion === 'MDS1' ? Object.freeze({ kind, address: address(field(value, 'address')), encodingVersion }) : malformed('output request');
    case 'projection': {
      const descriptor = field(value, 'descriptor');
      const traversal = field(descriptor, 'traversal');
      const traversalKind = field(traversal, 'kind');
      if (encodingVersion !== 'MDP1' || field(descriptor, 'operation') !== 'value') {
        return malformed('projection request');
      }
      const copied = traversalKind === 'exhaustive' && field(traversal, 'complete') === true
        ? Object.freeze({ kind: 'exhaustive' as const, complete: true as const })
        : traversalKind === 'visited' && field(traversal, 'complete') === false
          ? Object.freeze({ kind: 'visited' as const, complete: false as const, keys: strings(field(traversal, 'keys'), 'projection keys') })
          : malformed('projection traversal');
      return Object.freeze({ kind, descriptor: Object.freeze({ address: address(field(descriptor, 'address')), operation: 'value' as const, traversal: copied }), encodingVersion });
    }
    case 'collection-order':
      return encodingVersion === 'MDV1' ? Object.freeze({ kind, keys: strings(field(value, 'keys'), 'order keys'), encodingVersion }) : malformed('order request');
    default:
      return malformed('selection kind');
  }
}

/** The observation kinds Tracking emits. */
const observationKinds = new Set(['fact', 'implementation', 'materialized-output', 'projection', 'collection-order']);

/**
 * Copy one stored observation into a frozen Tracking observation. Every field
 * Tracking's comparison relies on is checked; anything else is malformed.
 */
export function observation(value: unknown): ITrackingObservation {
  const path = strings(field(field(value, 'binding'), 'path'), 'binding path');
  const kind = field(value, 'kind');
  const operation = field(value, 'operation');
  const fingerprint = field(value, 'fingerprint');
  const encoded = field(value, 'encoded');
  const copiedSelection = selection(field(value, 'selection'));
  if (typeof kind !== 'string' || !observationKinds.has(kind) || typeof operation !== 'string'
    || typeof fingerprint !== 'string' || !/^[0-9a-f]{64}$/u.test(fingerprint)
    || field(value, 'encodingVersion') !== copiedSelection.encodingVersion
    || (encoded !== undefined && typeof encoded !== 'string')) {
    return malformed('observation envelope');
  }
  return Object.freeze({
    binding: Object.freeze({ path }),
    address: address(field(value, 'address')),
    selection: copiedSelection,
    kind: kind as ITrackingObservation['kind'],
    operation: operation as ITrackingObservation['operation'],
    encodingVersion: copiedSelection.encodingVersion,
    ...(typeof encoded === 'string' ? { encoded } : {}),
    fingerprint,
  });
}

/** A stored exact reference. */
function reference(value: unknown): ICompletedResultReference {
  const locator = field(value, 'locator');
  if (field(value, 'kind') !== 'completed-result' || typeof locator !== 'string' || locator.length === 0) {
    return malformed('child reference');
  }
  return Object.freeze({ kind: 'completed-result', locator });
}

/** A stored step descriptor. */
function descriptor(value: unknown): IBindingDescriptor {
  const scope = text(field(value, 'scope'), 'step scope');
  const slot = text(field(value, 'slot'), 'step slot');
  const memberKey = field(value, 'memberKey');
  if (field(value, 'role') !== 'step' || (memberKey !== undefined && typeof memberKey !== 'string')) {
    return malformed('step descriptor');
  }
  return Object.freeze({ scope, role: 'step', slot, ...(memberKey === undefined ? {} : { memberKey }) });
}

/**
 * Read a candidate's provenance. Another format or version is unsupported
 * evidence; this format with malformed content is an integrity failure.
 */
export function readProvenance(envelope: ICompletedEnvelope): IProvenanceReading {
  const record = envelope.provenance;
  if (record.format !== provenanceFormat || record.formatVersion !== formatVersion) {
    return { status: 'unsupported', detail: `provenance ${record.format} version ${String(record.formatVersion)} is not supported` };
  }
  const content = record.content;
  const kind = field(content, 'kind');
  if (kind !== 'source' && kind !== 'memo') {
    return malformed('step kind');
  }
  const slots = new Set<string>();
  const children = list(field(content, 'children'), 'children').map((child): IChildEvidence => {
    const slot = text(field(child, 'slot'), 'child slot');
    const path = strings(field(field(child, 'binding'), 'path'), 'child binding');
    if (slots.has(slot) || path.length !== 2 || path[0] !== 'child' || path[1] !== slot) {
      return malformed('child entry');
    }
    slots.add(slot);
    return Object.freeze({ slot, witness: field(child, 'witness'), reference: reference(field(child, 'reference')), binding: Object.freeze({ path }) });
  });
  const observations = Object.freeze(list(field(content, 'observations'), 'observations').map(observation));
  // Semantic invariants of this format, checked before any comparison, hook,
  // admission or body: every execution Resolution records invoked its own
  // author callback under capture, so its own implementation observation is
  // mandatory; and the bounded M3 model gives sources no child edges. A record
  // that violates them cannot justify reuse. This detects records that break
  // the format's own meaning; it is not a claim to detect arbitrary hostile
  // storage that forges well-formed evidence.
  if (!observations.some(isOwnImplementation)) {
    return malformed(`${kind} provenance lacks its own implementation observation`);
  }
  if (kind === 'source' && children.length > 0) {
    return malformed('source provenance records direct-child edges');
  }
  return {
    status: 'supported',
    provenance: Object.freeze({
      kind,
      step: descriptor(field(content, 'step')),
      observations,
      children: Object.freeze(children),
    }),
  };
}

/** Whether an observation is the step's own author-callback implementation evidence. */
function isOwnImplementation(item: ITrackingObservation): boolean {
  return item.kind === 'implementation' && item.selection.kind === 'implementation' && item.address.length === 0
    && item.binding.path.length === 1 && item.binding.path[0] === bindingPaths.self[0];
}
