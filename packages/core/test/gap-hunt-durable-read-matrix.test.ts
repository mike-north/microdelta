/** TRK-5 precision and tracked closure influence, with bodies and exact references across fresh processes. */
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { spawnSync } from 'node:child_process';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, describe, expect, test } from '@jest/globals';
interface IReport { readonly kind: 'published' | 'reused'; readonly reference: string; readonly selected: number | string | boolean; readonly bodies: number; readonly stdout: string; readonly stderr: string; readonly factory: string; readonly callable: string }
interface IStage { readonly variant: string; readonly changed: boolean; readonly selected: number | string | boolean }
interface ICase { readonly name: string; readonly mode: string; readonly stages: readonly IStage[] }
interface ICapture { readonly name: string; readonly mode: string; readonly reports: readonly IReport[] }
const cases: readonly ICase[] = [
  { name: 'length ignores same-length value edit, append invalidates', mode: 'length', stages: [
    { variant: 'base', changed: true, selected: 3 }, { variant: 'same-length', changed: false, selected: 3 }, { variant: 'append', changed: true, selected: 4 }, { variant: 'append', changed: false, selected: 4 },
  ] },
  { name: 'position ignores later edit and append, insertion before index invalidates', mode: 'position', stages: [
    { variant: 'base', changed: true, selected: 20 }, { variant: 'after-position', changed: false, selected: 20 }, { variant: 'append', changed: false, selected: 20 }, { variant: 'insert-before', changed: true, selected: 10 }, { variant: 'insert-before', changed: false, selected: 10 },
  ] },
  { name: 'optional value equates missing and own undefined, actual value invalidates', mode: 'value', stages: [
    { variant: 'base', changed: true, selected: 'undefined' }, { variant: 'own-undefined', changed: false, selected: 'undefined' }, { variant: 'optional-value', changed: true, selected: 7 }, { variant: 'optional-value', changed: false, selected: 7 },
  ] },
  { name: 'own presence distinguishes missing and own undefined, value change is irrelevant', mode: 'own', stages: [
    { variant: 'base', changed: true, selected: false }, { variant: 'own-undefined', changed: true, selected: true }, { variant: 'optional-value', changed: false, selected: true }, { variant: 'optional-value', changed: false, selected: true },
  ] },
  { name: 'unchanged helper factory closes over tracked input view', mode: 'closure', stages: [
    { variant: 'base', changed: true, selected: 6 }, { variant: 'unread', changed: false, selected: 6 }, { variant: 'factor', changed: true, selected: 9 }, { variant: 'factor', changed: false, selected: 9 },
  ] },
];
interface IProcessCapture { readonly mode: string; readonly variant: string; readonly request: string; readonly status: number | null; readonly stdout: string; readonly stderr: string; readonly bodies: number }
const processes: IProcessCapture[] = [];
const captures: ICapture[] = [];
const worker = fileURLToPath(new URL('./gap-hunt-durable-read-worker.js', import.meta.url));
afterAll(() => {
  const output = process.env['MICRODELTA_DURABLE_READ_EVIDENCE'];
  if (output !== undefined) { writeFileSync(output, JSON.stringify({ cases: captures, processes, freshProcesses: processes.length, successfulStages: captures.reduce((count, entry) => count + entry.reports.length, 0) }, null, 2) + '\n'); }
});
/** A failed child is never counted as a changed/reused result. */
function run(location: string, mode: string, variant: string, request: string): IReport {
  const child = spawnSync(process.execPath, [worker, location, mode, variant, request], { encoding: 'utf8', timeout: 60000 });
  processes.push({ mode, variant, request, status: child.status, stdout: child.stdout, stderr: child.stderr, bodies: child.stderr.split('\n').filter(line => line === 'BODY:reader').length });
  if (child.status !== 0) { throw new Error(`Worker failed: ${child.stdout} ${child.stderr}`); }
  const result: unknown = JSON.parse(child.stdout);
  if (typeof result !== 'object' || result === null || !('kind' in result) || (result.kind !== 'published' && result.kind !== 'reused') || !('reference' in result) || typeof result.reference !== 'string' || !('data' in result) || typeof result.data !== 'object' || result.data === null || !('selected' in result.data) || (typeof result.data.selected !== 'number' && typeof result.data.selected !== 'string' && typeof result.data.selected !== 'boolean') || !('implementation' in result) || typeof result.implementation !== 'object' || result.implementation === null || !('factory' in result.implementation) || typeof result.implementation.factory !== 'string' || !('callable' in result.implementation) || typeof result.implementation.callable !== 'string') { throw new Error('Malformed durable worker output'); }
  return { kind: result.kind, reference: result.reference, selected: result.data.selected, factory: result.implementation.factory, callable: result.implementation.callable, bodies: child.stderr.split('\n').filter(line => line === 'BODY:reader').length, stdout: child.stdout, stderr: child.stderr };
}
describe('finite durable literal read matrix', () => {
  test.each(cases)('$name', entry => {
    const directory = mkdtempSync(join(tmpdir(), 'microdelta-durable-read-'));
    const reports: IReport[] = [];
    try {
      for (const [index, stage] of entry.stages.entries()) {
        const result = run(join(directory, 'history.sqlite'), entry.mode, stage.variant, `stage-${String(index)}`);
        reports.push(result);
        expect(result.selected).toBe(stage.selected); expect(result.bodies).toBe(stage.changed ? 1 : 0); expect(result.kind).toBe(stage.changed ? 'published' : 'reused');
        const previous = reports[index - 1];
        if (previous !== undefined) {
          expect(result.factory).toBe(previous.factory); expect(result.callable).toBe(previous.callable);
          if (stage.changed) { expect(result.reference).not.toBe(previous.reference); }
          else { expect(result.reference).toBe(previous.reference); }
        }
      }
    } finally { captures.push({ name: entry.name, mode: entry.mode, reports }); rmSync(directory, { recursive: true, force: true }); }
  }, 120000);
});
