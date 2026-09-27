/**
 * Existing row Store, memory adapter, and compatibility schema belong to
 * Result History. This entry exposes row-storage contracts and does not define
 * publication transitions or candidate-validity policy.
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
  IValueProjectionDescriptor,
  IValueProjectionFact,
  IValueProjectionMember,
  IValueProjectionTraversal,
} from '@microdelta/value';
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
