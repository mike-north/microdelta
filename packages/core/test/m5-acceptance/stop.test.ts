/**
 * `soft-then-hard-stop` (A-13, RUN-014, RUN-015): operator stop intent in
 * separate processes over the assembled facade path. Each stop is requested
 * through the run's stop controller by the worker when a named observation
 * happens (a provider receipt, a member body starting, the run starting to
 * sleep), standing in for an interrupt arriving exactly then.
 *
 * Expectations, written by hand from the owner decision and EXP-8's selected
 * execution contract:
 *
 * - The drain unit is the admitted step. After a soft stop nothing new is
 *   admitted and nothing is retried; the admitted step drains, and with no
 *   default deadline it finishes and publishes. A member that had not started
 *   ends cancelled without a send, a claim or a body.
 * - A hard stop aborts an in-flight send, a wait for a permit and a deferral
 *   sleep. An aborted send's remote state is recorded durably: provider
 *   confirmed `cancelled` (which settles the operation), still `running`, or
 *   `unknown` when the provider supports no cancellation; the latter two
 *   leave the operation unknown. Nothing partial is published, and the
 *   attempt's usage is unknown, never zero.
 *
 * @see ../../../../docs/spec/operations.md (RUN-014, RUN-015)
 * @see ../../../../docs/plans/m5-operations.md (Selected execution contract: Stop)
 * @see ../../../../experiments/exp-8/decision.md (mechanisms 1 and 2)
 */
import { describe, expect, test } from '@jest/globals';

import { assessmentSubject, baseWorld, clean, freshScenario, operationOf, removeScenarios, statuses, usageOf } from './support.js';

removeScenarios();

/** The stop levels a process's events announced, in order. */
function stopEvents(events: readonly Readonly<Record<string, unknown>>[]): readonly unknown[] {
  return events.filter((event) => event['kind'] === 'stop').map((event) => event['level']);
}

describe('soft-then-hard-stop (A-13, RUN-014)', () => {
  test('a soft stop admits nothing new: the in-flight step drains and publishes, and the queued members end cancelled without a send', async () => {
    const s = freshScenario(baseWorld({ script: { 'pr-1': [{ kind: 'gate', gate: 'drain' }] } }));
    const started = s.start({ kind: 'members' }, { window: 1, permits: 1, stops: [{ on: { received: 'pr-1' }, level: 'soft' }] });
    await started.waitForLine((line) => line['t'] === 'event' && line['kind'] === 'stop' && line['level'] === 'soft', 'the soft stop is in force');
    // The drain has no default deadline: the admitted step is still waiting for its answer.
    expect(started.exitedYet).toBe(false);
    s.open('drain');
    const run = clean(await started.exited);
    expect(run.result.stop).toEqual({ level: 'soft', cause: 'operator' });
    expect(statuses(run)).toEqual({ 'pr-1': 'succeeded', 'pr-2': 'cancelled', 'pr-3': 'cancelled' });
    expect(run.result.members['pr-1']).toMatchObject({ kind: 'published' });
    expect(s.publications(assessmentSubject('pr-1'))).toHaveLength(1);
    expect(s.keys('received')).toEqual(['pr-1']);
    expect(run.assessed).toEqual(['pr-1']);
    // Cancelled before any claim: no attempt was ever allocated for the queued members.
    expect(s.attempts('assessment:').map((row) => row.subject)).toEqual([assessmentSubject('pr-1')]);
    expect(usageOf(run.result.usage)).toEqual({ status: 'complete', observed: [{ unit: 'tokens', amount: 100 }], unknown: 0, operations: 1, reports: 1, requestAttempts: 1 });
  });

  test.each([
    {
      // A transient failure's retry waits out a backoff, a short durable deferral; a stop refuses the resumed deferral.
      retry: 'a transient failure retried after its backoff',
      script: [{ kind: 'transient' }],
      declaration: { maxAttempts: 2 },
      usage: { status: 'complete', observed: [{ unit: 'requests', amount: 1 }], unknown: 0, operations: 1, reports: 1, requestAttempts: 1 },
    },
    {
      // A lost response declared safe to repeat is retried at once within the call; a soft stop refuses that send.
      retry: 'a lost response retried at once under a safety basis',
      script: [{ kind: 'lost' }],
      declaration: { safeToRepeat: true, maxAttempts: 2 },
      usage: { status: 'incomplete', observed: [], unknown: 1, operations: 1, reports: 0, requestAttempts: 1 },
    },
  ] as const)('$retry is refused after a soft stop without sending, and the step publishes nothing', ({ script, declaration, usage }) => {
    const s = freshScenario(baseWorld({ script: { 'pr-1': script }, declarations: { 'pr-1': declaration } }));
    const run = clean(s.run({ kind: 'members' }, { window: 1, permits: 1, stops: [{ on: { received: 'pr-1' }, level: 'soft' }] }));
    expect(s.keys('received')).toEqual(['pr-1']);
    expect(run.result.members['pr-1']?.status).not.toBe('succeeded');
    expect(s.publications(assessmentSubject('pr-1'))).toEqual([]);
    expect(statuses(run)).toMatchObject({ 'pr-2': 'cancelled', 'pr-3': 'cancelled' });
    // Only the first request attempt was made: its refusal report, or its unknown usage after the lost response.
    expect(usageOf(run.result.usage)).toEqual(usage);
  });

  test('a hard stop escalates the drain: the in-flight send is aborted, its remote state recorded durably, and nothing partial is published', () => {
    const s = freshScenario(baseWorld({ script: { 'pr-1': [{ kind: 'stall' }] } }));
    const run = clean(s.run({ kind: 'members' }, { window: 1, permits: 1, stops: [{ on: { received: 'pr-1' }, level: 'soft' }, { on: { received: 'pr-1' }, level: 'hard', afterMs: 300 }] }));
    expect(stopEvents(run.events)).toEqual(['soft', 'hard']);
    expect(run.result.stop).toEqual({ level: 'hard', cause: 'operator' });
    expect(s.keys('received')).toEqual(['pr-1']);
    expect(s.keys('aborted')).toEqual(['pr-1']);
    expect(run.result.interruptions).toEqual([{ label: 'assess', remote: 'unknown' }]);
    expect(statuses(run)).toEqual({ 'pr-1': 'cancelled', 'pr-2': 'cancelled', 'pr-3': 'cancelled' });
    // Discovery completed before the stop and stays a result of its own; no assessment is published.
    expect(s.publications(assessmentSubject('pr-1'))).toEqual([]);
    expect(usageOf(run.result.usage)).toEqual({ status: 'incomplete', observed: [], unknown: 1, operations: 1, reports: 0, requestAttempts: 1 });
    // A later process reads the recorded remote state from the journal.
    const inspected = clean(s.run({ kind: 'inspect' }));
    const [view] = inspected.result.operations;
    expect(view).toMatchObject({ member: 'pr-1', status: 'unknown' });
    expect(view?.attempts.map((attempt) => attempt.remote)).toEqual(['unknown']);
  });

  test('a hard stop reaches a member waiting for the one permit: it never sends, and a member waiting for a lane never starts', () => {
    // Two lanes and one permit: pr-1 holds the permit; pr-2's body starts and waits for it; pr-3 waits for a lane.
    const s = freshScenario(baseWorld({ script: { 'pr-1': [{ kind: 'stall' }] } }));
    const run = clean(s.run({ kind: 'members' }, { window: 2, permits: 1, stops: [{ on: { received: 'pr-1' }, level: 'hard', afterMs: 300 }] }));
    expect(run.assessed).toEqual(['pr-1', 'pr-2']);
    expect(s.keys('received')).toEqual(['pr-1']);
    expect(s.keys('aborted')).toEqual(['pr-1']);
    expect(statuses(run)).toEqual({ 'pr-1': 'cancelled', 'pr-2': 'cancelled', 'pr-3': 'cancelled' });
    expect(['pr-1', 'pr-2', 'pr-3'].flatMap((key) => s.publications(assessmentSubject(key)))).toEqual([]);
  });

  test('a hard stop ends a deferral sleep at once: the run returns waiting until T, the deferred member stays pending, and the process exits long before T', () => {
    const retryMs = 60_000;
    const s = freshScenario(baseWorld({ script: { 'pr-2': [{ kind: 'rate-limit', retryMs }] } }));
    // The operator's hard stop arrives while the run sleeps.
    const run = clean(s.run({ kind: 'members' }, { window: 1, permits: 1, deferral: 'sleep', stops: [{ on: { sleeping: true }, level: 'hard', afterMs: 100 }] }));
    const [refused] = s.ledger().filter((entry) => entry.kind === 'received' && entry.key === 'pr-2');
    if (refused === undefined) {
      throw new Error('pr-2 was never sent');
    }
    const T = refused.at + retryMs;
    expect(run.events.filter((event) => event['kind'] === 'wait').map((event) => event['phase'])).toEqual(['sleeping', 'stopped']);
    expect(run.result.waitingUntil).toBe(T);
    expect(statuses(run)).toEqual({ 'pr-1': 'succeeded', 'pr-2': 'pending', 'pr-3': 'succeeded' });
    expect(run.result.members['pr-2']?.blocked).toEqual({ kind: 'deferred', operation: refused.operation, notBefore: T });
    expect(s.keys('received')).toEqual(['pr-1', 'pr-2', 'pr-3']);
    // The process ended long before T: nothing kept it waiting for the deferral.
    expect(Date.now()).toBeLessThan(T - 30_000);
  });

  // Observed defect, kept failing on purpose. A hard stop requested synchronously while the run offers its `sleeping`
  // event (here by an observer reacting to it) ends the wait, and the run returns at once, but Supervision's
  // `sleepForDeferral` then still arms its keep-alive timer for T: the abort listener ran before `cancel` was assigned.
  // The process cannot exit until T, which for a real quota deferral is hours. Remove `.failing` once the timer is not
  // armed for an already-stopped run.
  test.failing('DEFECT (stop during sleep): a hard stop requested as the run starts to sleep lets the process exit before T', () => {
    const retryMs = 3_000;
    const s = freshScenario(baseWorld({ script: { 'pr-2': [{ kind: 'rate-limit', retryMs }] } }));
    const run = clean(s.run({ kind: 'members' }, { window: 1, permits: 1, deferral: 'sleep', stops: [{ on: { sleeping: true }, level: 'hard' }] }));
    const [refused] = s.ledger().filter((entry) => entry.kind === 'received' && entry.key === 'pr-2');
    expect(run.events.filter((event) => event['kind'] === 'wait').map((event) => event['phase'])).toEqual(['sleeping', 'stopped']);
    expect(Date.now()).toBeLessThan((refused?.at ?? 0) + retryMs);
  });

  test.each([
    { cancel: undefined, remote: 'unknown', status: 'unknown' },
    { cancel: 'running', remote: 'running', status: 'unknown' },
    { cancel: 'cancelled', remote: 'cancelled', status: 'cancelled' },
  ] as const)('provider cancellation $cancel: a hard stop records the remote state $remote, and the operation is $status for later processes', ({ cancel, remote, status }) => {
    const s = freshScenario(baseWorld({ script: { 'pr-1': [{ kind: 'stall' }] }, ...(cancel === undefined ? {} : { declarations: { 'pr-1': { cancel } } }) }));
    const run = clean(s.run({ kind: 'members' }, { window: 1, stops: [{ on: { received: 'pr-1' }, level: 'hard', afterMs: 200 }] }));
    expect(run.result.interruptions).toEqual([{ label: 'assess', remote }]);
    expect(run.operations).toContain(`request-settled:${status}:stopped@pr-1`);
    const operation = operationOf(run, 'pr-1');
    const later = clean(s.run({ kind: 'members' }, { window: 1 }));
    if (status === 'cancelled') {
      // A confirmed cancellation settles the operation: the address is free, and the member is sent again as a new operation.
      expect(statuses(later)).toEqual({ 'pr-1': 'succeeded', 'pr-2': 'succeeded', 'pr-3': 'succeeded' });
      expect(s.ledger().filter((entry) => entry.kind === 'received' && entry.key === 'pr-1').map((entry) => entry.operation === operation)).toEqual([true, false]);
    } else {
      // Running or unknown remote work blocks the member until an operator settles it; nothing is sent again.
      expect(later.result.members['pr-1']).toMatchObject({ status: 'pending', blocked: { kind: 'unknown-outcome', operation } });
      expect(s.keys('received').filter((key) => key === 'pr-1')).toEqual(['pr-1']);
    }
  });
});
