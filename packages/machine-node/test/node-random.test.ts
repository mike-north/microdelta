/**
 * Random identifier conformance for the Node Machine adapter. An identifier is
 * exactly 32 lowercase hexadecimal characters of 128 random bits from Node's
 * cryptographically secure generator, so identifiers minted by different
 * stores, processes or hosts never collide in practice.
 *
 * @see https://nodejs.org/api/crypto.html#cryptorandombytessize-callback
 */
import { describe, expect, test } from '@jest/globals';

import { createNodeRandom } from '../src/index.js';

describe('Node random identifier capability conformance', () => {
  test('an identifier is exactly 32 lowercase hexadecimal characters', () => {
    const random = createNodeRandom();
    for (let index = 0; index < 100; index += 1) {
      expect(random.randomIdentifier()).toMatch(/^[0-9a-f]{32}$/u);
    }
  });

  test('identifiers do not repeat, within one source or across independent sources', () => {
    const first = createNodeRandom();
    const second = createNodeRandom();
    const seen = new Set<string>();
    for (let index = 0; index < 1_000; index += 1) {
      seen.add(first.randomIdentifier());
      seen.add(second.randomIdentifier());
    }
    expect(seen.size).toBe(2_000);
  });

  test('every hexadecimal digit position varies, so no fixed prefix or counter stands in for randomness', () => {
    const random = createNodeRandom();
    const samples = Array.from({ length: 200 }, () => random.randomIdentifier());
    for (let position = 0; position < 32; position += 1) {
      expect(new Set(samples.map((sample) => sample[position])).size).toBeGreaterThan(1);
    }
  });
});
