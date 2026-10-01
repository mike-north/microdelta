/**
 * `usage-exactly-once` (A-14, ACC-003, ACC-005, ACC-007, RUN-012): usage
 * survives process death, lost acknowledgments and redelivery exactly once,
 * and unknown usage is never reported as zero, in separate processes over
 * the assembled facade path with Resource Accounting's durable adapter
 * injected as the caller's port.
 *
 * Expectations, written by hand from the owner decisions and Accounting's
 * contracts:
 *
 * - Each answered assessment reports 100 `tokens` under its own report
 *   identity. Members resolve one at a time in key order (window 1).
 * - Intent before send, usage before outcome (RUN-012 selected mechanism): a
 *   request attempt whose intent is durable but whose usage report was never
 *   acknowledged is **unknown**, counted in `unknown`, never as zero, and the
 *   summary is `incomplete` (ACC-005).
 * - A usage report acknowledged before a crash is counted once, however many
 *   later processes run (ACC-003, ACC-007).
 * - An operation a dead run left in flight is recorded unknown by the next
 *   writer and is never replayed without a safety basis (RUN-012).
 * - A lost acknowledgment whose commit landed is still counted once; one
 *   whose commit did not land leaves that attempt's usage unknown. Neither
 *   changes the operation's committed outcome.
 * - Reports are keyed by (operation, report): a redelivered report is counted
 *   once, and the same report identity on two operations is two reports. A
 *   request attempt whose only report was a redelivery of an earlier
 *   attempt's has no acknowledged report of its own, so its usage is unknown.
 *
 * @see ../../../../docs/spec/operations.md (ACC-003, ACC-005, ACC-007, RUN-012)
 * @see ../../../../docs/spec/acceptance.md (A-14)
 */
import { describe, expect, test } from '@jest/globals';

import type { IKillPlan } from './worker.js';
import { baseWorld, clean, freshScenario, operationOf, removeScenarios, statuses, usageOf } from './support.js';
import type { IUsageView } from './support.js';

removeScenarios();

/** A killed process's writer lease, short so the next process takes over soon after the kill. */
const killedLease = 1_000;

/** One kill point and the usage Accounting holds afterwards, then after the next process answers pr-3. */
interface IKillCase {
  readonly at: IKillPlan['at'];
  /** Whether the provider applied pr-2's assessment before the kill. */
  readonly applied: boolean;
  readonly afterKill: IUsageView;
  readonly afterResume: IUsageView;
}

const killCases: readonly IKillCase[] = [
  {
    // pr-1 answered (100 tokens); pr-2's intent is durable and nothing was sent: its usage is unknown.
    at: 'before-send',
    applied: false,
    afterKill: { status: 'incomplete', observed: [{ unit: 'tokens', amount: 100 }], unknown: 1, operations: 2, reports: 1, requestAttempts: 2 },
    afterResume: { status: 'incomplete', observed: [{ unit: 'tokens', amount: 200 }], unknown: 1, operations: 3, reports: 2, requestAttempts: 3 },
  },
  {
    // The provider applied pr-2's assessment, but its response and usage never reached the dead process.
    at: 'after-send',
    applied: true,
    afterKill: { status: 'incomplete', observed: [{ unit: 'tokens', amount: 100 }], unknown: 1, operations: 2, reports: 1, requestAttempts: 2 },
    afterResume: { status: 'incomplete', observed: [{ unit: 'tokens', amount: 200 }], unknown: 1, operations: 3, reports: 2, requestAttempts: 3 },
  },
  {
    // pr-2's usage was acknowledged durably before the kill; only its outcome was lost.
    at: 'after-usage',
    applied: true,
    afterKill: { status: 'complete', observed: [{ unit: 'tokens', amount: 200 }], unknown: 0, operations: 2, reports: 2, requestAttempts: 2 },
    afterResume: { status: 'complete', observed: [{ unit: 'tokens', amount: 300 }], unknown: 0, operations: 3, reports: 3, requestAttempts: 3 },
  },
];

describe('usage-exactly-once (A-14, ACC-003, ACC-005, ACC-007)', () => {
  test.each(killCases)('a SIGKILL $at of pr-2: known usage survives once, unknown usage stays unknown, and the in-flight operation is never replayed', async ({ at, applied, afterKill, afterResume }) => {
    const s = freshScenario();
    const killed = s.run({ kind: 'members' }, { window: 1, leaseMilliseconds: killedLease, kill: { at, key: 'pr-2' } });
    expect(killed.signal).toBe('SIGKILL');
    expect(s.keys('received')).toEqual(at === 'before-send' ? ['pr-1'] : ['pr-1', 'pr-2']);
    expect(s.keys('applied')).toEqual(applied ? ['pr-1', 'pr-2'] : ['pr-1']);
    // Read by another process straight from Accounting's store: nothing has repaired anything yet.
    expect(usageOf(s.usage())).toEqual(afterKill);

    await s.outlastLease();
    const resumed = clean(s.run({ kind: 'members' }, { window: 1 }));
    // The next writer records the dead run's in-flight operation unknown and never sends it again.
    expect(resumed.operations).toContain('recovered:unknown:recovered-after-crash@pr-2');
    expect(statuses(resumed)).toEqual({ 'pr-1': 'succeeded', 'pr-2': 'pending', 'pr-3': 'succeeded' });
    expect(resumed.result.members['pr-2']?.blocked).toEqual({ kind: 'unknown-outcome', operation: operationOf(resumed, 'pr-2'), reason: 'not-repeat-safe' });
    expect(s.keys('received')).toEqual(at === 'before-send' ? ['pr-1', 'pr-3'] : ['pr-1', 'pr-2', 'pr-3']);
    expect(usageOf(resumed.result.usage)).toEqual(afterResume);

    // Another process changes nothing: no request, no report counted twice, unknown still unknown.
    const again = clean(s.run({ kind: 'members' }, { window: 1 }));
    expect(again.assessed).toEqual([]);
    expect(s.keys('received')).toEqual(at === 'before-send' ? ['pr-1', 'pr-3'] : ['pr-1', 'pr-2', 'pr-3']);
    expect(usageOf(again.result.usage)).toEqual(afterResume);
  });

  test('a lost acknowledgment whose commit landed is counted exactly once, and the committed outcome stands', () => {
    const s = freshScenario();
    const run = clean(s.run({ kind: 'members' }, { window: 1, ackFault: { key: 'pr-2', kind: 'landed' } }));
    expect(run.operations).toContain('usage-unrecorded:unrecorded@pr-2');
    expect(statuses(run)).toEqual({ 'pr-1': 'succeeded', 'pr-2': 'succeeded', 'pr-3': 'succeeded' });
    expect(usageOf(run.result.usage)).toEqual({ status: 'complete', observed: [{ unit: 'tokens', amount: 300 }], unknown: 0, operations: 3, reports: 3, requestAttempts: 3 });
    const again = clean(s.run({ kind: 'members' }, { window: 1 }));
    expect(again.assessed).toEqual([]);
    expect(s.keys('received')).toEqual(['pr-1', 'pr-2', 'pr-3']);
    expect(usageOf(again.result.usage)).toEqual({ status: 'complete', observed: [{ unit: 'tokens', amount: 300 }], unknown: 0, operations: 3, reports: 3, requestAttempts: 3 });
  });

  test('an acknowledgment that recorded nothing leaves that attempt unknown, never zero', () => {
    const s = freshScenario();
    const run = clean(s.run({ kind: 'members' }, { window: 1, ackFault: { key: 'pr-2', kind: 'unrecorded' } }));
    expect(run.operations).toContain('usage-unrecorded:unrecorded@pr-2');
    expect(statuses(run)).toEqual({ 'pr-1': 'succeeded', 'pr-2': 'succeeded', 'pr-3': 'succeeded' });
    expect(usageOf(run.result.usage)).toEqual({ status: 'incomplete', observed: [{ unit: 'tokens', amount: 200 }], unknown: 1, operations: 3, reports: 2, requestAttempts: 3 });
    expect(run.result.usage?.unknown.map((unknown) => unknown.attribution.member)).toEqual(['pr-2']);
  });

  test('a report redelivered after a crash is counted once; the retry that only redelivered it has unknown usage of its own', async () => {
    // pr-2's provider deduplicates by idempotency key, which is also a safety basis for retrying its unknown outcome.
    const s = freshScenario(baseWorld({ declarations: { 'pr-2': { providerIdempotency: true, maxAttempts: 2 } } }));
    const killed = s.run({ kind: 'members' }, { window: 1, leaseMilliseconds: killedLease, kill: { at: 'after-usage', key: 'pr-2' } });
    expect(killed.signal).toBe('SIGKILL');
    await s.outlastLease();
    const resumed = clean(s.run({ kind: 'members' }, { window: 1 }));
    // The retry carries the same key; the provider answers from its first application and redelivers that report.
    const sends = s.ledger().filter((entry) => entry.kind === 'received' && entry.key === 'pr-2');
    expect(sends.map((entry) => entry.idempotencyKey)).toEqual([sends[0]?.operation, sends[0]?.operation]);
    expect(s.keys('applied')).toEqual(['pr-1', 'pr-2', 'pr-3']);
    expect(resumed.operations).toContain('usage-unrecorded:conflict@pr-2');
    expect(statuses(resumed)).toEqual({ 'pr-1': 'succeeded', 'pr-2': 'succeeded', 'pr-3': 'succeeded' });
    expect(usageOf(resumed.result.usage)).toEqual({ status: 'incomplete', observed: [{ unit: 'tokens', amount: 300 }], unknown: 1, operations: 3, reports: 3, requestAttempts: 4 });
  });

  test('the same report identity on two operations is two reports, counted twice', () => {
    const s = freshScenario(baseWorld({ script: { 'pr-1': [{ kind: 'ok', report: 'shared-usage' }], 'pr-3': [{ kind: 'ok', report: 'shared-usage' }] } }));
    const run = clean(s.run({ kind: 'members' }, { window: 1 }));
    expect(statuses(run)).toEqual({ 'pr-1': 'succeeded', 'pr-2': 'succeeded', 'pr-3': 'succeeded' });
    expect(usageOf(run.result.usage)).toEqual({ status: 'complete', observed: [{ unit: 'tokens', amount: 300 }], unknown: 0, operations: 3, reports: 3, requestAttempts: 3 });
  });
});
