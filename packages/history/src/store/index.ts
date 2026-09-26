import type { Fingerprint, GenerationState, Identity, Path, RecordedRead, ResultKey, Subject } from '../types.js';

/** Persisted format identifiers, checked before using a store's fingerprints. @public */
export interface StoreMetadata {
  schemaVersion: number;
  fingerprintAlgorithm: string;
}

/**
 * One compare-and-set row per complete result key. Repository owns generation
 * meaning; claim owns lease meaning. Storage only preserves and patches columns.
 * @public
 */
export interface SubjectRow {
  key: ResultKey;
  subject: Subject;
  /** Nonnegative safe-integer CAS token, incremented once per successful CAS. */
  version: number;
  currentGeneration: number | null;
  claim: null | {
    generation: number;
    holder: string;
    leaseUntil: number;
    progress: { fingerprint: Fingerprint; value: unknown } | null;
  };
  durations: number[];
}

/** A retained attempt, with lifecycle and numbering supplied by its caller. @public */
export interface GenerationRow {
  key: ResultKey;
  generation: number;
  state: GenerationState;
  reads: RecordedRead[];
  identity: Identity | undefined;
  startedAt: number;
  endedAt: number | null;
  cost: Record<string, number>;
  arrival: string;
  abandonReason?: 'error' | 'lease-expired' | 'refused';
  error?: { message: string; stack?: string };
}

/** An immutable value node and its caller-computed fingerprint. @public */
export interface FieldRow {
  key: ResultKey;
  generation: number;
  path: Path;
  fingerprint: Fingerprint;
  value: unknown;
}

/** Writable subject columns; the complete key and CAS token cannot be patched. @public */
export type SubjectPatch = Partial<Omit<SubjectRow, 'key' | 'version'>>;

/** Writable generation columns; tuple identity cannot change after insertion. @public */
export type GenerationPatch = Partial<Omit<GenerationRow, 'key' | 'generation'>>;

/**
 * Storage mechanism for independent rows, with linearizable subject CAS.
 * All inputs and returned rows are detached snapshots: caller mutation cannot
 * alter persisted data. Values may only change by inserting another generation.
 * There is no transaction spanning these methods; callers must not infer atomic
 * claim/generation publication from the per-row CAS guarantee.
 * @public
 */
export interface Store {
  /** Return detached format metadata; opening code must reject algorithm mismatches. */
  meta(): Promise<StoreMetadata>;

  /** Read a detached subject snapshot, or undefined for an absent tuple. */
  getSubject(key: ResultKey): Promise<SubjectRow | undefined>;

  /** Insert only; duplicate tuples reject, as do versions outside safe integers. */
  putSubject(row: SubjectRow): Promise<void>;

  /**
   * Atomically apply a shallow column patch only when the stored version matches.
   * Success increments that version once, even for an empty patch; a missing or
   * stale row returns false without changes. Key/version properties reject at
   * runtime, including extras passed from untyped JavaScript callers.
   * An exhausted MAX_SAFE_INTEGER version rejects rather than reporting success
   * without advancing the token. Neither rejection changes the stored row.
   */
  casSubject(key: ResultKey, expectedVersion: number, patch: SubjectPatch): Promise<boolean>;

  /** Read a detached generation, or undefined for an absent tuple. */
  getGeneration(key: ResultKey, generation: number): Promise<GenerationRow | undefined>;

  /** Return detached rows for exactly this complete key; ordering is unspecified. */
  listGenerations(key: ResultKey): Promise<GenerationRow[]>;

  /** Insert only; generation numbers are supplied, never allocated by storage. */
  putGeneration(row: GenerationRow): Promise<void>;

  /** Patch an existing row; missing tuples and attempts to change its key reject. */
  updateGeneration(key: ResultKey, generation: number, patch: GenerationPatch): Promise<void>;

  /**
   * Insert an atomic batch of immutable fields. Duplicate addresses, within the
   * batch or already stored, reject the whole batch without inserting anything.
   * This proposed storage refinement enforces retained-value immutability.
   */
  putFields(rows: FieldRow[]): Promise<void>;

  /** Return requested field snapshots; absent paths are omitted. */
  getFields(key: ResultKey, generation: number, paths: Path[]): Promise<FieldRow[]>;

  /** Return requested fingerprints without reading/deserializing any field value. */
  getFingerprints(key: ResultKey, generation: number, paths: Path[]): Promise<Map<Path, Fingerprint>>;

  /**
   * Query leases strictly less than now, oldest first, with at most limit rows.
   * Zero limit returns no rows. This query never sweeps or changes a claim.
   */
  expiredClaims(now: number, limit: number): Promise<SubjectRow[]>;

  /** Release resources owned by this store. */
  close(): Promise<void>;
}

/** Insert-only storage encountered an existing complete tuple. @public */
export class DuplicateRowError extends Error {
  /** Identify an insert conflict without modifying the retained row. @public */
  constructor(message = 'A row already exists at this storage address') {
    super(message);
    this.name = 'DuplicateRowError';
  }
}

/** An update targeted a generation that has never been inserted. @public */
export class MissingRowError extends Error {
  /** Identify an absent update target; updates never implicitly insert. @public */
  constructor(message = 'No row exists at this storage address') {
    super(message);
    this.name = 'MissingRowError';
  }
}

/** A patch attempted to modify an immutable address or managed CAS version. @public */
export class InvalidStorePatchError extends Error {
  /** Identify a structurally forbidden patch before any columns are changed. @public */
  constructor(message = 'A storage patch cannot modify its key or managed version') {
    super(message);
    this.name = 'InvalidStorePatchError';
  }
}

/** Stored fingerprints cannot be compared with this runtime's algorithm. @public */
export class FingerprintAlgorithmMismatchError extends Error {
  /** Name both identifiers so migrations are explicit rather than silent misses. @public */
  constructor(storedAlgorithm: string, runtimeAlgorithm: string) {
    super(`Stored fingerprint algorithm ${storedAlgorithm} differs from runtime algorithm ${runtimeAlgorithm}`);
    this.name = 'FingerprintAlgorithmMismatchError';
  }
}
