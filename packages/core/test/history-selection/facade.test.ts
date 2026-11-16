/** The library facade composes a finite owner read without an analysis or workspace. */
import { afterEach, expect, test } from '@jest/globals';

import { readHistorySelection } from '../../src/index.js';
import { cleanup, freshLocation, logicalStore, openHistory, openRaw, provenance, scope } from '../durable-history/support.js';

afterEach(cleanup);

test('facade exact selection needs only a location and reference and leaves durable owner state unchanged', () => {
  const location = freshLocation();
  const history = openHistory({ location });
  const acquired = history.acquireWriter({ holder: 'fixture', leaseMilliseconds: 10_000 });
  if (acquired.kind !== 'acquired') { throw new Error('Fixture writer unavailable'); }
  const attempt = history.allocateAttempt(acquired.lease, { ...scope, subject: 'subject:finite', version: 1, attemptKey: 'one', intentDigest: 'one' });
  history.stageAttempt(acquired.lease, { attemptId: attempt.attemptId, payload: { selected: 0, unrelated: 'retained' }, provenance: provenance('one'), dependencies: [] });
  const reference = history.publishAttempt(acquired.lease, attempt.attemptId);
  const raw = openRaw(location);
  const state = (): readonly unknown[] => ['history_writer', 'history_sequences', 'history_attempts', 'history_results', 'history_acceptances', 'history_current', 'history_journal']
    .map((table) => raw.prepare(`SELECT * FROM ${table}`).all());
  const before = state();
  const request = { operation: 'value', address: [{ kind: 'property', key: 'selected' }] } as const;
  const answer = readHistorySelection({ location, logicalStore }, { kind: 'fact', reference, request });
  expect(answer).toEqual({ kind: 'fact', selected: { ...request, fact: 0 } });
  expect(Object.isFrozen(answer)).toBe(true);
  expect('reader' in answer || 'freshness' in answer).toBe(false);
  expect(state()).toEqual(before);
});
