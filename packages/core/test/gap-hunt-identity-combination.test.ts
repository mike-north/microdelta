/** TRK-7: consuming several input identities neither selects the memo subject nor derives its output identity. */
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { spawnSync } from 'node:child_process';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { expect, test } from '@jest/globals';
interface IStage { readonly variant: string; readonly changed: boolean; readonly first: string; readonly second: string }
interface IReport { readonly kind: 'published' | 'reused'; readonly reference: string; readonly key: string; readonly first: string; readonly second: string; readonly bodies: number }
interface IProcessCapture { readonly stage: IStage; readonly requestKey: string; readonly status: number | null; readonly stdout: string; readonly stderr: string; readonly report: IReport }
const stages: readonly IStage[] = [
  { variant: 'base', changed: true, first: 'first:a', second: 'second:a' },
  { variant: 'base', changed: false, first: 'first:a', second: 'second:a' },
  { variant: 'unread', changed: false, first: 'first:a', second: 'second:a' },
  { variant: 'first', changed: true, first: 'first:b', second: 'second:a' },
  { variant: 'second', changed: true, first: 'first:b', second: 'second:b' },
  { variant: 'second', changed: false, first: 'first:b', second: 'second:b' },
];
const worker = fileURLToPath(new URL('./gap-hunt-identity-combination-worker.js', import.meta.url));
/** Narrow the subprocess transport; no assertion cast may turn malformed data into a passing result. */
function reportOf(stdout: string, stderr: string): IReport {
  const value: unknown = JSON.parse(stdout);
  if (typeof value !== 'object' || value === null || !('kind' in value) || (value.kind !== 'published' && value.kind !== 'reused') || !('reference' in value) || typeof value.reference !== 'string' || !('data' in value) || typeof value.data !== 'object' || value.data === null || !('key' in value.data) || typeof value.data.key !== 'string' || !('first' in value.data) || typeof value.data.first !== 'string' || !('second' in value.data) || typeof value.data.second !== 'string') { throw new Error('Malformed identity report'); }
  return { kind: value.kind, reference: value.reference, key: value.data.key, first: value.data.first, second: value.data.second, bodies: stderr.split('\n').filter(line => line === 'BODY:combined').length };
}
test('two consumed input identities invalidate independently while the explicit output identity and memo subject stay fixed across six fresh processes', () => {
  const directory = mkdtempSync(join(tmpdir(), 'microdelta-identities-'));
  const captures: IProcessCapture[] = [];
  try {
    for (const [index, stage] of stages.entries()) {
      const requestKey = `stage-${String(index)}`;
      const child = spawnSync(process.execPath, [worker, join(directory, 'history.sqlite'), stage.variant, requestKey], { encoding: 'utf8', timeout: 60000 });
      expect(child.status).toBe(0);
      const report = reportOf(child.stdout, child.stderr);
      captures.push({ stage, requestKey, status: child.status, stdout: child.stdout, stderr: child.stderr, report });
      expect(report).toMatchObject({ key: 'output:fixed', first: stage.first, second: stage.second, bodies: stage.changed ? 1 : 0, kind: stage.changed ? 'published' : 'reused' });
      const previous = captures[index - 1];
      if (previous !== undefined) {
        if (stage.changed) { expect(report.reference).not.toBe(previous.report.reference); }
        else { expect(report.reference).toBe(previous.report.reference); }
      }
    }
    expect(captures).toHaveLength(6);
    expect(captures.map(capture => capture.report.bodies)).toEqual([1, 0, 0, 1, 1, 0]);
    expect(new Set(captures.map(capture => capture.report.reference)).size).toBe(3);
  } finally {
    const output = process.env['MICRODELTA_IDENTITY_EVIDENCE'];
    if (output !== undefined) { writeFileSync(output, JSON.stringify({ captures, freshProcesses: captures.length }, null, 2) + '\n'); }
    rmSync(directory, { recursive: true, force: true });
  }
}, 120000);
