/** Tests-first receiving boundary refuses substituted metadata, codec content and output widths. */
import { createHash } from 'node:crypto';
import { expect, test } from '@jest/globals';
import { consumeColdWorker } from '../src/cold-bridge.js';
import { expectedColdTuple, tupleModel } from '../src/tuple-accounting.js';

/** These identities describe a bounded mathematical fixture, not a runtime package grant. */
const identity = { population: 1, inputSha256: 'a'.repeat(64), workerSha256: 'b'.repeat(64), codecSha256: 'c'.repeat(64), implementationDigest: 'd'.repeat(64) };
/** A receiving-boundary fixture never calls the owner codec to build its expectation. */
function envelope(): Record<string, unknown> {
  const content = expectedColdTuple(1, identity.implementationDigest);
  const outputSha256 = createHash('sha256').update(JSON.stringify(content)).digest('hex');
  return { population: 1, inputSha256: identity.inputSha256, workerSha256: identity.workerSha256, codecSha256: identity.codecSha256, outputSha256, highWaterRssBytes: 1048576, content };
}
test('receiver measures the passed actual value only after full identity/grammar verification', () => {
  expect(consumeColdWorker(JSON.stringify(envelope()), identity)).toMatchObject({ population: 1, utf16: tupleModel(1), utf8: tupleModel(1), highWaterRssBytes: 1048576, canonicalSha256: expect.stringMatching(/^[a-f0-9]{64}$/u) });
});
test('same-N content and metadata substitutions, malformed and oversized output stop analysis', () => {
  for (const [key, replacement] of [['population', 2], ['inputSha256', 'e'.repeat(64)], ['workerSha256', 'e'.repeat(64)], ['codecSha256', 'e'.repeat(64)], ['outputSha256', 'e'.repeat(64)], ['highWaterRssBytes', 0], ['content', []], ['extra', 1]] as const) {
    const changed = { ...envelope(), [key]: replacement };
    expect(() => consumeColdWorker(JSON.stringify(changed), identity)).toThrow();
  }
  expect(() => consumeColdWorker(' '.repeat(1048577), identity)).toThrow();
  expect(() => consumeColdWorker('{', identity)).toThrow();
});
