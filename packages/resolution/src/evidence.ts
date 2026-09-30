/**
 * Resolution's durable evidence formats. History stores these as versioned
 * opaque records and never interprets them; Resolution alone defines and
 * reads them (plan: "History, host operations and durable records").
 *
 * - **Provenance** (`microdelta.resolution.provenance`) is the immutable
 *   historical truth of one execution: the step it ran for and the Tracking
 *   observations its own capture recorded (its actually called implementation,
 *   consumed inputs, called helpers, consumed child output facts and observed
 *   untracked reads). A child's own implementation and reads are in the child's
 *   provenance, never flattened into the parent's.
 *   - Version 1 keeps its M3 meaning: a source, or a memo with one entry per
 *     direct child slot (the version-1 witness, the exact child result it read
 *     and the `child` binding its consumed facts use).
 *   - Version 2 records nested execution (CMP-6/7, REUSE-006): a memo's ordered
 *     calls, each with its version-2 witness (call position and argument
 *     recipes), the exact child result and the `call` binding its consumed
 *     facts use; or a supplied step invoked through a callable slot, whose
 *     argument reads are its own `argument` observations.
 *   - Version 3 records a strict fold (CMP-8, RUN-010): the template step it
 *     consumed (its structural address, so a renamed step or template or a
 *     moved collection is changed correspondence, never a remap), its
 *     membership-and-status fact (every member key it covered in canonical
 *     order, each
 *     `included` with the exact member result it read, or `skipped` by its
 *     gate) and its own observations, whose consumed member facts use one
 *     `entry` binding per included member. Gate observations are never part of
 *     it: a member's included-or-skipped outcome is the fold's evidence, and
 *     the gate's raw reads stay that instance's own evidence.
 *   A new execution writes version 2 exactly when version 1 cannot express it:
 *   a memo whose calls carry version-2 witnesses, or a supplied step; and
 *   version 3 exactly for a strict fold. Sources and M3-shaped memos keep
 *   writing version 1.
 * - **Acceptance** (`microdelta.resolution.acceptance`) records a current
 *   verification of an existing result: its basis and the current work or
 *   children it followed (version 1), the current result of each recorded
 *   call by position (version 2), or the current result of each included
 *   member by key (version 3). It never rewrites provenance (RES-007).
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

/** The provenance format identity. */
export const provenanceFormat = 'microdelta.resolution.provenance';
/** The acceptance format identity. */
export const acceptanceFormat = 'microdelta.resolution.acceptance';
/** The attempt-ending format identity. */
export const endingFormat = 'microdelta.resolution.attempt-ending';
/** The M3 version of every Resolution record format; the only attempt-ending version. */
export const formatVersion = 1;
/** The version of provenance and acceptance records that carry ordered nested calls. */
export const nestedFormatVersion = 2;
/** The version of provenance and acceptance records of a strict fold. */
export const foldFormatVersion = 3;

/**
 * Tracking binding paths Resolution assigns, as structural correspondence
 * Resolution resolves again for current facts. `self` is the author callback
 * of the step being validated; `inputs` the declared input record; a
 * `callable` path names one declared helper slot; a `child` path names the
 * direct child slot whose output an M3-shaped memo consumed; a `call` path
 * names the position of the nested call whose output a nested memo consumed;
 * `argument` is a supplied step's argument list, observed per position;
 * `previous` is a source's eligible previous result, which is history rather
 * than a current input; `member` is a template instance's member record from
 * the current keyed collection, which its gate reads and its forwarded
 * member origins resolve against; an `entry` path names the member key whose
 * result a strict fold's entry delivered, which its consumed member facts use.
 */
export const bindingPaths = Object.freeze({
  self: Object.freeze(['self']),
  inputs: Object.freeze(['inputs']),
  previous: Object.freeze(['previous']),
  argument: Object.freeze(['argument']),
  member: Object.freeze(['member']),
  callable: (slot: string): readonly string[] => Object.freeze(['callable', slot]),
  child: (slot: string): readonly string[] => Object.freeze(['child', slot]),
  call: (index: number): readonly string[] => Object.freeze(['call', String(index)]),
  entry: (key: string): readonly string[] => Object.freeze(['entry', key]),
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

/**
 * One recorded call of a nested memo execution, at its position in the call
 * order. Repeated calls of one slot each have their own position and binding.
 */
export interface ICallEvidence {
  /** Zero-based position in the parent execution's call order. */
  readonly index: number;
  /** The version-2 Definition witness, retained as untrusted durable data for reconnection. */
  readonly witness: unknown;
  /** The exact child result the execution read. */
  readonly reference: ICompletedResultReference;
  /** The binding the memo's consumed facts of this call use: `call`, then the position. */
  readonly binding: ITrackingBinding;
}

/** Parsed version-1 provenance, with its M3 meaning. */
export interface IDirectProvenance {
  readonly version: 1;
  readonly kind: 'source' | 'memo';
  readonly step: IBindingDescriptor;
  readonly observations: readonly ITrackingObservation[];
  readonly children: readonly IChildEvidence[];
}

/**
 * Parsed version-2 provenance: a nested memo with its ordered calls, or a
 * supplied step (whose step is its callable slot descriptor, with no calls).
 */
export interface INestedProvenance {
  readonly version: 2;
  readonly kind: 'memo' | 'supplied';
  readonly step: IBindingDescriptor;
  readonly observations: readonly ITrackingObservation[];
  readonly calls: readonly ICallEvidence[];
}

/**
 * One member of a strict fold's membership-and-status fact: included, with
 * the exact member result its entry delivered, or skipped by its gate.
 */
export type IMembershipEntry =
  | { readonly key: string; readonly status: 'included'; readonly reference: ICompletedResultReference }
  | { readonly key: string; readonly status: 'skipped' };

/**
 * Parsed version-3 provenance: a strict fold with the template step it
 * consumed, its membership-and-status fact in canonical key order and its own
 * observations, whose consumed member facts use `entry` bindings of included
 * members.
 */
export interface IFoldProvenance {
  readonly version: 3;
  readonly kind: 'fold';
  readonly step: IBindingDescriptor;
  /** The consumed template step: a template-bearing descriptor with no member key. */
  readonly over: IBindingDescriptor;
  readonly observations: readonly ITrackingObservation[];
  readonly membership: readonly IMembershipEntry[];
}

/** Parsed provenance of one completed result. */
export type IProvenance = IDirectProvenance | INestedProvenance | IFoldProvenance;

/** The outcome of reading a candidate's provenance. */
export type IProvenanceReading =
  | { readonly status: 'supported'; readonly provenance: IProvenance }
  | { readonly status: 'unsupported'; readonly detail: string };

/** Build the stored provenance record of one execution, in the version its parsed form names. */
export function provenanceRecord(provenance: IProvenance): IVersionedRecord {
  if (provenance.version === foldFormatVersion) {
    return {
      format: provenanceFormat,
      formatVersion: foldFormatVersion,
      content: {
        kind: provenance.kind,
        step: plainDescriptor(provenance.step),
        over: plainDescriptor(provenance.over),
        observations: provenance.observations.map(plainObservation),
        membership: provenance.membership.map((entry) => entry.status === 'included'
          ? { key: entry.key, status: entry.status, reference: plainReference(entry.reference) }
          : { key: entry.key, status: entry.status }),
      },
    };
  }
  if (provenance.version === nestedFormatVersion) {
    return {
      format: provenanceFormat,
      formatVersion: nestedFormatVersion,
      content: {
        kind: provenance.kind,
        step: plainDescriptor(provenance.step),
        observations: provenance.observations.map(plainObservation),
        calls: provenance.calls.map((call) => ({ index: call.index, witness: call.witness, reference: plainReference(call.reference), binding: { path: [...call.binding.path] } })),
      },
    };
  }
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

/**
 * Build a stored acceptance record. Naming the current result of each
 * included member by key (a strict fold's validation) writes version 3;
 * naming the current result of each recorded call by position (a nested
 * memo's validation) writes version 2; otherwise the M3 version 1.
 */
export function acceptanceRecord(content: {
  readonly basis: 'finality' | 'check' | 'validated';
  readonly step: IBindingDescriptor;
  readonly observations?: readonly ITrackingObservation[];
  readonly children?: readonly { readonly slot: string; readonly reference: ICompletedResultReference }[];
  readonly calls?: readonly { readonly index: number; readonly reference: ICompletedResultReference }[];
  readonly members?: readonly { readonly key: string; readonly reference: ICompletedResultReference }[];
}): IVersionedRecord {
  if (content.members !== undefined) {
    return {
      format: acceptanceFormat,
      formatVersion: foldFormatVersion,
      content: {
        basis: content.basis,
        step: plainDescriptor(content.step),
        observations: (content.observations ?? []).map(plainObservation),
        members: content.members.map((member) => ({ key: member.key, reference: plainReference(member.reference) })),
      },
    };
  }
  if (content.calls !== undefined) {
    return {
      format: acceptanceFormat,
      formatVersion: nestedFormatVersion,
      content: {
        basis: content.basis,
        step: plainDescriptor(content.step),
        observations: (content.observations ?? []).map(plainObservation),
        calls: content.calls.map((call) => ({ index: call.index, reference: plainReference(call.reference) })),
      },
    };
  }
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

/**
 * Build a stored attempt-ending record. `stopped` records that run
 * cancellation interrupted the attempt or discarded its output before the
 * publication commit (RUN-014/015); the other endings keep their M3 meaning.
 */
export function endingRecord(content: { readonly ending: 'retained' | 'failed' | 'child-refused' | 'observer-failure' | 'stopped'; readonly detail: string; readonly reference?: ICompletedResultReference }): IVersionedRecord {
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
    case 'untracked-read':
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

/** A descriptor as plain stored data, keeping every structural field it carries. */
export function plainDescriptor(descriptor: IBindingDescriptor): Record<string, string> {
  return {
    scope: descriptor.scope,
    role: descriptor.role,
    slot: descriptor.slot,
    ...(descriptor.memberKey === undefined ? {} : { memberKey: descriptor.memberKey }),
    ...(descriptor.template === undefined ? {} : { template: descriptor.template }),
    ...(descriptor.collection === undefined ? {} : { collection: descriptor.collection }),
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
    case 'untracked-read':
      return encodingVersion === 'MDU1' ? Object.freeze({ kind, address: address(field(value, 'address')), encodingVersion }) : malformed('untracked-read request');
    default:
      return malformed('selection kind');
  }
}

/** The observation kinds Tracking emits. */
const observationKinds = new Set(['fact', 'implementation', 'materialized-output', 'projection', 'collection-order', 'untracked-read']);

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

/**
 * A stored step descriptor: an M3 member or composition-level step, or a
 * template instance, which also carries its nonempty template slot and
 * collection binding. Descriptors without template fields read exactly as in
 * M3; a record with only one template field is malformed.
 */
function descriptor(value: unknown): IBindingDescriptor {
  const scope = text(field(value, 'scope'), 'step scope');
  const slot = text(field(value, 'slot'), 'step slot');
  const memberKey = field(value, 'memberKey');
  const template = field(value, 'template');
  const collection = field(value, 'collection');
  if (field(value, 'role') !== 'step' || (memberKey !== undefined && typeof memberKey !== 'string')) {
    return malformed('step descriptor');
  }
  const keyed = memberKey === undefined ? {} : { memberKey };
  if (template === undefined && collection === undefined) {
    return Object.freeze({ scope, role: 'step', slot, ...keyed });
  }
  if (typeof template !== 'string' || template.length === 0 || typeof collection !== 'string' || collection.length === 0) {
    return malformed('template step descriptor');
  }
  return Object.freeze({ scope, role: 'step', slot, ...keyed, template, collection });
}

/**
 * A stored version-2 step descriptor: a memo's step slot, or a supplied
 * step's composition-wide callable slot (which never carries a member key).
 */
function nestedDescriptor(value: unknown, kind: 'memo' | 'supplied'): IBindingDescriptor {
  if (kind === 'memo') {
    return descriptor(value);
  }
  const scope = text(field(value, 'scope'), 'slot scope');
  const slot = text(field(value, 'slot'), 'slot name');
  if (field(value, 'role') !== 'callable' || field(value, 'memberKey') !== undefined) {
    return malformed('supplied step slot descriptor');
  }
  return Object.freeze({ scope, role: 'callable', slot });
}

/**
 * Read a candidate's provenance. Another format or version is unsupported
 * evidence; a supported version with malformed content is an integrity failure.
 */
export function readProvenance(envelope: ICompletedEnvelope): IProvenanceReading {
  const record = envelope.provenance;
  if (record.format === provenanceFormat) {
    switch (record.formatVersion) {
      case formatVersion:
        return readDirect(record.content);
      case nestedFormatVersion:
        return readNested(record.content);
      case foldFormatVersion:
        return readFold(record.content);
      default:
        break;
    }
  }
  return { status: 'unsupported', detail: `provenance ${record.format} version ${String(record.formatVersion)} is not supported` };
}

/** Read version-1 provenance with its M3 meaning, unchanged. */
function readDirect(content: unknown): IProvenanceReading {
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
      version: formatVersion,
      kind,
      step: descriptor(field(content, 'step')),
      observations,
      children: Object.freeze(children),
    }),
  };
}

/**
 * Read version-2 provenance. Beyond the observation envelope, its own meaning
 * requires: a memo or supplied kind; each call at the position its index
 * names, bound at `call` and that position; every consumed call fact bound to
 * a recorded call (an unmatched one could never be compared); a supplied step
 * with no calls; and the step's own implementation observation.
 */
function readNested(content: unknown): IProvenanceReading {
  const kind = field(content, 'kind');
  if (kind !== 'memo' && kind !== 'supplied') {
    return malformed('nested step kind');
  }
  const calls = list(field(content, 'calls'), 'calls').map((call, position): ICallEvidence => {
    const path = strings(field(field(call, 'binding'), 'path'), 'call binding');
    if (field(call, 'index') !== position || path.length !== 2 || path[0] !== 'call' || path[1] !== String(position)) {
      return malformed('call entry');
    }
    return Object.freeze({ index: position, witness: field(call, 'witness'), reference: reference(field(call, 'reference')), binding: Object.freeze({ path }) });
  });
  const observations = Object.freeze(list(field(content, 'observations'), 'observations').map(observation));
  if (!observations.some(isOwnImplementation)) {
    return malformed(`${kind} provenance lacks its own implementation observation`);
  }
  if (kind === 'supplied' && calls.length > 0) {
    return malformed('supplied step provenance records calls');
  }
  const recorded = new Set(calls.map((call) => String(call.index)));
  if (observations.some((item) => item.binding.path[0] === 'call' && (item.binding.path.length !== 2 || !recorded.has(item.binding.path[1] ?? '')))) {
    return malformed('a consumed call fact names no recorded call');
  }
  return {
    status: 'supported',
    provenance: Object.freeze({
      version: nestedFormatVersion,
      kind,
      step: nestedDescriptor(field(content, 'step'), kind),
      observations,
      calls: Object.freeze(calls),
    }),
  };
}

/**
 * A stored fold step descriptor: a composition-level step, which never
 * carries a member key or template fields.
 */
function foldDescriptor(value: unknown): IBindingDescriptor {
  const step = descriptor(value);
  if (step.memberKey !== undefined || step.template !== undefined || step.collection !== undefined) {
    return malformed('fold step descriptor');
  }
  return step;
}

/**
 * A stored consumed template step: a template-bearing step descriptor (its
 * template slot and collection binding present) that addresses the template
 * step itself, so it never carries a member key.
 */
function overDescriptor(value: unknown): IBindingDescriptor {
  const step = descriptor(value);
  if (step.template === undefined || step.collection === undefined || step.memberKey !== undefined) {
    return malformed('consumed template step descriptor');
  }
  return step;
}

/**
 * Read version-3 provenance. Beyond the observation envelope, its own meaning
 * requires: the `fold` kind; the consumed template step, a template-bearing
 * descriptor with no member key; a membership-and-status fact whose keys are
 * nonempty, unique and in strictly ascending canonical (code-unit) order, each
 * `included` with an exact reference or `skipped` with none; every consumed
 * member fact bound at `entry` and an included member's key (a skipped member
 * has no data to consume); and the fold's own implementation observation.
 */
function readFold(content: unknown): IProvenanceReading {
  if (field(content, 'kind') !== 'fold') {
    return malformed('fold step kind');
  }
  let previous: string | undefined;
  const membership = list(field(content, 'membership'), 'membership').map((entry): IMembershipEntry => {
    const key = text(field(entry, 'key'), 'member key');
    if (key.length === 0 || (previous !== undefined && !(previous < key))) {
      return malformed('membership keys are not unique and in canonical order');
    }
    previous = key;
    const status = field(entry, 'status');
    if (status === 'included') {
      return Object.freeze({ key, status, reference: reference(field(entry, 'reference')) });
    }
    if (status === 'skipped' && field(entry, 'reference') === undefined) {
      return Object.freeze({ key, status });
    }
    return malformed('membership entry');
  });
  const observations = Object.freeze(list(field(content, 'observations'), 'observations').map(observation));
  if (!observations.some(isOwnImplementation)) {
    return malformed('fold provenance lacks its own implementation observation');
  }
  const included = new Set(membership.flatMap((entry) => entry.status === 'included' ? [entry.key] : []));
  if (observations.some((item) => item.binding.path[0] === 'entry' && (item.binding.path.length !== 2 || !included.has(item.binding.path[1] ?? '')))) {
    return malformed('a consumed member fact names no included member');
  }
  return {
    status: 'supported',
    provenance: Object.freeze({
      version: foldFormatVersion,
      kind: 'fold',
      step: foldDescriptor(field(content, 'step')),
      over: overDescriptor(field(content, 'over')),
      observations,
      membership: Object.freeze(membership),
    }),
  };
}

/** Whether an observation is the step's own author-callback implementation evidence. */
function isOwnImplementation(item: ITrackingObservation): boolean {
  return item.kind === 'implementation' && item.selection.kind === 'implementation' && item.address.length === 0
    && item.binding.path.length === 1 && item.binding.path[0] === bindingPaths.self[0];
}
