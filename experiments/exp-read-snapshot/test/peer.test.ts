/** Actual owned processes must terminate despite proof I/O failure; an unresolved cleanup cannot disappear from evidence. */
import { spawn } from 'node:child_process';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { expect, test } from '@jest/globals';

import { cleanup } from './coordinator.js';
import { isRecord } from './transport.js';

/** Each probe owns at most one additional child and uses no database or provider authority. */
const probe = fileURLToPath(new URL('./peer-probe.js', import.meta.url));
/** Retained transport-only fault records are separate from the candidate's native-source evidence. */
const root = mkdtempSync(join(tmpdir(), 'microdelta-read-snapshot-peer-'));

/** Parent containment is independent of the code under qualification and records real probe exit. */
async function run(mode: string): Promise<Readonly<Record<string, unknown>>> {
  const directory = join(root, mode); mkdirSync(directory);
  const child = spawn(process.execPath, [probe, directory, mode], { stdio: ['ignore', 'pipe', 'pipe'] });
  let stdout = ''; let stderr = ''; let worker: number | undefined;
  const timer = setTimeout(() => { child.kill('SIGKILL'); if (worker !== undefined) { try { process.kill(worker, 'SIGKILL'); } catch { /* The worker may already be gone. */ } } }, 5_000);
  child.stdout.on('data', (bytes: Buffer) => {
    stdout += bytes.toString();
    for (const line of stdout.split('\n').slice(0, -1).filter(Boolean)) {
      const value: unknown = JSON.parse(line);
      if (isRecord(value) && value.kind === 'spawned' && typeof value.pid === 'number') { worker = value.pid; }
    }
  });
  child.stderr.on('data', (bytes: Buffer) => { stderr += bytes.toString(); });
  const exit = await new Promise<{ readonly code: number | null; readonly signal: NodeJS.Signals | null }>((resolve, reject) => {
    child.once('error', reject); child.once('close', (code, signal) => { clearTimeout(timer); resolve({ code, signal }); });
  });
  writeFileSync(join(directory, 'probe.json'), JSON.stringify({ exit, stdout, stderr }, null, 2));
  expect(exit).toEqual({ code: 0, signal: null });
  const values = stdout.trim().split('\n').map(line => { const value: unknown = JSON.parse(line); return value; });
  const result = values.find(value => isRecord(value) && value.kind === 'result');
  if (!isRecord(result)) { throw new Error(`Missing finite probe result: ${stderr}`); }
  expect(result.terminated).toBe(true);
  if (worker === undefined) { throw new Error('No actual child PID observed'); }
  const actualWorker = worker;
  expect(() => process.kill(actualWorker, 0)).toThrow();
  return result;
}

test.each(['process', 'records', 'stderr', 'exit', 'primary-secondary'])('artifact %s failure retains ownership/error and settles actual exit without an uncaught callback', async mode => {
  const result = await run(mode);
  expect(result.constructed).toBe(true); expect(result.ownedBeforeFault).toBe(true);
  expect(result.uncaught).toBe(false); expect(result.rejected).toBe(true);
  expect(result.primaryIdentity).toBe(true); expect(result.retainedPrimaryIdentity).toBe(true);
  expect(result.exitedSettled).toBe(true);
  if (mode === 'primary-secondary') { expect(result.retainedSecondaryIdentity).toBe(true); }
}, 10_000);
test.each(['failed-ack', 'bad-status'])('finish rejects %s rather than counting failed control cleanup as success', async mode => {
  const result = await run(mode); expect(result.rejected).toBe(true); expect(result.exitedSettled).toBe(true);
}, 10_000);
test('cleanup records observed exit and unresolved deadline as distinct per-peer outcomes', async () => {
  const calls: string[] = [];
  const outcomes: unknown = await cleanup([
    { stop: () => { calls.push('exited'); }, exited: Promise.resolve({ code: null, signal: 'SIGKILL' }) },
    { stop: () => { calls.push('unresolved'); }, exited: new Promise<never>(() => undefined) },
  ], 5);
  expect(outcomes).toEqual([
    expect.objectContaining({ kind: 'exited', exit: { code: null, signal: 'SIGKILL' } }),
    expect.objectContaining({ kind: 'unresolved', error: expect.any(Error) }),
  ]);
  expect(calls).toContain('exited'); expect(calls).toContain('unresolved');
});
