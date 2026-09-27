import { describe, expect, test } from '@jest/globals';

import { createMemoryStore } from '../src/index.js';
import type { FieldRow, SubjectRow } from '../src/index.js';
import type { Fingerprint, ResultKey } from '../src/types.js';

/** Snapshot failure is injected before the backend touches any row indexes. */
describe('History snapshot capability', () => {
  const fingerprint = 'test' as Fingerprint;
  const key: ResultKey = { step: 'snapshot', revision: 1, subjectHash: 'subject' };

  test('A-20: injected snapshot failure leaves a field batch wholly absent', async () => {
    let snapshots = 0;
    const store = createMemoryStore({
      snapshot<T>(value: T): T {
        snapshots += 1;
        if (Array.isArray(value) && value.length > 1) {
          throw new TypeError('snapshot rejected');
        }
        return structuredClone(value);
      },
    });
    const rows: FieldRow[] = [
      { key, generation: 1, path: 'first', fingerprint, value: { ok: true } },
      { key, generation: 1, path: 'second', fingerprint, value: { ok: false } },
    ];

    await expect(store.putFields(rows)).rejects.toThrow('snapshot rejected');
    expect(snapshots).toBe(1);
    expect(await store.getFields(key, 1, ['first', 'second'])).toEqual([]);
    await store.close();
  });

  test('A-20: reentrant snapshot CAS makes the outer stale compare return false', async () => {
    let compete = false;
    let competing: Promise<boolean> | undefined;
    const capability = {
      snapshot<T>(value: T): T {
        if (compete) {
          compete = false;
          competing = store.casSubject(key, 0, { durations: [11] });
        }
        return structuredClone(value);
      },
    };
    const store = createMemoryStore(capability);
    const row: SubjectRow = {
      key,
      subject: { kind: 'step', name: 'snapshot', inputs: [] },
      version: 0,
      currentGeneration: null,
      claim: null,
      durations: [],
    };
    await store.putSubject(row);
    compete = true;

    await expect(store.casSubject(key, 0, { durations: [22] })).resolves.toBe(false);
    const racing = competing;
    if (racing === undefined) {
      throw new Error('Snapshot did not start the competing compare-and-set');
    }
    await expect(racing).resolves.toBe(true);
    expect(await store.getSubject(key)).toMatchObject({ version: 1, durations: [11] });
    await store.close();
  });
});
