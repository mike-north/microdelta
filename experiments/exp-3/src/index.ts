/**
 * EXP-3 isolates History's claim, allocation, and publication invariant from
 * the production runtime so that a small durable candidate can be fault-tested.
 */
import type { ISqliteCapability, ISqliteRow } from './sqlite.js';

/** @internal Identifies one immutable snapshot by its owning subject and generation. */
export interface IResultReference {
  readonly subjectKey: string;
  readonly generation: number;
}

/** @internal Describes the holder token that fences all writes by one writer. */
export interface IWriterLease {
  readonly holderId: string;
  readonly fencingToken: number;
  readonly expiresAtMs: number;
}

/** @internal A live writer is the sole authority allowed to mutate the fixture. */
export type IWriterAcquisition =
  | { readonly kind: 'acquired'; readonly fencingToken: number; readonly expiresAtMs: number }
  | { readonly kind: 'held'; readonly holderId: string; readonly expiresAtMs: number };

/** @internal The durable state of an allocated execution attempt. */
export type IAttemptState = 'allocated' | 'staged' | 'completed';

/** @internal Attempt history is separate from current-pointer state. */
export interface IAttempt {
  readonly attemptId: string;
  readonly attemptKey: string;
  readonly subjectKey: string;
  readonly generation: number;
  readonly state: IAttemptState;
  readonly resultReference: IResultReference | null;
}

/** @internal A completed result and the pointer selecting it remain distinct facts. */
export interface ICurrentResult {
  readonly reference: IResultReference;
  readonly payload: unknown;
  readonly fingerprint: string;
  readonly provenance: unknown;
}

/** @internal Inputs shared by mutations that require the active fencing token. */
interface IWriterAuthority {
  readonly holderId: string;
  readonly fencingToken: number;
  readonly nowMs: number;
}

/** @internal Initializes and exercises one bounded History-owned schema. */
export interface IPublicationRepository {
  /** Install schema version 1 or reject a database from an unknown version. */
  initialize(): void;
  /** Acquire the single active writer lease or report the current holder. */
  acquireWriter(request: { readonly holderId: string; readonly nowMs: number; readonly leaseMs: number }): IWriterAcquisition;
  /** Extend the current lease only while its fencing token remains authoritative. */
  renewWriter(request: IWriterAuthority & { readonly leaseMs: number }): IWriterLease;
  /** End only the lease still owned by the supplied holder and fencing token. */
  releaseWriter(request: IWriterAuthority): void;
  /** Allocate a durable generation; retries with the same key reuse its attempt. */
  allocateAttempt(request: IWriterAuthority & {
    readonly attemptKey: string;
    readonly subjectKey: string;
  }): IAttempt;
  /** Persist candidate bytes without making them eligible as a completed result. */
  stageAttempt(request: IWriterAuthority & {
    readonly attemptId: string;
    readonly payloadJson: string;
    readonly fingerprint: string;
    readonly provenanceJson: string;
  }): void;
  /** Atomically retain the immutable snapshot, move current, and complete its attempt. */
  publishAttempt(request: IWriterAuthority & { readonly attemptId: string }): IResultReference;
  /** Read current pointer and payload together from one consistent query. */
  readCurrent(subjectKey: string): ICurrentResult | null;
  /** Resolve only the exact historical reference supplied by the caller. */
  readResult(reference: IResultReference): ICurrentResult | null;
  /** Read an attempt by its identity without granting execution authority. */
  readAttempt(attemptId: string): IAttempt | null;
  /** Find a prior idempotency key so lost acknowledgments do not repeat work. */
  findAttempt(attemptKey: string): IAttempt | null;
  /** Observe the current lease for fixture traces; this grants no authority. */
  currentWriter(): IWriterLease | null;
}

/** @internal The only schema format this experiment understands. */
const SCHEMA_VERSION = 1;

/** @internal Tables whose presence defines a complete, usable version-1 schema. */
const SCHEMA_TABLES = [
  'schema_version',
  'writer_state',
  'generations',
  'attempts',
  'snapshots',
  'current_pointers',
] as const;

/**
 * @internal
 * Creates the History-owned candidate over a portable SQLite capability. A
 * single durable lease fences every mutation; allocation is committed before
 * payload staging, while snapshot, pointer, and completion share one commit.
 */
export function createPublicationRepository(database: ISqliteCapability): IPublicationRepository {
  return {
    initialize: () => initializeSchema(database),
    acquireWriter: (request) => acquireWriter(database, request),
    renewWriter: (request) => renewWriter(database, request),
    releaseWriter: (request) => releaseWriter(database, request),
    allocateAttempt: (request) => allocateAttempt(database, request),
    stageAttempt: (request) => stageAttempt(database, request),
    publishAttempt: (request) => publishAttempt(database, request),
    readCurrent: (subjectKey) => readCurrent(database, subjectKey),
    readResult: (reference) => readResult(database, reference),
    readAttempt: (attemptId) => readAttempt(database, attemptId),
    findAttempt: (attemptKey) => findAttempt(database, attemptKey),
    currentWriter: () => currentWriter(database),
  };
}

/** @internal Installs all protocol state together so partial schemas cannot be mistaken for v1. */
function initializeSchema(database: ISqliteCapability): void {
  database.transaction(() => {
    const versionTable = database.queryOne(
      "SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'schema_version'",
    );
    if (versionTable !== undefined) {
      const version = database.queryOne('SELECT version FROM schema_version WHERE id = 1');
      if (version !== undefined && requireNumber(version.version, 'version') !== SCHEMA_VERSION) {
        throw new Error(`unsupported schema version: ${String(version.version)}`);
      }
      if (version === undefined) {
        throw new Error('schema version table is missing its version row');
      }
      const missingTable = SCHEMA_TABLES.find((table) => database.queryOne(
        "SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?", [table],
      ) === undefined);
      if (missingTable !== undefined) {
        throw new Error(`incomplete schema version 1: missing table ${missingTable}`);
      }
      return;
    }

    database.exec(`
      CREATE TABLE schema_version (
        id INTEGER PRIMARY KEY CHECK (id = 1),
        version INTEGER NOT NULL CHECK (version > 0)
      );
      INSERT INTO schema_version (id, version) VALUES (1, ${SCHEMA_VERSION});
      CREATE TABLE writer_state (
        id INTEGER PRIMARY KEY CHECK (id = 1),
        last_fence INTEGER NOT NULL CHECK (last_fence >= 0),
        holder_id TEXT,
        expires_at_ms INTEGER NOT NULL CHECK (expires_at_ms >= 0)
      );
      INSERT INTO writer_state (id, last_fence, holder_id, expires_at_ms) VALUES (1, 0, NULL, 0);
      CREATE TABLE generations (
        subject_key TEXT PRIMARY KEY,
        last_generation INTEGER NOT NULL CHECK (last_generation > 0)
      );
      CREATE TABLE attempts (
        attempt_id TEXT PRIMARY KEY,
        attempt_key TEXT NOT NULL UNIQUE,
        subject_key TEXT NOT NULL,
        generation INTEGER NOT NULL CHECK (generation > 0),
        state TEXT NOT NULL CHECK (state IN ('allocated', 'staged', 'completed')),
        payload_json TEXT,
        fingerprint TEXT,
        provenance_json TEXT,
        result_generation INTEGER,
        UNIQUE (subject_key, generation),
        CHECK (
          (state = 'allocated' AND payload_json IS NULL AND fingerprint IS NULL
            AND provenance_json IS NULL AND result_generation IS NULL)
          OR (state = 'staged' AND payload_json IS NOT NULL AND fingerprint IS NOT NULL
            AND provenance_json IS NOT NULL AND result_generation IS NULL)
          OR (state = 'completed' AND payload_json IS NOT NULL AND fingerprint IS NOT NULL
            AND provenance_json IS NOT NULL AND result_generation = generation)
        )
      );
      CREATE TABLE snapshots (
        subject_key TEXT NOT NULL,
        generation INTEGER NOT NULL CHECK (generation > 0),
        attempt_id TEXT NOT NULL UNIQUE REFERENCES attempts(attempt_id) ON DELETE RESTRICT,
        payload_json TEXT NOT NULL,
        fingerprint TEXT NOT NULL,
        provenance_json TEXT NOT NULL,
        PRIMARY KEY (subject_key, generation),
        FOREIGN KEY (subject_key, generation) REFERENCES attempts(subject_key, generation) ON DELETE RESTRICT
      );
      CREATE TABLE current_pointers (
        subject_key TEXT PRIMARY KEY,
        generation INTEGER NOT NULL CHECK (generation > 0),
        FOREIGN KEY (subject_key, generation) REFERENCES snapshots(subject_key, generation) ON DELETE RESTRICT
      );
    `);
  });
}

/** @internal Validates the active ownership fact and returns its durable expiry. */
function acquireWriter(
  database: ISqliteCapability,
  request: { readonly holderId: string; readonly nowMs: number; readonly leaseMs: number },
): IWriterAcquisition {
  validateLeaseRequest(request.holderId, request.nowMs, request.leaseMs);
  return database.transaction(() => {
    const row = requireWriterRow(database);
    const activeHolder = optionalString(row.holder_id);
    const expiresAtMs = requireNumber(row.expires_at_ms, 'expires_at_ms');
    if (activeHolder !== null && expiresAtMs > request.nowMs) {
      return { kind: 'held', holderId: activeHolder, expiresAtMs };
    }

    const fencingToken = nextFence(requireNumber(row.last_fence, 'last_fence'));
    const nextExpiry = leaseExpiry(request.nowMs, request.leaseMs);
    const write = database.prepare(
      'UPDATE writer_state SET last_fence = ?, holder_id = ?, expires_at_ms = ? WHERE id = 1',
    ).run(fencingToken, request.holderId, nextExpiry);
    requireOneChange(write.changes, 'writer acquisition');
    return { kind: 'acquired', fencingToken, expiresAtMs: nextExpiry };
  });
}

/** @internal Renews only a still-live lease so expired work cannot reclaim itself. */
function renewWriter(
  database: ISqliteCapability,
  request: IWriterAuthority & { readonly leaseMs: number },
): IWriterLease {
  validateLeaseRequest(request.holderId, request.nowMs, request.leaseMs);
  return database.transaction(() => {
    assertWriterAuthority(database, request);
    const expiresAtMs = leaseExpiry(request.nowMs, request.leaseMs);
    const write = database.prepare('UPDATE writer_state SET expires_at_ms = ? WHERE id = 1').run(expiresAtMs);
    requireOneChange(write.changes, 'writer renewal');
    return { holderId: request.holderId, fencingToken: request.fencingToken, expiresAtMs };
  });
}

/** @internal Release preserves the fence counter so future holders always advance it. */
function releaseWriter(database: ISqliteCapability, request: IWriterAuthority): void {
  database.transaction(() => {
    assertWriterAuthority(database, request);
    const write = database.prepare('UPDATE writer_state SET holder_id = NULL, expires_at_ms = ? WHERE id = 1')
      .run(request.nowMs);
    requireOneChange(write.changes, 'writer release');
  });
}

/** @internal Allocation consumes its generation in a commit separate from payload and pointer changes. */
function allocateAttempt(
  database: ISqliteCapability,
  request: IWriterAuthority & { readonly attemptKey: string; readonly subjectKey: string },
): IAttempt {
  validateIdentity(request.attemptKey, 'attempt key');
  validateIdentity(request.subjectKey, 'subject key');
  return database.transaction(() => {
    assertWriterAuthority(database, request);
    const previous = database.queryOne('SELECT * FROM attempts WHERE attempt_key = ?', [request.attemptKey]);
    if (previous !== undefined) {
      const attempt = attemptFromRow(previous);
      if (attempt.subjectKey !== request.subjectKey) {
        throw new Error('attempt key is already allocated to another subject');
      }
      return attempt;
    }

    const generationRow = database.queryOne(
      'SELECT last_generation FROM generations WHERE subject_key = ?', [request.subjectKey],
    );
    const generation = generationRow === undefined
      ? 1
      : nextFence(requireNumber(generationRow.last_generation, 'last_generation'));
    const generationWrite = database.prepare(`
      INSERT INTO generations (subject_key, last_generation) VALUES (?, ?)
      ON CONFLICT(subject_key) DO UPDATE SET last_generation = excluded.last_generation
    `).run(request.subjectKey, generation);
    requireOneChange(generationWrite.changes, 'generation allocation');
    const attemptId = `${request.subjectKey}:${generation}`;
    const attemptWrite = database.prepare(`
      INSERT INTO attempts (attempt_id, attempt_key, subject_key, generation, state)
      VALUES (?, ?, ?, ?, 'allocated')
    `).run(attemptId, request.attemptKey, request.subjectKey, generation);
    requireOneChange(attemptWrite.changes, 'attempt allocation');
    return {
      attemptId,
      attemptKey: request.attemptKey,
      subjectKey: request.subjectKey,
      generation,
      state: 'allocated',
      resultReference: null,
    };
  });
}

/** @internal Staging preserves failed work as an attempt but does not make it readable as a result. */
function stageAttempt(
  database: ISqliteCapability,
  request: IWriterAuthority & {
    readonly attemptId: string;
    readonly payloadJson: string;
    readonly fingerprint: string;
    readonly provenanceJson: string;
  },
): void {
  try {
    JSON.parse(request.payloadJson);
    JSON.parse(request.provenanceJson);
  } catch {
    throw new Error('staged payload and provenance must be valid JSON');
  }
  validateIdentity(request.fingerprint, 'fingerprint');
  database.transaction(() => {
    assertWriterAuthority(database, request);
    const attempt = requireAttempt(database, request.attemptId);
    if (attempt.state === 'staged'
      && readStagedValue(database, request.attemptId, 'payload_json') === request.payloadJson
      && readStagedValue(database, request.attemptId, 'fingerprint') === request.fingerprint
      && readStagedValue(database, request.attemptId, 'provenance_json') === request.provenanceJson) {
      return;
    }
    if (attempt.state !== 'allocated') {
      throw new Error(`attempt cannot be staged from state ${attempt.state}`);
    }
    const write = database.prepare(`
      UPDATE attempts
      SET state = 'staged', payload_json = ?, fingerprint = ?, provenance_json = ?
      WHERE attempt_id = ?
    `).run(request.payloadJson, request.fingerprint, request.provenanceJson, request.attemptId);
    requireOneChange(write.changes, 'attempt staging');
  });
}

/** @internal Publication is the linearization point for a completed result and its current selection. */
function publishAttempt(
  database: ISqliteCapability,
  request: IWriterAuthority & { readonly attemptId: string },
): IResultReference {
  return database.transaction(() => {
    assertWriterAuthority(database, request);
    const attempt = requireAttempt(database, request.attemptId);
    if (attempt.state === 'completed' && attempt.resultReference !== null) {
      return attempt.resultReference;
    }
    if (attempt.state !== 'staged') {
      throw new Error(`attempt cannot be published from state ${attempt.state}`);
    }
    const staged = database.queryOne(
      'SELECT payload_json, fingerprint, provenance_json FROM attempts WHERE attempt_id = ?',
      [request.attemptId],
    );
    if (staged === undefined) {
      throw new Error('staged attempt has no payload');
    }
    const payloadJson = requireString(staged.payload_json, 'payload_json');
    const fingerprint = requireString(staged.fingerprint, 'fingerprint');
    const provenanceJson = requireString(staged.provenance_json, 'provenance_json');

    const reference = { subjectKey: attempt.subjectKey, generation: attempt.generation };
    const snapshotWrite = database.prepare(`
      INSERT INTO snapshots
        (subject_key, generation, attempt_id, payload_json, fingerprint, provenance_json)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(attempt.subjectKey, attempt.generation, attempt.attemptId, payloadJson, fingerprint, provenanceJson);
    requireOneChange(snapshotWrite.changes, 'snapshot publication');
    const pointerWrite = database.prepare(`
      INSERT INTO current_pointers (subject_key, generation) VALUES (?, ?)
      ON CONFLICT(subject_key) DO UPDATE SET generation = excluded.generation
    `).run(attempt.subjectKey, attempt.generation);
    requireOneChange(pointerWrite.changes, 'current pointer publication');
    const attemptWrite = database.prepare("UPDATE attempts SET state = 'completed', result_generation = ? WHERE attempt_id = ?")
      .run(attempt.generation, attempt.attemptId);
    requireOneChange(attemptWrite.changes, 'attempt completion');
    return reference;
  });
}

/** @internal Reads the current pointer by joining only committed snapshots. */
function readCurrent(database: ISqliteCapability, subjectKey: string): ICurrentResult | null {
  const row = database.queryOne(`
    SELECT p.subject_key, p.generation, s.payload_json, s.fingerprint, s.provenance_json,
      completed.attempt_id AS completed_attempt_id
    FROM current_pointers AS p
    LEFT JOIN snapshots AS s ON s.subject_key = p.subject_key AND s.generation = p.generation
    LEFT JOIN attempts AS completed ON completed.attempt_id = s.attempt_id
      AND completed.state = 'completed' AND completed.result_generation = s.generation
    WHERE p.subject_key = ?
  `, [subjectKey]);
  if (row === undefined) {
    return null;
  }
  if (row.payload_json === null || row.payload_json === undefined
    || row.fingerprint === null || row.fingerprint === undefined
    || row.provenance_json === null || row.provenance_json === undefined
    || row.completed_attempt_id === null || row.completed_attempt_id === undefined) {
    throw new Error('current pointer references an incomplete result');
  }
  return {
    reference: {
      subjectKey: requireString(row.subject_key, 'subject_key'),
      generation: requireNumber(row.generation, 'generation'),
    },
    payload: parsePayload(requireString(row.payload_json, 'payload_json')),
    fingerprint: requireString(row.fingerprint, 'fingerprint'),
    provenance: parsePayload(requireString(row.provenance_json, 'provenance_json')),
  };
}

/** @internal Exact-reference reads never substitute the current pointer. */
function readResult(database: ISqliteCapability, reference: IResultReference): ICurrentResult | null {
  const row = database.queryOne(
    `SELECT s.payload_json, s.fingerprint, s.provenance_json,
      completed.attempt_id AS completed_attempt_id
      FROM snapshots AS s
      LEFT JOIN attempts AS completed ON completed.attempt_id = s.attempt_id
        AND completed.state = 'completed' AND completed.result_generation = s.generation
      WHERE s.subject_key = ? AND s.generation = ?`,
    [reference.subjectKey, reference.generation],
  );
  if (row === undefined) {
    return null;
  }
  if (row.completed_attempt_id === null || row.completed_attempt_id === undefined) {
    throw new Error('result reference points to an incomplete snapshot');
  }
  return {
    reference,
    payload: parsePayload(requireString(row.payload_json, 'payload_json')),
    fingerprint: requireString(row.fingerprint, 'fingerprint'),
    provenance: parsePayload(requireString(row.provenance_json, 'provenance_json')),
  };
}

/** @internal Attempts are inspectable independently of result retention and current selection. */
function readAttempt(database: ISqliteCapability, attemptId: string): IAttempt | null {
  const row = database.queryOne('SELECT * FROM attempts WHERE attempt_id = ?', [attemptId]);
  return row === undefined ? null : attemptFromRow(row);
}

/** @internal The idempotency key is a recovery locator, not authority to execute or publish. */
function findAttempt(database: ISqliteCapability, attemptKey: string): IAttempt | null {
  const row = database.queryOne('SELECT * FROM attempts WHERE attempt_key = ?', [attemptKey]);
  return row === undefined ? null : attemptFromRow(row);
}

/** @internal Read-only lease inspection supports state traces without conferring a fence. */
function currentWriter(database: ISqliteCapability): IWriterLease | null {
  const row = requireWriterRow(database);
  const holderId = optionalString(row.holder_id);
  if (holderId === null) {
    return null;
  }
  return {
    holderId,
    fencingToken: requireNumber(row.last_fence, 'last_fence'),
    expiresAtMs: requireNumber(row.expires_at_ms, 'expires_at_ms'),
  };
}

/** @internal Rejects every holder mutation whose persisted token or lease no longer matches. */
function assertWriterAuthority(database: ISqliteCapability, authority: IWriterAuthority): ISqliteRow {
  validateIdentity(authority.holderId, 'holder id');
  if (!Number.isSafeInteger(authority.nowMs) || authority.nowMs < 0) {
    throw new Error('writer operation time must be a nonnegative safe integer');
  }
  const row = requireWriterRow(database);
  if (optionalString(row.holder_id) !== authority.holderId
    || requireNumber(row.last_fence, 'last_fence') !== authority.fencingToken
    || requireNumber(row.expires_at_ms, 'expires_at_ms') <= authority.nowMs) {
    throw new Error('stale writer fence');
  }
  return row;
}

/** @internal All fixture writes use one durable writer row and a monotonically increasing token. */
function requireWriterRow(database: ISqliteCapability): ISqliteRow {
  const row = database.queryOne('SELECT * FROM writer_state WHERE id = 1');
  if (row === undefined) {
    throw new Error('publication repository is not initialized');
  }
  return row;
}

/** @internal Attempt lookup rejects unknown identifiers rather than creating implicit history. */
function requireAttempt(database: ISqliteCapability, attemptId: string): IAttempt {
  const attempt = readAttempt(database, attemptId);
  if (attempt === null) {
    throw new Error('unknown attempt');
  }
  return attempt;
}

/** @internal Returns persisted candidate bytes without exposing incomplete data as a result. */
function readStagedValue(
  database: ISqliteCapability,
  attemptId: string,
  column: 'payload_json' | 'fingerprint' | 'provenance_json',
): string | null {
  const row = database.queryOne(`SELECT ${column} FROM attempts WHERE attempt_id = ?`, [attemptId]);
  if (row === undefined) {
    return null;
  }
  const payload = row[column];
  if (payload === null || payload === undefined) {
    return null;
  }
  return requireString(payload, column);
}

/** @internal Converts a database row into the fixture's closed state vocabulary. */
function attemptFromRow(row: ISqliteRow): IAttempt {
  const state = requireString(row.state, 'state');
  if (state !== 'allocated' && state !== 'staged' && state !== 'completed') {
    throw new Error(`unknown attempt state: ${state}`);
  }
  const subjectKey = requireString(row.subject_key, 'subject_key');
  const generation = requireNumber(row.generation, 'generation');
  const resultGeneration = row.result_generation;
  const attemptId = requireString(row.attempt_id, 'attempt_id');
  const resultReference = resultGeneration === null || resultGeneration === undefined
    ? null
    : { subjectKey, generation: requireNumber(resultGeneration, 'result_generation') };
  if (state === 'completed' && resultReference?.generation !== generation) {
    throw new Error('completed attempt has an inconsistent result reference');
  }
  if (state !== 'completed' && resultReference !== null) {
    throw new Error('incomplete attempt carries a completed result reference');
  }
  return {
    attemptId,
    attemptKey: requireString(row.attempt_key, 'attempt_key'),
    subjectKey,
    generation,
    state,
    resultReference,
  };
}

/** @internal Parses only complete stored JSON values, preserving explicit JSON null. */
function parsePayload(payloadJson: string): unknown {
  return JSON.parse(payloadJson);
}

/** @internal Rejects empty or non-integral lease inputs before they enter durable state. */
function validateLeaseRequest(holderId: string, nowMs: number, leaseMs: number): void {
  validateIdentity(holderId, 'holder id');
  if (!Number.isSafeInteger(nowMs) || nowMs < 0 || !Number.isSafeInteger(leaseMs) || leaseMs <= 0) {
    throw new Error('lease times must be nonnegative safe integers with a positive duration');
  }
  leaseExpiry(nowMs, leaseMs);
}

/** @internal Rejects identifiers and expiry times that JavaScript cannot represent exactly. */
function nextFence(current: number): number {
  const next = current + 1;
  if (!Number.isSafeInteger(next)) {
    throw new Error('fencing token or generation exhausted safe integer range');
  }
  return next;
}

/** @internal Ensures the persisted lease boundary remains an exact integer. */
function leaseExpiry(nowMs: number, leaseMs: number): number {
  const expiresAtMs = nowMs + leaseMs;
  if (!Number.isSafeInteger(expiresAtMs)) {
    throw new Error('lease expiry exceeds safe integer range');
  }
  return expiresAtMs;
}

/** @internal Missing an expected row means the transaction cannot claim its transition succeeded. */
function requireOneChange(changes: number, transition: string): void {
  if (changes !== 1) {
    throw new Error(`${transition} changed ${changes} rows instead of one`);
  }
}

/** @internal Prevents empty identifiers from collapsing unrelated fixture records. */
function validateIdentity(value: string, name: string): void {
  if (value.length === 0) {
    throw new Error(`${name} must not be empty`);
  }
}

/** @internal Requires a row field to be text instead of relying on SQLite coercion. */
function requireString(value: unknown, name: string): string {
  if (typeof value !== 'string') {
    throw new Error(`invalid ${name} in SQLite row`);
  }
  return value;
}

/** @internal Requires an integral row field before using it as a generation or fence. */
function requireNumber(value: unknown, name: string): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value)) {
    throw new Error(`invalid ${name} in SQLite row`);
  }
  return value;
}

/** @internal Maps SQL nullability into one unambiguous writer identity. */
function optionalString(value: unknown): string | null {
  return value === null || value === undefined ? null : requireString(value, 'holder_id');
}
