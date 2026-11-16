/**
 * One declared root page source bound to one run. Query values come from the
 * fixed declared input; a continuation can come only from the latest accepted
 * page. This protocol never accepts a caller-selected slot or raw cursor and
 * never resets a traversal after failure. Normal source policy, admission and
 * publication remain behind the injected Resolution port. Captured request
 * evidence stays usable through admitted drain until this lifetime disposes.
 */
import type { IBindingDescriptor, ITraversalBinding } from '@microdelta/definition';
import type { ICompletedResultReference, IWriterLease } from '@microdelta/history';

import type { IResolutionOutcome } from './contracts.js';
import { ResolutionError } from './errors.js';
import { createFrontierCaptures } from './frontier.js';
import type { ICapturedSourceEvidence, IFrontierCaptures, IFrontierOffer } from './frontier.js';

/** Live run identity and root admission belong to Run Supervision. @alpha */
export interface ITraversalRunAuthority {
  currentOwner(): object | undefined;
  assertRoot(): void;
}

/** A current accepted page, minted only after the normal source port succeeded. @alpha */
export interface IAcquiredPage {
  readonly __microdeltaAcquiredPage: unique symbol;
  readonly kind: 'acquired-page';
  readonly reference: ICompletedResultReference;
  readonly data: object;
}

/** A next cursor justified by one exact current predecessor, never a raw argument. @alpha */
export interface ITraversalContinuation {
  readonly __microdeltaTraversalContinuation: unique symbol;
  readonly kind: 'traversal-continuation';
}

/** A normal consuming request's captured source evidence, not a mutable producer view. @alpha */
export interface IRequestSourceEvidence {
  readonly __microdeltaRequestSourceEvidence: unique symbol;
  readonly kind: 'request-source-evidence';
}

/** Normal request storage authority and an optional validated predecessor cursor. @alpha */
export interface ITraversalPageRequest {
  readonly requestKey: string;
  readonly lease: IWriterLease;
  readonly continuation?: ITraversalContinuation;
}

/** Admission refusal remains typed rather than becoming a page or successful empty result. @alpha */
export type ITraversalPageOutcome =
  | { readonly kind: 'accepted'; readonly page: IAcquiredPage; readonly outcome: Extract<IResolutionOutcome, { readonly kind: 'published' | 'reused' }> }
  | { readonly kind: 'refused'; readonly outcome: Extract<IResolutionOutcome, { readonly kind: 'refused' }> };

/** The restricted protocol Supervision coordinates; none of its methods publish directly. @alpha */
export interface IRootAcquisition {
  readonly binding: ITraversalBinding;
  acquire(request: ITraversalPageRequest): Promise<ITraversalPageOutcome>;
  continuation(page: IAcquiredPage, path: readonly string[]): ITraversalContinuation;
  offer(page: IAcquiredPage, evidence: object): IFrontierOffer;
  capture(offer: IFrontierOffer, normalRequestKey: string): IRequestSourceEvidence;
  /** End healthy acquisition without revoking the latest closed frontier's capture eligibility. */
  complete(): void;
  /** Producer failure prevents every new page/offer/capture; existing request bindings drain. */
  stop(): void;
  dispose(): void;
}

/** Run-bound entry for the one declared relationship, separate from parent-only invocation dispatch. @alpha */
export interface ITraversalResolutionPort {
  open(witness: unknown): IRootAcquisition;
  /** Run exit invalidates all remaining traversal/capture capabilities after owned drain. */
  dispose(): void;
}

/** Only the engine can supply the current query, source policy and exact page read. */
export interface IRootAcquisitionOptions {
  readonly composition: object;
  readonly binding: ITraversalBinding;
  readonly owner: object;
  readonly authority: ITraversalRunAuthority;
  query(): unknown;
  snapshot(value: object): object;
  acquire(request: ITraversalPageRequest, values: readonly unknown[]): Promise<IResolutionOutcome>;
  read(reference: ICompletedResultReference): unknown;
}

/** A source-evidence token retains correspondence and a private capture, never copied fields. */
interface IRequestEvidenceRecord {
  readonly composition: object;
  readonly binding: ITraversalBinding;
  readonly normalRequestKey: string;
  readonly captures: IFrontierCaptures;
  readonly capture: ICapturedSourceEvidence;
}

/** Tokens are recognized across engine calls without granting data access through their shape. */
const requestEvidence = new WeakMap<object, IRequestEvidenceRecord>();

/** The normal request context keeps this immutable association for all its descendants. */
export interface IBoundSourceEvidence {
  readonly binding: ITraversalBinding;
  readonly value: object;
}

/** Complete structural correspondence includes absence of member/template qualification. */
function sameDescriptor(left: IBindingDescriptor, right: IBindingDescriptor): boolean {
  return left.scope === right.scope && left.role === right.role && left.slot === right.slot
    && left.memberKey === right.memberKey && left.template === right.template && left.collection === right.collection;
}

/** Refuse before an invalid authority can reach the source or its consumer. */
function refused(reason: string): never {
  throw new ResolutionError('invalid-request', `Root acquisition refused: ${reason}`);
}

/** Read a fixed own-data cursor path in an already frozen supported page. */
function cursorAt(value: object, path: readonly string[]): string {
  let selected: unknown = value;
  for (const key of path) {
    if (typeof key !== 'string' || typeof selected !== 'object' || selected === null) {
      return refused('a continuation path must select an own page field');
    }
    const field = Object.getOwnPropertyDescriptor(selected, key);
    if (field === undefined || !('value' in field)) {
      return refused('a continuation path must select an own data field');
    }
    selected = field.value;
  }
  return typeof selected === 'string' && selected.length > 0 ? selected : refused('a continuation must be a nonempty advertised cursor');
}

/** Bind one exact source and its immutable request captures to current run authority. */
export function createRootAcquisition(options: IRootAcquisitionOptions): IRootAcquisition {
  const captures = createFrontierCaptures({
    binding: options.binding, owner: options.owner,
    currentOwner: () => options.authority.currentOwner(), assertRoot: () => options.authority.assertRoot(),
    snapshot: value => options.snapshot(value),
  });
  const pages = new WeakSet<object>();
  const continuations = new WeakMap<object, { readonly predecessor: IAcquiredPage; readonly value: string; used: boolean }>();
  let last: IAcquiredPage | undefined;
  let offered: IAcquiredPage | undefined;
  let started = false;
  let active = false;
  let terminal = false;
  let stopped = false;
  let disposed = false;

  /** Healthy producer closure still allows a current closed frontier to be captured. */
  const assertRoot = (): void => {
    if (disposed || stopped || options.authority.currentOwner() !== options.owner) {
      refused('the run is absent, foreign, stopped or disposed');
    }
    options.authority.assertRoot();
  };

  return Object.freeze({
    binding: options.binding,
    async acquire(request: ITraversalPageRequest): Promise<ITraversalPageOutcome> {
      assertRoot();
      if (terminal || active) { return refused('acquisition has ended or another page is active'); }
      let cursor: string | undefined;
      if (started) {
        const token = request.continuation;
        const continuation = token === undefined ? undefined : continuations.get(token);
        if (continuation === undefined || continuation.used || continuation.predecessor !== last) {
          return refused('another page requires its current accepted predecessor');
        }
        cursor = continuation.value;
        continuation.used = true;
      } else if (request.continuation !== undefined) {
        return refused('a root page cannot import a continuation');
      }
      started = true;
      active = true;
      try {
        const outcome = await options.acquire(request, Object.freeze([options.query(), cursor]));
        if (outcome.kind === 'refused') {
          stopped = true;
          captures.stop();
          return Object.freeze({ kind: 'refused', outcome });
        }
        if (outcome.kind !== 'published' && outcome.kind !== 'reused') {
          return refused('a page source did not produce an accepted source result');
        }
        const data = options.read(outcome.reference);
        if (typeof data !== 'object' || data === null) {
          throw new ResolutionError('integrity', 'An accepted page must have a supported object result');
        }
        const token = Object.freeze({ kind: 'acquired-page' as const, reference: outcome.reference, data: options.snapshot(data) });
        // The accepted result and its data are minted together, never from a caller's reference.
        const page = token as IAcquiredPage;
        pages.add(page);
        last = page;
        return Object.freeze({ kind: 'accepted', page, outcome });
      } catch (error: unknown) {
        stopped = true;
        captures.stop();
        throw error;
      } finally {
        active = false;
      }
    },
    continuation(page: IAcquiredPage, path: readonly string[]): ITraversalContinuation {
      assertRoot();
      if (terminal || active || !pages.has(page) || page !== last) {
        return refused('a continuation needs the current accepted predecessor');
      }
      const token = Object.freeze({ kind: 'traversal-continuation' as const });
      continuations.set(token, { predecessor: page, value: cursorAt(page.data, path), used: false });
      // A cursor's predecessor association exists only in the owning registry.
      return token as ITraversalContinuation;
    },
    offer(page: IAcquiredPage, evidence: object): IFrontierOffer {
      assertRoot();
      if (terminal || !pages.has(page) || page !== last || page === offered) {
        return refused('an offer needs one unoffered current accepted page');
      }
      const token = captures.offer(evidence);
      offered = page;
      return token;
    },
    capture(offer: IFrontierOffer, normalRequestKey: string): IRequestSourceEvidence {
      assertRoot();
      const capture = captures.capture(offer, normalRequestKey);
      const token = Object.freeze({ kind: 'request-source-evidence' as const });
      requestEvidence.set(token, { composition: options.composition, binding: options.binding, normalRequestKey, captures, capture });
      // The token carries no mutable population or reconstructible authority.
      return token as IRequestSourceEvidence;
    },
    complete(): void {
      assertRoot();
      if (terminal || active || last === undefined || offered !== last) {
        return refused('healthy acquisition closure requires its current offered page');
      }
      terminal = true;
    },
    stop(): void {
      stopped = true;
      captures.stop();
    },
    dispose(): void {
      disposed = true;
      stopped = true;
      captures.dispose();
    },
  });
}

/** Reconnect immutable evidence only for its original request, composition and strict fold. */
export function readRequestSourceEvidence(
  evidence: unknown,
  composition: object,
  normalRequestKey: string,
  fold: IBindingDescriptor,
): IBoundSourceEvidence {
  const record = typeof evidence === 'object' && evidence !== null ? requestEvidence.get(evidence) : undefined;
  if (record === undefined || record.composition !== composition || record.normalRequestKey !== normalRequestKey
    || !sameDescriptor(fold, record.binding.fold)) {
    return refused('source evidence belongs to another request, composition or relationship');
  }
  return Object.freeze({ binding: record.binding, value: record.captures.read(record.capture, normalRequestKey, record.binding.collection) });
}
