/**
 * The versioned schema of Accounting's durable SQLite store. Every object lives
 * in the `accounting_` namespace and the identity row names this schema, its
 * version and the logical store. A database is usable only when it is empty or
 * contains exactly these objects and that identity: Accounting never guesses a
 * migration from unknown, incomplete, foreign or differently versioned
 * storage, and it does not share a file with another owner's schema.
 *
 * Every recorded fact is immutable. For every table, including the identity
 * row, triggers refuse:
 * - any `UPDATE` (including `UPDATE OR REPLACE`);
 * - any `DELETE`;
 * - any `INSERT` whose primary key is already present. This is what refuses
 *   `REPLACE` and `INSERT OR REPLACE`: SQLite resolves their conflict by deleting
 *   the existing row without firing delete triggers, so the insert itself must
 *   be refused. A plain duplicate insert fails the same way.
 * Only an insert of a new key can add a fact. Environments are a column of
 * every fact table and part of every key, so identical identities in two
 * environments never collide (RUN-017).
 * @packageDocumentation
 */
import type { ISqliteConnection, ISqliteRow } from '@microdelta/machine';

import { AccountingSchemaError } from '../errors.js';

/** Identity tag for embedded SQL; the text is passed through unchanged. */
const sql = String.raw;

/** The schema identity recorded in every durable accounting file. */
export const schemaName = 'microdelta.accounting.durable';

/** The only schema version this implementation reads or writes. */
export const schemaVersion = 1;

/** Every table with its primary-key columns; all rows are immutable facts. */
const tables: readonly (readonly [table: string, key: readonly string[]])[] = [
  ['accounting_identity', ['singleton']],
  ['accounting_request_attempts', ['environment', 'request_attempt']],
  ['accounting_reports', ['environment', 'operation', 'report']],
  ['accounting_report_quantities', ['environment', 'operation', 'report', 'unit']],
  ['accounting_estimates', ['environment', 'estimate']],
  ['accounting_estimate_quantities', ['environment', 'estimate', 'unit']],
];

/**
 * Every schema object, one statement each, in creation order. Stored
 * definitions are compared with these texts after whitespace normalization.
 */
const schemaObjects: readonly string[] = [
  // One row naming the schema, its version and the logical store this file holds.
  sql`CREATE TABLE accounting_identity (
    singleton INTEGER PRIMARY KEY CHECK (singleton = 1),
    schema_name TEXT NOT NULL,
    schema_version INTEGER NOT NULL,
    logical_store TEXT NOT NULL CHECK (length(logical_store) > 0)
  ) STRICT`,
  // Usage intents: request attempt `request_attempt` of operation `operation`
  // was about to be sent for this run, member and step attempt. A request
  // attempt identity belongs to one operation within its environment.
  sql`CREATE TABLE accounting_request_attempts (
    environment TEXT NOT NULL CHECK (length(environment) > 0),
    request_attempt TEXT NOT NULL CHECK (length(request_attempt) > 0),
    operation TEXT NOT NULL CHECK (length(operation) > 0),
    run TEXT NOT NULL CHECK (length(run) > 0),
    member TEXT CHECK (member IS NULL OR length(member) > 0),
    step_attempt TEXT CHECK (step_attempt IS NULL OR length(step_attempt) > 0),
    PRIMARY KEY (environment, request_attempt),
    UNIQUE (environment, operation, request_attempt)
  ) STRICT`,
  sql`CREATE INDEX accounting_request_attempts_by_run ON accounting_request_attempts (environment, run, member, step_attempt)`,
  // Acknowledged usage reports, keyed by (operation, report) within an
  // environment and attributed to a recorded request attempt of that operation.
  sql`CREATE TABLE accounting_reports (
    environment TEXT NOT NULL,
    operation TEXT NOT NULL,
    report TEXT NOT NULL CHECK (length(report) > 0),
    request_attempt TEXT NOT NULL,
    PRIMARY KEY (environment, operation, report),
    FOREIGN KEY (environment, operation, request_attempt) REFERENCES accounting_request_attempts (environment, operation, request_attempt)
  ) STRICT`,
  sql`CREATE INDEX accounting_reports_by_request_attempt ON accounting_reports (environment, operation, request_attempt)`,
  // Observed deltas of one report, one row per unit.
  sql`CREATE TABLE accounting_report_quantities (
    environment TEXT NOT NULL,
    operation TEXT NOT NULL,
    report TEXT NOT NULL,
    unit TEXT NOT NULL CHECK (length(unit) > 0),
    amount INTEGER NOT NULL CHECK (amount >= 0),
    PRIMARY KEY (environment, operation, report, unit),
    FOREIGN KEY (environment, operation, report) REFERENCES accounting_reports (environment, operation, report)
  ) STRICT`,
  // Estimates with their canonical MDS1-encoded basis; never observations.
  sql`CREATE TABLE accounting_estimates (
    environment TEXT NOT NULL CHECK (length(environment) > 0),
    estimate TEXT NOT NULL CHECK (length(estimate) > 0),
    run TEXT NOT NULL CHECK (length(run) > 0),
    member TEXT CHECK (member IS NULL OR length(member) > 0),
    step_attempt TEXT CHECK (step_attempt IS NULL OR length(step_attempt) > 0),
    basis_format TEXT NOT NULL CHECK (length(basis_format) > 0),
    basis_version INTEGER NOT NULL CHECK (basis_version > 0),
    basis TEXT NOT NULL,
    PRIMARY KEY (environment, estimate)
  ) STRICT`,
  // Estimated amounts of one estimate, one row per unit.
  sql`CREATE TABLE accounting_estimate_quantities (
    environment TEXT NOT NULL,
    estimate TEXT NOT NULL,
    unit TEXT NOT NULL CHECK (length(unit) > 0),
    amount INTEGER NOT NULL CHECK (amount >= 0),
    PRIMARY KEY (environment, estimate, unit),
    FOREIGN KEY (environment, estimate) REFERENCES accounting_estimates (environment, estimate)
  ) STRICT`,
  ...tables.flatMap(([table, key]) => [
    sql`CREATE TRIGGER ${table}_immutable_update BEFORE UPDATE ON ${table}
    BEGIN SELECT RAISE(ABORT, '${table} rows are immutable accounting facts'); END`,
    sql`CREATE TRIGGER ${table}_immutable_delete BEFORE DELETE ON ${table}
    BEGIN SELECT RAISE(ABORT, '${table} rows are immutable accounting facts'); END`,
    sql`CREATE TRIGGER ${table}_immutable_replace BEFORE INSERT ON ${table}
    WHEN EXISTS (SELECT 1 FROM ${table} WHERE ${key.map((column) => `${column} = NEW.${column}`).join(' AND ')})
    BEGIN SELECT RAISE(ABORT, '${table} rows are immutable accounting facts'); END`,
  ]),
];

/** Collapse whitespace so stored definitions compare by meaning-preserving text. */
function normalize(text: string): string {
  return text.replace(/\s+/gu, ' ').trim();
}

/** The object name declared by one schema statement. */
function objectName(statement: string): string {
  const match = /^CREATE (?:TABLE|INDEX|TRIGGER) (\S+)/u.exec(normalize(statement));
  if (match?.[1] === undefined) {
    throw new Error('Accounting schema statement has no object name');
  }
  return match[1];
}

/** Expected normalized definitions keyed by object name. */
const expectedObjects: ReadonlyMap<string, string> = new Map(schemaObjects.map((statement) => [objectName(statement), normalize(statement)]));

/** Every user-visible object currently in the database, keyed by name. */
function presentObjects(connection: ISqliteConnection): ReadonlyMap<string, string | null> {
  const rows = connection.prepare(sql`/* schema */ SELECT name, sql FROM sqlite_master WHERE name NOT LIKE 'sqlite\_%' ESCAPE '\'`).all();
  return new Map(rows.map((row: ISqliteRow) => [String(row.name), typeof row.sql === 'string' ? normalize(row.sql) : null]));
}

/**
 * Create the schema in one transaction when the database has no objects, then
 * validate it. Validation requires exactly the expected objects with their
 * exact definitions and a single identity row naming this schema, version and
 * the requested logical store.
 */
export function initializeSchema(connection: ISqliteConnection, logicalStore: string): void {
  // An existing store is validated without taking the write lock; only an
  // apparently empty file enters the IMMEDIATE transaction, which rechecks.
  if (presentObjects(connection).size > 0) {
    validateSchema(connection, logicalStore);
    return;
  }
  connection.transaction(() => {
    if (presentObjects(connection).size > 0) {
      return undefined;
    }
    for (const statement of schemaObjects) {
      connection.exec(statement);
    }
    connection.prepare(sql`/* schema */ INSERT INTO accounting_identity (singleton, schema_name, schema_version, logical_store) VALUES (1, ?, ?, ?)`)
      .run(schemaName, schemaVersion, logicalStore);
    return undefined;
  });
  validateSchema(connection, logicalStore);
}

/** Reject any database that is not exactly this schema for this logical store. */
function validateSchema(connection: ISqliteConnection, logicalStore: string): void {
  const present = presentObjects(connection);
  const missing = [...expectedObjects.keys()].filter((name) => !present.has(name));
  const unexpected = [...present.keys()].filter((name) => !expectedObjects.has(name));
  if (missing.length > 0 || unexpected.length > 0) {
    throw new AccountingSchemaError(`Unsupported or incomplete Accounting schema: missing [${missing.join(', ')}], unexpected [${unexpected.join(', ')}]`);
  }
  const altered = [...expectedObjects].filter(([name, definition]) => present.get(name) !== definition).map(([name]) => name);
  if (altered.length > 0) {
    throw new AccountingSchemaError(`Accounting schema objects differ from version ${String(schemaVersion)}: ${altered.join(', ')}`);
  }
  const identities = connection.prepare(sql`/* schema */ SELECT schema_name, schema_version, logical_store FROM accounting_identity`).all();
  const identity = identities[0];
  if (identities.length !== 1 || identity === undefined) {
    throw new AccountingSchemaError('Accounting schema has no single identity row');
  }
  if (identity.schema_name !== schemaName || identity.schema_version !== schemaVersion) {
    throw new AccountingSchemaError(`Unsupported Accounting schema ${String(identity.schema_name)} version ${String(identity.schema_version)}`);
  }
  if (identity.logical_store !== logicalStore) {
    throw new AccountingSchemaError('The SQLite file holds a different logical accounting store');
  }
}
