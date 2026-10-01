/**
 * Result History & Publication. This entry exposes the existing row Store,
 * its memory adapter and compatibility schema unchanged, the exact
 * completed-result reading ports, and the project-private alpha durable
 * authority that owns attempts, the single logical writer, atomic publication,
 * acceptance records, environment namespaces, recorded promotions and Run
 * Supervision's opaque operation journal. It never decides candidate validity
 * or freshness and never interprets journal records.
 * @packageDocumentation
 */
export {
  DuplicateRowError,
  FingerprintAlgorithmMismatchError,
  InvalidStorePatchError,
  MissingRowError,
} from './store/index.js';
export type {
  FieldRow,
  GenerationPatch,
  GenerationRow,
  Store,
  StoreMetadata,
  SubjectPatch,
  SubjectRow,
} from './store/index.js';
export { createMemoryStore } from './store/memory/index.js';
export type { MemoryStoreOptions } from './store/memory/index.js';
export type {
  ICompletedNavigationReader,
  ICompletedProjectionReader,
  ICompletedResultReader,
  ICompletedResultReference,
  ISelectedFingerprintRequest,
  ISelectedFingerprintResolution,
  ISelectedReadRequest,
} from './completed-results.js';
export type {
  IAddressSegment,
  IOperation,
  ISelectedFact,
  ISelectedNode,
  IValueProjectionDescriptor,
  IValueProjectionFact,
  IValueProjectionMember,
  IValueProjectionTraversal,
} from '@microdelta/value';
export {
  AttemptConflictError,
  AttemptStateError,
  HistoryClockError,
  HistoryIntegrityError,
  HistorySchemaError,
  JournalConflictError,
  JournalVersionError,
  StaleWriterError,
} from './durable/errors.js';
export { openDurableHistory } from './durable/index.js';
export type {
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
  IJournalAddress,
  IJournalCommit,
  IJournalDeclaration,
  IJournalFormat,
  IJournalQuery,
  IJournalRecord,
  IJournalWrite,
  IOperationJournal,
  IPromotionQuery,
  IPromotionRecord,
  IPromotionRequest,
  IRecoveryOutcome,
  IResultVerification,
  IScopedSubject,
  IStageRequest,
  IVersionedRecord,
  IVersionedSubject,
  IWriterAcquisition,
  IWriterAcquisitionRequest,
  IWriterLease,
} from './durable/contracts.js';
/**
 * Machine host contracts surfaced by the durable authority's options and by
 * the connections its SQLite capability returns. They are re-exported
 * intentionally, as Value and Tracking re-export the host contracts they
 * surface, so alpha consumers name Machine's exact types from History.
 */
export type {
  IClockCapability,
  ISha256Capability,
  ISqliteCapability,
  ISqliteConnection,
  ISqliteRow,
  ISqliteRunResult,
  ISqliteStatement,
  ISqliteSynchronousResult,
  ISqliteValue,
} from '@microdelta/machine';
export type {
  Divergence,
  Fingerprint,
  GenerationState,
  Identity,
  Outcome,
  Path,
  RecordedRead,
  ResultKey,
  Subject,
} from './types.js';
