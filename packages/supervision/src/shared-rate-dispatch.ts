/**
 * The narrow bridge from explicit operation association to shared admission.
 * Coordinator state stays assembly-owned; operation journals, retry allowance
 * and transport authority retain their separate Supervision owners.
 */
import { SupervisionError } from './errors.js';
import type { IRunElapsedClock, ISharedRateAdmission, ISharedRateCoordinator, ISharedRateSurface } from './shared-rate-coordinator.js';

/** One assembly's coordinator and the same duration clock used by its ledger. @alpha */
export interface ISharedRateDispatchOptions {
  /** Shared across every composed run/path that uses this owner. */
  readonly coordinator: ISharedRateCoordinator;
  /** Maps elapsed wake hints to timer estimates; a wake never authorizes send. */
  readonly elapsedClock: IRunElapsedClock;
}

/** A source's explicit attribution, never a caller-selected admission subset. @alpha */
export interface IOperationSharedRate {
  /** An opaque handle issued by this assembly's coordinator. */
  readonly surface: ISharedRateSurface;
  /**
   * One registered gate that the adapter knows owns a contextual refusal.
   * Reserved `base` covers every surface in this environment/service/access
   * domain; narrower signals require an explicitly named narrower membership.
   */
  readonly cooldownGateId: string;
  /** Exact or conservative pre-send quantity; required by every quantity gate. */
  readonly quantityCost?: number;
}

/** A shape check preserves object identity; owner validation remains mandatory. */
function surfaceShape(value: unknown): value is ISharedRateSurface {
  return typeof value === 'object' && value !== null && typeof Reflect.get(value, 'id') === 'string';
}

/** Capture association primitives once while preserving opaque handle identity. @internal */
export function capturedSharedRate(value: unknown): IOperationSharedRate | undefined {
  if (value === undefined) { return undefined; }
  try {
    if (typeof value === 'object' && value !== null) {
      const surface: unknown = Reflect.get(value, 'surface');
      const cooldownGateId: unknown = Reflect.get(value, 'cooldownGateId');
      const quantityCost: unknown = Reflect.get(value, 'quantityCost');
      if (surfaceShape(surface)
        && typeof cooldownGateId === 'string' && cooldownGateId.trim().length > 0
        && (quantityCost === undefined || (typeof quantityCost === 'number' && Number.isSafeInteger(quantityCost) && quantityCost > 0))) {
        // The shape check does not authenticate a handle: validateAssociation
        // subsequently resolves this exact object in its coordinator owner.
        return Object.freeze({ surface, cooldownGateId, ...(quantityCost === undefined ? {} : { quantityCost }) });
      }
    }
  } catch {
    // Accessor failures cannot expose author values in framework diagnostics.
  }
  throw new SupervisionError('invalid-request', 'An operation has a malformed shared-rate association');
}

/** A final gate changed after provisional admission; nothing has been sent. @internal */
export class SharedRateWait extends Error {
  /** Retain the independent epoch/elapsed wake hints without granting send authority. */
  public constructor(public readonly admission: Extract<ISharedRateAdmission, { readonly kind: 'wait' }>) {
    super('Shared admission must be reconsidered before transport');
  }
}

/** Compare exact captured association evidence for a continuing private run. @internal */
export function sameSharedRate(left: IOperationSharedRate | undefined, right: IOperationSharedRate | undefined): boolean {
  return left?.surface === right?.surface && left?.cooldownGateId === right?.cooldownGateId && left?.quantityCost === right?.quantityCost;
}
