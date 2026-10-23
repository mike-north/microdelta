/** ACC-002 / RES-003/004/005: current validation charges never replace retained execution history. */
import { execFileSync, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { expect, test } from '@jest/globals';

/** Evidence stores remain in temporary output for independent durable-record inspection. */
const directory = mkdtempSync(join(tmpdir(), 'microdelta-acc002-'));
const rows = [];
function worker(phase) {
  const child = spawnSync(process.execPath, ['scratch/gap-hunt/accounting-validation/dist/worker.js', directory, phase], { encoding: 'utf8', timeout: 30000 });
  expect({ status: child.status, stderr: child.stderr }).toMatchObject({ status: 0 });
  const row = JSON.parse(child.stdout.trim());
  rows.push(row);
  return row;
}
function persisted() {
  return JSON.parse(execFileSync('python3', ['-c', "import sqlite3,json,sys; c=sqlite3.connect(sys.argv[1]); c.row_factory=sqlite3.Row; print(json.dumps({name:[dict(r) for r in c.execute('SELECT * FROM '+name)] for name in ['history_results','history_acceptances']}))", join(directory, 'history.sqlite')], { encoding: 'utf8' }));
}
function ownCharge(row, amount) {
  expect(row.sourceChecks).toBe(1);
  expect(row.sends).toBe(1);
  expect(row.originalUsage.observed).toEqual([{ unit: 'units', amount: 100 }]);
  expect(row.ownUsage).toMatchObject({ observed: [{ unit: 'units', amount }], operations: 1, requestAttempts: 1, reports: 1, status: 'complete', unknown: [] });
  const own = row.operations.flatMap(operation => operation.attempts.filter(attempt => attempt.run === `acc002:${row.phase}`).map(attempt => ({ operation: operation.operation, ...attempt })));
  expect(own).toHaveLength(1);
  expect(own[0]).toMatchObject({ status: 'succeeded', usage: 'acknowledged' });
  return own[0];
}
function retained(row, original) {
  expect(row.resolved.reference).toEqual(original.resolved.reference);
}
test('three independent processes retain exact source history while charging only current validation work', () => {
  const cold = worker('cold');
  const coldOperation = ownCharge(cold, 100);
  expect(cold.resolved.kind).toBe('published');
  const first = persisted();
  expect(first.history_results).toHaveLength(1);
  const b = worker('retain-b');
  const bOperation = ownCharge(b, 1);
  expect(b.resolved).toMatchObject({ kind: 'reused', basis: 'check' });
  retained(b, cold);
  expect(b.allUsage.observed).toEqual([{ unit: 'units', amount: 101 }]);
  const second = persisted();
  expect(second.history_results).toEqual(first.history_results);
  expect(second.history_acceptances.length).toBeGreaterThan(first.history_acceptances.length);
  const c = worker('retain-c');
  const cOperation = ownCharge(c, 1);
  expect(c.resolved).toMatchObject({ kind: 'reused', basis: 'check' });
  retained(c, cold);
  expect(c.allUsage.observed).toEqual([{ unit: 'units', amount: 102 }]);
  const third = persisted();
  expect(third.history_results).toEqual(first.history_results);
  expect(third.history_acceptances.length).toBeGreaterThan(second.history_acceptances.length);
  expect(new Set([coldOperation.operation, bOperation.operation, cOperation.operation]).size).toBe(3);
  expect(new Set([coldOperation.requestAttempt, bOperation.requestAttempt, cOperation.requestAttempt]).size).toBe(3);
  expect(b.resolved.acceptance.acceptanceId).not.toBe(c.resolved.acceptance.acceptanceId);
  // A real fresh-equal source outcome incurs one current unit but must fail the retention oracle.
  const fresh = worker('fresh-negative');
  ownCharge(fresh, 1);
  expect(fresh.resolved.kind).toBe('published');
  expect(fresh.resolved.reference).not.toEqual(cold.resolved.reference);
  expect(() => retained(fresh, cold)).toThrow();
  const fourth = persisted();
  expect(fourth.history_results).toHaveLength(2);
  expect(fourth.history_results[1].payload).toBe(first.history_results[0].payload);
  writeFileSync(join(directory, 'durable-records.json'), JSON.stringify({ first, second, third, fourth, rows }, null, 2));
  const snapshotSha256 = createHash('sha256').update(JSON.stringify(first.history_results)).digest('hex');
  console.log(JSON.stringify({ directory, phases: rows.map(row => ({ phase: row.phase, sourceChecks: row.sourceChecks, sends: row.sends, reference: row.resolved.reference, kind: row.resolved.kind, ownUsage: row.ownUsage.observed, cumulativeUsage: row.allUsage.observed })), originalResultRowsSha256: snapshotSha256, separateAcceptances: [first, second, third].map(snapshot => snapshot.history_acceptances.length), resultRowsUnchangedAcrossRetention: true, independentProcesses: 4, freshEqualRejectedByRetentionOracle: true }));
}, 120000);
