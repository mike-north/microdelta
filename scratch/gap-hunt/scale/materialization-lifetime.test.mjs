/** Supported materialization lifecycle: retained root does not own dropped child wrappers. */
import { expect, test } from '@jest/globals';
import { spawnSync } from 'node:child_process';
test.each([100, 1000])('selected reads and reclaimable dropped child views: %i', size => {
  const result = spawnSync(process.execPath, ['--expose-gc', 'scratch/gap-hunt/scale/dist/materialization-lifetime.js', String(size)], { encoding: 'utf8' });
  expect(result.status).toBe(0);
  const row = JSON.parse(result.stdout.trim());
  // The baseline has no container-kind evidence; merged #155 records two narrow kinds.
  expect([0, size * 2]).toContain(row.kindObservations);
  expect(row).toMatchObject({ size, valuesChecked: size, observations: size, ordinarySubtreeReads: 0, unreadReads: 0, liveDropped: 0, liveRetained: 1, rereadNodeCalls: 3, sameFingerprint: true, aliasRejected: true, outputCollected: true, tagValidBefore: true, tagInvalidAfter: true });
});
