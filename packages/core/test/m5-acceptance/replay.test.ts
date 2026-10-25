/**
 * Run-bounded acquisition retry and `operator-resolves-unknown` (A-12, RUN-012), in
 * separate processes over the assembled facade path.
 *
 * Expectations, written by hand from the owner decision and the selected
 * mechanism (RUN-012):
 *
 * - A lost response is an **unknown** outcome. The current run retries only
 *   within its finite allowance, without requiring a write-effect safety
 *   declaration. Once that allowance is spent, the step attempt is tainted:
 *   an author's caught failure cannot send the same or a fallback operation.
 *   The member stays pending, and a new run can retry the same address.
 * - A retry retains the operation identity and mints another request attempt;
 *   a lost report remains unknown even if later data arrives.
 * - With provider idempotency, every send carries the operation identity as
 *   its key, the retry reuses it, and the provider applies the effect once.
 * - An operator's settlement is recorded with its provenance (action,
 *   outcome, operator, time). Resolving as failed asserts nothing happened
 *   and frees the address: the next process makes a new operation. Resolving
 *   as succeeded keeps the address consumed: later processes send nothing
 *   and fail the member with `operation-resolved`, until the operator
 *   abandons it, which keeps the earlier resolution for the audit trail and
 *   frees the address. Usage the operator learned is acknowledged once under
 *   the operator namespace; abandoning leaves the unknown usage unknown.
 *
 * @see ../../../../docs/spec/operations.md (RUN-012, ACC-005)
 * @see ../../../../docs/spec/acceptance.md (A-12)
 * @see ../../../../experiments/exp-8/decision.md (resolutions 4 and 5)
 */
import { describe, expect, test } from '@jest/globals';

import { baseWorld, clean, freshScenario, operationOf, removeScenarios, statuses, usageOf } from './support.js';

removeScenarios();

/** The provider ledger lines of pr-2's requests. */
function pr2Sends(lines: readonly { readonly kind: string; readonly key: string }[]): number {
  return lines.filter((entry) => entry.kind === 'received' && entry.key === 'pr-2').length;
}

describe('run-bounded acquisition retry (A-12, RUN-012)', () => {
  test('the omitted policy sends three total attempts in one process, leaves the fold waiting, and a new process can acquire the value', () => {
    const s = freshScenario(baseWorld({ script: { 'pr-2': [{ kind: 'lost' }, { kind: 'lost' }, { kind: 'lost' }, { kind: 'ok' }] } }));
    const first = clean(s.run({ kind: 'fold' }, { window: 1 }));
    const operation = operationOf(first, 'pr-2');
    expect(pr2Sends(s.ledger())).toBe(3);
    expect(first.result.members['pr-2']).toMatchObject({ status: 'pending', blocked: { kind: 'unknown-outcome', operation, reason: 'policy-exhausted' } });
    expect(first.result.fold).toEqual({ status: 'waiting', pending: ['pr-2'] });
    expect(usageOf(first.result.usage).unknown).toBe(3);

    const next = clean(s.run({ kind: 'fold' }, { window: 1 }));
    const sends = s.ledger().filter((entry) => entry.kind === 'received' && entry.key === 'pr-2');
    expect(sends).toHaveLength(4);
    expect(new Set(sends.map((entry) => entry.operation))).toEqual(new Set([operation]));
    expect(new Set(sends.map((entry) => entry.requestAttempt)).size).toBe(4);
    expect(next.result.fold).toMatchObject({ status: 'succeeded', kind: 'published' });
    expect(usageOf(next.result.usage).unknown).toBe(3);
  });

  test('a capped lost response taints caught author retry, while a later run gets a fresh allowance', () => {
    const s = freshScenario(baseWorld({ script: { 'pr-2': [{ kind: 'lost' }] }, declarations: { 'pr-2': { maxAttempts: 1, catchAndRetry: true } } }));
    const first = clean(s.run({ kind: 'members' }, { window: 1 }));
    expect(first.lines.filter((line) => line['t'] === 'trace' && line['helper'] === 'caught').map((line) => line['key'])).toEqual(['pr-2']);
    expect(pr2Sends(s.ledger())).toBe(1);
    expect(s.keys('applied')).toEqual(['pr-1', 'pr-2', 'pr-3']);
    expect(first.operations).toContain('request-settled:unknown:lost-response@pr-2');
    const operation = operationOf(first, 'pr-2');
    expect(statuses(first)).toEqual({ 'pr-1': 'succeeded', 'pr-2': 'pending', 'pr-3': 'succeeded' });
    expect(first.result.members['pr-2']?.blocked).toEqual({ kind: 'unknown-outcome', operation, reason: 'policy-exhausted' });

    const later = clean(s.run({ kind: 'members' }, { window: 1 }));
    expect(later.assessed).toEqual(['pr-2']);
    expect(pr2Sends(s.ledger())).toBe(2);
    expect(later.operations).toContain('retry-started@pr-2');
    expect(later.result.members['pr-2']).toMatchObject({ status: 'succeeded' });
    expect(usageOf(later.result.usage).unknown).toBe(1);
  });

  test('after a lost response the step attempt is tainted: a different fallback operation the author makes instead sends nothing', () => {
    const s = freshScenario(baseWorld({ script: { 'pr-2': [{ kind: 'lost' }] }, declarations: { 'pr-2': { maxAttempts: 1, catchAndFallback: true } } }));
    const run = clean(s.run({ kind: 'members' }, { window: 1 }));
    expect(run.lines.filter((line) => line['t'] === 'trace' && line['helper'] === 'caught').map((line) => line['key'])).toEqual(['pr-2']);
    // Only the original request reached the provider; the fallback was never minted or sent.
    expect(pr2Sends(s.ledger())).toBe(1);
    expect(run.result.operations.filter((view) => view.member === 'pr-2').map((view) => view.name)).toEqual(['assess']);
    expect(run.result.members['pr-2']).toMatchObject({ status: 'pending', blocked: { kind: 'unknown-outcome', reason: 'policy-exhausted' } });
  });

  test('declared safe to repeat, the lost response is retried under the same operation identity, and the author accepts a second effect', () => {
    const s = freshScenario(baseWorld({ script: { 'pr-2': [{ kind: 'lost' }, { kind: 'ok' }] }, declarations: { 'pr-2': { safeToRepeat: true, maxAttempts: 2 } } }));
    const run = clean(s.run({ kind: 'members' }, { window: 1 }));
    const sends = s.ledger().filter((entry) => entry.kind === 'received' && entry.key === 'pr-2');
    expect(sends).toHaveLength(2);
    expect(sends[1]?.operation).toBe(sends[0]?.operation);
    expect(sends[1]?.requestAttempt).not.toBe(sends[0]?.requestAttempt);
    expect(sends.map((entry) => entry.idempotencyKey)).toEqual([null, null]);
    expect(s.keys('applied').filter((key) => key === 'pr-2')).toEqual(['pr-2', 'pr-2']);
    expect(statuses(run)).toEqual({ 'pr-1': 'succeeded', 'pr-2': 'succeeded', 'pr-3': 'succeeded' });
  });

  test('with provider idempotency keys the retry reuses the operation identity as its key, and the provider applies the effect once', () => {
    const s = freshScenario(baseWorld({ script: { 'pr-2': [{ kind: 'lost' }, { kind: 'ok' }] }, declarations: { 'pr-2': { providerIdempotency: true, maxAttempts: 2 } } }));
    const run = clean(s.run({ kind: 'members' }, { window: 1 }));
    const sends = s.ledger().filter((entry) => entry.kind === 'received' && entry.key === 'pr-2');
    expect(sends).toHaveLength(2);
    const operation = sends[0]?.operation;
    expect(sends.map((entry) => [entry.operation, entry.idempotencyKey])).toEqual([[operation, operation], [operation, operation]]);
    expect(s.keys('applied').filter((key) => key === 'pr-2')).toEqual(['pr-2']);
    expect(statuses(run)).toEqual({ 'pr-1': 'succeeded', 'pr-2': 'succeeded', 'pr-3': 'succeeded' });
    // The lost first attempt reported nothing, so its usage is unknown; the retry delivered the effect's one report.
    expect(usageOf(run.result.usage)).toEqual({ status: 'incomplete', observed: [{ unit: 'tokens', amount: 300 }], unknown: 1, operations: 3, reports: 3, requestAttempts: 4 });
  });
});

describe('operator-resolves-unknown (A-12, RUN-012)', () => {
  test('resolving an unknown operation as failed is recorded with its provenance and frees the member, which a later process sends as a new operation', () => {
    const s = freshScenario(baseWorld({ script: { 'pr-2': [{ kind: 'lost-unapplied' }] }, declarations: { 'pr-2': { maxAttempts: 1 } } }));
    const lost = clean(s.run({ kind: 'members' }, { window: 1 }));
    const operation = operationOf(lost, 'pr-2');
    const settled = clean(s.run({ kind: 'settle', operation, action: 'resolve', outcome: 'failed' }));
    expect(settled.result.settled).toMatchObject({ operation, member: 'pr-2', status: 'resolved', settlement: { action: 'resolve', outcome: 'failed', operator: 'operator.ada' } });
    // No usage was supplied, so the settlement names no operator report (absent once the view crosses the process boundary as JSON).
    expect(settled.result.settled?.settlement?.report).toBeUndefined();
    expect(typeof settled.result.settled?.settlement?.at).toBe('number');
    expect(settled.operations).toContain('resolved:resolved:operator@pr-2');

    const repaired = clean(s.run({ kind: 'members' }, { window: 1 }));
    expect(repaired.assessed).toEqual(['pr-2']);
    const sends = s.ledger().filter((entry) => entry.kind === 'received' && entry.key === 'pr-2');
    expect(sends).toHaveLength(2);
    expect(sends[1]?.operation).not.toBe(operation);
    expect(statuses(repaired)).toEqual({ 'pr-1': 'succeeded', 'pr-2': 'succeeded', 'pr-3': 'succeeded' });
    // The settlement stays inspectable afterwards, with who settled it and how.
    expect(repaired.result.operations.find((view) => view.operation === operation)?.settlement).toMatchObject({ action: 'resolve', outcome: 'failed', operator: 'operator.ada' });
  });

  test('resolving as succeeded acknowledges the operator\'s usage once and keeps the address consumed until the operator abandons it', () => {
    const s = freshScenario(baseWorld({ script: { 'pr-2': [{ kind: 'lost' }] }, declarations: { 'pr-2': { maxAttempts: 1 } } }));
    const lost = clean(s.run({ kind: 'fold' }, { window: 1 }));
    expect(lost.result.fold).toEqual({ status: 'waiting', pending: ['pr-2'] });
    const operation = operationOf(lost, 'pr-2');
    expect(usageOf(lost.result.usage)).toEqual({ status: 'incomplete', observed: [{ unit: 'tokens', amount: 200 }], unknown: 1, operations: 3, reports: 2, requestAttempts: 3 });

    const resolved = clean(s.run({ kind: 'settle', operation, action: 'resolve', outcome: 'succeeded', usage: { report: 'invoice-7', quantities: [{ unit: 'tokens', amount: 100 }] } }));
    expect(resolved.result.settled).toMatchObject({ status: 'resolved', settlement: { action: 'resolve', outcome: 'succeeded', operator: 'operator.ada', report: 'operator:invoice-7' } });
    // The operator's report is attributed to the operation's last request attempt, so its usage is now known, once.
    expect(usageOf(resolved.result.usage)).toEqual({ status: 'complete', observed: [{ unit: 'tokens', amount: 300 }], unknown: 0, operations: 3, reports: 3, requestAttempts: 3 });

    for (let pass = 0; pass < 2; pass += 1) {
      const failing = clean(s.run({ kind: 'fold' }, { window: 1 }));
      expect(failing.result.members['pr-2']).toMatchObject({ status: 'failed', cause: 'operation-resolved' });
      expect(failing.result.fold).toMatchObject({ status: 'failed', failed: ['pr-2'] });
      expect(pr2Sends(s.ledger())).toBe(1);
      expect(usageOf(failing.result.usage)).toEqual({ status: 'complete', observed: [{ unit: 'tokens', amount: 300 }], unknown: 0, operations: 3, reports: 3, requestAttempts: 3 });
    }

    const abandoned = clean(s.run({ kind: 'settle', operation, action: 'abandon' }));
    expect(abandoned.result.settled).toMatchObject({ status: 'abandoned', settlement: { action: 'abandon', operator: 'operator.ada' }, resolution: { action: 'resolve', outcome: 'succeeded', report: 'operator:invoice-7' } });
    const repaired = clean(s.run({ kind: 'fold' }, { window: 1 }));
    expect(pr2Sends(s.ledger())).toBe(2);
    expect(repaired.result.fold).toMatchObject({ status: 'succeeded', kind: 'published' });
    expect(repaired.result.report).toEqual({ scores: [['pr-1', 2], ['pr-2', 1], ['pr-3', 2]] });
  });

  test('abandoning an unknown operation leaves its usage unknown and lets a later process send the member afresh', () => {
    const s = freshScenario(baseWorld({ script: { 'pr-2': [{ kind: 'lost' }] }, declarations: { 'pr-2': { maxAttempts: 1 } } }));
    const lost = clean(s.run({ kind: 'members' }, { window: 1 }));
    const operation = operationOf(lost, 'pr-2');
    const abandoned = clean(s.run({ kind: 'settle', operation, action: 'abandon' }));
    expect(abandoned.result.settled).toMatchObject({ status: 'abandoned', settlement: { action: 'abandon', operator: 'operator.ada' } });
    expect(abandoned.result.settled?.settlement?.outcome).toBeUndefined();
    expect(usageOf(abandoned.result.usage)).toEqual({ status: 'incomplete', observed: [{ unit: 'tokens', amount: 200 }], unknown: 1, operations: 3, reports: 2, requestAttempts: 3 });
    const repaired = clean(s.run({ kind: 'members' }, { window: 1 }));
    expect(statuses(repaired)).toEqual({ 'pr-1': 'succeeded', 'pr-2': 'succeeded', 'pr-3': 'succeeded' });
    expect(pr2Sends(s.ledger())).toBe(2);
    expect(usageOf(repaired.result.usage)).toEqual({ status: 'incomplete', observed: [{ unit: 'tokens', amount: 300 }], unknown: 1, operations: 4, reports: 3, requestAttempts: 4 });
  });
});
