/** The JSON bridge is an explicitly smaller cold-fixture domain, never a production Value transport. */
import { createHash } from 'node:crypto';
import { expect, jest, test } from '@jest/globals';
import { observation } from '../src/evidence.js';
import { _decodeObservation, _encodeObservation, _encodeProvenanceContent, _readCandidateProvenance } from '../src/provenance-wire.js';
import { ColdChannelError, _assertColdCorpus, _coldJson, _sameColdTree } from './provenance-cold-channel.js';

test('cold channel refuses excessive node count even when raw text would fit the byte cap', () => {
  expect(() => _coldJson(new Array<string>(65536).fill(''))).toThrow(ColdChannelError);
});

/** Build the seven literal cold N1 facts without calling the candidate codec or Value. */
function fixture(): unknown {
  const hash = (encoded: string): string => createHash('sha256').update(encoded).digest('hex');
  const copy = (item: unknown): object => { if (typeof item !== 'object' || item === null) { throw new Error('fixture object'); } return { ...item }; };
  const fact = (address: readonly unknown[], operation: string, value: string | number): unknown => {
    const tuples = address.map((segment) => {
      if (typeof segment !== 'object' || segment === null) { throw new Error('fixture address'); }
      const data = segment as Record<string, unknown>;
      return data['kind'] === 'property' ? ['property', data['key']] : ['index', data['index']];
    });
    const encoded = 'MDO1|' + JSON.stringify([operation, tuples, 'MDV1|' + JSON.stringify([typeof value === 'string' ? 's' : 'd', String(value)])]);
    return { binding: { path: ['inputs'] }, address: address.map(copy), selection: { kind: 'selected', operation, address: address.map(copy), encodingVersion: 'MDO1' }, kind: 'fact', operation, encodingVersion: 'MDO1', encoded, fingerprint: hash(encoded) };
  };
  const rows = { kind: 'property', key: 'rows' }; const row = { kind: 'index', index: 0 };
  const encoded = 'MDF1|aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';
  return { trackingSemantics: 2, kind: 'source', step: { scope: 'test5-selected-read', role: 'step', slot: 'listing' }, observations: [
    { binding: { path: ['self'] }, address: [], selection: { kind: 'implementation', address: [], encodingVersion: 'MDF1' }, kind: 'implementation', operation: 'implementation', encodingVersion: 'MDF1', encoded, fingerprint: hash(encoded) },
    fact([rows], 'container-kind', 'array'), fact([rows], 'length', 1), fact([rows, row], 'container-kind', 'record'),
    fact([rows, row, { kind: 'property', key: 'key' }], 'value', 'acme/widget#1'), fact([rows, row, { kind: 'property', key: 'score' }], 'value', 1), fact([rows, row, { kind: 'property', key: 'unread' }], 'value', 'baseline'),
  ], children: [] };
}

test('accepts only the pinned dense cold corpus before codec dispatch', () => {
  const value = fixture(); expect(() => _assertColdCorpus(value, 1)).not.toThrow();
  expect(() => _assertColdCorpus(value, 2)).toThrow(ColdChannelError);
  expect(() => _assertColdCorpus(value, 101)).toThrow(ColdChannelError);
  expect(() => _assertColdCorpus({ kind: 'source' }, 1)).toThrow(ColdChannelError);
  if (typeof value !== 'object' || value === null) { throw new Error('fixture'); }
  expect(() => _assertColdCorpus({ ...value, children: [{}] }, 1)).toThrow(ColdChannelError);
});

test('proves exact ordinary tree equality after a capped JSON round trip', () => {
  const value = { kind: 'cold', slots: [0, '', 'é😀\ud800'], ordered: { z: 1, a: 2 } };
  const encoded = _coldJson(value); const parsed: unknown = JSON.parse(encoded);
  expect(() => _sameColdTree(value, parsed)).not.toThrow();
  expect(() => _sameColdTree({ z: 1, a: 2 }, { a: 2, z: 1 })).toThrow(ColdChannelError);
  expect(() => _sameColdTree([0], [-0])).toThrow(ColdChannelError);
  expect(() => _sameColdTree([1], [2])).toThrow(ColdChannelError);
});

test.each([undefined, -0, NaN, Infinity, -Infinity, 1.5, Number.MAX_SAFE_INTEGER + 1, null, true, 1n, () => 1, new Date(), [undefined], [,], Object.assign([], { extra: 1 })])('refuses channel-unsafe value %p before serialization', (value) => {
  expect(() => _coldJson({ value })).toThrow(ColdChannelError);
});

test('refuses prototypes, accessors/toJSON, hidden/symbol properties, cycles and shared identity', () => {
  const bare: object = Object.create(null) as object; const custom: object = Object.create({ inherited: 'data' }) as object;
  const shared = {}; const cycle: { self?: unknown } = {}; cycle.self = cycle;
  let calls = 0;
  const accessor = Object.defineProperty({}, 'data', { get: () => { calls++; return 'read'; }, enumerable: true });
  const toJSON = { toJSON: () => { calls++; return 'replacement'; } };
  for (const value of [bare, custom, accessor, toJSON, Object.defineProperty({}, 'hidden', { value: 1 }), { [Symbol('hidden')]: 1 }, cycle, [shared, shared]]) {
    expect(() => _coldJson(value)).toThrow(ColdChannelError);
  }
  expect(calls).toBe(0);
});

test('refuses an output budget before returning text', () => {
  expect(() => _coldJson({ text: 'x'.repeat(100) }, 32)).toThrow(ColdChannelError);
  expect(() => _coldJson({}, 0)).toThrow(ColdChannelError);
});


/** Guard tests alter evidence independently; their oracle never calls the codec to bless a corpus. */
function data(value: unknown): Record<string, unknown> { if (typeof value !== 'object' || value === null || Array.isArray(value)) { throw new Error('fixture record'); } return value as Record<string, unknown>; }
/** The fixed fixture is dense, but unknown boundary reads must still be narrowed. */
function items(value: unknown): readonly unknown[] { if (!Array.isArray(value)) { throw new Error('fixture vector'); } return value as readonly unknown[]; }

test('same-N near misses cannot bless omitted, reordered or altered evidence', () => {
  const value = data(fixture()); const observations = items(value['observations']);
  const changed = (replacement: unknown): unknown => ({ ...value, observations: observations.map((entry, position) => position === 4 ? replacement : entry) });
  const key = data(observations[4]); const selection = data(key['selection']);
  const alteredEncoded = 'MDO1|["value",[],"MDV1|[\"s\",\"changed\"]"]';
  for (const candidate of [
    { ...value, observations: observations.slice(1) },
    { ...value, observations: [observations[0], observations[2], observations[1], ...observations.slice(3)] },
    changed({ ...key, selection: { ...selection, address: [] } }),
    changed({ ...key, operation: 'future-outer' }),
    changed({ ...key, encoded: alteredEncoded }),
    changed({ ...key, encoded: alteredEncoded, fingerprint: createHash('sha256').update(alteredEncoded).digest('hex') }),
    changed({ ...key, fingerprint: 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb' }),
  ]) { expect(() => _assertColdCorpus(candidate, 1)).toThrow(ColdChannelError); }
});

test('valid codec -0 and sparse outputs are refused only by the cold JSON channel', () => {
  const base = { binding: { path: ['inputs'] }, address: [{ kind: 'index', index: 0 }], selection: { kind: 'selected', operation: 'value', address: [], encodingVersion: 'MDO1' }, kind: 'fact', operation: 'arbitrary', encodingVersion: 'MDO1', fingerprint: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa' };
  for (const raw of [{ ...base, address: [{ kind: 'index', index: -0 }] }, { ...base, binding: { path: ['inputs', , 'tail'] } }]) {
    const admitted = observation(raw); const actual = _encodeObservation(admitted); const decoded = data(_decodeObservation(actual));
    expect(decoded).toStrictEqual(admitted);
    if (items(data(decoded['binding'])['path']).length === 1) { expect(Object.is(data(items(decoded['address'])[0])['index'], -0)).toBe(true); }
    else { expect(Object.hasOwn(items(data(decoded['binding'])['path']), 1)).toBe(false); }
    expect(() => _coldJson(actual)).toThrow(ColdChannelError);
  }
});

test('valid opaque witness codec content never inherits the channel domain', () => {
  const witness: object = Object.create(null) as object; Object.defineProperty(witness, 'minus', { value: -0, enumerable: true });
  const raw = data(fixture());
  const content = { ...raw, kind: 'memo', children: [{ slot: 'child', witness, reference: { kind: 'completed-result', locator: 'child' }, binding: { path: ['child', 'child'] } }] };
  const actual = _encodeProvenanceContent(content, 1);
  const decoded = _readCandidateProvenance({ format: 'microdelta.resolution.provenance', formatVersion: 5, content: actual });
  expect(decoded.status).toBe('supported'); if (decoded.status !== 'supported') { throw new Error('fixture compatibility'); }
  const restoredWitness = data(items(data(decoded.content)['children'])[0])['witness'];
  if (typeof restoredWitness !== 'object' || restoredWitness === null) { throw new Error('fixture witness'); }
  expect(Object.getPrototypeOf(restoredWitness)).toBe(null); expect(Object.is(data(restoredWitness)['minus'], -0)).toBe(true);
  expect(() => _coldJson(actual)).toThrow(ColdChannelError);
});

test('preflight enforces finite traversal and explicit small budgets', () => {
  let nested: unknown = 'end'; for (let depth = 0; depth < 66; depth++) { nested = [nested]; }
  expect(() => _coldJson(nested)).toThrow(ColdChannelError);
  expect(() => _coldJson([0, 0, 0, 0], 8)).toThrow(ColdChannelError);
});


test('even initial/primitive byte widths refuse before JSON.stringify, while zero fits one byte', () => {
  const stringify = jest.spyOn(JSON, 'stringify');
  try {
    for (const value of [{}, [], '', 10]) { expect(() => _coldJson(value, 1)).toThrow(ColdChannelError); }
    expect(stringify).not.toHaveBeenCalled();
  } finally { stringify.mockRestore(); }
  expect(_coldJson(0, 1)).toBe('0');
});
