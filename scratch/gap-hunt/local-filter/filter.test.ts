/** TEST-6: local reactive selection must not rewrite durable inputs or provenance. */
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { expect, test } from '@jest/globals';

/** Child output remains untrusted; assertions accept values only after object narrowing. */
function record(value: unknown): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {throw new Error('worker output must be a record');}
  return Object.fromEntries(Object.entries(value));
}
/** Invoke an entirely new process and return its single bounded observation receipt. */
function run(location: string, mode: string, receipt: string): Record<string, unknown> {
  const output = execFileSync(process.execPath, [fileURLToPath(new URL('./worker.js', import.meta.url)), location, mode, receipt], { encoding: 'utf8' });
  const parsed: unknown = JSON.parse(output);
  return record(parsed);
}
/** Persistent DB bytes complement exact envelope/provenance assertions. */
function digest(file: string): string { return createHash('sha256').update(readFileSync(file)).digest('hex'); }

test('TEST-6: independent local filters update retained scalar views without rewriting their exact snapshot', () => {
  const directory = mkdtempSync(join(tmpdir(), 'microdelta-filter-'));
  const location = join(directory, 'history.sqlite');
  const receipt = join(directory, 'seed.json');
  try {
    const seed = run(location, 'seed', receipt);
    writeFileSync(receipt, JSON.stringify(seed));
    const stored = digest(location);
    const first = run(location, 'view', receipt);
    const second = run(location, 'view', receipt);
    expect(new Set([seed['pid'], first['pid'], second['pid']]).size).toBe(3);
    for (const result of [first, second]) {
      expect(result['reference']).toEqual(seed['reference']);
      expect(result['initial']).toEqual(['Ada']);
      expect(result['cached']).toEqual(['Ada']);
      expect(result['widened']).toEqual(['Ada', 'Ben']);
      expect(result['empty']).toEqual([]);
      expect(result['evaluations']).toBe(3);
      expect(result['initialEvaluations']).toBe(1);
      expect(result['independentBefore']).toBe('Ada');
      expect(result['independent']).toBe(result['independentBefore']);
      expect(result['observationCounts']).toEqual([3, 4, 2]);
      expect(result['before']).toEqual(seed['envelope']);
      expect(result['after']).toEqual(seed['envelope']);
      expect(result['root']).toEqual({ adaName: 'Ada', adaScore: 9, benName: 'Ben', benScore: 2, unread: 'U'.repeat(20000) });
      expect(result['selected']).not.toContain('unread');
    }
    expect(digest(location)).toBe(stored);
    console.log('local-filter-observation', JSON.stringify({ independentProcesses: 3, viewProcesses: 2, evaluationsEach: first['evaluations'], initial: first['initial'], widened: first['widened'], empty: first['empty'], exactReferencePreserved: true, envelopePreserved: true, databaseBytesUnchanged: true, unreadSelectedReads: 0 }));
  } finally { rmSync(directory, { recursive: true, force: true }); }
});
