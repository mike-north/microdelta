/**
 * History's durable SQLite authority: the single consistency owner for
 * attempts, the single logical writer, atomic publication, current pointers,
 * immutable completed results and separate acceptance records (PUB-001–004,
 * RES-002–007, ARC-007). It owns every SQL statement and lifecycle decision
 * over injected Machine capabilities; Node access stays in the host adapter.
 *
 * Transition and recovery outcomes (each row is one IMMEDIATE transaction):
 *
 * | Transition | Durable change | Death before commit | Death after commit |
 * | --- | --- | --- | --- |
 * | acquire | new holder, fence + 1, expiry | no change | lease held until expiry |
 * | allocate | attempt counter + 1, `allocated` attempt with key and intent | identity never issued | identity consumed, no result |
 * | stage | `staged` content and dependencies | attempt stays `allocated` | candidate evidence only, never a result |
 * | publish | result, index, provenance, `completed`, current pointer | attempt stays `staged` | complete result; recover by key |
 * | abandon | `failed`/`interrupted` with evidence | attempt unchanged | attempt ended without result |
 * | accept | acceptance record naming an existing result | no change | record retained; result untouched |
 *
 * It decides no reuse eligibility or freshness and interprets no provenance.
 * This is single-file process-termination scope, not a concurrency, power-loss
 * or distributed-time guarantee.
 * @packageDocumentation
 */
import type { IClockCapability, ISqliteConnection, ISqliteRow } from '@microdelta/machine';
import { decodeSnapshot, encodeSnapshot } from '@microdelta/value';

import type { ICompletedResultReference } from '../completed-results.js';
import type {
  IAbandonRequest,
  IAcceptanceRecord,
  IAcceptanceRequest,
  IAttemptRecord,
  IAttemptRequest,
  IAttemptState,
  ICompletedEnvelope,
  IDurableHistory,
  IDurableHistoryOptions,
  IHistoryScope,
  IRecoveryOutcome,
  IResultVerification,
  IScopedSubject,
  IStageRequest,
  IVersionedRecord,
  IVersionedSubject,
  IWriterAcquisition,
  IWriterAcquisitionRequest,
  IWriterLease,
} from './contracts.js';
import {
  AttemptConflictError,
  AttemptStateError,
  HistoryClockError,
  HistoryIntegrityError,
  StaleWriterError,
} from './errors.js';
import { parseReference, referenceFor } from './locator.js';
import { initializeSchema } from './schema.js';
import { buildIndex, createSelectedIndex, indexVersion } from './selected-index.js';

/** Identity tag for embedded SQL; the text is passed through unchanged. */
const sql = String.raw;

/** The only payload encoding History stores for completed results. */
const payloadEncoding = 'MDS1';

/** One versioned record in its stored canonical form. */
interface IStoredRecord {
  readonly format: string;
  readonly formatVersion: number;
  readonly content: string;
}

/** The durable writer row. */
interface IWriterRow {
  readonly lastFence: number;
  readonly holder: string | null;
  readonly expiresAt: number;
  readonly timeHighWater: number;
}

/** Require a non-empty string argument. */
function requireName(value: unknown, name: string): string {
  if (typeof value !== 'string' || value.length === 0) {
    throw new TypeError(`${name} must be a non-empty string`);
  }
  return value;
}

/** Require a positive safe-integer argument. */
function requirePositive(value: unknown, name: string): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value <= 0) {
    throw new TypeError(`${name} must be a positive safe integer`);
  }
  return value;
}

/** Require a nonnegative safe-integer argument. */
function requireNonnegative(value: unknown, name: string): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0) {
    throw new TypeError(`${name} must be a nonnegative safe integer`);
  }
  return value;
}

/** Add two safe integers or fail rather than round. */
function safeSum(left: number, right: number, name: string): number {
  const sum = left + right;
  if (!Number.isSafeInteger(sum)) {
    throw new RangeError(`${name} exceeds the safe integer range`);
  }
  return sum;
}

/** Copy and validate a scoped subject argument. */
function scopedSubject(value: IScopedSubject): IScopedSubject {
  return { analysis: requireName(value.analysis, 'analysis'), environment: requireName(value.environment, 'environment'), subject: requireName(value.subject, 'subject') };
}

/** Copy and validate a versioned subject argument. */
function versionedSubject(value: IVersionedSubject): IVersionedSubject {
  return { ...scopedSubject(value), version: requirePositive(value.version, 'version') };
}

/** Copy and validate an attempt request. */
function attemptRequest(value: IAttemptRequest): IAttemptRequest {
  return { ...versionedSubject(value), attemptKey: requireName(value.attemptKey, 'attemptKey'), intentDigest: requireName(value.intentDigest, 'intentDigest') };
}

/** Validate a presented lease's shape; authority is checked against storage separately. */
function leaseArgument(lease: IWriterLease): IWriterLease {
  return { holder: requireName(lease.holder, 'lease holder'), fence: requirePositive(lease.fence, 'lease fence'), expiresAt: requireNonnegative(lease.expiresAt, 'lease expiry') };
}

/** Validate and canonicalize an owner-defined versioned record. */
function storeRecord(record: IVersionedRecord, name: string): IStoredRecord {
  return {
    format: requireName(record.format, `${name} format`),
    formatVersion: requirePositive(record.formatVersion, `${name} format version`),
    content: encodeSnapshot(record.content),
  };
}

/** Decode a stored versioned record into frozen data, or fail as corruption. */
function loadRecord(format: unknown, formatVersion: unknown, content: unknown, name: string): IVersionedRecord {
  if (typeof format !== 'string' || format.length === 0 || typeof formatVersion !== 'number' || !Number.isSafeInteger(formatVersion) || formatVersion <= 0 || typeof content !== 'string') {
    throw new HistoryIntegrityError(`Stored ${name} has a malformed version tag`);
  }
  let decoded: unknown;
  try {
    decoded = decodeSnapshot(content);
  } catch (error: unknown) {
    throw new HistoryIntegrityError(`Stored ${name} is not canonical MDS1: ${error instanceof Error ? error.message : String(error)}`);
  }
  return Object.freeze({ format, formatVersion, content: decoded });
}

/** Narrow a stored cell to text. */
function text(row: ISqliteRow, column: string): string {
  const value = row[column];
  if (typeof value !== 'string') {
    throw new HistoryIntegrityError(`Stored History column ${column} is not text`);
  }
  return value;
}

/** Narrow a stored cell to a safe integer. */
function integer(row: ISqliteRow, column: string): number {
  const value = row[column];
  if (typeof value !== 'number' || !Number.isSafeInteger(value)) {
    throw new HistoryIntegrityError(`Stored History column ${column} is not an integer`);
  }
  return value;
}

/** Narrow a stored attempt state. */
function attemptState(row: ISqliteRow): IAttemptState {
  const state = text(row, 'state');
  if (state !== 'allocated' && state !== 'staged' && state !== 'completed' && state !== 'failed' && state !== 'interrupted') {
    throw new HistoryIntegrityError(`Unsupported stored attempt state ${state}`);
  }
  return state;
}

/**
 * Open (creating when empty) the durable History store for one logical store.
 * The file is rejected before any work unless it is empty or holds exactly
 * this schema version for this logical store.
 * @alpha
 */
export function openDurableHistory(options: IDurableHistoryOptions): IDurableHistory {
  const logicalStore = requireName(options.logicalStore, 'logicalStore');
  const clock: IClockCapability = options.clock;
  const connection: ISqliteConnection = options.sqlite.openSqlite(options.location);
  try {
    initializeSchema(connection, logicalStore);
  } catch (error: unknown) {
    connection.close();
    throw error;
  }

  const statements = {
    writer: connection.prepare(sql`/* writer */ SELECT last_fence, holder, expires_at, time_high_water FROM history_writer WHERE singleton = 1`),
    observeTime: connection.prepare(sql`/* writer */ UPDATE history_writer SET time_high_water = ? WHERE singleton = 1`),
    setHolder: connection.prepare(sql`/* writer */ UPDATE history_writer SET last_fence = ?, holder = ?, expires_at = ? WHERE singleton = 1`),
    sequences: connection.prepare(sql`/* sequence */ SELECT last_attempt, last_publication, last_acceptance FROM history_sequences WHERE singleton = 1`),
    setAttemptSequence: connection.prepare(sql`/* allocate */ UPDATE history_sequences SET last_attempt = ? WHERE singleton = 1`),
    setPublicationSequence: connection.prepare(sql`/* publish */ UPDATE history_sequences SET last_publication = ? WHERE singleton = 1`),
    setAcceptanceSequence: connection.prepare(sql`/* accept */ UPDATE history_sequences SET last_acceptance = ? WHERE singleton = 1`),
    attemptByKey: connection.prepare(sql`/* attempt */ SELECT * FROM history_attempts WHERE analysis = ? AND environment = ? AND subject = ? AND attempt_key = ?`),
    attemptById: connection.prepare(sql`/* attempt */ SELECT * FROM history_attempts WHERE attempt_id = ?`),
    insertAttempt: connection.prepare(sql`/* allocate */ INSERT INTO history_attempts
      (attempt_id, analysis, environment, subject, version, attempt_key, intent_digest, state, allocated_fence)
      VALUES (?, ?, ?, ?, ?, ?, ?, 'allocated', ?)`),
    stageAttempt: connection.prepare(sql`/* stage */ UPDATE history_attempts
      SET state = 'staged', staged_payload = ?, staged_provenance_format = ?, staged_provenance_version = ?, staged_provenance = ?
      WHERE attempt_id = ? AND state = 'allocated'`),
    insertDependency: connection.prepare(sql`/* stage */ INSERT INTO history_dependencies (attempt_id, position, dependency_id) VALUES (?, ?, ?)`),
    insertResult: connection.prepare(sql`/* publish */ INSERT INTO history_results
      (result_id, analysis, environment, subject, version, publication, published_fence, encoding, index_version, payload, provenance_format, provenance_version, provenance)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`),
    completeAttempt: connection.prepare(sql`/* publish */ UPDATE history_attempts
      SET state = 'completed', ended_fence = ?, staged_payload = NULL, staged_provenance_format = NULL, staged_provenance_version = NULL, staged_provenance = NULL
      WHERE attempt_id = ? AND state = 'staged'`),
    setCurrent: connection.prepare(sql`/* publish */ INSERT INTO history_current (analysis, environment, subject, result_id) VALUES (?, ?, ?, ?)
      ON CONFLICT (analysis, environment, subject) DO UPDATE SET result_id = excluded.result_id`),
    abandonAttempt: connection.prepare(sql`/* abandon */ UPDATE history_attempts
      SET state = ?, ended_fence = ?, outcome_format = ?, outcome_version = ?, outcome = ?
      WHERE attempt_id = ? AND state IN ('allocated', 'staged')`),
    reference: connection.prepare(sql`/* reference */ SELECT r.result_id, r.analysis, r.environment, r.encoding, r.index_version, a.state
      FROM history_results r LEFT JOIN history_attempts a ON a.attempt_id = r.result_id WHERE r.result_id = ?`),
    envelope: connection.prepare(sql`/* envelope */ SELECT result_id, analysis, environment, subject, version, publication, encoding, index_version,
      provenance_format, provenance_version, provenance FROM history_results WHERE result_id = ?`),
    candidates: connection.prepare(sql`/* candidates */ SELECT result_id, analysis, environment, subject, version, publication, encoding, index_version,
      provenance_format, provenance_version, provenance FROM history_results
      WHERE analysis = ? AND environment = ? AND subject = ? AND version = ? ORDER BY publication DESC`),
    dependencies: connection.prepare(sql`/* envelope */ SELECT d.position, d.dependency_id, r.result_id AS present, r.analysis, r.environment
      FROM history_dependencies d LEFT JOIN history_results r ON r.result_id = d.dependency_id WHERE d.attempt_id = ? ORDER BY d.position`),
    current: connection.prepare(sql`/* current */ SELECT c.result_id, r.result_id AS present
      FROM history_current c LEFT JOIN history_results r ON r.result_id = c.result_id AND r.analysis = c.analysis AND r.environment = c.environment AND r.subject = c.subject
      WHERE c.analysis = ? AND c.environment = ? AND c.subject = ?`),
    insertAcceptance: connection.prepare(sql`/* accept */ INSERT INTO history_acceptances (acceptance_id, result_id, fence, evidence_format, evidence_version, evidence) VALUES (?, ?, ?, ?, ?, ?)`),
    insertAcceptanceDependency: connection.prepare(sql`/* accept */ INSERT INTO history_acceptance_dependencies (acceptance_id, position, dependency_id) VALUES (?, ?, ?)`),
    acceptances: connection.prepare(sql`/* acceptance */ SELECT acceptance_id, fence, evidence_format, evidence_version, evidence FROM history_acceptances WHERE result_id = ? ORDER BY acceptance_id`),
    acceptanceDependencies: connection.prepare(sql`/* acceptance */ SELECT d.position, d.dependency_id, r.result_id AS present, r.analysis, r.environment
      FROM history_acceptance_dependencies d LEFT JOIN history_results r ON r.result_id = d.dependency_id WHERE d.acceptance_id = ? ORDER BY d.position`),
  };

  /**
   * Resolve an exact reference to a completed result of this store: the
   * locator grammar, logical store, analysis, environment, existence,
   * completion and stored encoding must all match. Any mismatch is an
   * integrity failure; the current pointer is never consulted.
   */
  function resolveResult(reference: ICompletedResultReference, expectedScope?: IHistoryScope): { readonly resultId: number; readonly scope: IHistoryScope } {
    const parts = parseReference(reference);
    if (parts.logicalStore !== logicalStore) {
      throw new HistoryIntegrityError('Completed-result reference belongs to a different logical store');
    }
    if (expectedScope !== undefined && (parts.analysis !== expectedScope.analysis || parts.environment !== expectedScope.environment)) {
      throw new HistoryIntegrityError('Completed-result reference belongs to a different analysis or environment');
    }
    const row = statements.reference.get(parts.resultId);
    if (row === undefined) {
      throw new HistoryIntegrityError(`Missing exact completed result ${reference.locator}`);
    }
    if (row.analysis !== parts.analysis || row.environment !== parts.environment) {
      throw new HistoryIntegrityError('Completed-result reference scope does not match the stored result');
    }
    if (row.encoding !== payloadEncoding || row.index_version !== indexVersion) {
      throw new HistoryIntegrityError(`Stored result uses unsupported encoding ${String(row.encoding)} or index version ${String(row.index_version)}`);
    }
    if (row.state !== 'completed') {
      throw new HistoryIntegrityError('Stored result is not backed by a completed attempt');
    }
    return { resultId: parts.resultId, scope: { analysis: parts.analysis, environment: parts.environment } };
  }

  const index = createSelectedIndex(connection, options.sha256, (reference) => resolveResult(reference).resultId);

  /** Issue the exact reference for a stored result row. */
  function referenceOf(resultId: number, scope: IHistoryScope): ICompletedResultReference {
    return referenceFor({ logicalStore, analysis: scope.analysis, environment: scope.environment, resultId });
  }

  /** Read the singleton writer row. */
  function readWriter(): IWriterRow {
    const row = statements.writer.get();
    if (row === undefined) {
      throw new HistoryIntegrityError('History writer row is missing');
    }
    const holder = row.holder;
    if (holder !== null && typeof holder !== 'string') {
      throw new HistoryIntegrityError('Stored writer holder is malformed');
    }
    return { lastFence: integer(row, 'last_fence'), holder: holder ?? null, expiresAt: integer(row, 'expires_at'), timeHighWater: integer(row, 'time_high_water') };
  }

  /**
   * Evaluate "now" for a holder operation inside its transaction: the larger
   * of a valid host reading and the persisted high-water, which is then
   * persisted. A host failure or invalid reading aborts the transaction.
   */
  function observeTime(writer: IWriterRow): number {
    const reading = clock.currentEpochMilliseconds();
    if (!Number.isSafeInteger(reading) || reading < 0) {
      throw new HistoryClockError(`Clock reading ${String(reading)} is not a nonnegative safe integer of epoch milliseconds`);
    }
    const now = Math.max(reading, writer.timeHighWater);
    if (now !== writer.timeHighWater) {
      statements.observeTime.run(now);
    }
    return now;
  }

  /**
   * Run one ownership-sensitive mutation. Inside one transaction the time is
   * observed and holder, fence and unexpired lease are checked before
   * `operation` runs. A stale lease commits only the time observation and then
   * fails with {@link StaleWriterError}; any other failure rolls everything back.
   */
  function asHolder<T>(presented: IWriterLease, operation: (now: number) => T): T {
    const lease = leaseArgument(presented);
    let outcome: { readonly value: T } | undefined;
    let stale: string | undefined;
    connection.transaction(() => {
      const writer = readWriter();
      const now = observeTime(writer);
      if (writer.holder !== lease.holder || writer.lastFence !== lease.fence) {
        stale = `Writer lease ${lease.holder}/${String(lease.fence)} is not the current holder`;
      } else if (writer.expiresAt <= now) {
        stale = `Writer lease ${lease.holder}/${String(lease.fence)} expired at ${String(writer.expiresAt)}`;
      } else {
        outcome = { value: operation(now) };
      }
      return undefined;
    });
    if (outcome === undefined) {
      throw new StaleWriterError(stale ?? 'Writer lease is not current');
    }
    return outcome.value;
  }

  /** Read one attempt row by identity inside the caller's transaction. */
  function requireAttemptRow(attemptId: number): ISqliteRow {
    const row = statements.attemptById.get(attemptId);
    if (row === undefined) {
      throw new AttemptStateError(`Unknown attempt ${String(attemptId)}`);
    }
    return row;
  }

  /** Convert a stored attempt row to its frozen record. */
  function attemptOf(row: ISqliteRow): IAttemptRecord {
    const scope = { analysis: text(row, 'analysis'), environment: text(row, 'environment') };
    const attemptId = integer(row, 'attempt_id');
    const state = attemptState(row);
    const endedFence = row.ended_fence === null ? null : integer(row, 'ended_fence');
    const outcome = row.outcome === null ? null : loadRecord(row.outcome_format, row.outcome_version, row.outcome, 'attempt outcome');
    return Object.freeze({
      ...scope,
      subject: text(row, 'subject'),
      version: integer(row, 'version'),
      attemptKey: text(row, 'attempt_key'),
      intentDigest: text(row, 'intent_digest'),
      attemptId,
      state,
      allocatedFence: integer(row, 'allocated_fence'),
      endedFence,
      result: state === 'completed' ? referenceOf(attemptId, scope) : null,
      outcome,
    });
  }

  /**
   * Read an attempt's or acceptance's dependency rows and verify each still
   * names a stored result in the same scope, in contiguous recorded order.
   */
  function dependenciesOf(rows: readonly ISqliteRow[], scope: IHistoryScope): readonly ICompletedResultReference[] {
    return Object.freeze(rows.map((row, position) => {
      if (integer(row, 'position') !== position) {
        throw new HistoryIntegrityError('Stored dependencies are not in contiguous order');
      }
      const dependencyId = integer(row, 'dependency_id');
      if (row.present === null) {
        throw new HistoryIntegrityError(`Stored dependency on result ${String(dependencyId)} is dangling`);
      }
      if (row.analysis !== scope.analysis || row.environment !== scope.environment) {
        throw new HistoryIntegrityError(`Stored dependency on result ${String(dependencyId)} is outside the dependent's scope`);
      }
      // A returned dependency must satisfy the same exact contract as any reference: completed, in scope, supported.
      const reference = referenceOf(dependencyId, scope);
      resolveResult(reference, scope);
      return reference;
    }));
  }

  /** Convert a stored result row to its frozen envelope, verifying its metadata. */
  function envelopeOf(row: ISqliteRow): ICompletedEnvelope {
    const resultId = integer(row, 'result_id');
    const scope = { analysis: text(row, 'analysis'), environment: text(row, 'environment') };
    // Candidate and exact metadata are authoritative only for a result that
    // resolves exactly: a completed producing attempt, in scope, supported encoding.
    resolveResult(referenceOf(resultId, scope), scope);
    return Object.freeze({
      ...scope,
      subject: text(row, 'subject'),
      version: integer(row, 'version'),
      reference: referenceOf(resultId, scope),
      attemptId: resultId,
      publication: integer(row, 'publication'),
      encoding: payloadEncoding,
      provenance: loadRecord(row.provenance_format, row.provenance_version, row.provenance, 'provenance'),
      dependencies: dependenciesOf(statements.dependencies.all(resultId), scope),
    });
  }

  /** Resolve each dependency reference to a stored result in `scope`, inside the caller's transaction. */
  function dependencyIds(references: readonly ICompletedResultReference[], scope: IHistoryScope): readonly number[] {
    return references.map((reference) => resolveResult(reference, scope).resultId);
  }

  /**
   * Every path that reports an attempt's durable outcome to a caller
   * (re-allocation of an existing key, re-publication, recovery), and every
   * lifecycle transition (stage, publish, abandon) before it changes anything,
   * first checks the attempt against stored results. A completed attempt's exact result must
   * resolve; an attempt recorded as not completed must have no result row.
   * Either contradiction is an integrity failure, never a success and never
   * presented as incomplete work that a caller might resume.
   */
  function verifiedAttempt(attempt: IAttemptRecord): IAttemptRecord {
    if (attempt.result !== null) {
      resolveResult(attempt.result, attempt);
    } else if (statements.reference.get(attempt.attemptId) !== undefined) {
      throw new HistoryIntegrityError(`Attempt ${String(attempt.attemptId)} is recorded as ${attempt.state} but has a published result`);
    }
    return attempt;
  }

  /** Recovery view of one attempt record. */
  function recoveryOf(attempt: IAttemptRecord): IRecoveryOutcome {
    switch (attempt.state) {
      case 'allocated':
      case 'staged':
        return Object.freeze({ kind: 'incomplete', attempt });
      case 'failed':
      case 'interrupted':
        return Object.freeze({ kind: 'unsuccessful', attempt });
      case 'completed':
        if (attempt.result === null) {
          throw new HistoryIntegrityError('Completed attempt has no result reference');
        }
        return Object.freeze({ kind: 'completed', attempt, reference: attempt.result });
      default: {
        const exhaustive: never = attempt.state;
        return exhaustive;
      }
    }
  }

  /** Reject a stored attempt whose identity differs from the request that names its key. */
  function assertSameExecution(attempt: IAttemptRecord, request: IAttemptRequest): void {
    if (attempt.intentDigest !== request.intentDigest || attempt.version !== request.version) {
      throw new AttemptConflictError(`Attempt key ${request.attemptKey} already identifies a different execution intent or version`);
    }
  }

  /** Read and convert one acceptance record's dependencies. */
  function acceptanceOf(row: ISqliteRow, reference: ICompletedResultReference, scope: IHistoryScope): IAcceptanceRecord {
    const acceptanceId = integer(row, 'acceptance_id');
    return Object.freeze({
      acceptanceId,
      reference,
      fence: integer(row, 'fence'),
      evidence: loadRecord(row.evidence_format, row.evidence_version, row.evidence, 'acceptance evidence'),
      dependencies: dependenciesOf(statements.acceptanceDependencies.all(acceptanceId), scope),
    });
  }

  /** Read the store-wide sequence row. */
  function readSequences(): { readonly lastAttempt: number; readonly lastPublication: number; readonly lastAcceptance: number } {
    const row = statements.sequences.get();
    if (row === undefined) {
      throw new HistoryIntegrityError('History sequence row is missing');
    }
    return { lastAttempt: integer(row, 'last_attempt'), lastPublication: integer(row, 'last_publication'), lastAcceptance: integer(row, 'last_acceptance') };
  }

  const history: IDurableHistory = {
    logicalStore,
    reader: index.reader,

    acquireWriter(request: IWriterAcquisitionRequest): IWriterAcquisition {
      const holder = requireName(request.holder, 'holder');
      const leaseMilliseconds = requirePositive(request.leaseMilliseconds, 'leaseMilliseconds');
      let acquisition: IWriterAcquisition | undefined;
      connection.transaction(() => {
        const writer = readWriter();
        const now = observeTime(writer);
        if (writer.holder !== null && writer.expiresAt > now) {
          acquisition = Object.freeze({ kind: 'held', holder: writer.holder, expiresAt: writer.expiresAt });
          return undefined;
        }
        const fence = safeSum(writer.lastFence, 1, 'writer fence');
        const expiresAt = safeSum(now, leaseMilliseconds, 'lease expiry');
        statements.setHolder.run(fence, holder, expiresAt);
        acquisition = Object.freeze({ kind: 'acquired', lease: Object.freeze({ holder, fence, expiresAt }) });
        return undefined;
      });
      if (acquisition === undefined) {
        throw new HistoryIntegrityError('Writer acquisition produced no outcome');
      }
      return acquisition;
    },

    renewWriter(lease: IWriterLease, leaseMilliseconds: number): IWriterLease {
      const duration = requirePositive(leaseMilliseconds, 'leaseMilliseconds');
      return asHolder(lease, (now) => {
        const expiresAt = safeSum(now, duration, 'lease expiry');
        statements.setHolder.run(lease.fence, lease.holder, expiresAt);
        return Object.freeze({ holder: lease.holder, fence: lease.fence, expiresAt });
      });
    },

    releaseWriter(lease: IWriterLease): void {
      asHolder(lease, (now) => {
        // Release clears the holder but never resets the fence counter.
        statements.setHolder.run(lease.fence, null, now);
      });
    },

    currentWriter(): IWriterLease | undefined {
      const writer = readWriter();
      return writer.holder === null ? undefined : Object.freeze({ holder: writer.holder, fence: writer.lastFence, expiresAt: writer.expiresAt });
    },

    allocateAttempt(lease: IWriterLease, presented: IAttemptRequest): IAttemptRecord {
      const request = attemptRequest(presented);
      return asHolder(lease, () => {
        const existing = statements.attemptByKey.get(request.analysis, request.environment, request.subject, request.attemptKey);
        if (existing !== undefined) {
          const attempt = attemptOf(existing);
          assertSameExecution(attempt, request);
          return verifiedAttempt(attempt);
        }
        const attemptId = safeSum(readSequences().lastAttempt, 1, 'attempt identity');
        statements.setAttemptSequence.run(attemptId);
        statements.insertAttempt.run(attemptId, request.analysis, request.environment, request.subject, request.version, request.attemptKey, request.intentDigest, lease.fence);
        return attemptOf(requireAttemptRow(attemptId));
      });
    },

    stageAttempt(lease: IWriterLease, request: IStageRequest): IAttemptRecord {
      const attemptId = requirePositive(request.attemptId, 'attemptId');
      const payload = encodeSnapshot(request.payload);
      const root = decodeSnapshot(payload);
      if (root === null || typeof root !== 'object') {
        throw new TypeError('A completed result payload needs a record or array root');
      }
      const provenance = storeRecord(request.provenance, 'provenance');
      const references = [...request.dependencies];
      return asHolder(lease, () => {
        const attempt = verifiedAttempt(attemptOf(requireAttemptRow(attemptId)));
        if (attempt.state !== 'allocated') {
          throw new AttemptStateError(`Attempt ${String(attemptId)} cannot be staged from state ${attempt.state}`);
        }
        const dependencies = dependencyIds(references, attempt);
        statements.stageAttempt.run(payload, provenance.format, provenance.formatVersion, provenance.content, attemptId);
        dependencies.forEach((dependencyId, position) => {
          statements.insertDependency.run(attemptId, position, dependencyId);
        });
        return attemptOf(requireAttemptRow(attemptId));
      });
    },

    publishAttempt(lease: IWriterLease, presentedId: number): ICompletedResultReference {
      const attemptId = requirePositive(presentedId, 'attemptId');
      return asHolder(lease, () => {
        const row = requireAttemptRow(attemptId);
        const attempt = verifiedAttempt(attemptOf(row));
        if (attempt.state === 'completed') {
          // Already verified above: its exact result resolves, so re-publication acknowledges it.
          if (attempt.result === null) {
            throw new HistoryIntegrityError(`Completed attempt ${String(attemptId)} has no result reference`);
          }
          return attempt.result;
        }
        if (attempt.state !== 'staged') {
          throw new AttemptStateError(`Attempt ${String(attemptId)} cannot be published from state ${attempt.state}`);
        }
        const payload = text(row, 'staged_payload');
        const root = decodeSnapshot(payload);
        if (root === null || typeof root !== 'object') {
          throw new HistoryIntegrityError('Staged payload root is not a container');
        }
        const rows = buildIndex(root, options.sha256);
        const publication = safeSum(readSequences().lastPublication, 1, 'publication sequence');
        statements.setPublicationSequence.run(publication);
        statements.insertResult.run(
          attemptId, attempt.analysis, attempt.environment, attempt.subject, attempt.version, publication, lease.fence,
          payloadEncoding, indexVersion, payload, text(row, 'staged_provenance_format'), integer(row, 'staged_provenance_version'), text(row, 'staged_provenance'),
        );
        index.insert(attemptId, rows);
        if (statements.completeAttempt.run(lease.fence, attemptId).changes !== 1) {
          throw new HistoryIntegrityError(`Attempt ${String(attemptId)} changed state during publication`);
        }
        statements.setCurrent.run(attempt.analysis, attempt.environment, attempt.subject, attemptId);
        return referenceOf(attemptId, attempt);
      });
    },

    abandonAttempt(lease: IWriterLease, request: IAbandonRequest): IAttemptRecord {
      const attemptId = requirePositive(request.attemptId, 'attemptId');
      const outcome: unknown = request.outcome;
      if (outcome !== 'failed' && outcome !== 'interrupted') {
        throw new TypeError('An abandoned attempt outcome must be "failed" or "interrupted"');
      }
      const evidence = storeRecord(request.evidence, 'outcome evidence');
      return asHolder(lease, () => {
        const attempt = verifiedAttempt(attemptOf(requireAttemptRow(attemptId)));
        if (attempt.state !== 'allocated' && attempt.state !== 'staged') {
          throw new AttemptStateError(`Attempt ${String(attemptId)} cannot be abandoned from state ${attempt.state}`);
        }
        statements.abandonAttempt.run(outcome, lease.fence, evidence.format, evidence.formatVersion, evidence.content, attemptId);
        return attemptOf(requireAttemptRow(attemptId));
      });
    },

    recoverAttempt(presented: IAttemptRequest): IRecoveryOutcome {
      const request = attemptRequest(presented);
      const row = statements.attemptByKey.get(request.analysis, request.environment, request.subject, request.attemptKey);
      if (row === undefined) {
        return Object.freeze({ kind: 'absent' });
      }
      const attempt = attemptOf(row);
      assertSameExecution(attempt, request);
      return recoveryOf(verifiedAttempt(attempt));
    },

    findCandidates(presented: IVersionedSubject): readonly ICompletedEnvelope[] {
      const subject = versionedSubject(presented);
      return Object.freeze(statements.candidates.all(subject.analysis, subject.environment, subject.subject, subject.version).map(envelopeOf));
    },

    readCurrent(presented: IScopedSubject): ICompletedResultReference | undefined {
      const subject = scopedSubject(presented);
      const row = statements.current.get(subject.analysis, subject.environment, subject.subject);
      if (row === undefined) {
        return undefined;
      }
      if (row.present === null) {
        throw new HistoryIntegrityError('Current pointer names a missing or wrong-scope result');
      }
      const reference = referenceOf(integer(row, 'result_id'), subject);
      // The latest publication must itself resolve exactly; a corrupted target is never offered as current.
      resolveResult(reference, subject);
      return reference;
    },

    readEnvelope(reference: ICompletedResultReference): ICompletedEnvelope {
      const { resultId } = resolveResult(reference);
      const row = statements.envelope.get(resultId);
      if (row === undefined) {
        throw new HistoryIntegrityError(`Missing exact completed result ${reference.locator}`);
      }
      return envelopeOf(row);
    },

    verifyResult(reference: ICompletedResultReference): IResultVerification {
      const { resultId } = resolveResult(reference);
      return index.verify(resultId);
    },

    recordAcceptance(lease: IWriterLease, request: IAcceptanceRequest): IAcceptanceRecord {
      const evidence = storeRecord(request.evidence, 'acceptance evidence');
      const references = [...request.dependencies];
      return asHolder(lease, () => {
        const { resultId, scope } = resolveResult(request.reference);
        const dependencies = dependencyIds(references, scope);
        const acceptanceId = safeSum(readSequences().lastAcceptance, 1, 'acceptance identity');
        statements.setAcceptanceSequence.run(acceptanceId);
        statements.insertAcceptance.run(acceptanceId, resultId, lease.fence, evidence.format, evidence.formatVersion, evidence.content);
        dependencies.forEach((dependencyId, position) => {
          statements.insertAcceptanceDependency.run(acceptanceId, position, dependencyId);
        });
        const row = statements.acceptances.all(resultId).find((candidate) => candidate.acceptance_id === acceptanceId);
        if (row === undefined) {
          throw new HistoryIntegrityError('Recorded acceptance is not readable');
        }
        return acceptanceOf(row, referenceOf(resultId, scope), scope);
      });
    },

    readAcceptances(reference: ICompletedResultReference): readonly IAcceptanceRecord[] {
      const { resultId, scope } = resolveResult(reference);
      const exact = referenceOf(resultId, scope);
      return Object.freeze(statements.acceptances.all(resultId).map((row) => acceptanceOf(row, exact, scope)));
    },

    close(): void {
      connection.close();
    },
  };
  return Object.freeze(history);
}
