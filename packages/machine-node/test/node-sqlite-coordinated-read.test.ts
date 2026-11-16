/** Coordinated inspection holds one finite snapshot while a WAL writer continues. */
import { expect, test } from '@jest/globals';
import { mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { SqliteBusyError, SqliteReadError } from '@microdelta/machine';
import { createNodeSqlite, createNodeSqliteCoordinatedReader, createNodeSqliteReader } from '../src/index.js';

test('first actual read anchors the snapshot and release ends read authority', () => {
  const directory = mkdtempSync(join(tmpdir(), 'coordinated-read-'));
  const location = join(directory, 'store.sqlite');
  const writer = createNodeSqlite().openSqlite(location);
  writer.exec('CREATE TABLE evidence (value INTEGER); INSERT INTO evidence VALUES (1)');
  const beforeMain = readFileSync(location);
  const beforeWal = readFileSync(`${location}-wal`);
  const scope = createNodeSqliteCoordinatedReader().openSqliteCoordinatedRead(location);
  try {
    expect(readFileSync(location)).toEqual(beforeMain);
    expect(readFileSync(`${location}-wal`)).toEqual(beforeWal);
    expect(() => scope.prepare('SELECT value FROM evidence')).toThrow();
    scope.begin();
    expect(() => scope.begin()).toThrow();
    writer.exec('INSERT INTO evidence VALUES (2)');
    const statement = scope.prepare('SELECT value FROM evidence ORDER BY value');
    expect(statement.all()).toEqual([{ value: 1 }, { value: 2 }]);
    writer.exec('INSERT INTO evidence VALUES (3)');
    expect(statement.all()).toEqual([{ value: 1 }, { value: 2 }]);
    expect(() => scope.prepare('DELETE FROM evidence RETURNING value')).toThrow();
    expect(() => scope.prepare('BEGIN')).toThrow();
    scope.end();
    expect(() => statement.all()).toThrow();
    expect(() => scope.prepare('SELECT 1')).toThrow();
    expect(() => scope.begin()).toThrow();
    scope.end();
    scope.close();
    scope.close();
    expect(writer.prepare('SELECT value FROM evidence ORDER BY value').all()).toEqual([{ value: 1 }, { value: 2 }, { value: 3 }]);
  } finally { scope.close(); writer.close(); rmSync(directory, { recursive: true, force: true }); }
});

test('missing and empty inputs retain their physical state and legacy reader refuses WAL', () => {
  const directory = mkdtempSync(join(tmpdir(), 'coordinated-input-'));
  const location = join(directory, 'store.sqlite');
  try {
    expect(() => createNodeSqliteCoordinatedReader().openSqliteCoordinatedRead(location)).toThrow(SqliteReadError);
    expect(readdirSync(directory)).toEqual([]);
    writeFileSync(location, '');
    const scope = createNodeSqliteCoordinatedReader().openSqliteCoordinatedRead(location);
    scope.begin(); scope.end(); scope.close();
    expect(readFileSync(location)).toEqual(Buffer.alloc(0));
    expect(readdirSync(directory)).toEqual(['store.sqlite']);
    const writer = createNodeSqlite().openSqlite(location);
    try { expect(() => createNodeSqliteReader().openSqliteReader(location)).toThrow(SqliteReadError); }
    finally { writer.close(); }
  } finally { rmSync(directory, { recursive: true, force: true }); }
});

test('rollback exclusive lock produces bounded typed busy failure', () => {
  const directory = mkdtempSync(join(tmpdir(), 'coordinated-busy-'));
  const location = join(directory, 'store.sqlite');
  const writer = createNodeSqlite().openSqlite(location, { journalMode: 'delete' });
  writer.exec('CREATE TABLE evidence (value INTEGER)');
  const scope = createNodeSqliteCoordinatedReader().openSqliteCoordinatedRead(location);
  try {
    scope.begin(); writer.exec('BEGIN EXCLUSIVE');
    expect(() => scope.prepare('SELECT value FROM evidence').all()).toThrow(SqliteBusyError);
    writer.exec('ROLLBACK');
  } finally { scope.end(); scope.close(); writer.close(); rmSync(directory, { recursive: true, force: true }); }
});


test('admitted queries and literal values work through the real coordinated capability', () => {
  const directory = mkdtempSync(join(tmpdir(), 'coordinated-sql-'));
  const location = join(directory, 'store.sqlite');
  const writer = createNodeSqlite().openSqlite(location);
  writer.exec('CREATE TABLE evidence (value INTEGER); INSERT INTO evidence VALUES (1)');
  const scope = createNodeSqliteCoordinatedReader().openSqliteCoordinatedRead(location);
  try {
    scope.begin();
    expect(scope.prepare('/* read */ SELECT count(*) AS n FROM evidence').get()).toEqual({ n: 1 });
    expect(scope.prepare('WITH RECURSIVE chain(n) AS (SELECT 1 UNION SELECT n + 1 FROM chain WHERE n < 2) SELECT n FROM chain').all()).toEqual([{ n: 1 }, { n: 2 }]);
    expect(scope.prepare('SELECT value FROM json_each(?)').all('[1,2]')).toEqual([{ value: 1 }, { value: 2 }]);
    expect(scope.prepare("SELECT 'pragma_busy_timeout' AS literal, 'can''t' AS quoted FROM evidence").get()).toEqual({ literal: 'pragma_busy_timeout', quoted: "can't" });
    expect(scope.prepare('SELECT value FROM evidence WHERE value = ?').all(1)).toEqual([{ value: 1 }]);
    expect(scope.prepare("SELECT value FROM json_each(?) WHERE value = 'pragma_table_info'").all('["pragma_table_info"]')).toEqual([{ value: 'pragma_table_info' }]);
    expect(scope.prepare('WITH RECURSIVE chain(n) AS (SELECT 1 UNION SELECT n + 1 FROM chain WHERE n < 2) SELECT count(*) AS n FROM chain').get()).toEqual({ n: 2 });
  } finally { scope.end(); scope.close(); writer.close(); rmSync(directory, { recursive: true, force: true }); }
});
