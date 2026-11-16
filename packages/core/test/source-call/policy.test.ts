/** Current callable sources preserve explicit source outcomes and tracked argument ownership at runtime. */
import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, expect, test } from '@jest/globals';
import type { ICompletedResultReference } from 'microdelta';

/** Only real source hooks/bodies and their lifecycle are counted. */
interface IPolicyReport {
  readonly status: 'succeeded' | 'failed';
  readonly reference?: ICompletedResultReference;
  readonly codes: readonly string[];
  readonly calls: number;
  readonly hooks: number;
  readonly previous: readonly boolean[];
  readonly phases: readonly string[];
  readonly historical?: unknown;
}
/** Validate the JSON boundary without granting malformed outcomes a TypeScript cast. */
function report(value: unknown): value is IPolicyReport {
  if (typeof value !== 'object' || value === null || !('status' in value) || (value.status !== 'succeeded' && value.status !== 'failed') || !('codes' in value) || !Array.isArray(value.codes) || !value.codes.every((code: unknown) => typeof code === 'string')) { return false; }
  if (!('calls' in value) || typeof value.calls !== 'number' || !('hooks' in value) || typeof value.hooks !== 'number' || !('previous' in value) || !Array.isArray(value.previous) || !value.previous.every((previous: unknown) => typeof previous === 'boolean') || !('phases' in value) || !Array.isArray(value.phases) || !value.phases.every((phase: unknown) => typeof phase === 'string')) { return false; }
  if ('reference' in value && value.reference !== undefined) { return typeof value.reference === 'object' && value.reference !== null && 'kind' in value.reference && value.reference.kind === 'completed-result' && 'locator' in value.reference && typeof value.reference.locator === 'string'; }
  return true;
}
/** The untyped fixture deliberately sends controls/arguments that static consumers cannot construct. */
const worker = fileURLToPath(new URL('../../../test/source-call/policy-worker.mjs', import.meta.url));
let directory: string;
beforeEach(() => { directory = mkdtempSync(join(tmpdir(), 'microdelta-source-call-policy-')); });
afterEach(() => { rmSync(directory, { recursive: true, force: true }); });
/** Each policy runs in a new process over the same immutable history. */
function run(mode: string, value = 1, earlier?: ICompletedResultReference): IPolicyReport {
  const args = [worker, join(directory, 'history.sqlite'), mode, String(value), ...(earlier === undefined ? [] : [JSON.stringify(earlier)])];
  const child = spawnSync(process.execPath, args, { encoding: 'utf8', timeout: 60_000 });
  if (child.status !== 0) { throw new Error(`Policy worker failed ${String(child.status)}: ${child.stderr}`); }
  const decoded: unknown = JSON.parse(child.stdout);
  if (!report(decoded)) { throw new Error(`Invalid policy report: ${child.stdout}`); }
  return decoded;
}
/** A successful current result must carry its exact historical locator. */
function reference(value: IPolicyReport): ICompletedResultReference { if (value.reference === undefined) { throw new Error('Missing current reference'); } return value.reference; }

test.each([['retain', 'invalid-retention'], ['forged', 'invalid-outcome'], ['argument-output', 'unsupported-result']] as const)('cold %s rejects at the source outcome boundary without publication', (mode, code) => {
  const result = run(mode);
  expect(result).toMatchObject({ status: 'failed', calls: 1, hooks: 0, previous: [false] });
  expect(result.codes).toContain(code);
  expect(result.phases).not.toContain('publish');
  expect(result.phases).not.toContain('accept');
});

test('a raw tracked value cannot cross a source call argument boundary', () => {
  const result = run('raw-view');
  expect(result).toMatchObject({ status: 'failed', calls: 0, hooks: 0 });
  expect(result.codes).toContain('invalid-argument');
  expect(result.phases).toEqual([]);
});

test('explicit retention after await names the exact eligible carrier', () => {
  const first = run('fresh');
  const retained = run('retain', 1, reference(first));
  expect(retained).toMatchObject({ status: 'succeeded', reference: reference(first), historical: { value: 1 }, calls: 1, hooks: 1, previous: [true] });
  expect(retained.phases).toContain('accept');
  expect(retained.phases).toContain('release');
  expect(retained.phases).not.toContain('publish');
});

test('a lookalike previous carrier cannot retain another carrier reference', () => {
  const first = run('fresh');
  const rejected = run('borrowed-carrier', 1, reference(first));
  expect(rejected).toMatchObject({ status: 'failed', historical: { value: 1 }, hooks: 1, previous: [true] });
  expect(rejected.codes).toContain('invalid-retention');
  expect(rejected.phases).not.toContain('publish');
  expect(rejected.phases).not.toContain('accept');
});

test('changed input consumed after await is ineligible before finality or retention', () => {
  const first = run('fresh');
  const rejected = run('retain', 2, reference(first));
  expect(rejected).toMatchObject({ status: 'failed', historical: { value: 1 }, hooks: 0, previous: [false] });
  expect(rejected.codes).toContain('invalid-retention');
  expect(rejected.phases).not.toContain('publish');
});
