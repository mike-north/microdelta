/** Track D counts durable bodies and exact references; observer comparison alone cannot prove either. */
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, describe, expect, test } from '@jest/globals';

const emittedDirectory = dirname(fileURLToPath(import.meta.url));
const workerFile = 'gap-hunt-contracts-artifact-worker.js';
const leafFile = 'gap-hunt-contracts-artifact-leaf.js';
const intermediaryFile = 'gap-hunt-contracts-artifact-intermediary.js';
interface IReport { readonly kind: 'published' | 'reused'; readonly reference: string; readonly score: number; readonly bodies: number }
interface IVariant { readonly name: string; readonly before: string; readonly after: string; readonly version: string; readonly expected: 'published' | 'reused'; readonly score: number }
/** Optional evidence records expose the actual locators/counts without retaining temporary stores. */
interface ICaseEvidence { readonly name: string; readonly baseline: IReport; readonly changed: IReport; readonly repeated: IReport; readonly beforeSha256: string; readonly afterSha256: string; readonly dependencyVersion: string }
const evidence: ICaseEvidence[] = [];
afterAll(() => {
  const output = process.env['MICRODELTA_ARTIFACT_EVIDENCE'];
  if (output !== undefined) { writeFileSync(output, JSON.stringify({ cases: evidence, spawnedProcesses: evidence.length * 3 }, null, 2) + '\n'); }
});
const variants: readonly IVariant[] = [
  { name: 'unchanged emitted modules', before: '', after: '', version: '1.0.0', expected: 'reused', score: 6 },
  { name: 'transitive declared imported leaf body change', before: 'return value * 2;', after: 'return value * 3;', version: '1.0.0', expected: 'published', score: 9 },
  { name: 'dependency version metadata alone', before: '', after: '', version: '2.0.0', expected: 'reused', score: 6 },
  { name: 'emitted function rename', before: 'export function dependency(', after: 'export function renamed(', version: '1.0.0', expected: 'published', score: 6 },
  { name: 'emitted formatting only', before: 'return value * 2;', after: 'return  value  *  2;', version: '1.0.0', expected: 'published', score: 6 },
  { name: 'emitted comment only', before: 'return value * 2;', after: '/* emitted-only comment */ return value * 2;', version: '1.0.0', expected: 'published', score: 6 },
];

/** Validate the fresh process report without casting away the JSON boundary. */
function run(directory: string, store: string, request: string): IReport {
  const child = spawnSync(process.execPath, [join(directory, workerFile), store, request], { encoding: 'utf8' });
  if (child.status !== 0) { throw new Error(`Worker failed: ${child.stderr}`); }
  const report: unknown = JSON.parse(child.stdout);
  if (typeof report !== 'object' || report === null || !('kind' in report) || (report.kind !== 'published' && report.kind !== 'reused') || !('reference' in report) || typeof report.reference !== 'string' || !('data' in report) || typeof report.data !== 'object' || report.data === null || !('score' in report.data) || typeof report.data.score !== 'number') { throw new Error('Invalid artifact worker report'); }
  return { kind: report.kind, reference: report.reference, score: report.data.score, bodies: child.stderr.split('\n').filter(line => line === 'BODY:analysis').length };
}

describe('Track D durable emitted imported implementation variants', () => {
  test.each(variants)('$name', variant => {
    // Keep module resolution under the existing package tree; the durable store has an independent temporary lifetime.
    const modules = mkdtempSync(join(emittedDirectory, 'artifact-variants-'));
    const storage = mkdtempSync(join(tmpdir(), 'microdelta-durable-artifacts-'));
    try {
      const store = join(storage, 'history.sqlite');
      for (const file of [workerFile, leafFile, intermediaryFile]) { writeFileSync(join(modules, file), readFileSync(join(emittedDirectory, file))); }
      writeFileSync(join(modules, 'package.json'), JSON.stringify({ type: 'module', version: '1.0.0' }));
      const baseline = run(modules, store, 'baseline');
      expect(baseline).toEqual({ kind: 'published', reference: expect.any(String), score: 6, bodies: 1 });
      const oldLeaf = readFileSync(join(modules, leafFile), 'utf8');
      let changedLeaf = oldLeaf;
      if (variant.before !== '') {
        expect(oldLeaf.split(variant.before)).toHaveLength(2);
        changedLeaf = oldLeaf.replace(variant.before, variant.after);
      }
      if (variant.name === 'emitted function rename') { changedLeaf += '\nexport { renamed as dependency };\n'; }
      writeFileSync(join(modules, leafFile), changedLeaf);
      writeFileSync(join(modules, 'package.json'), JSON.stringify({ type: 'module', version: variant.version }));
      const changed = run(modules, store, 'changed');
      expect(changed.kind).toBe(variant.expected);
      expect(changed.score).toBe(variant.score);
      expect(changed.bodies).toBe(variant.expected === 'published' ? 1 : 0);
      if (variant.expected === 'published') { expect(changed.reference).not.toBe(baseline.reference); }
      else { expect(changed.reference).toBe(baseline.reference); }
      const repeated = run(modules, store, 'repeated');
      expect(repeated).toEqual({ ...changed, kind: 'reused', bodies: 0 });
      evidence.push({ name: variant.name, baseline, changed, repeated, beforeSha256: createHash('sha256').update(oldLeaf).digest('hex'), afterSha256: createHash('sha256').update(changedLeaf).digest('hex'), dependencyVersion: variant.version });
    } finally {
      rmSync(modules, { recursive: true, force: true });
      rmSync(storage, { recursive: true, force: true });
    }
  });
});
