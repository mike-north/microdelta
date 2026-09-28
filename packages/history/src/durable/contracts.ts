/**
 * Contracts of History's durable authority: the one consistency owner for
 * immutable completed results, attempt history, the single logical writer,
 * atomic publication, current pointers and separate acceptance records
 * (PUB-001, ARC-007). These are project-private alpha shapes. They carry
 * Resolution's provenance and evidence as versioned opaque records and never
 * interpret Definition, Tracking or Resolution meaning; deciding whether a
 * result is currently acceptable remains Resolution's responsibility.
 * @packageDocumentation
 */
import type { IClockCapability, ISha256Capability, ISqliteCapability } from '@microdelta/machine';

import type { ICompletedNavigationReader, ICompletedResultReader, ICompletedResultReference } from '../completed-results.js';

/**
 * The analysis and environment that scope every subject, attempt and result
 * within one logical store. The same subject text in another analysis or
 * environment is a different scoped subject (RES-001/002). Both are complete
 * opaque non-empty strings compared by exact equality.
 * @alpha
 */
export interface IHistoryScope {
  /** The analysis whose history this is. */
  readonly analysis: string;
  /** The logical environment within that analysis. */
  readonly environment: string;
}

/**
 * One scoped subject: the author's complete opaque subject string inside its
 * analysis/environment scope. History never derives, prefixes or reinterprets
 * the subject; it identifies a history of work, not one exact result.
 * @alpha
 */
export interface IScopedSubject extends IHistoryScope {
  /** The author's complete subject string, compared by exact string equality. */
  readonly subject: string;
}

/**
 * A scoped subject narrowed to one compatibility group (REUSE-008): a positive
 * safe integer chosen by the author per memoized step. Candidate lookup filters
 * by it before Resolution validates current evidence.
 * @alpha
 */
export interface IVersionedSubject extends IScopedSubject {
  /** The positive safe-integer compatibility group. */
  readonly version: number;
}

/**
 * A versioned record whose meaning another owner defines, such as
 * Resolution's execution provenance, current acceptance evidence or an
 * attempt's failure evidence. History validates only that the format tag is a
 * non-empty string, the format version is a positive safe integer and the
 * content is supported Value data; it stores the content in canonical MDS1
 * form and returns it decoded and frozen, never interpreting it.
 * @alpha
 */
export interface IVersionedRecord {
  /** The owner-defined format identity, for example a Resolution schema name. */
  readonly format: string;
  /** The owner-defined positive safe-integer version of that format. */
  readonly formatVersion: number;
  /** Supported Value data; its meaning belongs to the format's owner. */
  readonly content: unknown;
}

/**
 * Proof of current single-logical-writer ownership. The holder is an opaque
 * caller identity; the fence is the store-wide token issued at acquisition,
 * which only increases; `expiresAt` is the lease boundary in History's
 * clock domain (epoch milliseconds). Presenting a lease authorizes storage
 * mutation only while holder, fence and unexpired lease still match the durable
 * writer state; it never authorizes author execution.
 * @alpha
 */
export interface IWriterLease {
  /** The opaque identity that acquired the lease. */
  readonly holder: string;
  /** The fencing token issued for this acquisition. */
  readonly fence: number;
  /** The first effective time at which the lease is no longer valid. */
  readonly expiresAt: number;
}

/**
 * The outcome of asking for the single logical writer. `held` reports an
 * observed unexpired holder, not a failed compare-and-swap (PUB-005), and
 * grants nothing.
 * @alpha
 */
export type IWriterAcquisition =
  | {
      /** The caller now owns the store's writer lease. */
      readonly kind: 'acquired';
      /** The new lease with its freshly issued fence. */
      readonly lease: IWriterLease;
    }
  | {
      /** Another unexpired holder owns the store. */
      readonly kind: 'held';
      /** The observed holder identity. */
      readonly holder: string;
      /** When that holder's lease expires, in History's clock domain. */
      readonly expiresAt: number;
    };

/** A request for the writer lease. @alpha */
export interface IWriterAcquisitionRequest {
  /** The opaque non-empty identity of the prospective holder. */
  readonly holder: string;
  /** Positive safe-integer lease duration in milliseconds. */
  readonly leaseMilliseconds: number;
}

/**
 * Identifies one admitted execution for allocation or recovery. The attempt
 * key is a stable caller-derived identity for exactly one execution, scoped by
 * logical store, analysis, environment and subject; it is not a subject-level
 * cache key. The intent digest is an opaque digest Resolution computes from
 * the complete invocation it intends to run; History compares it only for
 * exact equality, so a reused key with a different intent is a conflict.
 * @alpha
 */
export interface IAttemptRequest extends IVersionedSubject {
  /** The stable key of one admitted execution. */
  readonly attemptKey: string;
  /** Resolution's opaque digest of that execution's complete intent. */
  readonly intentDigest: string;
}

/**
 * Durable attempt lifecycle. `allocated` and `staged` are incomplete;
 * `completed` produced exactly one published result; `failed` and
 * `interrupted` ended without a result. Staged content is attempt evidence,
 * never a completed result.
 * @alpha
 */
export type IAttemptState = 'allocated' | 'staged' | 'completed' | 'failed' | 'interrupted';

/**
 * One durable attempt as History records it. The attempt identity is issued
 * from a store-wide counter that never reissues a value, including after
 * abandonment or process death (PUB-003).
 * @alpha
 */
export interface IAttemptRecord extends IAttemptRequest {
  /** The never-reused store-wide attempt identity. */
  readonly attemptId: number;
  /** The current lifecycle state. */
  readonly state: IAttemptState;
  /** The fence of the lease that allocated this attempt. */
  readonly allocatedFence: number;
  /** The fence that completed, failed or interrupted it; null while incomplete. */
  readonly endedFence: number | null;
  /** The exact completed result, present only in the `completed` state. */
  readonly result: ICompletedResultReference | null;
  /** Owner-defined evidence of a failed or interrupted attempt, otherwise null. */
  readonly outcome: IVersionedRecord | null;
}

/**
 * Candidate content for an allocated attempt. The payload must be supported
 * Value data with a record or array root; the provenance is Resolution's
 * versioned record; dependencies are exact references to completed results in
 * the same store and scope that this execution consumed.
 * @alpha
 */
export interface IStageRequest {
  /** The allocated attempt to stage. */
  readonly attemptId: number;
  /** The author result data, copied into canonical MDS1 form. */
  readonly payload: unknown;
  /** Resolution's execution provenance for this attempt. */
  readonly provenance: IVersionedRecord;
  /** Exact completed results this execution depends on, in the caller's order. */
  readonly dependencies: readonly ICompletedResultReference[];
}

/** Ends an incomplete attempt without a result, preserving its evidence. @alpha */
export interface IAbandonRequest {
  /** The incomplete attempt to end. */
  readonly attemptId: number;
  /** Whether execution failed or was interrupted. */
  readonly outcome: 'failed' | 'interrupted';
  /** Owner-defined evidence of what happened. */
  readonly evidence: IVersionedRecord;
}

/**
 * Read-only recovery of one identified execution. Recovery reports what
 * durably happened and never executes, publishes or records acceptance:
 * `absent` means the key was never allocated in this scope, `incomplete` an
 * allocated or staged attempt, `unsuccessful` a failed or interrupted one and
 * `completed` the exact result that execution published.
 * @alpha
 */
export type IRecoveryOutcome =
  | { readonly kind: 'absent' }
  | { readonly kind: 'incomplete'; readonly attempt: IAttemptRecord }
  | { readonly kind: 'unsuccessful'; readonly attempt: IAttemptRecord }
  | {
      readonly kind: 'completed';
      readonly attempt: IAttemptRecord;
      /** The exact result that this identified execution published. */
      readonly reference: ICompletedResultReference;
    };

/**
 * Framework metadata of one immutable completed result, readable without
 * loading its author payload. Provenance and dependencies are the historical
 * truth recorded at publication; later acceptance never rewrites them (RES-007).
 * @alpha
 */
export interface ICompletedEnvelope extends IVersionedSubject {
  /** The exact scoped reference of this result. */
  readonly reference: ICompletedResultReference;
  /** The attempt that produced this result; a result has exactly one. */
  readonly attemptId: number;
  /** Store-wide publication order; later publications have larger values. */
  readonly publication: number;
  /** The supported Value snapshot encoding of the stored payload. */
  readonly encoding: 'MDS1';
  /** Resolution's execution provenance, decoded and frozen. */
  readonly provenance: IVersionedRecord;
  /** Exact completed results this execution depended on, in recorded order. */
  readonly dependencies: readonly ICompletedResultReference[];
}

/**
 * Records that an existing completed result was accepted by a current
 * verification. It needs writer ownership to write, but no attempt: a valid
 * hit claims no execution. The evidence names the current dependencies the
 * verification followed, which may differ from the original provenance.
 * @alpha
 */
export interface IAcceptanceRequest {
  /** The exact completed result that was accepted. */
  readonly reference: ICompletedResultReference;
  /** Resolution's versioned acceptance evidence. */
  readonly evidence: IVersionedRecord;
  /** Exact completed results the current verification followed. */
  readonly dependencies: readonly ICompletedResultReference[];
}

/** One immutable current-acceptance record, separate from the result it names. @alpha */
export interface IAcceptanceRecord {
  /** Store-wide never-reused acceptance identity, increasing in record order. */
  readonly acceptanceId: number;
  /** The accepted exact result. */
  readonly reference: ICompletedResultReference;
  /** The writer fence under which the acceptance was recorded. */
  readonly fence: number;
  /** Resolution's acceptance evidence, decoded and frozen. */
  readonly evidence: IVersionedRecord;
  /** Exact results the verification followed, in recorded order. */
  readonly dependencies: readonly ICompletedResultReference[];
}

/**
 * Result of regenerating a completed result's selected index from its stored
 * canonical payload and comparing it with the stored index.
 * @alpha
 */
export type IResultVerification =
  | { readonly kind: 'consistent' }
  | { readonly kind: 'inconsistent'; readonly detail: string };

/**
 * Host capabilities and identity for opening a durable History store. Node
 * access stays behind the injected SQLite and clock capabilities. The logical
 * store identity is independent of the file location: a moved file keeps its
 * identity, and a file holding another logical store is rejected.
 * @alpha
 */
export interface IDurableHistoryOptions {
  /** Opens the persistent SQLite file; History owns every statement and schema. */
  readonly sqlite: ISqliteCapability;
  /** Supplies wall-clock observations for History's lease policy. */
  readonly clock: IClockCapability;
  /** Computes content fingerprints for the selected index. */
  readonly sha256: ISha256Capability;
  /** The host location of the SQLite file, passed only to `sqlite`. */
  readonly location: string;
  /** The logical store identity this file must hold, or is created to hold. */
  readonly logicalStore: string;
}

/**
 * History's durable authority over one logical store. Every mutation except
 * acquisition requires the current writer lease and checks holder, fence and
 * unexpired lease inside its own transaction. Exact reads never consult a
 * current pointer, and a missing or wrong-scope reference is an integrity
 * failure, never a miss to be repaired by recomputation.
 *
 * Clock policy: each holder operation evaluates time as the larger of the
 * host reading and a persisted store-wide high-water, then persists that value,
 * including when the operation is rejected. Backward host movement therefore
 * delays expiry and a forward jump can expire a lease early; neither lets an
 * old fence act after a successor acquires, because every successor receives a
 * larger fence. A host reading that is not a nonnegative safe integer fails
 * the operation without any change. This is a local single-file policy, not a
 * distributed-time or liveness guarantee.
 * @alpha
 */
export interface IDurableHistory {
  /** The logical store identity this authority holds. */
  readonly logicalStore: string;
  /** Exact selected reads over completed results, answered from their generated index. */
  readonly reader: ICompletedResultReader & ICompletedNavigationReader;

  /** Acquire the single logical writer, or report the observed unexpired holder. */
  acquireWriter(request: IWriterAcquisitionRequest): IWriterAcquisition;
  /** Extend a still-valid lease; a stale or expired lease is rejected. */
  renewWriter(lease: IWriterLease, leaseMilliseconds: number): IWriterLease;
  /** End a still-valid lease without resetting the fence. */
  releaseWriter(lease: IWriterLease): void;
  /** Inspect the recorded holder, if any, without granting authority. */
  currentWriter(): IWriterLease | undefined;

  /**
   * Durably allocate one attempt in its own commit before any staging. The
   * same key with the same intent returns the existing attempt in whatever
   * state it reached; the same key with a different intent or version rejects.
   */
  allocateAttempt(lease: IWriterLease, request: IAttemptRequest): IAttemptRecord;
  /** Persist candidate content for an allocated attempt without publishing it. */
  stageAttempt(lease: IWriterLease, request: IStageRequest): IAttemptRecord;
  /**
   * In one commit, install the staged payload, its generated selected index
   * and fingerprints, provenance, dependencies, the completed attempt state
   * and the scoped current pointer. Publishing an already completed attempt
   * returns its existing reference.
   */
  publishAttempt(lease: IWriterLease, attemptId: number): ICompletedResultReference;
  /** End an incomplete attempt as failed or interrupted, retaining its evidence. */
  abandonAttempt(lease: IWriterLease, request: IAbandonRequest): IAttemptRecord;
  /** Report what durably happened to one identified execution, read-only. */
  recoverAttempt(request: IAttemptRequest): IRecoveryOutcome;

  /** Completed results for one scoped subject and version, latest publication first. */
  findCandidates(subject: IVersionedSubject): readonly ICompletedEnvelope[];
  /** The scoped subject's latest publication, if any; never rewound by acceptance. */
  readCurrent(subject: IScopedSubject): ICompletedResultReference | undefined;
  /** Read one exact result's metadata without loading its payload. */
  readEnvelope(reference: ICompletedResultReference): ICompletedEnvelope;
  /** Regenerate and compare one exact result's index from its canonical payload. */
  verifyResult(reference: ICompletedResultReference): IResultVerification;

  /** Record a current acceptance of an existing result without touching it or the current pointer. */
  recordAcceptance(lease: IWriterLease, request: IAcceptanceRequest): IAcceptanceRecord;
  /** Acceptance records naming one exact result, in record order. */
  readAcceptances(reference: ICompletedResultReference): readonly IAcceptanceRecord[];

  /** Release the SQLite file; later calls fail. */
  close(): void;
}
