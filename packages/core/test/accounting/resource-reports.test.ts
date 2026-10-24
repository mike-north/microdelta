/** ACC-004/007/008: retained raw state is independent of additive evidence and execution. */
import { expect, test } from '@jest/globals';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { openDurableAccounting, openResourceReports, openResourceReportReader, AccountingDurabilityUnknownError } from '@microdelta/accounting';
import type { IResourceReport } from '@microdelta/accounting';
import { openDurableHistory } from '@microdelta/history';
import { createNodeMachine, createNodeSqlite, createNodeSqliteReader } from '@microdelta/machine-node';

/** Deterministic host timer that dispatches due callbacks only when the test advances it. */
class ControlledTime {
  time = 10_000;
  readonly pending = new Map<() => void, number>();
  currentEpochMilliseconds(): number { return this.time; }
  schedule(at: number, callback: () => void): () => void {
    this.pending.set(callback, at);
    return () => { this.pending.delete(callback); };
  }
  advance(time: number): void {
    this.time = time;
    for (const [callback, at] of [...this.pending]) {
      if (at <= time) { this.pending.delete(callback); callback(); }
    }
  }
}

/** Known provider qualifiers; missing values stay explicit instead of being inferred. */
function report(id: string, overrides: Partial<IResourceReport> = {}): IResourceReport {
  return { environment: 'production', report: id, observedAt: 10_000, validUntil: null,
    provider: 'example', service: null, account: 'opaque-account',
    pool: 'shared', resource: 'requests', unit: 'requests', window: null, allowed: 100, remaining: 93,
    ...overrides };
}

/** Isolate the dedicated report file and ensure all handles are closed by each case. */
function fixture(): { readonly directory: string; readonly location: string; readonly timer: ControlledTime; readonly cleanup: () => void } {
  const directory = mkdtempSync(join(tmpdir(), 'microdelta-reports-'));
  return { directory, location: join(directory, 'reports.sqlite'), timer: new ControlledTime(), cleanup: () => { rmSync(directory, { recursive: true, force: true }); } };
}

test('qualified reports retain zero/unknown, duplicate identity and original age without source reduction', () => {
  const f = fixture();
  const writer = openResourceReports({ sqlite: createNodeSqlite(), timer: f.timer, location: f.location, logicalStore: 'store', onMaintenanceError: () => undefined });
  const reader = openResourceReportReader({ sqlite: createNodeSqliteReader(), clock: f.timer, location: f.location, logicalStore: 'store' });
  try {
    expect(writer.record(report('a'))).toBe('recorded');
    expect(writer.record(report('b', { remaining: 90, pool: 'other', window: 'window-2' }))).toBe('recorded');
    writer.record(report('zero', { remaining: 0 }));
    writer.record(report('unknown', { remaining: null, allowed: null }));
    writer.record(report('a', { environment: 'trial' }));
    expect(writer.record(report('a'))).toBe('duplicate');
    expect(() => writer.record(report('a', { remaining: 94 }))).toThrow(/conflict/u);
    expect(reader.query('production').map((r) => r.remaining)).toEqual([93, 90, null, 0]);
    expect(reader.query('production')[1]).toMatchObject({ provider: 'example', account: 'opaque-account', pool: 'other', window: 'window-2' });
    expect(reader.query('trial')).toHaveLength(1);
    expect(reader.query('absent')).toEqual([]);
    f.timer.time += 1_800_000;
    expect(writer.record(report('a'))).toBe('duplicate');
    expect(reader.query('production')[0]).toMatchObject({ observedAt: 10_000, expiresAt: 3_610_000, retentionBasis: 'local-default', window: null });
  } finally { reader.close(); writer.close(); f.cleanup(); }
});

test('idle writer physically evicts at exact expiry; provider validity wins and close cancels callbacks', () => {
  const f = fixture();
  const writer = openResourceReports({ sqlite: createNodeSqlite(), timer: f.timer, location: f.location, logicalStore: 'store', onMaintenanceError: () => undefined });
  const reader = openResourceReportReader({ sqlite: createNodeSqliteReader(), clock: f.timer, location: f.location, logicalStore: 'store' });
  const inspect = createNodeSqliteReader().openSqliteReader(f.location);
  try {
    writer.record(report('provider', { validUntil: 10_100, localRetentionMilliseconds: 1 }));
    writer.record(report('override', { localRetentionMilliseconds: 200 }));
    expect(reader.query('production').map((r) => [r.report, r.expiresAt, r.retentionBasis])).toEqual([
      ['override', 10_200, 'local-override'], ['provider', 10_100, 'provider'],
    ]);
    f.timer.time = 10_100;
    expect(reader.query('production')).toHaveLength(1);
    expect(inspect.prepare('SELECT COUNT(*) AS n FROM resource_reports').get()).toEqual({ n: 2 });
    f.timer.advance(10_100);
    expect(inspect.prepare('SELECT COUNT(*) AS n FROM resource_reports').get()).toEqual({ n: 1 });
    f.timer.advance(10_200);
    expect(inspect.prepare('SELECT COUNT(*) AS n FROM resource_reports').get()).toEqual({ n: 0 });
    expect(() => writer.record(report('provider', { validUntil: 10_100 }))).toThrow(/expired/u);
    writer.record(report('later', { observedAt: 10_200 }));
    writer.close();
    expect(f.timer.pending.size).toBe(0);
    expect(() => writer.record(report('closed'))).toThrow();
  } finally { inspect.close(); reader.close(); writer.close(); f.cleanup(); }
});

test('durable acknowledgment survives independent process and long-absence writable open evicts', () => {
  const f = fixture();
  const options = { sqlite: createNodeSqlite(), timer: f.timer, location: f.location, logicalStore: 'store', onMaintenanceError: () => undefined };
  let writer = openResourceReports(options);
  try {
    writer.record(report('original'));
    writer.close();
    const accounting = fileURLToPath(new URL('../../../../accounting/dist/src/index.js', import.meta.url));
    const machine = fileURLToPath(new URL('../../../../machine-node/dist/src/index.js', import.meta.url));
    const child = spawnSync(process.execPath, ['--input-type=module', '-e', `
      const {openResourceReportReader}=await import(process.env.ACCOUNTING);
      const {createNodeSqliteReader}=await import(process.env.MACHINE);
      const reader=openResourceReportReader({sqlite:createNodeSqliteReader(),clock:{currentEpochMilliseconds:()=>1810000},location:process.env.LOCATION,logicalStore:'store'});
      console.log(JSON.stringify(reader.query('production'))); reader.close();
    `], { encoding: 'utf8', env: { ...process.env, ACCOUNTING: accounting, MACHINE: machine, LOCATION: f.location } });
    expect(child.stderr).toBe('');
    expect(child.status).toBe(0);
    expect(JSON.parse(child.stdout)).toEqual([expect.objectContaining({ report: 'original', observedAt: 10_000, expiresAt: 3_610_000 })]);
    f.timer.time += 3 * 86_400_000;
    writer = openResourceReports(options);
    const inspect = createNodeSqliteReader().openSqliteReader(f.location);
    try { expect(inspect.prepare('SELECT COUNT(*) AS n FROM resource_reports').get()).toEqual({ n: 0 }); }
    finally { inspect.close(); }
  } finally { writer.close(); f.cleanup(); }
});

test('invalid timing never acknowledges; storage failure cannot return a durable acknowledgment', () => {
  const f = fixture();
  const base = createNodeSqlite();
  let fail = false;
  const writer = openResourceReports({ sqlite: { openSqlite(location, openOptions) {
    const connection = base.openSqlite(location, openOptions);
    return { ...connection, transaction<T>(operation: () => T): T {
      let outcome: { readonly value: T } | undefined;
      connection.transaction(() => { outcome = { value: operation() }; if (fail) { throw new Error('disk failure'); } });
      if (outcome === undefined) { throw new Error('transaction did not run'); }
      return outcome.value;
    } };
  } }, timer: f.timer, location: f.location, logicalStore: 'store', onMaintenanceError: () => undefined });
  try {
    expect(() => writer.record(report('future', { observedAt: 10_001 }))).toThrow();
    expect(() => writer.record(report('invalid', { validUntil: 10_000 }))).toThrow();
    expect(() => writer.record(report('invalid', { localRetentionMilliseconds: 0 }))).toThrow();
    for (const malformed of [{ observedAt: Number.NaN }, { validUntil: Number.POSITIVE_INFINITY }, { remaining: -1 }, { localRetentionMilliseconds: Number.MAX_SAFE_INTEGER }]) {
      expect(() => writer.record(report('malformed', malformed))).toThrow();
    }
    fail = true;
    expect(() => writer.record(report('failure'))).toThrow(AccountingDurabilityUnknownError);
  } finally { writer.close(); f.cleanup(); }
});

test('scheduled failures retry even when error reporting throws, and canceled queued callbacks cannot write', () => {
  const f = fixture();
  const base = createNodeSqlite();
  let fail = false;
  let transactions = 0;
  const failures: unknown[] = [];
  const writer = openResourceReports({ sqlite: { openSqlite(location, openOptions) {
    const connection = base.openSqlite(location, openOptions);
    return { ...connection, transaction<T>(operation: () => T): T {
      transactions += 1;
      if (fail) { throw new Error('storage offline'); }
      let outcome: { readonly value: T } | undefined;
      connection.transaction(() => { outcome = { value: operation() }; });
      if (outcome === undefined) { throw new Error('transaction did not run'); }
      return outcome.value;
    } };
  } }, timer: f.timer, location: f.location, logicalStore: 'store', onMaintenanceError(error) {
    failures.push(error); throw new Error('observer failed');
  } });
  const inspect = createNodeSqliteReader().openSqliteReader(f.location);
  try {
    writer.record(report('expires', { validUntil: 10_100 }));
    fail = true;
    expect(() => f.timer.advance(10_100)).not.toThrow();
    expect(failures).toHaveLength(1);
    expect(inspect.prepare('SELECT COUNT(*) AS n FROM resource_reports').get()).toEqual({ n: 1 });
    expect([...f.timer.pending.values()]).toEqual([70_100]);
    fail = false;
    f.timer.advance(70_100);
    expect(inspect.prepare('SELECT COUNT(*) AS n FROM resource_reports').get()).toEqual({ n: 0 });
    const queued = [...f.timer.pending.keys()];
    writer.close();
    const before = transactions;
    queued.forEach((callback) => { callback(); });
    expect(transactions).toBe(before);
    expect(f.timer.pending.size).toBe(0);
  } finally { inspect.close(); writer.close(); f.cleanup(); }
});

test('repeated expiry cycles remove stored rows and idle writers notice reports from other closed writers', () => {
  const f = fixture();
  const options = { sqlite: createNodeSqlite(), timer: f.timer, location: f.location, logicalStore: 'store', onMaintenanceError: () => undefined };
  const idle = openResourceReports(options);
  const otherTime = new ControlledTime();
  const other = openResourceReports({ ...options, timer: otherTime });
  const inspect = createNodeSqliteReader().openSqliteReader(f.location);
  try {
    other.record(report('other-process', { validUntil: 10_100 }));
    other.close();
    f.timer.advance(70_000);
    expect(inspect.prepare('SELECT COUNT(*) AS n FROM resource_reports').get()).toEqual({ n: 0 });
    for (let cycle = 0; cycle < 20; cycle += 1) {
      idle.record(report(`cycle-${String(cycle)}`, { observedAt: f.timer.time, localRetentionMilliseconds: 10 }));
      f.timer.advance(f.timer.time + 10);
      expect(inspect.prepare('SELECT COUNT(*) AS n FROM resource_reports').get()).toEqual({ n: 0 });
    }
  } finally { inspect.close(); idle.close(); other.close(); f.cleanup(); }
});

test('inspection refuses missing/empty/foreign/other-store files without writable capabilities', () => {
  const f = fixture();
  const options = { sqlite: createNodeSqliteReader(), clock: f.timer, location: f.location, logicalStore: 'store' };
  try {
    expect(() => openResourceReportReader(options)).toThrow();
    const empty = createNodeSqlite().openSqlite(f.location, { journalMode: 'delete' });
    expect(() => openResourceReportReader(options)).toThrow(/schema/u);
    expect(empty.prepare('SELECT name FROM sqlite_master').all()).toEqual([]);
    empty.exec('CREATE TABLE foreign_data(value TEXT)');
    expect(() => openResourceReportReader(options)).toThrow(/schema/u);
    empty.close();
    const writer = openResourceReports({ sqlite: createNodeSqlite(), timer: f.timer, location: join(f.directory, 'valid.sqlite'), logicalStore: 'store', onMaintenanceError: () => undefined });
    writer.close();
    expect(() => openResourceReportReader({ ...options, location: join(f.directory, 'valid.sqlite'), logicalStore: 'other' })).toThrow(/identity/u);
  } finally { f.cleanup(); }
});

test('balances 93 and 90 coexist with consumption 5 and expiry never repairs a usage gap or deletes attempts', () => {
  const f = fixture();
  const usageLocation = join(f.directory, 'usage.sqlite');
  const usage = openDurableAccounting({ sqlite: createNodeSqlite(), location: usageLocation, logicalStore: 'store' });
  const writer = openResourceReports({ sqlite: createNodeSqlite(), timer: f.timer, location: f.location, logicalStore: 'store', onMaintenanceError: () => undefined });
  const reader = openResourceReportReader({ sqlite: createNodeSqliteReader(), clock: f.timer, location: f.location, logicalStore: 'store' });
  try {
    for (const requestAttempt of ['first', 'second', 'missing']) {
      usage.recordUsageIntent({ environment: 'production', operation: 'operation', requestAttempt, attribution: { run: 'run', member: null, stepAttempt: null } });
    }
    usage.acknowledgeUsage({ environment: 'production', operation: 'operation', requestAttempt: 'first', report: 'first', quantities: [{ unit: 'requests', amount: 2 }] });
    usage.acknowledgeUsage({ environment: 'production', operation: 'operation', requestAttempt: 'second', report: 'second', quantities: [{ unit: 'requests', amount: 3 }] });
    writer.record(report('newer', { remaining: 90, observedAt: 10_000 }));
    writer.record(report('older', { remaining: 93, observedAt: 9_000 }));
    const before = usage.summarizeUsage({ environment: 'production' });
    expect(before).toMatchObject({ status: 'incomplete', requestAttempts: 3, observed: [{ unit: 'requests', amount: 5 }], unknown: [{ requestAttempt: 'missing' }] });
    expect(reader.query('production').map((r) => r.remaining)).toEqual([90, 93]);
    f.timer.advance(3_610_000);
    expect(reader.query('production')).toEqual([]);
    expect(usage.summarizeUsage({ environment: 'production' })).toEqual(before);
    expect(() => openResourceReports({ sqlite: createNodeSqlite(), timer: f.timer, location: usageLocation, logicalStore: 'store', onMaintenanceError: () => undefined })).toThrow(/WAL|schema/u);
    expect(usage.summarizeUsage({ environment: 'production' })).toEqual(before);
  } finally { reader.close(); writer.close(); usage.close(); f.cleanup(); }
});


test('state eviction and foreign-file refusal preserve History attempts and exact completed-result evidence', () => {
  const f = fixture();
  const historyLocation = join(f.directory, 'history.sqlite');
  const history = openDurableHistory({ sqlite: createNodeSqlite(), clock: f.timer, sha256: createNodeMachine(), location: historyLocation, logicalStore: 'store' });
  const writer = openResourceReports({ sqlite: createNodeSqlite(), timer: f.timer, location: f.location, logicalStore: 'store', onMaintenanceError: () => undefined });
  try {
    const acquisition = history.acquireWriter({ holder: 'test', leaseMilliseconds: 10_000 });
    if (acquisition.kind !== 'acquired') { throw new Error('test writer could not acquire'); }
    const request = { analysis: 'analysis', environment: 'production', subject: 'subject', version: 1, attemptKey: 'attempt', intentDigest: 'intent' };
    const attempt = history.allocateAttempt(acquisition.lease, request);
    history.stageAttempt(acquisition.lease, { attemptId: attempt.attemptId, payload: { evidence: 93 }, provenance: { format: 'test', formatVersion: 1, content: {} }, dependencies: [] });
    const reference = history.publishAttempt(acquisition.lease, attempt.attemptId);
    const envelope = history.readEnvelope(reference);
    const recovered = history.recoverAttempt(request);
    writer.record(report('state', { localRetentionMilliseconds: 1 }));
    f.timer.advance(10_001);
    expect(history.readEnvelope(reference)).toEqual(envelope);
    expect(history.recoverAttempt(request)).toEqual(recovered);
    expect(() => openResourceReports({ sqlite: createNodeSqlite(), timer: f.timer, location: historyLocation, logicalStore: 'store', onMaintenanceError: () => undefined })).toThrow(/WAL/u);
    expect(history.readEnvelope(reference)).toEqual(envelope);
    expect(history.recoverAttempt(request)).toEqual(recovered);
  } finally { writer.close(); history.close(); f.cleanup(); }
});

test('a failed post-commit scheduling read preserves the existing cleanup timer and reports maintenance failure separately', () => {
  const f = fixture();
  const base = createNodeSqlite();
  let failScheduleRead = false;
  const failures: unknown[] = [];
  const writer = openResourceReports({ sqlite: { openSqlite(location, openOptions) {
    const connection = base.openSqlite(location, openOptions);
    return { ...connection, prepare(sql) {
      if (failScheduleRead && sql.includes('MIN(expires_at)')) { throw new Error('schedule read unavailable'); }
      return connection.prepare(sql);
    } };
  } }, timer: f.timer, location: f.location, logicalStore: 'store', onMaintenanceError: (error) => { failures.push(error); } });
  const reader = openResourceReportReader({ sqlite: createNodeSqliteReader(), clock: f.timer, location: f.location, logicalStore: 'store' });
  const inspect = createNodeSqliteReader().openSqliteReader(f.location);
  try {
    failScheduleRead = true;
    expect(writer.record(report('committed', { validUntil: 10_100 }))).toBe('recorded');
    expect(reader.query('production')).toHaveLength(1);
    expect(failures).toHaveLength(1);
    expect([...f.timer.pending.values()]).toEqual([70_000]);
    failScheduleRead = false;
    f.timer.advance(70_000);
    expect(inspect.prepare('SELECT COUNT(*) AS n FROM resource_reports').get()).toEqual({ n: 0 });
  } finally { inspect.close(); reader.close(); writer.close(); f.cleanup(); }
});
