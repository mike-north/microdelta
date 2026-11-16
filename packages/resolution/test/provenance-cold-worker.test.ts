/** Tests-first owner executable boundary: actual output must survive the restricted JSON channel. */
import { createHash } from 'node:crypto';
import { expect, test } from '@jest/globals';
import { _coldWorker } from './provenance-cold-worker.js';

/** Entire semantic input is a literal independent of codec construction. */
const implementation = 'MDF1|' + 'a'.repeat(64);
/** Scalar fixture hashes check retained text instead of declaring digest width. */
function digest(text: string): string { return createHash('sha256').update(text).digest('hex'); }
/** One-row cold selected facts are literal closed-domain spellings, not generated owner tuples. */
function input(): unknown {
  const observations: unknown[] = [{ binding: { path: ['self'] }, address: [], selection: { kind: 'implementation', address: [], encodingVersion: 'MDF1' }, kind: 'implementation', operation: 'implementation', encodingVersion: 'MDF1', encoded: implementation, fingerprint: digest(implementation) }];
  const add = (tail: string | undefined, operation: string, scalar: string | number): void => {
    const segments: readonly unknown[] = tail === undefined ? [{ kind: 'property', key: 'rows' }] : [{ kind: 'property', key: 'rows' }, { kind: 'index', index: 0 }, ...(tail === '' ? [] : [{ kind: 'property', key: tail }])];
    const path = tail === undefined ? [['property', 'rows']] : [['property', 'rows'], ['index', 0], ...(tail === '' ? [] : [['property', tail]])];
    const encoded = 'MDO1|' + JSON.stringify([operation, path, 'MDV1|' + JSON.stringify([typeof scalar === 'string' ? 's' : 'd', String(scalar)])]);
    observations.push({ binding: { path: ['inputs'] }, address: structuredClone(segments), selection: { kind: 'selected', operation, address: structuredClone(segments), encodingVersion: 'MDO1' }, kind: 'fact', operation, encodingVersion: 'MDO1', encoded, fingerprint: digest(encoded) });
  };
  add(undefined, 'container-kind', 'array'); add(undefined, 'length', 1); add('', 'container-kind', 'record'); add('key', 'value', 'acme/widget#1'); add('score', 'value', 1); add('unread', 'value', 'baseline');
  return { trackingSemantics: 2, kind: 'source', step: { scope: 'test5-selected-read', role: 'step', slot: 'listing' }, observations, children: [] };
}
/** Worker identity is separate from mathematical fixture implementation identity. */
const identity = { workerSha256: 'b'.repeat(64), codecSha256: 'c'.repeat(64) };

test('worker physically returns actual candidate content with input/output and executable identities', () => {
  const text = JSON.stringify({ population: 1, input: input() });
  const output: unknown = JSON.parse(_coldWorker(text, identity));
  if (typeof output !== 'object' || output === null || !('content' in output)) { throw new Error('worker envelope'); }
  expect(output).toMatchObject({ population: 1, inputSha256: digest(text), ...identity, outputSha256: digest(JSON.stringify(output.content)), highWaterRssBytes: expect.any(Number) });
  const content = output.content;
  if (typeof content !== 'object' || content === null || !('observations' in content) || !Array.isArray(content.observations)) { throw new Error('worker content'); }
  expect(content.observations[0]).toEqual([['self'], [], [1, []], 1, 'implementation', 'MDF1', [implementation], digest(implementation)]);
  expect(content.observations).toHaveLength(7);
});

test('worker rejects wrong corpus, request identity/surface/population and cap before output', () => {
  for (const text of [JSON.stringify({ population: 2, input: input() }), JSON.stringify({ population: 101, input: input() }), JSON.stringify({ population: 1, input: input(), extra: 1 }), ' '.repeat(1048577), '{']) {
    expect(() => _coldWorker(text, identity)).toThrow();
  }
  expect(() => _coldWorker(JSON.stringify({ population: 1, input: input() }), { ...identity, codecSha256: 'bad' })).toThrow();
});

test('worker refuses the parent\'s remaining cumulative allowance before returning emitted output', () => {
  const text = JSON.stringify({ population: 1, input: input() });
  expect(() => _coldWorker(text, identity, 1)).toThrow();
});
