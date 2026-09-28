/**
 * Source outcome control envelopes (RES-004, REUSE-004). A source's check or
 * retrieval returns either fresh data or an explicit retention of its eligible
 * previous result. Both are frozen envelopes minted here and recognized only
 * by this module's private registry, so no author payload, however it is
 * shaped, can be mistaken for a control: returning `{ kind: 'retain' }` data or
 * an object resembling an envelope is an invalid outcome, not a retention.
 * Payload equality and object identity are never controls either; fresh data
 * equal to the previous result is still a new publication.
 */
import type { IPreviousResult } from './family.js';

/**
 * Nominal brand for Resolution-minted outcome envelopes. It has no runtime
 * property; runtime authority is this module's private registry.
 * @alpha
 */
export interface ISourceOutcomeBrand<T> {
  readonly __microdeltaSourceOutcome: unique symbol;
  readonly __microdeltaSourceResult?: (result: T) => T;
}

/**
 * A minted source outcome. `fresh` carries data for a new publication;
 * `retain` names the eligible previous carrier the check accepted.
 * @alpha
 */
export type ISourceOutcome<T> = ISourceOutcomeBrand<T> & (
  | { readonly kind: 'fresh'; readonly data: T }
  | { readonly kind: 'retain'; readonly previous: IPreviousResult<T> }
);

/** Every envelope this module minted, with the form it was minted as. */
const minted = new WeakMap<object, IMintedOutcome>();

/** The registry's record of one minted envelope. */
export type IMintedOutcome =
  | { readonly kind: 'fresh'; readonly data: unknown }
  | { readonly kind: 'retain'; readonly previous: unknown };

/** Freeze and register an envelope; the brand is type-level only. */
function mint<T>(envelope: IMintedOutcome): ISourceOutcome<T> {
  Object.freeze(envelope);
  minted.set(envelope, envelope);
  // This module is the sole minting authority; the registry, not the cast, is runtime truth.
  return envelope as ISourceOutcome<T>;
}

/**
 * Constructors for the only outcomes a source may return.
 * @alpha
 */
export interface ISourceOutcomes {
  /**
   * Supply fresh data for a new completed result, even when it equals the
   * previous result's content.
   */
  fresh<T>(data: T): ISourceOutcome<T>;
  /**
   * Explicitly retain the eligible previous result the source received. Only
   * the carrier Resolution passed to this invocation is accepted.
   */
  retain<T>(previous: IPreviousResult<T>): ISourceOutcome<T>;
}

/**
 * The outcome constructors. Source callbacks receive them as `outcome` in
 * their context; helpers acting as source adapters may import them.
 * @alpha
 */
export const sourceOutcome: ISourceOutcomes = Object.freeze({
  /**
   * Supply fresh data for a new completed result, even when it equals the
   * previous result's content.
   * @param data - Supported Value data with a record or array root.
   * @returns A minted fresh-data envelope.
   */
  fresh<T>(data: T): ISourceOutcome<T> {
    return mint<T>({ kind: 'fresh', data });
  },
  /**
   * Explicitly retain the eligible previous result the source received. Only
   * the carrier Resolution passed to this invocation is accepted; any other
   * value fails the resolution as an invalid retention.
   * @param previous - The `previous` carrier from this source's context.
   * @returns A minted retention envelope.
   */
  retain<T>(previous: IPreviousResult<T>): ISourceOutcome<T> {
    return mint<T>({ kind: 'retain', previous });
  },
});

/**
 * The registry record of a genuine envelope, or undefined for anything else,
 * including look-alike objects and payloads shaped like envelopes.
 * @param value - A value a source returned.
 * @returns The minted form, when the value is a genuine envelope.
 */
export function mintedOutcome(value: unknown): IMintedOutcome | undefined {
  return typeof value === 'object' && value !== null ? minted.get(value) : undefined;
}
