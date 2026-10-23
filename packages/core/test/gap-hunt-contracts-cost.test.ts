/** Real SQLite finite TEST-5/6 outcomes; 150,000 subjects remains a separate measurement target. */
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import { describe, expect, test } from '@jest/globals';
const worker = fileURLToPath(new URL('./gap-hunt-contracts-cost-worker.js', import.meta.url));
interface IRun { readonly result: Record<string, unknown>; readonly bodies: readonly string[] }
function run(location: string, mode: string, variant: string, request: string): IRun {
  const child = spawnSync(process.execPath, [worker, location, mode, variant, request], { encoding: 'utf8' });
  if (child.status !== 0) { throw new Error(child.stderr); }
  const result: unknown = JSON.parse(child.stdout);
  if (typeof result !== 'object' || result === null || Array.isArray(result)) { throw new Error('Expected worker report'); }
  return { result: Object.fromEntries(Object.entries(result)), bodies: child.stderr.split('\n').filter(line => line.startsWith('BODY:')).map(line => line.slice(5)) };
}
describe('gap hunt TEST-5/6 alternate cost and reactive retained consumers', () => {
  test('an enrichment chain executes exactly the three changed member projections after restart', () => {
    const directory = mkdtempSync(join(tmpdir(), 'microdelta-enrichment-'));
    try {
      const store = join(directory, 'history.sqlite');
      const first = run(store, 'enrichment', 'base', 'first');
      expect(first.bodies).toHaveLength(24);
      const unchanged = run(store, 'enrichment', 'base', 'second');
      expect(unchanged.bodies).toEqual([]);
      const changed = run(store, 'enrichment', 'changed', 'third');
      expect([...changed.bodies].sort()).toEqual(['enriched:person:2', 'enriched:person:5', 'enriched:person:9', 'leaf:person:2', 'leaf:person:5', 'leaf:person:9']);
      expect(changed.result.outcomes).toEqual(Array.from({ length: 12 }, (_, index) => ({ key: `person:${index}`, kind: [2, 5, 9].includes(index) ? 'published' : 'reused', reference: expect.any(String), data: { score: (index + ([2, 5, 9].includes(index) ? 100 : 0)) * 2000 } })).sort((left, right) => left.key.localeCompare(right.key)));
      const unread = run(store, 'enrichment', 'unread', 'fourth');
      expect(unread.bodies).toEqual([]);
      expect(unread.result).toEqual(unchanged.result);
    } finally { rmSync(directory, { recursive: true, force: true }); }
  });
  test('cheap memoized leaves retain while an expensive aggregate runs only for changed consumed scores', () => {
    const directory = mkdtempSync(join(tmpdir(), 'microdelta-cost-aggregate-'));
    try {
      const store = join(directory, 'history.sqlite');
      const first = run(store, 'aggregate', 'base', 'first');
      expect(first.bodies).toHaveLength(13);
      expect(first.result.data).toEqual({ sum: 132000 });
      const unchanged = run(store, 'aggregate', 'base', 'second');
      expect(unchanged.bodies).toEqual([]);
      expect(unchanged.result).toEqual({ ...first.result, kind: 'reused' });
      const changed = run(store, 'aggregate', 'changed', 'third');
      expect([...changed.bodies].sort()).toEqual(['aggregate', 'leaf:person:2', 'leaf:person:5', 'leaf:person:9']);
      expect(changed.result.data).toEqual({ sum: 732000 });
      const rollback = run(store, 'aggregate', 'base', 'fourth');
      expect(rollback.bodies).toEqual([]);
      expect(rollback.result).toEqual(unchanged.result);
    } finally { rmSync(directory, { recursive: true, force: true }); }
  });
  test('ten narrow consumers load scalar cells only; local filters recompute without rewriting retained snapshots across process exit', () => {
    const directory = mkdtempSync(join(tmpdir(), 'microdelta-local-filter-'));
    try {
      const store = join(directory, 'history.sqlite');
      const first = run(store, 'local', 'base', 'first');
      const second = run(store, 'local', 'base', 'second');
      expect(first.bodies).toEqual(['corpus']);
      expect(second.bodies).toEqual([]);
      expect(first.result.kind).toBe('published');
      expect(second.result.kind).toBe('reused');
      expect(second.result.reference).toBe(first.result.reference);
      for (const report of [first.result, second.result]) {
        expect(report.narrow).toEqual(Array.from({ length: 10 }, (_, field) => 1200 + 16 * field));
        expect(report.narrowReads).toMatchObject({ rootPayloadCells: 0, scalarCells: 160, stagedCells: 0 });
        expect(report.beforeNames).toEqual(Array.from({ length: 8 }, (_, index) => `person:${index + 8}`));
        expect(report.afterNames).toEqual(['person:12', 'person:13', 'person:14', 'person:15']);
        expect(report.beforeAggregate).toBe(1840000);
        expect(report.afterAggregate).toBe(1080000);
        expect(report.evaluations).toBe(2);
        expect(report.storedUnchanged).toBe(true);
        expect(report.historyCount).toBe(1);
        expect(report.observations).toBeGreaterThan(0);
        expect(report.localTagCount).toBe(1);
      }
    } finally { rmSync(directory, { recursive: true, force: true }); }
  });
});
