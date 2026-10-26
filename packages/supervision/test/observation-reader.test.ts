/**
 * CLI-005 finite-reader outcome tests. Fixtures are SQLite artifacts without
 * author modules; these assertions cover exact selection and bounded refusal.
 */
import { spawn, spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, expect, test } from '@jest/globals';
import { SqliteBusyError } from '@microdelta/machine';
import { createNodeSqlite, createNodeSqliteReader } from '@microdelta/machine-node';

import { openExecutionObservationReader } from '../src/index.js';

/** Seed a fixed one-row owner artifact with a deliberately chosen JSON document. */
function seed(location: string, executionId: string, revision: number, document: string): void {
  const connection = createNodeSqlite().openSqlite(location, { journalMode: 'delete' });
  try {
    connection.exec('CREATE TABLE microdelta_execution_observation (slot INTEGER PRIMARY KEY CHECK (slot = 1), execution_id TEXT NOT NULL, revision INTEGER NOT NULL, document TEXT NOT NULL)');
    connection.prepare('INSERT INTO microdelta_execution_observation (slot, execution_id, revision, document) VALUES (1, ?, ?, ?)').run(executionId, revision, document);
  } finally { connection.close(); }
}

/** A minimal valid bounded sample, independent of production serialization. */
function sample(executionId: string, revision = 1): string {
  return JSON.stringify({ version: 1, result: { kind: 'observed', observation: { executionId, revision, sampledAt: 1000, context: { runId: 'weekly', analysis: 'analysis:test', environment: 'env:test' }, phase: 'prepared', eventCounts: { step: 0, ordinary: 0, operation: 0, send: 0, wait: 0, promotion: 0, stop: 0, lowerBound: false } } } });
}

describe('finite exact execution reader (A-21f)', () => {
  test('missing is absent, while schema-missing and unsupported versions are explicit', () => {
    const directory = mkdtempSync(join(tmpdir(), 'microdelta-read-'));
    try {
      const id = 'a'.repeat(32);
      const absent = openExecutionObservationReader(createNodeSqliteReader(), { location: join(directory, 'missing.sqlite'), executionId: id });
      expect(absent.read().result.kind).toBe('absent');
      absent.close();
      const unrelated = join(directory, 'unrelated.sqlite');
      const connection = createNodeSqlite().openSqlite(unrelated, { journalMode: 'delete' });
      connection.exec('CREATE TABLE unrelated (id INTEGER)');
      connection.close();
      const unsupported = openExecutionObservationReader(createNodeSqliteReader(), { location: unrelated, executionId: id });
      expect(unsupported.read().result.kind).toBe('unsupported');
      unsupported.close();
      const future = join(directory, 'future.sqlite');
      seed(future, id, 1, JSON.stringify({ version: 2, result: { kind: 'observed', observation: {} } }));
      const futureReader = openExecutionObservationReader(createNodeSqliteReader(), { location: future, executionId: id });
      expect(futureReader.read().result.kind).toBe('unsupported');
      futureReader.close();
      expect(readdirSync(directory).sort()).toEqual(['future.sqlite', 'unrelated.sqlite']);
    } finally { rmSync(directory, { recursive: true, force: true }); }
  });

  test('mutable locator cannot retarget an opened reader, and close is local and idempotent', () => {
    const directory = mkdtempSync(join(tmpdir(), 'microdelta-read-'));
    try {
      const firstId = 'a'.repeat(32);
      const secondId = 'b'.repeat(32);
      const firstLocation = join(directory, 'first.sqlite');
      const secondLocation = join(directory, 'second.sqlite');
      seed(firstLocation, firstId, 1, sample(firstId));
      seed(secondLocation, secondId, 1, sample(secondId));
      const mutable = { location: firstLocation, executionId: firstId };
      const reader = openExecutionObservationReader(createNodeSqliteReader(), mutable);
      mutable.location = secondLocation;
      mutable.executionId = secondId;
      const document = reader.read();
      expect(document.version).toBe(1);
      expect(document.result.kind).toBe('observed');
      if (document.result.kind === 'observed') { expect(document.result.observation.executionId).toBe(firstId); }
      reader.close();
      reader.close();
      expect(() => reader.read()).toThrow(/closed/u);
      const other = openExecutionObservationReader(createNodeSqliteReader(), { location: firstLocation, executionId: firstId });
      expect(other.read().result.kind).toBe('observed');
      other.close();
    } finally { rmSync(directory, { recursive: true, force: true }); }
  });

  test('malformed schema content is corrupt and cannot return arbitrary payloads', () => {
    const directory = mkdtempSync(join(tmpdir(), 'microdelta-read-'));
    try {
      const id = 'a'.repeat(32);
      const malformed = join(directory, 'malformed.sqlite');
      seed(malformed, id, 1, '{invalid-json');
      const malformedReader = openExecutionObservationReader(createNodeSqliteReader(), { location: malformed, executionId: id });
      expect(malformedReader.read().result.kind).toBe('corrupt');
      malformedReader.close();
      const payload = join(directory, 'payload.sqlite');
      seed(payload, id, 1, JSON.stringify({ version: 1, result: { kind: 'observed', observation: { executionId: id, revision: 1, sampledAt: 'now', context: { runId: 'weekly', analysis: 'analysis:test', environment: 'env:test' }, phase: 'prepared', rawProviderPayload: { secret: 'x' } } } }));
      const payloadReader = openExecutionObservationReader(createNodeSqliteReader(), { location: payload, executionId: id });
      expect(payloadReader.read().result.kind).toBe('corrupt');
      expect(JSON.stringify(payloadReader.read())).not.toContain('secret');
      payloadReader.close();
    } finally { rmSync(directory, { recursive: true, force: true }); }
  });

  test('an unrecognized Supervision failure code is corrupt rather than arbitrary protocol text', () => {
    const directory = mkdtempSync(join(tmpdir(), 'microdelta-read-'));
    try {
      const id = 'a'.repeat(32);
      const location = join(directory, 'failure.sqlite');
      const document = JSON.parse(sample(id)) as { result: { observation: Record<string, unknown> } };
      document.result.observation = {
        ...document.result.observation,
        phase: 'closed', body: 'threw', application: { kind: 'not-classified' },
        stop: { level: 'none' }, diagnostics: { present: false, count: 0, lowerBound: false },
        interruptions: { cancelled: 0, running: 0, unknown: 0, lowerBound: false },
        executionFailure: { kind: 'supervision', code: 'secret-provider-text' },
      };
      seed(location, id, 1, JSON.stringify(document));
      const reader = openExecutionObservationReader(createNodeSqliteReader(), { location, executionId: id });
      expect(reader.read().result.kind).toBe('corrupt');
      reader.close();
    } finally { rmSync(directory, { recursive: true, force: true }); }
  });

  test('typed contention is busy and unknown host failure is unavailable, never a raw thrown read', () => {
    const locator = { location: '/irrelevant.sqlite', executionId: 'a'.repeat(32) };
    const busy = openExecutionObservationReader({ openSqliteReader: () => { throw new SqliteBusyError('busy', 5); } }, locator);
    expect(busy.read().result.kind).toBe('busy');
    const unavailable = openExecutionObservationReader({ openSqliteReader: () => { throw new Error('unknown host fault'); } }, locator);
    expect(unavailable.read().result.kind).toBe('unavailable');
  });
});

describe('finite reader host cleanup (A-21f)', () => {
  test('a host close fault cannot replace a finite read result', () => {
    const locator = { location: '/irrelevant.sqlite', executionId: 'a'.repeat(32) };
    const reader = openExecutionObservationReader({
      openSqliteReader: () => ({
        prepare: () => ({ get: () => undefined, all: () => [] }),
        close: () => { throw new Error('close failed'); },
      }),
    }, locator);
    expect(reader.read()).toEqual({ version: 1, result: { kind: 'unsupported' } });
    reader.close();
    reader.close();
  });
});

/** Host refusals have fixed protocol meanings and may not repair the artifact. */
describe('finite reader host states (A-21f/h)', () => {
  test('WAL and corrupt files are finite refusals with unchanged bytes and no sidecars', () => {
    const directory = mkdtempSync(join(tmpdir(), 'microdelta-read-'));
    try {
      const id = 'a'.repeat(32);
      const wal = join(directory, 'wal.sqlite');
      const connection = createNodeSqlite().openSqlite(wal, { journalMode: 'wal' });
      connection.exec('CREATE TABLE retained (id INTEGER)');
      connection.close();
      const foreign = join(directory, 'foreign.sqlite');
      writeFileSync(foreign, 'not a SQLite database');
      const beforeWal = readFileSync(wal);
      const beforeForeign = readFileSync(foreign);
      const beforeNames = readdirSync(directory).sort();
      const walReader = openExecutionObservationReader(createNodeSqliteReader(), { location: wal, executionId: id });
      const foreignReader = openExecutionObservationReader(createNodeSqliteReader(), { location: foreign, executionId: id });
      expect(walReader.read().result.kind).toBe('unsupported');
      expect(foreignReader.read().result.kind).toBe('corrupt');
      walReader.close();
      foreignReader.close();
      expect(readFileSync(wal)).toEqual(beforeWal);
      expect(readFileSync(foreign)).toEqual(beforeForeign);
      expect(readdirSync(directory).sort()).toEqual(beforeNames);
    } finally { rmSync(directory, { recursive: true, force: true }); }
  });

  test('a hot rollback journal is recovery-required and inspection leaves it untouched', () => {
    const directory = mkdtempSync(join(tmpdir(), 'microdelta-read-'));
    try {
      const id = 'a'.repeat(32);
      const location = join(directory, 'hot.sqlite');
      seed(location, id, 1, sample(id));
      const source = `import Database from 'better-sqlite3';
const db = new Database(process.argv[1]);
db.exec('CREATE TABLE spill_fixture (id INTEGER PRIMARY KEY, payload BLOB NOT NULL)');
const insert = db.prepare('INSERT INTO spill_fixture (id, payload) VALUES (?, ?)');
db.transaction(() => { for (let index = 0; index < 1000; index += 1) { insert.run(index, Buffer.alloc(4096, 0x41)); } })();
db.pragma('cache_size = 10');
db.pragma('cache_spill = ON');
db.exec('BEGIN IMMEDIATE');
db.prepare('UPDATE spill_fixture SET payload = randomblob(4096)').run();
db.prepare('UPDATE microdelta_execution_observation SET revision = 2 WHERE slot = 1').run();
process.kill(process.pid, 'SIGKILL');`;
      const child = spawnSync(process.execPath, ['--input-type=module', '-e', source, location], { cwd: process.cwd(), encoding: 'utf8', timeout: 10_000 });
      expect(child.signal).toBe('SIGKILL');
      const before = readdirSync(directory).sort();
      expect(before).toContain('hot.sqlite-journal');
      const journalBefore = readFileSync(`${location}-journal`);
      expect(journalBefore.subarray(0, 8).toString('hex')).toBe('d9d505f920a163d7');
      const databaseBefore = readFileSync(location);
      const reader = openExecutionObservationReader(createNodeSqliteReader(), { location, executionId: id });
      expect(reader.read().result.kind).toBe('recovery-required');
      reader.close();
      expect(readdirSync(directory).sort()).toEqual(before);
      expect(readFileSync(`${location}-journal`)).toEqual(journalBefore);
      expect(readFileSync(location)).toEqual(databaseBefore);
    } finally { rmSync(directory, { recursive: true, force: true }); }
  });

  test('an active non-hot writer does not turn a coherent prior row into a recovery refusal', async () => {
    const directory = mkdtempSync(join(tmpdir(), 'microdelta-read-'));
    try {
      const id = 'a'.repeat(32);
      const location = join(directory, 'active.sqlite');
      seed(location, id, 1, sample(id));
      const source = `import Database from 'better-sqlite3';
const db = new Database(process.argv[1]);
db.exec('BEGIN IMMEDIATE');
db.prepare('UPDATE microdelta_execution_observation SET revision = 2 WHERE slot = 1').run();
process.stdout.write('ready');
process.stdin.once('data', () => { db.exec('ROLLBACK'); db.close(); process.exit(0); });`;
      const child = spawn(process.execPath, ['--input-type=module', '-e', source, location], { cwd: process.cwd(), stdio: ['pipe', 'pipe', 'pipe'] });
      try {
        await new Promise<void>((resolve, reject) => {
          child.stdout?.once('data', () => resolve());
          child.once('error', reject);
          child.once('exit', () => reject(new Error('writer exited before the read barrier')));
        });
        const namesBefore = readdirSync(directory).sort();
        expect(namesBefore).toContain('active.sqlite-journal');
        const databaseBefore = readFileSync(location);
        const journalBefore = readFileSync(`${location}-journal`);
        const reader = openExecutionObservationReader(createNodeSqliteReader(), { location, executionId: id });
        expect(reader.read()).toMatchObject({ version: 1, result: { kind: 'observed', observation: { revision: 1, phase: 'prepared' } } });
        reader.close();
        expect(readdirSync(directory).sort()).toEqual(namesBefore);
        expect(readFileSync(location)).toEqual(databaseBefore);
        expect(readFileSync(`${location}-journal`)).toEqual(journalBefore);
      } finally {
        child.stdin?.write('release');
        await new Promise<void>((resolve) => { if (child.exitCode !== null) { resolve(); } else { child.once('exit', () => resolve()); } });
      }
    } finally { rmSync(directory, { recursive: true, force: true }); }
  });
});
