/**
 * Real concurrent contention for History's single fenced writer (M5 exit,
 * PUB-002, PUB-005). Several Node processes hold open History handles on one
 * SQLite file. A host-clock barrier releases their operations together, and
 * each worker reports when its operation ran, so the suite asserts that some
 * operations really overlapped inside History rather than assuming it; SQLite's
 * IMMEDIATE transactions then serialize them. Assertions hold for every
 * schedule: at most one process holds authority at a time, each loser
 * receives History's typed refusal (`held` naming the holder, or
 * `StaleWriterError`), and storage receives writes in non-decreasing fence
 * order, which is the fencing property
 * `StorageSeesNonDecreasingFences` of `experiments/exp-7/WriterLease.tla`.
 *
 * C1 and C2 drive History directly, where the refusal of an acquisition is
 * the `held` outcome. C3 drives real waiters: Run Supervision's wait for the
 * lease over the facade's writer port, on Node's real timer, with an operator
 * deadline, so every wait must end granted or as the typed writer-busy error.
 * Whether a free-running waiter is granted only after waiting depends on host
 * speed (issue #140), so C3 first forces that interleaving and a deadline
 * outcome with process coordination, then lets the four processes contend
 * freely.
 *
 * @see ../../../../docs/spec/execution.md (PUB-002, PUB-004, PUB-005)
 * @see ../../../../experiments/exp-7/WriterLease.tla
 * @see ../../../../docs/validation/m5-concurrency-2026-09-30.md
 */
import { afterEach, describe, expect, test } from '@jest/globals';

import type { IWriterLease } from '@microdelta/history';

import { cleanup } from '../durable-history/support.js';
import { expectRefused, freshStore, heldFrom, leaseFrom, locatorFrom, measureConcurrency, reopenForReading, snapshot, startWorker, stopWorkers } from './driver.js';
import type { IConcurrencyMeasure, IDurableState, IWorkerHandle } from './driver.js';
import { attemptRequest, concurrencyStore, subject } from './fixture.js';
import { hostMonotonicMilliseconds, parseContentionLog, parseWaitContention, parseWaitStatus } from './protocol.js';
import type { IContentionEvent, IHarnessCommand, IHarnessReply, IWaitContentionEvent, IWaitStatus } from './protocol.js';

afterEach(async () => {
  await stopWorkers();
  cleanup();
});

/** An instant shortly ahead on the host monotonic clock, at which every worker starts the next command together. */
function barrier(): number {
  return hostMonotonicMilliseconds() + 40;
}

/** Release one command to every worker at a shared barrier instant and collect the replies in worker order. */
async function together(workers: readonly IWorkerHandle[], command: (target: IWorkerHandle) => IHarnessCommand): Promise<readonly IHarnessReply[]> {
  const notBefore = barrier();
  return Promise.all(workers.map((target) => target.step({ ...command(target), notBefore })));
}

/** The value of a successful reply, or a failure naming the worker. */
function valueOf(target: IWorkerHandle, reply: IHarnessReply | undefined): unknown {
  if (reply === undefined || !reply.ok) {
    throw new Error(`${target.name} failed: ${JSON.stringify(reply)}`);
  }
  return reply.value;
}

/** Assert that writes reached storage in non-decreasing fence order. */
function expectFenceOrderedStorage(state: IDurableState): void {
  const allocated = state.attempts.map((attempt) => attempt.allocatedFence);
  expect(allocated).toEqual([...allocated].sort((left, right) => left - right));
  const published = state.results.map((result) => result.publishedFence);
  expect(published).toEqual([...published].sort((left, right) => left - right));
}

describe('barrier-aligned contention with a controlled clock (C1)', () => {
  test('in every round exactly one of four barrier-aligned acquirers wins the next fence, every other one is told who holds it, and every stale lease is refused', async () => {
    const location = freshStore();
    const workers = await Promise.all(['W0', 'W1', 'W2', 'W3'].map((name) => startWorker(name, { location, store: concurrencyStore, clock: 'controlled' })));
    const leases = new Map<string, IWriterLease>();
    // The staged attempt each worker left behind in the last round it won.
    const pending = new Map<string, string>();
    const rounds = 10;
    const leaseMilliseconds = 400;
    // Per round, how the four barrier-aligned acquisitions related in host time.
    const measures: IConcurrencyMeasure[] = [];
    for (let round = 1; round <= rounds; round += 1) {
      // Every previous lease has expired by this round's reading.
      const at = round * 1_000;
      const acquisitions = await together(workers, (target) => ({ op: 'acquire', at, holder: `contender-${target.name}`, leaseMilliseconds }));
      measures.push(measureConcurrency(acquisitions));
      const outcomes = workers.map((target, index) => ({ target, value: valueOf(target, acquisitions[index]) }));
      const winners = outcomes.filter(({ value }) => typeof value === 'object' && value !== null && Reflect.get(value, 'kind') === 'acquired');
      expect(winners).toHaveLength(1);
      const winner = winners[0];
      if (winner === undefined) {
        throw new Error('no winner');
      }
      const granted = leaseFrom(winner.value);
      // Grants are strictly increasing: one fence per round, starting at 1.
      expect(granted).toEqual({ holder: `contender-${winner.target.name}`, fence: round, expiresAt: at + leaseMilliseconds });
      for (const loser of outcomes.filter((outcome) => outcome !== winner)) {
        expect(heldFrom(loser.value)).toEqual({ holder: granted.holder, expiresAt: granted.expiresAt });
      }
      leases.set(winner.target.name, granted);

      // Every process holding any lease object mutates at the next barrier; only the winner may.
      const holders = workers.filter((target) => leases.has(target.name));
      const attempts = await together(holders, (target) => target === winner.target
        ? { op: 'allocate', at: at + 1, key: `round-${String(round)}` }
        : { op: 'publish', at: at + 1, key: pending.get(target.name) ?? 'none' });
      holders.forEach((target, index) => {
        const reply = attempts[index];
        if (target === winner.target) {
          valueOf(target, reply);
        } else {
          expect(reply).toBeDefined();
          if (reply !== undefined) {
            expectRefused(reply, 'StaleWriterError');
          }
        }
      });
      valueOf(winner.target, await winner.target.step({ op: 'stage', at: at + 2, key: `round-${String(round)}`, label: `round-${String(round)}` }));
      locatorFrom(valueOf(winner.target, await winner.target.step({ op: 'publish', at: at + 3, key: `round-${String(round)}` })));
      // The winner leaves one staged attempt behind for later stale publication attempts.
      const left = `pending-${String(round)}`;
      valueOf(winner.target, await winner.target.step({ op: 'allocate', at: at + 4, key: left }));
      valueOf(winner.target, await winner.target.step({ op: 'stage', at: at + 5, key: left, label: left }));
      pending.set(winner.target.name, left);
    }
    await Promise.all(workers.map((target) => target.close()));
    // The acquisitions really ran at once: in at least one round two of them
    // were inside History at the same time, which the serialized SQLite writer
    // then ordered.
    expect(measures.some((measure) => measure.overlap > 0)).toBe(true);

    const state = snapshot(location);
    expectFenceOrderedStorage(state);
    expect(state.results.map((result) => result.publishedFence)).toEqual(Array.from({ length: rounds }, (_, index) => index + 1));
    const history = reopenForReading(location, rounds * 1_000 + 500);
    expect(history.findCandidates({ ...subject, version: 1 })).toHaveLength(rounds);
    // Every stale publication attempt left its staged attempt unpublished.
    const left = state.attempts.filter((row) => row.key.startsWith('pending-'));
    expect(left).toHaveLength(rounds);
    for (const attempt of left) {
      expect(attempt.state).toBe('staged');
      expect(history.recoverAttempt(attemptRequest(attempt.key))).toMatchObject({ kind: 'incomplete', attempt: { state: 'staged', result: null } });
    }
    history.close();
  }, 120_000);
});

describe('free-running contention with the host clock (C2)', () => {
  test('four processes contending for 1.5 s: fences are issued once each, storage sees them in order, every refusal is typed and nothing stale is published', async () => {
    const location = freshStore();
    const names = ['H0', 'H1', 'H2', 'H3'];
    const workers = await Promise.all(names.map((name) => startWorker(name, { location, store: concurrencyStore, clock: 'host' })));
    const replies = await together(workers, (target) => ({ op: 'contend', holder: `free-${target.name}`, durationMilliseconds: 1_500, leaseMilliseconds: 150 }));
    const logs = workers.map((target, index) => ({ holder: `free-${target.name}`, log: parseContentionLog(valueOf(target, replies[index])) }));
    // The four loops ran concurrently for most of their 1.5 s rather than one after another.
    const loops = measureConcurrency(replies);
    expect(loops.overlap).toBeGreaterThan(1_000);
    await Promise.all(workers.map((target) => target.close()));

    const grants = logs.flatMap(({ holder, log }) => log.filter((event) => event.op === 'acquire' && event.ok).map((event) => ({ holder, fence: event.fence })));
    const fences = grants.map((grant) => grant.fence).sort((left, right) => left - right);
    // Each fence was granted exactly once, with no gap.
    expect(fences).toEqual(Array.from({ length: fences.length }, (_, index) => index + 1));
    const grantee = new Map(grants.map((grant) => [grant.fence, grant.holder]));

    const all: readonly (IContentionEvent & { readonly holder: string })[] = logs.flatMap(({ holder, log }) => log.map((event) => ({ ...event, holder })));
    for (const event of all) {
      if (event.contended === true) {
        // History's typed contention outcome (issue #136): only acquisition and renewal report it, nothing
        // changed, and a writer it names was really granted the writer.
        expect(['acquire', 'renew']).toContain(event.op);
        expect(event.error).toBeUndefined();
        if (event.heldBy !== undefined) {
          expect(names.map((name) => `free-${name}`)).toContain(event.heldBy);
        }
      } else if (event.op === 'acquire' && !event.ok) {
        // A refused acquisition names a holder that really was granted the writer.
        expect(names.map((name) => `free-${name}`)).toContain(event.heldBy);
      } else if (!event.ok) {
        // Every other refusal is History's typed stale-writer refusal; a raw driver error such as SQLITE_BUSY fails here.
        expect(event.error).toBe('StaleWriterError');
      } else if (event.op !== 'acquire') {
        // An accepted mutation presented a fence this process was granted.
        expect(grantee.get(event.fence)).toBe(event.holder);
      }
    }

    const state = snapshot(location);
    expectFenceOrderedStorage(state);
    for (const attempt of state.attempts) {
      expect(grantee.get(attempt.allocatedFence)).toBe(attempt.key.split(':')[0]);
      // Attempts presented for publication only with an outlived lease are never published.
      if (attempt.key.endsWith(':left-staged')) {
        expect(['allocated', 'staged']).toContain(attempt.state);
      }
    }
    expect(state.attempts.some((attempt) => attempt.key.endsWith(':late'))).toBe(false);

    // The run exercised contention rather than a single uncontested holder.
    expect(grants.length).toBeGreaterThanOrEqual(2);
    expect(all.some((event) => event.op === 'acquire' && !event.ok && event.contended !== true)).toBe(true);
    expect(all.some((event) => event.error === 'StaleWriterError')).toBe(true);
    expect(state.results.length).toBeGreaterThanOrEqual(2);
  }, 120_000);
});

/** How long the forced phase waits for one worker to reach a state before failing with diagnostics. */
const forcedStepBoundMilliseconds = 10_000;

/**
 * The lease every C3 run requests: long enough that no host stall expires it
 * before its run closes and releases it, which the forced phase's parent and
 * every free-running tenure do long before.
 */
const forcedLeaseMilliseconds = 10_000;

/** Pause the parent briefly between status polls of a worker. */
function pauseParent(milliseconds: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, milliseconds);
  });
}

/** The status of a worker's waiting run, from a command that must succeed. */
async function waitStatusOf(target: IWorkerHandle, command: IHarnessCommand): Promise<IWaitStatus> {
  return parseWaitStatus(valueOf(target, await target.step(command)));
}

/**
 * Poll a worker's waiting run until `reached` holds, within a fixed bound. A
 * worker that never gets there fails the test with its full status, naming
 * what was expected, so a missed interleaving is reported, never assumed.
 */
async function untilStatus(target: IWorkerHandle, expected: string, reached: (status: IWaitStatus) => boolean): Promise<IWaitStatus> {
  const giveUpAt = hostMonotonicMilliseconds() + forcedStepBoundMilliseconds;
  for (;;) {
    const status = await waitStatusOf(target, { op: 'wait-status' });
    if (reached(status)) {
      return status;
    }
    if (hostMonotonicMilliseconds() >= giveUpAt) {
      throw new Error(`${target.name} did not reach "${expected}" within ${String(forcedStepBoundMilliseconds)} ms: ${JSON.stringify(status)}`);
    }
    await pauseParent(2);
  }
}

/** One forced-phase outcome, in the same shape as a free-running tenure. */
type IForcedEvent = IWaitContentionEvent & { readonly worker: string };

/**
 * The forced phase of C3, coordinated by the parent so it never depends on
 * host speed (issue #140). Q0 runs a wait that takes the free lease and holds
 * it, under a lease no stall can expire, until the parent lets it finish.
 * Meanwhile Q1 waits with no deadline and Q2 waits with a short operator
 * deadline. The parent requires Q1's first try to be refused, naming Q0, and
 * Q2 to end as writer-busy naming Q0 after refused tries only. Only then does
 * it end Q0's run, which releases the lease, and it requires Q1 to be granted
 * the next fence on a later try. Every step is bounded and reports the
 * worker's status when it is missed.
 */
async function forcedHandover(workers: readonly IWorkerHandle[]): Promise<readonly IForcedEvent[]> {
  const [q0, q1, q2] = workers;
  if (q0 === undefined || q1 === undefined || q2 === undefined) {
    throw new Error('the forced phase needs three workers');
  }
  const start = (target: IWorkerHandle, extra: { readonly deadline?: number }): Promise<IWaitStatus> => waitStatusOf(target, {
    op: 'wait-start',
    at: 0,
    holder: `waiter-${target.name}`,
    leaseMilliseconds: forcedLeaseMilliseconds,
    pollMilliseconds: 5,
    key: `waiter-${target.name}:forced`,
    ...extra,
  });

  // Q0 takes the free lease on its first try, publishes, and keeps its run open.
  await start(q0, {});
  const holder = await untilStatus(q0, 'granted and published', (status) => status.outcome.kind === 'acquired');
  expect(holder.attempts.map((attempt) => attempt.kind)).toEqual(['acquired']);

  // Q1 waits with no deadline; its first try must be refused, naming Q0.
  const waiter = await start(q1, {});
  expect(waiter.attempts[0]).toMatchObject({ kind: 'held', holder: 'waiter-Q0' });

  // Q2's operator deadline passes while Q0 still holds: the typed writer-busy outcome naming Q0.
  await start(q2, { deadline: Date.now() + 40 });
  const deadlined = await untilStatus(q2, 'writer-busy at its deadline', (status) => status.outcome.kind !== 'pending');
  expect(deadlined.outcome).toMatchObject({ kind: 'busy', error: 'WriterBusyError', holder: 'waiter-Q0', contended: false });
  expect(deadlined.attempts.length).toBeGreaterThanOrEqual(1);
  expect(deadlined.attempts.every((attempt) => attempt.kind === 'held' && attempt.holder === 'waiter-Q0')).toBe(true);

  // Q1 is still waiting; only now does Q0's run end, releasing the lease.
  const stillWaiting = await waitStatusOf(q1, { op: 'wait-status' });
  expect(stillWaiting.outcome).toEqual({ kind: 'pending' });
  const released = await waitStatusOf(q0, { op: 'wait-finish', at: 0 });
  const granted = await untilStatus(q1, 'granted after waiting', (status) => status.outcome.kind !== 'pending');
  expect(granted.attempts.length).toBeGreaterThan(1);
  expect(granted.attempts.slice(0, -1).every((attempt) => attempt.kind === 'held' && attempt.holder === 'waiter-Q0')).toBe(true);
  expect(granted.attempts.at(-1)).toMatchObject({ kind: 'acquired', holder: 'waiter-Q1' });
  const holderOutcome = released.outcome;
  const waiterOutcome = granted.outcome;
  if (holderOutcome.kind !== 'acquired' || waiterOutcome.kind !== 'acquired' || deadlined.outcome.kind !== 'busy') {
    throw new Error(`forced phase outcomes: ${JSON.stringify([holderOutcome, waiterOutcome, deadlined.outcome])}`);
  }
  // The waiter's grant is a takeover through fencing: the next fence.
  expect(waiterOutcome.fence).toBe(holderOutcome.fence + 1);
  await waitStatusOf(q1, { op: 'wait-finish', at: 0 });
  await waitStatusOf(q2, { op: 'wait-finish', at: 0 });

  return [
    { kind: 'granted', fence: holderOutcome.fence, tries: released.attempts.length, published: holderOutcome.published, worker: 'waiter-Q0' },
    { kind: 'granted', fence: waiterOutcome.fence, tries: granted.attempts.length, published: waiterOutcome.published, worker: 'waiter-Q1' },
    { kind: 'busy', holder: deadlined.outcome.holder, contended: deadlined.outcome.contended, tries: deadlined.attempts.length, worker: 'waiter-Q2' },
  ];
}

describe('real waiters contending for the lease with operator deadlines (C3)', () => {
  test('four processes repeatedly wait for the writer through Run Supervision on Node’s real timer: every wait ends granted with a unique fence or as the typed writer-busy outcome naming a real holder, and nothing else', async () => {
    const location = freshStore();
    const names = ['Q0', 'Q1', 'Q2', 'Q3'];
    const holders = names.map((name) => `waiter-${name}`);
    const workers = await Promise.all(names.map((name) => startWorker(name, { location, store: concurrencyStore, clock: 'host' })));
    // First the coordinated handover: a grant after a refused try and a deadline outcome, whatever the host speed.
    const forced = await forcedHandover(workers);
    // Then free-running contention. Each tenure waits at most 60 ms, polling every 5 ms, holds a granted lease for 25 ms and then rests 15 ms.
    // Tenures release their lease when they close, so its length only has to outlast a host stall inside one tenure;
    // a lease that expired mid-tenure would correctly refuse the publication as stale, which is not what C3 measures.
    const replies = await together(workers, (target) => ({
      op: 'wait-contend',
      holder: `waiter-${target.name}`,
      durationMilliseconds: 1_500,
      leaseMilliseconds: forcedLeaseMilliseconds,
      waitMilliseconds: 60,
      pollMilliseconds: 5,
      holdMilliseconds: 25,
      restMilliseconds: 15,
    }));
    const logs = workers.map((target, index) => ({ holder: `waiter-${target.name}`, log: parseWaitContention(valueOf(target, replies[index])) }));
    expect(measureConcurrency(replies).overlap).toBeGreaterThan(1_000);
    await Promise.all(workers.map((target) => target.close()));

    const events = [
      ...forced.map(({ worker, ...event }) => ({ event, worker })),
      ...logs.flatMap(({ holder, log }) => log.map((event) => ({ event, worker: holder }))),
    ];
    // Every wait ended in exactly one of the two typed outcomes: no raw driver error, no other failure.
    expect(events.filter(({ event }) => event.kind === 'failed')).toEqual([]);
    const grants = events.flatMap(({ event, worker }) => (event.kind === 'granted' ? [{ ...event, worker }] : []));
    const fences = grants.map((grant) => grant.fence).sort((left, right) => left - right);
    // Each fence was granted to exactly one tenure, with no gap.
    expect(fences).toEqual(Array.from({ length: fences.length }, (_, index) => index + 1));
    const grantees = new Set(grants.map((grant) => grant.worker));
    const busy = events.flatMap(({ event, worker }) => (event.kind === 'busy' ? [{ ...event, worker }] : []));
    for (const event of busy) {
      // Writer-busy names a holder that was really granted the writer; only contention may leave it unnamed.
      if (event.holder === null) {
        expect(event.contended).toBe(true);
      } else {
        expect(holders).toContain(event.holder);
        expect(grantees).toContain(event.holder);
      }
      // Every wait made at least its one attempt; one attempt that SQLite kept busy past the deadline is enough.
      expect(event.tries).toBeGreaterThanOrEqual(1);
    }

    const state = snapshot(location);
    expectFenceOrderedStorage(state);
    // Every grant published exactly once under its own fence, in fence order.
    expect(state.results.map((result) => result.publishedFence)).toEqual(fences);
    // Contention really happened: some waiters took over after waiting, and some reached their deadline.
    // The forced phase guarantees one of each; the free-running phase may add more.
    expect(grants.length).toBeGreaterThanOrEqual(2);
    expect(grants.some((grant) => grant.tries > 1)).toBe(true);
    expect(busy.length).toBeGreaterThan(0);
  }, 120_000);
});
