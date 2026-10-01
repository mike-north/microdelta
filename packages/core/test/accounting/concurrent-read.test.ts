/**
 * Accounting under another process's write lock. Summaries are reads: they
 * must never take SQLite's write lock, so a summary cannot block another
 * process's intent-before-send, and a held write lock cannot make a summary
 * fail. A write that cannot get the lock within the host's bounded busy wait
 * fails as `AccountingBusyError`, carrying the host's typed `SqliteBusyError`
 * as its cause, and has done no work. An independent Node process holds an
 * IMMEDIATE transaction on the shared file well beyond that wait.
 *
 * Host classification note: the Node host recognizes driver contention with
 * `instanceof` on the driver's error class. Inside one Jest process a second
 * suite gets a fresh instance of the driver's JavaScript module while the
 * native addon keeps throwing the first instance's class, so the host can let
 * a raw driver error escape there. Contended writes therefore run in their own
 * process, as they would in production. Accounting's owner tests cover the
 * adapter's classification of the typed error directly.
 *
 * @see ../../../../docs/spec/operations.md (ACC-005, ACC-007)
 * @see https://www.sqlite.org/wal.html (readers do not block writers and a writer does not block readers)
 */
import { spawn, spawnSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { afterEach, describe, expect, test } from '@jest/globals';
import type { IUsageEstimate } from '@microdelta/accounting';

import { adaAttribution, cleanup, freshLocation, intentFor, openAccounting, tokenReport } from './support.js';
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

/** One traced step of a contended writer process. */
interface IWriterTrace {
  readonly op: string;
  readonly ok: boolean;
  readonly error: unknown;
  readonly cause: unknown;
  readonly waitedMilliseconds: unknown;
}

/**
 * Run writes in a fresh Node process while the lock is held. A fresh process
 * has exactly one instance of the host's SQLite driver, as production does;
 * the Jest process may not (see the module note on host classification).
 */
function contendedWrites(location: string, steps: IWorkerScript['steps']): readonly IWriterTrace[] {
  const script: IWorkerScript = { location, steps };
  const result = spawnSync(process.execPath, [workerPath, JSON.stringify(script)], { encoding: 'utf8', timeout: 30_000 });
  expect({ status: result.status, stderr: result.stderr }).toEqual({ status: 0, stderr: '' });
  return result.stdout.split('\n').filter((line) => line.length > 0).map((line): IWriterTrace => {
    const parsed: unknown = JSON.parse(line);
    const field = (name: string): unknown => (typeof parsed === 'object' && parsed !== null ? Reflect.get(parsed, name) : undefined);
    return { op: String(field('op')), ok: field('ok') === true, error: field('error'), cause: field('cause'), waitedMilliseconds: field('waitedMilliseconds') };
  });
}

/** An estimate converting observed tokens to assumed currency. */
const estimate: IUsageEstimate = {
  environment: 'production',
  estimate: 'estimate-1',
  attribution: adaAttribution,
  quantities: [{ unit: 'usd.micros', amount: 300 }],
  basis: { format: 'test.token-pricing', formatVersion: 1, assumptions: { microsPerInputToken: 3 } },
};

describe('accounting under another process\'s write lock', () => {
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
    expect(contendedWrites(location, [{ op: 'intent', intent: intentFor('op-3', 'req-3') }]))
      .toEqual([expect.objectContaining({ op: 'intent', ok: false, error: 'AccountingBusyError' })]);

    expect(await holder.exited).toBe(0);
    expect(accounting.recordUsageIntent(intentFor('op-3', 'req-3'))).toBe('recorded');
  }, 30_000);

  test('a write that exhausts the busy wait fails as AccountingBusyError caused by SqliteBusyError, and does no work', async () => {
    const location = freshLocation();
    const accounting = openAccounting({ location });
    accounting.recordUsageIntent(intentFor('op-1', 'req-1'));
    const before = accounting.summarizeUsage({ environment: 'production' });

    const holder = await holdWriteLock(location);
    const traces = contendedWrites(location, [
      { op: 'intent', intent: intentFor('op-2', 'req-2') },
      { op: 'acknowledge', report: tokenReport('op-1', 'req-1', 'usage-1', 100) },
      { op: 'estimate', estimate },
    ]);
    expect(traces.map(({ op, ok, error, cause }) => ({ op, ok, error, cause }))).toEqual([
      { op: 'intent', ok: false, error: 'AccountingBusyError', cause: 'SqliteBusyError' },
      { op: 'acknowledge', ok: false, error: 'AccountingBusyError', cause: 'SqliteBusyError' },
      { op: 'estimate', ok: false, error: 'AccountingBusyError', cause: 'SqliteBusyError' },
    ]);
    for (const trace of traces) {
      expect(trace.waitedMilliseconds).toEqual(expect.any(Number));
      expect(Number(trace.waitedMilliseconds)).toBeGreaterThan(0);
    }
    // No work was done: every fact is exactly as before the busy writes.
    expect(accounting.summarizeUsage({ environment: 'production' })).toEqual(before);
    expect(await holder.exited).toBe(0);
    expect(accounting.summarizeUsage({ environment: 'production' })).toEqual(before);

    // Each fact can be redelivered once the lock is free, and is then recorded for the first time.
    expect(accounting.recordUsageIntent(intentFor('op-2', 'req-2'))).toBe('recorded');
    expect(accounting.acknowledgeUsage(tokenReport('op-1', 'req-1', 'usage-1', 100)).kind).toBe('acknowledged');
    expect(accounting.recordEstimate(estimate).kind).toBe('recorded');
  }, 30_000);

});
