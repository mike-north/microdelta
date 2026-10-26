/** TEST-6 assertions state independent identities, values, and execution cutoffs before fixture implementation. */
import { execFile } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { expect, test } from '@jest/globals';
import { assertReactiveCostQualification, parseReactiveCostReceipts } from './reactive-cost.js';
import type { IReactiveCostReceipt } from './reactive-cost.js';

/** Fresh Node processes prevent local tags or author closures from carrying restart validity. */
const execute = promisify(execFile);
/** Qualification jobs own a separate History file and never touch the accepted report scale store. */
async function scenario(suppressCachedRead = false): Promise<readonly IReactiveCostReceipt[]> {
  const directory = mkdtempSync(join(tmpdir(), 'reactive-cost-'));
  try {
    for (const phase of ['cold', 'restart'] as const) {
      await execute(process.execPath, [new URL('./reactive-cost-worker.js', import.meta.url).pathname, JSON.stringify({ directory, phase, population: 16, memberIterations: 1_000, foldIterations: 2_000, leaseMilliseconds: 120_000, suppressCachedRead })], { timeout: 90_000 });
    }
    // The worker writes only fixture-owned, typed receipts. Runtime assertions below
    // independently verify the values rather than trusting a success exit alone.
    const receipts = parseReactiveCostReceipts(readFileSync(join(directory, 'receipts.json'), 'utf8'));
    return receipts;
  } finally { rmSync(directory, { recursive: true, force: true }); }
}

test('TEST-6 cost graph, detached filter, exact restart and cached-child observation satisfy independent outcomes', async () => {
  const receipts = await scenario();
  assertReactiveCostQualification(receipts, 16);
  const cold = receipts[0];
  if (cold === undefined) { throw new Error('missing cold receipt'); }
  expect(cold.members.map(member => [member.key, member.value.selected, member.value.sibling])).toEqual(Array.from({ length: 16 }, (_, index) => [`key-${String(index).padStart(3, '0')}`, (index + 1) * 3, 100 + index]));
  expect(cold.aggregate.value).toEqual({ total: 272, count: 16 });
  expect(cold.bodies).toMatchObject({ expensive: 16, leaf: 16, parent: 16, fold: 1 });
  expect(cold.filter?.views.map(view => view.map(member => member.key))).toEqual([
    Array.from({ length: 16 }, (_, index) => `key-${String(index).padStart(3, '0')}`),
    [], ['key-013', 'key-014', 'key-015'], ['key-013', 'key-014', 'key-015'],
  ]);
  expect(cold.filter?.before).toEqual(cold.filter?.after);
  expect(receipts.map(receipt => receipt.phase)).toEqual(['cold', 'restart', 'parent-only', 'unread-child', 'consumed-child', 'unread-input', 'membership']);
  expect(new Set(receipts.map(receipt => receipt.pid)).size).toBe(2);
}, 200_000);

test('named negative control: suppressed cached-child selected-field observation fails the consumed-output oracle', async () => {
  const receipts = await scenario(true);
  expect(() => assertReactiveCostQualification(receipts, 16)).toThrow('consumed-child parent execution');
}, 200_000);

test('qualification oracle rejects omitted phases and an empty population', () => {
  expect(() => assertReactiveCostQualification([], 16)).toThrow('phase');
  expect(() => assertReactiveCostQualification([], 0)).toThrow('population');
});

test('process jobs and receipts reject malformed identities and unbounded population', async () => {
  const { parseReactiveCostReceipts, validateReactiveCostJob } = await import('./reactive-cost.js');
  expect(() => parseReactiveCostReceipts('[{"phase":"cold"}]')).toThrow('receipt');
  expect(() => parseReactiveCostReceipts('null')).toThrow('receipt');
  expect(() => validateReactiveCostJob({ directory: '/tmp', phase: 'cold', population: 150_000, memberIterations: 1, foldIterations: 1, leaseMilliseconds: 1, suppressCachedRead: false })).toThrow('job');
});

test('generated alpha fixture declarations preserve readonly exact outcomes and bounded process phases', async () => {
  await execute(process.execPath, [join(process.cwd(), 'node_modules/tsd/dist/cli.js'), '--typings', '../.test-build/fixtures/contribution-report/reactive-cost.d.ts', '--files', 'reactive-cost.test-d.ts'], { cwd: join(process.cwd(), 'fixtures/contribution-report/test-d'), timeout: 30_000 });
}, 40_000);

test('frozen cost budgets retain the observed expensive kernels and bound each OS phase', async () => {
  const { reactiveCostBudgets } = await import('./reactive-cost-qualification.js');
  expect(reactiveCostBudgets).toEqual({ memberIterations: 50_000_000, foldIterations: 500_000_000, leaseMilliseconds: 300_000, phaseTimeoutMilliseconds: 180_000 });
});

test('receipt parser rejects coercible non-string phases before narrowing', async () => {
  const receipts = await scenario();
  const cold = receipts[0];
  if (cold === undefined) { throw new Error('missing valid receipt for parser counterexamples'); }
  for (const phase of [['cold'], [['cold']], { toString: 'cold' }, true, 1, null]) {
    expect(() => parseReactiveCostReceipts(JSON.stringify([{ ...cold, phase }]))).toThrow('receipt');
  }
  expect(parseReactiveCostReceipts(JSON.stringify(receipts))).toEqual(receipts);
}, 200_000);

test('receipt parser rejects nonnumeric extra request timings while allowing additional numeric timings', async () => {
  const receipts = await scenario();
  const cold = receipts[0];
  if (cold === undefined) { throw new Error('missing valid receipt for timing counterexample'); }
  for (const extra of ['oops', null, true, {}, [], -1]) {
    const malformed = { ...cold, requestWallMilliseconds: { ...cold.requestWallMilliseconds, extra } };
    expect(() => parseReactiveCostReceipts(JSON.stringify([malformed]))).toThrow('receipt');
  }
  const overflow = JSON.stringify([{ ...cold, requestWallMilliseconds: { ...cold.requestWallMilliseconds, extra: 1 } }]).replace('\"extra\":1', '\"extra\":1e400');
  expect(() => parseReactiveCostReceipts(overflow)).toThrow('receipt');
  const missing = { ...cold, requestWallMilliseconds: { aggregate: 1, parents: 1 } };
  expect(() => parseReactiveCostReceipts(JSON.stringify([missing]))).toThrow('receipt');
  const additional = { ...cold, requestWallMilliseconds: { ...cold.requestWallMilliseconds, extra: 1 } };
  expect(parseReactiveCostReceipts(JSON.stringify([additional]))).toEqual([additional]);
}, 200_000);
