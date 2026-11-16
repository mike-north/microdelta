/** Production dispatch separates provenance wire generations from semantic variants and other owner records. */
import { describe, expect, test } from '@jest/globals';
import type { ICompletedEnvelope, IVersionedRecord } from '@microdelta/history';
import type { ITrackingObservation } from '@microdelta/tracking';
import type { IProvenance } from '../src/evidence.js';
import { acceptanceRecord, endingRecord, provenanceRecord, readProvenance } from '../src/evidence.js';
import { ResolutionError } from '../src/errors.js';

/** Literal own-callback fact establishes the semantic invariant independently of the writer. */
const own: ITrackingObservation = {
  binding: { path: ['self'] }, address: [], selection: { kind: 'implementation', address: [], encodingVersion: 'MDF1' },
  kind: 'implementation', operation: 'implementation', encodingVersion: 'MDF1', fingerprint: 'a'.repeat(64),
};
/** Source/callable/fold descriptors retain their existing semantic responsibilities. */
const step = { scope: 'test', role: 'step', slot: 'result' } as const;
const callable = { scope: 'test', role: 'callable', slot: 'detail' } as const;
const over = { ...step, template: 'member', collection: 'items' };
const ref = { kind: 'completed-result', locator: 'exact-child' } as const;
/** Independent wire spelling: no writer or candidate codec derives this expectation. */
const ownTuple = [['self'], [], [1, []], 1, 'implementation', 'MDF1', [], 'a'.repeat(64)];
/** All six publication kinds, plus callable source, retain independent semantic tags. */
const variants: readonly IProvenance[] = [
  { version: 1, kind: 'source', step, observations: [own], children: [] },
  { version: 1, kind: 'source', step: callable, observations: [own], children: [] },
  { version: 1, kind: 'memo', step, observations: [own], children: [{ slot: 'child', witness: { version: 1 }, reference: ref, binding: { path: ['child', 'child'] } }] },
  { version: 2, kind: 'memo', step, observations: [own], calls: [{ index: 0, witness: { version: 2 }, reference: ref, binding: { path: ['call', '0'] } }] },
  { version: 2, kind: 'supplied', step: callable, observations: [own], calls: [] },
  { version: 3, kind: 'fold', step, over, observations: [own], membership: [{ key: 'ada', status: 'included', reference: ref }, { key: 'bea', status: 'skipped' }] },
  { version: 4, kind: 'outcome-fold', step, over, observations: [own], membership: [{ key: 'ada', status: 'included', reference: ref }, { key: 'bea', status: 'failed' }, { key: 'cy', status: 'cancelled' }] },
];

/** History envelope scaffolding carries the exact owner record without interpreting it. */
function envelope(provenance: IVersionedRecord): ICompletedEnvelope {
  return { analysis: 'test', environment: 'test', subject: 'result', version: 1, reference: ref, attemptId: 1, publication: 1, encoding: 'MDS1', provenance, dependencies: [ref] };
}

/** Assert owner integrity classification, not an unrelated TypeError or generic message. */
function integrity(operation: () => unknown): void {
  let failure: unknown;
  try { operation(); } catch (error) { failure = error; }
  expect(failure).toBeInstanceOf(ResolutionError);
  if (!(failure instanceof ResolutionError)) { throw new Error('expected Resolution integrity failure'); }
  expect(failure.code).toBe('integrity');
}

/** Literal wire-5 record independently parameterizes only the variant's non-observation facts. */
function wire(value: IProvenance): IVersionedRecord {
  const prefix = { trackingSemantics: 2, semanticVersion: value.version, kind: value.kind, step: value.step, observations: [ownTuple] };
  if (value.version === 1) { return { format: 'microdelta.resolution.provenance', formatVersion: 5, content: { ...prefix, children: value.children } }; }
  if (value.version === 2) { return { format: 'microdelta.resolution.provenance', formatVersion: 5, content: { ...prefix, calls: value.calls } }; }
  return { format: 'microdelta.resolution.provenance', formatVersion: 5, content: { ...prefix, over: value.over, membership: value.membership } };
}

describe.each(variants)('production wire5 $kind semantic$version', value => {
  test('every writer emits the independent wire literal and reader preserves semantic meaning', () => {
    expect(provenanceRecord(value)).toEqual(wire(value));
    expect(readProvenance(envelope(wire(value)))).toEqual({ status: 'supported', provenance: value });
  });
  test('legacy literal generation2 evidence remains readable without mutating its record', () => {
    // Deliberately object observations and no semanticVersion: this is a genuine legacy shape.
    const content = { trackingSemantics: 2, kind: value.kind, step: value.step, observations: [own],
      ...(value.version === 1 ? { children: value.children } : value.version === 2 ? { calls: value.calls } : { over: value.over, membership: value.membership }) };
    const record = { format: 'microdelta.resolution.provenance', formatVersion: value.version, content };
    const before = JSON.stringify(record);
    expect(readProvenance(envelope(record))).toEqual({ status: 'supported', provenance: value });
    expect(JSON.stringify(record)).toBe(before);
  });
});

/** Known wire5 must classify compatibility before interpreting any future/corrupt body. */
describe('production wire5 dispatch precedence', () => {
  test.each([5, 6, Number.MAX_SAFE_INTEGER])('future semantic %s honestly misses without reading its body', semanticVersion => {
    expect(readProvenance(envelope({ format: 'microdelta.resolution.provenance', formatVersion: 5, content: { trackingSemantics: 2, semanticVersion, observations: 'uninterpretable' } }))).toMatchObject({ status: 'unsupported' });
  });
  test.each([undefined, '1', 1.5, 0, -1, Infinity, NaN, Number.MAX_SAFE_INTEGER + 1])('invalid known semantic %s is integrity damage', semanticVersion => {
    integrity(() => readProvenance(envelope({ format: 'microdelta.resolution.provenance', formatVersion: 5, content: { trackingSemantics: 2, semanticVersion } })));
  });
  test.each([undefined, 1, 3, '2'])('unsupported Tracking %s precedes malformed semantic/body', trackingSemantics => {
    expect(readProvenance(envelope({ format: 'microdelta.resolution.provenance', formatVersion: 5, content: { trackingSemantics, semanticVersion: '1', observations: null } }))).toMatchObject({ status: 'unsupported' });
  });
  test.each([{ tuple: [] }, { tuple: [['self'], [], [1, []], 1, 'implementation', 'MDF1', [1], 'a'.repeat(64)] }])('malformed current tuple $tuple cannot silently miss', ({ tuple }) => {
    integrity(() => readProvenance(envelope({ format: 'microdelta.resolution.provenance', formatVersion: 5, content: { trackingSemantics: 2, semanticVersion: 1, kind: 'source', step, observations: [tuple], children: [] } })));
  });
  test('decoded source-no-children and own-implementation invariants still use semantic validation', () => {
    for (const content of [
      { trackingSemantics: 2, semanticVersion: 1, kind: 'source', step, observations: [], children: [] },
      { trackingSemantics: 2, semanticVersion: 1, kind: 'source', step, observations: [ownTuple], children: [{ slot: 'child', witness: {}, reference: ref, binding: { path: ['child', 'child'] } }] },
    ]) {
      integrity(() => readProvenance(envelope({ format: 'microdelta.resolution.provenance', formatVersion: 5, content })));
    }
  });
});

/** Nonempty independent records prevent provenance-only wiring from changing the shared formats. */
describe('other Resolution record formats remain literal', () => {
  test('acceptance1/2/3 retain object observations and exact relation order', () => {
    const prefix = { basis: 'validated', step, observations: [own] };
    expect(acceptanceRecord({ basis: 'validated', step, observations: [own], children: [{ slot: 'child', reference: ref }] })).toEqual({ format: 'microdelta.resolution.acceptance', formatVersion: 1, content: { ...prefix, children: [{ slot: 'child', reference: ref }] } });
    expect(acceptanceRecord({ basis: 'validated', step, observations: [own], calls: [{ index: 0, reference: ref }] })).toEqual({ format: 'microdelta.resolution.acceptance', formatVersion: 2, content: { ...prefix, calls: [{ index: 0, reference: ref }] } });
    expect(acceptanceRecord({ basis: 'validated', step, observations: [own], members: [{ key: 'ada', reference: ref }] })).toEqual({ format: 'microdelta.resolution.acceptance', formatVersion: 3, content: { ...prefix, members: [{ key: 'ada', reference: ref }] } });
  });
  test('ending1 preserves absent and present reference distinctions', () => {
    expect(endingRecord({ ending: 'failed', detail: 'reason' })).toEqual({ format: 'microdelta.resolution.attempt-ending', formatVersion: 1, content: { ending: 'failed', detail: 'reason' } });
    expect(endingRecord({ ending: 'retained', detail: 'reason', reference: ref })).toEqual({ format: 'microdelta.resolution.attempt-ending', formatVersion: 1, content: { ending: 'retained', detail: 'reason', reference: ref } });
  });
});

/** Legacy compatibility is independently object-shaped, including every selection and optional encoded fact. */
describe('complete literal legacy observations through production dispatch', () => {
  const selectedAddress = [{ kind: 'index', index: 0 }];
  const topAddress = [{ kind: 'property', key: 'outer\\"☃😀' }];
  const topWire = [[0, 'outer\\"☃😀']];
  const rows = [
    ...['value', 'own', 'membership', 'length', 'keys', 'container-kind'].map((operation, tag) => ({
      kind: 'fact', encodingVersion: 'MDO1', selection: { kind: 'selected', operation, address: selectedAddress, encodingVersion: 'MDO1' }, packed: [0, tag, [[1, 0]]], kindTag: 0,
    })),
    { kind: 'implementation', encodingVersion: 'MDF1', selection: { kind: 'implementation', address: selectedAddress, encodingVersion: 'MDF1' }, packed: [1, [[1, 0]]], kindTag: 1 },
    { kind: 'materialized-output', encodingVersion: 'MDS1', selection: { kind: 'materialized-output', address: selectedAddress, encodingVersion: 'MDS1' }, packed: [2, [[1, 0]]], kindTag: 2 },
    { kind: 'projection', encodingVersion: 'MDP1', selection: { kind: 'projection', descriptor: { address: selectedAddress, operation: 'value', traversal: { kind: 'exhaustive', complete: true } }, encodingVersion: 'MDP1' }, packed: [3, [[1, 0]], [0]], kindTag: 3 },
    { kind: 'projection', encodingVersion: 'MDP1', selection: { kind: 'projection', descriptor: { address: selectedAddress, operation: 'value', traversal: { kind: 'visited', complete: false, keys: ['z', 'a'] } }, encodingVersion: 'MDP1' }, packed: [3, [[1, 0]], [1, ['z', 'a']]], kindTag: 3 },
    { kind: 'collection-order', encodingVersion: 'MDV1', selection: { kind: 'collection-order', keys: ['z', 'a'], encodingVersion: 'MDV1' }, packed: [4, ['z', 'a']], kindTag: 4 },
    { kind: 'untracked-read', encodingVersion: 'MDU1', selection: { kind: 'untracked-read', address: selectedAddress, encodingVersion: 'MDU1' }, packed: [5, [[1, 0]]], kindTag: 5 },
  ];
  test.each(variants)('legacy$version $kind preserves independent fields and all literal selections', value => {
    const facts = rows.map((row, index) => ({ binding: { path: ['inputs'] }, address: topAddress, selection: row.selection,
      kind: row.kind, operation: 'future-outer-operation', encodingVersion: row.encodingVersion,
      ...(index % 2 === 0 ? { encoded: '' } : {}), fingerprint: 'b'.repeat(64) }));
    const tuples = rows.map((row, index) => [['inputs'], topWire, row.packed, row.kindTag, 'future-outer-operation', row.encodingVersion, index % 2 === 0 ? [''] : [], 'b'.repeat(64)]);
    const relations = value.version === 1 ? { children: value.children } : value.version === 2 ? { calls: value.calls } : { over: value.over, membership: value.membership };
    const content = { trackingSemantics: 2, kind: value.kind, step: value.step, observations: [own, ...facts], ...relations };
    const legacy = { format: 'microdelta.resolution.provenance', formatVersion: value.version, content };
    const before = JSON.stringify(legacy);
    const parsed = readProvenance(envelope(legacy));
    expect(parsed).toEqual({ status: 'supported', provenance: { version: value.version, kind: value.kind, step: value.step, observations: [own, ...facts], ...relations } });
    if (parsed.status !== 'supported') { throw new Error('expected supported legacy fixture'); }
    const expected = { format: 'microdelta.resolution.provenance', formatVersion: 5, content: { ...content, semanticVersion: value.version, observations: [ownTuple, ...tuples] } };
    expect(provenanceRecord(parsed.provenance)).toEqual(expected);
    expect(readProvenance(envelope(expected))).toEqual(parsed);
    expect(JSON.stringify(legacy)).toBe(before);
  });
  test.each([{ ...step, memberKey: '' }, { ...step, memberKey: 'ada', template: 'people', collection: 'roster' }])('legacy descriptor option distinctions remain exact: %j', descriptor => {
    const content = { trackingSemantics: 2, kind: 'memo', step: descriptor, observations: [own], children: [] };
    expect(readProvenance(envelope({ format: 'microdelta.resolution.provenance', formatVersion: 1, content }))).toEqual({ status: 'supported', provenance: { version: 1, kind: 'memo', step: descriptor, observations: [own], children: [] } });
  });
});

/** Provenance-only transport must preserve semantic holes that the legacy reader already admits. */
test('production writer preserves sparse binding, address and visited/order vectors from literal legacy evidence', () => {
  const path = ['inputs', , 'tail'];
  const address = [{ kind: 'property', key: 'rows' }, , { kind: 'index', index: -0 }];
  const keys = ['z', , 'a'];
  const observations = [own,
    { binding: { path }, address, selection: { kind: 'projection', descriptor: { address, operation: 'value', traversal: { kind: 'visited', complete: false, keys } }, encodingVersion: 'MDP1' }, kind: 'projection', operation: 'future-outer', encodingVersion: 'MDP1', fingerprint: 'b'.repeat(64) },
    { binding: { path }, address, selection: { kind: 'collection-order', keys, encodingVersion: 'MDV1' }, kind: 'collection-order', operation: 'future-outer', encodingVersion: 'MDV1', encoded: '', fingerprint: 'b'.repeat(64) },
  ];
  const parsed = readProvenance(envelope({ format: 'microdelta.resolution.provenance', formatVersion: 1, content: { trackingSemantics: 2, kind: 'source', step, observations, children: [] } }));
  expect(parsed.status).toBe('supported');
  if (parsed.status !== 'supported') { throw new Error('expected legacy-admitted sparse evidence'); }
  expect(readProvenance(envelope(provenanceRecord(parsed.provenance)))).toStrictEqual(parsed);
});
