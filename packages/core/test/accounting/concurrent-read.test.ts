/**
 * Summaries are reads: they must never take SQLite's write lock, so a summary
 * cannot block another process's intent-before-send, and another process
 * holding the write lock cannot make a summary fail. An independent Node
 * process holds an IMMEDIATE transaction on the shared file well beyond the
 * host's bounded busy wait while this process summarizes.
 *
 * @see ../../../../docs/spec/operations.md (ACC-005, ACC-007)
 * @see https://www.sqlite.org/wal.html (readers do not block writers and a writer does not block readers)
 */
import { spawn } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { afterEach, describe, expect, test } from '@jest/globals';

import { cleanup, freshLocation, intentFor, openAccounting, tokenReport } from './support.js';
import type { IWorkerScript } from './worker.js';

afterEach(cleanup);

/** The emitted worker module beside this test. */
const workerPath = join(dirname(fileURLToPath(import.meta.url)), 'worker.js');

/** How long the other process holds the write lock: well beyond the host's 500 ms busy wait. */
const holdMilliseconds = 4_000;

/** A running lock holder and a promise of its exit code. */
interface ILockHolder {
  readonly exited: Promise<number | null>;
}

/** Start a worker process that holds the write lock, resolving once it announces the lock is held. */
async function holdWriteLock(location: string): Promise<ILockHolder> {
  const script: IWorkerScript = { location, steps: [{ op: 'hold-write-lock', milliseconds: holdMilliseconds }] };
  const child = spawn(process.execPath, [workerPath, JSON.stringify(script)], { stdio: ['ignore', 'pipe', 'pipe'] });
  const exited = new Promise<number | null>((resolve) => {
    child.on('exit', (code) => {
      resolve(code);
    });
  });
  await new Promise<void>((resolve, reject) => {
    let output = '';
    child.stdout.setEncoding('utf8');
    child.stdout.on('data', (chunk: string) => {
      output += chunk;
      if (output.includes('"held":true')) {
        resolve();
      }
    });
    child.on('exit', (code) => {
      reject(new Error(`lock holder exited with ${String(code)} before holding the lock: ${output}`));
    });
  });
  return { exited };
}

describe('summaries under another process\'s write lock', () => {
  test('a summary returns while another process holds the write lock, and a write is the one that waits', async () => {
    const location = freshLocation();
    const accounting = openAccounting({ location });
    accounting.recordUsageIntent(intentFor('op-1', 'req-1'));
    accounting.recordUsageIntent(intentFor('op-2', 'req-2'));
    accounting.acknowledgeUsage(tokenReport('op-1', 'req-1', 'usage-1', 100));

    const holder = await holdWriteLock(location);
    const started = Date.now();
    const summary = accounting.summarizeUsage({ environment: 'production' });
    const elapsed = Date.now() - started;

    expect(summary).toMatchObject({ status: 'incomplete', reports: 1, observed: [{ unit: 'tokens.input', amount: 100 }] });
    expect(summary.unknown.map((gap) => gap.requestAttempt)).toEqual(['req-2']);
    // The summary did not wait for the lock.
    expect(elapsed).toBeLessThan(holdMilliseconds);
    // Control: the lock was still held after the summary, so a write cannot proceed within the bounded wait.
    expect(() => accounting.recordUsageIntent(intentFor('op-3', 'req-3'))).toThrow(/busy|locked/iu);

    expect(await holder.exited).toBe(0);
    expect(accounting.recordUsageIntent(intentFor('op-3', 'req-3'))).toBe('recorded');
  }, 20_000);
});
