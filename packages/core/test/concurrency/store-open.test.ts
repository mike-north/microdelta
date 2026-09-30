/**
 * Several processes opening one new durable History store at the same
 * instant. Under the owner's M5 concurrency decision, runs that start together
 * on a store that does not exist yet must not crash: every process must be
 * able to open it, so that a later writer lease can make one wait for the
 * other. Each opener is a separate Node process running the production
 * History over Node's real SQLite capability, because the hazard is SQLite's
 * cross-process locking while a new file is switched to write-ahead logging.
 * Every trial uses a fresh nonexistent file and every opener in every trial
 * must either open or fail with the typed `SqliteBusyError`; a raw driver error
 * or any other failure is a defect. No minimum success rate is required,
 * because a loaded host can legitimately exhaust the bounded busy wait.
 *
 * @see https://www.sqlite.org/wal.html#activating_and_configuring_wal_mode
 */
import { afterEach, describe, expect, test } from '@jest/globals';
import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

/** The emitted opener module beside this test. */
const workerPath = fileURLToPath(new URL('store-open-worker.js', import.meta.url));

/** The logical store every opener names. */
const store = 'store:concurrent-first-open';

/** Milliseconds granted for every process to start and import before contending. */
const startupAllowanceMilliseconds = 700;

/** What one opener reported. */
interface IOpenerReport {
  readonly opened: boolean;
  readonly name?: string;
  readonly message?: string;
}

/** Run one opener process and parse its report. */
async function runOpener(location: string, startAt: number): Promise<IOpenerReport> {
  const child = spawn(process.execPath, [workerPath, location, store, String(startAt)], { stdio: ['ignore', 'pipe', 'pipe'] });
  let stdout = '';
  let stderr = '';
  child.stdout.setEncoding('utf8').on('data', (chunk: string) => { stdout += chunk; });
  child.stderr.setEncoding('utf8').on('data', (chunk: string) => { stderr += chunk; });
  const status = await new Promise<number | null>((resolve) => { child.once('close', resolve); });
  if (status !== 0) {
    throw new Error(`opener exited ${String(status)}: ${stderr}`);
  }
  const report: unknown = JSON.parse(stdout);
  if (typeof report !== 'object' || report === null || !('opened' in report) || typeof report.opened !== 'boolean') {
    throw new TypeError(`opener reported an unexpected value: ${stdout}`);
  }
  return report as IOpenerReport;
}

describe('concurrent first open of a new durable History store', () => {
  const directories: string[] = [];

  afterEach(() => {
    for (const directory of directories.splice(0)) {
      rmSync(directory, { recursive: true, force: true });
    }
  });

  test.each([
    [2, 10],
    [4, 10],
  ])('%i processes opening a new store together each open or fail with a typed SqliteBusyError, across %i trials', async (processes, trials) => {
    const directory = mkdtempSync(join(tmpdir(), 'microdelta-history-first-open-'));
    directories.push(directory);
    const rawFailures: IOpenerReport[] = [];
    let opened = 0;
    let busy = 0;
    for (let trial = 0; trial < trials; trial += 1) {
      const location = join(directory, `trial-${String(trial)}.sqlite`);
      const startAt = Date.now() + startupAllowanceMilliseconds;
      for (const report of await Promise.all(Array.from({ length: processes }, () => runOpener(location, startAt)))) {
        if (report.opened) {
          opened += 1;
        } else if (report.name === 'SqliteBusyError') {
          busy += 1;
        } else {
          rawFailures.push(report);
        }
      }
    }
    // Counts are evidence, not a threshold: a loaded host may exhaust the busy budget legitimately.
    process.stderr.write(`History first open, ${String(processes)} processes x ${String(trials)} trials: ${String(opened)} opened, ${String(busy)} typed busy, ${String(rawFailures.length)} other\n`);
    expect(rawFailures).toEqual([]);
    expect(opened + busy).toBe(processes * trials);
  }, 120_000);
});
