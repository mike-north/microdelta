/** Assertion views must read actual tuple slots, preserving order and independent address/binding meaning. */
import { expect, test } from '@jest/globals';
import { inspectProvenanceObservations } from './provenance-wire-inspection.js';

test('inspects explicit tuple positions without importing production decoding', () => {
  const tuple = [['inputs'], [[0, 'name'], [1, -0]], [0, 1, []], 0, 'unknown-outer', 'MDO1', [''], 'a'.repeat(64)];
  const views = inspectProvenanceObservations({ observations: [tuple] });
  expect(views).toStrictEqual([{ binding: { path: ['inputs'] }, address: [{ kind: 'property', key: 'name' }, { kind: 'index', index: -0 }], kind: 'fact', operation: 'unknown-outer', tuple }]);
  expect(views[0]?.tuple).toBe(tuple);
});
test.each([{ content: {} }, { content: { observations: [{}] } }, { content: { observations: [[]] } }])('refuses a non-tuple assertion surface: $content', ({ content }) => {
  expect(() => inspectProvenanceObservations(content)).toThrow('Expected wire-5');
});
