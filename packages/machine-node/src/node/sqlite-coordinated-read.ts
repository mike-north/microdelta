/**
 * Native, finite SQLite read scopes. This host boundary owns the deferred
 * transaction and portable value transport; callers own SQL and schema meaning.
 * Native WAL coordination is permitted, but initialization, journal changes,
 * checkpointing and application sidecar cleanup are outside this authority.
 * @packageDocumentation
 */
import { closeSync, openSync } from 'node:fs';
import { types } from 'node:util';
import Database from 'better-sqlite3';
import { SqliteReadError } from '@microdelta/machine';
import type { ISqliteCoordinatedReadCapability, ISqliteCoordinatedReadScope, ISqliteReadStatement, ISqliteRow, ISqliteValue } from '@microdelta/machine';
import { _typedBusy } from './sqlite.js';

/** Maximum native lock wait in milliseconds, matching the other SQLite ports. */
const busyTimeoutMilliseconds = 500;

/** Translate only failures whose host codes establish their meaning. */
function readHost<T>(operation: () => T): T {
  try { return _typedBusy(operation); }
  catch (error: unknown) {
    if (typeof error === 'object' && error !== null && 'code' in error) {
      if (error.code === 'ENOENT') { throw new SqliteReadError('absent', 'SQLite file is absent', { cause: error }); }
      if (error.code === 'SQLITE_READONLY_ROLLBACK' || error.code === 'SQLITE_READONLY_RECOVERY') { throw new SqliteReadError('recovery-required', 'SQLite recovery requires writes', { cause: error }); }
      if (error.code === 'SQLITE_NOTADB' || error.code === 'SQLITE_CORRUPT') { throw new SqliteReadError('corrupt', 'SQLite file is corrupt', { cause: error }); }
    }
    throw error;
  }
}

/** Bind a value only when it belongs to the portable SQLite value domain. */
function assertBindable(value: unknown): void {
  if (value === null || typeof value === 'string' || (typeof value === 'number' && Number.isFinite(value)) || types.isUint8Array(value)) { return; }
  throw new TypeError('SQLite bound value is outside the portable value domain');
}

/** Detach one native cell, refusing numbers that cannot be represented exactly. */
function toValue(cell: unknown): ISqliteValue {
  if (cell === null || typeof cell === 'string') { return cell; }
  if (typeof cell === 'number' && Number.isFinite(cell)) { return cell; }
  if (typeof cell === 'bigint' && cell <= BigInt(Number.MAX_SAFE_INTEGER) && cell >= BigInt(Number.MIN_SAFE_INTEGER)) { return Number(cell); }
  if (ArrayBuffer.isView(cell)) { return new Uint8Array(cell.buffer, cell.byteOffset, cell.byteLength).slice(); }
  throw new RangeError('SQLite cell is outside the portable value domain');
}

/** The scope needs only read-statement transport and native classification. */
interface ICoordinatedStatement {
  readonly reader: boolean;
  readonly readonly: boolean;
  safeIntegers(toggle: boolean): ICoordinatedStatement;
  raw(toggle: boolean): ICoordinatedStatement;
  columns(): readonly { readonly name: string }[];
  get(...values: readonly ISqliteValue[]): unknown;
  all(...values: readonly ISqliteValue[]): readonly unknown[];
}

/** The acquired driver's narrow scope operations; opening and configuration remain with the factory. */
interface ICoordinatedDriver {
  exec(sql: string): unknown;
  prepare(sql: string): ICoordinatedStatement;
  close(): unknown;
}

/** Rebuild a detached row using column names, including special property names. */
function toRow(statement: ICoordinatedStatement, cells: unknown): ISqliteRow {
  if (!Array.isArray(cells) || cells.length !== statement.columns().length) { throw new TypeError('SQLite returned an invalid row'); }
  return Object.fromEntries(statement.columns().map((column, index): readonly [string, ISqliteValue] => [column.name, toValue(cells[index])]));
}

/** Local query position distinguishes literal values from SQLite's permissive quoted names. */
interface IQueryPosition {
  /** Commas in a FROM clause introduce table sources rather than result values. */
  inFrom: boolean;
  /** The next source name must be an unquoted identifier or an admitted query form. */
  expectsTable: boolean;
  /** A recursive CTE's column declaration contains names, never string values. */
  readonly declaration: boolean;
}

/**
 * Admit single-quoted tokens only as literal values. SQLite also accepts them
 * as table, function, schema, alias and CTE-column names; none of those spellings
 * belongs to this port's unquoted query vocabulary. This context check does not
 * parse or execute SQL expressions; native parsing still validates the query.
 */
function assertLiteralPositions(words: readonly string[], recursive: boolean): void {
  const positions: IQueryPosition[] = [{ inFrom: false, expectsTable: false, declaration: false }];
  for (let index = 0; index < words.length; index += 1) {
    const value = words[index];
    const position = positions[positions.length - 1];
    if (value === undefined || position === undefined) { throw new TypeError('Unsupported SQLite coordinated read query'); }
    const previous = words[index - 1];
    const next = words[index + 1];
    if (value.startsWith("'")) {
      const expression = previous !== undefined && ['SELECT', ',', '(', '=', '<', '>', '+', '-', '*', '/', 'LIKE', 'ESCAPE'].includes(previous);
      if (!expression || position.declaration || position.expectsTable || previous === '.' || next === '.' || next === '(') {
        throw new TypeError('SQLite coordinated reads require unquoted identifiers');
      }
      continue;
    }
    if (value === '(') {
      positions.push({ inFrom: false, expectsTable: false, declaration: recursive && index === 3 });
      continue;
    }
    if (value === ')') {
      if (positions.length === 1) { throw new TypeError('Unsupported SQLite coordinated read query'); }
      positions.pop();
      continue;
    }
    if (value === 'FROM' || value === 'JOIN') {
      position.inFrom = true;
      position.expectsTable = true;
      continue;
    }
    if (['SELECT', 'WHERE', 'GROUP', 'HAVING', 'ORDER', 'LIMIT', 'OFFSET', 'UNION', 'INTERSECT', 'EXCEPT'].includes(value)) {
      position.inFrom = false;
      position.expectsTable = false;
      continue;
    }
    if (value === ',') {
      position.expectsTable = position.inFrom;
    } else if (/^[A-Z_][A-Z0-9_]*$/u.test(value) && position.expectsTable) {
      position.expectsTable = false;
    }
  }
  if (positions.length !== 1) { throw new TypeError('Unsupported SQLite coordinated read query'); }
}

/**
 * Recognize the deliberately small query language supplied to this port.
 * Preparation itself can configure SQLite, so unrecognized syntax is refused
 * before native code sees it. This is not a general SQL parser: one optional
 * leading role comment, SELECT or WITH RECURSIVE, unquoted identifiers and
 * the COUNT/JSON_EACH functions are the supported vocabulary. Native readonly
 * classification remains a second, independent check.
 */
function assertReadQuery(sql: string): void {
  const body = sql.replace(/^\s*\/\*\s*[a-z][a-z0-9-]*\s*\*\//iu, '');
  const token = /\s+|'(?:[^']|'')*'|[a-z_][a-z0-9_]*|[0-9]+|\?|[(),.*=<>+\-/]/giy;
  const tokens: string[] = [];
  let position = 0;
  while (position < body.length) {
    token.lastIndex = position;
    const match = token.exec(body);
    if (match === null) { throw new TypeError('Unsupported SQLite coordinated read query'); }
    const value = match[0];
    position = token.lastIndex;
    if (!/^\s+$/u.test(value)) { tokens.push(value); }
  }
  const words = tokens.map((value) => value.toUpperCase());
  const select = words[0] === 'SELECT';
  const recursive = words[0] === 'WITH' && words[1] === 'RECURSIVE'
    && words[2] !== undefined && /^[A-Z_][A-Z0-9_]*$/u.test(words[2]) && words[3] === '(';
  if (!select && !recursive) { throw new TypeError('Unsupported SQLite coordinated read query'); }
  assertLiteralPositions(words, recursive);
  for (let index = 0; index < words.length; index += 1) {
    const value = words[index];
    const next = words[index + 1];
    if (value === undefined) { continue; }
    if (value === 'PRAGMA' || value.startsWith('PRAGMA_')
      || (value === '-' && next === '-') || (value === '/' && next === '*')) {
      throw new TypeError('Unsupported SQLite coordinated read query');
    }
    if (/^[A-Z_][A-Z0-9_]*$/u.test(value) && next === '('
      && !['COUNT', 'JSON_EACH', 'IN', 'AS', 'EXISTS', 'SELECT'].includes(value)
      && !(recursive && index === 2)) {
      throw new TypeError('Unsupported SQLite coordinated read function');
    }
  }
}

/** Wrap a native statement with read-only and scope lifetime boundaries. */
function readStatement(statement: ICoordinatedStatement, assertLive: () => void): ISqliteReadStatement {
  statement.safeIntegers(true).raw(true);
  /** Validate parameters only while their owning scope is live. */
  function parameters(values: readonly ISqliteValue[]): readonly ISqliteValue[] {
    assertLive(); values.forEach(assertBindable); return values;
  }
  return Object.freeze({
    get(...values: readonly ISqliteValue[]): ISqliteRow | undefined {
      const cells: unknown = readHost(() => statement.get(...parameters(values)));
      return cells === undefined ? undefined : toRow(statement, cells);
    },
    all(...values: readonly ISqliteValue[]): readonly ISqliteRow[] {
      const rows: readonly unknown[] = readHost(() => statement.all(...parameters(values)));
      return rows.map((cells) => toRow(statement, cells));
    },
  });
}

/** Construct one scope over an already acquired driver; its ended state cannot be reused. @internal */
export function _scopeFor(driver: ICoordinatedDriver): ISqliteCoordinatedReadScope {
  let state: 'unbegun' | 'begun' | 'ended' | 'closed' = 'unbegun';
  /** A prepared statement never outlives its transaction. */
  function assertLive(): void { if (state !== 'begun') { throw new Error('SQLite coordinated read scope is not live'); } }
  return Object.freeze({
    begin(): void {
      if (state !== 'unbegun') { throw new Error('SQLite coordinated read scope cannot begin'); }
      readHost(() => { driver.exec('BEGIN DEFERRED'); });
      state = 'begun';
    },
    prepare(sql: string): ISqliteReadStatement {
      assertLive();
      assertReadQuery(sql);
      const statement = readHost(() => driver.prepare(sql));
      if (!statement.reader || !statement.readonly) { throw new TypeError('SQLite coordinated inspection refuses mutation statements'); }
      return readStatement(statement, assertLive);
    },
    end(): void {
      if (state === 'closed' || state === 'ended') { return; }
      if (state === 'unbegun') { state = 'ended'; return; }
      // Refuse further reads even if native release fails; close remains available.
      state = 'ended';
      readHost(() => { driver.exec('ROLLBACK'); });
    },
    close(): void {
      if (state === 'closed') { return; }
      readHost(() => { driver.close(); });
      state = 'closed';
    },
  });
}

/** Supply existing-file coordinated inspection without opening a database yet. @internal */
export function _createNodeSqliteCoordinatedReaderImplementation(): ISqliteCoordinatedReadCapability {
  return Object.freeze({
    openSqliteCoordinatedRead(location: string): ISqliteCoordinatedReadScope {
      if (location === '' || location === ':memory:') { throw new TypeError('SQLite inspection requires an existing persistent file'); }
      // Establish absence via the host rather than inferring it from a native error message.
      const descriptor = readHost(() => openSync(location, 'r'));
      closeSync(descriptor);
      const driver = readHost(() => new Database(location, { readonly: true, fileMustExist: true, timeout: busyTimeoutMilliseconds }));
      return _scopeFor({
        exec: (sql) => driver.exec(sql),
        prepare: (sql) => driver.prepare<unknown[], unknown>(sql),
        close: () => driver.close(),
      });
    },
  });
}
