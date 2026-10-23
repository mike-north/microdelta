/**
 * Consumer scale regression probe: acknowledging one new acceptance should not
 * materialize every historical acceptance. This constrains returned SQL rows,
 * not wall time or full-history inspection, which remains a separate API.
 * DOM-3 / TEST-5 motivate bounded materialization; the one-row expectation is
 * the proposed regression boundary for the measured acknowledgement hot path.
 */
import { afterEach, expect, test } from '@jest/globals';
import type { ISqliteCapability } from '@microdelta/history';
import { createNodeSqlite } from '@microdelta/machine-node';

import { cleanup, freshLocation, openHistory, provenance, scope } from '../durable-history/support.js';

afterEach(cleanup);

test('acknowledging each new acceptance returns only that acceptance from SQL', () => {
  const real = createNodeSqlite();
  const rowsPerAcknowledgement: number[] = [];
  let counting = false;
  let rowsRead = 0;
  const sqlite: ISqliteCapability = {
    openSqlite(location) {
      const connection = real.openSqlite(location);
      return {
        ...connection,
        prepare(text) {
          const statement = connection.prepare(text);
          // Observe only actual acceptance records, excluding their dependencies.
          const isAcceptanceRead = /SELECT[\s\S]*FROM history_acceptances\b/u.test(text);
          return {
            run: (...values) => statement.run(...values),
            get(...values) {
              const row = statement.get(...values);
              if (counting && isAcceptanceRead && row !== undefined) {rowsRead += 1;}
              return row;
            },
            all(...values) {
              const rows = statement.all(...values);
              if (counting && isAcceptanceRead) {rowsRead += rows.length;}
              return rows;
            },
          };
        },
      };
    },
  };
  const history = openHistory({ location: freshLocation(), sqlite });
  const acquisition = history.acquireWriter({ holder: 'scale-probe', leaseMilliseconds: 10_000 });
  if (acquisition.kind !== 'acquired') {throw new Error('Expected fresh store writer');}
  const lease = acquisition.lease;
  const attempt = history.allocateAttempt(lease, { ...scope, subject: 'constant', version: 1, attemptKey: 'publish', intentDigest: 'publish' });
  history.stageAttempt(lease, { attemptId: attempt.attemptId, payload: { value: 42 }, provenance: provenance('scale'), dependencies: [] });
  const reference = history.publishAttempt(lease, attempt.attemptId);
  for (let index = 0; index < 3; index += 1) {
    rowsRead = 0;
    counting = true;
    history.recordAcceptance(lease, { reference, environment: scope.environment, evidence: { format: 'test.scale', formatVersion: 1, content: { index } }, dependencies: [] });
    counting = false;
    rowsPerAcknowledgement.push(rowsRead);
  }
  // Full inspection must still retain every immutable acceptance record.
  expect(history.readAcceptances(reference, scope.environment)).toHaveLength(3);
  expect(rowsPerAcknowledgement).toEqual([1, 1, 1]);
});
