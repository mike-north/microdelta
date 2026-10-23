/**
 * Instrumented publication-cost counterexample. Count array slots exposed by
 * getOwnPropertyNames during supported-value validation. This is bounded work
 * evidence for this shape, not a universal complexity proof or latency SLA.
 */
import { afterEach, expect, jest, test } from '@jest/globals';
import { encodeSnapshot } from '@microdelta/value';

import { cleanup, freshLocation, openHistory, provenance, scope } from '../durable-history/support.js';

afterEach(cleanup);

/** Count inspected array slots while preserving native reflection behavior. */
function arraySlotWork(work: () => void): number {
  const original = Object.getOwnPropertyNames;
  let slots = 0;
  const probe = jest.spyOn(Object, 'getOwnPropertyNames').mockImplementation((value: object) => {
    if (Array.isArray(value)) {
      slots += value.length;
    }
    return original(value);
  });
  try {
    work();
    return slots;
  } finally {
    probe.mockRestore();
  }
}

test('doubling a flat record array keeps publication validation work linear like matched encoding', () => {
  const encodeWork: number[] = [];
  const publishWork: number[] = [];
  for (const size of [20, 40]) {
    const payload = Array.from({ length: size }, (_, index) => ({ key: `pr:${index}`, body: 'x'.repeat(32) }));
    encodeWork.push(arraySlotWork(() => { encodeSnapshot(payload); }));
    const history = openHistory({ location: freshLocation() });
    const acquisition = history.acquireWriter({ holder: 'array-work-probe', leaseMilliseconds: 10_000 });
    if (acquisition.kind !== 'acquired') {
      throw new Error('Expected fresh store writer');
    }
    const lease = acquisition.lease;
    const attempt = history.allocateAttempt(lease, { ...scope, subject: 'payload', version: 1, attemptKey: 'publish', intentDigest: 'publish' });
    publishWork.push(arraySlotWork(() => {
      history.stageAttempt(lease, { attemptId: attempt.attemptId, payload, provenance: provenance('scale'), dependencies: [] });
      history.publishAttempt(lease, attempt.attemptId);
    }));
  }
  const [encodedSmall, encodedLarge] = encodeWork;
  const [publishedSmall, publishedLarge] = publishWork;
  if (encodedSmall === undefined || encodedLarge === undefined || publishedSmall === undefined || publishedLarge === undefined) {
    throw new Error('Expected paired work measurements');
  }
  console.log(JSON.stringify({ sizes: [20, 40], encodeWork, publishWork }));
  expect(encodedSmall).toBeGreaterThan(0);
  expect(encodedLarge).toBeLessThanOrEqual(2 * encodedSmall);
  // Proposed scale regression boundary: avoid rereading the entire root per field.
  expect(publishedLarge).toBeLessThanOrEqual(2 * publishedSmall);
});
