/**
 * C1 must settle only typed storage nondecisions without changing its winner,
 * logical time, or fencing proof. A real lock supplies the contract branch;
 * scripted replies challenge the narrow settlement boundary independently.
 * @packageDocumentation
 */
import { fork } from 'node:child_process';
import type { ChildProcess } from 'node:child_process';
import { fileURLToPath } from 'node:url';

import { afterEach, describe, expect, test } from '@jest/globals';
import type { IWriterLease } from '@microdelta/history';

import { cleanup, openRaw } from '../durable-history/support.js';
import type { ISqliteConnection, ISqliteRow } from '../durable-history/support.js';
import { settleC1Loser } from './c1-acquisition.js';
import type { IC1AcquireRequest, IC1LoserWorker } from './c1-acquisition.js';
import { freshStore, leaseFrom, startWorker, stopWorkers } from './driver.js';
import { concurrencyStore } from './fixture.js';
import type { IHarnessCommand, IHarnessReply } from './protocol.js';

/** The already established winner remains live at the fixture's fixed time. */
const winner: IWriterLease = { holder: 'winner', fence: 1, expiresAt: 4_400 };
/** Every re-observation must preserve all fields of this losing acquisition. */
const request: IC1AcquireRequest = { op: 'acquire', at: 4_000, holder: 'loser', leaseMilliseconds: 400 };
/** A settled ownership observation, distinct from a diagnostic writer snapshot. */
const held = { kind: 'held', holder: winner.holder, expiresAt: winner.expiresAt };
/** A storage nondecision supplies no authority even when a writer was recorded. */
const contended = { kind: 'contended', detail: 'bounded SQLite contention', writer: winner };
/** Lock workers are killed on failed assertions so a test cannot strand a lock. */
const lockWorkers = new Set<ChildProcess>();

afterEach(async () => {
  await Promise.all([...lockWorkers].map(async (child) => {
    if (child.exitCode !== null || child.signalCode !== null) { return; }
    const exited = new Promise<void>((resolve) => { child.once('exit', () => resolve()); });
    child.kill('SIGKILL');
    await exited;
  }));
  lockWorkers.clear();
  await stopWorkers();
  cleanup();
});

/** Successful IPC-shaped reply; timing is independent of controlled lease time. */
function reply(value: unknown): IHarnessReply {
  return { ok: true, value, startedAt: 1, endedAt: 2 };
}

/** A scripted worker records every command so wrong retries cannot go unnoticed. */
function scripted(responses: readonly unknown[]): { readonly worker: IC1LoserWorker; readonly commands: readonly IHarnessCommand[] } {
  const commands: IHarnessCommand[] = [];
  const worker = {
    name: 'loser',
    step: (command: IHarnessCommand): Promise<unknown> => {
      commands.push(command);
      const response = responses[commands.length - 1];
      if (response instanceof Error) { return Promise.reject(response); }
      if (response === undefined) { return Promise.reject(new Error('Unexpected extra acquisition')); }
      return Promise.resolve(response);
    },
  };
  return { worker, commands };
}

/** Complete durable table contents, including the allocator's SQLite sequence. */
function storageImage(connection: ISqliteConnection): ReadonlyMap<string, readonly ISqliteRow[]> {
  const tables = new Map<string, readonly ISqliteRow[]>();
  for (const row of connection.prepare("SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name").all()) {
    const name = row.name;
    if (typeof name !== 'string' || !/^[a-z_][a-z0-9_]*$/u.test(name)) { throw new Error('Unexpected SQLite table name'); }
    tables.set(name, connection.prepare(`SELECT * FROM ${name}`).all());
  }
  return tables;
}

/** Hold a real IMMEDIATE lock until the caller's observation has completed. */
async function whileLocked<T>(location: string, work: () => Promise<T>): Promise<T> {
  const path = fileURLToPath(new URL('./history-busy-lock.js', import.meta.url));
  const child = fork(path, [location], { stdio: ['ignore', 'ignore', 'pipe', 'ipc'] });
  lockWorkers.add(child);
  let stderr = '';
  child.stderr?.setEncoding('utf8').on('data', (chunk: string) => { stderr += chunk; });
  await new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`Lock readiness timeout: ${stderr}`)), 10_000);
    child.once('message', (message: unknown) => {
      clearTimeout(timer);
      if (typeof message === 'object' && message !== null && 'kind' in message && message.kind === 'locked') { resolve(); }
      else { reject(new Error('Lock holder did not confirm readiness')); }
    });
    child.once('error', (error) => { clearTimeout(timer); reject(error); });
    child.once('exit', (code, signal) => { clearTimeout(timer); reject(new Error(`Lock holder exited before readiness: ${String(code)}/${String(signal)} ${stderr}`)); });
  });
  try {
    return await work();
  } finally {
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error(`Lock release timeout: ${stderr}`)), 10_000);
      child.once('exit', (code, signal) => {
        clearTimeout(timer);
        lockWorkers.delete(child);
        if (code === 0 && signal === null) { resolve(); }
        else { reject(new Error(`Lock holder exited abnormally: ${String(code)}/${String(signal)}`)); }
      });
      child.send({ kind: 'release' });
    });
  }
}

/** A protocol failure remains a failure; its text is never parsed as contention. */
function valueOf(response: IHarnessReply): unknown {
  if (!response.ok) { throw new Error(`${response.error}: ${response.message}`); }
  return response.value;
}

test('a real lock causes a non-mutating nondecision, then the same-time loser observes the existing holder', async () => {
  const location = freshStore();
  const [owner, loser] = await Promise.all(['owner', 'loser'].map((name) => startWorker(name, { location, store: concurrencyStore, clock: 'controlled' })));
  if (owner === undefined || loser === undefined) { throw new Error('Missing fixture workers'); }
  const granted = leaseFrom(valueOf(await owner.step({ ...request, holder: winner.holder })));
  expect(granted).toEqual(winner);
  const inspector = openRaw(location);
  try {
    const before = storageImage(inspector);
    const initial = await whileLocked(location, async () => {
      const value = valueOf(await loser.step(request));
      expect(value).toMatchObject({ kind: 'contended', writer: winner, detail: expect.stringMatching(/busy/u) });
      expect(storageImage(inspector)).toEqual(before);
      return value;
    });
    expect(storageImage(inspector)).toEqual(before);
    const commands: IHarnessCommand[] = [];
    const traced = { name: loser.name, step: (command: IHarnessCommand): Promise<IHarnessReply> => { commands.push(command); return loser.step(command); } };
    const settled = await settleC1Loser(traced, request, initial, granted);
    expect(settled.held).toEqual({ holder: winner.holder, expiresAt: winner.expiresAt });
    expect(settled.contentions).toEqual([initial]);
    expect(commands).toEqual([request]);
    expect(storageImage(inspector)).toEqual(before);
  } finally { inspector.close(); }
}, 20_000);

describe('C1 loser settlement preserves the distinction between a nondecision and ownership', () => {
  test('an initial exact held result requires no retry', async () => {
    const fake = scripted([]);
    await expect(settleC1Loser(fake.worker, request, held, winner)).resolves.toEqual({ held: { holder: winner.holder, expiresAt: winner.expiresAt }, contentions: [] });
    expect(fake.commands).toEqual([]);
  });

  test.each([
    { kind: 'contended', detail: 'no recorded writer' },
    { kind: 'contended', detail: 'read itself busy', writer: undefined },
    { kind: 'contended', detail: 'historical writer', writer: { holder: 'old-other-writer', fence: 7, expiresAt: 10 } },
  ])('retains a valid diagnostic snapshot without using it as authority: %j', async (initial) => {
    const fake = scripted([reply(contended), reply(held)]);
    const settled = await settleC1Loser(fake.worker, request, initial, winner);
    expect(settled.contentions).toEqual([initial, contended]);
    expect(settled.held).toEqual({ holder: winner.holder, expiresAt: winner.expiresAt });
    expect(fake.commands).toEqual([request, request]);
  });

  test.each([
    ['additional grant', { kind: 'acquired', lease: { holder: 'loser', fence: 2, expiresAt: 4_400 } }],
    ['wrong holder', { ...held, holder: 'another-holder' }],
    ['wrong expiry', { ...held, expiresAt: 4_401 }],
    ['missing detail', { kind: 'contended' }],
    ['wrong detail', { kind: 'contended', detail: 502 }],
    ['null writer', { ...contended, writer: null }],
    ['missing writer holder', { ...contended, writer: { fence: 1, expiresAt: 4_400 } }],
    ['empty writer holder', { ...contended, writer: { holder: '', fence: 1, expiresAt: 4_400 } }],
    ['noninteger writer fence', { ...contended, writer: { ...winner, fence: 1.5 } }],
    ['negative writer fence', { ...contended, writer: { ...winner, fence: -1 } }],
    ['unsafe writer expiry', { ...contended, writer: { ...winner, expiresAt: Number.MAX_SAFE_INTEGER + 1 } }],
    ['missing held expiry', { kind: 'held', holder: winner.holder }],
    ['raw error value', new Error('database is locked')],
    ['null outcome', null],
  ])('rejects %s immediately, both initially and after a valid nondecision', async (_label, invalid) => {
    const first = scripted([]);
    await expect(settleC1Loser(first.worker, request, invalid, winner)).rejects.toThrow();
    expect(first.commands).toEqual([]);
    const later = scripted([reply(invalid)]);
    await expect(settleC1Loser(later.worker, request, contended, winner)).rejects.toThrow();
    expect(later.commands).toEqual([request]);
  });

  test.each([
    { ok: 'true', value: contended, startedAt: 1, endedAt: 2 },
    { ok: true, value: contended, startedAt: 'not a time', endedAt: 2 },
    { value: contended, startedAt: 1, endedAt: 2 },
    null,
  ])('rejects a malformed worker reply without another retry: %j', async (response) => {
    const fake = scripted([response, reply(held)]);
    await expect(settleC1Loser(fake.worker, request, contended, winner)).rejects.toThrow();
    expect(fake.commands).toEqual([request]);
  });

  test.each(['SqliteBusyError', 'HistoryBusyError', 'UnrelatedError'])('does not retry a %s failure reply', async (error) => {
    const fake = scripted([{ ok: false, error, message: 'not a lease nondecision', startedAt: 1, endedAt: 2 }]);
    await expect(settleC1Loser(fake.worker, request, contended, winner)).rejects.toThrow(error);
    expect(fake.commands).toEqual([request]);
  });

  test.each(['SqliteBusyError', 'HistoryBusyError', 'UnrelatedError'])('preserves a thrown %s without retrying it', async (name) => {
    const error = new Error('worker failed');
    error.name = name;
    const fake = scripted([error]);
    await expect(settleC1Loser(fake.worker, request, contended, winner)).rejects.toBe(error);
    expect(fake.commands).toEqual([request]);
  });

  test('exhaustion fails after three re-observations and retains the ordered nondecisions', async () => {
    const values = [0, 1, 2, 3].map((index) => ({ ...contended, detail: `contention-${String(index)}` }));
    const fake = scripted(values.slice(1).map(reply));
    let failure: unknown;
    try { await settleC1Loser(fake.worker, request, values[0], winner); } catch (error: unknown) { failure = error; }
    expect(failure).toBeInstanceOf(Error);
    if (!(failure instanceof Error)) { throw new Error('Expected bounded exhaustion'); }
    expect(failure.message).toMatch(/exhausted/u);
    expect(failure.message).toContain(JSON.stringify(values));
    expect(fake.commands).toEqual([request, request, request]);
  });
});
