/**
 * One long-lived worker process of the M5 concurrency suites. It opens the
 * production durable History over Node's real SQLite capability on the shared
 * file, then performs exactly the commands its parent sends, one at a time,
 * answering each with the operation's value or the class and message of what
 * History threw. It keeps every lease object it was granted and every attempt
 * it allocated, so a later command can present a lease that another process
 * has since superseded: the stale holder is this live process, not a replayed
 * credential.
 *
 * With the controlled clock, each mutating command sets History's next clock
 * reading, and read-only commands make the clock fail so any time access
 * during a read would be refused. With the host clock, History reads Node's
 * wall clock, which the free-running `contend` loop uses. A planted
 * pre-commit fault (`arm`) SIGKILLs the process inside the chosen
 * transaction, before SQLite commits.
 * @packageDocumentation
 */
import { performance } from 'node:perf_hooks';

import type { IAttemptRecord, IClockCapability, IDurableHistory, IWriterLease } from '@microdelta/history';
import { createNodeClock } from '@microdelta/machine-node';

import { controlledClock, observedSqlite, openHistory } from '../durable-history/support.js';
import { attemptRequest, evidence, labelAddress, lastPartAddress, payload, provenance, subject } from './fixture.js';
import { hostMonotonicMilliseconds, parseCommand, parseLaunch } from './protocol.js';
import type { IContentionEvent, IHarnessCommand, IHarnessReply } from './protocol.js';

const encoded = process.argv[2];
if (encoded === undefined) {
  throw new Error('worker requires a JSON launch argument');
}
const launch = parseLaunch(JSON.parse(encoded));
const controlled = controlledClock(0);
const clock: IClockCapability = launch.clock === 'host' ? createNodeClock() : controlled;
const sqlite = observedSqlite();
const history: IDurableHistory = openHistory({ location: launch.location, clock, sqlite: sqlite.capability, store: launch.store });

/** The most recent lease this process was granted or renewed; kept after it goes stale. */
let lease: IWriterLease | undefined;
/** Attempt identities this process allocated, by caller key. */
const attempts = new Map<string, number>();

/** A shared cell used only as a blocking-wait target; nothing notifies it. */
const sleeper = new Int32Array(new SharedArrayBuffer(4));

/** Block this process for about `milliseconds`. */
function sleep(milliseconds: number): void {
  Atomics.wait(sleeper, 0, 0, milliseconds);
}

/** The shared host monotonic clock the barrier and step timings use. */
const hostNow = hostMonotonicMilliseconds;

/**
 * Block until the host monotonic clock reaches `instant`: sleep while more
 * than the spin window remains, then spin, so workers released by one
 * barrier start close together. The window is wide because a timed sleep can
 * overshoot by milliseconds when the host coalesces timers.
 */
function waitUntil(instant: number): void {
  const spinWindow = 10;
  for (let remaining = instant - hostNow(); remaining > spinWindow; remaining = instant - hostNow()) {
    sleep(remaining - spinWindow);
  }
  while (hostNow() < instant) {
    // Spin for the final instant; sleeping here would blur the release.
  }
}

/** The lease a mutating command presents; a worker that was never granted one cannot mutate. */
function requireLease(): IWriterLease {
  if (lease === undefined) {
    throw new Error('this worker holds no lease object');
  }
  return lease;
}

/** The attempt this worker allocated under `key`. */
function requireAttempt(key: string): number {
  const attemptId = attempts.get(key);
  if (attemptId === undefined) {
    throw new Error(`this worker allocated no attempt under ${key}`);
  }
  return attemptId;
}

/** The identity-bearing fields of an attempt record, as JSON. */
function summarize(attempt: IAttemptRecord): unknown {
  return { attemptId: attempt.attemptId, state: attempt.state, allocatedFence: attempt.allocatedFence, endedFence: attempt.endedFence, locator: attempt.result?.locator ?? null };
}

/** Allocate `key` under the current lease and remember its identity. */
function allocate(key: string): IAttemptRecord {
  const attempt = history.allocateAttempt(requireLease(), attemptRequest(key));
  attempts.set(key, attempt.attemptId);
  return attempt;
}

/** Stage the labelled payload for the attempt this worker allocated under `key`, or for an explicitly named attempt. */
function stage(key: string, label: string, attemptId: number = requireAttempt(key)): IAttemptRecord {
  return history.stageAttempt(requireLease(), { attemptId, payload: payload(label), provenance: provenance(label), dependencies: [] });
}

/** Record one step of the contention loop: accepted, or refused with its class name. */
function attempt(log: IContentionEvent[], op: IContentionEvent['op'], fence: number, operation: () => unknown): boolean {
  try {
    operation();
    log.push({ op, ok: true, fence });
    return true;
  } catch (error: unknown) {
    log.push({ op, ok: false, fence, error: error instanceof Error ? error.name : 'unknown' });
    return false;
  }
}

/**
 * Contend for the writer on the host clock until the duration elapses. Each
 * tenure publishes one attempt, stages another, renews once, then outlives
 * its lease and presents it again for publication and allocation, which
 * History must refuse. A `held` answer is followed by a short pause.
 */
function contend(holder: string, durationMilliseconds: number, leaseMilliseconds: number): readonly IContentionEvent[] {
  const log: IContentionEvent[] = [];
  const deadline = performance.now() + durationMilliseconds;
  for (let pause = 0; performance.now() < deadline; pause = (pause + 1) % 3) {
    const acquisition = history.acquireWriter({ holder, leaseMilliseconds });
    if (acquisition.kind === 'held') {
      log.push({ op: 'acquire', ok: false, fence: 0, heldBy: acquisition.holder });
      sleep(1 + pause);
      continue;
    }
    lease = acquisition.lease;
    const fence = lease.fence;
    log.push({ op: 'acquire', ok: true, fence });
    const published = `${holder}:${String(fence)}:published`;
    const staged = `${holder}:${String(fence)}:left-staged`;
    if (attempt(log, 'allocate', fence, () => allocate(published)) && attempt(log, 'stage', fence, () => stage(published, published))) {
      attempt(log, 'publish', fence, () => history.publishAttempt(requireLease(), requireAttempt(published)));
    }
    if (attempt(log, 'allocate', fence, () => allocate(staged))) {
      attempt(log, 'stage', fence, () => stage(staged, staged));
    }
    attempt(log, 'renew', fence, () => {
      lease = history.renewWriter(requireLease(), leaseMilliseconds);
    });
    // Outlive the lease on the shared host clock, then present it again.
    sleep(lease.expiresAt - Date.now() + 5);
    if (attempts.has(staged)) {
      attempt(log, 'publish', fence, () => history.publishAttempt(requireLease(), requireAttempt(staged)));
    }
    attempt(log, 'allocate', fence, () => allocate(`${holder}:${String(fence)}:late`));
  }
  return log;
}

/** Perform one command and return its JSON value. */
function perform(command: IHarnessCommand): unknown {
  switch (command.op) {
    case 'acquire': {
      controlled.set(command.at);
      const acquisition = history.acquireWriter({ holder: command.holder, leaseMilliseconds: command.leaseMilliseconds });
      if (acquisition.kind === 'acquired') {
        lease = acquisition.lease;
      }
      return acquisition;
    }
    case 'renew':
      controlled.set(command.at);
      lease = history.renewWriter(requireLease(), command.leaseMilliseconds);
      return lease;
    case 'release':
      controlled.set(command.at);
      history.releaseWriter(requireLease());
      return null;
    case 'allocate':
      controlled.set(command.at);
      return summarize(allocate(command.key));
    case 'stage':
      controlled.set(command.at);
      return summarize(stage(command.key, command.label, command.attemptId ?? requireAttempt(command.key)));
    case 'publish':
      controlled.set(command.at);
      return history.publishAttempt(requireLease(), command.attemptId ?? requireAttempt(command.key));
    case 'abandon':
      controlled.set(command.at);
      return summarize(history.abandonAttempt(requireLease(), { attemptId: command.attemptId ?? requireAttempt(command.key), outcome: 'interrupted', evidence: evidence('abandoned') }));
    case 'accept': {
      controlled.set(command.at);
      const record = history.recordAcceptance(requireLease(), { reference: { kind: 'completed-result', locator: command.locator }, evidence: evidence('accepted'), dependencies: [] });
      return { acceptanceId: record.acceptanceId, fence: record.fence };
    }
    case 'recover': {
      controlled.fail();
      const outcome = history.recoverAttempt(attemptRequest(command.key));
      if (outcome.kind === 'absent') {
        return { kind: outcome.kind, state: null, locator: null, endedFence: null };
      }
      return { kind: outcome.kind, state: outcome.attempt.state, locator: outcome.attempt.result?.locator ?? null, endedFence: outcome.attempt.endedFence };
    }
    case 'inspect':
      controlled.fail();
      return { writer: history.currentWriter() ?? null, current: history.readCurrent(subject)?.locator ?? null };
    case 'read': {
      controlled.fail();
      const reference = { kind: 'completed-result', locator: command.locator } as const;
      return {
        label: history.reader.readSelected(reference, { operation: 'value', address: labelAddress }).fact,
        lastPart: history.reader.readSelected(reference, { operation: 'value', address: lastPartAddress }).fact,
        verification: history.verifyResult(reference).kind,
      };
    }
    case 'arm':
      sqlite.arm({ role: command.role, action: 'kill' });
      return null;
    case 'contend':
      return contend(command.holder, command.durationMilliseconds, command.leaseMilliseconds);
    case 'close':
      history.close();
      return null;
    default: {
      const exhaustive: never = command;
      return exhaustive;
    }
  }
}

/** Answer the parent; a closed worker then disconnects so the process can end. */
function reply(message: IHarnessReply, closing: boolean): void {
  process.send?.(message, undefined, undefined, () => {
    if (closing) {
      process.disconnect();
    }
  });
}

process.on('message', (message: unknown) => {
  let command: IHarnessCommand;
  try {
    command = parseCommand(message);
  } catch (error: unknown) {
    const now = hostNow();
    reply({ ok: false, error: 'HarnessProtocolError', message: error instanceof Error ? error.message : String(error), startedAt: now, endedAt: now }, false);
    return;
  }
  if (command.notBefore !== undefined) {
    waitUntil(command.notBefore);
  }
  const startedAt = hostNow();
  try {
    const value = perform(command);
    reply({ ok: true, value, startedAt, endedAt: hostNow() }, command.op === 'close');
  } catch (error: unknown) {
    const endedAt = hostNow();
    reply({ ok: false, error: error instanceof Error ? error.name : 'unknown', message: error instanceof Error ? error.message : String(error), startedAt, endedAt }, false);
  }
});

process.send?.({ ready: true });
