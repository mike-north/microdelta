/** Real History finite selection across a separately alive reader process. @packageDocumentation */
import { spawn } from 'node:child_process';
import type { ChildProcess } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { fileURLToPath } from 'node:url';
import { afterEach, expect, test } from '@jest/globals';
import { readHistorySelection } from '@microdelta/history';
import type { ICompletedResultReference, IDurableHistory, IWriterLease } from '@microdelta/history';
import { createNodeSqliteCoordinatedReader } from '@microdelta/machine-node';
import { encodeSelectedFact, fingerprint, observe } from '@microdelta/value';
import { adaActivity, cleanup, freshLocation, logicalStore, machine, openHistory, openRaw, provenance, scope } from '../durable-history/support.js';

afterEach(cleanup);
const address = [{ kind: 'property', key: 'profile' }, { kind: 'property', key: 'name' }] as const;
/** Publish independent immutable results under one ordinary writer lease. */
function publish(history: IDurableHistory, lease: IWriterLease, key: string, name: string): ICompletedResultReference {
  const attempt = history.allocateAttempt(lease, { ...scope, subject: 'subject:ada', version: 1, attemptKey: key, intentDigest: `intent:${key}` });
  history.stageAttempt(lease, { attemptId: attempt.attemptId, payload: adaActivity({ name }), provenance: provenance(key), dependencies: [] });
  return history.publishAttempt(lease, attempt.attemptId);
}
/** Wait for a child milestone with a bounded test-only deadline. */
async function waitFor(file: string): Promise<void> {
  const deadline = Date.now() + 15_000;
  while (!existsSync(file)) {
    if (Date.now() > deadline) {
      throw new Error(`timed out waiting for ${file}`);
    }
    await delay(10);
  }
}
/** Release any barrier and reap the child before the fixture directory is removed. */
async function finishWorker(worker: ChildProcess, barrier: string, stop: string): Promise<void> {
  writeFileSync(`${barrier}.continue`, 'continue');
  writeFileSync(stop, 'stop');
  if (worker.exitCode !== null || worker.signalCode !== null) {
    expect({ code: worker.exitCode, signal: worker.signalCode }).toEqual({ code: 0, signal: null });
    return;
  }
  const exit = new Promise<{ readonly code: number | null; readonly signal: NodeJS.Signals | null }>((resolve) => {
    worker.once('exit', (code, signal) => resolve({ code, signal }));
  });
  let timedOut = false;
  const timer = setTimeout(() => {
    timedOut = true;
    worker.kill('SIGKILL');
  }, 15_000);
  const outcome = await exit;
  clearTimeout(timer);
  expect({ timedOut, ...outcome }).toEqual({ timedOut: false, code: 0, signal: null });
}

/** A worker transcript includes the actual rows returned by native statements. */
interface ITranscript {
  readonly error?: string;
  readonly snapshotCounts: readonly number[];
  readonly fact: unknown;
  readonly fingerprint: unknown;
  readonly factEvents: readonly { readonly sql: string; readonly rows: readonly Record<string, unknown>[] }[];
  readonly fingerprintEvents: readonly { readonly sql: string; readonly rows: readonly Record<string, unknown>[] }[];
}
/** No result row in the window may contain an unrequested payload cell. */
function cells(events: ITranscript['factEvents'], column: string): number {
  return events.flatMap((event) => event.rows).filter((row) => row[column] !== undefined && row[column] !== null).length;
}

test('one anchored exact selection survives concurrent publication and releases while its process lives', async () => {
  const location = freshLocation();
  const writer = openHistory({ location });
  const acquired = writer.acquireWriter({ holder: 'writer', leaseMilliseconds: 10_000 });
  if (acquired.kind !== 'acquired') {
    throw new Error('writer lease unavailable');
  }
  const b = publish(writer, acquired.lease, 'b', 'B');
  const barrier = `${location}.barrier`;
  const result = `${location}.result`;
  const stop = `${location}.stop`;
  const worker = spawn(process.execPath, [join(dirname(fileURLToPath(import.meta.url)), 'worker.js'), location, b.locator, barrier, result, stop, 'yes'], { stdio: 'ignore' });
  try {
    await waitFor(barrier);
    const c = publish(writer, acquired.lease, 'c', 'C');
    expect(openRaw(location).prepare('SELECT count(*) AS n FROM history_results').get()).toMatchObject({ n: 2 });
    const mainBefore = readFileSync(location);
    const walBefore = readFileSync(`${location}-wal`);
    writeFileSync(`${barrier}.continue`, 'continue');
    await waitFor(result);
    const transcript = JSON.parse(readFileSync(result, 'utf8')) as ITranscript;
    expect(transcript.error).toBeUndefined();
    expect(transcript.snapshotCounts).toEqual([1, 1]);
    expect(transcript.fact).toEqual({ kind: 'fact', selected: observe(adaActivity({ name: 'B' }), address, 'value') });
    expect(transcript.fingerprint).toEqual({ kind: 'fingerprint', resolution: { kind: 'compatible', fingerprint: fingerprint(encodeSelectedFact(observe(adaActivity({ name: 'B' }), address, 'value')), machine) } });
    expect(cells(transcript.factEvents, 'payload')).toBe(0);
    expect(cells(transcript.factEvents, 'scalar')).toBe(1);
    expect(cells(transcript.fingerprintEvents, 'payload')).toBe(0);
    expect(cells(transcript.fingerprintEvents, 'scalar')).toBe(0);
    expect(readFileSync(location)).toEqual(mainBefore);
    expect(readFileSync(`${location}-wal`)).toEqual(walBefore);
    expect(worker.exitCode).toBeNull();
    // A full checkpoint proves the reader did not retain an older snapshot.
    expect(openRaw(location).prepare('PRAGMA wal_checkpoint(TRUNCATE)').get()).toMatchObject({ busy: 0 });
    expect(worker.exitCode).toBeNull();
    const later = readHistorySelection({ location, logicalStore, sqlite: createNodeSqliteCoordinatedReader(), sha256: machine }, { kind: 'fact', reference: c, request: { operation: 'value', address } });
    expect(later).toEqual({ kind: 'fact', selected: observe(adaActivity({ name: 'C' }), address, 'value') });
  } finally {
    await finishWorker(worker, barrier, stop);
  }
});

test('a separate reader selects the exact result after the writer closes', async () => {
  const location = freshLocation();
  const writer = openHistory({ location });
  const acquired = writer.acquireWriter({ holder: 'writer', leaseMilliseconds: 10_000 });
  if (acquired.kind !== 'acquired') {
    throw new Error('writer lease unavailable');
  }
  const reference = publish(writer, acquired.lease, 'closed', 'closed');
  writer.close();
  const mainBefore = readFileSync(location);
  const result = `${location}.result`;
  const stop = `${location}.stop`;
  const barrier = `${location}.barrier`;
  const worker = spawn(process.execPath, [join(dirname(fileURLToPath(import.meta.url)), 'worker.js'), location, reference.locator, barrier, result, stop, 'no'], { stdio: 'ignore' });
  try {
    await waitFor(result);
    const transcript = JSON.parse(readFileSync(result, 'utf8')) as ITranscript;
    expect(transcript.error).toBeUndefined();
    expect(transcript.fact).toEqual({ kind: 'fact', selected: observe(adaActivity({ name: 'closed' }), address, 'value') });
    expect(readFileSync(location)).toEqual(mainBefore);
    expect(worker.exitCode).toBeNull();
  } finally {
    await finishWorker(worker, barrier, stop);
  }
});
