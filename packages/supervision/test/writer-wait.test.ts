/**
 * Owner tests for waiting for storage's single writer lease (RUN-002 owner
 * decision, PUB-005, A-09). Expectations come from the owner's 2026-09-30
 * decision and the M5 plan, not from the implementation:
 *
 * - one fenced writer per store; another writer *waits* for the lease, taking
 *   over an expired lease only through History's fencing, until an
 *   operator-supplied deadline. There is **no default deadline**;
 * - at the deadline the request fails with a typed writer-busy outcome that
 *   names the holder; storage contention (`SQLITE_BUSY` exhaustion) also ends
 *   there as that typed outcome, never as a raw driver error;
 * - read-only check and inspection never need the lease;
 * - Run Supervision owns the waiting policy over a structurally injected
 *   timer, and a stop ends the wait like any other wait for a time.
 *
 * The writer port is a scripted double answering as History's acquisition
 * would at the fake timer's current time; the same behaviours run against
 * real History across processes in `packages/core/test/concurrency`.
 *
 * @see ../../../docs/spec/operations.md (RUN-002 owner decision, RUN-014)
 * @see ../../../docs/spec/execution.md (PUB-002, PUB-005)
 * @see ../../../docs/plans/m5-operations.md (Writer lease; owner contracts)
 */
import { describe, expect, test } from '@jest/globals';
import type { IBindingDescriptor } from '@microdelta/definition';
import type {
  ICheckOutcome,
  IDiscoveryOutcome,
  IFoldRequest,
  IFoldResolution,
  IMembersRequest,
  IMembersResolution,
  IOutcomeFoldResolution,
  IRecoveryResult,
  IResolution,
  IResolutionOutcome,
  IResolveRequest,
} from '@microdelta/resolution';

import { SupervisionError, WriterBusyError, createStopController, createSupervision } from '../src/index.js';
import type { IAbortSignal, IPromotionRecord, IPromotionRequest, IRun, IRunEvent, IRunLease, IRunOptions, IRunPromotionPort, IRunResultReference, IRunWriter, ISupervision, IWriterAttempt } from '../src/index.js';
import { awaitWriter, writerWaitPolicy } from '../src/writer.js';
import { T0, codeOf, fakeTimer, hour, nodeScopes, settle, stepOf } from './support.js';
import type { IFakeTimer } from './support.js';

/** The step every request in this suite resolves. */
const step: IBindingDescriptor = stepOf('summary', 'person:ada');

/** The holder another process recorded. */
const otherHolder = 'microdelta-run:run:other';

/** A lease this run's writer port grants, with the fence History would issue. */
function leaseOf(fence: number, now: number): IRunLease {
  return Object.freeze({ holder: 'microdelta-run:run:test', fence, expiresAt: now + 30_000 });
}

/** A `held` answer naming the other holder until `expiresAt`. */
function heldUntil(expiresAt: number): IWriterAttempt {
  return Object.freeze({ kind: 'held', holder: otherHolder, expiresAt });
}

/** A writer port double: what it answered, when it was asked, and how often it was released. */
interface IScriptedWriter {
  readonly writer: IRunWriter;
  /** The fake time of every `tryLease` call, in order. */
  readonly attempts: number[];
  /** How many times the run released the writer. */
  readonly releases: { count: number };
}

/**
 * A writer port answering each `tryLease` with `answer(now)`. A `held` lease
 * stays held until its expiry and is then granted with the next fence, as
 * History's acquisition does; scripts pass a function to model releases,
 * contention or a failing port.
 */
function scriptedWriter(timer: IFakeTimer, answer: (now: number) => IWriterAttempt): IScriptedWriter {
  const attempts: number[] = [];
  const releases = { count: 0 };
  return {
    attempts,
    releases,
    writer: {
      tryLease(): IWriterAttempt {
        const now = timer.currentEpochMilliseconds();
        attempts.push(now);
        return answer(now);
      },
      release(): void {
        releases.count += 1;
      },
    },
  };
}

/** Held by the other holder until `expiresAt`, then granted to this run with fence 2. */
function heldThenExpires(expiresAt: number): (now: number) => IWriterAttempt {
  return (now) => (now < expiresAt ? heldUntil(expiresAt) : Object.freeze({ kind: 'acquired', lease: leaseOf(2, now) }));
}

/** The template step a fold consumes, as the doubles below report it. */
const foldOver: IBindingDescriptor = Object.freeze({ scope: 'analysis:test', role: 'step', slot: 'summary', template: 'contributor', collection: 'contributors' });

/** Discovery that keyed no members yet: enough for a members or fold request to settle without member work. */
const noMembers: IDiscoveryOutcome = Object.freeze({
  kind: 'keyed',
  collection: Object.freeze({ scope: 'analysis:test', role: 'step', slot: 'contributors' }),
  reference: Object.freeze({ kind: 'completed-result', locator: 'mdh1:test:collection' }),
  completion: 'open',
  keys: [],
});

/** A Resolution double that records the lease of every normal request and publishes. */
interface ILeaseRecorder {
  readonly factory: IRunOptions['resolution'];
  /** The lease every normal request (resolve, members, fold or outcome fold) received, in call order. */
  readonly leases: IRunLease[];
  /** How many check and recover requests reached Resolution. */
  readonly inspections: { count: number };
}

/** Create a lease-recording Resolution double. */
function leaseRecorder(): ILeaseRecorder {
  const leases: IRunLease[] = [];
  const inspections = { count: 0 };
  const resolution: IResolution = {
    resolve(request: IResolveRequest): Promise<IResolutionOutcome> {
      leases.push(request.lease);
      return Promise.resolve(Object.freeze({
        kind: 'published',
        step: request.step,
        reference: Object.freeze({ kind: 'completed-result', locator: `mdh1:test:${String(request.lease.fence)}` }),
        attemptId: request.lease.fence,
        misses: [],
        trace: [],
        diagnostics: [],
      }));
    },
    resolveMembers(request: IMembersRequest): Promise<IMembersResolution> {
      leases.push(request.lease);
      return Promise.resolve(Object.freeze({ template: request.template, discovery: noMembers, members: [], diagnostics: [] }));
    },
    resolveFold(request: IFoldRequest): Promise<IFoldResolution> {
      leases.push(request.lease);
      return Promise.resolve(Object.freeze({
        over: foldOver,
        discovery: noMembers,
        members: [],
        outcome: Object.freeze({ step: request.step, misses: [], trace: [], diagnostics: [], kind: 'waiting', pending: [], openDiscovery: true }),
        diagnostics: [],
      }));
    },
    resolveOutcomeFold(request: IFoldRequest): Promise<IOutcomeFoldResolution> {
      leases.push(request.lease);
      return Promise.resolve(Object.freeze({
        over: foldOver,
        discovery: noMembers,
        members: [],
        outcome: Object.freeze({
          step: request.step,
          misses: [],
          trace: [],
          diagnostics: [],
          kind: 'waiting',
          coverage: Object.freeze({ succeeded: [], skipped: [], failed: [], cancelled: [], pending: [], openDiscovery: true, complete: false as const }),
        }),
        diagnostics: [],
      }));
    },
    check(): Promise<ICheckOutcome> {
      inspections.count += 1;
      return Promise.resolve(Object.freeze({ kind: 'execution-required', step, misses: [] }));
    },
    recover(): IRecoveryResult {
      inspections.count += 1;
      return Object.freeze({ kind: 'absent' });
    },
  };
  return { factory: () => resolution, leases, inspections };
}

/** A Supervision over Node's real scope and the given fake timer. */
function supervisionWith(timer: IFakeTimer): ISupervision {
  return createSupervision({ context: nodeScopes, timer });
}

/** How a request settled, observed without letting a rejection go unhandled. */
interface ISettlement<T> {
  readonly settled: boolean;
  readonly value?: T;
  readonly error?: unknown;
}

/** Track a promise's settlement synchronously readable by the test. */
function track<T>(promise: Promise<T>): { readonly current: () => ISettlement<T> } {
  let settlement: ISettlement<T> = { settled: false };
  promise.then((value) => {
    settlement = { settled: true, value };
  }, (error: unknown) => {
    settlement = { settled: true, error };
  });
  return { current: () => settlement };
}

/** Advance the fake timer one step at a time, letting each wake-up's attempt run. */
async function advance(timer: IFakeTimer, milliseconds: number, step = milliseconds): Promise<void> {
  for (let elapsed = 0; elapsed < milliseconds; elapsed += step) {
    timer.advance(Math.min(step, milliseconds - elapsed));
    await settle();
  }
}

/**
 * Start one run whose body issues a single normal request and returns its
 * outcome, and hand the test that request's settlement plus the run itself.
 */
function startRequest(supervisor: ISupervision, options: IRunOptions): {
  readonly request: { readonly current: () => ISettlement<IResolutionOutcome> };
  readonly run: Promise<unknown>;
} {
  let request: { readonly current: () => ISettlement<IResolutionOutcome> } | undefined;
  const run = supervisor.run(options, (live: IRun) => {
    const pending = live.resolve(step, { requestKey: 'request:1' });
    request = track(pending);
    return pending.then(() => 'done', () => 'failed');
  });
  if (request === undefined) {
    throw new Error('the run body did not start synchronously');
  }
  return { request, run };
}

/** Run options over the doubles. */
function optionsOver(writer: IRunWriter, recorder: ILeaseRecorder, overrides: Partial<IRunOptions> = {}): IRunOptions {
  return { analysis: 'analysis:test', environment: 'env:test', resolution: recorder.factory, writer, ...overrides };
}

/** Narrow a settled failure to the typed writer-busy error. */
function busyOf(settlement: ISettlement<unknown>): WriterBusyError {
  expect(settlement.settled).toBe(true);
  expect(settlement.error).toBeInstanceOf(WriterBusyError);
  if (!(settlement.error instanceof WriterBusyError)) {
    throw new Error(`expected a WriterBusyError, got ${String(settlement.error)}`);
  }
  return settlement.error;
}

describe('waiting for the writer lease (RUN-002 owner decision)', () => {
  test('a free lease is taken at once, and nothing is scheduled', async () => {
    const timer = fakeTimer();
    const recorder = leaseRecorder();
    const port = scriptedWriter(timer, (now) => Object.freeze({ kind: 'acquired', lease: leaseOf(1, now) }));
    const { request, run } = startRequest(supervisionWith(timer), optionsOver(port.writer, recorder));
    await run;
    expect(request.current().value?.kind).toBe('published');
    expect(port.attempts).toEqual([T0]);
    expect(timer.scheduled).toEqual([]);
    expect(recorder.leases).toEqual([leaseOf(1, T0)]);
    expect(port.releases.count).toBe(1);
  });

  test('a held lease is polled at the operator poll interval, and the request runs with the lease once it is granted', async () => {
    const timer = fakeTimer();
    const recorder = leaseRecorder();
    // The other holder's lease runs far ahead, but it releases at T0 + 2 500.
    const port = scriptedWriter(timer, (now) => (now < T0 + 2_500 ? heldUntil(T0 + hour) : Object.freeze({ kind: 'acquired', lease: leaseOf(2, now) })));
    const { request, run } = startRequest(supervisionWith(timer), optionsOver(port.writer, recorder, { writerWait: { pollMilliseconds: 1_000 } }));
    await settle();
    expect(port.attempts).toEqual([T0]);
    expect(recorder.leases).toEqual([]);
    await advance(timer, 2_000, 1_000);
    expect(port.attempts).toEqual([T0, T0 + 1_000, T0 + 2_000]);
    expect(request.current().settled).toBe(false);
    // While it waits, the waiter asked Resolution for nothing.
    expect(recorder.leases).toEqual([]);
    await advance(timer, 1_000);
    await run;
    expect(port.attempts).toEqual([T0, T0 + 1_000, T0 + 2_000, T0 + 3_000]);
    expect(recorder.leases).toEqual([leaseOf(2, T0 + 3_000)]);
    expect(request.current().value?.kind).toBe('published');
    expect(port.releases.count).toBe(1);
  });

  test.each([
    ['resolve', (live: IRun): Promise<unknown> => live.resolve(step, { requestKey: 'request:1' })],
    ['resolveMembers', (live: IRun): Promise<unknown> => live.resolveMembers({ template: 'contributor', step: 'summary' }, { requestKey: 'request:1' })],
    ['resolveFold', (live: IRun): Promise<unknown> => live.resolveFold(stepOf('report'), { requestKey: 'request:1' })],
    ['resolveOutcomeFold', (live: IRun): Promise<unknown> => live.resolveOutcomeFold(stepOf('tally'), { requestKey: 'request:1' })],
  ] as const)('a %s request waits for a held lease at the poll interval and runs with the lease once it is granted', async (_operation, request) => {
    const timer = fakeTimer();
    const recorder = leaseRecorder();
    const port = scriptedWriter(timer, (now) => (now < T0 + 2_500 ? heldUntil(T0 + hour) : Object.freeze({ kind: 'acquired', lease: leaseOf(2, now) })));
    let pending: { readonly current: () => ISettlement<unknown> } | undefined;
    const run = supervisionWith(timer).run(optionsOver(port.writer, recorder, { writerWait: { pollMilliseconds: 1_000 } }), (live) => {
      const work = request(live);
      pending = track(work);
      return work.then(() => 'done', () => 'failed');
    });
    await advance(timer, 2_000, 1_000);
    expect(port.attempts).toEqual([T0, T0 + 1_000, T0 + 2_000]);
    expect(pending?.current().settled).toBe(false);
    expect(recorder.leases).toEqual([]);
    await advance(timer, 1_000);
    expect(await run).toMatchObject({ value: 'done' });
    expect(port.attempts).toEqual([T0, T0 + 1_000, T0 + 2_000, T0 + 3_000]);
    expect(recorder.leases).toEqual([leaseOf(2, T0 + 3_000)]);
    expect(port.releases.count).toBe(1);
  });

  test('the waiter wakes at the holder\'s expiry instead of waiting out a full interval, and takes over then', async () => {
    const timer = fakeTimer();
    const recorder = leaseRecorder();
    const port = scriptedWriter(timer, heldThenExpires(T0 + 1_500));
    const { request, run } = startRequest(supervisionWith(timer), optionsOver(port.writer, recorder, { writerWait: { pollMilliseconds: 1_000 } }));
    await advance(timer, 1_500, 250);
    await run;
    expect(port.attempts).toEqual([T0, T0 + 1_000, T0 + 1_500]);
    expect(recorder.leases).toEqual([leaseOf(2, T0 + 1_500)]);
    expect(request.current().value?.kind).toBe('published');
  });

  test('the default poll interval is one second', async () => {
    const timer = fakeTimer();
    const port = scriptedWriter(timer, () => heldUntil(T0 + hour));
    const { request } = startRequest(supervisionWith(timer), optionsOver(port.writer, leaseRecorder()));
    await advance(timer, 3_000, 100);
    expect(port.attempts).toEqual([T0, T0 + 1_000, T0 + 2_000, T0 + 3_000]);
    expect(request.current().settled).toBe(false);
  });

  test('there is no default deadline: without one the request keeps waiting, then proceeds when the lease frees', async () => {
    const timer = fakeTimer();
    const recorder = leaseRecorder();
    const port = scriptedWriter(timer, heldThenExpires(T0 + 2 * hour));
    const { request, run } = startRequest(supervisionWith(timer), optionsOver(port.writer, recorder, { writerWait: { pollMilliseconds: 60_000 } }));
    await advance(timer, hour, 60_000);
    expect(request.current().settled).toBe(false);
    expect(port.attempts).toHaveLength(61);
    await advance(timer, hour, 60_000);
    await run;
    expect(port.attempts).toHaveLength(121);
    expect(recorder.leases).toEqual([leaseOf(2, T0 + 2 * hour)]);
  });

  test('a waiter never busy-spins when the held lease reports an expiry its own clock has already passed', async () => {
    // History evaluates time against its persisted high-water, so a waiter's
    // timer may read past an expiry History still treats as live.
    const timer = fakeTimer();
    const port = scriptedWriter(timer, (now) => heldUntil(now - 5));
    const { request } = startRequest(supervisionWith(timer), optionsOver(port.writer, leaseRecorder(), { writerWait: { pollMilliseconds: 200 } }));
    await advance(timer, 1_000, 50);
    expect(port.attempts).toEqual([T0, T0 + 200, T0 + 400, T0 + 600, T0 + 800, T0 + 1_000]);
    expect(request.current().settled).toBe(false);
    for (const entry of timer.scheduled) {
      expect(entry.keepAlive).toBe(true);
    }
  });
});

describe('the operator deadline and writer-busy (RUN-002 owner decision)', () => {
  test('at the deadline the request fails with a typed writer-busy error naming the holder, and nothing more is scheduled', async () => {
    const timer = fakeTimer();
    const recorder = leaseRecorder();
    const port = scriptedWriter(timer, () => heldUntil(T0 + hour));
    const deadline = T0 + 2_500;
    const { request, run } = startRequest(supervisionWith(timer), optionsOver(port.writer, recorder, { writerWait: { deadline, pollMilliseconds: 1_000 } }));
    await advance(timer, 2_500, 500);
    await run;
    // The last attempt is at the deadline itself: a lease freed by then would still be taken.
    expect(port.attempts).toEqual([T0, T0 + 1_000, T0 + 2_000, T0 + 2_500]);
    const busy = busyOf(request.current());
    expect(busy).toBeInstanceOf(SupervisionError);
    expect(busy.code).toBe('writer-busy');
    expect(busy.holder).toBe(otherHolder);
    expect(busy.expiresAt).toBe(T0 + hour);
    expect(busy.deadline).toBe(deadline);
    expect(busy.contended).toBe(false);
    expect(busy.message).toContain(otherHolder);
    expect(recorder.leases).toEqual([]);
    expect(timer.scheduled.every((entry) => entry.fired || entry.cancelled)).toBe(true);
    await advance(timer, 5_000, 1_000);
    expect(port.attempts).toHaveLength(4);
    expect(port.releases.count).toBe(1);
  });

  test('a deadline that has already passed makes exactly one attempt and schedules nothing', async () => {
    const timer = fakeTimer();
    const port = scriptedWriter(timer, () => heldUntil(T0 + 100));
    const { request, run } = startRequest(supervisionWith(timer), optionsOver(port.writer, leaseRecorder(), { writerWait: { deadline: T0 - 1 } }));
    await run;
    expect(port.attempts).toEqual([T0]);
    expect(busyOf(request.current()).holder).toBe(otherHolder);
    expect(timer.scheduled).toEqual([]);
  });

  test('a deadline that is exactly now still makes its one attempt, which takes a free lease', async () => {
    const timer = fakeTimer();
    const recorder = leaseRecorder();
    const port = scriptedWriter(timer, (now) => Object.freeze({ kind: 'acquired', lease: leaseOf(4, now) }));
    const { request, run } = startRequest(supervisionWith(timer), optionsOver(port.writer, recorder, { writerWait: { deadline: T0 } }));
    await run;
    expect(request.current().value?.kind).toBe('published');
    expect(recorder.leases).toEqual([leaseOf(4, T0)]);
  });

  test('a lease that expires exactly at the deadline is taken over at the deadline, not reported busy', async () => {
    const timer = fakeTimer();
    const recorder = leaseRecorder();
    const port = scriptedWriter(timer, heldThenExpires(T0 + 1_500));
    const { request, run } = startRequest(supervisionWith(timer), optionsOver(port.writer, recorder, { writerWait: { deadline: T0 + 1_500, pollMilliseconds: 1_000 } }));
    await advance(timer, 1_500, 500);
    await run;
    expect(port.attempts).toEqual([T0, T0 + 1_000, T0 + 1_500]);
    expect(request.current().value?.kind).toBe('published');
    expect(recorder.leases).toEqual([leaseOf(2, T0 + 1_500)]);
  });

  test('a lease that expires one millisecond after the deadline is reported busy at the deadline, naming its holder and expiry', async () => {
    const timer = fakeTimer();
    const port = scriptedWriter(timer, heldThenExpires(T0 + 1_501));
    const { request, run } = startRequest(supervisionWith(timer), optionsOver(port.writer, leaseRecorder(), { writerWait: { deadline: T0 + 1_500, pollMilliseconds: 1_000 } }));
    await advance(timer, 1_501, 1);
    await run;
    expect(port.attempts).toEqual([T0, T0 + 1_000, T0 + 1_500]);
    const busy = busyOf(request.current());
    expect([busy.holder, busy.expiresAt, busy.deadline]).toEqual([otherHolder, T0 + 1_501, T0 + 1_500]);
  });

  test('storage contention is retried like a held lease and ends at the deadline as typed writer-busy naming the recorded holder', async () => {
    const timer = fakeTimer();
    const detail = 'SQLite store stayed busy for 500 ms: database is locked';
    const port = scriptedWriter(timer, () => Object.freeze({ kind: 'contended', holder: otherHolder, expiresAt: T0 + 400, detail, heldByThisRun: false }));
    const { request, run } = startRequest(supervisionWith(timer), optionsOver(port.writer, leaseRecorder(), { writerWait: { deadline: T0 + 1_000, pollMilliseconds: 500 } }));
    await advance(timer, 1_000, 500);
    await run;
    expect(port.attempts).toEqual([T0, T0 + 500, T0 + 1_000]);
    const busy = busyOf(request.current());
    expect(busy.code).toBe('writer-busy');
    expect(busy.contended).toBe(true);
    expect(busy.holder).toBe(otherHolder);
    expect(busy.message).toContain(detail);
  });

  test('contention with no readable holder reports contention without inventing a holder', async () => {
    const timer = fakeTimer();
    const port = scriptedWriter(timer, () => Object.freeze({ kind: 'contended', holder: undefined, expiresAt: undefined, detail: 'busy', heldByThisRun: false }));
    const { request, run } = startRequest(supervisionWith(timer), optionsOver(port.writer, leaseRecorder(), { writerWait: { deadline: T0 } }));
    await run;
    const busy = busyOf(request.current());
    expect([busy.contended, busy.holder, busy.expiresAt]).toEqual([true, undefined, undefined]);
  });

  test('a contended attempt followed by a held one reports the held holder at the deadline', async () => {
    const timer = fakeTimer();
    const port = scriptedWriter(timer, (now) => (now < T0 + 500 ? Object.freeze({ kind: 'contended', holder: undefined, expiresAt: undefined, detail: 'busy', heldByThisRun: false }) : heldUntil(T0 + hour)));
    const { request, run } = startRequest(supervisionWith(timer), optionsOver(port.writer, leaseRecorder(), { writerWait: { deadline: T0 + 500, pollMilliseconds: 500 } }));
    await advance(timer, 500);
    await run;
    const busy = busyOf(request.current());
    expect([busy.contended, busy.holder]).toEqual([false, otherHolder]);
  });
});

describe('writer-busy when the run itself is the recorded holder', () => {
  test('a busy renewal of the run\'s own lease at the deadline says the run is the recorded holder, contended', async () => {
    const timer = fakeTimer();
    const own = 'microdelta-run:run:test';
    const port = scriptedWriter(timer, () => Object.freeze({ kind: 'contended', holder: own, expiresAt: T0 + 400, detail: 'SQLite store stayed busy for 500 ms', heldByThisRun: true }));
    const { request, run } = startRequest(supervisionWith(timer), optionsOver(port.writer, leaseRecorder(), { writerWait: { deadline: T0 } }));
    await run;
    const busy = busyOf(request.current());
    expect([busy.contended, busy.heldByThisRun, busy.holder]).toEqual([true, true, own]);
    expect(busy.message).toContain('this run is the recorded holder');
    expect(busy.message).toContain('contended');
  });

  test('another process\'s lease is never described as the run\'s own', async () => {
    const timer = fakeTimer();
    const port = scriptedWriter(timer, () => heldUntil(T0 + hour));
    const { request, run } = startRequest(supervisionWith(timer), optionsOver(port.writer, leaseRecorder(), { writerWait: { deadline: T0 } }));
    await run;
    const busy = busyOf(request.current());
    expect(busy.heldByThisRun).toBe(false);
    expect(busy.message).not.toContain('this run is the recorded holder');
  });
});

/** A stop signal double that counts the abort listeners currently registered and the most ever registered at once. */
function countingStop(): { readonly signal: IAbortSignal; active(): number; peak(): number; abort(): void } {
  let aborted = false;
  let peak = 0;
  const listeners = new Set<{ readonly listener: () => void }>();
  return {
    signal: {
      get aborted(): boolean {
        return aborted;
      },
      onAbort(listener: () => void): () => void {
        if (aborted) {
          listener();
          return () => undefined;
        }
        const entry = { listener };
        listeners.add(entry);
        peak = Math.max(peak, listeners.size);
        return () => {
          listeners.delete(entry);
        };
      },
    },
    active: () => listeners.size,
    peak: () => peak,
    abort(): void {
      aborted = true;
      for (const entry of [...listeners]) {
        listeners.delete(entry);
        entry.listener();
      }
    },
  };
}

describe('a wait retains no abort listener or wake-up once it settles', () => {
  test('each sleep registers one listener and removes it on waking; a granted wait leaves none', async () => {
    const timer = fakeTimer();
    const stop = countingStop();
    const port = scriptedWriter(timer, heldThenExpires(T0 + 3_000));
    const pending = track(awaitWriter({ writer: port.writer, policy: writerWaitPolicy({ pollMilliseconds: 1_000 }), timer, stop: stop.signal, runId: 'run:test' }));
    await settle();
    expect(stop.active()).toBe(1);
    await advance(timer, 2_000, 1_000);
    expect(stop.active()).toBe(1);
    await advance(timer, 1_000);
    expect(pending.current().value).toEqual(leaseOf(2, T0 + 3_000));
    expect([stop.active(), stop.peak()]).toEqual([0, 1]);
    expect(timer.scheduled.every((entry) => entry.fired || entry.cancelled)).toBe(true);
  });

  test('a stop during a sleep removes the listener and cancels the wake-up', async () => {
    const timer = fakeTimer();
    const stop = countingStop();
    const port = scriptedWriter(timer, () => heldUntil(T0 + hour));
    const pending = track(awaitWriter({ writer: port.writer, policy: writerWaitPolicy(undefined), timer, stop: stop.signal, runId: 'run:test' }));
    await settle();
    stop.abort();
    await settle();
    expect(await codeOf(Promise.reject(pending.current().error))).toBe('stopped');
    expect(stop.active()).toBe(0);
    expect(timer.scheduled.map((entry) => entry.cancelled)).toEqual([true]);
  });

  test('a deadline reached after sleeps leaves no listener behind', async () => {
    const timer = fakeTimer();
    const stop = countingStop();
    const port = scriptedWriter(timer, () => heldUntil(T0 + hour));
    const pending = track(awaitWriter({ writer: port.writer, policy: writerWaitPolicy({ deadline: T0 + 2_000 }), timer, stop: stop.signal, runId: 'run:test' }));
    await advance(timer, 2_000, 1_000);
    expect(pending.current().error).toBeInstanceOf(WriterBusyError);
    expect(stop.active()).toBe(0);
  });
});

describe('stops, failures and lease-free requests while waiting', () => {
  test.each(['soft', 'hard'] as const)('a %s stop ends the wait at once with stopped, and the waiter schedules and attempts nothing more', async (level) => {
    const timer = fakeTimer();
    const stop = createStopController({ timer });
    const recorder = leaseRecorder();
    const port = scriptedWriter(timer, () => heldUntil(T0 + hour));
    const { request, run } = startRequest(supervisionWith(timer), optionsOver(port.writer, recorder, { stop }));
    await advance(timer, 1_500, 500);
    expect(port.attempts).toEqual([T0, T0 + 1_000]);
    stop.request({ level });
    await settle();
    await run;
    const settlement = request.current();
    expect(await codeOf(Promise.reject(settlement.error))).toBe('stopped');
    expect(timer.scheduled.every((entry) => entry.fired || entry.cancelled)).toBe(true);
    await advance(timer, 5_000, 1_000);
    expect(port.attempts).toEqual([T0, T0 + 1_000]);
    expect(recorder.leases).toEqual([]);
    expect(port.releases.count).toBe(1);
  });

  test('a stop already in force does not keep a request from a free lease', async () => {
    const timer = fakeTimer();
    const stop = createStopController({ timer });
    stop.request({ level: 'soft' });
    const recorder = leaseRecorder();
    const port = scriptedWriter(timer, (now) => Object.freeze({ kind: 'acquired', lease: leaseOf(1, now) }));
    const { request, run } = startRequest(supervisionWith(timer), optionsOver(port.writer, recorder, { stop }));
    await run;
    expect(request.current().value?.kind).toBe('published');
  });

  test('a stop already in force ends a request whose lease is held after its one attempt', async () => {
    const timer = fakeTimer();
    const stop = createStopController({ timer });
    stop.request({ level: 'soft' });
    const port = scriptedWriter(timer, () => heldUntil(T0 + hour));
    const { request, run } = startRequest(supervisionWith(timer), optionsOver(port.writer, leaseRecorder(), { stop, writerWait: { deadline: T0 + hour } }));
    await run;
    expect(port.attempts).toEqual([T0]);
    expect(await codeOf(Promise.reject(request.current().error))).toBe('stopped');
    expect(timer.scheduled).toEqual([]);
  });

  test('concurrent normal requests of one run share one wait and receive the same lease', async () => {
    const timer = fakeTimer();
    const recorder = leaseRecorder();
    const port = scriptedWriter(timer, heldThenExpires(T0 + 2_000));
    const outcomes = supervisionWith(timer).run(optionsOver(port.writer, recorder), (live) => Promise.all([
      live.resolve(step, { requestKey: 'request:a' }),
      live.resolve(step, { requestKey: 'request:b' }),
      live.resolve(step, { requestKey: 'request:c' }),
    ]));
    await advance(timer, 2_000, 500);
    const result = await outcomes;
    expect(result.value.map((outcome) => outcome.kind)).toEqual(['published', 'published', 'published']);
    expect(port.attempts).toEqual([T0, T0 + 1_000, T0 + 2_000]);
    expect(recorder.leases).toEqual([leaseOf(2, T0 + 2_000), leaseOf(2, T0 + 2_000), leaseOf(2, T0 + 2_000)]);
  });

  test('a writer port that fails fails that request with its own error and never waits', async () => {
    const timer = fakeTimer();
    const failure = new Error('History integrity failure');
    const port = scriptedWriter(timer, () => {
      throw failure;
    });
    const { request, run } = startRequest(supervisionWith(timer), optionsOver(port.writer, leaseRecorder()));
    await run;
    expect(request.current().error).toBe(failure);
    expect(timer.scheduled).toEqual([]);
  });

  test('check-only and recovery requests never ask for, or wait for, the writer lease', async () => {
    const timer = fakeTimer();
    const recorder = leaseRecorder();
    const port = scriptedWriter(timer, () => heldUntil(T0 + hour));
    await supervisionWith(timer).run(optionsOver(port.writer, recorder), async (live) => {
      await expect(live.check(step)).resolves.toMatchObject({ kind: 'execution-required' });
      await expect(live.recover(step, { requestKey: 'request:1' })).resolves.toEqual({ kind: 'absent' });
    });
    expect(port.attempts).toEqual([]);
    expect(recorder.inspections.count).toBe(2);
    expect(timer.scheduled).toEqual([]);
  });

  test('a run stays open while a request waits for the writer and releases it once after closing', async () => {
    const timer = fakeTimer();
    const port = scriptedWriter(timer, heldThenExpires(T0 + 1_000));
    let open: (() => boolean) | undefined;
    const outcome = supervisionWith(timer).run(optionsOver(port.writer, leaseRecorder()), (live) => {
      open = () => live.open;
      void live.resolve(step, { requestKey: 'request:1' });
      return 'body returned';
    });
    await settle();
    expect(open?.()).toBe(true);
    expect(port.releases.count).toBe(0);
    await advance(timer, 1_000);
    const result = await outcome;
    expect(result.value).toBe('body returned');
    expect(open?.()).toBe(false);
    expect(port.releases.count).toBe(1);
  });

  test('waiting for a held lease without a timer is an invalid request rather than a silent failure', async () => {
    const timer = fakeTimer();
    const port = scriptedWriter(timer, () => heldUntil(T0 + hour));
    const supervisor = createSupervision({ context: nodeScopes });
    const { request, run } = startRequest(supervisor, optionsOver(port.writer, leaseRecorder()));
    await run;
    expect(await codeOf(Promise.reject(request.current().error))).toBe('invalid-request');
  });

  test.each([
    ['a negative deadline', { deadline: -1 }],
    ['a fractional deadline', { deadline: T0 + 0.5 }],
    ['a zero poll interval', { pollMilliseconds: 0 }],
    ['a negative poll interval', { pollMilliseconds: -5 }],
    ['a fractional poll interval', { pollMilliseconds: 1.5 }],
  ])('%s is refused as an invalid request when the run starts', async (_name, writerWait) => {
    const timer = fakeTimer();
    const port = scriptedWriter(timer, () => heldUntil(T0 + hour));
    expect(await codeOf(() => supervisionWith(timer).run(optionsOver(port.writer, leaseRecorder(), { writerWait }), () => 'never'))).toBe('invalid-request');
    expect(port.attempts).toEqual([]);
  });
});

/**
 * A recorded promotion between environments (RUN-017 owner decision), as a
 * named run operation over Supervision's structural promotion port. The
 * promotion is operator work recorded by History under the writer lease, so
 * the run obtains that lease exactly as a normal request does (RUN-002 owner
 * decision), checks stop intent immediately before the commit, commits once
 * through the port, and offers an identifier-only event. Reading the
 * promotions into the run's own environment needs no lease. The port double
 * records exactly what Supervision asks of History.
 */
describe('recorded promotion (RUN-002, RUN-013, RUN-017)', () => {
  /** A reference as History names one. */
  const reference = (locator: string): IRunResultReference => Object.freeze({ kind: 'completed-result', locator });

  /** A promotion port double: every commit and read Supervision asked for. */
  interface IPromotionDouble {
    readonly port: IRunPromotionPort;
    readonly commits: { readonly lease: IRunLease; readonly request: Parameters<IRunPromotionPort['promoteResults']>[1] }[];
    readonly reads: Parameters<IRunPromotionPort['readPromotions']>[0][];
  }

  /** Create a promotion port double whose records carry the committing lease's fence. */
  function promotionDouble(): IPromotionDouble {
    const commits: IPromotionDouble['commits'] = [];
    const reads: IPromotionDouble['reads'] = [];
    const records: IPromotionRecord[] = [];
    return {
      commits,
      reads,
      port: {
        promoteResults(lease, request): IPromotionRecord {
          commits.push({ lease, request });
          const record: IPromotionRecord = Object.freeze({ promotionId: commits.length, target: request.target, references: request.references, evidence: request.evidence, fence: lease.fence });
          records.push(record);
          return record;
        },
        readPromotions(query): readonly IPromotionRecord[] {
          reads.push(query);
          return records.filter((record) => record.target.analysis === query.target.analysis && record.target.environment === query.target.environment);
        },
      },
    };
  }

  /** One promotion request into production. */
  const request: IPromotionRequest = Object.freeze({
    into: 'env:production',
    references: [reference('mdh1:test:report')],
    evidence: Object.freeze({ format: 'test.promotion', formatVersion: 1, content: { reason: 'trial reviewed' } }),
  });

  test('a promotion obtains the lease a normal request would hold, commits once into the requested environment of the run\'s analysis, and offers an identifier-only event', async () => {
    const timer = fakeTimer();
    const port = scriptedWriter(timer, (now) => Object.freeze({ kind: 'acquired', lease: leaseOf(1, now) }));
    const promotion = promotionDouble();
    const events: IRunEvent[] = [];
    const result = await supervisionWith(timer).run(optionsOver(port.writer, leaseRecorder(), { promotion: promotion.port, observers: [{ observe: (event) => events.push(event) }] }), (live) => live.promote(request));
    expect(promotion.commits).toEqual([{ lease: leaseOf(1, T0), request: { target: { analysis: 'analysis:test', environment: 'env:production' }, references: request.references, evidence: request.evidence } }]);
    expect(result.value).toEqual({ promotionId: 1, target: { analysis: 'analysis:test', environment: 'env:production' }, references: request.references, evidence: request.evidence, fence: 1 });
    expect(port.attempts).toEqual([T0]);
    expect(port.releases.count).toBe(1);
    // The event names the promotion, its target and the exact references; never the evidence.
    expect(events).toEqual([{ kind: 'promotion', runId: result.context.runId, promotionId: 1, analysis: 'analysis:test', into: 'env:production', references: request.references }]);
  });

  test('while another process holds the lease the promotion waits at the poll interval, and commits only once the lease is granted', async () => {
    const timer = fakeTimer();
    const port = scriptedWriter(timer, (now) => (now < T0 + 2_500 ? heldUntil(T0 + hour) : Object.freeze({ kind: 'acquired', lease: leaseOf(2, now) })));
    const promotion = promotionDouble();
    const run = supervisionWith(timer).run(optionsOver(port.writer, leaseRecorder(), { promotion: promotion.port, writerWait: { pollMilliseconds: 1_000 } }), (live) => live.promote(request));
    await advance(timer, 2_000, 1_000);
    expect(port.attempts).toEqual([T0, T0 + 1_000, T0 + 2_000]);
    expect(promotion.commits).toEqual([]);
    await advance(timer, 1_000);
    expect((await run).value.fence).toBe(2);
    expect(promotion.commits.map((commit) => commit.lease)).toEqual([leaseOf(2, T0 + 3_000)]);
  });

  test('at the operator deadline the promotion fails with writer-busy naming the holder, and nothing is committed', async () => {
    const timer = fakeTimer();
    const port = scriptedWriter(timer, () => heldUntil(T0 + hour));
    const promotion = promotionDouble();
    let outcome: { readonly current: () => ISettlement<unknown> } | undefined;
    const run = supervisionWith(timer).run(optionsOver(port.writer, leaseRecorder(), { promotion: promotion.port, writerWait: { deadline: T0 + 1_000, pollMilliseconds: 500 } }), (live) => {
      const pending = live.promote(request);
      outcome = track(pending);
      return pending.then(() => 'done', () => 'failed');
    });
    await advance(timer, 1_000, 500);
    expect((await run).value).toBe('failed');
    expect(busyOf(outcome?.current() ?? { settled: false }).holder).toBe(otherHolder);
    expect(promotion.commits).toEqual([]);
  });

  test('a stop that takes effect while the promotion waits for the lease ends it with stopped, and nothing is committed', async () => {
    const timer = fakeTimer();
    const port = scriptedWriter(timer, () => heldUntil(T0 + hour));
    const promotion = promotionDouble();
    const stop = createStopController({ timer });
    const run = supervisionWith(timer).run(optionsOver(port.writer, leaseRecorder(), { promotion: promotion.port, stop, writerWait: { pollMilliseconds: 1_000 } }), (live) => codeOf(live.promote(request)));
    await advance(timer, 1_000);
    stop.request({ level: 'soft' });
    expect((await run).value).toBe('stopped');
    expect(promotion.commits).toEqual([]);
  });

  test('stop intent in force when the lease is granted refuses the commit: the stop is checked immediately before it', async () => {
    const timer = fakeTimer();
    const port = scriptedWriter(timer, (now) => Object.freeze({ kind: 'acquired', lease: leaseOf(1, now) }));
    const promotion = promotionDouble();
    const stop = createStopController({ timer });
    stop.request({ level: 'soft' });
    const result = await supervisionWith(timer).run(optionsOver(port.writer, leaseRecorder(), { promotion: promotion.port, stop }), (live) => codeOf(live.promote(request)));
    expect(result.value).toBe('stopped');
    expect(promotion.commits).toEqual([]);
  });

  test('the promotions into the run\'s own environment are read without the writer lease', async () => {
    const timer = fakeTimer();
    const port = scriptedWriter(timer, (now) => Object.freeze({ kind: 'acquired', lease: leaseOf(1, now) }));
    const promotion = promotionDouble();
    const result = await supervisionWith(timer).run(optionsOver(port.writer, leaseRecorder(), { promotion: promotion.port, environment: 'env:production' }), (live) => live.promotions());
    expect(result.value).toEqual([]);
    expect(promotion.reads).toEqual([{ target: { analysis: 'analysis:test', environment: 'env:production' } }]);
    expect(port.attempts).toEqual([]);
  });

  test('without a promotion port, promoting and reading promotions are invalid requests that take no lease', async () => {
    const timer = fakeTimer();
    const port = scriptedWriter(timer, (now) => Object.freeze({ kind: 'acquired', lease: leaseOf(1, now) }));
    const result = await supervisionWith(timer).run(optionsOver(port.writer, leaseRecorder()), async (live) => [await codeOf(live.promote(request)), await codeOf(live.promotions())]);
    expect(result.value).toEqual(['invalid-request', 'invalid-request']);
    expect(port.attempts).toEqual([]);
  });

  test.each([
    ['an empty target environment', { ...request, into: '' }],
    ['references that are not a list', { ...request, references: 'mdh1:test:report' }],
    ['missing evidence', { into: request.into, references: request.references }],
  ])('%s is an invalid request, refused before any lease is taken', async (_name, malformed) => {
    const timer = fakeTimer();
    const port = scriptedWriter(timer, (now) => Object.freeze({ kind: 'acquired', lease: leaseOf(1, now) }));
    const promotion = promotionDouble();
    const result = await supervisionWith(timer).run(optionsOver(port.writer, leaseRecorder(), { promotion: promotion.port }), (live) => codeOf(async () => {
      // An untyped caller's malformed request, as JavaScript could pass it.
      const pending: unknown = Reflect.apply(live.promote, live, [malformed]);
      await pending;
    }));
    expect(result.value).toBe('invalid-request');
    expect(port.attempts).toEqual([]);
    expect(promotion.commits).toEqual([]);
  });

  test('a promotion offered after the run closed fails with run-closed and takes no lease', async () => {
    const timer = fakeTimer();
    const port = scriptedWriter(timer, (now) => Object.freeze({ kind: 'acquired', lease: leaseOf(1, now) }));
    const promotion = promotionDouble();
    let kept: IRun | undefined;
    await supervisionWith(timer).run(optionsOver(port.writer, leaseRecorder(), { promotion: promotion.port }), (live) => {
      kept = live;
    });
    expect(await codeOf(kept?.promote(request) ?? Promise.resolve())).toBe('run-closed');
    expect(port.attempts).toEqual([]);
    expect(promotion.commits).toEqual([]);
  });
});
