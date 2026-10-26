/** Resolution rejects provenance whose tracking semantics cannot prove complete consumption (TRK-5, REUSE-008). */
import { describe, expect, test } from '@jest/globals';
import type { ICompletedEnvelope, IVersionedRecord } from '@microdelta/history';
import type { ITrackingObservation } from '@microdelta/tracking';
import type { IProvenance } from '../src/evidence.js';
import { provenanceRecord, readProvenance } from '../src/evidence.js';

/** Every execution records its own callback, even when it consumes no data. */
const ownImplementation: ITrackingObservation = {
  binding: { path: ['self'] }, address: [],
  selection: { kind: 'implementation', address: [], encodingVersion: 'MDF1' },
  kind: 'implementation', operation: 'implementation', encodingVersion: 'MDF1',
  fingerprint: 'a'.repeat(64),
};
/** All persisted kinds must share the same tracking compatibility boundary. */
const step = { scope: 'test', role: 'step', slot: 'result' } as const;
const observations = [ownImplementation];
const over = { ...step, template: 'member', collection: 'items' };
const cases: readonly IProvenance[] = [
  { version: 1, kind: 'source', step, observations, children: [] },
  { version: 1, kind: 'memo', step, observations, children: [] },
  { version: 2, kind: 'memo', step, observations, calls: [] },
  { version: 2, kind: 'supplied', step: { ...step, role: 'callable' }, observations, calls: [] },
  { version: 3, kind: 'fold', step, over, observations, membership: [] },
  { version: 4, kind: 'outcome-fold', step, over, observations, membership: [] },
];

/** Only provenance affects this reader; the envelope still obeys History's contract. */
function envelope(provenance: IVersionedRecord): ICompletedEnvelope {
  return {
    analysis: 'test', environment: 'test', subject: 'result', version: 1,
    reference: { kind: 'completed-result', locator: 'test-result' },
    attemptId: 1, publication: 1, encoding: 'MDS1', provenance, dependencies: [],
  };
}

describe.each(cases)('tracking generation for $kind version $version', (provenance) => {
  test('new records declare current semantics and remain reusable evidence', () => {
    const record = provenanceRecord(provenance);
    expect(record.content).toHaveProperty('trackingSemantics', 2);
    expect(readProvenance(envelope(record))).toEqual({ status: 'supported', provenance });
  });

  test('current generation still rejects malformed evidence as integrity damage', () => {
    const record = provenanceRecord(provenance);
    expect(() => readProvenance(envelope({ ...record, content: { kind: provenance.kind, trackingSemantics: 2 } })))
      .toThrow('Stored Resolution provenance is malformed');
  });

  test.each([undefined, 1, 3, '2'])('generation %s is an honest unsupported miss', (generation) => {
    const record = provenanceRecord(provenance);
    const content = { kind: provenance.kind, ...(generation === undefined ? {} : { trackingSemantics: generation }) };
    // Omit observations deliberately: compatibility must precede interpretation,
    // even for candidates that appear to have consumed no data.
    expect(readProvenance(envelope({ ...record, content }))).toMatchObject({ status: 'unsupported' });
  });
});

/** SCD-4 extends only source provenance, leaving memo descriptors step-only. */
describe('callable source provenance compatibility', () => {
  const callable = { scope: 'test', role: 'callable', slot: 'detail' } as const;
  test('round-trips the callable source in source v1 without changing old formats', () => {
    const provenance: IProvenance = { version: 1, kind: 'source', step: callable, observations, children: [] };
    expect(readProvenance(envelope(provenanceRecord(provenance)))).toEqual({ status: 'supported', provenance });
  });
  test('ordinary memo provenance still rejects a callable descriptor', () => {
    const provenance: IProvenance = { version: 1, kind: 'memo', step: callable, observations, children: [] };
    expect(() => readProvenance(envelope(provenanceRecord(provenance)))).toThrow('Stored Resolution provenance is malformed');
  });
  test.each([{ ...callable, memberKey: 'ada' }, { ...callable, template: 'people', collection: 'roster' }, { ...callable, slot: '' }])('rejects malformed callable descriptor %j', malformed => {
    const record = provenanceRecord({ version: 1, kind: 'source', step, observations, children: [] });
    expect(() => readProvenance(envelope({ ...record, content: { trackingSemantics: 2, kind: 'source', step: malformed, observations, children: [] } }))).toThrow('Stored Resolution provenance is malformed');
  });
});
