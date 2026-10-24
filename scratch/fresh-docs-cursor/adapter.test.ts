import { describe, expect, test } from '@jest/globals';
import { collect, fixture } from './adapter.js';

/** Cursor traversal belongs to this adapter, independently of retained library results. */
describe('explicit snapshot adapter', () => {
  test('traverses every cursor once and preserves four unique records in stable order', async () => {
    const provider = fixture();
    const snapshot = await collect(provider.fetch);
    expect(provider.calls).toEqual([null, 'page:2']);
    expect(snapshot.map(record => record.id)).toEqual([1, 2, 3, 4]);
    expect(snapshot.reduce((sum, record) => sum + record.score, 0)).toBe(10);
  });
  test('rejects malformed provider cursors before fetching them', async () => {
    await expect(collect(async () => ({ records: [], next: 'bad' }))).rejects.toThrow('malformed cursor');
  });
  test('rejects repeating cursors instead of looping or duplicating output', async () => {
    const calls: (string | null)[] = [];
    await expect(collect(async cursor => {
      calls.push(cursor);
      return { records: [], next: 'page:2' };
    })).rejects.toThrow('repeating cursor');
    expect(calls).toEqual([null, 'page:2']);
  });
  test('rejects overlapping records across otherwise valid pages', async () => {
    await expect(collect(async cursor => ({ records: [{ id: 1, score: 1 }], next: cursor === null ? 'page:2' : null }))).rejects.toThrow('duplicate record');
  });
});
