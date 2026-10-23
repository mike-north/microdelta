/** Same-object mutation and immutable-token controls supplement the owner's independent-root matrix. */
import { afterEach, expect, test } from '@jest/globals';
import { encodeSnapshot, observePrepared, prepareValue, preparedRoot } from '../../../packages/value/dist/src/index.js';
import { cleanup, freshLocation, openHistory, provenance, scope } from '../../../packages/core/.test-build/test/durable-history/support.js';
afterEach(cleanup);
test('repreparing the same mutated source rejects an accessor without running it while old facts remain exact', () => {
  let calls = 0;
  const source = [{ value: 'before' }];
  const prepared = prepareValue(source);
  Object.defineProperty(source[0], 'value', { enumerable: true, get() { calls++; return 'forbidden'; } });
  expect(() => prepareValue(source)).toThrow(TypeError);
  expect(calls).toBe(0);
  expect(observePrepared(prepared, [{ kind: 'index', index: 0 }, { kind: 'property', key: 'value' }], 'value').fact).toBe('before');
});
test('prepared roots, nested records, arrays and custom prototypes cannot be mutated', () => {
  const prototype = { inherited: { marker: 'before' } };
  const custom = Object.create(prototype);
  custom.own = [{ value: 'before' }];
  const prepared = prepareValue(custom);
  const root = preparedRoot(prepared);
  const before = encodeSnapshot(root);
  expect(() => { root.own[0].value = 'after'; }).toThrow(TypeError);
  expect(() => { Object.getPrototypeOf(root).inherited.marker = 'after'; }).toThrow(TypeError);
  expect(() => { root.own.push({ value: 'after' }); }).toThrow(TypeError);
  expect(encodeSnapshot(preparedRoot(prepared))).toBe(before);
});
test('staging detaches data and later invalid reuse cannot publish a completed result', () => {
  const history = openHistory({ location: freshLocation() });
  const acquisition = history.acquireWriter({ holder: 'mutation-control', leaseMilliseconds: 10000 });
  expect(acquisition.kind).toBe('acquired');
  const lease = acquisition.lease;
  const source = [{ value: 'before' }];
  const allocate = attemptKey => history.allocateAttempt(lease, { ...scope, subject: 'mutation', version: 1, attemptKey, intentDigest: attemptKey });
  const first = allocate('first');
  history.stageAttempt(lease, { attemptId: first.attemptId, payload: source, provenance: provenance('mutation'), dependencies: [] });
  source[0].value = 'after';
  const reference = history.publishAttempt(lease, first.attemptId);
  expect(history.reader.readSubtree(reference, [])).toEqual([{ value: 'before' }]);
  Object.defineProperty(source, Symbol('unsupported'), { value: true });
  const second = allocate('second');
  expect(() => history.stageAttempt(lease, { attemptId: second.attemptId, payload: source, provenance: provenance('mutation'), dependencies: [] })).toThrow(TypeError);
  expect(() => history.publishAttempt(lease, second.attemptId)).toThrow();
  expect(history.recoverAttempt({ ...scope, subject: 'mutation', version: 1, attemptKey: 'second', intentDigest: 'second' })).toMatchObject({ kind: 'incomplete', attempt: { state: 'allocated' } });
  expect(history.reader.readSubtree(reference, [])).toEqual([{ value: 'before' }]);
});
