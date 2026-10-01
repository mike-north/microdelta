/**
 * Storage contention as a typed outcome, from History's lease authority up
 * through the facade's writer port (PUB-005; RUN-002 owner decision).
 *
 * PUB-005 requires an acquisition result to tell contention apart from
 * ownership facts. So when another connection holds SQLite's write lock past
 * the host's bounded busy wait:
 * - History's `acquireWriter` reports `contended` with the writer recorded at
 *   that moment, read without the write lock, and changes nothing;
 * - `renewWriter` reports the same outcome and leaves the lease as it was,
 *   so a busy renewal is never mistaken for a stale lease.
 *
 * Every other failure (a damaged store, an unusable clock) is a failure, never
 * contention. The facade's port maps these outcomes to Supervision's tries and
 * decides nothing itself: a busy renewal keeps the run's lease, a stale one
 * is dropped before acquiring, and any other error propagates.
 *
 * These cases run in this process against real SQLite. Another real
 * connection holds `BEGIN IMMEDIATE` to make the write lock busy. A captured
 * real `SqliteBusyError` makes the lock-free writer read busy too, which a
 * WAL reader rarely is.
 *
 * @see ../../../../docs/spec/execution.md (PUB-002, PUB-005)
 * @see ../../../../docs/spec/operations.md (RUN-002 owner decision)
 */
import { afterEach, describe, expect, test } from '@jest/globals';
import { HistoryClockError, HistoryIntegrityError, StaleWriterError } from '@microdelta/history';
import type { IDurableHistory, ISqliteCapability, IWriterLease } from '@microdelta/history';
import { createNodeSqlite } from '@microdelta/machine-node';

import { writerFor } from '../../src/writer.js';
import { cleanup, controlledClock, openHistory, openRaw } from '../durable-history/support.js';
import type { IControlledClock, ISqliteConnection } from '../durable-history/support.js';
import { freshStore, snapshot } from './driver.js';
import { concurrencyStore } from './fixture.js';

afterEach(() => {
  cleanup();
});

/** Hold SQLite's write lock from another real connection while `work` runs, then release it. */
function whileLocked<T>(location: string, work: () => T): T {
  const locker = openRaw(location);
  locker.exec('BEGIN IMMEDIATE');
  try {
    return work();
  } finally {
    locker.exec('ROLLBACK');
  }
}

/** A real busy failure, captured once from a real lock, as the Node capability raises it. */
let capturedBusy: unknown;

/** Capture a real busy failure: a second connection cannot begin a write while another holds the lock. */
function realBusyFailure(location: string): unknown {
  if (capturedBusy === undefined) {
    whileLocked(location, () => {
      try {
        openRaw(location).exec('BEGIN IMMEDIATE');
      } catch (error: unknown) {
        capturedBusy = error;
      }
    });
  }
  expect(capturedBusy).toBeInstanceOf(Error);
  expect(capturedBusy instanceof Error ? capturedBusy.name : '').toBe('SqliteBusyError');
  return capturedBusy;
}

/**
 * Node's real SQLite capability, except that while `busyReads` is on, History's
 * writer-row read fails with the given real busy failure, as a WAL reader can
 * during recovery or checkpointing.
 */
function busyReadSqlite(busy: () => unknown): { readonly capability: ISqliteCapability; setBusyReads(on: boolean): void } {
  const real = createNodeSqlite();
  const state = { busyReads: false };
  const capability: ISqliteCapability = {
    openSqlite(location: string): ISqliteConnection {
      const connection = real.openSqlite(location);
      return {
        exec: (text) => {
          connection.exec(text);
        },
        prepare: (text) => {
          const statement = connection.prepare(text);
          if (!text.startsWith('/* writer */ SELECT')) {
            return statement;
          }
          return {
            run: (...values) => statement.run(...values),
            all: (...values) => statement.all(...values),
            get: (...values) => {
              if (state.busyReads) {
                throw busy();
              }
              return statement.get(...values);
            },
          };
        },
        // The real connection still refuses asynchronous results at runtime; this wrapper only forwards the callback.
        transaction: <T>(operation: () => T): T => connection.transaction<unknown>(operation) as T,
        close: () => {
          connection.close();
        },
      };
    },
  };
  return {
    capability,
    setBusyReads(on: boolean): void {
      state.busyReads = on;
    },
  };
}

/** Open History over `location` with a controlled clock and, optionally, a fault-injecting capability. */
function history(location: string, clock: IControlledClock, sqlite?: ISqliteCapability): IDurableHistory {
  return openHistory(sqlite === undefined ? { location, clock, store: concurrencyStore } : { location, clock, sqlite, store: concurrencyStore });
}

/** Acquire on `target` or fail the test. */
function acquired(target: IDurableHistory, holder: string, leaseMilliseconds: number): IWriterLease {
  const acquisition = target.acquireWriter({ holder, leaseMilliseconds });
  if (acquisition.kind !== 'acquired') {
    throw new Error(`expected to acquire, observed ${JSON.stringify(acquisition)}`);
  }
  return acquisition.lease;
}

/**
 * Remove the singleton writer row, with its protecting trigger dropped and
 * then restored exactly: damaged storage that History must report as an
 * integrity failure, never treat as contention.
 */
function deleteWriterRow(location: string): void {
  const raw = openRaw(location);
  const triggers = raw.prepare("SELECT name, sql FROM sqlite_master WHERE type = 'trigger' AND tbl_name = 'history_writer'").all();
  for (const trigger of triggers) {
    raw.exec(`DROP TRIGGER ${String(trigger.name)}`);
  }
  raw.exec('DELETE FROM history_writer');
  for (const trigger of triggers) {
    raw.exec(String(trigger.sql));
  }
}

describe('History reports SQLite contention as a typed outcome, never as ownership (PUB-005)', () => {
  test('H1: acquisition while another connection holds the write lock is contended, names the recorded writer and changes nothing', () => {
    const location = freshStore();
    const holder = history(location, controlledClock(1_000));
    const lease = acquired(holder, 'holder-a', 100);
    const waiter = history(location, controlledClock(1_050));
    const before = snapshot(location);
    const outcome = whileLocked(location, () => waiter.acquireWriter({ holder: 'waiter-w', leaseMilliseconds: 100 }));
    expect(outcome).toMatchObject({ kind: 'contended', writer: lease });
    expect(outcome.kind === 'contended' ? outcome.detail : '').toMatch(/busy/u);
    // Nothing at all changed, not even the clock high-water: the transaction never began.
    expect(snapshot(location)).toEqual(before);
  });

  test('H2: renewal while the write lock is busy is contended and keeps the lease; once free, the same lease renews', () => {
    const location = freshStore();
    const clock = controlledClock(1_000);
    const holder = history(location, clock);
    const lease = acquired(holder, 'holder-a', 100);
    clock.set(1_050);
    const before = snapshot(location);
    const outcome = whileLocked(location, () => holder.renewWriter(lease, 100));
    expect(outcome).toMatchObject({ kind: 'contended', writer: lease });
    expect(snapshot(location)).toEqual(before);
    expect(holder.renewWriter(lease, 100)).toEqual({ kind: 'renewed', lease: { holder: 'holder-a', fence: lease.fence, expiresAt: 1_150 } });
  });

  test('H3: when the lock-free writer read is busy too, contention names no writer rather than guessing one', () => {
    const location = freshStore();
    acquired(history(location, controlledClock(1_000)), 'holder-a', 100);
    const busy = realBusyFailure(location);
    const faulty = busyReadSqlite(() => busy);
    const waiter = history(location, controlledClock(1_050), faulty.capability);
    faulty.setBusyReads(true);
    const outcome = whileLocked(location, () => waiter.acquireWriter({ holder: 'waiter-w', leaseMilliseconds: 100 }));
    faulty.setBusyReads(false);
    expect(outcome).toMatchObject({ kind: 'contended', writer: undefined });
  });

  test('H4: damaged storage is a failure, never contention, for acquisition, for renewal and for the writer read taken during contention', () => {
    const location = freshStore();
    const clock = controlledClock(1_000);
    const holder = history(location, clock);
    const lease = acquired(holder, 'holder-a', 100);
    deleteWriterRow(location);
    expect(() => holder.acquireWriter({ holder: 'holder-b', leaseMilliseconds: 100 })).toThrow(HistoryIntegrityError);
    expect(() => holder.renewWriter(lease, 100)).toThrow(HistoryIntegrityError);
    // The acquisition is busy, and the writer read it then takes finds the row missing.
    expect(() => whileLocked(location, () => holder.acquireWriter({ holder: 'holder-b', leaseMilliseconds: 100 }))).toThrow(HistoryIntegrityError);
    expect(() => whileLocked(location, () => holder.renewWriter(lease, 100))).toThrow(HistoryIntegrityError);
  });

  test('H5: an unusable clock is a failure, never contention, for acquisition and renewal', () => {
    const location = freshStore();
    const clock = controlledClock(1_000);
    const holder = history(location, clock);
    const lease = acquired(holder, 'holder-a', 100);
    // A reading that is not a nonnegative safe integer is History's typed clock failure.
    clock.set(-1);
    expect(() => holder.acquireWriter({ holder: 'holder-b', leaseMilliseconds: 100 })).toThrow(HistoryClockError);
    expect(() => holder.renewWriter(lease, 100)).toThrow(HistoryClockError);
  });
});

describe('the facade writer port maps History outcomes and decides nothing', () => {
  test('P1: a busy acquisition is a contended try naming the recorded holder, not held by this run', () => {
    const location = freshStore();
    const lease = acquired(history(location, controlledClock(1_000)), 'holder-a', 100);
    const port = writerFor(history(location, controlledClock(1_050)), 'run-w', 100);
    const attempt = whileLocked(location, () => port.tryLease());
    expect(attempt).toMatchObject({ kind: 'contended', holder: 'holder-a', expiresAt: lease.expiresAt, heldByThisRun: false });
  });

  test('P2: a busy renewal keeps the run\'s lease, reports it as this run\'s own, and the next try renews the same fence', () => {
    const location = freshStore();
    const clock = controlledClock(1_000);
    const port = writerFor(history(location, clock), 'run-w', 100);
    const first = port.tryLease();
    if (first.kind !== 'acquired') {
      throw new Error('expected the first try to acquire');
    }
    clock.set(1_050);
    const busy = whileLocked(location, () => port.tryLease());
    expect(busy).toMatchObject({ kind: 'contended', holder: 'run-w', expiresAt: first.lease.expiresAt, heldByThisRun: true });
    clock.set(1_060);
    expect(port.tryLease()).toEqual({ kind: 'acquired', lease: { holder: 'run-w', fence: first.lease.fence, expiresAt: 1_160 } });
    expect(snapshot(location).writer.lastFence).toBe(first.lease.fence);
  });

  test('P3: a stale renewal drops the lease and the same try acquires, here finding the successor', () => {
    const location = freshStore();
    const clock = controlledClock(1_000);
    const port = writerFor(history(location, clock), 'run-w', 100);
    const first = port.tryLease();
    expect(first.kind).toBe('acquired');
    const successor = acquired(history(location, controlledClock(1_200)), 'run-other', 1_000);
    clock.set(1_210);
    expect(port.tryLease()).toEqual({ kind: 'held', holder: 'run-other', expiresAt: successor.expiresAt });
  });

  test('P4: a clock failure from acquisition or renewal propagates and is never contention or staleness', () => {
    const location = freshStore();
    const clock = controlledClock(1_000);
    const port = writerFor(history(location, clock), 'run-w', 100);
    clock.set(-1);
    expect(() => port.tryLease()).toThrow(HistoryClockError);
    clock.set(1_000);
    expect(port.tryLease().kind).toBe('acquired');
    clock.set(-1);
    expect(() => port.tryLease()).toThrow(HistoryClockError);
    // The lease was kept: once the clock works, the same fence renews.
    clock.set(1_010);
    expect(port.tryLease()).toMatchObject({ kind: 'acquired', lease: { fence: 1 } });
  });

  test('P5: damaged storage propagates from acquisition, renewal and the contention read, and never becomes contention', () => {
    const location = freshStore();
    const clock = controlledClock(1_000);
    const renewing = writerFor(history(location, clock), 'run-w', 100);
    expect(renewing.tryLease().kind).toBe('acquired');
    const acquiring = writerFor(history(location, controlledClock(1_050)), 'run-x', 100);
    deleteWriterRow(location);
    expect(() => renewing.tryLease()).toThrow(HistoryIntegrityError);
    expect(() => acquiring.tryLease()).toThrow(HistoryIntegrityError);
    expect(() => whileLocked(location, () => acquiring.tryLease())).toThrow(HistoryIntegrityError);
  });

  test('P6: when the writer read is busy too, the contended try names no holder', () => {
    const location = freshStore();
    acquired(history(location, controlledClock(1_000)), 'holder-a', 100);
    const busy = realBusyFailure(location);
    const faulty = busyReadSqlite(() => busy);
    const port = writerFor(history(location, controlledClock(1_050), faulty.capability), 'run-w', 100);
    faulty.setBusyReads(true);
    const attempt = whileLocked(location, () => port.tryLease());
    faulty.setBusyReads(false);
    expect(attempt).toMatchObject({ kind: 'contended', holder: undefined, expiresAt: undefined, heldByThisRun: false });
    expect(attempt.kind === 'contended' ? attempt.detail : '').toMatch(/busy/u);
  });

  test('P7: a stale lease is refused by History as StaleWriterError, which the port treats as dropped, not as a failure', () => {
    const location = freshStore();
    const clock = controlledClock(1_000);
    const target = history(location, clock);
    const port = writerFor(target, 'run-w', 100);
    const first = port.tryLease();
    if (first.kind !== 'acquired') {
      throw new Error('expected to acquire');
    }
    clock.set(1_200);
    expect(() => target.renewWriter(first.lease, 100)).toThrow(StaleWriterError);
    expect(port.tryLease()).toMatchObject({ kind: 'acquired', lease: { fence: first.lease.fence + 1 } });
  });
});
