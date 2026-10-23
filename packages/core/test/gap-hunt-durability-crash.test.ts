/** File-fed process-termination evidence for PUB-001 through PUB-004. */
import { spawnSync } from 'node:child_process';
import { appendFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { afterEach, expect, test } from '@jest/globals';

import { cleanup, freshLocation, logicalStore, openHistory, scope } from './durable-history/support.js';
import type { IWorkerStep } from './durable-history/worker.js';

afterEach(cleanup);

/** A complete saved intent whose payload is large enough to exercise real pages. */
const request = { ...scope, subject: 'gap-hunt:crash', version: 1, attemptKey: 'fault', intentDigest: 'intent:fault' };

/** Execute a synthetic script from a file, preserving the last trace as kill evidence. */
function run(location: string, steps: readonly IWorkerStep[]) {
  const file = join(dirname(location), 'script.json');
  writeFileSync(file, JSON.stringify({ location, store: logicalStore, steps }));
  const worker = fileURLToPath(new URL('./gap-hunt-durability-worker.js', import.meta.url));
  return spawnSync(process.execPath, [worker, file], { encoding: 'utf8', timeout: 10_000 });
}

for (const boundary of ['allocate', 'stage', 'publish', 'committed', 'wal-tail'] as const) {
  test(`file-fed SIGKILL at ${boundary} has explicit durable recovery`, () => {
    const location = freshLocation();
    const steps: IWorkerStep[] = [{ op: 'time', at: 1_000 }, { op: 'acquire', holder: 'doomed', lease: 1_000 }];
    if (boundary === 'allocate') {steps.push({ op: 'arm', role: 'allocate' });}
    steps.push({ op: 'allocate', request });
    if (boundary === 'stage') {steps.push({ op: 'arm', role: 'stage' });}
    steps.push({ op: 'stage', payload: { value: 'x'.repeat(100_000) }, label: 'fault' });
    if (boundary === 'publish') {steps.push({ op: 'arm', role: 'publish' });}
    steps.push({ op: 'publish' });
    if ((boundary === 'committed' || boundary === 'wal-tail')) {steps.push({ op: 'kill' });}
    const killed = run(location, steps);
    expect({ signal: killed.signal, status: killed.status, stderr: killed.stderr, error: killed.error }).toEqual({ signal: 'SIGKILL', status: null, stderr: '', error: undefined });
    // A kill before any trace is a failed launch, never evidence of the planned boundary.
    const traces = killed.stdout.trim().split('\n').map((line): unknown => JSON.parse(line));
    const previous = (boundary === 'committed' || boundary === 'wal-tail') ? 'publish' : 'arm';
    expect(traces.at(-1)).toMatchObject({ op: previous, ok: true, ...(previous === 'arm' ? { value: boundary } : {}) });
    if (boundary === 'wal-tail') {
      // Simulate an incomplete next WAL frame after the acknowledged commit.
      // SQLite must ignore this uncommitted tail while retaining earlier commits.
      appendFileSync(`${location}-wal`, new Uint8Array(31).fill(123));
    }
    const history = openHistory({ location });
    const recovery = history.recoverAttempt(request);
    if (boundary === 'allocate') {
      expect(recovery).toEqual({ kind: 'absent' });
    } else if ((boundary === 'committed' || boundary === 'wal-tail')) {
      expect(recovery.kind).toBe('completed');
      if (recovery.kind !== 'completed') {throw new Error('missing completed result');}
      expect(history.reader.readSubtree(recovery.reference, [])).toEqual({ value: 'x'.repeat(100_000) });
    } else {
      expect(recovery).toMatchObject({ kind: 'incomplete', attempt: { state: boundary === 'stage' ? 'allocated' : 'staged', result: null } });
      expect(history.readCurrent({ ...scope, subject: request.subject })).toBeUndefined();
    }
  });
}
