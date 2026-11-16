/** Read-only host inspection must never create or initialize the inspected database. */
import { spawnSync } from 'node:child_process';
import { expect, test } from '@jest/globals';
import { mkdtempSync, readdirSync, rmSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { SqliteBusyError } from '@microdelta/machine';

import { createNodeSqlite, createNodeSqliteReader } from '../src/index.js';

test('read-only open refuses missing files and exposes no write port', () => {
  const directory = mkdtempSync(join(tmpdir(), 'microdelta-reader-'));
  const location = join(directory, 'store.sqlite');
  try {
    expect(() => createNodeSqliteReader().openSqliteReader(location)).toThrow();
    expect(readdirSync(directory)).toEqual([]);
    const writer = createNodeSqlite().openSqlite(location, { journalMode: 'delete' });
    writer.exec('CREATE TABLE evidence (value INTEGER); INSERT INTO evidence VALUES (93)');
    writer.close();
    const before = readFileSync(location);
    const reader = createNodeSqliteReader().openSqliteReader(location);
    expect(reader.prepare('SELECT value FROM evidence').all()).toEqual([{ value: 93 }]);
    expect(reader).not.toHaveProperty('exec');
    expect(reader).not.toHaveProperty('transaction');
    expect(reader.prepare('SELECT value FROM evidence')).not.toHaveProperty('run');
    expect(() => reader.prepare('DELETE FROM evidence')).toThrow();
    reader.close();
    expect(readFileSync(location)).toEqual(before);
    expect(readdirSync(directory)).toEqual(['store.sqlite']);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test('exclusive creation publishes a new rollback-journal file and refuses an existing foreign file', () => {
  const directory = mkdtempSync(join(tmpdir(), 'microdelta-exclusive-sqlite-'));
  const location = join(directory, 'store.sqlite');
  try {
    const writer = createNodeSqlite().openSqlite(location, { journalMode: 'delete', creation: 'exclusive' });
    writer.exec('CREATE TABLE evidence (value INTEGER); INSERT INTO evidence VALUES (93)');
    writer.close();
    const before = readFileSync(location);
    expect(() => createNodeSqlite().openSqlite(location, { journalMode: 'delete', creation: 'exclusive' })).toThrow();
    expect(readFileSync(location)).toEqual(before);
    expect(readdirSync(directory)).toEqual(['store.sqlite']);
    const reader = createNodeSqliteReader().openSqliteReader(location);
    expect(reader.prepare('SELECT value FROM evidence').get()).toEqual({ value: 93 });
    reader.close();
  } finally { rmSync(directory, { recursive: true, force: true }); }
});

test('exclusive creation refuses a live foreign WAL file without touching its sidecars', () => {
  const directory = mkdtempSync(join(tmpdir(), 'microdelta-exclusive-wal-'));
  const location = join(directory, 'store.sqlite');
  const writer = createNodeSqlite().openSqlite(location);
  writer.exec('CREATE TABLE evidence (value INTEGER); INSERT INTO evidence VALUES (93)');
  const before = readdirSync(directory).map((name) => [name, readFileSync(join(directory, name))]);
  try {
    expect(() => createNodeSqlite().openSqlite(location, { journalMode: 'delete', creation: 'exclusive' })).toThrow();
    expect(readdirSync(directory).map((name) => [name, readFileSync(join(directory, name))])).toEqual(before);
    expect(writer.prepare('SELECT value FROM evidence').get()).toEqual({ value: 93 });
  } finally { writer.close(); rmSync(directory, { recursive: true, force: true }); }
});

test('exclusive creation refuses a foreign hot rollback journal before SQLite can recover it', () => {
  const directory = mkdtempSync(join(tmpdir(), 'microdelta-exclusive-hot-'));
  const location = join(directory, 'foreign.sqlite');
  try {
    // A killed foreign writer leaves a genuine hot spill journal; merely opening it for writing can recover and delete it.
    const source = `import Database from 'better-sqlite3';
const db = new Database(process.argv[1]);
db.pragma('journal_mode=DELETE');
db.exec('CREATE TABLE other_owner(id INTEGER PRIMARY KEY, payload BLOB NOT NULL)');
const insert = db.prepare('INSERT INTO other_owner VALUES (?, ?)');
db.transaction(() => { for (let i = 0; i < 1000; i += 1) insert.run(i, Buffer.alloc(4096, 0x41)); })();
db.pragma('cache_size=10');
db.pragma('cache_spill=ON');
db.exec('BEGIN IMMEDIATE');
db.prepare('UPDATE other_owner SET payload=randomblob(4096)').run();
process.kill(process.pid, 'SIGKILL');`;
    const child = spawnSync(process.execPath, ['--input-type=module', '-e', source, location], { encoding: 'utf8', timeout: 10_000 });
    expect(child.signal).toBe('SIGKILL');
    const names = readdirSync(directory).sort();
    expect(names).toEqual(['foreign.sqlite', 'foreign.sqlite-journal']);
    const before = names.map((name) => readFileSync(join(directory, name)));
    expect(before[1]?.subarray(0, 8).toString('hex')).toBe('d9d505f920a163d7');
    expect(() => createNodeSqlite().openSqlite(location, { journalMode: 'delete', creation: 'exclusive' })).toThrow();
    expect(readdirSync(directory).sort()).toEqual(names);
    expect(names.map((name) => readFileSync(join(directory, name)))).toEqual(before);
  } finally { rmSync(directory, { recursive: true, force: true }); }
});


test('read-only access sees committed evidence beside an active rollback-journal writer without filesystem writes', () => {
  const directory = mkdtempSync(join(tmpdir(), 'microdelta-reader-active-'));
  const location = join(directory, 'store.sqlite');
  const writer = createNodeSqlite().openSqlite(location, { journalMode: 'delete' });
  writer.exec('CREATE TABLE evidence (value INTEGER); INSERT INTO evidence VALUES (93)');
  expect(writer.prepare('PRAGMA journal_mode').get()).toEqual({ journal_mode: 'delete' });
  expect(writer.prepare('PRAGMA synchronous').get()).toEqual({ synchronous: 2 });
  expect(writer.prepare('PRAGMA foreign_keys').get()).toEqual({ foreign_keys: 1 });
  const before = readFileSync(location);
  const reader = createNodeSqliteReader().openSqliteReader(location);
  try {
    expect(reader.prepare('SELECT value FROM evidence').all()).toEqual([{ value: 93 }]);
    expect(readdirSync(directory)).toEqual(['store.sqlite']);
    expect(readFileSync(location)).toEqual(before);
    writer.transaction(() => {
      writer.prepare('INSERT INTO evidence VALUES (?)').run(90);
      expect(reader.prepare('SELECT value FROM evidence').all()).toEqual([{ value: 93 }]);
    });
    expect(reader.prepare('SELECT value FROM evidence').all()).toEqual([{ value: 93 }, { value: 90 }]);
    expect(readdirSync(directory)).toEqual(['store.sqlite']);
  } finally { reader.close(); writer.close(); rmSync(directory, { recursive: true, force: true }); }
});

test('read-only and rollback-journal opens refuse existing WAL files without creating sidecars or changing the journal', () => {
  const directory = mkdtempSync(join(tmpdir(), 'microdelta-reader-wal-'));
  const location = join(directory, 'store.sqlite');
  const writer = createNodeSqlite().openSqlite(location);
  writer.exec('CREATE TABLE evidence (value INTEGER)');
  writer.close();
  const before = readFileSync(location);
  try {
    expect(() => createNodeSqliteReader().openSqliteReader(location)).toThrow(/WAL/u);
    expect(() => createNodeSqlite().openSqlite(location, { journalMode: 'delete' })).toThrow(/WAL/u);
    expect(readFileSync(location)).toEqual(before);
    expect(readdirSync(directory)).toEqual(['store.sqlite']);
  } finally { rmSync(directory, { recursive: true, force: true }); }
});


test('refused opens preserve uncheckpointed acknowledged WAL evidence and sidecars byte-for-byte', () => {
  const directory = mkdtempSync(join(tmpdir(), 'microdelta-reader-live-wal-'));
  const location = join(directory, 'store.sqlite');
  const writer = createNodeSqlite().openSqlite(location);
  writer.exec('CREATE TABLE evidence (value INTEGER); INSERT INTO evidence VALUES (93)');
  const before = readdirSync(directory).map((name) => [name, readFileSync(join(directory, name))]);
  try {
    expect(before).toHaveLength(3);
    expect(() => createNodeSqliteReader().openSqliteReader(location)).toThrow(/WAL/u);
    expect(() => createNodeSqlite().openSqlite(location, { journalMode: 'delete' })).toThrow(/WAL/u);
    expect(readdirSync(directory).map((name) => [name, readFileSync(join(directory, name))])).toEqual(before);
    expect(writer.prepare('SELECT value FROM evidence').all()).toEqual([{ value: 93 }]);
  } finally { writer.close(); rmSync(directory, { recursive: true, force: true }); }
});

test('rollback-journal reader surfaces bounded typed contention rather than missing evidence', () => {
  const directory = mkdtempSync(join(tmpdir(), 'microdelta-reader-busy-'));
  const location = join(directory, 'store.sqlite');
  const writer = createNodeSqlite().openSqlite(location, { journalMode: 'delete' });
  writer.exec('CREATE TABLE evidence (value INTEGER); INSERT INTO evidence VALUES (93)');
  const reader = createNodeSqliteReader().openSqliteReader(location);
  try {
    writer.exec('BEGIN EXCLUSIVE');
    expect(() => reader.prepare('SELECT value FROM evidence').all()).toThrow(SqliteBusyError);
    writer.exec('ROLLBACK');
    expect(reader.prepare('SELECT value FROM evidence').all()).toEqual([{ value: 93 }]);
    expect(readdirSync(directory)).toEqual(['store.sqlite']);
  } finally { reader.close(); writer.close(); rmSync(directory, { recursive: true, force: true }); }
});
