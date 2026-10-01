/**
 * Parent-side driver of the M5 concurrency suites. It starts long-lived worker
 * processes (`worker.ts`) over one shared SQLite file, sends each command to
 * the worker the test names and waits for its reply, so the test fixes the
 * global order of History operations across processes. It also reads the
 * durable writer, attempt, result, current-pointer and acceptance rows from
 * this separate process for before/after comparison, and narrows the JSON
 * values workers return. It never performs a History mutation itself.
 * @packageDocumentation
 */
import { fork } from 'node:child_process';
import type { ChildProcess } from 'node:child_process';
import { fileURLToPath } from 'node:url';

import { expect } from '@jest/globals';
import type { IDurableHistory, IWriterLease } from '@microdelta/history';

import { controlledClock, freshLocation, openHistory, openRaw } from '../durable-history/support.js';
import type { ISqliteRow } from '../durable-history/support.js';
import { concurrencyStore } from './fixture.js';
import { hostMonotonicMilliseconds, isRecord, lifecyclePrefix, numberField, parseLease, parseReply, stringField } from './protocol.js';
import type { IHarnessCommand, IHarnessReply, IWorkerLaunch } from './protocol.js';

/** The emitted worker module beside this driver. */
const workerPath = fileURLToPath(new URL('./worker.js', import.meta.url));

/** How long one command may take before the driver treats the worker as hung. */
const commandTimeoutMilliseconds = 30_000;

/** How a worker process ended. */
export interface IWorkerExit {
  /** The exit code, or null when a signal ended it. */
  readonly code: number | null;
  /** The terminating signal, or null for a normal exit. */
  readonly signal: NodeJS.Signals | null;
}

/** One running worker process as a test addresses it. */
export interface IWorkerHandle {
  /** The name the test gave this worker, used in diagnostics. */
  readonly name: string;
  /**
   * Send one command and wait for its reply. Rejects if the process exits
   * first (for example when a planted fault kills it) or does not answer.
   */
  step(command: IHarnessCommand): Promise<IHarnessReply>;
  /** Close the worker's History handle and wait for a clean exit. */
  close(): Promise<void>;
  /** Settles when the process has ended. */
  readonly exit: Promise<IWorkerExit>;
}

/** Workers started by the current test, stopped by {@link stopWorkers}. */
const running = new Set<ChildProcess>();

/** A reply awaited from a worker. */
interface IPending {
  readonly resolve: (reply: IHarnessReply) => void;
  readonly reject: (error: Error) => void;
}

/** What the driver is waiting on from one worker, for diagnosing an early exit. */
interface IAwaited {
  /** `ready` for start-up, otherwise the command's operation. */
  readonly what: string;
  /** When it began, on the host monotonic clock. */
  readonly since: number;
}

/**
 * The parts of a worker's child process the driver relies on. `ChildProcess`
 * satisfies it; the driver's own tests substitute a scripted child to emit
 * process events in chosen orders.
 */
export interface IWorkerProcess {
  /** Whether the IPC channel is still open for sending. */
  readonly connected: boolean;
  /** The worker's stderr, kept for diagnostics. */
  readonly stderr: { setEncoding(encoding: BufferEncoding): unknown; on(event: 'data', listener: (chunk: string) => void): unknown } | null;
  /** Send one command over the IPC channel. */
  send(message: IHarnessCommand): boolean;
  /** The process ended. */
  on(event: 'exit', listener: (code: number | null, signal: NodeJS.Signals | null) => void): this;
  /** The process ended and its stdio and IPC channel have closed. */
  on(event: 'close', listener: () => void): this;
  /** A message arrived over the IPC channel. */
  on(event: 'message', listener: (message: unknown) => void): this;
}

/** Start one worker process on the shared file and wait until it has opened History. */
export function startWorker(name: string, launch: IWorkerLaunch): Promise<IWorkerHandle> {
  const child = fork(workerPath, [JSON.stringify(launch)], { stdio: ['ignore', 'ignore', 'pipe', 'ipc'], serialization: 'json' });
  running.add(child);
  child.on('exit', () => {
    running.delete(child);
  });
  return attachWorker(name, child);
}

/**
 * Drive one worker process: send it commands one at a time and wait until it
 * reports ready. Its stderr is kept for diagnostics, with the worker's
 * lifecycle markers held apart from anything else it writes.
 *
 * A worker that ends while the driver awaits it fails whatever was awaited.
 * The failure is decided when the child's stdio and IPC channel have closed,
 * not at its exit event, so every reply and marker it wrote has been read.
 * The error names what was awaited (`ready` or the pending operation), how
 * long ago it was sent, the exit code or signal, and the worker's markers.
 */
export function attachWorker(name: string, child: IWorkerProcess): Promise<IWorkerHandle> {
  let stderr = '';
  child.stderr?.setEncoding('utf8');
  child.stderr?.on('data', (chunk: string) => {
    stderr += chunk;
  });
  /** Lines the worker wrote to stderr that are not lifecycle markers. */
  const unexpectedStderr = (): string => stderr.split('\n').filter((line) => line.length > 0 && !line.startsWith(lifecyclePrefix)).join('\n');
  /** The worker's lifecycle markers, oldest first. */
  const lifecycle = (): string => stderr.split('\n').filter((line) => line.startsWith(lifecyclePrefix)).map((line) => line.slice(lifecyclePrefix.length)).join(' > ');

  let pending: IPending | undefined;
  let ready: IPending | undefined;
  let awaited: IAwaited | undefined = { what: 'ready', since: hostMonotonicMilliseconds() };
  let ended: IWorkerExit | undefined;

  const exit = new Promise<IWorkerExit>((resolve) => {
    child.on('exit', (code, signal) => {
      ended = { code, signal };
      resolve(ended);
    });
  });
  // Decide at `close`, never at `exit`: `exit` can precede the reading of the
  // last messages the worker wrote, so a worker that answered and then ended
  // would be misreported as dead. `close` follows the IPC channel's end, after
  // every message the worker wrote has been delivered.
  child.on('close', () => {
    if (pending === undefined && ready === undefined) {
      return;
    }
    const waiting = awaited === undefined ? 'nothing' : `${awaited.what} (sent ${(hostMonotonicMilliseconds() - awaited.since).toFixed(1)} ms earlier)`;
    const error = new Error(`worker ${name} exited (code ${String(ended?.code)}, signal ${String(ended?.signal)}) while awaiting ${waiting}; lifecycle: ${lifecycle() || 'none'}; stderr: ${unexpectedStderr() || 'none'}`);
    pending?.reject(error);
    ready?.reject(error);
    pending = undefined;
    ready = undefined;
  });
  child.on('message', (message: unknown) => {
    awaited = undefined;
    if (ready !== undefined) {
      const waiting = ready;
      ready = undefined;
      if (isRecord(message) && message.ready === true) {
        waiting.resolve({ ok: true, value: null, startedAt: 0, endedAt: 0 });
      } else {
        waiting.reject(new Error(`worker ${name} did not start: ${JSON.stringify(message)}`));
      }
      return;
    }
    const waiting = pending;
    pending = undefined;
    if (waiting === undefined) {
      return;
    }
    try {
      waiting.resolve(parseReply(message));
    } catch (error: unknown) {
      waiting.reject(error instanceof Error ? error : new Error(String(error)));
    }
  });

  const handle: IWorkerHandle = {
    name,
    exit,
    step(command: IHarnessCommand): Promise<IHarnessReply> {
      if (pending !== undefined) {
        return Promise.reject(new Error(`worker ${name} already has a command in flight`));
      }
      return new Promise<IHarnessReply>((resolve, reject) => {
        const timer = setTimeout(() => {
          pending = undefined;
          reject(new Error(`worker ${name} did not answer ${command.op} within ${String(commandTimeoutMilliseconds)} ms; lifecycle: ${lifecycle() || 'none'}`));
        }, commandTimeoutMilliseconds);
        pending = {
          resolve: (reply) => {
            clearTimeout(timer);
            resolve(reply);
          },
          reject: (error) => {
            clearTimeout(timer);
            reject(error);
          },
        };
        if (!child.connected) {
          clearTimeout(timer);
          pending = undefined;
          reject(new Error(`worker ${name} had already disconnected before ${command.op}; lifecycle: ${lifecycle() || 'none'}`));
          return;
        }
        awaited = { what: command.op, since: hostMonotonicMilliseconds() };
        child.send(command);
      });
    },
    async close(): Promise<void> {
      const reply = await handle.step({ op: 'close' });
      if (!reply.ok) {
        throw new Error(`worker ${name} failed to close: ${reply.message}`);
      }
      const result = await exit;
      if (result.code !== 0 || unexpectedStderr() !== '') {
        throw new Error(`worker ${name} ended abnormally: ${JSON.stringify(result)} ${unexpectedStderr()}`);
      }
    },
  };

  return new Promise<IWorkerHandle>((resolve, reject) => {
    ready = { resolve: () => { resolve(handle); }, reject };
  });
}

/** Kill every worker still running and wait for each to end. */
export async function stopWorkers(): Promise<void> {
  const children = [...running];
  await Promise.all(children.map((child) => new Promise<void>((resolve) => {
    if (child.exitCode !== null || child.signalCode !== null) {
      resolve();
      return;
    }
    child.once('exit', () => {
      resolve();
    });
    child.kill('SIGKILL');
  })));
  running.clear();
}

/** One durable attempt row as the parent reads it. */
export interface IAttemptRow {
  readonly attemptId: number;
  readonly key: string;
  readonly state: string;
  readonly allocatedFence: number;
  readonly endedFence: number | null;
  readonly hasStaged: boolean;
}

/** One durable result row. */
export interface IResultRow {
  readonly resultId: number;
  readonly publication: number;
  readonly publishedFence: number;
}

/**
 * The durable rows the concurrency suites compare across a step: the writer
 * row, every attempt, result, current pointer and acceptance, and the
 * store-wide sequences. Attempts are in identity order and results in
 * publication order, which is the order storage received them.
 */
export interface IDurableState {
  readonly writer: { readonly holder: string | null; readonly lastFence: number; readonly expiresAt: number };
  readonly timeHighWater: number;
  readonly sequences: { readonly attempt: number; readonly publication: number; readonly acceptance: number };
  readonly attempts: readonly IAttemptRow[];
  readonly results: readonly IResultRow[];
  readonly current: readonly string[];
  readonly acceptances: readonly string[];
}

/** A stored integer cell, or a failure naming the column. */
function integerCell(row: ISqliteRow, column: string): number {
  const value = row[column];
  if (typeof value !== 'number' || !Number.isSafeInteger(value)) {
    throw new Error(`column ${column} is not an integer: ${String(value)}`);
  }
  return value;
}

/** A stored text cell, or a failure naming the column. */
function textCell(row: ISqliteRow, column: string): string {
  const value = row[column];
  if (typeof value !== 'string') {
    throw new Error(`column ${column} is not text: ${String(value)}`);
  }
  return value;
}

/** Read the durable state through a raw connection in this process. */
export function snapshot(location: string): IDurableState {
  const raw = openRaw(location);
  try {
    const writer = raw.prepare('SELECT holder, last_fence, expires_at, time_high_water FROM history_writer').get();
    const sequences = raw.prepare('SELECT last_attempt, last_publication, last_acceptance FROM history_sequences').get();
    if (writer === undefined || sequences === undefined) {
      throw new Error('History singleton rows are missing');
    }
    const holder = writer.holder;
    return {
      writer: { holder: typeof holder === 'string' ? holder : null, lastFence: integerCell(writer, 'last_fence'), expiresAt: integerCell(writer, 'expires_at') },
      timeHighWater: integerCell(writer, 'time_high_water'),
      sequences: { attempt: integerCell(sequences, 'last_attempt'), publication: integerCell(sequences, 'last_publication'), acceptance: integerCell(sequences, 'last_acceptance') },
      attempts: raw.prepare('SELECT attempt_id, attempt_key, state, allocated_fence, ended_fence, staged_payload IS NOT NULL AS has_staged FROM history_attempts ORDER BY attempt_id').all()
        .map((row) => ({
          attemptId: integerCell(row, 'attempt_id'),
          key: textCell(row, 'attempt_key'),
          state: textCell(row, 'state'),
          allocatedFence: integerCell(row, 'allocated_fence'),
          endedFence: row.ended_fence === null ? null : integerCell(row, 'ended_fence'),
          hasStaged: integerCell(row, 'has_staged') === 1,
        })),
      results: raw.prepare('SELECT result_id, publication, published_fence FROM history_results ORDER BY publication').all()
        .map((row) => ({ resultId: integerCell(row, 'result_id'), publication: integerCell(row, 'publication'), publishedFence: integerCell(row, 'published_fence') })),
      current: raw.prepare('SELECT subject, result_id FROM history_current ORDER BY subject').all()
        .map((row) => `${textCell(row, 'subject')}=${String(integerCell(row, 'result_id'))}`),
      acceptances: raw.prepare('SELECT acceptance_id, result_id, fence FROM history_acceptances ORDER BY acceptance_id').all()
        .map((row) => `${String(integerCell(row, 'acceptance_id'))}:${String(integerCell(row, 'result_id'))}@${String(integerCell(row, 'fence'))}`),
    };
  } finally {
    raw.close();
  }
}

/**
 * Everything in a durable state except the clock high-water: the facts a
 * refused mutation or a waiter's observation must leave unchanged.
 */
export function authorityOf(state: IDurableState): Omit<IDurableState, 'timeHighWater'> {
  const { timeHighWater: _observedTime, ...authority } = state;
  return authority;
}

/**
 * Create an initialized, empty store in a fresh temporary file and return its
 * location. Workers then open an existing store: several processes creating
 * one new file at the same instant is a separate concern of the Node SQLite
 * capability (issue #113), outside these suites.
 */
export function freshStore(): string {
  const location = freshLocation();
  reopenForReading(location, 0).close();
  return location;
}

/** Open History in this process for final reads; its clock never matters for reads. */
export function reopenForReading(location: string, at: number): IDurableHistory {
  return openHistory({ location, clock: controlledClock(at), store: concurrencyStore });
}

/**
 * Require a refusal of the given History class. When `message` is given, the
 * refusal's message must match it, which pins which branch of a guard refused
 * (for example a stale fence versus an expired lease).
 */
export function expectRefused(reply: IHarnessReply, errorName: string, message?: RegExp): void {
  expect(reply.ok ? { ok: true, value: reply.value } : { ok: false, error: reply.error }).toEqual({ ok: false, error: errorName });
  if (message !== undefined && !reply.ok) {
    expect(reply.message).toMatch(message);
  }
}

/**
 * How several workers' runs of one barrier command related in host time:
 * `skew` is the spread of their start times; `overlap` is the longest time
 * during which at least two of them were running at once (0 if none were).
 */
export interface IConcurrencyMeasure {
  readonly skew: number;
  readonly overlap: number;
}

/** Measure start skew and pairwise overlap of barrier-aligned step intervals. */
export function measureConcurrency(intervals: readonly { readonly startedAt: number; readonly endedAt: number }[]): IConcurrencyMeasure {
  const starts = intervals.map((interval) => interval.startedAt);
  let overlap = 0;
  intervals.forEach((left, index) => {
    for (const right of intervals.slice(index + 1)) {
      overlap = Math.max(overlap, Math.min(left.endedAt, right.endedAt) - Math.max(left.startedAt, right.startedAt));
    }
  });
  return { skew: Math.max(...starts) - Math.min(...starts), overlap: Math.max(0, overlap) };
}

/** The lease of an `acquired` or `renewed` outcome, or a bare lease. */
export function leaseFrom(value: unknown): IWriterLease {
  if (isRecord(value) && value.kind !== undefined) {
    if (value.kind !== 'acquired' && value.kind !== 'renewed') {
      throw new Error(`expected to acquire or renew, observed ${JSON.stringify(value)}`);
    }
    return parseLease(value.lease);
  }
  return parseLease(value);
}

/** The holder and expiry History named in a `held` outcome. */
export function heldFrom(value: unknown): { readonly holder: string; readonly expiresAt: number } {
  if (!isRecord(value) || value.kind !== 'held') {
    throw new Error(`expected a held outcome, observed ${JSON.stringify(value)}`);
  }
  return { holder: stringField(value, 'holder'), expiresAt: numberField(value, 'expiresAt') };
}

/** The exact locator of a published reference. */
export function locatorFrom(value: unknown): string {
  if (!isRecord(value) || value.kind !== 'completed-result') {
    throw new Error(`expected a completed-result reference, observed ${JSON.stringify(value)}`);
  }
  return stringField(value, 'locator');
}

/** The identity-bearing fields of an attempt summary. */
export interface IAttemptSummary {
  readonly attemptId: number;
  readonly state: string;
  readonly allocatedFence: number;
  readonly endedFence: number | null;
  readonly locator: string | null;
}

/** Narrow an attempt summary returned by allocate, stage or abandon. */
export function attemptFrom(value: unknown): IAttemptSummary {
  if (!isRecord(value)) {
    throw new Error(`expected an attempt, observed ${JSON.stringify(value)}`);
  }
  return {
    attemptId: numberField(value, 'attemptId'),
    state: stringField(value, 'state'),
    allocatedFence: numberField(value, 'allocatedFence'),
    endedFence: value.endedFence === null ? null : numberField(value, 'endedFence'),
    locator: value.locator === null ? null : stringField(value, 'locator'),
  };
}

/** Narrow a recovery report. */
export function recoveryFrom(value: unknown): { readonly kind: string; readonly state: string | null; readonly locator: string | null; readonly endedFence: number | null } {
  if (!isRecord(value)) {
    throw new Error(`expected a recovery outcome, observed ${JSON.stringify(value)}`);
  }
  return {
    kind: stringField(value, 'kind'),
    state: value.state === null ? null : stringField(value, 'state'),
    locator: value.locator === null ? null : stringField(value, 'locator'),
    endedFence: value.endedFence === null ? null : numberField(value, 'endedFence'),
  };
}

/** Narrow an inspection: the recorded writer and the subject's current locator. */
export function inspectionFrom(value: unknown): { readonly writer: IWriterLease | null; readonly current: string | null } {
  if (!isRecord(value)) {
    throw new Error(`expected an inspection, observed ${JSON.stringify(value)}`);
  }
  return {
    writer: value.writer === null ? null : parseLease(value.writer),
    current: value.current === null ? null : stringField(value, 'current'),
  };
}

/** Narrow an exact read: the label, the last part's label and index verification. */
export function readFrom(value: unknown): { readonly label: string; readonly lastPart: string; readonly verification: string } {
  if (!isRecord(value)) {
    throw new Error(`expected an exact read, observed ${JSON.stringify(value)}`);
  }
  return { label: stringField(value, 'label'), lastPart: stringField(value, 'lastPart'), verification: stringField(value, 'verification') };
}

/** Narrow a recorded acceptance to the fence it was written under. */
export function acceptanceFrom(value: unknown): { readonly fence: number } {
  if (!isRecord(value)) {
    throw new Error(`expected an acceptance, observed ${JSON.stringify(value)}`);
  }
  return { fence: numberField(value, 'fence') };
}
