import { describe, expect, test } from '@jest/globals';

import { createMemoryStore } from '../src/store/memory/index.js';
import type { FieldRow, Store, SubjectRow } from '../src/store/index.js';
import type { Fingerprint, ResultKey } from '../src/types.js';

import { storeConformance } from './conformance/store/index.js';
import type { ValueReadProbe } from './conformance/store/index.js';

// Counters live in the harness, not in persisted rows or the public Store contract.
const probes = new WeakMap<Store, ValueReadProbe>();

storeConformance('memory', {
  fingerprintAlgorithm: 'sha256',
  create(options) {
    let valueReads = 0;
    const store = createMemoryStore({
      ...options,
      onValueRead: () => { valueReads += 1; },
    });
    probes.set(store, {
      reset: () => { valueReads = 0; },
      count: () => valueReads,
    });
    return store;
  },
  probeValueReads(store) {
    const probe = probes.get(store);
    if (probe === undefined) { throw new Error('Memory backend lacks a value-read probe'); }
    return probe;
  },
});

/** Fixtures use caller-computed opaque digests; this backend never fingerprints data. */
const fixtureFingerprint = 'fixture-fingerprint' as Fingerprint;
const fixtureKey: ResultKey = { step: 'snapshot', revision: 1, subjectHash: 'subject' };

/** Construct an independent value row for tests of snapshot rejection. */
function snapshotField(value: unknown, path = 'payload'): FieldRow {
  return { key: fixtureKey, generation: 1, path, fingerprint: fixtureFingerprint, value };
}

/** Raw shared memory is unsupported by the memory backend's detached snapshot codec. */
const sharedMemoryFixtures: ReadonlyArray<{ name: string; value(buffer: SharedArrayBuffer): unknown }> = [
  { name: 'SharedArrayBuffer', value: buffer => buffer },
  { name: 'nested SharedArrayBuffer', value: buffer => ({ nested: [{ bytes: buffer }] }) },
  { name: 'Map key', value: buffer => new Map([[buffer, 'value']]) },
  { name: 'Map value', value: buffer => new Map([['key', buffer]]) },
  { name: 'Set member', value: buffer => new Set([buffer]) },
];

/** Find the one view in these small acyclic fixtures without casting backend data. */
function findBytes(value: unknown): Uint8Array {
  if (ArrayBuffer.isView(value)) {
    return new Uint8Array(value.buffer, value.byteOffset, value.byteLength);
  }
  if (typeof value === 'object' && value !== null) {
    for (const child of Object.values(value)) {
      return findBytes(child);
    }
  }
  throw new Error('Expected a byte view in the snapshot fixture');
}

describe('memory snapshot regressions', () => {
  test.each(['typed-array view', 'DataView', 'nested typed-array view'])(
    '%s over shared memory is rejected or stored as detached bytes',
    async (kind) => {
      const store = createMemoryStore();
      const buffer = new SharedArrayBuffer(8);
      const original = new Uint8Array(buffer);
      original[0] = 1;
      const payload: unknown = kind === 'DataView' ? new DataView(buffer)
        : kind === 'nested typed-array view' ? { nested: [{ bytes: original }] } : original;
      try {
        try {
          await store.putFields([snapshotField(payload)]);
        } catch (error) {
          expect(error).toBeDefined();
          expect(await store.getFields(fixtureKey, 1, ['payload'])).toEqual([]);
          return;
        }
        original[0] = 9;
        const firstRead = await store.getFields(fixtureKey, 1, ['payload']);
        const readBytes = findBytes(firstRead[0]?.value);
        expect(readBytes[0]).toBe(1);
        readBytes[0] = 33;
        const secondRead = await store.getFields(fixtureKey, 1, ['payload']);
        expect(findBytes(secondRead[0]?.value)[0]).toBe(1);
      } finally {
        await store.close();
      }
    },
  );

  test.each(sharedMemoryFixtures)('rejects $name before inserting any member of a field batch', async ({ value }) => {
    const store = createMemoryStore();
    try {
      const payload = value(new SharedArrayBuffer(8));
      await expect(store.putFields([snapshotField({ plain: true }, 'first'), snapshotField(payload)]))
        .rejects.toThrow();
      expect(await store.getFields(fixtureKey, 1, ['first', 'payload'])).toEqual([]);
      expect(await store.getFingerprints(fixtureKey, 1, ['first', 'payload'])).toEqual(new Map());
    } finally {
      await store.close();
    }
  });

  test('rejects shared-memory progress in subject insertion and CAS without retaining or changing the row', async () => {
    const store = createMemoryStore();
    const row: SubjectRow = {
      key: fixtureKey,
      subject: { kind: 'step', name: 'snapshot', inputs: [] },
      version: 0,
      currentGeneration: null,
      claim: null,
      durations: [],
    };
    const claim = {
      generation: 1,
      holder: 'worker',
      leaseUntil: 1_000,
      progress: { fingerprint: fixtureFingerprint, value: { bytes: new SharedArrayBuffer(8) } },
    };
    try {
      await expect(store.putSubject({ ...row, claim })).rejects.toThrow();
      expect(await store.getSubject(fixtureKey)).toBeUndefined();
      await store.putSubject(row);
      await expect(store.casSubject(fixtureKey, 0, { claim, durations: [99] })).rejects.toThrow();
      expect(await store.getSubject(fixtureKey)).toEqual(row);
    } finally {
      await store.close();
    }
  });
});
