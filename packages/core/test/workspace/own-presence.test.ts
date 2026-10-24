/** TRK-5 precision and tracked closure influence, with bodies and exact references across fresh processes. */
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { spawnSync } from 'node:child_process';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, describe, expect, test } from '@jest/globals';
/** One successful process reports the published or reused exact result and actual body count. */
interface IReport { readonly kind: 'published' | 'reused'; readonly reference: string; readonly selected: number | string | boolean; readonly bodies: number; readonly stdout: string; readonly stderr: string; readonly factory: string; readonly callable: string }
/** One independent-process input change and its required semantic outcome. */
interface IStage {
  readonly variant: string;
  /** Whether the reader body must run and publish a new completed result. */
  readonly executes: boolean;
  readonly selected: number | string | boolean;
  /** An older retained candidate to reuse; absent means compare with the preceding stage. */
  readonly reusesStage?: number;
}
/** One reader owns an isolated same-store sequence so candidate history cannot cross cases. */
interface ICase { readonly name: string; readonly mode: string; readonly stages: readonly IStage[] }
/** Optional diagnostic evidence retains all successfully validated process reports. */
interface ICapture { readonly name: string; readonly mode: string; readonly reports: readonly IReport[] }
/** Controls distinguish each selected operation from irrelevant changes. */
const cases: readonly ICase[] = [
  { name: 'length ignores same-length value edit, append invalidates', mode: 'length', stages: [
    { variant: 'base', executes: true, selected: 3 }, { variant: 'same-length', executes: false, selected: 3 }, { variant: 'append', executes: true, selected: 4 }, { variant: 'append', executes: false, selected: 4 },
  ] },
  { name: 'position ignores later edit and append, insertion before index invalidates', mode: 'position', stages: [
    { variant: 'base', executes: true, selected: 20 }, { variant: 'after-position', executes: false, selected: 20 }, { variant: 'append', executes: false, selected: 20 }, { variant: 'insert-before', executes: true, selected: 10 }, { variant: 'insert-before', executes: false, selected: 10 },
  ] },
  { name: 'optional value equates missing and own undefined, actual value invalidates', mode: 'value', stages: [
    { variant: 'base', executes: true, selected: 'undefined' }, { variant: 'own-undefined', executes: false, selected: 'undefined' }, { variant: 'optional-value', executes: true, selected: 7 }, { variant: 'optional-value', executes: false, selected: 7 },
  ] },
  { name: 'own presence distinguishes missing and own undefined, value change is irrelevant', mode: 'own', stages: [
    { variant: 'base', executes: true, selected: false }, { variant: 'base', executes: false, selected: false }, { variant: 'inherited', executes: false, selected: false }, { variant: 'own-undefined', executes: true, selected: true }, { variant: 'optional-value', executes: false, selected: true }, { variant: 'owned-sibling', executes: false, selected: true }, { variant: 'owned-sibling', executes: false, selected: true },
  ] },
  { name: 'lazy child own presence preserves exact parent reuse when only owned values change', mode: 'lazy-own', stages: [
    { variant: 'base', executes: true, selected: false }, { variant: 'base', executes: false, selected: false },
    { variant: 'own-undefined', executes: true, selected: true }, { variant: 'optional-value', executes: false, selected: true },
    { variant: 'owned-sibling', executes: false, selected: true }, { variant: 'owned-sibling', executes: false, selected: true },
  ] },
  { name: 'membership observes supported inheritance independently of own presence', mode: 'membership', stages: [
    { variant: 'base', executes: true, selected: false }, { variant: 'inherited', executes: true, selected: true },
    { variant: 'own-undefined', executes: false, selected: true }, { variant: 'optional-value', executes: false, selected: true },
    { variant: 'owned-sibling', executes: false, selected: true }, { variant: 'owned-sibling', executes: false, selected: true },
    { variant: 'base', executes: false, selected: false, reusesStage: 0 }, { variant: 'base', executes: false, selected: false },
  ] },
  { name: 'unchanged helper factory closes over tracked input view', mode: 'closure', stages: [
    { variant: 'base', executes: true, selected: 6 }, { variant: 'unread', executes: false, selected: 6 }, { variant: 'factor', executes: true, selected: 9 }, { variant: 'factor', executes: false, selected: 9 },
  ] },
];
/** Raw process outcomes retain failures without counting them as successful stages. */
interface IProcessCapture { readonly mode: string; readonly variant: string; readonly request: string; readonly status: number | null; readonly stdout: string; readonly stderr: string; readonly bodies: number }
/** Raw subprocess evidence is optional output, never an input to acceptance. */
const processes: IProcessCapture[] = [];
/** Per-reader successful receipts supplement the assertions below. */
const captures: ICapture[] = [];
/** The emitted consumer worker imports the facade rather than private owner implementations. */
const worker = fileURLToPath(new URL('./own-presence-worker.js', import.meta.url));
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
        expect(result.selected).toBe(stage.selected); expect(result.bodies).toBe(stage.executes ? 1 : 0); expect(result.kind).toBe(stage.executes ? 'published' : 'reused');
        const previous = reports[index - 1];
        if (previous !== undefined) {
          expect(result.factory).toBe(previous.factory); expect(result.callable).toBe(previous.callable);
          if (stage.reusesStage !== undefined) {
            // Returning to an earlier input may select an older exact candidate without running a body.
            expect(result.reference).toBe(reports[stage.reusesStage]?.reference);
          } else if (stage.executes) {
            expect(result.reference).not.toBe(previous.reference);
          } else {
            expect(result.reference).toBe(previous.reference);
          }
        }
      }
    } finally { captures.push({ name: entry.name, mode: entry.mode, reports }); rmSync(directory, { recursive: true, force: true }); }
  }, 120000);
});
