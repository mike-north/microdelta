/** One finite test-only host worker: normal Machine writer, readonly candidate, or explicitly tagged negative control. */
import { readFileSync } from 'node:fs';
import { createInterface } from 'node:readline';

import Database from 'better-sqlite3';
import { createNodeSqlite } from '@microdelta/machine-node';
import type { ISqliteConnection } from '@microdelta/machine';

import { qualificationBounds } from '../src/protocol.js';
import type { ICorrelatedPair, IObservedFailure, IRuntimePins } from '../src/protocol.js';
import { finishOwned } from './lifetime.js';
import type { IOwnedFinish } from './lifetime.js';
import { command, isRecord } from './transport.js';
import type { IWorkerCommand, IWorkerReply } from './transport.js';

/** The role is fixed before any target is opened; a candidate worker cannot accept writable control actions. */
const role = process.argv[2];
/** Every target belongs to this experiment's disposable coordinator-created source directory. */
const location = process.argv[3];
if ((role !== 'writer' && role !== 'reader' && role !== 'control') || location === undefined) { throw new TypeError('Expected fixed worker role and source pathname'); }
/** The validated immutable pathname remains narrowed inside later command callbacks. */
const sourceLocation = location;
/** This direct native dependency is confined to experiment test tooling; production storage contracts are unchanged. */
const driverEntry = import.meta.resolve('better-sqlite3');
/** Package bytes identify the loaded binding while SQLite itself supplies its compiled runtime facts. */
const driverPackage: unknown = JSON.parse(readFileSync(new URL('../package.json', driverEntry), 'utf8'));
if (!isRecord(driverPackage) || typeof driverPackage.version !== 'string') { throw new TypeError('Driver package version unavailable'); }
/** Capture the checked scalar instead of carrying an unknown package object into callbacks. */
const driverVersion = driverPackage.version;
/** The writer owns schema/commits; the candidate gets only a readonly driver handle and fixed data reads. */
let writer: ISqliteConnection | undefined;
let reader: Database.Database | undefined;
let active = false;
let closed = false;
/** Cached closure facts make repeated close idempotent without discarding an earlier release failure. */
let closure: IOwnedFinish | undefined;

/** Serialize finite error facts while retaining the original object during required cleanup. */
function errorFacts(error: unknown, stage: string): IObservedFailure {
  const record = isRecord(error) ? error : undefined;
  const inner = record !== undefined && isRecord(record.cause) ? record.cause : undefined;
  const code = typeof record?.code === 'string' ? record.code : typeof inner?.code === 'string' ? inner.code : null;
  return { origin: 'candidate', stage, code, message: (typeof record?.message === 'string' ? record.message : String(error)).slice(0, 1024) };
}
/** Query rows are unknown at the native boundary, even though the experiment schema is fixed. */
function numberAt(value: unknown, name: string): number {
  if (!isRecord(value) || typeof value[name] !== 'number' || !Number.isSafeInteger(value[name])) { throw new TypeError(`Missing finite ${name}`); }
  return value[name];
}
/** Native runtime identity comes from this opened connection, not a vendored header or guessed default. */
function pins(version: unknown, options: readonly unknown[]): IRuntimePins {
  if (!isRecord(version) || typeof version.version !== 'string' || typeof version.source_id !== 'string') { throw new TypeError('SQLite runtime identity unavailable'); }
  return { node: process.version, driver: driverVersion, sqlite: version.version, sqliteSourceId: version.source_id, driverEntry,
    compileOptions: options.map(row => { if (!isRecord(row) || typeof row.compile_options !== 'string') { throw new TypeError('SQLite compile options unavailable'); } return row.compile_options; }),
    platform: process.platform, arch: process.arch };
}
/** A closed handle never becomes a new implicit connection or a writable fallback. */
function inspect(): Database.Database {
  if (closed || reader === undefined) { throw new Error('Read handle is closed or unopened'); }
  return reader;
}
/** This actual table SELECT, rather than a constant query, establishes the DEFERRED data snapshot. */
function meta(): number { return numberAt(inspect().prepare('SELECT revision FROM snapshot_meta WHERE singleton=1').get(), 'revision'); }
/** The correlated current row is deliberately separate from the metadata query. */
function current(): { readonly currentRevision: number; readonly value: string } {
  const row: unknown = inspect().prepare('SELECT revision,value FROM snapshot_current WHERE singleton=1').get();
  const currentRevision = numberAt(row, 'revision');
  if (!isRecord(row) || typeof row.value !== 'string') { throw new TypeError('Missing current fixture value'); }
  return { currentRevision, value: row.value };
}
/** No input-supplied SQL or History policy participates in the fixed correlated read. */
function readPair(): ICorrelatedPair { return { revision: meta(), ...current() }; }
/** Ending a read snapshot releases locks without a checkpoint, journal assignment or source cleanup. */
function end(): void {
  if (reader !== undefined && reader.inTransaction) { reader.exec('ROLLBACK'); }
  active = false;
}
/** Every required close is attempted once, with first and later release failures retained independently. */
function close(): IOwnedFinish {
  if (closure !== undefined) { return closure; }
  closed = true;
  closure = finishOwned([end, () => reader?.close(), () => writer?.close()]);
  return closure;
}
/** A failed close cannot become an acknowledged successful stage; the original thrown value remains primary. */
function requireClosed(result: IOwnedFinish): void { if (result.kind === 'failed') { throw result.primary; } }
/** Fixed host actions keep candidate read authority separate from controlled bad-mechanism reservations. */
function execute(request: IWorkerCommand): IWorkerReply {
  const id = request.id;
  if (request.action.startsWith('control-') && role !== 'control') { throw new TypeError('Candidate cannot invoke control authority'); }
  switch (request.action) {
    case 'open': {
      if (writer !== undefined || reader !== undefined || closed) { throw new Error('Worker cannot reopen its handle'); }
      if (role === 'writer') {
        writer = createNodeSqlite().openSqlite(sourceLocation);
        return { id, kind: 'opened', runtime: pins(writer.prepare('SELECT sqlite_version() AS version,sqlite_source_id() AS source_id').get(), writer.prepare('PRAGMA compile_options').all()) };
      }
      reader = new Database(sourceLocation, { readonly: true, fileMustExist: true, timeout: 500 });
      // Keep constructor/data-query stages independent of later runtime-pin instrumentation.
      return { id, kind: 'opened', runtime: null };
    }
    case 'initialize':
      if (role !== 'writer' || writer === undefined) { throw new TypeError('Only fixture writer initializes its schema'); }
      writer.exec('CREATE TABLE snapshot_meta(singleton INTEGER PRIMARY KEY CHECK(singleton=1),revision INTEGER NOT NULL) STRICT; CREATE TABLE snapshot_current(singleton INTEGER PRIMARY KEY CHECK(singleton=1),revision INTEGER NOT NULL,value TEXT NOT NULL) STRICT');
      return { id, kind: 'initialized' };
    case 'commit': {
      if (role !== 'writer' || writer === undefined || request.revision === undefined) { throw new TypeError('Only fixture writer commits finite revisions'); }
      const connection = writer; const revision = request.revision; const value = ['A', 'B', 'C', 'D'][revision - 1];
      if (value === undefined) { throw new TypeError('Unsupported fixture revision'); }
      connection.transaction(() => {
        connection.prepare('INSERT INTO snapshot_meta VALUES(1,?) ON CONFLICT(singleton) DO UPDATE SET revision=excluded.revision').run(revision);
        connection.prepare('INSERT INTO snapshot_current VALUES(1,?,?) ON CONFLICT(singleton) DO UPDATE SET revision=excluded.revision,value=excluded.value').run(revision, value);
      });
      return { id, kind: 'committed', pair: { revision: numberAt(connection.prepare('SELECT revision FROM snapshot_meta').get(), 'revision'),
        currentRevision: numberAt(connection.prepare('SELECT revision FROM snapshot_current').get(), 'revision'), value } };
    }
    case 'checkpoint':
      if (role !== 'writer' || writer === undefined) { throw new TypeError('Only fixture owner checkpoints'); }
      return { id, kind: 'checkpoint', result: writer.prepare('PRAGMA wal_checkpoint(TRUNCATE)').all() };
    case 'begin': if (active) { throw new Error('Read snapshot already active'); } inspect().exec('BEGIN DEFERRED'); active = true; return { id, kind: 'begun' };
    case 'anchor': if (!active) { throw new Error('Read snapshot is not active'); } return { id, kind: 'anchored', pair: readPair() };
    case 'read': inspect(); if (!active) { throw new Error('Read snapshot is not active'); } return { id, kind: 'pair', pair: readPair() };
    case 'runtime': {
      const connection = inspect();
      return { id, kind: 'runtime', runtime: pins(connection.prepare('SELECT sqlite_version() AS version,sqlite_source_id() AS source_id').get(), connection.prepare('PRAGMA compile_options').all()) };
    }
    case 'end': end(); return { id, kind: 'ended' };
    case 'close': requireClosed(close()); return { id, kind: 'closed' };
    case 'exit': requireClosed(close()); return { id, kind: 'exiting' };
    case 'control-meta': if (active) { throw new Error('Mixed-read control must use separate autocommit statements'); } return { id, kind: 'meta', revision: meta() };
    case 'control-current': if (active) { throw new Error('Mixed-read control must use separate autocommit statements'); } return { id, kind: 'current', ...current() };
    case 'control-writable':
      if (active || writer !== undefined) { throw new Error('Control handle is already active'); }
      reader?.close(); reader = undefined; closed = false; writer = createNodeSqlite().openSqlite(sourceLocation);
      return { id, kind: 'opened', runtime: pins(writer.prepare('SELECT sqlite_version() AS version,sqlite_source_id() AS source_id').get(), writer.prepare('PRAGMA compile_options').all()) };
    case 'control-immediate': if (writer === undefined) { throw new Error('Writable control is unopened'); } writer.exec('BEGIN IMMEDIATE'); return { id, kind: 'reserved' };
    case 'control-release': if (writer === undefined) { throw new Error('Writable control is unopened'); } writer.exec('ROLLBACK'); return { id, kind: 'released' };
  }
}

/** A bounded parent owns all deadlines; this worker owns no detached task, retry loop or source-file cleanup. */
const input = createInterface({ input: process.stdin, crlfDelay: Infinity });
try {
  for await (const line of input) {
    if (Buffer.byteLength(line) > qualificationBounds.maximumProtocolLineBytes) { throw new Error('Worker command exceeds line bound'); }
    const decoded: unknown = JSON.parse(line); const request = command(decoded);
    try {
      process.stdout.write(`${JSON.stringify(execute(request))}\n`);
      if (request.action === 'exit') { break; }
    } catch (error: unknown) {
      const cleanup: IObservedFailure[] = [];
      if (role !== 'writer' || request.action === 'close' || request.action === 'exit') {
        const result = close();
        if (result.kind === 'failed') {
          const later = request.action === 'close' || request.action === 'exit' ? result.secondary : [result.primary, ...result.secondary];
          cleanup.push(...later.map(value => errorFacts(value, 'cleanup')));
        }
      }
      const response: IWorkerReply = { id: request.id, kind: 'failed', failure: errorFacts(error, request.action), cleanup };
      process.stdout.write(`${JSON.stringify(response)}\n`);
    }
  }
} finally {
  input.close();
  const result = close();
  if (result.kind === 'failed') {
    process.stderr.write(`${JSON.stringify({ cleanup: [result.primary, ...result.secondary].map(value => errorFacts(value, 'cleanup')) })}\n`);
    process.exitCode = 1;
  }
}
