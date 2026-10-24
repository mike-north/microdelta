/** Dedicated expiring schema; immutable usage and History files are never accepted here. @packageDocumentation */
import type { ISqliteConnection, ISqliteReader } from '@microdelta/machine';
import { AccountingSchemaError } from '../errors.js';
import { identity } from './validation.js';

/** Exact owned schema definitions prevent opening foreign or partially initialized databases. */
const definitions: ReadonlyMap<string, string> = new Map([
  ['resource_report_identity', `CREATE TABLE resource_report_identity (
    singleton INTEGER PRIMARY KEY CHECK(singleton = 1),
    schema_version INTEGER NOT NULL CHECK(schema_version = 1),
    logical_store TEXT NOT NULL
  ) STRICT`],
  ['resource_reports', `CREATE TABLE resource_reports (
    environment TEXT NOT NULL, report TEXT NOT NULL, observed_at INTEGER NOT NULL,
    valid_until INTEGER, local_retention INTEGER,
    provider TEXT, service TEXT, account TEXT, pool TEXT, resource TEXT, unit TEXT, window TEXT,
    allowed INTEGER, remaining INTEGER, expires_at INTEGER NOT NULL, retention_basis TEXT NOT NULL,
    PRIMARY KEY(environment, report)
  ) STRICT`],
  ['resource_reports_by_expiry', 'CREATE INDEX resource_reports_by_expiry ON resource_reports(expires_at)'],
]);

/** SQLite preserves declaration text; whitespace has no schema meaning. */
function normalized(sql: string): string { return sql.replace(/\s+/gu, ' ').trim(); }

/** Read and verify schema identity without invoking any write port, even for empty storage. */
export function verifySchema(connection: ISqliteReader, logicalStore: string): void {
  identity(logicalStore);
  const objects = connection.prepare("SELECT name, sql FROM sqlite_master WHERE name NOT LIKE 'sqlite_%' ORDER BY name").all();
  if (objects.length !== definitions.size || objects.some((row) => {
    const name = row['name'];
    const sql = row['sql'];
    const expected = typeof name === 'string' ? definitions.get(name) : undefined;
    return expected === undefined || typeof sql !== 'string' || normalized(sql) !== normalized(expected);
  })) { throw new AccountingSchemaError('Resource report schema is foreign, incomplete or unsupported'); }
  const rows = connection.prepare('SELECT singleton, schema_version, logical_store FROM resource_report_identity').all();
  if (rows.length !== 1 || rows[0]?.['singleton'] !== 1 || rows[0]['schema_version'] !== 1 || rows[0]['logical_store'] !== logicalStore) {
    throw new AccountingSchemaError('Resource report logical store or schema identity does not match');
  }
}

/** Initialize only truly empty dedicated storage under the caller's write transaction. */
export function initializeSchema(connection: ISqliteConnection, logicalStore: string): void {
  identity(logicalStore);
  if (connection.prepare("SELECT name FROM sqlite_master WHERE name NOT LIKE 'sqlite_%'").all().length === 0) {
    for (const definition of definitions.values()) { connection.exec(definition); }
    connection.prepare('INSERT INTO resource_report_identity VALUES (1, 1, ?)').run(logicalStore);
  }
  verifySchema(connection, logicalStore);
}
