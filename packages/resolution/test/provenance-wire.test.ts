/** Literal wire-5 outcomes preserve admitted evidence independently of producer coincidences. */
import { describe, expect, test } from '@jest/globals';
import { ResolutionError } from '../src/errors.js';
import { observation, readProvenance } from '../src/evidence.js';
import { _decodeObservation, _encodeObservation, _encodeProvenanceContent, _readCandidateProvenance } from '../src/provenance-wire.js';

/** Fixed literal evidence is intentionally independent of codec/hash implementation. */
const hash = 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';
/** Ordinary own callback evidence permits semantic-reader fixtures without inferred empty captures. */
const own = { binding: { path: ['self'] }, address: [], selection: { kind: 'implementation', address: [], encodingVersion: 'MDF1' }, kind: 'implementation', operation: 'implementation', encodingVersion: 'MDF1', fingerprint: hash };
/** A deliberately noncoincident observation prevents reconstruction from selected producer fields. */
const different = { binding: { path: ['inputs'] }, address: [{ kind: 'property', key: 'outer' }], selection: { kind: 'selected', operation: 'own', address: [{ kind: 'index', index: 0 }], encodingVersion: 'MDO1' }, kind: 'fact', operation: 'future-outer', encodingVersion: 'MDO1', encoded: '', fingerprint: hash };
/** Its expected tuple is literal, not generated from the semantic fixture. */
const differentWire = [['inputs'], [[0, 'outer']], [0, 1, [[1, 0]]], 0, 'future-outer', 'MDO1', [''], hash];

/** Checked unknown-array access keeps malformed test boundaries honest. */
function array(value: unknown): readonly unknown[] { if (!Array.isArray(value)) { throw new Error('test expected array'); } return value as readonly unknown[]; }
/** The codec returns plain records for the existing semantic reader. */
function record(value: unknown): Record<string, unknown> { if (typeof value !== 'object' || value === null || Array.isArray(value)) { throw new Error('test expected record'); } return value as Record<string, unknown>; }
/** Integrity classification must not be accidentally supplied by an unrelated TypeError. */
function integrity(operation: () => unknown): void {
  let failure: unknown;
  try { operation(); } catch (error) { failure = error; }
  expect(failure).toBeInstanceOf(ResolutionError);
  if (!(failure instanceof ResolutionError)) { throw new Error('expected Resolution integrity error'); }
  expect(failure.code).toBe('integrity');
}
/** Compare retained Value meaning, including prototypes, holes and -0; object identity is not durable evidence. */
function retainedEqual(left: unknown, right: unknown): void {
  if (typeof left !== 'object' || left === null || typeof right !== 'object' || right === null) { expect(Object.is(left, right)).toBe(true); return; }
  expect(Array.isArray(left)).toBe(Array.isArray(right));
  const leftPrototype: unknown = Object.getPrototypeOf(left); const rightPrototype: unknown = Object.getPrototypeOf(right);
  if (rightPrototype === null || rightPrototype === Object.prototype || rightPrototype === Array.prototype) { expect(leftPrototype).toBe(rightPrototype); } else { retainedEqual(leftPrototype, rightPrototype); }
  expect(Reflect.ownKeys(left)).toStrictEqual(Reflect.ownKeys(right));
  for (const key of Reflect.ownKeys(right)) {
    const a = Object.getOwnPropertyDescriptor(left, key); const b = Object.getOwnPropertyDescriptor(right, key);
    if (a === undefined || b === undefined || !('value' in a) || !('value' in b)) { throw new Error('expected own data'); }
    const first: unknown = a.value; const second: unknown = b.value; retainedEqual(first, second);
  }
}
/** A minimal retained History envelope exercises the unchanged semantic owner. */
function semantic(content: unknown, version: number): unknown {
  return readProvenance({ analysis: 'test', environment: 'test', subject: 'result', version: 1, reference: { kind: 'completed-result', locator: 'exact' }, attemptId: 1, publication: 1, encoding: 'MDS1', provenance: { format: 'microdelta.resolution.provenance', formatVersion: version, content }, dependencies: [] });
}

 test('preserves both addresses/operations and present-empty versus absent text', () => {
  expect(_encodeObservation(different)).toStrictEqual(differentWire);
  expect(_decodeObservation(differentWire)).toStrictEqual(different);
  const absent = { binding: different.binding, address: different.address, selection: different.selection, kind: different.kind, operation: different.operation, encodingVersion: different.encodingVersion, fingerprint: hash };
  const wire = [['inputs'], [[0, 'outer']], [0, 1, [[1, 0]]], 0, 'future-outer', 'MDO1', [], hash];
  expect(_encodeObservation(absent)).toStrictEqual(wire);
  expect(_decodeObservation(wire)).toStrictEqual(absent);
  expect(_decodeObservation(wire)).not.toHaveProperty('encoded');
});

describe.each([
  ['value', 0], ['own', 1], ['membership', 2], ['length', 3], ['keys', 4], ['container-kind', 5],
] as const)('selected operation %s', (operation, tag) => {
  test('uses the literal operation tag without changing the outer operation', () => {
    const input = { ...different, operation: '', selection: { kind: 'selected', operation, address: [], encodingVersion: 'MDO1' } };
    const wire = [['inputs'], [[0, 'outer']], [0, tag, []], 0, '', 'MDO1', [''], hash];
    expect(_encodeObservation(input)).toStrictEqual(wire);
    expect(_decodeObservation(wire)).toStrictEqual(input);
  });
});

describe.each([
  [{ kind: 'implementation', address: [], encodingVersion: 'MDF1' }, [1, []], 'MDF1'],
  [{ kind: 'materialized-output', address: [{ kind: 'property', key: '0' }], encodingVersion: 'MDS1' }, [2, [[0, '0']]], 'MDS1'],
  [{ kind: 'projection', descriptor: { address: [], operation: 'value', traversal: { kind: 'exhaustive', complete: true } }, encodingVersion: 'MDP1' }, [3, [], [0]], 'MDP1'],
  [{ kind: 'projection', descriptor: { address: [{ kind: 'index', index: 0 }], operation: 'value', traversal: { kind: 'visited', complete: false, keys: ['z', 'a', 'z'] } }, encodingVersion: 'MDP1' }, [3, [[1, 0]], [1, ['z', 'a', 'z']]], 'MDP1'],
  [{ kind: 'collection-order', keys: ['b', 'a', 'b'], encodingVersion: 'MDV1' }, [4, ['b', 'a', 'b']], 'MDV1'],
  [{ kind: 'untracked-read', address: [], encodingVersion: 'MDU1' }, [5, []], 'MDU1'],
])('selection literal %p', (selection, wireSelection, encodingVersion) => {
  test('retains independent fact kind and outer address', () => {
    const input = { ...different, selection, encodingVersion };
    const wire = [['inputs'], [[0, 'outer']], wireSelection, 0, 'future-outer', encodingVersion, [''], hash];
    expect(_encodeObservation(input)).toStrictEqual(wire);
    expect(_decodeObservation(wire)).toStrictEqual(input);
  });
});

test('preserves negative zero independently in both addresses', () => {
  for (const [top, selected] of [[-0, -0], [-0, 0], [0, -0]]) {
    const input = { ...different, address: [{ kind: 'index', index: top }], selection: { kind: 'selected', operation: 'own', address: [{ kind: 'index', index: selected }], encodingVersion: 'MDO1' } };
    const wire = _encodeObservation(input);
    const decoded = record(_decodeObservation(wire));
    const topIndex = record(array(decoded['address'])[0])['index'];
    const selectedIndex = record(array(record(decoded['selection'])['address'])[0])['index'];
    expect(Object.is(topIndex, top)).toBe(true);
    expect(Object.is(selectedIndex, selected)).toBe(true);
    expect(Object.is(array(array(array(wire)[1])[0])[1], top)).toBe(true);
  }
});

test('preserves property/index and UTF16 strings without normalizing content', () => {
  const input = { ...different, binding: { path: ['', 'é😀\ud800'] }, address: [{ kind: 'property', key: 'a.b"\\\n' }, { kind: 'property', key: '0' }, { kind: 'index', index: 0 }] };
  const expected = [['', 'é😀\ud800'], [[0, 'a.b"\\\n'], [0, '0'], [1, 0]], [0, 1, [[1, 0]]], 0, 'future-outer', 'MDO1', [''], hash];
  expect(_encodeObservation(input)).toStrictEqual(expected);
  expect(_decodeObservation(expected)).toStrictEqual(input);
});

test('keeps sparse semantic vectors distinct from own undefined and structural holes', () => {
  const path: unknown[] = ['inputs', , 'tail'];
  const address: unknown[] = [{ kind: 'property', key: 'rows' }, , { kind: 'index', index: -0 }];
  const input = observation({ ...different, binding: { path }, address, selection: { kind: 'selected', operation: 'own', address, encodingVersion: 'MDO1' } });
  const wire = array(_encodeObservation(input));
  const decoded = record(_decodeObservation(wire));
  for (const vector of [array(wire[0]), array(wire[1]), array(record(decoded['binding'])['path']), array(decoded['address']), array(record(decoded['selection'])['address'])]) {
    expect(vector).toHaveLength(3); expect(Object.hasOwn(vector, 1)).toBe(false); expect(Object.hasOwn(vector, 2)).toBe(true);
  }
  expect(() => observation({ ...different, binding: { path: ['inputs', undefined] } })).toThrow();
  integrity(() => _decodeObservation([, ...differentWire.slice(1)]));
});

test('keeps sparse visited/order keys and an independent own-implementation selection address', () => {
  const keys: unknown[] = ['z', , 'a'];
  for (const selection of [{ kind: 'collection-order', keys, encodingVersion: 'MDV1' }, { kind: 'projection', descriptor: { address: [], operation: 'value', traversal: { kind: 'visited', complete: false, keys } }, encodingVersion: 'MDP1' }]) {
    const input = observation({ ...different, selection, encodingVersion: selection.encodingVersion });
    expect(_decodeObservation(_encodeObservation(input))).toStrictEqual(input);
  }
  const input = observation({ ...own, selection: { kind: 'implementation', address: [{ kind: 'property', key: 'independent' }], encodingVersion: 'MDF1' } });
  expect(_decodeObservation(_encodeObservation(input))).toStrictEqual(input);
});

describe.each([[], [0], [99, []], [0, 99, []], [3, [], [1]], [3, [], [0, []]], [4, 3], [1, [[9, 'x']]], [1, [[1, -1]]], [1, [[1, 1.5]]], [1, [[1, Number.MAX_SAFE_INTEGER + 1]]]].map((selection) => ({ selection })))('malformed selection $selection', ({ selection }) => {
  test('rejects corruption of the documented structural grammar', () => {
    integrity(() => _decodeObservation([['inputs'], [], selection, 0, 'arbitrary', 'MDO1', [], hash]));
  });
});

test('rejects wrong observation arity/options/tags and accessors without invoking them', () => {
  for (const wire of [[], differentWire.slice(0, 7), [...differentWire, 'extra'], [['inputs'], [], [1, []], 99, 'x', 'MDF1', [], hash], [['inputs'], [], [1, []], 1, 'x', 'MDF1', [undefined], hash], [['inputs'], [], [1, []], 1, 'x', 'MDF1', ['', 'extra'], hash]]) {
    integrity(() => _decodeObservation(wire));
  }
  let calls = 0;
  const accessor = [...differentWire]; Object.defineProperty(accessor, '0', { get: () => { calls++; return []; }, enumerable: true });
  integrity(() => _decodeObservation(accessor)); expect(calls).toBe(0);
});

/** Root fields stay plain; variant and Tracking generation remain separate compatibility axes. */
const content = { trackingSemantics: 2, kind: 'source', step: { scope: 'test', role: 'step', slot: 'result' }, observations: [own], children: [] };
const ownWire = [['self'], [], [1, []], 1, 'implementation', 'MDF1', [], hash];
test('writes an explicit semantic tag while preserving the old semantic interpretation', () => {
  const packed = _encodeProvenanceContent(content, 1);
  expect(packed).toStrictEqual({ trackingSemantics: 2, semanticVersion: 1, kind: 'source', step: { scope: 'test', role: 'step', slot: 'result' }, observations: [ownWire], children: [] });
  const result = _readCandidateProvenance({ format: 'microdelta.resolution.provenance', formatVersion: 5, content: packed });
  expect(result.status).toBe('supported');
  if (result.status !== 'supported') { throw new Error('expected supported fixture'); }
  expect(result.semanticVersion).toBe(1); expect(result.content).toStrictEqual(content);
  expect(semantic(result.content, result.semanticVersion)).toStrictEqual(semantic(content, 1));
});

test('retains opaque witness Value data and sparse parsed memo/observation vectors', () => {
  const bare: object = Object.create(null) as object; Object.defineProperty(bare, 'value', { value: -0, enumerable: true });
  for (const witness of [undefined, null, true, Number.NaN, Infinity, -0, bare, Object.create({ inherited: 'kept' }) as object]) {
    const children: unknown[] = [{ slot: 'child', witness, reference: { kind: 'completed-result', locator: 'exact-child' }, binding: { path: ['child', 'child'] } }, , ];
    const raw = { ...content, kind: 'memo', observations: [own, , ], children };
    const parsed = record(semantic(raw, 1)); expect(parsed['status']).toBe('supported');
    const packed = _encodeProvenanceContent(raw, 1);
    const reading = _readCandidateProvenance({ format: 'microdelta.resolution.provenance', formatVersion: 5, content: packed });
    if (reading.status !== 'supported') { throw new Error('expected supported fixture'); }
    const decoded = record(reading.content); expect(Object.hasOwn(array(decoded['observations']), 1)).toBe(false);
    const child = record(array(decoded['children'])[0]); retainedEqual(child['witness'], witness);
    expect(Object.hasOwn(array(decoded['children']), 1)).toBe(false);
  }
});

describe.each([undefined, 1, 3, '2'])('generation %p', (generation) => {
  test('short circuits malformed variants and later tuples', () => {
    expect(_readCandidateProvenance({ format: 'microdelta.resolution.provenance', formatVersion: 5, content: { trackingSemantics: generation, semanticVersion: 'bad', observations: 'bad' } }).status).toBe('unsupported');
  });
});
test('future safe semantic variants and unknown formats/wires are unsupported before body', () => {
  for (const input of [{ format: 'other', formatVersion: 5, content: null }, { format: 'microdelta.resolution.provenance', formatVersion: 6, content: null }, { format: 'microdelta.resolution.provenance', formatVersion: 5, content: { trackingSemantics: 2, semanticVersion: 6, observations: 'future-uninterpretable' } }]) {
    expect(_readCandidateProvenance(input).status).toBe('unsupported');
  }
});
describe.each([undefined, '1', 1.5, 0, -0, -1, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1])('malformed semantic variant %p', (semanticVersion) => {
  test('is integrity damage at the known generation', () => {
    integrity(() => _readCandidateProvenance({ format: 'microdelta.resolution.provenance', formatVersion: 5, content: { trackingSemantics: 2, semanticVersion, observations: 'later' } }));
  });
});


describe.each([['materialized-output', 2], ['projection', 3], ['collection-order', 4], ['untracked-read', 5]] as const)('independent observation kind %s', (kind, tag) => {
  test('pins its literal tag without inferring kind from selection', () => {
    const input = { ...different, kind };
    const wire = [['inputs'], [[0, 'outer']], [0, 1, [[1, 0]]], tag, 'future-outer', 'MDO1', [''], hash];
    expect(_encodeObservation(input)).toStrictEqual(wire); expect(_decodeObservation(wire)).toStrictEqual(input);
  });
});

test('current-generation supported variants reject malformed structural bodies as integrity', () => {
  for (const semanticVersion of [1, 2, 3, 4]) {
    integrity(() => _readCandidateProvenance({ format: 'microdelta.resolution.provenance', formatVersion: 5, content: { trackingSemantics: 2, semanticVersion, kind: 'source', step: content.step, observations: [differentWire.slice(0, 2)], children: [], calls: [], over: content.step, membership: [] } }));
  }
});

/** Actual semantic variants keep their plain surrounding evidence and correct explicit tag. */
const ordinary = { scope: 'test', role: 'step', slot: 'result' };
const template = { scope: 'test', role: 'step', slot: 'member', template: 'work', collection: 'items' };
const child = { slot: 'child', witness: { version: 'unknown-definition-witness', data: undefined }, reference: { kind: 'completed-result', locator: 'exact-child' }, binding: { path: ['child', 'child'] } };
const call = { index: 0, witness: { version: 2, opaque: ['keep'] }, reference: { kind: 'completed-result', locator: 'exact-call' }, binding: { path: ['call', '0'] } };
const member = { key: 'a', status: 'included', reference: { kind: 'completed-result', locator: 'exact-member' } };
const variants = [
  { version: 1, value: { trackingSemantics: 2, kind: 'source', step: { scope: 'test', role: 'callable', slot: 'fetch' }, observations: [own], children: [] } },
  { version: 1, value: { trackingSemantics: 2, kind: 'memo', step: { ...ordinary, memberKey: '', template: 'work', collection: 'items' }, observations: [own], children: [child] } },
  { version: 2, value: { trackingSemantics: 2, kind: 'memo', step: ordinary, observations: [own], calls: [call] } },
  { version: 2, value: { trackingSemantics: 2, kind: 'supplied', step: { scope: 'test', role: 'callable', slot: 'given' }, observations: [own], calls: [] } },
  { version: 3, value: { trackingSemantics: 2, kind: 'fold', step: ordinary, over: template, observations: [own], membership: [member, { key: 'b', status: 'skipped' }] } },
  { version: 4, value: { trackingSemantics: 2, kind: 'outcome-fold', step: ordinary, over: template, observations: [own], membership: [member, { key: 'b', status: 'skipped' }, { key: 'c', status: 'failed' }, { key: 'd', status: 'cancelled' }] } },
] as const;

describe.each(variants)('semantic variant $version / $value.kind', ({ version, value }) => {
  test('keeps plain surrounding evidence and semantic interpretation', () => {
    const packed = record(_encodeProvenanceContent(value, version));
    expect(packed['semanticVersion']).toBe(version); expect(packed['trackingSemantics']).toBe(2);
    expect(packed['observations']).toStrictEqual([ownWire]);
    const expectedKeys = version === 1 ? ['trackingSemantics', 'semanticVersion', 'kind', 'step', 'observations', 'children'] : version === 2 ? ['trackingSemantics', 'semanticVersion', 'kind', 'step', 'observations', 'calls'] : ['trackingSemantics', 'semanticVersion', 'kind', 'step', 'over', 'observations', 'membership'];
    expect(Object.keys(packed)).toStrictEqual(expectedKeys);
    const reading = _readCandidateProvenance({ format: 'microdelta.resolution.provenance', formatVersion: 5, content: packed });
    if (reading.status !== 'supported') { throw new Error('expected variant'); }
    retainedEqual(reading.content, value);
    const legacy = semantic(value, version); expect(record(legacy)['status']).toBe('supported');
    retainedEqual(semantic(reading.content, reading.semanticVersion), legacy);
  });
});

test('keeps admitted sparse semantic lists and strict-fold normalization unchanged', () => {
  const sparseCalls: unknown[] = [, { ...call, index: 1, binding: { path: ['call', '1'] } }];
  const sparseMembers: unknown[] = [member, , { key: 'b', status: 'skipped' }];
  const cases = [
    { version: 1 as const, value: { trackingSemantics: 2, kind: 'memo', step: ordinary, observations: [own, , ], children: [child, , ] }, field: 'children', length: 2, hole: 1 },
    { version: 2 as const, value: { trackingSemantics: 2, kind: 'memo', step: ordinary, observations: [own, , ], calls: sparseCalls }, field: 'calls', length: 2, hole: 0 },
    { version: 3 as const, value: { trackingSemantics: 2, kind: 'fold', step: ordinary, over: template, observations: [own, , ], membership: sparseMembers }, field: 'membership', length: 2, hole: undefined },
    { version: 4 as const, value: { trackingSemantics: 2, kind: 'outcome-fold', step: ordinary, over: template, observations: [own, , ], membership: sparseMembers }, field: 'membership', length: 3, hole: 1 },
  ];
  for (const item of cases) {
    const legacy = record(semantic(item.value, item.version)); expect(legacy['status']).toBe('supported');
    const packed = _encodeProvenanceContent(item.value, item.version);
    const reading = _readCandidateProvenance({ format: 'microdelta.resolution.provenance', formatVersion: 5, content: packed });
    if (reading.status !== 'supported') { throw new Error('expected sparse variant'); }
    const actual = record(semantic(reading.content, reading.semanticVersion)); retainedEqual(actual, legacy);
    const provenance = record(actual['provenance']); const vector = array(provenance[item.field]); expect(vector).toHaveLength(item.length);
    if (item.hole !== undefined) { expect(Object.hasOwn(vector, item.hole)).toBe(false); } else { expect(Object.hasOwn(vector, 1)).toBe(true); }
    expect(Object.hasOwn(array(provenance['observations']), 1)).toBe(false);
  }
});

test('retains existing source/supplied exclusions and supported-body integrity semantics', () => {
  const invalid = [
    { version: 1 as const, value: { ...content, children: [,] } },
    { version: 2 as const, value: { trackingSemantics: 2, kind: 'supplied', step: { scope: 'test', role: 'callable', slot: 'given' }, observations: [own], calls: [,] } },
    { version: 1 as const, value: { ...content, observations: [] } },
    { version: 3 as const, value: { trackingSemantics: 2, kind: 'fold', step: ordinary, over: template, observations: [own], membership: [{ key: 'b', status: 'skipped' }, member] } },
  ];
  for (const item of invalid) {
    integrity(() => semantic(item.value, item.version));
    const reading = _readCandidateProvenance({ format: 'microdelta.resolution.provenance', formatVersion: 5, content: _encodeProvenanceContent(item.value, item.version) });
    if (reading.status !== 'supported') { throw new Error('expected supported wire syntax'); }
    integrity(() => semantic(reading.content, reading.semanticVersion));
  }
});
