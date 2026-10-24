/**
 * History's busy boundary (issue #138): exhausted SQLite contention on data
 * operations is recognizable through History and the facade, without changing
 * a fenced transaction or reclassifying unrelated callback failures. A separate
 * process owns the real write lock for mutation evidence; injected Machine
 * failures cover opening and WAL reads, which an IMMEDIATE lock need not block.
 * @packageDocumentation
 */
import { fork } from 'node:child_process';
import type { ChildProcess } from 'node:child_process';
import { fileURLToPath } from 'node:url';

import { afterEach, expect, test } from '@jest/globals';
import * as historySurface from '@microdelta/history';
import type { IDurableHistory, ISqliteCapability, ISqliteConnection, ISqliteRow, IWriterLease } from '@microdelta/history';
import { createNodeSqlite } from '@microdelta/machine-node';
import * as facade from 'microdelta';

import { cleanup, controlledClock, openHistory } from '../durable-history/support.js';
import { attemptRequest, concurrencyStore, evidence, payload, provenance, subject } from './fixture.js';
import { freshStore } from './driver.js';

/** The emitted independent lock-holder process beside this test. */
const lockWorker = fileURLToPath(new URL('./history-busy-lock.js', import.meta.url));

/** A worker remains tracked until it has released its lock and exited. */
const lockWorkers = new Set<ChildProcess>();

afterEach(async () => {
  await Promise.all([...lockWorkers].map(async (worker) => {
    if (worker.exitCode !== null || worker.signalCode !== null) { return; }
    worker.kill('SIGKILL');
    await new Promise<void>((resolve) => { worker.once('exit', () => resolve()); });
  }));
  lockWorkers.clear();
  cleanup();
});

/** Require that both alpha surfaces expose the same History-owned class. */
function busyClass(): Function {
  const fromHistory: unknown = Reflect.get(historySurface, 'HistoryBusyError');
  const fromFacade: unknown = Reflect.get(facade, 'HistoryBusyError');
  expect(typeof fromHistory).toBe('function');
  expect(fromFacade).toBe(fromHistory);
  if (typeof fromHistory !== 'function') { throw new Error('HistoryBusyError is not exported'); }
  return fromHistory;
}

/** A busy failure keeps Machine's exact error as its cause. */
function expectBusy(error: unknown, expectedCause?: unknown): void {
  if (!(error instanceof Error)) { throw new Error('Expected typed History busy failure'); }
  expect(error.name).toBe('HistoryBusyError');
  expect(error).toBeInstanceOf(busyClass());
  expect(error.cause).toBeInstanceOf(Error);
  expect(error.cause instanceof Error ? error.cause.name : '').toBe('SqliteBusyError');
  if (expectedCause !== undefined) { expect(error.cause).toBe(expectedCause); }
}

/** Catch exactly one synchronous failure without accepting a successful operation. */
function failureOf(operation: () => unknown): unknown {
  try { operation(); } catch (error: unknown) { return error; }
  throw new Error('Expected SQLite contention');
}

/** Hold an IMMEDIATE lock in a separate process while synchronous History work runs. */
async function whileProcessLocked<T>(location: string, work: () => T): Promise<T> {
  const child = fork(lockWorker, [location], { stdio: ['ignore', 'ignore', 'pipe', 'ipc'] });
  lockWorkers.add(child);
  let stderr = '';
  child.stderr?.setEncoding('utf8').on('data', (chunk: string) => { stderr += chunk; });
  await new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`lock holder did not start: ${stderr}`)), 10_000);
    child.once('message', (message: unknown) => {
      clearTimeout(timer);
      if (typeof message === 'object' && message !== null && 'kind' in message && message.kind === 'locked') {
        resolve();
      } else {
        reject(new Error(`lock holder reported ${String(message)}`));
      }
    });
    child.once('exit', (code, signal) => {
      clearTimeout(timer);
      reject(new Error(`lock holder ended before readiness: ${String(code)}/${String(signal)} ${stderr}`));
    });
  });
  try {
    return work();
  } finally {
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error(`lock holder did not release: ${stderr}`)), 10_000);
      child.once('exit', (code, signal) => {
        clearTimeout(timer);
        lockWorkers.delete(child);
        if (code === 0 && signal === null) { resolve(); }
        else { reject(new Error(`lock holder exited ${String(code)}/${String(signal)} ${stderr}`)); }
      });
      child.send({ kind: 'release' });
    });
  }
}

/** Inspect every History-owned table, including journal and selected index. */
function storageImage(location: string): ReadonlyMap<string, readonly ISqliteRow[]> {
  const connection = createNodeSqlite().openSqlite(location);
  try {
    const names = connection.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name LIKE 'history_%' ORDER BY name").all();
    const tables = new Map<string, readonly ISqliteRow[]>();
    for (const row of names) {
      const name = row.name;
      if (typeof name !== 'string' || !/^history_[a-z_]+$/u.test(name)) { throw new Error('Unexpected History table name'); }
      tables.set(name, connection.prepare(`SELECT * FROM ${name}`).all());
    }
    return tables;
  } finally { connection.close(); }
}

/** The acquired writer and prepared attempts make each fenced call eligible before locking. */
function preparedHistory(location: string): { readonly history: IDurableHistory; readonly lease: IWriterLease; readonly stageId: number; readonly publishId: number; readonly abandonId: number; readonly reference: ReturnType<IDurableHistory['publishAttempt']> } {
  const history = openHistory({ location, clock: controlledClock(1_000), store: concurrencyStore });
  const acquisition = history.acquireWriter({ holder: 'busy-test', leaseMilliseconds: 100_000 });
  if (acquisition.kind !== 'acquired') { throw new Error('Could not prepare a writer lease'); }
  const lease = acquisition.lease;
  const stageId = history.allocateAttempt(lease, attemptRequest('busy-stage')).attemptId;
  const publishId = history.allocateAttempt(lease, attemptRequest('busy-publish')).attemptId;
  history.stageAttempt(lease, { attemptId: publishId, payload: payload('publish'), provenance: provenance('publish'), dependencies: [] });
  const abandonId = history.allocateAttempt(lease, attemptRequest('busy-abandon')).attemptId;
  const completeId = history.allocateAttempt(lease, attemptRequest('busy-complete')).attemptId;
  history.stageAttempt(lease, { attemptId: completeId, payload: payload('complete'), provenance: provenance('complete'), dependencies: [] });
  const reference = history.publishAttempt(lease, completeId);
  return { history, lease, stageId, publishId, abandonId, reference };
}

test('all fenced data and journal mutations report History busy and leave every stored row unchanged under a separate-process IMMEDIATE lock', async () => {
  const location = freshStore();
  const { history, lease, stageId, publishId, abandonId, reference } = preparedHistory(location);
  const journal = history.openJournal({ formats: [{ format: 'test.busy', versions: [1] }] });
  const before = storageImage(location);
  const mutations: readonly { readonly name: string; readonly run: () => unknown }[] = [
    { name: 'release', run: () => history.releaseWriter(lease) },
    { name: 'allocate', run: () => history.allocateAttempt(lease, attemptRequest('busy-new')) },
    { name: 'stage', run: () => history.stageAttempt(lease, { attemptId: stageId, payload: payload('stage'), provenance: provenance('stage'), dependencies: [] }) },
    { name: 'publish', run: () => history.publishAttempt(lease, publishId) },
    { name: 'abandon', run: () => history.abandonAttempt(lease, { attemptId: abandonId, outcome: 'failed', evidence: evidence('busy') }) },
    { name: 'accept', run: () => history.recordAcceptance(lease, { reference, environment: subject.environment, evidence: evidence('busy'), dependencies: [] }) },
    { name: 'promote', run: () => history.promoteResults(lease, { target: { analysis: subject.analysis, environment: 'env:other' }, references: [reference], evidence: evidence('busy') }) },
    { name: 'journal commit', run: () => journal.commit(lease, { analysis: subject.analysis, environment: subject.environment, writes: [{ collection: 'operations', key: 'busy', expectedRevision: 0, record: { format: 'test.busy', formatVersion: 1, content: { state: 'pending' } } }] }) },
  ];
  const failures = await whileProcessLocked(location, () => {
    const observed = mutations.map(({ name, run }) => ({ name, error: failureOf(run) }));
    expect(history.acquireWriter({ holder: 'waiter', leaseMilliseconds: 1_000 }).kind).toBe('contended');
    expect(history.renewWriter(lease, 1_000).kind).toBe('contended');
    // WAL readers are lease-free and may proceed while IMMEDIATE is held.
    expect(history.currentWriter()).toMatchObject({ holder: lease.holder, fence: lease.fence });
    return observed;
  });
  expect(storageImage(location)).toEqual(before);
  for (const { name, error } of failures) {
    try { expectBusy(error); } catch (assertion: unknown) { throw new Error(`${name}: ${String(assertion)}`); }
  }
  history.close();
}, 30_000);

/** Inject an exact Machine busy error at one SQLite boundary while retaining a real connection elsewhere. */
function faultySqlite(busy: Error, locationOfFault: 'open' | 'schema-read' | 'prepare' | 'writer-read' | 'writer-read-second' | 'journal-read' | 'index-read', onClose?: () => void): ISqliteCapability {
  const real = createNodeSqlite();
  let writerReads = 0;
  return {
    openSqlite(location: string): ISqliteConnection {
      if (locationOfFault === 'open') { throw busy; }
      const connection = real.openSqlite(location);
      return {
        exec: (text) => connection.exec(text),
        prepare: (text) => {
          if (locationOfFault === 'prepare' && text.startsWith('/* writer */ SELECT')) { throw busy; }
          const statement = connection.prepare(text);
          const inject = (locationOfFault === 'schema-read' && text.startsWith('/* schema */ SELECT name'))
            || ((locationOfFault === 'writer-read' || locationOfFault === 'writer-read-second') && text.startsWith('/* writer */ SELECT'))
            || (locationOfFault === 'journal-read' && text.startsWith('/* journal */ SELECT * FROM history_journal'))
            || (locationOfFault === 'index-read' && text.startsWith('/* node-metadata */'));
          if (!inject) { return statement; }
          return {
            run: (...values) => statement.run(...values),
            get: (...values) => {
              if (locationOfFault === 'writer-read-second') {
                writerReads += 1;
                if (writerReads === 1) { return statement.get(...values); }
              }
              throw busy;
            },
            all: () => { throw busy; },
          };
        },
        transaction: <T>(operation: () => T): T => connection.transaction<unknown>(operation) as T,
        close: () => { onClose?.(); connection.close(); },
      };
    },
  };
}

test('opening and lease-free History/journal reads translate only exact Machine busy failures', () => {
  const location = freshStore();
  const prepared = preparedHistory(location);
  const reference = prepared.reference;
  prepared.history.close();
  const machineBusy = new Error('injected busy');
  machineBusy.name = 'SqliteBusyError';
  // The test first pins the exact instance with a real host busy failure below;
  // a name-only error must remain unrelated and unchanged.
  expect(failureOf(() => openHistory({ location, sqlite: faultySqlite(machineBusy, 'open'), store: concurrencyStore }))).toBe(machineBusy);

  const realBusy = failureOf(() => {
    const locker = createNodeSqlite().openSqlite(location);
    const contender = createNodeSqlite().openSqlite(location);
    try {
      locker.exec('BEGIN IMMEDIATE');
      try { contender.exec('BEGIN IMMEDIATE'); } finally { locker.exec('ROLLBACK'); }
    } finally { contender.close(); locker.close(); }
  });
  if (!(realBusy instanceof Error)) { throw new Error('Expected real Machine busy instance'); }
  for (const phase of ['open', 'schema-read', 'prepare', 'writer-read', 'journal-read', 'index-read'] as const) {
    let closes = 0;
    const sqlite = faultySqlite(realBusy, phase, () => { closes += 1; });
    if (phase === 'open' || phase === 'schema-read' || phase === 'prepare') {
      expectBusy(failureOf(() => openHistory({ location, sqlite, store: concurrencyStore })), realBusy);
      expect(closes).toBe(phase === 'open' ? 0 : 1);
    } else {
      const history = openHistory({ location, sqlite, store: concurrencyStore });
      if (phase === 'writer-read') {
        expectBusy(failureOf(() => history.currentWriter()), realBusy);
      } else if (phase === 'journal-read') {
        const journal = history.openJournal({ formats: [{ format: 'test.busy', versions: [1] }] });
        expectBusy(failureOf(() => journal.read({ analysis: subject.analysis, environment: subject.environment, collection: 'operations', key: 'missing' })), realBusy);
      } else {
        expectBusy(failureOf(() => history.reader.readNode(reference, [])), realBusy);
      }
      history.close();
      expect(closes).toBe(1);
    }
  }

  const nonbusy = new Error('unrelated read failure');
  const unrelated = openHistory({ location, sqlite: faultySqlite(nonbusy, 'writer-read'), store: concurrencyStore });
  expect(failureOf(() => unrelated.currentWriter())).toBe(nonbusy);
  unrelated.close();

  const beforeCallbacks = storageImage(location);
  const callback = openHistory({ location, clock: { currentEpochMilliseconds: () => { throw realBusy; } }, store: concurrencyStore });
  expect(failureOf(() => callback.acquireWriter({ holder: 'callback', leaseMilliseconds: 1_000 }))).toBe(realBusy);
  callback.close();

  const origin = openHistory({ location, sqlite: faultySqlite(realBusy, 'writer-read'), store: concurrencyStore });
  const callbackHistoryBusy = failureOf(() => origin.currentWriter());
  expectBusy(callbackHistoryBusy, realBusy);
  origin.close();
  const historyCallback = openHistory({ location, clock: { currentEpochMilliseconds: () => { throw callbackHistoryBusy; } }, store: concurrencyStore });
  expect(failureOf(() => historyCallback.acquireWriter({ holder: 'callback', leaseMilliseconds: 1_000 }))).toBe(callbackHistoryBusy);
  historyCallback.close();

  const nested = openHistory({ location, sqlite: faultySqlite(realBusy, 'writer-read'), store: concurrencyStore });
  let freshCallbackFailure: unknown;
  const nestedClock = openHistory({ location, clock: { currentEpochMilliseconds: () => {
    try { nested.currentWriter(); } catch (error: unknown) {
      freshCallbackFailure = error;
      throw error;
    }
    return 1_000;
  } }, store: concurrencyStore });
  expect(failureOf(() => nestedClock.acquireWriter({ holder: 'nested-callback', leaseMilliseconds: 1_000 }))).toBe(freshCallbackFailure);
  expectBusy(freshCallbackFailure, realBusy);
  nestedClock.close();
  nested.close();

  const sameHistoryCell: { current: IDurableHistory | undefined } = { current: undefined };
  let sameCallbackFailure: unknown;
  const sameClock = { currentEpochMilliseconds: () => {
    if (sameHistoryCell.current === undefined) { throw new Error('Same History handle was not opened'); }
    try { sameHistoryCell.current.currentWriter(); } catch (error: unknown) {
      sameCallbackFailure = error;
      throw error;
    }
    return 1_000;
  } };
  const sameHistory = openHistory({ location, sqlite: faultySqlite(realBusy, 'writer-read-second'), clock: sameClock, store: concurrencyStore });
  sameHistoryCell.current = sameHistory;
  expect(failureOf(() => sameHistory.acquireWriter({ holder: 'same-callback', leaseMilliseconds: 1_000 }))).toBe(sameCallbackFailure);
  expectBusy(sameCallbackFailure, realBusy);
  sameHistory.close();
  expect(storageImage(location)).toEqual(beforeCallbacks);

  const renewalLocation = freshStore();
  let readings = 0;
  const renewalHistory = openHistory({ location: renewalLocation, clock: { currentEpochMilliseconds: () => {
    readings += 1;
    if (readings === 1) { return 1_000; }
    throw callbackHistoryBusy;
  } }, store: concurrencyStore });
  const acquisition = renewalHistory.acquireWriter({ holder: 'callback-renew', leaseMilliseconds: 10_000 });
  if (acquisition.kind !== 'acquired') { throw new Error('Could not prepare renewal lease'); }
  const beforeRenewal = storageImage(renewalLocation);
  expect(failureOf(() => renewalHistory.renewWriter(acquisition.lease, 1_000))).toBe(callbackHistoryBusy);
  const getterSource = openHistory({ location: renewalLocation, sqlite: faultySqlite(realBusy, 'writer-read'), store: concurrencyStore });
  let getterFailure: unknown;
  const getterLease: IWriterLease = {
    get holder(): string {
      getterFailure = failureOf(() => getterSource.currentWriter());
      throw getterFailure;
    },
    fence: acquisition.lease.fence,
    expiresAt: acquisition.lease.expiresAt,
  };
  expect(failureOf(() => renewalHistory.renewWriter(getterLease, 1_000))).toBe(getterFailure);
  expectBusy(getterFailure, realBusy);
  getterSource.close();
  renewalHistory.close();
  expect(storageImage(renewalLocation)).toEqual(beforeRenewal);
});
