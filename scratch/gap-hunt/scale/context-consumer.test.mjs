/** Correctness controls use values/capture counts, never timing thresholds. */
import { expect, test } from '@jest/globals';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
const worker = 'scratch/gap-hunt/scale/dist/context-consumer.js';
test.each([{ mode: 'tracking', isolated: false, observed: 20 }, { mode: 'tracking', isolated: true, observed: 20 }, { mode: 'unentered', isolated: false, observed: 0 }, { mode: 'fresh', isolated: false, observed: 0 }])('caller scope and exact capture/source outcomes: $mode isolated=$isolated', ({ mode, isolated, observed }) => {
  const directory = mkdtempSync(join(tmpdir(), 'microdelta-context-control-'));
  try {
    const result = spawnSync(process.execPath, ['--expose-gc', worker, mode, ...(isolated ? ['--isolated'] : [])], { encoding: 'utf8', env: { ...process.env, CONTEXT_RUNS: '20', CONTEXT_BATCH: '10', CONTEXT_CONFIRM: '1', CONTEXT_STORE: join(directory, 'store.sqlite') } });
    expect(result.status).toBe(0);
    const rows = result.stdout.trim().split('\n').map(line => JSON.parse(line));
    expect(rows).toHaveLength(2);
    expect(rows[1]).toMatchObject({ mode, isolated, runs: 20, observed, bodies: mode === 'fresh' ? 20 : 0 });
    // Confirm a second collection observes the same scalar heap census after task completion.
    expect(rows[1].liveALSConfirm).toBe(rows[1].liveALS);
  } finally { rmSync(directory, { recursive: true, force: true }); }
});
