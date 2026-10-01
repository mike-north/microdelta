/**
 * `durable-quota-deferral` (A-11, A-12, RUN-011): a quota response with a
 * retry time defers only its own operation durably, "not before T", in
 * separate processes over the assembled facade path.
 *
 * Expectations, written by hand from the owner decision and the selected
 * mechanism (RUN-011):
 *
 * - The provider refuses pr-2 with a retry time; T is its receipt time plus
 *   the retry delay. The refusal reports 1 `requests`; every answer reports
 *   100 `tokens`. Members resolve one at a time in key order (window 1), and
 *   the run has one permit.
 * - Exit mode returns at once reporting `waitingUntil` T. pr-1 and pr-3
 *   finish; pr-2 is pending (never failed) on a deferral with T; the strict
 *   report waits on pr-2. pr-3 is sent after pr-2's refusal: the deferral
 *   holds no permit.
 * - A later process before T admits nothing of pr-2: it sends nothing,
 *   executes no body, and reports the same T. pr-1 and pr-3 are reused.
 * - A process after T retries pr-2 under the same operation identity with a
 *   new request attempt, sent no earlier than T. Its host clock is set 3
 *   hours and 1 minute ahead, standing in for the hours passing between
 *   processes. The report then succeeds: scores 2, 1 and 2.
 * - Sleep mode releases the writer lease while it waits (the stored writer
 *   row names no holder), lets pr-3 finish meanwhile, then resumes pr-2
 *   under the same identity at or after T in the same process.
 * - A transient failure under the author's policy waits out its backoff as a
 *   timed wait holding no permit and lending its member's lane, so with one
 *   permit and one lane its siblings are sent meanwhile; the retry keeps the
 *   operation identity.
 *
 * @see ../../../../docs/spec/operations.md (RUN-011)
 * @see ../../../../docs/plans/m5-operations.md (Outcomes: quota response with a retry time 3h ahead)
 */
import { describe, expect, test } from '@jest/globals';

import { hour } from './harness.js';
import { assessmentSubject, baseWorld, clean, freshScenario, removeScenarios, statuses, usageOf } from './support.js';

removeScenarios();

/** The strict report once every member succeeded: merged PRs score 2, the unmerged pr-2 scores 1. */
const fullReport = { scores: [['pr-1', 2], ['pr-2', 1], ['pr-3', 2]] };

describe('durable-quota-deferral (A-11, A-12, RUN-011)', () => {
  test('exit mode reports "waiting until T"; a process before T admits nothing; a process 3 hours later retries under the same operation identity', () => {
    const s = freshScenario(baseWorld({ script: { 'pr-2': [{ kind: 'rate-limit', retryMs: 3 * hour }] } }));
    const first = clean(s.run({ kind: 'fold' }, { deferral: 'exit', window: 1, permits: 1 }));
    const [refused] = s.ledger().filter((entry) => entry.kind === 'received' && entry.key === 'pr-2');
    if (refused === undefined) {
      throw new Error('pr-2 was never sent');
    }
    const T = refused.at + 3 * hour;
    // Only pr-2 waits; its siblings finish, and pr-3 was sent after pr-2's refusal.
    expect(statuses(first)).toEqual({ 'pr-1': 'succeeded', 'pr-2': 'pending', 'pr-3': 'succeeded' });
    expect(first.result.members['pr-2']?.blocked).toEqual({ kind: 'deferred', operation: refused.operation, notBefore: T });
    expect(s.keys('received')).toEqual(['pr-1', 'pr-2', 'pr-3']);
    expect(first.result.fold).toEqual({ status: 'waiting', pending: ['pr-2'] });
    expect(first.result.waitingUntil).toBe(T);
    expect(first.events.filter((event) => event['kind'] === 'wait').map((event) => [event['phase'], event['until']])).toEqual([['exiting', T]]);
    expect(first.operations).toContain('retry-scheduled:deferred:rate-limited@pr-2');
    expect(usageOf(first.result.usage)).toEqual({ status: 'complete', observed: [{ unit: 'requests', amount: 1 }, { unit: 'tokens', amount: 200 }], unknown: 0, operations: 3, reports: 3, requestAttempts: 3 });

    // Before T: nothing of pr-2 is admitted, so it is refused before any claim (no new attempt), no body runs, nothing
    // is sent, and the same T is reported (A-19: misses refused before claims).
    const attemptsBefore = s.attempts(assessmentSubject('pr-2'));
    const early = clean(s.run({ kind: 'fold' }, { deferral: 'exit', window: 1, permits: 1 }));
    expect(s.attempts(assessmentSubject('pr-2'))).toEqual(attemptsBefore);
    expect(early.assessed).toEqual([]);
    expect(s.keys('received')).toEqual(['pr-1', 'pr-2', 'pr-3']);
    expect(statuses(early)).toEqual({ 'pr-1': 'succeeded', 'pr-2': 'pending', 'pr-3': 'succeeded' });
    expect(early.result.members['pr-1']).toEqual({ status: 'succeeded', kind: 'reused', reference: first.result.members['pr-1']?.reference });
    expect(early.result.members['pr-2']?.blocked).toEqual({ kind: 'deferred', operation: refused.operation, notBefore: T });
    expect(early.operations).toContain('blocked:deferred:not-before@pr-2');
    expect(early.result.waitingUntil).toBe(T);

    // Three hours and a minute later: pr-2 is retried under the same operation, with a new request attempt, no earlier than T.
    const later = clean(s.run({ kind: 'fold' }, { deferral: 'exit', window: 1, permits: 1, clockOffsetMs: 3 * hour + 60_000 }));
    expect(later.assessed).toEqual(['pr-2']);
    const sends = s.ledger().filter((entry) => entry.kind === 'received' && entry.key === 'pr-2');
    expect(sends).toHaveLength(2);
    expect(sends[1]?.operation).toBe(refused.operation);
    expect(sends[1]?.requestAttempt).not.toBe(refused.requestAttempt);
    expect(sends[1]?.at).toBeGreaterThanOrEqual(T);
    expect(later.operations).toContain('retry-started@pr-2');
    expect(statuses(later)).toEqual({ 'pr-1': 'succeeded', 'pr-2': 'succeeded', 'pr-3': 'succeeded' });
    expect(later.result.fold).toMatchObject({ status: 'succeeded', kind: 'published' });
    expect(later.result.report).toEqual(fullReport);
    expect(later.result.waitingUntil).toBeNull();
    // Three answers (300 tokens) and the one refusal (1 request), each report counted once.
    expect(usageOf(later.result.usage)).toEqual({ status: 'complete', observed: [{ unit: 'requests', amount: 1 }, { unit: 'tokens', amount: 300 }], unknown: 0, operations: 3, reports: 4, requestAttempts: 4 });
    // Every process ran under its own run identity, and the journal attributes each request attempt to its sender.
    expect(new Set([first.result.runId, early.result.runId, later.result.runId]).size).toBe(3);
    const pr2 = later.result.operations.find((view) => view.operation === refused.operation);
    expect(pr2?.attempts.map((attempt) => [attempt.run, attempt.status])).toEqual([[first.result.runId, 'rate-limited'], [later.result.runId, 'succeeded']]);
    expect(s.publications(assessmentSubject('pr-2'))).toHaveLength(1);
  });

  test('sleep mode releases the writer lease while it waits, lets a sibling finish meanwhile, and resumes under the same identity at T', async () => {
    const delay = 1_500;
    const s = freshScenario(baseWorld({ script: { 'pr-2': [{ kind: 'rate-limit', retryMs: delay }] } }));
    const started = s.start({ kind: 'fold' }, { deferral: 'sleep', window: 1, permits: 1 });
    await started.waitForLine((line) => line['t'] === 'event' && line['kind'] === 'wait' && line['phase'] === 'sleeping', 'the run sleeps');
    // While the run sleeps, the store's writer lease is free for any other process.
    expect(s.writer().holder).toBeNull();
    const run = clean(await started.exited);
    const sends = s.ledger().filter((entry) => entry.kind === 'received' && entry.key === 'pr-2');
    const [refusal, retry] = sends;
    if (refusal === undefined || retry === undefined) {
      throw new Error(`pr-2 was not retried: ${JSON.stringify(sends)}`);
    }
    const T = refusal.at + delay;
    expect(run.events.filter((event) => event['kind'] === 'wait').map((event) => [event['phase'], event['until']])).toEqual([['sleeping', T], ['resumed', T]]);
    expect(run.events.find((event) => event['kind'] === 'wait' && event['phase'] === 'sleeping')?.['released']).toBe(true);
    // pr-3 was sent while pr-2 waited: the deferral held neither the one permit nor the one lane.
    expect(s.keys('received')).toEqual(['pr-1', 'pr-2', 'pr-3', 'pr-2']);
    const pr3 = s.ledger().find((entry) => entry.kind === 'received' && entry.key === 'pr-3');
    expect(pr3?.at).toBeLessThan(T);
    expect(retry.operation).toBe(refusal.operation);
    expect(retry.at).toBeGreaterThanOrEqual(T);
    expect(statuses(run)).toEqual({ 'pr-1': 'succeeded', 'pr-2': 'succeeded', 'pr-3': 'succeeded' });
    expect(run.result.report).toEqual(fullReport);
    expect(run.result.waitingUntil).toBeNull();
  });

  test('a transient failure\'s backoff is a timed wait holding neither the one permit nor the one lane: its siblings are sent meanwhile', () => {
    const backoff = 1_000;
    const s = freshScenario(baseWorld({ script: { 'pr-1': [{ kind: 'transient' }, { kind: 'ok' }] }, declarations: { 'pr-1': { maxAttempts: 2, backoffMilliseconds: backoff } } }));
    const run = clean(s.run({ kind: 'members' }, { window: 1, permits: 1 }));
    const [failure, retry] = s.ledger().filter((entry) => entry.kind === 'received' && entry.key === 'pr-1');
    if (failure === undefined || retry === undefined) {
      throw new Error('pr-1 was not retried');
    }
    // pr-2 and pr-3 were sent while pr-1 waited out its backoff; the retry kept pr-1's operation identity.
    expect(s.keys('received')).toEqual(['pr-1', 'pr-2', 'pr-3', 'pr-1']);
    expect(retry.operation).toBe(failure.operation);
    expect(retry.at).toBeGreaterThanOrEqual(failure.at + backoff);
    expect(run.operations).toContain('retry-scheduled:deferred:transient@pr-1');
    expect(statuses(run)).toEqual({ 'pr-1': 'succeeded', 'pr-2': 'succeeded', 'pr-3': 'succeeded' });
  });

  // Observed defect, kept failing on purpose: the `resumed` wait event reports `released: false` for a wait whose lease
  // the run did release (its `sleeping` event says true, and a `stopped` event for the same wait would say true).
  // IWaitEvent.released is documented as "whether the run released its writer lease for the wait". The durable
  // release itself is proven above through the writer row. Remove `.failing` once the event reports the wait's value.
  test.failing('DEFECT (event content): the resumed wait event reports whether the run released its lease for that wait', () => {
    const s = freshScenario(baseWorld({ script: { 'pr-2': [{ kind: 'rate-limit', retryMs: 300 }] } }));
    const run = clean(s.run({ kind: 'members' }, { deferral: 'sleep', window: 1, permits: 1 }));
    expect(run.events.filter((event) => event['kind'] === 'wait').map((event) => [event['phase'], event['released']])).toEqual([['sleeping', true], ['resumed', true]]);
  });
});
