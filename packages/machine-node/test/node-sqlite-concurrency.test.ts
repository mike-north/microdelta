/**
 * Node-specific capability conformance for processes that open one SQLite
 * store at the same instant. An in-process test cannot reproduce this: the
 * defect lives in SQLite's cross-process locking while a new file is switched
 * to write-ahead logging, so every opener here is a separate Node process.
 *
 * Under the owner's M5 concurrency decision, processes that start together on
 * a store that does not exist yet must not crash: each opens it, or, only if
 * the bounded busy wait is exhausted on a loaded host, fails with the typed
 * `SqliteBusyError`. A raw driver error is always a defect. No minimum success
 * rate is required.
 *
 * @see https://www.sqlite.org/wal.html#activating_and_configuring_wal_mode
 * @see https://www.sqlite.org/c3ref/busy_timeout.html
 */
import { afterEach, describe, expect, test } from '@jest/globals';
import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

/** The emitted adapter entry that each opener process imports. */
const adapterEntry = fileURLToPath(new URL('../src/index.js', import.meta.url));

/**
 * One opener process. It imports the adapter, spins until the shared start
 * instant so all openers contend together, opens the store, reads back the
 * journal mode, and reports what happened as one JSON line.
 */
const openerProgram = `
const { pathToFileURL } = await import('node:url');
const { createNodeSqlite } = await import(pathToFileURL(process.env.MICRODELTA_ADAPTER_ENTRY).href);
const startAt = Number(process.env.MICRODELTA_START_AT);
while (Date.now() < startAt) { /* spin so every process opens at the same instant */ }
let report;
try {
  const connection = createNodeSqlite().openSqlite(process.env.MICRODELTA_STORE);
  const journal = connection.prepare('PRAGMA journal_mode').get();
  connection.close();
  report = { opened: true, journal: journal.journal_mode };
} catch (error) {
  report = { opened: false, name: error.name, code: error.code, message: error.message };
}
process.stdout.write(JSON.stringify(report));
`;

/** What one opener process reported. */
interface IOpenerReport {
  readonly opened: boolean;
  readonly journal?: string;
  readonly name?: string;
  readonly code?: string;
  readonly message?: string;
}

/** Milliseconds granted for every process to start and import before contending. */
const startupAllowanceMilliseconds = 700;

/** Run one opener process to completion and parse its report. */
async function runOpener(store: string, startAt: number): Promise<IOpenerReport> {
  const child = spawn(process.execPath, ['--input-type=module', '--eval', openerProgram], {
    env: { ...process.env, MICRODELTA_ADAPTER_ENTRY: adapterEntry, MICRODELTA_STORE: store, MICRODELTA_START_AT: String(startAt) },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let stdout = '';
  let stderr = '';
  child.stdout.setEncoding('utf8').on('data', (chunk: string) => { stdout += chunk; });
  child.stderr.setEncoding('utf8').on('data', (chunk: string) => { stderr += chunk; });
  const status = await new Promise<number | null>((resolve) => { child.once('close', resolve); });
  if (status !== 0) {
    throw new Error(`opener process exited ${String(status)}: ${stderr}`);
  }
  const report: unknown = JSON.parse(stdout);
  if (typeof report !== 'object' || report === null || !('opened' in report) || typeof report.opened !== 'boolean') {
    throw new TypeError(`opener process reported an unexpected value: ${stdout}`);
  }
  return report as IOpenerReport;
}

/** Open a not-yet-existing store from `processes` processes at once. */
async function openNewStoreTogether(directory: string, trial: number, processes: number): Promise<readonly IOpenerReport[]> {
  const store = join(directory, `trial-${String(trial)}.sqlite`);
  const startAt = Date.now() + startupAllowanceMilliseconds;
  return Promise.all(Array.from({ length: processes }, () => runOpener(store, startAt)));
}

describe('Node SQLite capability: concurrent first open of a new store', () => {
  const directories: string[] = [];

  afterEach(() => {
    for (const directory of directories.splice(0)) {
      rmSync(directory, { recursive: true, force: true });
    }
  });

  test.each([
    [2, 10],
    [4, 10],
  ])('%i processes opening a new store together each open with WAL or fail with a typed SqliteBusyError, across %i trials', async (processes, trials) => {
    const directory = mkdtempSync(join(tmpdir(), 'microdelta-sqlite-first-open-'));
    directories.push(directory);
    const rawFailures: IOpenerReport[] = [];
    let opened = 0;
    let busy = 0;
    for (let trial = 0; trial < trials; trial += 1) {
      for (const report of await openNewStoreTogether(directory, trial, processes)) {
        if (report.opened && report.journal === 'wal') {
          opened += 1;
        } else if (!report.opened && report.name === 'SqliteBusyError') {
          busy += 1;
        } else {
          rawFailures.push(report);
        }
      }
    }
    // Counts are evidence, not a threshold: a loaded host may exhaust the busy budget legitimately.
    process.stderr.write(`first open, ${String(processes)} processes x ${String(trials)} trials: ${String(opened)} opened, ${String(busy)} typed busy, ${String(rawFailures.length)} other\n`);
    expect(rawFailures).toEqual([]);
    expect(opened + busy).toBe(processes * trials);
  }, 120_000);
});
