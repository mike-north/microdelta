/** Async sources preserve trusted fresh/retain controls and propagate failures. */
import { expect, test } from '@jest/globals';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
const worker = fileURLToPath(new URL('./async-source-worker.mjs', import.meta.url));
function run(mode, location) {
  const child = spawnSync(process.execPath, [worker, mode, location], { encoding: 'utf8' });
  expect(child.status).toBe(0);
  return JSON.parse(child.stdout);
}
test('async fresh publishes and async retain after restart preserves its exact reference', () => {
  const directory = mkdtempSync(join(tmpdir(), 'microdelta-async-source-'));
  try {
    const location = join(directory, 'store.sqlite');
    const fresh = run('fresh', location);
    const retained = run('retain', location);
    expect(fresh).toMatchObject({ kind: 'returned', calls: 1, result: { kind: 'published' } });
    expect(retained).toMatchObject({ kind: 'returned', calls: 1, result: { kind: 'reused', reference: fresh.result.reference } });
  } finally { rmSync(directory, { recursive: true, force: true }); }
});
test('an async source rejection is a failure rather than successful fresh/retain', () => {
  const directory = mkdtempSync(join(tmpdir(), 'microdelta-async-failure-'));
  try { expect(run('throw', join(directory, 'store.sqlite'))).toMatchObject({ kind: 'threw', calls: 1 }); }
  finally { rmSync(directory, { recursive: true, force: true }); }
});
