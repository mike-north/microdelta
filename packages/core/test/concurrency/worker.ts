/**
 * One long-lived worker process of the M5 concurrency suites. It opens the
 * production durable History over Node's real SQLite capability on the shared
 * file, then performs exactly the commands its parent sends, one at a time,
 * answering each with the operation's value or the class and message of what
 * History threw. It can also host one real supervised run whose normal
 * request waits for the writer lease through the facade's writer port, on a
 * timer that reads the controlled clock and fires only when the parent
 * advances it, so cross-process waiting, takeover and deadlines are driven
 * without real sleeps. It keeps every lease object it was granted and every attempt
 * it allocated, so a later command can present a lease that another process
 * has since superseded: the stale holder is this live process, not a replayed
 * credential.
 *
 * With the controlled clock, each mutating command sets History's next clock
 * reading, and read-only commands make the clock fail so any time access
 * during a read would be refused. With the host clock, History reads Node's
 * wall clock, which the free-running `contend` loop uses. A planted
 * pre-commit fault (`arm`) SIGKILLs the process inside the chosen
 * transaction, before SQLite commits. At each point of its life the worker
 * writes a lifecycle marker to stderr synchronously, so a driver that sees it
 * end unexpectedly can report how far it got.
 * @packageDocumentation
 */
import { writeSync } from 'node:fs';
import { performance } from 'node:perf_hooks';

import type { IBindingDescriptor } from '@microdelta/definition';
import type { IAttemptRecord, IClockCapability, IDurableHistory, IWriterLease } from '@microdelta/history';
import { createNodeClock, createNodeMachine, createNodeTimer } from '@microdelta/machine-node';
import type { ICheckOutcome, IRecoveryResult, IResolution, IResolutionOutcome, IResolveRequest } from '@microdelta/resolution';
import { SupervisionError, WriterBusyError, createStopController, createSupervision } from '@microdelta/supervision';
import type { IRun, IRunTimer, IRunWriter, IStopController, ISupervision, IWriterAttempt } from '@microdelta/supervision';

import { writerFor } from '../../src/writer.js';
import { controlledClock, observedSqlite, openHistory } from '../durable-history/support.js';
import { attemptRequest, evidence, labelAddress, lastPartAddress, payload, provenance, subject } from './fixture.js';
import { hostMonotonicMilliseconds, lifecyclePrefix, parseCommand, parseLaunch } from './protocol.js';
import type { IContentionEvent, IHarnessCommand, IHarnessReply, IWaitAttempt, IWaitCommand, IWaitContentionEvent, IWaitOutcome, IWaitStatus } from './protocol.js';

/** Record how far this worker got, synchronously, so the record survives an abrupt end. */
function mark(point: string): void {
  writeSync(2, `${lifecyclePrefix}${point}\n`);
}

mark('module evaluated');
process.on('beforeExit', (code) => {
  mark(`event loop drained (beforeExit ${String(code)})`);
});
process.on('exit', (code) => {
  mark(`exit ${String(code)}`);
});
process.on('disconnect', () => {
  mark('ipc disconnected');
});

const encoded = process.argv[2];
if (encoded === undefined) {
  throw new Error('worker requires a JSON launch argument');
}
const launch = parseLaunch(JSON.parse(encoded));
const controlled = controlledClock(0);
const clock: IClockCapability = launch.clock === 'host' ? createNodeClock() : controlled;
const sqlite = observedSqlite();
const history: IDurableHistory = openHistory({ location: launch.location, clock, sqlite: sqlite.capability, store: launch.store });
mark('history opened');

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

/** One wake-up a waiting run scheduled on the controlled timer. */
interface IScheduledWake {
  readonly at: number;
  readonly callback: () => void;
  done: boolean;
}

/** Wake-ups scheduled on the controlled timer, fired only by `wait-advance`. */
const wakes: IScheduledWake[] = [];

/**
 * The timer a waiting run sees. With the controlled clock it reads the same
 * controlled time History does and fires wake-ups only when the parent
 * advances that time, so every poll happens at an instant the test chose and
 * no real time passes. With the host clock it is Node's real timer.
 */
const runTimer: IRunTimer = launch.clock === 'host' ? createNodeTimer() : {
  currentEpochMilliseconds: () => controlled.currentEpochMilliseconds(),
  schedule(at: number, callback: () => void): () => void {
    const wake: IScheduledWake = { at, callback, done: false };
    wakes.push(wake);
    return () => {
      wake.done = true;
    };
  },
};

/** The real Run Supervision the waiting runs use, over Node's async context and this worker's run timer. */
const supervision: ISupervision = createSupervision({ context: createNodeMachine(), timer: runTimer });

/** The step a waiting run's normal request resolves; the Resolution double below publishes it. */
const waiterStep: IBindingDescriptor = Object.freeze({ scope: subject.analysis, role: 'step', slot: 'waiter' });

/** Let every queued continuation and the immediate after it run. */
function settleTurn(): Promise<void> {
  return new Promise((resolve) => {
    setImmediate(resolve);
  });
}

/** Wait for real time on the host clock without blocking the event loop. */
function holdFor(milliseconds: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, milliseconds);
  });
}

/**
 * A Resolution double whose normal request does real History work with the
 * lease Supervision handed it: it allocates, stages and publishes `key`, so a
 * granted lease is shown to be current authority with its own fence. The
 * lease becomes this worker's lease object, so later commands can present it
 * after it goes stale. Check and recovery count requests and touch nothing.
 */
function waiterResolution(key: string, granted: (lease: IWriterLease, published: string) => void, checked: () => void): IResolution {
  const unused = (): Promise<never> => Promise.reject(new Error('not used by the waiting worker'));
  return {
    resolve(request: IResolveRequest): Promise<IResolutionOutcome> {
      lease = request.lease;
      allocate(key);
      stage(key, key);
      const reference = history.publishAttempt(request.lease, requireAttempt(key));
      granted(request.lease, reference.locator);
      return Promise.resolve(Object.freeze({ kind: 'published', step: request.step, reference, attemptId: requireAttempt(key), misses: [], trace: [], diagnostics: [] }));
    },
    resolveMembers: unused,
    resolveFold: unused,
    check(): Promise<ICheckOutcome> {
      checked();
      return Promise.resolve(Object.freeze({ kind: 'execution-required', step: waiterStep, misses: [] }));
    },
    recover(): IRecoveryResult {
      checked();
      return Object.freeze({ kind: 'absent' });
    },
  };
}

/** Describe one try of the writer port as JSON. */
function describeAttempt(at: number, attempt: IWriterAttempt): IWaitAttempt {
  switch (attempt.kind) {
    case 'acquired':
      return { at, kind: attempt.kind, holder: attempt.lease.holder, expiresAt: attempt.lease.expiresAt, fence: attempt.lease.fence };
    case 'held':
      return { at, kind: attempt.kind, holder: attempt.holder, expiresAt: attempt.expiresAt, fence: null };
    case 'contended':
      return { at, kind: attempt.kind, holder: attempt.holder ?? null, expiresAt: attempt.expiresAt ?? null, fence: null };
    default: {
      const exhaustive: never = attempt;
      return exhaustive;
    }
  }
}

/** Classify how a waiting request failed: the typed busy outcome, a stop, or anything else by class name. */
function failureOutcome(error: unknown): IWaitOutcome {
  if (error instanceof WriterBusyError) {
    return { kind: 'busy', error: error.name, holder: error.holder ?? null, expiresAt: error.expiresAt ?? null, deadline: error.deadline, contended: error.contended, message: error.message };
  }
  if (error instanceof SupervisionError && error.code === 'stopped') {
    return { kind: 'stopped', message: error.message };
  }
  return { kind: 'failed', error: error instanceof Error ? error.name : 'unknown', message: error instanceof Error ? error.message : String(error) };
}

/** The writer port wrapped so every try is recorded with the time it was made. */
function observedWriter(port: IRunWriter, attempts: IWaitAttempt[]): IRunWriter {
  return {
    tryLease(): IWriterAttempt {
      const at = runTimer.currentEpochMilliseconds();
      const attempt = port.tryLease();
      attempts.push(describeAttempt(at, attempt));
      return attempt;
    },
    release(): void {
      port.release();
    },
  };
}

/** The worker's one waiting run, between `wait-start` and its close. */
interface IActiveWait {
  readonly attempts: IWaitAttempt[];
  outcome: IWaitOutcome;
  checks: number;
  readonly stop: IStopController;
  live: IRun | undefined;
  /** Lets the run's body return, so the run closes and releases its lease. */
  readonly finish: () => void;
  /** Settles when the run has closed; set once the run has started. */
  closed: Promise<unknown>;
}

let active: IActiveWait | undefined;

/** The active wait, or a harness error. */
function requireWait(): IActiveWait {
  if (active === undefined) {
    throw new Error('this worker has no waiting run');
  }
  return active;
}

/** Report the waiting run's state. */
function waitStatus(): IWaitStatus {
  const wait = requireWait();
  return { attempts: [...wait.attempts], outcome: wait.outcome, checks: wait.checks, pendingWakes: wakes.filter((wake) => !wake.done).length };
}

/**
 * Start one supervised run whose single normal request waits for the writer
 * lease through the facade's real writer port over this worker's History.
 * The run stays open after its request settles until `wait-finish`.
 */
function startWait(command: Extract<IWaitCommand, { readonly op: 'wait-start' }>): void {
  if (active !== undefined) {
    throw new Error('this worker already has a waiting run');
  }
  let finish: () => void = () => undefined;
  const finished = new Promise<void>((resolve) => {
    finish = resolve;
  });
  const stop = createStopController({ timer: runTimer });
  const attempts: IWaitAttempt[] = [];
  let granted: { readonly lease: IWriterLease; readonly published: string } | undefined;
  const wait: IActiveWait = {
    attempts,
    outcome: { kind: 'pending' },
    checks: 0,
    stop,
    live: undefined,
    finish: () => {
      finish();
    },
    closed: Promise.resolve(),
  };
  const closed = supervision.run({
    analysis: subject.analysis,
    environment: subject.environment,
    runId: `waiter:${command.key}`,
    writer: observedWriter(writerFor(history, command.holder, command.leaseMilliseconds), attempts),
    writerWait: command.deadline === undefined ? { pollMilliseconds: command.pollMilliseconds } : { deadline: command.deadline, pollMilliseconds: command.pollMilliseconds },
    stop,
    resolution: () => waiterResolution(command.key, (grantedLease, published) => {
      granted = { lease: grantedLease, published };
    }, () => {
      wait.checks += 1;
    }),
  }, async (live) => {
    wait.live = live;
    try {
      await live.resolve(waiterStep, { requestKey: `request:${command.key}` });
      if (granted === undefined) {
        throw new Error('the request settled without a grant');
      }
      wait.outcome = { kind: 'acquired', holder: granted.lease.holder, fence: granted.lease.fence, expiresAt: granted.lease.expiresAt, published: granted.published };
    } catch (error: unknown) {
      wait.outcome = failureOutcome(error);
    }
    await finished;
  });
  wait.closed = closed;
  active = wait;
}

/**
 * Move the controlled clock to `at`, firing every wake-up due by then at its
 * own scheduled time and letting each resulting try run before the next.
 */
async function advanceTo(at: number): Promise<void> {
  for (;;) {
    const due = wakes.filter((wake) => !wake.done && wake.at <= at).sort((left, right) => left.at - right.at)[0];
    if (due === undefined) {
      break;
    }
    controlled.set(Math.max(due.at, 0));
    due.done = true;
    due.callback();
    await settleTurn();
    await settleTurn();
  }
  controlled.set(at);
  await settleTurn();
}

/**
 * Repeat whole waits on the host clock until the duration elapses. Each
 * tenure is one real supervised run that waits up to `waitMilliseconds` for
 * the lease, publishes once under the lease it obtains, holds the lease for
 * `holdMilliseconds` and closes, releasing it, then rests for
 * `restMilliseconds`. Waiting is not fair, so without the rest a releasing
 * worker could take the lease straight back from waiters that poll later.
 */
async function contendWaiting(command: Extract<IWaitCommand, { readonly op: 'wait-contend' }>): Promise<readonly IWaitContentionEvent[]> {
  const events: IWaitContentionEvent[] = [];
  const end = performance.now() + command.durationMilliseconds;
  for (let tenure = 1; performance.now() < end; tenure += 1) {
    const key = `${command.holder}:tenure:${String(tenure)}`;
    const counter = { tries: 0 };
    const port = writerFor(history, command.holder, command.leaseMilliseconds);
    const counted: IRunWriter = {
      tryLease(): IWriterAttempt {
        counter.tries += 1;
        return port.tryLease();
      },
      release(): void {
        port.release();
      },
    };
    let granted: { readonly lease: IWriterLease; readonly published: string } | undefined;
    try {
      await supervision.run({
        analysis: subject.analysis,
        environment: subject.environment,
        runId: key,
        writer: counted,
        writerWait: { deadline: Date.now() + command.waitMilliseconds, pollMilliseconds: command.pollMilliseconds },
        resolution: () => waiterResolution(key, (grantedLease, published) => {
          granted = { lease: grantedLease, published };
        }, () => undefined),
      }, async (live) => {
        await live.resolve(waiterStep, { requestKey: `request:${key}` });
        await holdFor(command.holdMilliseconds);
      });
      if (granted === undefined) {
        throw new Error('the tenure settled without a grant');
      }
      events.push({ kind: 'granted', fence: granted.lease.fence, tries: counter.tries, published: granted.published });
    } catch (error: unknown) {
      const outcome = failureOutcome(error);
      events.push(outcome.kind === 'busy'
        ? { kind: 'busy', holder: outcome.holder, contended: outcome.contended, tries: counter.tries }
        : { kind: 'failed', error: outcome.kind === 'failed' ? outcome.error : outcome.kind, message: 'message' in outcome ? outcome.message : '', tries: counter.tries });
    }
    await holdFor(command.restMilliseconds);
  }
  return events;
}

/** Perform one waiting-run command and return its JSON value. */
async function performWait(command: IWaitCommand): Promise<unknown> {
  switch (command.op) {
    case 'wait-start':
      controlled.set(command.at);
      startWait(command);
      await settleTurn();
      await settleTurn();
      return waitStatus();
    case 'wait-advance':
      await advanceTo(command.at);
      return waitStatus();
    case 'wait-stop':
      requireWait().stop.request({ level: command.level });
      await settleTurn();
      await settleTurn();
      return waitStatus();
    case 'wait-check': {
      const live = requireWait().live;
      if (live === undefined) {
        throw new Error('the waiting run has not started its body');
      }
      const checked = await live.check(waiterStep);
      const recovered = await live.recover(waiterStep, { requestKey: 'request:never-made' });
      return { ...waitStatus(), checked: checked.kind, recovered: recovered.kind };
    }
    case 'wait-finish': {
      const wait = requireWait();
      controlled.set(command.at);
      wait.finish();
      await wait.closed;
      const status = waitStatus();
      active = undefined;
      return status;
    }
    case 'wait-contend':
      return contendWaiting(command);
    default: {
      const exhaustive: never = command;
      return exhaustive;
    }
  }
}

/** Whether a command drives a waiting run. */
function isWaitCommand(command: IHarnessCommand): command is IWaitCommand & { readonly notBefore?: number } {
  return command.op.startsWith('wait-');
}

/** Perform one command and return its JSON value. */
function perform(command: Exclude<IHarnessCommand, IWaitCommand>): unknown {
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
    case 'die':
      // The holder dies abruptly while it holds whatever lease it holds: no release, no reply.
      process.kill(process.pid, 'SIGKILL');
      return null;
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
    mark('replied');
    if (closing) {
      process.disconnect();
    }
  });
}

process.on('message', (message: unknown) => {
  let command: IHarnessCommand;
  try {
    command = parseCommand(message);
    mark(`received ${command.op}`);
  } catch (error: unknown) {
    const now = hostNow();
    reply({ ok: false, error: 'HarnessProtocolError', message: error instanceof Error ? error.message : String(error), startedAt: now, endedAt: now }, false);
    return;
  }
  if (command.notBefore !== undefined) {
    waitUntil(command.notBefore);
  }
  const startedAt = hostNow();
  const replyFailure = (error: unknown): void => {
    const endedAt = hostNow();
    reply({ ok: false, error: error instanceof Error ? error.name : 'unknown', message: error instanceof Error ? error.message : String(error), startedAt, endedAt }, false);
  };
  if (isWaitCommand(command)) {
    // A waiting run's commands settle asynchronously; the parent still sends one command at a time.
    performWait(command).then((value) => {
      reply({ ok: true, value, startedAt, endedAt: hostNow() }, false);
    }, replyFailure);
    return;
  }
  try {
    const value = perform(command);
    reply({ ok: true, value, startedAt, endedAt: hostNow() }, command.op === 'close');
  } catch (error: unknown) {
    replyFailure(error);
  }
});

mark('listener registered');
process.send?.({ ready: true }, undefined, undefined, () => {
  mark('ready sent');
});
