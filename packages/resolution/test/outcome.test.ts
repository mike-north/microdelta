/**
 * Source outcome control envelopes (RES-004): only Resolution-minted envelopes
 * are controls. Payloads that merely resemble an envelope, including frozen
 * look-alikes and copies of genuine envelopes, are never recognized, so every
 * supported author payload stays distinguishable from an explicit retention.
 *
 * @see ../../../docs/spec/execution.md (RES-004, REUSE-004)
 */
import { describe, expect, test } from '@jest/globals';

import type { IPreviousResult } from '../src/family.js';
import { mintedOutcome, sourceOutcome } from '../src/outcome.js';

/**
 * Stand in for a previous carrier. The registry recognizes envelopes by
 * minting, not by carrier validity, which Resolution checks separately.
 */
function carrierOf(data: unknown): IPreviousResult<{ readonly profile: { readonly name: string } }> {
  return Object.freeze({ data }) as IPreviousResult<{ readonly profile: { readonly name: string } }>;
}

describe('source outcome envelopes', () => {
  test('fresh and retain envelopes are frozen and recognized with their minted form', () => {
    const data = { profile: { name: 'Ada' } };
    const fresh = sourceOutcome.fresh(data);
    expect(Object.isFrozen(fresh)).toBe(true);
    expect(mintedOutcome(fresh)).toEqual({ kind: 'fresh', data });
    const carrier = carrierOf(Object.freeze({ profile: Object.freeze({ name: 'Ada' }) }));
    const retain = sourceOutcome.retain(carrier);
    expect(mintedOutcome(retain)).toEqual({ kind: 'retain', previous: carrier });
  });

  test('look-alike payloads, copies and primitives are not controls', () => {
    const genuine = sourceOutcome.fresh({ kind: 'retain' });
    for (const candidate of [
      { kind: 'fresh', data: {} },
      Object.freeze({ kind: 'retain', previous: Object.freeze({ data: {} }) }),
      { ...genuine },
      Object.create(genuine) as object,
      'retain',
      undefined,
      null,
    ]) {
      expect(mintedOutcome(candidate)).toBeUndefined();
    }
  });

  test('fresh data shaped like a retention envelope is still fresh data', () => {
    const payload = { kind: 'retain', previous: { data: {} } };
    expect(mintedOutcome(sourceOutcome.fresh(payload))).toEqual({ kind: 'fresh', data: payload });
  });
});
