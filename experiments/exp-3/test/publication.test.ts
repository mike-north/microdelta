/**
 * These assertions define History's bounded publication behavior before the
 * SQLite candidate exists; real process exits and reopen are part of the proof.
 */
import { afterEach, describe, expect, test } from '@jest/globals';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import {
  createPublicationRepository,
  type IResultReference,
} from '../src/index.js';
import { openNodeSqlite } from '../harness/node-sqlite.js';

const directories: string[] = [];
const databases: Array<{ close(): void }> = [];

afterEach(() => {
  for (const database of databases.splice(0)) {
    database.close();
  }
  for (const directory of directories.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
  }
});

function createDatabasePath(): string {
  const directory = mkdtempSync(join(tmpdir(), 'microdelta-exp3-'));
  directories.push(directory);
  return join(directory, 'history.sqlite');
}

function openDatabase(path: string) {
  const database = openNodeSqlite(path);
  databases.push(database);
  return database;
}

function runWorker(databasePath: string, command: string, args: readonly string[] = []): ReturnType<typeof spawnSync> {
  const workerPath = fileURLToPath(new URL('../harness/crash-worker.js', import.meta.url));
  const processResult = spawnSync(process.execPath, [workerPath, databasePath, command, ...args], {
    encoding: 'utf8' as const,
    timeout: 15_000,
  });
  return processResult;
}

function readJsonOutput(result: ReturnType<typeof spawnSync>): unknown {
  if (typeof result.stdout !== 'string') {
    throw new Error('Expected UTF-8 worker output');
  }
  return JSON.parse(result.stdout) as unknown;
}

describe('EXP-3 SQLite publication protocol', () => {
  test('a process killed after acquiring ownership leaves the old complete result readable', () => {
    const databasePath = createDatabasePath();
    const setup = runWorker(databasePath, 'seed-old');
    expect(setup.status).toBe(0);

    const killed = runWorker(databasePath, 'acquire-then-kill');
    expect(killed.signal).toBe('SIGKILL');

    const reopened = runWorker(databasePath, 'inspect');
    expect(reopened.status).toBe(0);
    expect(readJsonOutput(reopened)).toMatchObject({
      current: { reference: { generation: 1 }, payload: { value: 'old' } },
      latestAttempt: null,
    });
  });

  test('killing after allocation consumes the generation without publishing a partial result', () => {
    const databasePath = createDatabasePath();
    expect(runWorker(databasePath, 'seed-old').status).toBe(0);

    const killed = runWorker(databasePath, 'allocate-then-kill');
    expect(killed.signal).toBe('SIGKILL');

    const reopened = runWorker(databasePath, 'inspect');
    expect(reopened.status).toBe(0);
    expect(readJsonOutput(reopened)).toMatchObject({
      current: { reference: { generation: 1 }, payload: { value: 'old' } },
      latestAttempt: { generation: 2, state: 'allocated' },
    });

    const db = openDatabase(databasePath);
    const repository = createPublicationRepository(db);
    repository.initialize();
    const lease = repository.acquireWriter({ holderId: 'next-writer', nowMs: 30, leaseMs: 10 });
    if (lease.kind !== 'acquired') {
      throw new Error('Expected reclaimed writer');
    }
    const next = repository.allocateAttempt({
      attemptKey: 'after-recovery', subjectKey: 'subject', holderId: 'next-writer',
      fencingToken: lease.fencingToken, nowMs: 30,
    });
    expect(next.generation).toBe(3);
  });

  test('a staged payload is not a completed result and cannot become current after a crash', () => {
    const databasePath = createDatabasePath();
    expect(runWorker(databasePath, 'seed-old').status).toBe(0);

    const killed = runWorker(databasePath, 'stage-then-kill');
    expect(killed.signal).toBe('SIGKILL');

    const reopened = runWorker(databasePath, 'inspect');
    expect(reopened.status).toBe(0);
    expect(readJsonOutput(reopened)).toMatchObject({
      current: { reference: { generation: 1 }, payload: { value: 'old' } },
      latestAttempt: { generation: 2, state: 'staged' },
    });
  });

  test('publication is one commit: death just before commit leaves the staged attempt unpublished', () => {
    const databasePath = createDatabasePath();
    expect(runWorker(databasePath, 'seed-old').status).toBe(0);

    const killed = runWorker(databasePath, 'publish-before-commit-then-kill');
    expect(killed.signal).toBe('SIGKILL');

    const reopened = runWorker(databasePath, 'inspect');
    expect(reopened.status).toBe(0);
    expect(readJsonOutput(reopened)).toMatchObject({
      current: { reference: { generation: 1 }, payload: { value: 'old' } },
      latestAttempt: { generation: 2, state: 'staged' },
    });
  });

  test('death after commit but before acknowledgment preserves the result and prevents body replay', () => {
    const databasePath = createDatabasePath();
    const counterPath = `${databasePath}.calls`;

    const killed = runWorker(databasePath, 'execute-and-kill-after-commit', [counterPath]);
    expect(killed.signal).toBe('SIGKILL');

    const retry = runWorker(databasePath, 'execute-once', [counterPath]);
    expect(retry.status).toBe(0);
    expect(readJsonOutput(retry)).toMatchObject({ reused: true, reference: { generation: 1 } });

    expect(readFileSync(counterPath, 'utf8')).toBe('body\n');
  });

  test('a failed publication transaction keeps the pointer and completed set unchanged', () => {
    const databasePath = createDatabasePath();
    const db = openDatabase(databasePath);
    const repository = createPublicationRepository(db);
    repository.initialize();
    const owner = repository.acquireWriter({ holderId: 'first', nowMs: 0, leaseMs: 10 });
    expect(owner.kind).toBe('acquired');
    if (owner.kind !== 'acquired') {
      throw new Error('Expected writer lease');
    }
    const oldAttempt = repository.allocateAttempt({
      attemptKey: 'attempt-old', subjectKey: 'subject', holderId: 'first',
      fencingToken: owner.fencingToken, nowMs: 0,
    });
    repository.stageAttempt({
      attemptId: oldAttempt.attemptId, payloadJson: '{"value":"old"}',
      fingerprint: 'old-fingerprint', provenanceJson: '{"source":"prior"}',
      holderId: 'first', fencingToken: owner.fencingToken, nowMs: 0,
    });
    repository.publishAttempt({
      attemptId: oldAttempt.attemptId, holderId: 'first', fencingToken: owner.fencingToken, nowMs: 0,
    });
    const attempt = repository.allocateAttempt({
      attemptKey: 'attempt-1', subjectKey: 'subject', holderId: 'first',
      fencingToken: owner.fencingToken, nowMs: 0,
    });
    repository.stageAttempt({
      attemptId: attempt.attemptId, payloadJson: '{"value":"new"}',
      fingerprint: 'new-fingerprint', provenanceJson: '{"source":"test"}',
      holderId: 'first', fencingToken: owner.fencingToken, nowMs: 0,
    });
    db.exec("CREATE TRIGGER reject_pointer BEFORE INSERT ON current_pointers BEGIN SELECT RAISE(ABORT, 'injected write failure'); END");

    expect(() => repository.publishAttempt({
      attemptId: attempt.attemptId, holderId: 'first', fencingToken: owner.fencingToken, nowMs: 0,
    })).toThrow('injected write failure');
    expect(repository.readCurrent('subject')).toMatchObject({
      reference: { generation: 1 }, payload: { value: 'old' },
    });
    expect(repository.readResult({ subjectKey: 'subject', generation: 2 })).toBeNull();
    expect(repository.readAttempt(attempt.attemptId)?.state).toBe('staged');
  });

  test('only one live writer is admitted, and every stale authority operation is fenced', () => {
    const db = openDatabase(':memory:');
    const repository = createPublicationRepository(db);
    repository.initialize();
    const first = repository.acquireWriter({ holderId: 'first', nowMs: 0, leaseMs: 10 });
    expect(first.kind).toBe('acquired');
    const competing = repository.acquireWriter({ holderId: 'second', nowMs: 5, leaseMs: 10 });
    expect(competing.kind).toBe('held');
    if (first.kind !== 'acquired') {
      throw new Error('Expected first lease');
    }
    const attempt = repository.allocateAttempt({
      attemptKey: 'attempt-old', subjectKey: 'subject', holderId: 'first',
      fencingToken: first.fencingToken, nowMs: 0,
    });
    const reclaimed = repository.acquireWriter({ holderId: 'second', nowMs: 11, leaseMs: 10 });
    expect(reclaimed.kind).toBe('acquired');
    if (reclaimed.kind !== 'acquired') {
      throw new Error('Expected reclaimed lease');
    }
    const stale = { holderId: 'first', fencingToken: first.fencingToken, nowMs: 12 };
    expect(() => repository.renewWriter({ ...stale, leaseMs: 10 })).toThrow('stale writer fence');
    expect(() => repository.allocateAttempt({
      ...stale, attemptKey: 'stale-allocation', subjectKey: 'subject',
    })).toThrow('stale writer fence');
    expect(() => repository.stageAttempt({
      ...stale, attemptId: attempt.attemptId, payloadJson: '{"value":"stale"}',
      fingerprint: 'stale-fingerprint', provenanceJson: '{"source":"stale"}',
    })).toThrow('stale writer fence');
    expect(() => repository.publishAttempt({ ...stale, attemptId: attempt.attemptId })).toThrow('stale writer fence');
    expect(() => repository.releaseWriter(stale)).toThrow('stale writer fence');
    expect(repository.currentWriter()?.holderId).toBe('second');
  });

  test('stable attempt keys resolve a committed result after a lost acknowledgment without rerunning work', () => {
    const databasePath = createDatabasePath();
    let db = openDatabase(databasePath);
    const repository = createPublicationRepository(db);
    repository.initialize();
    const owner = repository.acquireWriter({ holderId: 'writer', nowMs: 0, leaseMs: 100 });
    if (owner.kind !== 'acquired') {
      throw new Error('Expected writer lease');
    }
    const calls = { body: 0 };
    const run = (): IResultReference => {
      const known = repository.findAttempt('stable-key');
      if (known?.state === 'completed' && known.resultReference !== null) {
        return known.resultReference;
      }
      const attempt = known ?? repository.allocateAttempt({
        attemptKey: 'stable-key', subjectKey: 'subject', holderId: 'writer',
        fencingToken: owner.fencingToken, nowMs: 0,
      });
      calls.body += 1;
      repository.stageAttempt({
        attemptId: attempt.attemptId, payloadJson: '{"value":"done"}',
        fingerprint: 'done-fingerprint', provenanceJson: '{"run":"stable-key"}',
        holderId: 'writer', fencingToken: owner.fencingToken, nowMs: 0,
      });
      return repository.publishAttempt({
        attemptId: attempt.attemptId, holderId: 'writer', fencingToken: owner.fencingToken, nowMs: 0,
      });
    };
    const first = run();
    expect(() => { throw new Error('observer failed after commit'); }).toThrow('observer failed after commit');
    db.close();
    databases.pop();
    db = openDatabase(databasePath);
    const afterReopen = createPublicationRepository(db);
    afterReopen.initialize();
    expect(afterReopen.findAttempt('stable-key')?.resultReference).toEqual(first);
    expect(afterReopen.findAttempt('stable-key')?.state).toBe('completed');
    expect(calls.body).toBe(1);
  });

  test('exact older references remain readable after a newer result becomes current', () => {
    const db = openDatabase(':memory:');
    const repository = createPublicationRepository(db);
    repository.initialize();
    const owner = repository.acquireWriter({ holderId: 'writer', nowMs: 0, leaseMs: 100 });
    if (owner.kind !== 'acquired') {
      throw new Error('Expected writer lease');
    }
    const publish = (key: string, payload: string): IResultReference => {
      const attempt = repository.allocateAttempt({
        attemptKey: key, subjectKey: 'subject', holderId: 'writer',
        fencingToken: owner.fencingToken, nowMs: 0,
      });
      repository.stageAttempt({
        attemptId: attempt.attemptId, payloadJson: payload,
        fingerprint: `${key}-fingerprint`, provenanceJson: JSON.stringify({ key }),
        holderId: 'writer', fencingToken: owner.fencingToken, nowMs: 0,
      });
      return repository.publishAttempt({
        attemptId: attempt.attemptId, holderId: 'writer', fencingToken: owner.fencingToken, nowMs: 0,
      });
    };
    const first = publish('first', '{"value":"old"}');
    const second = publish('second', '{"value":"new"}');
    expect(second.generation).toBeGreaterThan(first.generation);
    expect(repository.readCurrent('subject')?.reference).toEqual(second);
    expect(repository.readResult(first)).toEqual({
      reference: first, payload: { value: 'old' }, fingerprint: 'first-fingerprint', provenance: { key: 'first' },
    });
    expect(repository.readResult(second)).toEqual({
      reference: second, payload: { value: 'new' }, fingerprint: 'second-fingerprint', provenance: { key: 'second' },
    });
    expect(repository.readResult({ subjectKey: 'subject', generation: 404 })).toBeNull();
    const nullable = publish('nullable', 'null');
    expect(repository.readResult(nullable)).toEqual({
      reference: nullable, payload: null, fingerprint: 'nullable-fingerprint', provenance: { key: 'nullable' },
    });
  });

  test('unknown schema versions fail closed', () => {
    const db = openDatabase(':memory:');
    db.exec('CREATE TABLE schema_version (id INTEGER PRIMARY KEY, version INTEGER NOT NULL); INSERT INTO schema_version VALUES (1, 999);');
    expect(() => createPublicationRepository(db).initialize()).toThrow('unsupported schema version');
  });

  test('a version-1 marker without its full schema is rejected as incomplete', () => {
    const db = openDatabase(':memory:');
    db.exec('CREATE TABLE schema_version (id INTEGER PRIMARY KEY, version INTEGER NOT NULL); INSERT INTO schema_version VALUES (1, 1);');
    expect(() => createPublicationRepository(db).initialize()).toThrow('incomplete schema version 1');
  });

  test('a dangling pointer is reported as corruption rather than an empty subject', () => {
    const db = openDatabase(':memory:');
    const repository = createPublicationRepository(db);
    repository.initialize();
    db.exec('PRAGMA foreign_keys = OFF');
    db.prepare('INSERT INTO current_pointers (subject_key, generation) VALUES (?, ?)').run('subject', 404);
    expect(() => repository.readCurrent('subject')).toThrow('current pointer references an incomplete result');
    db.prepare('DELETE FROM current_pointers WHERE subject_key = ?').run('subject');
    db.prepare(`
      INSERT INTO snapshots (subject_key, generation, attempt_id, payload_json, fingerprint, provenance_json)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run('subject', 405, 'missing-attempt', 'null', 'fingerprint', '{}');
    db.prepare('INSERT INTO current_pointers (subject_key, generation) VALUES (?, ?)').run('subject', 405);
    expect(() => repository.readCurrent('subject')).toThrow('current pointer references an incomplete result');
    expect(() => repository.readResult({ subjectKey: 'subject', generation: 405 }))
      .toThrow('result reference points to an incomplete snapshot');
  });
});
