import { describe, expect, test } from '@jest/globals';

import type { Fingerprint, ResultKey, SubjectPatch, SubjectRow } from '@microdelta/history';
import { createNodeMachine } from '@microdelta/machine-node';
import { createTracking } from '@microdelta/tracking';

import { createMemoryStore } from '../src/index.js';

/** A supplied digest stays opaque to History and this assembly fixture. */
const fingerprint = 'machine-test' as Fingerprint;
const key: ResultKey = { step: 'snapshot', revision: 1, subjectHash: 'subject' };

describe('Machine composition', () => {
  test('A-20: assembly injects Node async context into Tracking', async () => {
    const tracking = createTracking(createNodeMachine());
    const first = tracking.createTag();
    const second = tracking.createTag();
    const capture = await tracking.withFrameAsync(async () => {
      tracking.consume(first);
      await Promise.resolve();
      tracking.consume(second);
      return 'completed';
    });

    expect(capture).toEqual({ value: 'completed', consumed: new Set([first, second]) });
  });

  test('A-20: facade preserves createMemoryStore options and uses Node snapshots', async () => {
    const store = createMemoryStore({ fingerprintAlgorithm: 'sha256' });
    try {
      await expect(store.meta()).resolves.toEqual({ schemaVersion: 1, fingerprintAlgorithm: 'sha256' });
      const value = { nested: { number: 1 } };
      const row = { key, generation: 1, path: 'payload', fingerprint, value };
      await store.putFields([row]);
      value.nested.number = 9;
      const firstRead = await store.getFields(key, 1, ['payload']);
      expect(firstRead[0]?.value).toEqual({ nested: { number: 1 } });
      const readValue = firstRead[0]?.value;
      if (typeof readValue !== 'object' || readValue === null || !('nested' in readValue)) {
        throw new Error('Expected the saved field value to retain its nested object');
      }
      const nested = readValue.nested;
      if (typeof nested !== 'object' || nested === null || !('number' in nested)) {
        throw new Error('Expected the saved field value to retain its nested number');
      }
      nested.number = 7;
      expect((await store.getFields(key, 1, ['payload']))[0]?.value).toEqual({ nested: { number: 1 } });
    } finally {
      await store.close();
    }
  });

  test('A-20: V8 getter reentry makes an outer stale CAS fail without overwriting the winner', async () => {
    const store = createMemoryStore();
    const row: SubjectRow = {
      key,
      subject: { kind: 'step', name: 'snapshot', inputs: [] },
      version: 0,
      currentGeneration: null,
      claim: null,
      durations: [],
    };
    let competing: Promise<boolean> | undefined;
    const patch: SubjectPatch = {
      get durations() {
        competing = store.casSubject(key, 0, { durations: [11] });
        return [22];
      },
    };

    try {
      await store.putSubject(row);
      await expect(store.casSubject(key, 0, patch)).resolves.toBe(false);
      const winner = competing;
      if (winner === undefined) {
        throw new Error('V8 snapshot did not evaluate the enumerable getter');
      }
      await expect(winner).resolves.toBe(true);
      expect(await store.getSubject(key)).toMatchObject({ version: 1, durations: [11] });
    } finally {
      await store.close();
    }
  });
});
