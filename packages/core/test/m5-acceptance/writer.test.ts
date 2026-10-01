/**
 * The single fenced writer across independent processes, through the
 * assembled facade path: `writer-wait-and-takeover`,
 * `stale-holder-interleavings` and `drain-outlives-lease` (A-09, A-10,
 * PUB-004, RUN-002 owner decision, EXP-8 ruling R).
 *
 * Expectations, written by hand from the owner decision, the writer-lease
 * model (`experiments/exp-7/WriterLease.tla`) and ruling R:
 *
 * - One fenced writer per store. A process that needs to write while another
 *   holds an unexpired lease waits. With an operator deadline it fails at the
 *   deadline with the typed writer-busy error naming the holder and its
 *   expiry; with none it waits. Waiting changes no authority or data (the
 *   writer row and every fenced row stay exactly as they were).
 * - Takeover happens only after expiry and only with the next fence. A waiter
 *   started while a killed holder's lease is unexpired is granted the lease
 *   at or after that expiry, with fence + 1, and records the dead run's
 *   in-flight operation unknown without replaying it.
 * - A stale holder (one whose lease expired, whether or not a successor took
 *   over) can neither publish, renew nor release on another holder's
 *   behalf. Its late completion commits nothing: no History row changes, its
 *   operation's outcome is reported `lease-lost`, and its usage, already
 *   spent, is still recorded once by Accounting, which needs no fence. Its
 *   late next request cannot renew the old lease: it waits for, or acquires,
 *   a fresh lease with a higher fence and writes only under that fence. Its
 *   late release leaves the writer row untouched.
 * - Interleavings enumerate the holder's late action (publish, renew,
 *   release) against the successor's position (none: the lease simply
 *   expired; holding: the successor holds the lease mid-run; finished: the
 *   successor completed and released).
 *
 * The full matrix of seven lease-guarded History operations against four
 * takeover kinds is proven at History's port in separate processes by the
 * M5 concurrency record (#110); this suite proves the facade path end to end.
 *
 * @see ../../../../docs/validation/m5-concurrency-2026-09-30.md
 * @see ../../../../docs/spec/operations.md (RUN-002 owner decision)
 * @see ../../../../experiments/exp-8/decision.md (ruling R)
 */
import { describe, expect, test } from '@jest/globals';

import { elapse } from './harness.js';
import type { IFencedRows, IStartedProcess } from './harness.js';
import { baseWorld, clean, freshScenario, operationOf, removeScenarios, statuses, usageOf } from './support.js';
import type { IUsageView } from './support.js';

removeScenarios();

/** A holder's lease that the parent outlives quickly. */
const shortLease = 1_000;

/** A successor's lease, long enough to hold throughout a case. */
const longLease = 60_000;

/** The run identity a background process's events name. */
function runIdOf(started: IStartedProcess): string {
  const event = started.lines.find((line) => line['t'] === 'event' && typeof line['runId'] === 'string');
  if (event === undefined) {
    throw new Error('the process has offered no event yet');
  }
  return String(event['runId']);
}

/** The holder name the facade records for a run. */
function holderOf(runId: string): string {
  return `microdelta-run:${runId}`;
}

/**
 * The fences under which rows were added or changed between two snapshots:
 * each new or changed attempt row's highest fence, and the fence of each new
 * result, journal revision, acceptance and promotion.
 */
function fencesWritten(before: IFencedRows, after: IFencedRows): readonly number[] {
  const added = (earlier: readonly string[], later: readonly string[]): readonly string[] => later.filter((row) => !earlier.includes(row));
  const last = (row: string): number => Number(row.split(' ').at(-1));
  const attempts = added(before.attempts, after.attempts).map((row) => {
    const [allocated, ended] = row.split(' ').slice(-2).map(Number);
    return Math.max(allocated ?? 0, Number.isNaN(ended) ? 0 : ended ?? 0);
  });
  return [...new Set([
    ...attempts,
    ...added(before.results, after.results).map(last),
    ...added(before.journal, after.journal).map(last),
    ...added(before.acceptances, after.acceptances).map(last),
    ...added(before.promotions, after.promotions).map(last),
  ])].sort((left, right) => left - right);
}

describe('writer-wait-and-takeover (A-09, RUN-002)', () => {
  test('a second process waits for the lease instead of failing; at an operator deadline it fails writer-busy naming the holder; waiting changes nothing', async () => {
    const s = freshScenario(baseWorld({ script: { 'pr-1': [{ kind: 'gate', gate: 'hold' }] } }));
    const holder = s.start({ kind: 'members' }, { window: 1, leaseMilliseconds: longLease });
    await holder.waitForLine((line) => line['t'] === 'event' && line['kind'] === 'operation' && line['phase'] === 'request-started', 'the holder is sending pr-1');
    const held = s.rows();
    expect(held.writer.holder).toBe(holderOf(runIdOf(holder)));

    // With a 300 ms operator deadline a second process fails with the typed writer-busy error naming the holder.
    const busy = s.run({ kind: 'members' }, { window: 1, writerDeadlineMs: 300 });
    expect(busy.status).toBe(3);
    expect(busy.error).toMatchObject({ name: 'WriterBusyError', code: 'writer-busy', holder: held.writer.holder, expiresAt: held.writer.expiresAt });
    expect(s.rows()).toEqual(held);

    // Without a deadline a second process waits: a second later it has neither failed nor written anything.
    const waiter = s.start({ kind: 'members' }, { window: 1 });
    const exits: string[] = [];
    void holder.exited.then(() => exits.push('holder'));
    void waiter.exited.then(() => exits.push('waiter'));
    await elapse(1_000);
    expect(exits).toEqual([]);
    expect(s.rows()).toEqual(held);
    expect(s.keys('received')).toEqual(['pr-1']);

    s.open('hold');
    const first = clean(await holder.exited);
    const second = clean(await waiter.exited);
    expect(exits).toEqual(['holder', 'waiter']);
    // The waiter ran under the next fence once the holder released, reused every result and sent nothing.
    expect(statuses(second)).toEqual({ 'pr-1': 'succeeded', 'pr-2': 'succeeded', 'pr-3': 'succeeded' });
    expect(second.assessed).toEqual([]);
    expect(second.result.members['pr-1']).toEqual({ status: 'succeeded', kind: 'reused', reference: first.result.members['pr-1']?.reference });
    expect(s.writer()).toEqual({ lastFence: held.writer.lastFence + 1, holder: null, expiresAt: expect.any(Number) });
    expect(s.keys('received')).toEqual(['pr-1', 'pr-2', 'pr-3']);
  });

  test('after the holder is killed, a waiter takes over only at its expiry, with the next fence, and records the in-flight operation unknown without replaying it', async () => {
    const s = freshScenario(baseWorld({ script: { 'pr-1': [{ kind: 'gate', gate: 'never' }], 'pr-3': [{ kind: 'gate', gate: 'successor' }] } }));
    const doomed = s.start({ kind: 'members' }, { window: 1, leaseMilliseconds: 1_500 });
    await doomed.waitForLine((line) => line['t'] === 'event' && line['kind'] === 'operation' && line['phase'] === 'request-started', 'the doomed holder is sending pr-1');
    const dead = s.writer();
    doomed.kill('SIGKILL');
    expect((await doomed.exited).signal).toBe('SIGKILL');

    const successor = s.start({ kind: 'members' }, { window: 1, leaseMilliseconds: longLease });
    await successor.waitForLine((line) => line['t'] === 'event' && line['kind'] === 'operation' && line['phase'] === 'request-started' && line['member'] === 'pr-3', 'the successor is sending pr-3');
    const taken = s.writer();
    expect(taken.holder).toBe(holderOf(runIdOf(successor)));
    expect(taken.lastFence).toBe(dead.lastFence + 1);
    // Granted no earlier than the dead holder's expiry.
    expect(taken.expiresAt - longLease).toBeGreaterThanOrEqual(dead.expiresAt);
    s.open('successor');
    const run = clean(await successor.exited);
    expect(run.operations).toContain('recovered:unknown:recovered-after-crash@pr-1');
    expect(statuses(run)).toEqual({ 'pr-1': 'pending', 'pr-2': 'succeeded', 'pr-3': 'succeeded' });
    expect(run.result.members['pr-1']?.blocked).toEqual({ kind: 'unknown-outcome', operation: operationOf(run, 'pr-1'), reason: 'not-repeat-safe' });
    expect(s.keys('received')).toEqual(['pr-1', 'pr-2', 'pr-3']);
  });
});

/** The holder's late action and the successor's position. */
type ILate = 'publish' | 'renew' | 'release';
type ISuccessor = 'none' | 'holding' | 'finished';

/** One enumerated interleaving. */
interface IInterleaving {
  readonly late: ILate;
  readonly successor: ISuccessor;
}

const interleavings: readonly IInterleaving[] = (['publish', 'renew', 'release'] as const).flatMap((late) => (['none', 'holding', 'finished'] as const).map((successor) => ({ late, successor })));

/**
 * Accounting's usage after the stale holder's late completion of pr-1, by
 * the successor's position. The holder's pr-1 answer (100 tokens) is always
 * recorded. A successor (fence + 1) found pr-1 in flight and recorded it
 * unknown without sending; it answered pr-2 (100 tokens) and, when finished,
 * pr-3 (100 tokens); while holding, its pr-3 request is in flight (unknown).
 */
const usageAfterLatePublish: Readonly<Record<ISuccessor, IUsageView>> = {
  none: { status: 'complete', observed: [{ unit: 'tokens', amount: 100 }], unknown: 0, operations: 1, reports: 1, requestAttempts: 1 },
  holding: { status: 'incomplete', observed: [{ unit: 'tokens', amount: 200 }], unknown: 1, operations: 3, reports: 2, requestAttempts: 3 },
  finished: { status: 'complete', observed: [{ unit: 'tokens', amount: 300 }], unknown: 0, operations: 3, reports: 3, requestAttempts: 3 },
};

describe('stale-holder-interleavings (A-09, A-10, PUB-004)', () => {
  test.each(interleavings)('late $late with successor $successor: the stale holder cannot act for another holder', async ({ late, successor }) => {
    const s = freshScenario(baseWorld({ script: {
      ...(late === 'publish' ? { 'pr-1': [{ kind: 'gate', gate: 'late' }] } : {}),
      ...(successor === 'holding' ? { 'pr-3': [{ kind: 'gate', gate: 'successor' }] } : {}),
    } }));
    const stale = s.start({ kind: 'interleave', late, gate: 'late' }, { window: 1, leaseMilliseconds: shortLease });
    if (late === 'publish') {
      await stale.waitForLine((line) => line['t'] === 'event' && line['kind'] === 'operation' && line['phase'] === 'request-started', 'the holder is sending pr-1');
    } else {
      await stale.waitForLine((line) => line['t'] === 'idle', 'the holder finished its first request');
    }
    const staleFence = s.writer().lastFence;
    await s.outlastLease();

    let next: IStartedProcess | undefined;
    if (successor === 'holding') {
      next = s.start({ kind: 'members' }, { window: 1, leaseMilliseconds: longLease });
      await next.waitForLine((line) => line['t'] === 'event' && line['kind'] === 'operation' && line['phase'] === 'request-started' && line['member'] === 'pr-3', 'the successor holds the lease mid-run');
    } else if (successor === 'finished') {
      clean(s.run({ kind: 'members' }, { window: 1, leaseMilliseconds: longLease }));
    }
    const successorFence = successor === 'none' ? undefined : staleFence + 1;
    if (successorFence !== undefined) {
      expect(s.writer().lastFence).toBe(successorFence);
    }
    const before = s.rows();

    s.open('late');
    /** The rows the late action is judged against: the snapshot, or, when the late request waited out a holding successor, the rows once it finished. */
    let judged = before;
    if (late === 'renew' && successor === 'holding' && next !== undefined) {
      // The late request's renewal is refused; it waits for the successor's unexpired lease and changes nothing meanwhile.
      await elapse(700);
      expect(stale.exitedYet).toBe(false);
      expect(s.rows()).toEqual(before);
      s.open('successor');
      clean(await next.exited);
      judged = s.rows();
    }
    const holder = clean(await stale.exited);
    const after = s.rows();

    if (late === 'publish') {
      // The late completion committed nothing: every History row, and the writer row, is exactly as it was.
      expect(after).toEqual(before);
      // Its step stays pending: the operation's outcome is unrecorded because the pass lost its lease (ruling R).
      expect(holder.result.late).toBe('refused:denied');
      expect(holder.operations).toContain('request-settled:unknown:lease-lost@pr-1');
      // The usage it spent is still recorded, once.
      expect(usageOf(s.usage())).toEqual(usageAfterLatePublish[successor]);
    } else if (late === 'release') {
      // Releasing a stale lease changes nothing: a successor's lease, or the expired row, stays exactly as it was.
      expect(after).toEqual(before);
    } else {
      // The late request could not renew the old lease: it took a fresh lease with a higher fence and wrote only under it.
      const fresh = (successorFence ?? staleFence) + 1;
      expect(after.writer).toEqual({ lastFence: fresh, holder: null, expiresAt: expect.any(Number) });
      expect(fencesWritten(judged, after)).toEqual([fresh]);
      expect(holder.result.late).toBe(successor === 'none' ? 'published' : 'reused');
    }

    if (successor === 'holding' && next !== undefined && late !== 'renew') {
      s.open('successor');
      const finished = clean(await next.exited);
      // The successor finished untouched, publishing only under its own fence.
      expect(finished.result.members['pr-3']).toMatchObject({ status: 'succeeded', kind: 'published' });
      expect(fencesWritten(after, s.rows())).toEqual([successorFence]);
    }
  });
});

describe('drain-outlives-lease (A-09, EXP-8 ruling R)', () => {
  test('a soft-stop drain that outlives its lease while a successor holds it: the late completion is refused, the successor is untouched, and its usage is preserved', async () => {
    const s = freshScenario(baseWorld({ script: { 'pr-1': [{ kind: 'gate', gate: 'late' }], 'pr-3': [{ kind: 'gate', gate: 'successor' }] } }));
    const draining = s.start({ kind: 'members' }, { window: 1, leaseMilliseconds: shortLease, stops: [{ on: { received: 'pr-1' }, level: 'soft' }] });
    await draining.waitForLine((line) => line['t'] === 'event' && line['kind'] === 'stop' && line['level'] === 'soft', 'the drain began');
    const drainFence = s.writer().lastFence;
    await s.outlastLease();
    const successor = s.start({ kind: 'members' }, { window: 1, leaseMilliseconds: longLease });
    await successor.waitForLine((line) => line['t'] === 'event' && line['kind'] === 'operation' && line['phase'] === 'request-started' && line['member'] === 'pr-3', 'the successor holds the lease mid-run');
    const before = s.rows();
    expect(before.writer).toMatchObject({ lastFence: drainFence + 1, holder: holderOf(runIdOf(successor)) });

    s.open('late');
    const drained = await draining.exited;
    // A storage-ownership failure, distinguishable from a provider failure (RUN-009): after its refused completion the
    // drain met the successor's newer pr-2 result, and a run without lease authority cannot record its acceptance.
    expect(drained.status).toBe(3);
    expect(drained.error).toMatchObject({ name: 'StaleWriterError' });
    // The late completion published nothing and left the successor's lease and every row exactly as they were.
    expect(s.rows()).toEqual(before);
    expect(drained.operations).toContain('request-settled:unknown:lease-lost@pr-1');
    // Its usage is preserved: pr-1's answer (100 tokens) and the successor's pr-2 (100 tokens); the successor's pr-3 is in flight.
    expect(usageOf(s.usage())).toEqual({ status: 'incomplete', observed: [{ unit: 'tokens', amount: 200 }], unknown: 1, operations: 3, reports: 2, requestAttempts: 3 });

    s.open('successor');
    const finished = clean(await successor.exited);
    expect(statuses(finished)).toEqual({ 'pr-1': 'pending', 'pr-2': 'succeeded', 'pr-3': 'succeeded' });
    expect(fencesWritten(before, s.rows())).toEqual([drainFence + 1]);
  });
});
