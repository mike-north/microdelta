import {
  DuplicateRowError,
  FingerprintAlgorithmMismatchError,
  InvalidStorePatchError,
  MissingRowError,
} from '../index.js';
import type {
  FieldRow,
  GenerationPatch,
  GenerationRow,
  Store,
  SubjectPatch,
  SubjectRow,
} from '../index.js';
import type { Fingerprint, Path, ResultKey } from '../../types.js';

/** Options for the isolated, non-durable test backend. @public */
export interface MemoryStoreOptions {
  /** Metadata compatibility identifier; the initial store format uses sha256. */
  fingerprintAlgorithm?: string;
  /** Actual value-read boundary, used by the conformance harness. @internal */
  onValueRead?: () => void;
}

/** Encode a tuple, preserving separators, Unicode and empty strings in its parts. */
function address(key: ResultKey, generation?: number, fieldPath?: Path): string {
  // JSON numbers would collapse NaN and both infinities to null. Storage treats
  // numeric address parts as opaque; deciding valid revisions is a caller rule.
  return JSON.stringify([
    key.step, String(key.revision), key.subjectHash,
    generation === undefined ? null : String(generation), fieldPath ?? null,
  ]);
}

/** Snapshot caller-owned data before entering an atomic Map operation. */
function copy<T>(value: T): T {
  // V8 serialization rejects raw shared memory and copies typed-array contents.
  // structuredClone preserves SharedArrayBuffer backing memory, which would let
  // caller mutations silently change retained values without new fingerprints.
  // The cast expresses a serialization round-trip of T, not a schema conversion.
  return deserialize(serialize(value)) as T;
}

/** CAS tokens must advance exactly, including at JavaScript's integer boundary. */
function validateVersion(version: number): void {
  if (!Number.isSafeInteger(version) || version < 0) {
    throw new RangeError('A subject version must be a nonnegative safe integer');
  }
}

/** Reject runtime attempts to overwrite an address or a managed version. */
function guardPatch(patch: SubjectPatch | GenerationPatch, managed: 'version' | 'generation'): void {
  if ('key' in patch || managed in patch) {
    throw new InvalidStorePatchError();
  }
}

/**
 * Create a memory Store with linearizable CAS in a single JavaScript isolate.
 * Each mutation snapshots its arguments before checking and changing the maps;
 * the qualifying check and write have no await or caller callback between them.
 * Values and fingerprints have separate indexes, so verification never touches
 * payloads. Inputs must support V8 serialization: functions, symbols and raw
 * shared buffers reject; buffer views are copied into private storage. This is
 * a test backend, not durable or shared across processes.
 *
 * Only row storage is implemented here. Publication across multiple rows,
 * generation allocation, lease ownership, and reclamation belong to higher layers.
 * @public
 */
export function createMemoryStore(options: MemoryStoreOptions = {}): Store {
  const fingerprintAlgorithm = 'sha256';
  if (options.fingerprintAlgorithm !== undefined && options.fingerprintAlgorithm !== fingerprintAlgorithm) {
    throw new FingerprintAlgorithmMismatchError(options.fingerprintAlgorithm, fingerprintAlgorithm);
  }

  const subjects = new Map<string, SubjectRow>();
  const generations = new Map<string, GenerationRow>();
  const fieldHeaders = new Map<string, Omit<FieldRow, 'value'>>();
  const fieldValues = new Map<string, unknown>();
  const onValueRead = options.onValueRead;

  return {
    async meta() {
      return { schemaVersion: 1, fingerprintAlgorithm };
    },

    async getSubject(key) {
      return copy(subjects.get(address(key)));
    },

    async putSubject(row) {
      const snapshot = copy(row);
      validateVersion(snapshot.version);
      const id = address(snapshot.key);
      if (subjects.has(id)) { throw new DuplicateRowError(); }
      subjects.set(id, snapshot);
    },

    async casSubject(key, expectedVersion, patch) {
      const id = address(key);
      guardPatch(patch, 'version');
      const snapshot = copy(patch);
      // Snapshotting can invoke getters. Read the row afterwards, keeping the
      // compare and set indivisible even under reentrant caller-owned accessors.
      const existing = subjects.get(id);
      if (existing === undefined || existing.version !== expectedVersion) { return false; }
      if (existing.version === Number.MAX_SAFE_INTEGER) {
        throw new RangeError('Subject version exhausted; CAS cannot safely advance');
      }
      subjects.set(id, { ...existing, ...snapshot, version: existing.version + 1 });
      return true;
    },

    async getGeneration(key, generation) {
      return copy(generations.get(address(key, generation)));
    },

    async listGenerations(key) {
      const id = address(key);
      return [...generations.values()]
        .filter(row => address(row.key) === id)
        .map(row => copy(row));
    },

    async putGeneration(row) {
      const snapshot = copy(row);
      const id = address(snapshot.key, snapshot.generation);
      if (generations.has(id)) { throw new DuplicateRowError(); }
      generations.set(id, snapshot);
    },

    async updateGeneration(key, generation, patch) {
      const id = address(key, generation);
      guardPatch(patch, 'generation');
      const snapshot = copy(patch);
      const existing = generations.get(id);
      if (existing === undefined) { throw new MissingRowError(); }
      generations.set(id, { ...existing, ...snapshot });
    },

    async putFields(rows) {
      // Validate the whole detached batch before writing either index. A clone
      // failure or duplicate address cannot leave a partially inserted batch.
      const snapshots = copy(rows);
      const ids = new Set<string>();
      for (const row of snapshots) {
        const id = address(row.key, row.generation, row.path);
        if (ids.has(id) || fieldHeaders.has(id)) { throw new DuplicateRowError(); }
        ids.add(id);
      }
      for (const row of snapshots) {
        const id = address(row.key, row.generation, row.path);
        const { value, ...header } = row;
        fieldHeaders.set(id, header);
        fieldValues.set(id, value);
      }
    },

    async getFields(key, generation, paths) {
      const result: FieldRow[] = [];
      for (const fieldPath of paths) {
        const id = address(key, generation, fieldPath);
        const header = fieldHeaders.get(id);
        if (header !== undefined) {
          onValueRead?.();
          result.push(copy({ ...header, value: fieldValues.get(id) }));
        }
      }
      return result;
    },

    async getFingerprints(key, generation, paths) {
      const result = new Map<Path, Fingerprint>();
      for (const fieldPath of paths) {
        const header = fieldHeaders.get(address(key, generation, fieldPath));
        if (header !== undefined) { result.set(fieldPath, header.fingerprint); }
      }
      return result;
    },

    async expiredClaims(now, limit) {
      return [...subjects.values()]
        .filter(row => row.claim !== null && row.claim.leaseUntil < now)
        .sort((left, right) => (left.claim?.leaseUntil ?? 0) - (right.claim?.leaseUntil ?? 0))
        .slice(0, Math.max(0, limit))
        .map(row => copy(row));
    },

    async close() {
      // This backend owns no file handles, timers, workers, or external resources.
    },
  };
}
import { deserialize, serialize } from 'node:v8';
