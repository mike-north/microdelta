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
import { hostMonotonicMilliseconds, parseContentionLog, parseWaitContention } from './protocol.js';
import type { IContentionEvent, IHarnessCommand, IHarnessReply } from './protocol.js';

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
      if (event.op === 'acquire' && !event.ok) {
        // A refused acquisition names a holder that really was granted the writer.
        expect(names.map((name) => `free-${name}`)).toContain(event.heldBy);
      } else if (!event.ok) {
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
    expect(all.some((event) => event.op === 'acquire' && !event.ok)).toBe(true);
    expect(all.some((event) => event.error === 'StaleWriterError')).toBe(true);
    expect(state.results.length).toBeGreaterThanOrEqual(2);
  }, 120_000);
});

describe('real waiters contending for the lease with operator deadlines (C3)', () => {
  test('four processes repeatedly wait for the writer through Run Supervision on Node’s real timer: every wait ends granted with a unique fence or as the typed writer-busy outcome naming a real holder, and nothing else', async () => {
    const location = freshStore();
    const names = ['Q0', 'Q1', 'Q2', 'Q3'];
    const holders = names.map((name) => `waiter-${name}`);
    const workers = await Promise.all(names.map((name) => startWorker(name, { location, store: concurrencyStore, clock: 'host' })));
    // Each tenure waits at most 60 ms, polling every 5 ms, holds a granted lease for 25 ms and then rests 15 ms.
    const replies = await together(workers, (target) => ({
      op: 'wait-contend',
      holder: `waiter-${target.name}`,
      durationMilliseconds: 1_500,
      leaseMilliseconds: 1_000,
      waitMilliseconds: 60,
      pollMilliseconds: 5,
      holdMilliseconds: 25,
      restMilliseconds: 15,
    }));
    const logs = workers.map((target, index) => ({ holder: `waiter-${target.name}`, log: parseWaitContention(valueOf(target, replies[index])) }));
    expect(measureConcurrency(replies).overlap).toBeGreaterThan(1_000);
    await Promise.all(workers.map((target) => target.close()));

    const events = logs.flatMap(({ holder, log }) => log.map((event) => ({ event, worker: holder })));
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
    expect(grants.length).toBeGreaterThanOrEqual(2);
    expect(grants.some((grant) => grant.tries > 1)).toBe(true);
    expect(busy.length).toBeGreaterThan(0);
  }, 120_000);
});
