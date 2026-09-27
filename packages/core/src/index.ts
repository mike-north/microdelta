/**
 * The stable microdelta entry preserves the scaffold's public Store factory
 * while composing its required host capability at the application boundary.
 * Context code may use owner contracts directly, never this assembly facade.
 * @packageDocumentation
 */
import { createMemoryStore as createHistoryMemoryStore } from '@microdelta/history';
import type { MemoryStoreOptions, Store } from '@microdelta/history';
import { createNodeMachine } from '@microdelta/machine-node';

/** The default facade's host is selected once by assembly and passed explicitly. */
const machine = createNodeMachine();

/**
 * Create the existing non-durable memory store with Node's detached snapshot
 * capability supplied by assembly.
 * @public
 */
export function createMemoryStore(options: MemoryStoreOptions = {}): Store {
  return createHistoryMemoryStore(machine, options);
}

export {
  DuplicateRowError,
  FingerprintAlgorithmMismatchError,
  InvalidStorePatchError,
  MissingRowError,
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
