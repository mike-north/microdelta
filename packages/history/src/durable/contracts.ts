/**
 * Contracts of History's durable authority: the one consistency owner for
 * immutable completed results, attempt history, the single logical writer,
 * atomic publication, current pointers, separate acceptance records, recorded
 * promotions and Run Supervision's operation journal (PUB-001, ARC-007,
 * RUN-011/012/017). These are project-private alpha shapes. They carry
 * Resolution's provenance and evidence, promotion evidence and Supervision's
 * journal records as versioned opaque records and never interpret Definition,
 * Tracking, Resolution or Supervision meaning; deciding whether a result is
 * currently acceptable remains Resolution's responsibility, and deciding what
 * an operation or deferral means remains Supervision's.
 *
 * Every durable record belongs to exactly one environment namespace of one
 * analysis: attempts, completed results, current heads, acceptance records,
 * promotion records and journal records. Nothing recorded in one environment
 * satisfies a lookup in another, except a completed result that an explicit
 * promotion record names for that other environment (RUN-017).
 * @packageDocumentation
 */
import type { IClockCapability, ISha256Capability, ISqliteCapability } from '@microdelta/machine';

import type { ICompletedNavigationReader, ICompletedResultReader, ICompletedResultReference } from '../completed-results.js';

/**
 * The analysis and environment that scope every subject, attempt and result
 * within one logical store. The same subject text in another analysis or
 * environment is a different scoped subject (RES-001/002). Both are complete
 * opaque non-empty strings compared by exact equality. An environment is a
 * namespace within one store (RUN-017): a trial and a production run of the
 * same analysis use different environments of the same file, selected per
 * call rather than process-wide.
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
  /**
   * Exact completed results the current verification followed. Each must be
   * admissible in the accepting environment: published there, or named by a
   * promotion into it.
   */
  readonly dependencies: readonly ICompletedResultReference[];
  /**
   * The environment, within the result's analysis, whose current verification
   * accepted the result. It is always explicit and never inferred from the
   * reference: the caller names its own run environment. It may be the
   * environment that published the result, or another environment into which
   * a recorded promotion admits the result. The acceptance then belongs to
   * that environment's namespace alone and never satisfies a lookup in any
   * other environment.
   */
  readonly environment: string;
}

/** One immutable current-acceptance record, separate from the result it names. @alpha */
export interface IAcceptanceRecord {
  /** Store-wide never-reused acceptance identity, increasing in record order. */
  readonly acceptanceId: number;
  /** The accepted exact result. */
  readonly reference: ICompletedResultReference;
  /** The environment namespace whose verification recorded this acceptance. */
  readonly environment: string;
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
 * Asks History to admit exact completed results of other environments into
 * one target environment of the same analysis (RUN-017). A trial result
 * satisfies a production lookup only through such a recorded promotion. The
 * target names where the results are admitted; each reference keeps naming
 * its own publishing environment. The evidence is the promoter's versioned
 * record of who promoted what and why; History stores it opaquely.
 * @alpha
 */
export interface IPromotionRequest {
  /** The analysis and environment the results are admitted into. */
  readonly target: IHistoryScope;
  /**
   * Distinct exact completed results of the target's analysis, none published
   * in the target environment, in the promoter's order.
   */
  readonly references: readonly ICompletedResultReference[];
  /** The promoter's versioned evidence for this promotion. */
  readonly evidence: IVersionedRecord;
}

/**
 * One immutable promotion record. It admits the named results as candidates,
 * dependencies and acceptance targets in its target environment and changes
 * nothing else: each result keeps its exact reference, envelope, provenance
 * and acceptances, and no current head moves in any environment. The target
 * environment's later verifications record their own acceptances.
 * @alpha
 */
export interface IPromotionRecord {
  /** Store-wide never-reused promotion identity, increasing in record order. */
  readonly promotionId: number;
  /** The analysis and environment the results were admitted into. */
  readonly target: IHistoryScope;
  /** The writer fence under which the promotion was recorded. */
  readonly fence: number;
  /** The promoter's evidence, decoded and frozen. */
  readonly evidence: IVersionedRecord;
  /** The admitted exact results, each in its own publishing scope, in recorded order. */
  readonly references: readonly ICompletedResultReference[];
}

/**
 * Selects promotion records into one target environment, optionally only
 * those naming one exact result.
 * @alpha
 */
export interface IPromotionQuery {
  /** The analysis and environment whose admitting promotions to read. */
  readonly target: IHistoryScope;
  /** When present, only promotions that name this exact result. */
  readonly reference?: ICompletedResultReference;
}

/**
 * One owner-defined journal record format and the exact format versions a
 * journal port can read and write. A format is only a record's version tag:
 * it never identifies a record or its collection. History compares the tag
 * and versions for exact equality and never interprets the content.
 * @alpha
 */
export interface IJournalFormat {
  /** The owner-defined non-empty format identity. */
  readonly format: string;
  /** The positive safe-integer versions of that format this port understands. */
  readonly versions: readonly number[];
}

/**
 * The formats a journal port is bound to. A stored record of an undeclared
 * format or version is refused rather than returned or overwritten, so a
 * caller never acts on, or clobbers, a record it does not understand.
 * @alpha
 */
export interface IJournalDeclaration {
  /** At least one declared format, each format named once. */
  readonly formats: readonly IJournalFormat[];
}

/**
 * Locates one journal record: its environment namespace, owner-named
 * collection and owner-defined key. The record's identity is exactly this
 * address; its format tag may change between revisions only by
 * compare-and-set.
 * @alpha
 */
export interface IJournalAddress extends IHistoryScope {
  /** The owner-named non-empty collection, such as Supervision's operations. */
  readonly collection: string;
  /** The owner-defined non-empty key, unique within the namespace and collection. */
  readonly key: string;
}

/**
 * Selects every record of one collection in one environment namespace.
 * @alpha
 */
export interface IJournalQuery extends IHistoryScope {
  /** The owner-named collection to list. */
  readonly collection: string;
}

/**
 * One compare-and-set write of a journal commit. The expected revision is the
 * revision the caller last read at this address; `0` asserts that the key has
 * never been written in the collection, under any format. The record's
 * format and version are its version tag and must be declared by the port.
 * @alpha
 */
export interface IJournalWrite {
  /** The owner-named non-empty collection. */
  readonly collection: string;
  /** The owner-defined non-empty key. */
  readonly key: string;
  /** The current revision the write replaces, or `0` for a new key. */
  readonly expectedRevision: number;
  /** The new owner-defined record. */
  readonly record: IVersionedRecord;
}

/**
 * One atomic journal commit in one environment namespace: every write lands
 * in the same transaction, or none does.
 * @alpha
 */
export interface IJournalCommit extends IHistoryScope {
  /** At least one write, each collection and key pair at most once. */
  readonly writes: readonly IJournalWrite[];
}

/**
 * One immutable revision of a journal record. Revisions of an address start
 * at 1 and increase by one per committed write; earlier revisions are retained
 * and never rewritten.
 * @alpha
 */
export interface IJournalRecord extends IHistoryScope {
  /** The owner-named collection. */
  readonly collection: string;
  /** The owner-defined key. */
  readonly key: string;
  /** This revision's number within its address, starting at 1. */
  readonly revision: number;
  /** Store-wide never-reused journal write identity, increasing in commit order. */
  readonly sequence: number;
  /** The writer fence under which this revision was committed. */
  readonly fence: number;
  /** The owner-defined record, decoded and frozen, with this revision's version tag. */
  readonly record: IVersionedRecord;
}

/**
 * Run Supervision's operation journal, stored by History (RUN-011/012). It
 * keeps owner-defined operation and deferral records, such as an intent
 * committed before a send or a "not before" deferral, atomically and under
 * writer fencing, without interpreting them: History owns only namespacing,
 * collections, revisions, fencing and the declared-version check. A commit
 * needs the current writer lease and checks holder, fence and unexpired lease
 * in the same transaction as its compare-and-set checks and writes; reads
 * need no lease and never see an uncommitted write.
 * @alpha
 */
export interface IOperationJournal {
  /** The frozen formats and versions this port was opened with. */
  readonly formats: readonly IJournalFormat[];
  /**
   * Commit every write in one transaction. The whole commit is refused,
   * unchanged, for a stale lease, an undeclared format or version, a current
   * revision whose stored format or version this port does not understand
   * (checked first, since such a caller cannot have read it), or an expected
   * revision that is not the address's current revision.
   */
  commit(lease: IWriterLease, request: IJournalCommit): readonly IJournalRecord[];
  /** The current revision at one address, or undefined if the key was never written there. */
  read(address: IJournalAddress): IJournalRecord | undefined;
  /** The current revision of every key in one collection, in order of first write. */
  list(query: IJournalQuery): readonly IJournalRecord[];
}

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
 *
 * Storage contention: every mutation, including acquisition, is one IMMEDIATE
 * SQLite transaction. When another connection, possibly in another process,
 * holds SQLite's write lock past the host's bounded busy wait, the operation
 * fails with Machine's `SqliteBusyError` (re-exported here) and changes
 * nothing. That is contention, not an ownership fact: acquisition reports
 * `held` only for an observed unexpired holder (PUB-005), and whether to try
 * again is the caller's policy, never History's.
 * @alpha
 */
export interface IDurableHistory {
  /** The logical store identity this authority holds. */
  readonly logicalStore: string;
  /** Exact selected reads over completed results, answered from their generated index. */
  readonly reader: ICompletedResultReader & ICompletedNavigationReader;

  /** Acquire the single logical writer, or report the observed unexpired holder. */
  acquireWriter(request: IWriterAcquisitionRequest): IWriterAcquisition;
  /**
   * Extend a still-valid lease; a stale or expired lease is rejected. Only the
   * expiry changes: the durable fence is left as it is, never rewritten from
   * the presented lease.
   */
  renewWriter(lease: IWriterLease, leaseMilliseconds: number): IWriterLease;
  /** End a still-valid lease; the durable fence is left as it is, so the next grant still advances it. */
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

  /**
   * Completed results admissible for one scoped subject and version, latest
   * publication first: those published in the subject's environment and those
   * a recorded promotion admits into it. A promoted result keeps its own exact
   * reference and envelope scope; nothing from any other environment appears.
   */
  findCandidates(subject: IVersionedSubject): readonly ICompletedEnvelope[];
  /**
   * The scoped subject's latest publication in its own environment, if any;
   * never rewound by acceptance and never moved by a promotion.
   */
  readCurrent(subject: IScopedSubject): ICompletedResultReference | undefined;
  /** Read one exact result's metadata without loading its payload. */
  readEnvelope(reference: ICompletedResultReference): ICompletedEnvelope;
  /** Regenerate and compare one exact result's index from its canonical payload. */
  verifyResult(reference: ICompletedResultReference): IResultVerification;

  /** Record a current acceptance of an existing result without touching it or the current pointer. */
  recordAcceptance(lease: IWriterLease, request: IAcceptanceRequest): IAcceptanceRecord;
  /**
   * Acceptance records naming one exact result that were recorded in the
   * named environment, in record order. The environment is always explicit:
   * the publishing environment, or one a promotion admits the result into.
   */
  readAcceptances(reference: ICompletedResultReference, environment: string): readonly IAcceptanceRecord[];

  /**
   * In one commit, record a promotion that admits exact results of other
   * environments into the target environment. Nothing already recorded changes.
   */
  promoteResults(lease: IWriterLease, request: IPromotionRequest): IPromotionRecord;
  /** Promotion records into one environment, in record order. */
  readPromotions(query: IPromotionQuery): readonly IPromotionRecord[];

  /**
   * Open Run Supervision's operation journal over this store, bound to the
   * declared record formats and versions. The port shares this authority's
   * connection, writer lease and lifetime.
   */
  openJournal(declaration: IJournalDeclaration): IOperationJournal;

  /** Release the SQLite file; later calls fail. */
  close(): void;
}
