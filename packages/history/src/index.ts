/**
 * Existing row Store, memory adapter, and compatibility schema belong to
 * Result History. This package does not yet implement atomic publication.
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
