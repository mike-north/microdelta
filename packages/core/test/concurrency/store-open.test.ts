/**
 * Several processes opening the same durable History store at the same
 * instant. Under the owner's concurrency decision a process that finds the
 * writer taken waits for the lease; before it can wait, it must be able to
 * open the store while other processes do the same.
 *
 * Opening an already initialized store simultaneously succeeds in every
 * process. Creating a new store is a known defect of the Node SQLite
 * capability: when several processes open one nonexistent file together,
 * switching the new database to write-ahead logging (`journal_mode = WAL`)
 * fails in all but one of them with an untyped `SQLITE_BUSY` before History
 * runs, well inside the capability's busy timeout. The correct outcome is
 * asserted with `test.failing`, so this suite passes while the defect exists
 * and fails, prompting removal of the marker, once it is fixed. The fix
 * belongs to `@microdelta/machine-node`, not History.
 *
 * @see ../../../../docs/validation/m5-concurrency-2026-09-30.md (store creation finding)
 * @see https://www.sqlite.org/wal.html#activating_and_configuring_wal_mode
 */
import { afterEach, describe, expect, test } from '@jest/globals';

import { cleanup, freshLocation } from '../durable-history/support.js';
import { freshStore, startWorker, stopWorkers } from './driver.js';
import type { IWorkerHandle } from './driver.js';
import { concurrencyStore } from './fixture.js';

afterEach(async () => {
  await stopWorkers();
  cleanup();
});

/** Processes opening one store together in each trial. */
const processes = 4;

/** Trials per case; the defect appears in nearly every trial, so several make its absence certain. */
const trials = 5;

/**
 * Start `processes` workers on `location` at once and report how many of
 * them opened the store, closing those that did.
 */
async function openTogether(location: string): Promise<number> {
  const started = await Promise.allSettled(Array.from({ length: processes }, (_, index) => startWorker(`opener-${String(index)}`, { location, store: concurrencyStore, clock: 'controlled' })));
  const opened = started.filter((outcome): outcome is PromiseFulfilledResult<IWorkerHandle> => outcome.status === 'fulfilled').map((outcome) => outcome.value);
  await Promise.all(opened.map((handle) => handle.close()));
  return opened.length;
}

describe('simultaneous opening of one store by several processes', () => {
  test('every process opens an already initialized store', async () => {
    for (let trial = 0; trial < trials; trial += 1) {
      expect(await openTogether(freshStore())).toBe(processes);
    }
  }, 60_000);

  test.failing('every process opens a store that none of them has created yet (known defect: SQLITE_BUSY while enabling WAL)', async () => {
    for (let trial = 0; trial < trials; trial += 1) {
      expect(await openTogether(freshLocation())).toBe(processes);
    }
  }, 60_000);
});
