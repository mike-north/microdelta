/**
 * Consumer scale regression probe: acknowledging one new acceptance should not
 * materialize every historical acceptance. This constrains returned SQL rows,
 * not wall time or full-history inspection, which remains a separate API.
 * DOM-3 / TEST-5 motivate bounded materialization; the one-row expectation is
 * the proposed regression boundary for the measured acknowledgement hot path.
 */
import { afterEach, expect, test } from '@jest/globals';
import { HistoryIntegrityError, StaleWriterError } from '@microdelta/history';
import type { ICompletedResultReference, IDurableHistory, ISqliteCapability, IWriterLease } from '@microdelta/history';
import { createNodeSqlite } from '@microdelta/machine-node';

import { cleanup, freshLocation, openHistory, openRaw, provenance, scope } from '../durable-history/support.js';
import type { ISqliteRow } from '../durable-history/support.js';

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

/** Test-only readback faults never replace the real SQLite transaction or storage. */
type IReadbackFault =
  | { readonly kind: 'none' | 'missing' | 'wrong-id' | 'wrong-result' | 'wrong-environment' | 'insert-failure' | 'later-decoy' }
  | { readonly kind: 'stale-evidence'; readonly prior: ISqliteRow };

/** A real SQLite port that counts materialized acceptance rows and can corrupt one acknowledgement. */
function observedAcceptanceSqlite(): {
  readonly capability: ISqliteCapability;
  readonly measure: <T>(operation: () => T) => { readonly result: T; readonly rows: number };
  readonly setFault: (next: IReadbackFault) => void;
} {
  const real = createNodeSqlite();
  let measuring = false;
  let rowsRead = 0;
  let fault: IReadbackFault = { kind: 'none' };
  const changeRow = (row: ISqliteRow): ISqliteRow => {
    switch (fault.kind) {
      case 'wrong-id': return { ...row, acceptance_id: -1 };
      case 'wrong-result': return { ...row, result_id: -1 };
      case 'wrong-environment': return { ...row, environment: 'env:foreign' };
      case 'stale-evidence': {
        const format = fault.prior.evidence_format;
        const version = fault.prior.evidence_version;
        const evidence = fault.prior.evidence;
        if (format === undefined || version === undefined || evidence === undefined) {
          throw new Error('Expected stored prior evidence fields');
        }
        return { ...row, evidence_format: format, evidence_version: version, evidence };
      }
      default: return row;
    }
  };
  return {
    capability: {
      openSqlite(location) {
        const connection = real.openSqlite(location);
        return {
          ...connection,
          prepare(text) {
            const statement = connection.prepare(text);
            const isAcceptanceRead = /FROM history_acceptances\b/u.test(text);
            const isAcceptanceInsert = /INSERT INTO history_acceptances\b/u.test(text);
            return {
              run(...values) {
                if (measuring && isAcceptanceInsert && fault.kind === 'insert-failure') {
                  throw new Error('injected acceptance insert failure');
                }
                const result = statement.run(...values);
                if (measuring && isAcceptanceInsert && fault.kind === 'later-decoy') {
                  const [insertedId] = values;
                  if (typeof insertedId !== 'number') { throw new Error('Expected inserted acceptance ID'); }
                  // A later same-result/environment row makes a newest-row lookup observably wrong.
                  connection.prepare(text).run(insertedId + 1, ...values.slice(1));
                }
                return result;
              },
              get(...values) {
                const row = statement.get(...values);
                if (!measuring || !isAcceptanceRead) { return row; }
                rowsRead += row === undefined ? 0 : 1;
                return fault.kind === 'missing' || row === undefined ? undefined : changeRow(row);
              },
              all(...values) {
                const rows = statement.all(...values);
                if (!measuring || !isAcceptanceRead) { return rows; }
                rowsRead += rows.length;
                return fault.kind === 'missing' ? [] : rows.map(changeRow);
              },
            };
          },
        };
      },
    },
    measure<T>(operation: () => T) {
      rowsRead = 0;
      measuring = true;
      try {
        const result = operation();
        return { result, rows: rowsRead };
      } finally {
        measuring = false;
      }
    },
    setFault(next) { fault = next; },
  };
}

/** Publish one result in a named environment without substituting a fake History owner. */
function publish(history: IDurableHistory, lease: IWriterLease, environment: string, subject: string): ICompletedResultReference {
  const attempt = history.allocateAttempt(lease, {
    analysis: scope.analysis, environment, subject, version: 1, attemptKey: subject, intentDigest: subject,
  });
  history.stageAttempt(lease, { attemptId: attempt.attemptId, payload: { subject }, provenance: provenance(subject), dependencies: [] });
  return history.publishAttempt(lease, attempt.attemptId);
}

/** One new immutable acceptance whose evidence identifies this specific check. */
function accept(
  history: IDurableHistory,
  lease: IWriterLease,
  reference: ICompletedResultReference,
  environment: string,
  check: string,
  dependencies: readonly ICompletedResultReference[] = [],
): ReturnType<IDurableHistory['recordAcceptance']> {
  return history.recordAcceptance(lease, {
    reference, environment, evidence: { format: 'test.scale', formatVersion: 1, content: { check } }, dependencies,
  });
}

test('bounded acknowledgements preserve full histories across interleaved results and environments', () => {
  const location = freshLocation();
  const probe = observedAcceptanceSqlite();
  const history = openHistory({ location, sqlite: probe.capability });
  const acquisition = history.acquireWriter({ holder: 'scale-matrix', leaseMilliseconds: 10_000 });
  if (acquisition.kind !== 'acquired') { throw new Error('Expected writer'); }
  const lease = acquisition.lease;
  const first = publish(history, lease, scope.environment, 'first');
  const second = publish(history, lease, scope.environment, 'second');
  const trial = publish(history, lease, 'env:trial', 'first');
  const targets = [
    { reference: first, environment: scope.environment, dependencies: [second] },
    { reference: second, environment: scope.environment, dependencies: [] },
    { reference: trial, environment: 'env:trial', dependencies: [] },
  ];
  const envelopes = targets.map(({ reference }) => history.readEnvelope(reference));
  const histories: Array<Array<ReturnType<IDurableHistory['recordAcceptance']>>> = targets.map(() => []);
  for (let index = 0; index < 36; index += 1) {
    const position = index % targets.length;
    const target = targets[position];
    const records = histories[position];
    if (target === undefined || records === undefined) { throw new Error('Missing matrix target'); }
    const check = `check-${String(index)}`;
    const { result, rows } = probe.measure(() => accept(history, lease, target.reference, target.environment, check, target.dependencies));
    expect(rows).toBe(1);
    expect(result).toMatchObject({ reference: target.reference, environment: target.environment, fence: lease.fence, dependencies: target.dependencies, evidence: { content: { check } } });
    records.push(result);
  }
  targets.forEach((target, position) => {
    expect(history.readAcceptances(target.reference, target.environment)).toEqual(histories[position]);
    expect(history.readEnvelope(target.reference)).toEqual(envelopes[position]);
  });
  expect(openRaw(location).prepare('SELECT COUNT(*) AS total FROM history_acceptances').get()).toMatchObject({ total: 36 });
});

test('acknowledgement names the inserted ID even if a later row exists for the same result and environment', () => {
  const probe = observedAcceptanceSqlite();
  const history = openHistory({ location: freshLocation(), sqlite: probe.capability });
  const acquisition = history.acquireWriter({ holder: 'exact-id', leaseMilliseconds: 10_000 });
  if (acquisition.kind !== 'acquired') { throw new Error('Expected writer'); }
  const lease = acquisition.lease;
  const reference = publish(history, lease, scope.environment, 'exact-id');
  for (let index = 0; index < 12; index += 1) {
    accept(history, lease, reference, scope.environment, `prior-${String(index)}`);
  }
  const previous = history.readAcceptances(reference, scope.environment).at(-1);
  if (previous === undefined) { throw new Error('Expected prior acceptance'); }
  probe.setFault({ kind: 'later-decoy' });
  const { result, rows } = probe.measure(() => accept(history, lease, reference, scope.environment, 'inserted'));
  expect(rows).toBe(1);
  expect(result.acceptanceId).toBe(previous.acceptanceId + 1);
  expect(result.evidence.content).toEqual({ check: 'inserted' });
  const complete = history.readAcceptances(reference, scope.environment);
  expect(complete).toHaveLength(14);
  expect(complete.at(-2)).toEqual(result);
  expect(complete.at(-1)?.acceptanceId).toBe(result.acceptanceId + 1);
});

test.each(['missing', 'wrong-id', 'wrong-result', 'wrong-environment', 'stale-evidence'] as const)(
  '%s readback cannot acknowledge or commit a new acceptance', kind => {
    const location = freshLocation();
    const probe = observedAcceptanceSqlite();
    const history = openHistory({ location, sqlite: probe.capability });
    const acquisition = history.acquireWriter({ holder: `failure-${kind}`, leaseMilliseconds: 10_000 });
    if (acquisition.kind !== 'acquired') { throw new Error('Expected writer'); }
    const lease = acquisition.lease;
    const reference = publish(history, lease, scope.environment, 'failure');
    const previous = accept(history, lease, reference, scope.environment, 'previous');
    const raw = openRaw(location);
    const prior = raw.prepare('SELECT evidence_format, evidence_version, evidence FROM history_acceptances WHERE acceptance_id = ?').get(previous.acceptanceId);
    if (prior === undefined) { throw new Error('Expected prior stored evidence'); }
    const before = history.readAcceptances(reference, scope.environment);
    const sequenceBefore = raw.prepare('SELECT last_acceptance FROM history_sequences WHERE singleton = 1').get();
    probe.setFault(kind === 'stale-evidence' ? { kind, prior } : { kind });
    expect(() => probe.measure(() => accept(history, lease, reference, scope.environment, 'new'))).toThrow(HistoryIntegrityError);
    expect(history.readAcceptances(reference, scope.environment)).toEqual(before);
    expect(raw.prepare('SELECT last_acceptance FROM history_sequences WHERE singleton = 1').get()).toEqual(sequenceBefore);
  },
);

test('failed insert and stale writer never return or commit a completed acceptance', () => {
  const location = freshLocation();
  const probe = observedAcceptanceSqlite();
  const history = openHistory({ location, sqlite: probe.capability });
  const acquisition = history.acquireWriter({ holder: 'insert-failure', leaseMilliseconds: 10_000 });
  if (acquisition.kind !== 'acquired') { throw new Error('Expected writer'); }
  const lease = acquisition.lease;
  const reference = publish(history, lease, scope.environment, 'insert-failure');
  const raw = openRaw(location);
  const sequenceBefore = raw.prepare('SELECT last_acceptance FROM history_sequences WHERE singleton = 1').get();
  probe.setFault({ kind: 'insert-failure' });
  expect(() => probe.measure(() => accept(history, lease, reference, scope.environment, 'failed'))).toThrow('injected acceptance insert failure');
  expect(history.readAcceptances(reference, scope.environment)).toEqual([]);
  expect(raw.prepare('SELECT last_acceptance FROM history_sequences WHERE singleton = 1').get()).toEqual(sequenceBefore);
  history.releaseWriter(lease);
  const next = history.acquireWriter({ holder: 'next-writer', leaseMilliseconds: 10_000 });
  if (next.kind !== 'acquired') { throw new Error('Expected replacement writer'); }
  expect(() => accept(history, lease, reference, scope.environment, 'stale')).toThrow(StaleWriterError);
  expect(history.readAcceptances(reference, scope.environment)).toEqual([]);
});
