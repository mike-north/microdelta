/**
 * Node-only SQLite bindings for the EXP-3 fixture. This adapter owns native
 * driver configuration while the candidate sees only its portable capability.
 */
import Database from 'better-sqlite3';
import type { ISqliteCapability, ISqliteRow, ISqliteStatement, ISqliteValue } from '../src/sqlite.js';

/** @internal Adds explicit close ownership to the portable SQLite capability. */
export interface INodeSqliteDatabase extends ISqliteCapability {
  /** Close native file handles so tests can prove fresh-process reopen behavior. */
  close(): void;
}

/**
 * @internal
 * Opens one SQLite file with WAL, full synchronous commits, foreign keys, and a
 * bounded lock wait so process-crash observations use a declared durability mode.
 */
export function openNodeSqlite(path: string): INodeSqliteDatabase {
  const connection = new Database(path, { timeout: 500 });
  connection.pragma('journal_mode = WAL');
  connection.pragma('synchronous = FULL');
  connection.pragma('foreign_keys = ON');
  connection.pragma('busy_timeout = 500');

  return {
    exec: (sql) => connection.exec(sql),
    queryOne: (sql, parameters = []) => {
      const row: unknown = connection.prepare(sql).get(...parameters);
      return row === undefined ? undefined : toSqliteRow(row);
    },
    queryAll: (sql, parameters = []) => connection.prepare(sql).all(...parameters).map(toSqliteRow),
    prepare: (sql): ISqliteStatement => {
      const statement = connection.prepare(sql);
      return {
        run: (...parameters) => ({ changes: statement.run(...parameters).changes }),
        get: (...parameters) => {
          const row: unknown = statement.get(...parameters);
          return row === undefined ? undefined : toSqliteRow(row);
        },
        all: (...parameters) => statement.all(...parameters).map(toSqliteRow),
      };
    },
    transaction: (operation) => connection.transaction(operation).immediate(),
    close: () => connection.close(),
  };
}

/** @internal Converts native result objects into the narrow portable row contract. */
function toSqliteRow(value: unknown): ISqliteRow {
  if (!isSqliteRecord(value)) {
    throw new Error('SQLite returned a non-row value');
  }
  const row: Record<string, ISqliteValue> = {};
  for (const [key, column] of Object.entries(value)) {
    if (typeof column === 'string' || typeof column === 'number' || column === null || column instanceof Uint8Array) {
      row[key] = column;
    } else {
      throw new Error(`SQLite returned an unsupported value for column ${key}`);
    }
  }
  return row;
}

/** @internal Narrows native SQLite output to named fields whose values still require validation. */
function isSqliteRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
