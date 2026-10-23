/** Real-workspace regression: a subject cannot reuse evidence selected through an obsolete occurrence. */
import { expect, test } from '@jest/globals';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
const base = fileURLToPath(new URL('./', import.meta.url));
const worker = join(base, 'occurrence-dist/scratch/gap-hunt/review-178/occurrence-worker.js');
const receipts = join(base, 'local-results');
mkdirSync(receipts, { recursive: true });
let request = 0;
function inStore(check) {
  const directory = mkdtempSync(join(tmpdir(), 'microdelta-occurrence-jest-'));
  try {
    check((mode) => {
      request += 1;
      const child = spawnSync(process.execPath, [worker, join(directory, 'history.sqlite'), mode, String(request)], { encoding: 'utf8', timeout: 30000 });
      expect(child.status).toBe(0);
      const receipt = JSON.parse(child.stdout);
      writeFileSync(join(receipts, `jest-receipt-${String(request)}.json`), `${JSON.stringify(receipt, null, 2)}\n`);
      const events = receipt.events.filter(event => event.kind === 'step');
      return { ...receipt.result, bodies: events.filter(event => event.event.phase === 'execute').length, publications: events.filter(event => event.event.phase === 'publish').length };
    });
  } finally { rmSync(directory, { recursive: true, force: true }); }
}
test('cold original graph computes first input and publishes once', () => inStore(run => {
  expect(run('cold')).toMatchObject({ data: 1, kind: 'published', bodies: 1, publications: 1 });
}));
test('unchanged restart retains the exact reference without execution/publication', () => inStore(run => {
  const cold = run('cold');
  expect(run('cold')).toEqual({ ...cold, kind: 'reused', bodies: 0, publications: 0 });
}));
test('fresh explicit subject computes current second input', () => inStore(run => {
  const cold = run('cold');
  const fresh = run('fresh-subject');
  expect(fresh).toMatchObject({ data: 2, kind: 'published', bodies: 1, publications: 1 });
  expect(fresh.reference).not.toEqual(cold.reference);
}));
test('independently cold swapped graph computes second input', () => inStore(run => {
  expect(run('swap')).toMatchObject({ data: 2, kind: 'published', bodies: 1, publications: 1 });
}));
test('current subject moved to another occurrence validates its current from edge', () => inStore(run => {
  const cold = run('cold');
  const swapped = run('swap');
  expect(swapped).toMatchObject({ data: 2, kind: 'published', bodies: 1, publications: 1 });
  expect(swapped.reference).not.toEqual(cold.reference);
}));
