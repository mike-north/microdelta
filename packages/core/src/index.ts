/**
 * The stable microdelta entry keeps the scaffold's public History surface.
 * Assembly may use History's declared package contract; context code may not
 * route through this facade to evade its own dependency direction.
 * @packageDocumentation
 */
export {
  DuplicateRowError,
  FingerprintAlgorithmMismatchError,
  InvalidStorePatchError,
  MissingRowError,
  createMemoryStore,
} from '@microdelta/history';
export type {
  Divergence,
  FieldRow,
  Fingerprint,
  GenerationPatch,
  GenerationRow,
  GenerationState,
  Identity,
  MemoryStoreOptions,
  Outcome,
  Path,
  RecordedRead,
  ResultKey,
  Store,
  StoreMetadata,
  Subject,
  SubjectPatch,
  SubjectRow,
} from '@microdelta/history';
