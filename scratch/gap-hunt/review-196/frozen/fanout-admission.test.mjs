/** DOM-3 rejects corpus-sized queued execution even when the active window is fixed. */
import { expect, test } from '@jest/globals';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
function sample(size, window, phase = 'admission') {
  const directory = mkdtempSync(join(tmpdir(), 'microdelta-fanout-'));
  try {
    const result = spawnSync(process.execPath, ['--expose-gc', 'scratch/gap-hunt/scale/dist/fanout-admission.js', String(size), String(window), phase, join(directory, 'store.sqlite')], { encoding: 'utf8', timeout: 120000 });
    expect(result.status).toBe(0);
    return JSON.parse(result.stdout.trim());
  } finally { rmSync(directory, { recursive: true, force: true }); }
}
test('prepublished roster, gate and stopped-report controls', () => {
  const held = sample(100, 8);
  expect(held).toMatchObject({ size: 100, window: 8, phase: 'admission', sourceBodies: 1, topologyUnchanged: true, admissionCalls: 8, bodies: 0, reportMembers: 100, publishedMembers: 0, pendingLaneWaitsAfterStop: 0 });
  expect(held.pendingLaneWaits).toBe(held.queuedPromises);
  expect(held.permitPromiseInits).toBeGreaterThanOrEqual(8);
  expect(sample(8, 8).queuedPromises).toBe(0);
  expect(sample(100, 8, 'body')).toMatchObject({ bodies: 8, admissionCalls: 8, publishedMembers: 0 });
});
test('fixed active window does not allocate one pending lane wait per unadmitted member', () => {
  const small = sample(100, 8);
  const larger = sample(1000, 8);
  expect([small.admissionCalls, larger.admissionCalls]).toEqual([8, 8]);
  expect([small.bodies, larger.bodies]).toEqual([0, 0]);
  // Compare scheduling allocations only; roster storage/indexing and final reports may scale.
  expect([small.pendingLaneWaitsAfterStop, larger.pendingLaneWaitsAfterStop]).toEqual([0, 0]);
  expect(larger.pendingLaneWaits - small.pendingLaneWaits).toBeLessThanOrEqual(8);
});
