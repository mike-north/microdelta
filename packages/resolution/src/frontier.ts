/**
 * Immutable frontier evidence for one normal consuming request. New captures
 * require the latest eligible offer and live root authority. Existing captures
 * retain their original value through admitted drain; producer stop never
 * rewrites or revokes them. Run disposal ends every remaining capability.
 * This owner stores no History result and decides neither source policy nor
 * member readiness. The coordinator supplies accepted acquisition data and
 * ordinary Resolution consumes the resulting request-bound evidence.
 */
import type { IBindingDescriptor, ITraversalBinding } from '@microdelta/definition';

import { ResolutionError } from './errors.js';

/**
 * Opaque eligibility for one offered frontier; its shape is never authority.
 * @alpha
 */
export interface IFrontierOffer {
  readonly __microdeltaFrontierOffer: unique symbol;
  readonly kind: 'frontier-offer';
}

/**
 * Opaque evidence captured once for a normal request, independent of later
 * offers and of that request's derived History pass keys.
 * @alpha
 */
export interface ICapturedSourceEvidence {
  readonly __microdeltaSourceEvidence: unique symbol;
  readonly kind: 'captured-source-evidence';
}

/** Run and snapshot authority supplied by the existing owning contexts. */
export interface IFrontierCaptureOptions {
  readonly binding: ITraversalBinding;
  readonly owner: object;
  currentOwner(): object | undefined;
  assertRoot(): void;
  /** Detach and freeze supported data without observing an author body. */
  snapshot(value: object): object;
}

/** One producer's frontier lifetime and its immutable normal-request bindings. */
export interface IFrontierCaptures {
  offer(value: object): IFrontierOffer;
  capture(offer: unknown, requestKey: string): ICapturedSourceEvidence;
  /** The key is the original normal request association, never a derived pass key. */
  read(capture: unknown, requestKey: string, collection: IBindingDescriptor): object;
  /** Producer failure ends new roots/captures, leaving owned captures intact for drain. */
  stop(): void;
  /** Called only after owned work drains; every later use refuses. */
  dispose(): void;
}

/** A private capture retains the exact immutable offer and normal request identity. */
interface ICaptureRecord {
  readonly requestKey: string;
  readonly value: object;
}

/** Compare complete correspondence rather than a slot-name prefix or label. */
function sameDescriptor(left: IBindingDescriptor, right: IBindingDescriptor): boolean {
  return left.scope === right.scope && left.role === right.role && left.slot === right.slot
    && left.memberKey === right.memberKey && left.template === right.template && left.collection === right.collection;
}

/** Reject invalid authority before a snapshot, source callback or other consumer can run. */
function refused(reason: string): never {
  throw new ResolutionError('invalid-request', `Captured frontier refused: ${reason}`);
}

/** Bind one declared collection's offer/capture protocol to one actual run identity. */
export function createFrontierCaptures(options: IFrontierCaptureOptions): IFrontierCaptures {
  let offers = new WeakMap<object, object>();
  let captures = new WeakMap<object, ICaptureRecord>();
  let latest: object | undefined;
  let stopped = false;
  let disposed = false;

  /** Existing request evidence checks ownership and disposal, not producer liveness. */
  const assertOwned = (): void => {
    if (disposed || options.currentOwner() !== options.owner) {
      refused('the run is absent, foreign or disposed');
    }
  };

  /** New roots additionally obey the run owner's policy and producer terminal state. */
  const assertCapturable = (): void => {
    assertOwned();
    options.assertRoot();
    if (stopped) { refused('the producer has stopped'); }
  };

  return Object.freeze({
    offer(value: object): IFrontierOffer {
      assertCapturable();
      const frozen = options.snapshot(value);
      const token = Object.freeze({ kind: 'frontier-offer' as const });
      offers.set(token, frozen);
      latest = token;
      // The nominal token is minted and recognized only in this lifetime.
      return token as IFrontierOffer;
    },
    capture(offer: unknown, requestKey: string): ICapturedSourceEvidence {
      assertCapturable();
      if (typeof offer !== 'object' || offer === null || offer !== latest) {
        return refused('the offer is forged, absent, foreign or superseded');
      }
      const value = offers.get(offer);
      if (value === undefined || typeof requestKey !== 'string' || requestKey.length === 0) {
        return refused('the offer or normal request association is invalid');
      }
      const token = Object.freeze({ kind: 'captured-source-evidence' as const });
      captures.set(token, { value, requestKey });
      // No data or association is recoverable from copied public token fields.
      return token as ICapturedSourceEvidence;
    },
    read(capture: unknown, requestKey: string, collection: IBindingDescriptor): object {
      assertOwned();
      const record = typeof capture === 'object' && capture !== null ? captures.get(capture) : undefined;
      if (record === undefined || record.requestKey !== requestKey || !sameDescriptor(collection, options.binding.collection)) {
        return refused('the capture does not belong to this request and declared collection');
      }
      return record.value;
    },
    stop(): void {
      stopped = true;
    },
    dispose(): void {
      disposed = true;
      stopped = true;
      latest = undefined;
      offers = new WeakMap();
      captures = new WeakMap();
    },
  });
}
