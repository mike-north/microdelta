/**
 * Exact completed-snapshot reading contracts used by Materialization. These
 * interfaces locate immutable results but neither implement a backend nor decide
 * freshness, publication, authorization, or candidate eligibility.
 * @packageDocumentation
 */
import type {
  IAddressSegment,
  IOperation,
  ISelectedFact,
  IValueProjectionDescriptor,
  IValueProjectionFact,
} from '@microdelta/value';

/**
 * A caller-visible locator for one completed immutable snapshot. The opaque
 * locator carries whatever analysis and environment scope its reader requires;
 * it is never a payload or a request to follow a current pointer.
 * @alpha
 */
export interface ICompletedResultReference {
  /** Dispatches resolution to the completed-result contract. */
  readonly kind: 'completed-result';
  /** Opaque exact snapshot locator interpreted only by its injected reader. */
  readonly locator: string;
}

/** A selected Value-owned scalar fact requested at an exact retained address. @alpha */
export interface ISelectedReadRequest {
  /** The literal operation whose fact is requested. */
  readonly operation: IOperation;
  /** Container-aware path within this selected result value. */
  readonly address: readonly IAddressSegment[];
}

/**
 * Metadata lookup is scoped to the exact result reference and full requested
 * selection. The encoding tag prevents an indexed digest from another semantic
 * version being mistaken for this selection.
 * @alpha
 */
export type ISelectedFingerprintRequest =
  | {
      readonly kind: 'selected';
      readonly operation: IOperation;
      readonly address: readonly IAddressSegment[];
      readonly encoding: 'MDO1';
    }
  | {
      readonly kind: 'projection';
      readonly descriptor: IValueProjectionDescriptor;
      readonly encoding: 'MDP1';
    }
  | {
      readonly kind: 'materialized-output';
      readonly address: readonly IAddressSegment[];
      readonly encoding: 'MDS1';
    };

/** Explicit results keep absent or incompatible metadata from implying equality. @alpha */
export type ISelectedFingerprintResolution =
  | { readonly kind: 'compatible'; readonly fingerprint: string }
  | { readonly kind: 'unavailable' }
  | { readonly kind: 'incompatible' }
  | { readonly kind: 'ambiguous' };

/**
 * Synchronous scalar access and fingerprint-only resolution for one exact
 * completed snapshot. A compatible fingerprint answer must be backed by the
 * same semantics as a selected read; resolving metadata never reads payload.
 * @alpha
 */
export interface ICompletedResultReader {
  /** Read the requested fact from exactly this reference, never from current. */
  readSelected(reference: ICompletedResultReference, request: ISelectedReadRequest): ISelectedFact;
  /** Resolve matching metadata only; unavailable metadata does not trigger a read. */
  resolveFingerprint(
    reference: ICompletedResultReference,
    request: ISelectedFingerprintRequest,
  ): ISelectedFingerprintResolution;
}

/**
 * Optional capability for readers that can supply an exact keyed projection as
 * selected member values. Scalar readers do not need to implement projections.
 * @alpha
 */
export interface ICompletedProjectionReader {
  /** Read only the projection's requested address and keyed selected values. */
  readProjection(
    reference: ICompletedResultReference,
    descriptor: IValueProjectionDescriptor,
  ): IValueProjectionFact;
}
