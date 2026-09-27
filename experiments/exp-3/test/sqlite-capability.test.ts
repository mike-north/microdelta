/**
 * The candidate counts as durable evidence only after its fixture-local SQLite
 * capability proves transaction rollback, reopen, and foreign-key behavior.
 */
import { afterEach, describe, expect, test } from '@jest/globals';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openNodeSqlite } from '../harness/node-sqlite.js';
import type { ISqliteCapability } from '../src/sqlite.js';

/** File-backed probes own private directories until cleanup removes their database sidecars. */
const directories: string[] = [];
/** Native handles stay tracked so failed assertions cannot leave SQLite files open. */
const databases: Array<{ close(): void }> = [];

/** Conformance cleanup closes all handles before deleting database roots. */
afterEach(() => {
  for (const database of databases.splice(0)) {
    database.close();
  }
  for (const directory of directories.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
  }
});

/** Creates one isolated durable file for tests that must survive a fresh open. */
function createPath(): string {
  const directory = mkdtempSync(join(tmpdir(), 'microdelta-sqlite-conformance-'));
  directories.push(directory);
  return join(directory, 'conformance.sqlite');
}

/** Tracks the Node driver handle while exposing only the portable capability surface. */
function open(path: string): ISqliteCapability & { close(): void } {
  const database = openNodeSqlite(path);
  databases.push(database);
  return database;
}

describe('fixture-local SQLite capability conformance', () => {
  test('committed writes survive a close and a fresh open', () => {
    const path = createPath();
    const first = open(path);
    first.exec('CREATE TABLE durable (key TEXT PRIMARY KEY, value TEXT NOT NULL)');
    first.prepare('INSERT INTO durable (key, value) VALUES (?, ?)').run('one', 'persisted');
    first.close();
    databases.pop();

    const second = open(path);
    expect(second.prepare('SELECT value FROM durable WHERE key = ?').get('one')).toEqual({
      value: 'persisted',
    });
  });

  test('transactions roll back all writes when the operation throws', () => {
    const database = open(':memory:');
    database.exec('CREATE TABLE values_table (value TEXT PRIMARY KEY)');
    expect(() => database.transaction(() => {
      database.prepare('INSERT INTO values_table (value) VALUES (?)').run('written');
      throw new Error('rollback marker');
    })).toThrow('rollback marker');
    expect(database.prepare('SELECT value FROM values_table').all()).toEqual([]);
  });

  test('foreign keys are enabled and reject dangling references', () => {
    const database = open(':memory:');
    database.exec('CREATE TABLE parent (id INTEGER PRIMARY KEY); CREATE TABLE child (parent_id INTEGER REFERENCES parent(id))');
    expect(() => database.prepare('INSERT INTO child (parent_id) VALUES (?)').run(99)).toThrow();
  });

  test('file-backed databases use WAL, full synchronous commits, and a bounded busy wait', () => {
    const database = open(createPath());
    expect(database.prepare('PRAGMA journal_mode').get()).toEqual({ journal_mode: 'wal' });
    expect(database.prepare('PRAGMA synchronous').get()).toEqual({ synchronous: 2 });
    expect(database.prepare('PRAGMA foreign_keys').get()).toEqual({ foreign_keys: 1 });
    expect(database.prepare('PRAGMA busy_timeout').get()).toEqual({ timeout: 500 });
  });

  test('a path that is not a database file fails rather than creating fallback state', () => {
    const directory = mkdtempSync(join(tmpdir(), 'microdelta-sqlite-invalid-'));
    directories.push(directory);
    expect(() => openNodeSqlite(directory)).toThrow();
  });
});
