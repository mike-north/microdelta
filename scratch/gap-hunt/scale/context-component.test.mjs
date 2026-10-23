/** Node 24/26 diagnostic: completed fresh captures must not accumulate host contexts. */
import { expect, test } from '@jest/globals';
import { spawnSync } from 'node:child_process';
const worker = 'scratch/gap-hunt/scale/dist/context-consumer.js';
function run(extra = []) {
  const result = spawnSync(process.execPath, ['--expose-gc', worker, 'component', ...extra], { encoding: 'utf8', env: { ...process.env, CONTEXT_RUNS: '300', CONTEXT_BATCH: '100', CONTEXT_CONFIRM: '1' } });
  expect(result.status).toBe(0);
  return result.stdout.trim().split('\n').map(line => JSON.parse(line));
}
test('caller await/error/nesting/concurrency and closed-frame controls', () => {
  expect(run(['--semantics'])).toEqual([{ semantics: 'passed' }]);
});
test('completed fresh captures leave a bounded continuing caller context', () => {
  // Optional external boundary demonstrates a green control without modifying library code.
  const rows = run(process.env.CONTEXT_COMPONENT_ISOLATED === '1' ? ['--isolated'] : []);
  expect(rows.map(row => row.observed)).toEqual([100, 200, 300]);
  expect(rows.every(row => row.liveALS === row.liveALSConfirm)).toBe(true);
  // Permit a small finite diagnostic/runtime allowance, but never one new ALS per capture.
  // Compare batches rather than imposing a platform-independent absolute count.
  expect(rows[2].liveALS - rows[0].liveALS).toBeLessThanOrEqual(4);
});
