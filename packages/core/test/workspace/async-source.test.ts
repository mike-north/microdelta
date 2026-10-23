/**
 * RES-004/005/006 and REUSE-004 through independent facade processes: awaited
 * source work preserves explicit publication, retention and failure boundaries.
 * Both direct and template-member callbacks use the same runtime assertions.
 */
import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { afterEach, beforeEach, describe, expect, test } from '@jest/globals';

/** A completed reference is an exact historical locator, never a latest alias. */
interface IReference { readonly kind: 'completed-result'; readonly locator: string }

/** Only the fields these tests observe in the worker's JSON report. */
interface IReport {
  readonly kind: 'returned' | 'failed';
  readonly settled?: { readonly kind: string; readonly reference?: IReference };
  readonly historical?: { readonly value: number };
  readonly code?: string;
  readonly calls: number;
  readonly phases: readonly string[];
}

/** The JS fixture consumes generated package output in a separate process. */
const worker = fileURLToPath(new URL('../../../test/workspace/async-source-worker.mjs', import.meta.url));
let directory: string;

/** Check the subprocess report at the JSON boundary before tests use its references. */
function isReport(value: unknown): value is IReport {
  if (typeof value !== 'object' || value === null || !('kind' in value) || !('calls' in value) || !('phases' in value)) {
    return false;
  }
  if ((value.kind !== 'returned' && value.kind !== 'failed') || typeof value.calls !== 'number' || !Array.isArray(value.phases) || !value.phases.every((phase: unknown) => typeof phase === 'string')) {
    return false;
  }
  const report = value;
  if ('settled' in report && report.settled !== undefined) {
    if (typeof report.settled !== 'object' || report.settled === null || !('kind' in report.settled) || typeof report.settled.kind !== 'string') {
      return false;
    }
    if ('reference' in report.settled && report.settled.reference !== undefined) {
      const reference = report.settled.reference;
      if (typeof reference !== 'object' || reference === null || !('kind' in reference) || reference.kind !== 'completed-result' || !('locator' in reference) || typeof reference.locator !== 'string') {
        return false;
      }
    }
  }
  if ('historical' in report && report.historical !== undefined && (typeof report.historical !== 'object' || report.historical === null || !('value' in report.historical) || typeof report.historical.value !== 'number')) {
    return false;
  }
  return !('code' in report) || report.code === undefined || typeof report.code === 'string';
}

beforeEach(() => {
  directory = mkdtempSync(join(tmpdir(), 'microdelta-async-source-'));
});
afterEach(() => {
  rmSync(directory, { recursive: true, force: true });
});

/** Execute one independent source check against the same durable store. */
function run(target: 'direct' | 'template', mode: string, value: number, earlier?: IReference): IReport {
  const args = [worker, join(directory, 'history.sqlite'), target, mode, String(value)];
  if (earlier !== undefined) {
    args.push(JSON.stringify(earlier));
  }
  const child = spawnSync(process.execPath, args, { encoding: 'utf8' });
  expect(child.status).toBe(0);
  const decoded: unknown = JSON.parse(child.stdout);
  if (!isReport(decoded)) {
    throw new Error(`invalid async source worker report: ${child.stdout}`);
  }
  return decoded;
}

/** A successful source result must carry its immutable historical reference. */
function reference(report: IReport): IReference {
  const selected = report.settled?.reference;
  if (selected === undefined) {
    throw new Error(`source did not return a reference: ${JSON.stringify(report)}`);
  }
  return selected;
}

describe.each(['direct', 'template'] as const)('%s awaited source outcome', (target) => {
  test('cold retention after await is rejected without publishing an eligible result', () => {
    const rejected = run(target, 'retain-missing', 1);
    expect(rejected).toMatchObject({ kind: 'failed', code: 'invalid-retention', calls: 1 });
    expect(rejected.phases).not.toContain('publish');
    expect(rejected.phases).not.toContain('accept');
  });

  test('fresh equal data publishes again, then explicit retain keeps the exact earlier reference', () => {
    const first = run(target, 'fresh', 1);
    expect(first).toMatchObject({ kind: 'returned', settled: { kind: 'published' }, calls: 1 });
    const equal = run(target, 'fresh', 1, reference(first));
    expect(equal).toMatchObject({ kind: 'returned', settled: { kind: 'published' }, historical: { value: 1 }, calls: 1 });
    expect(reference(equal)).not.toEqual(reference(first));
    const retained = run(target, 'retain', 1, reference(first));
    expect(retained).toMatchObject({ kind: 'returned', settled: { kind: 'reused', reference: reference(equal) }, historical: { value: 1 }, calls: 1 });
  });

  test('a consumed input read after await makes a changed previous result ineligible for retention', () => {
    const first = run(target, 'fresh', 1);
    const changed = run(target, 'retain-missing', 2, reference(first));
    expect(changed).toMatchObject({ kind: 'failed', code: 'invalid-retention', historical: { value: 1 }, calls: 1 });
    expect(changed.phases).not.toContain('publish');
    expect(changed.phases).not.toContain('accept');
  });

  test.each([['throw', 'execution-failure'], ['forged', 'invalid-outcome'], ['retain-missing', 'invalid-retention']] as const)(
    '%s after await does not publish or accept and leaves earlier history readable', (mode, code) => {
      const first = run(target, 'fresh', 1);
      const failed = run(target, mode, mode === 'retain-missing' ? 2 : 1, reference(first));
      expect(failed).toMatchObject({ kind: 'failed', code, historical: { value: 1 }, calls: 1 });
      expect(failed.phases).not.toContain('publish');
      expect(failed.phases).not.toContain('accept');
    },
  );
});
