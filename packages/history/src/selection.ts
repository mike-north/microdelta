/**
 * Finite exact History selection over existing storage. One request acquires a
 * coordinated physical snapshot, validates owner evidence, detaches its answer
 * and finishes release before returning. No reader or evaluation authority is
 * added to the caller's capabilities.
 * @packageDocumentation
 */
import type { ISha256Capability, ISqliteCoordinatedReadCapability } from '@microdelta/machine';
import { normalizeSelectedFact } from '@microdelta/value';
import type { IAddressSegment, IOperation, ISelectedFact } from '@microdelta/value';

import type { ICompletedResultReference, ISelectedFingerprintRequest, ISelectedFingerprintResolution, ISelectedReadRequest } from './completed-results.js';
import { HistoryIntegrityError } from './durable/errors.js';
import { withHistoryReadSnapshot } from './durable/read-snapshot.js';
import { requireName } from './durable/records.js';
import { completedResultQuery, resolveCompletedResult } from './durable/result-reference.js';
import { validateHistorySchema } from './durable/schema.js';
import { createSelectedIndexReader } from './durable/selected-index.js';

/** An explicit existing storage location and the logical identity it must hold. @alpha */
export interface IHistorySelectionLocation {
  /** Caller-selected persistent database pathname; no store discovery is performed. */
  readonly location: string;
  /** History identity to validate before interpreting any completed result. */
  readonly logicalStore: string;
}

/** Only readonly physical coordination and hashing are granted to this operation. @alpha */
export interface IHistorySelectionOptions extends IHistorySelectionLocation {
  /** A distinct coordinated scope, never a writable or rollback-only fallback. */
  readonly sqlite: ISqliteCoordinatedReadCapability;
  /** The same Value fingerprint semantics used by History's generated index. */
  readonly sha256: ISha256Capability;
}

/** One explicitly selected fact or metadata query over one exact immutable result. @alpha */
export type IHistorySelectionRequest =
  | { readonly kind: 'fact'; readonly reference: ICompletedResultReference; readonly request: ISelectedReadRequest }
  | { readonly kind: 'fingerprint'; readonly reference: ICompletedResultReference; readonly request: ISelectedFingerprintRequest };

/** Immediate detached data; neither branch owns a database or future lazy read. @alpha */
export type IHistorySelectionResult =
  | { readonly kind: 'fact'; readonly selected: ISelectedFact }
  | { readonly kind: 'fingerprint'; readonly resolution: ISelectedFingerprintResolution };

/** Preserve the reference's data now; canonical/store correspondence is checked inside the snapshot. */
function referenceSnapshot(reference: ICompletedResultReference): ICompletedResultReference {
  if (typeof reference !== 'object' || reference === null) {
    throw new HistoryIntegrityError('A completed-result reference must be an object');
  }
  const kind: unknown = Reflect.get(reference, 'kind');
  const locator: unknown = Reflect.get(reference, 'locator');
  if (kind !== 'completed-result' || typeof locator !== 'string') {
    throw new HistoryIntegrityError('A completed-result reference needs kind "completed-result" and a string locator');
  }
  return Object.freeze({ kind, locator });
}

/** Capture canonical structured segments before a host call can change caller-owned metadata. */
function addressSnapshot(presented: readonly IAddressSegment[]): readonly IAddressSegment[] {
  if (!Array.isArray(presented)) { throw new TypeError('History selection needs a structured address'); }
  return Object.freeze(presented.map((segment: unknown): IAddressSegment => {
    if (typeof segment !== 'object' || segment === null) { throw new TypeError('History address segment must be an object'); }
    const kind: unknown = Reflect.get(segment, 'kind');
    if (kind === 'property') {
      const key: unknown = Reflect.get(segment, 'key');
      if (typeof key !== 'string') { throw new TypeError('History property address needs a string key'); }
      return Object.freeze({ kind, key });
    }
    if (kind === 'index') {
      const index: unknown = Reflect.get(segment, 'index');
      if (typeof index !== 'number' || !Number.isSafeInteger(index) || index < 0) { throw new TypeError('History index address needs a nonnegative integer'); }
      return Object.freeze({ kind, index });
    }
    throw new TypeError('Unsupported History address segment');
  }));
}

/** A literal Value operation is selected, never inferred from an answer's truthiness. */
function operationSnapshot(operation: IOperation): IOperation {
  switch (operation) {
    case 'value': case 'own': case 'membership': case 'length': case 'keys': case 'container-kind': return operation;
    default: throw new TypeError('Unsupported History selection operation');
  }
}

/** Copy only selection metadata; author payload and unsupported projection contents are not read. */
function selectionSnapshot(selection: IHistorySelectionRequest): IHistorySelectionRequest {
  const reference = referenceSnapshot(selection.reference);
  if (selection.kind === 'fact') {
    return Object.freeze({ kind: 'fact', reference, request: Object.freeze({ operation: operationSnapshot(selection.request.operation), address: addressSnapshot(selection.request.address) }) });
  }
  if (selection.kind !== 'fingerprint') { throw new TypeError('Unsupported History selection kind'); }
  const request = selection.request;
  switch (request.kind) {
    case 'projection':
      // The current index reports this optional capability unavailable only
      // after exact-reference validation; it never interprets the descriptor.
      return Object.freeze({ kind: 'fingerprint', reference, request: Object.freeze({ kind: 'projection', descriptor: request.descriptor, encoding: request.encoding }) });
    case 'selected':
      return Object.freeze({ kind: 'fingerprint', reference, request: Object.freeze({ kind: 'selected', operation: operationSnapshot(request.operation), address: addressSnapshot(request.address), encoding: request.encoding }) });
    case 'materialized-output':
      return Object.freeze({ kind: 'fingerprint', reference, request: Object.freeze({ kind: 'materialized-output', address: addressSnapshot(request.address), encoding: request.encoding }) });
    default: throw new TypeError('Unsupported History fingerprint request');
  }
}

/** An answer must correspond to the exact operation and ordered address requested. */
function sameAddress(left: readonly IAddressSegment[], right: readonly IAddressSegment[]): boolean {
  return left.length === right.length && left.every((segment, index) => {
    const expected = right[index];
    return segment.kind === 'property'
      ? expected?.kind === 'property' && segment.key === expected.key
      : expected?.kind === 'index' && segment.index === expected.index;
  });
}

/**
 * Answer one exact request without creating, migrating or opening writable
 * History. Success is detached selected data after successful native release,
 * not current acceptance, a latest-result lookup or proof of absent transient
 * native writes. Invalid storage/reference and unavailable fingerprint metadata
 * retain their separate owner meanings.
 * @alpha
 */
export function readHistorySelection(options: IHistorySelectionOptions, presented: IHistorySelectionRequest): IHistorySelectionResult {
  const logicalStore = requireName(options.logicalStore, 'logicalStore');
  const location = requireName(options.location, 'location');
  const selection = selectionSnapshot(presented);
  return withHistoryReadSnapshot(options.sqlite, location, (read): IHistorySelectionResult => {
    validateHistorySchema(read, logicalStore);
    const reference = read.prepare(completedResultQuery);
    const reader = createSelectedIndexReader(read, options.sha256, (exact) =>
      resolveCompletedResult(exact, logicalStore, (resultId) => reference.get(resultId)).resultId);
    if (selection.kind === 'fingerprint') {
      return Object.freeze({ kind: 'fingerprint', resolution: Object.freeze(reader.resolveFingerprint(selection.reference, selection.request)) });
    }
    const selected = normalizeSelectedFact(reader.readSelected(selection.reference, selection.request));
    if (selected.operation !== selection.request.operation || !sameAddress(selected.address, selection.request.address)) {
      throw new HistoryIntegrityError('Selected fact does not correspond to the requested operation and address');
    }
    return Object.freeze({ kind: 'fact', selected });
  });
}
