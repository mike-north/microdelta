/** Fresh processes prove duplicate explicit labels cannot merge two declared memo subjects. */
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { spawnSync } from 'node:child_process';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, expect, test } from '@jest/globals';
interface IReport { readonly slot: string; readonly kind: string; readonly reference: string; readonly score: number }
interface IProcess { readonly reports: readonly IReport[]; readonly bodies: number; readonly status: number; readonly stdout: string; readonly stderr: string }
interface ICase { readonly mode: string; readonly cold: IProcess; readonly restart: IProcess }
const evidence: ICase[] = [];
afterAll(() => { const output = process.env['MICRODELTA_DUPLICATE_LABEL_EVIDENCE']; if (output !== undefined) { writeFileSync(output, JSON.stringify({ cases: evidence, freshProcesses: evidence.length * 2 }, null, 2) + '\n'); } });
/** Validate child reports as unknown so malformed output cannot pass through a cast. */
function processRun(store: string, phase: string, mode: string): IProcess {
  const child = spawnSync(process.execPath, [fileURLToPath(new URL('./gap-hunt-duplicate-label-worker.js', import.meta.url)), store, phase, mode], { encoding: 'utf8', timeout: 60000 });
  if (child.status !== 0) { throw new Error(`Worker failed: ${child.stdout} ${child.stderr}`); }
  const value: unknown = JSON.parse(child.stdout);
  if (!Array.isArray(value)) { throw new Error('Expected report array'); }
  const reports = value.map((item: unknown): IReport => {
    if (typeof item !== 'object' || item === null || !('slot' in item) || typeof item.slot !== 'string' || !('kind' in item) || typeof item.kind !== 'string' || !('reference' in item) || typeof item.reference !== 'string' || !('data' in item) || typeof item.data !== 'object' || item.data === null || !('score' in item.data) || typeof item.data.score !== 'number') { throw new Error('Malformed report'); }
    return { slot: item.slot, kind: item.kind, reference: item.reference, score: item.data.score };
  });
  return { reports, bodies: child.stderr.split('\n').filter(line => line.startsWith('BODY:')).length, status: child.status, stdout: child.stdout, stderr: child.stderr };
}
test.each(['duplicate', 'distinct'])('%s explicit display labels preserve independent subjects across reordered restart', mode => {
  const directory = mkdtempSync(join(tmpdir(), 'microdelta-duplicate-labels-'));
  try {
    const cold = processRun(join(directory, 'history.sqlite'), 'cold', mode);
    expect(cold.bodies).toBe(2);
    expect(cold.reports.map(report => report.kind)).toEqual(['published', 'published']);
    expect(cold.reports.map(report => [report.slot, report.score])).toEqual([['first', 11], ['second', 29]]);
    expect(cold.reports[0]?.reference).not.toBe(cold.reports[1]?.reference);
    const restart = processRun(join(directory, 'history.sqlite'), 'restart', mode);
    expect(restart.bodies).toBe(0);
    expect(restart.reports.map(report => report.kind)).toEqual(['reused', 'reused']);
    expect(restart.reports.map(report => [report.slot, report.score, report.reference])).toEqual(cold.reports.map(report => [report.slot, report.score, report.reference]));
    evidence.push({ mode, cold, restart });
  } finally { rmSync(directory, { recursive: true, force: true }); }
}, 120000);
