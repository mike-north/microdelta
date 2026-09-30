/**
 * The versioned production schema of History's durable authority. It is
 * distinct from the legacy row Store's compatibility schema and from the
 * EXP-3 and nested-read experiment layouts. The schema is defined as an exact
 * list of SQL objects; a database is usable only when it contains exactly
 * these objects and one identity row naming this schema, version and logical
 * store. Anything else (empty aside) is rejected before work: History never
 * guesses a migration from unknown, incomplete or foreign storage.
 *
 * Immutability of completed history is enforced in storage by triggers:
 * results, their generated index, dependencies, acceptance records, promotion
 * records, journal revisions and the identity row cannot be updated or
 * deleted, and attempts, current pointers and writer/sequence rows cannot be
 * deleted. No reclamation exists (RES-006).
 *
 * Version 2 namespaces acceptance records by the environment that recorded
 * them and adds recorded promotions and Run Supervision's operation journal
 * (RUN-011/012/017). Version 1 files, written before those records existed,
 * are rejected by their recorded version like any other unsupported version:
 * the repository's storage policy is to reject incompatible formats
 * explicitly and never migrate stored data by guessing (execution.md PUB-004,
 * experiments.md EXP-2 gate), and no migration is authorized.
 * @packageDocumentation
 */
import type { ISqliteConnection, ISqliteRow } from '@microdelta/machine';

import { HistorySchemaError } from './errors.js';

/** Identity tag for embedded SQL; the text is passed through unchanged. */
const sql = String.raw;

/** The schema identity recorded in every durable History file. */
export const schemaName = 'microdelta.history.durable';

/** The only schema version this implementation reads or writes. */
export const schemaVersion = 2;

/** Tables whose rows may never be updated or deleted once written. */
const immutableTables = [
  'history_identity',
  'history_results',
  'history_dependencies',
  'history_nodes',
  'history_edges',
  'history_addresses',
  'history_acceptances',
  'history_acceptance_dependencies',
  'history_promotions',
  'history_promotion_results',
  'history_journal',
] as const;

/** Tables whose rows may change state but are never deleted. */
const retainedTables = ['history_writer', 'history_sequences', 'history_attempts', 'history_current'] as const;

/**
 * Every schema object, one statement each, in creation order. Stored
 * definitions are compared with these texts after whitespace normalization.
 */
const schemaObjects: readonly string[] = [
  // One row naming the schema, its version and the logical store this file holds.
  sql`CREATE TABLE history_identity (
    singleton INTEGER PRIMARY KEY CHECK (singleton = 1),
    schema_name TEXT NOT NULL,
    schema_version INTEGER NOT NULL,
    logical_store TEXT NOT NULL CHECK (length(logical_store) > 0)
  ) STRICT`,
  // The single logical writer: holder, monotonically increasing fence, lease
  // expiry and the persisted clock high-water, all in History's clock domain.
  sql`CREATE TABLE history_writer (
    singleton INTEGER PRIMARY KEY CHECK (singleton = 1),
    last_fence INTEGER NOT NULL CHECK (last_fence >= 0),
    holder TEXT CHECK (holder IS NULL OR length(holder) > 0),
    expires_at INTEGER NOT NULL CHECK (expires_at >= 0),
    time_high_water INTEGER NOT NULL CHECK (time_high_water >= 0)
  ) STRICT`,
  // Store-wide counters; issued values are never reissued (PUB-003).
  sql`CREATE TABLE history_sequences (
    singleton INTEGER PRIMARY KEY CHECK (singleton = 1),
    last_attempt INTEGER NOT NULL CHECK (last_attempt >= 0),
    last_publication INTEGER NOT NULL CHECK (last_publication >= 0),
    last_acceptance INTEGER NOT NULL CHECK (last_acceptance >= 0),
    last_promotion INTEGER NOT NULL CHECK (last_promotion >= 0),
    last_journal INTEGER NOT NULL CHECK (last_journal >= 0)
  ) STRICT`,
  // Durable attempts with their stable key, intent digest, staged candidate
  // content and failure evidence. Staged content is never a completed result.
  sql`CREATE TABLE history_attempts (
    attempt_id INTEGER PRIMARY KEY CHECK (attempt_id > 0),
    analysis TEXT NOT NULL CHECK (length(analysis) > 0),
    environment TEXT NOT NULL CHECK (length(environment) > 0),
    subject TEXT NOT NULL CHECK (length(subject) > 0),
    version INTEGER NOT NULL CHECK (version > 0),
    attempt_key TEXT NOT NULL CHECK (length(attempt_key) > 0),
    intent_digest TEXT NOT NULL CHECK (length(intent_digest) > 0),
    state TEXT NOT NULL CHECK (state IN ('allocated', 'staged', 'completed', 'failed', 'interrupted')),
    allocated_fence INTEGER NOT NULL CHECK (allocated_fence > 0),
    ended_fence INTEGER CHECK (ended_fence IS NULL OR ended_fence > 0),
    staged_payload TEXT,
    staged_provenance_format TEXT,
    staged_provenance_version INTEGER,
    staged_provenance TEXT,
    outcome_format TEXT,
    outcome_version INTEGER,
    outcome TEXT,
    UNIQUE (analysis, environment, subject, attempt_key),
    UNIQUE (attempt_id, analysis, environment, subject, version),
    CHECK ((staged_payload IS NULL) = (staged_provenance IS NULL)
      AND (staged_payload IS NULL) = (staged_provenance_format IS NULL)
      AND (staged_payload IS NULL) = (staged_provenance_version IS NULL)),
    CHECK ((outcome IS NULL) = (outcome_format IS NULL) AND (outcome IS NULL) = (outcome_version IS NULL)),
    CHECK ((state = 'allocated' AND staged_payload IS NULL AND ended_fence IS NULL AND outcome IS NULL)
      OR (state = 'staged' AND staged_payload IS NOT NULL AND ended_fence IS NULL AND outcome IS NULL)
      OR (state = 'completed' AND staged_payload IS NULL AND ended_fence IS NOT NULL AND outcome IS NULL)
      OR (state IN ('failed', 'interrupted') AND ended_fence IS NOT NULL AND outcome IS NOT NULL))
  ) STRICT`,
  // Immutable completed results. A result's identity is the attempt that
  // produced it; its scope and version must equal that attempt's.
  sql`CREATE TABLE history_results (
    result_id INTEGER PRIMARY KEY,
    analysis TEXT NOT NULL,
    environment TEXT NOT NULL,
    subject TEXT NOT NULL,
    version INTEGER NOT NULL,
    publication INTEGER NOT NULL UNIQUE CHECK (publication > 0),
    published_fence INTEGER NOT NULL CHECK (published_fence > 0),
    encoding TEXT NOT NULL,
    index_version INTEGER NOT NULL,
    payload TEXT NOT NULL,
    provenance_format TEXT NOT NULL,
    provenance_version INTEGER NOT NULL,
    provenance TEXT NOT NULL,
    UNIQUE (result_id, analysis, environment, subject),
    FOREIGN KEY (result_id, analysis, environment, subject, version)
      REFERENCES history_attempts (attempt_id, analysis, environment, subject, version)
  ) STRICT`,
  sql`CREATE INDEX history_results_by_subject ON history_results (analysis, environment, subject, version, publication)`,
  // Explicit exact dependencies recorded with staged content, in caller order.
  sql`CREATE TABLE history_dependencies (
    attempt_id INTEGER NOT NULL REFERENCES history_attempts (attempt_id),
    position INTEGER NOT NULL CHECK (position >= 0),
    dependency_id INTEGER NOT NULL REFERENCES history_results (result_id),
    PRIMARY KEY (attempt_id, position)
  ) STRICT`,
  // The generated selected index: one row per node of the canonical payload.
  // Only `scalar` holds author data; everything else is shape or digest.
  sql`CREATE TABLE history_nodes (
    result_id INTEGER NOT NULL REFERENCES history_results (result_id),
    node_id INTEGER NOT NULL CHECK (node_id >= 0),
    kind TEXT NOT NULL CHECK (kind IN ('scalar', 'record', 'array')),
    scalar TEXT,
    array_length INTEGER,
    own_keys TEXT,
    prototype TEXT CHECK (prototype IS NULL OR prototype IN ('null', 'object', 'custom')),
    prototype_node INTEGER,
    terminal TEXT CHECK (terminal IS NULL OR terminal IN ('null', 'object')),
    snapshot_fingerprint TEXT NOT NULL,
    PRIMARY KEY (result_id, node_id),
    CHECK ((kind = 'scalar' AND scalar IS NOT NULL AND array_length IS NULL AND own_keys IS NULL
        AND prototype IS NULL AND prototype_node IS NULL AND terminal IS NULL)
      OR (kind = 'array' AND scalar IS NULL AND array_length IS NOT NULL AND array_length >= 0 AND own_keys IS NULL
        AND prototype IS NULL AND prototype_node IS NULL AND terminal IS NULL)
      OR (kind = 'record' AND scalar IS NULL AND array_length IS NULL AND own_keys IS NOT NULL
        AND prototype IS NOT NULL AND terminal IS NOT NULL AND (prototype = 'custom') = (prototype_node IS NOT NULL)))
  ) STRICT`,
  // Structural slots: own record members and present array elements.
  sql`CREATE TABLE history_edges (
    result_id INTEGER NOT NULL REFERENCES history_results (result_id),
    parent_node INTEGER NOT NULL,
    edge_kind TEXT NOT NULL CHECK (edge_kind IN ('property', 'index')),
    edge_key TEXT NOT NULL,
    position INTEGER NOT NULL,
    child_node INTEGER NOT NULL,
    PRIMARY KEY (result_id, parent_node, edge_kind, edge_key)
  ) STRICT`,
  // Every reachable structured address, with its node and MDO1 value digest.
  sql`CREATE TABLE history_addresses (
    result_id INTEGER NOT NULL REFERENCES history_results (result_id),
    address TEXT NOT NULL,
    node_id INTEGER NOT NULL,
    own INTEGER NOT NULL CHECK (own IN (0, 1)),
    value_fingerprint TEXT,
    PRIMARY KEY (result_id, address),
    CHECK ((address = '[]') = (value_fingerprint IS NULL))
  ) STRICT`,
  // The latest publication of each scoped subject; acceptance never moves it.
  sql`CREATE TABLE history_current (
    analysis TEXT NOT NULL,
    environment TEXT NOT NULL,
    subject TEXT NOT NULL,
    result_id INTEGER NOT NULL,
    PRIMARY KEY (analysis, environment, subject),
    FOREIGN KEY (result_id, analysis, environment, subject)
      REFERENCES history_results (result_id, analysis, environment, subject)
  ) STRICT`,
  // Current acceptance evidence, separate from the result's provenance, in
  // the namespace of the environment whose verification recorded it.
  sql`CREATE TABLE history_acceptances (
    acceptance_id INTEGER PRIMARY KEY CHECK (acceptance_id > 0),
    result_id INTEGER NOT NULL REFERENCES history_results (result_id),
    environment TEXT NOT NULL CHECK (length(environment) > 0),
    fence INTEGER NOT NULL CHECK (fence > 0),
    evidence_format TEXT NOT NULL,
    evidence_version INTEGER NOT NULL,
    evidence TEXT NOT NULL
  ) STRICT`,
  sql`CREATE INDEX history_acceptances_by_result ON history_acceptances (result_id, environment, acceptance_id)`,
  sql`CREATE TABLE history_acceptance_dependencies (
    acceptance_id INTEGER NOT NULL REFERENCES history_acceptances (acceptance_id),
    position INTEGER NOT NULL CHECK (position >= 0),
    dependency_id INTEGER NOT NULL REFERENCES history_results (result_id),
    PRIMARY KEY (acceptance_id, position)
  ) STRICT`,
  // Recorded promotions (RUN-017): each admits exact results of other
  // environments into its target environment, with the promoter's evidence.
  sql`CREATE TABLE history_promotions (
    promotion_id INTEGER PRIMARY KEY CHECK (promotion_id > 0),
    analysis TEXT NOT NULL CHECK (length(analysis) > 0),
    environment TEXT NOT NULL CHECK (length(environment) > 0),
    fence INTEGER NOT NULL CHECK (fence > 0),
    evidence_format TEXT NOT NULL,
    evidence_version INTEGER NOT NULL,
    evidence TEXT NOT NULL
  ) STRICT`,
  sql`CREATE INDEX history_promotions_by_target ON history_promotions (analysis, environment, promotion_id)`,
  sql`CREATE TABLE history_promotion_results (
    promotion_id INTEGER NOT NULL REFERENCES history_promotions (promotion_id),
    position INTEGER NOT NULL CHECK (position >= 0),
    result_id INTEGER NOT NULL REFERENCES history_results (result_id),
    PRIMARY KEY (promotion_id, position),
    UNIQUE (promotion_id, result_id)
  ) STRICT`,
  sql`CREATE INDEX history_promotion_results_by_result ON history_promotion_results (result_id, promotion_id)`,
  // Run Supervision's operation journal: immutable revisions of opaque owner
  // records per environment namespace, owner-named collection and key. The
  // current record is an address's highest revision; the sequence orders
  // commits. The format and version are each revision's tag, never part of
  // the record's identity, so two formats can never hold parallel records.
  sql`CREATE TABLE history_journal (
    analysis TEXT NOT NULL CHECK (length(analysis) > 0),
    environment TEXT NOT NULL CHECK (length(environment) > 0),
    collection TEXT NOT NULL CHECK (length(collection) > 0),
    journal_key TEXT NOT NULL CHECK (length(journal_key) > 0),
    revision INTEGER NOT NULL CHECK (revision > 0),
    sequence INTEGER NOT NULL UNIQUE CHECK (sequence > 0),
    fence INTEGER NOT NULL CHECK (fence > 0),
    format TEXT NOT NULL CHECK (length(format) > 0),
    format_version INTEGER NOT NULL CHECK (format_version > 0),
    content TEXT NOT NULL,
    PRIMARY KEY (analysis, environment, collection, journal_key, revision)
  ) STRICT`,
  ...immutableTables.flatMap((table) => [
    sql`CREATE TRIGGER ${table}_immutable_update BEFORE UPDATE ON ${table}
    BEGIN SELECT RAISE(ABORT, '${table} rows are immutable history'); END`,
    sql`CREATE TRIGGER ${table}_immutable_delete BEFORE DELETE ON ${table}
    BEGIN SELECT RAISE(ABORT, '${table} rows are immutable history'); END`,
  ]),
  ...retainedTables.map((table) => sql`CREATE TRIGGER ${table}_immutable_delete BEFORE DELETE ON ${table}
    BEGIN SELECT RAISE(ABORT, '${table} rows are immutable history and are never deleted'); END`),
  // An attempt's identity, scope, key, intent and allocating fence never change.
  sql`CREATE TRIGGER history_attempts_identity_immutable
    BEFORE UPDATE OF attempt_id, analysis, environment, subject, version, attempt_key, intent_digest, allocated_fence
    ON history_attempts
    BEGIN SELECT RAISE(ABORT, 'history_attempts identity is immutable history'); END`,
];

/** Collapse whitespace so stored definitions compare by meaning-preserving text. */
function normalize(text: string): string {
  return text.replace(/\s+/gu, ' ').trim();
}

/** The object name declared by one schema statement. */
function objectName(statement: string): string {
  const match = /^CREATE (?:TABLE|INDEX|TRIGGER) (\S+)/u.exec(normalize(statement));
  if (match?.[1] === undefined) {
    throw new Error('History schema statement has no object name');
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
 * Create the schema in one transaction when the database has no objects,
 * then validate it. Validation requires exactly the expected objects with
 * their exact definitions and a single identity row naming this schema,
 * version and the requested logical store.
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
    connection.prepare(sql`/* schema */ INSERT INTO history_identity (singleton, schema_name, schema_version, logical_store) VALUES (1, ?, ?, ?)`)
      .run(schemaName, schemaVersion, logicalStore);
    connection.prepare(sql`/* schema */ INSERT INTO history_writer (singleton, last_fence, holder, expires_at, time_high_water) VALUES (1, 0, NULL, 0, 0)`).run();
    connection.prepare(sql`/* schema */ INSERT INTO history_sequences (singleton, last_attempt, last_publication, last_acceptance, last_promotion, last_journal)
      VALUES (1, 0, 0, 0, 0, 0)`).run();
    return undefined;
  });
  validateSchema(connection, logicalStore);
}

/**
 * Reject a file that records this schema under another version before
 * comparing objects, so an earlier or later History layout is diagnosed by its
 * version rather than as an incomplete schema. A file whose identity cannot be
 * read this way is left to the exact object comparison.
 */
function rejectOtherVersion(connection: ISqliteConnection, present: ReadonlyMap<string, string | null>): void {
  if (!present.has('history_identity')) {
    return;
  }
  let identities: readonly ISqliteRow[];
  try {
    identities = connection.prepare(sql`/* schema */ SELECT schema_name, schema_version FROM history_identity`).all();
  } catch {
    return;
  }
  const identity = identities[0];
  if (identities.length === 1 && identity?.schema_name === schemaName && identity.schema_version !== schemaVersion) {
    throw new HistorySchemaError(
      `Unsupported History schema ${schemaName} version ${String(identity.schema_version)}; this implementation reads only version ${String(schemaVersion)} and never migrates stored data by guessing`,
    );
  }
}

/** Reject any database that is not exactly this schema for this logical store. */
function validateSchema(connection: ISqliteConnection, logicalStore: string): void {
  const present = presentObjects(connection);
  rejectOtherVersion(connection, present);
  const missing = [...expectedObjects.keys()].filter((name) => !present.has(name));
  const unexpected = [...present.keys()].filter((name) => !expectedObjects.has(name));
  if (missing.length > 0 || unexpected.length > 0) {
    throw new HistorySchemaError(`Unsupported or incomplete History schema: missing [${missing.join(', ')}], unexpected [${unexpected.join(', ')}]`);
  }
  const altered = [...expectedObjects].filter(([name, definition]) => present.get(name) !== definition).map(([name]) => name);
  if (altered.length > 0) {
    throw new HistorySchemaError(`History schema objects differ from version ${String(schemaVersion)}: ${altered.join(', ')}`);
  }
  const identities = connection.prepare(sql`/* schema */ SELECT schema_name, schema_version, logical_store FROM history_identity`).all();
  const identity = identities[0];
  if (identities.length !== 1 || identity === undefined) {
    throw new HistorySchemaError('History schema has no single identity row');
  }
  if (identity.schema_name !== schemaName || identity.schema_version !== schemaVersion) {
    throw new HistorySchemaError(`Unsupported History schema ${String(identity.schema_name)} version ${String(identity.schema_version)}`);
  }
  if (identity.logical_store !== logicalStore) {
    throw new HistorySchemaError('The SQLite file holds a different logical History store');
  }
  for (const table of ['history_writer', 'history_sequences']) {
    const count = connection.prepare(sql`/* schema */ SELECT count(*) AS n FROM ${table}`).get();
    if (count?.n !== 1) {
      throw new HistorySchemaError(`History schema table ${table} does not have exactly one row`);
    }
  }
}
