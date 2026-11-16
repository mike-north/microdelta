/**
 * External operations on the real packages: intent before send, usage counted
 * once through Accounting, the retry policy and the durable "not before T"
 * deferral in sleep and exit modes (RUN-011, RUN-012, RUN-013, ACC-003,
 * ACC-005, ACC-007; EXP-8 mechanisms 3, 4 and 6).
 *
 * Every expected value is written by hand from the owner decisions of
 * 2026-09-30 and the EXP-8 decision:
 *
 * - an "operation started" record and Accounting's usage intent are durable
 *   before each paid call, and usage is acknowledged keyed by (operation,
 *   report), so it is counted exactly once; a missing report is unknown,
 *   never zero;
 * - rate and quota responses with a retry time are deferred durably, with
 *   the provider's time as a lower bound. Classified retries share the
 *   finite total-send allowance, three by default; a legacy rate-only cap
 *   may restrict it further. Timed waits hold no permit or window lane;
 * - a deferral holds no permit and no lane, so siblings finish; once only
 *   deferred work remains the run releases the writer lease and either
 *   sleeps until T and resumes, or exits reporting "waiting until T"; later
 *   runs admit nothing before T and retry under the same operation identity.
 *   A known exhausted operation blocks its own invocation immediately even
 *   when a later provider floor remains binding for a future invocation.
 *
 * @see ../../../../docs/spec/operations.md (RUN-011, RUN-012, RUN-013, ACC-003, ACC-005, ACC-007 owner decisions)
 * @see ../../../../docs/spec/acceptance.md (A-11, A-12, A-14)
 * @see ../../../../experiments/exp-8/decision.md (mechanisms 3, 4, 6; resolutions 1, 6, 8)
 * @see ../../../../docs/plans/m5-operations.md (planned evidence `durable-quota-deferral`, `usage-exactly-once`)
 */
import { afterEach, beforeEach, describe, expect, test } from '@jest/globals';
import { SupervisionError, createStopController } from '@microdelta/supervision';
import type { IRetryDecisionInput, ISourceRetryPolicy } from '@microdelta/supervision';

import { assessmentSubject, createWorld, installWorld } from './fixture.js';
import type { IWorld } from './fixture.js';
import { T0, fakeTimer, freshKey, hour, openSession, operationTrace, statuses, tempStores, until } from './harness.js';
import type { IFakeTimer, IOperationStores } from './harness.js';
import { applied, driveUntilSettled, failureCode, inspect, journalContents, memberOf, members, received } from './support.js';

let stores: IOperationStores;
let timer: IFakeTimer;
let world: IWorld;

beforeEach(() => {
  stores = tempStores();
  timer = fakeTimer();
  world = installWorld(createWorld(() => timer.currentEpochMilliseconds()));
});

afterEach(() => {
  stores.remove();
});

describe('intent before send and usage exactly once (ACC-003, ACC-005, ACC-007)', () => {
  test('the operation record and usage intent are durable before the provider receives the request, and usage is counted once', async () => {
    world.provider.script('assess', 'pr-1', ['hang']);
    const session = openSession(stores, timer);
    try {
      const started = members(session, { permits: 3, runId: 'run:intent' });
      await until(() => received('pr-1').length === 1 && world.provider.inFlight === 1, 'pr-1 is in flight at the provider');
      const [request] = received('pr-1');
      // The journal already holds the operation as pending, naming its in-flight request attempt.
      expect(journalContents(session)).toContainEqual(expect.objectContaining({
        operation: request?.operation,
        member: 'pr-1',
        name: 'assess',
        status: 'pending',
        attempts: [expect.objectContaining({ requestAttempt: request?.requestAttempt, run: 'run:intent', status: 'pending' })],
      }));
      // Accounting already expects usage from it: unknown, never zero.
      const during = session.usage();
      expect(during.status).toBe('incomplete');
      expect(during.unknown).toContainEqual({ operation: request?.operation, requestAttempt: request?.requestAttempt, attribution: { run: 'run:intent', member: 'pr-1', stepAttempt: expect.any(String) } });
      world.provider.release('assess', 'pr-1');
      const result = await started.done;
      expect(statuses(result.value.members)).toEqual({ 'pr-1': 'succeeded', 'pr-2': 'succeeded', 'pr-3': 'succeeded' });
      // Each of the three requests reported 100 tokens once.
      expect(session.usage()).toEqual(expect.objectContaining({ status: 'complete', observed: [{ unit: 'tokens', amount: 300 }], operations: 3, requestAttempts: 3, reports: 3, unknown: [] }));
      // Intent before send, usage before outcome.
      expect(operationTrace(started.events).filter((line) => line.startsWith('assess@pr-1'))).toEqual([
        'assess@pr-1:request-started:pending',
        'assess@pr-1:usage-acknowledged',
        'assess@pr-1:request-settled:succeeded',
      ]);
    } finally {
      session.close();
    }
  });

  test('a later run reuses the succeeded members without another send or another usage report', async () => {
    const first = openSession(stores, timer);
    try {
      await members(first).done;
    } finally {
      first.close();
    }
    const second = openSession(stores, timer);
    try {
      const result = await members(second).done;
      expect(statuses(result.value.members)).toEqual({ 'pr-1': 'succeeded', 'pr-2': 'succeeded', 'pr-3': 'succeeded' });
      expect(world.provider.ledger().filter((entry) => entry.kind === 'received')).toHaveLength(3);
      expect(second.usage()).toEqual(expect.objectContaining({ status: 'complete', observed: [{ unit: 'tokens', amount: 300 }], reports: 3 }));
    } finally {
      second.close();
    }
  });

  test('a response without a usage report leaves that request attempt unknown, never zero', async () => {
    world.provider.script('assess', 'pr-2', ['ok-no-usage']);
    const session = openSession(stores, timer);
    try {
      const result = await members(session).done;
      expect(statuses(result.value.members)).toEqual({ 'pr-1': 'succeeded', 'pr-2': 'succeeded', 'pr-3': 'succeeded' });
      const [request] = received('pr-2');
      const usage = session.usage();
      expect(usage.status).toBe('incomplete');
      expect(usage.observed).toEqual([{ unit: 'tokens', amount: 200 }]);
      expect(usage.unknown.map((entry) => [entry.operation, entry.requestAttempt])).toEqual([[request?.operation, request?.requestAttempt]]);
    } finally {
      session.close();
    }
  });
});

describe('the finite acquisition retry policy (RUN-011)', () => {
  test('a transient refusal uses the built-in delayed retry without an author policy', async () => {
    world.provider.script('assess', 'pr-1', ['transient', 'ok']);
    const session = openSession(stores, timer);
    try {
      const result = await driveUntilSettled(timer, members(session));
      const pr1 = memberOf(result.value, 'pr-1');
      expect(pr1.status).toBe('succeeded');
      expect(received('pr-1')).toHaveLength(2);
      expect(journalContents(session)).toContainEqual(expect.objectContaining({ member: 'pr-1', status: 'succeeded' }));
      // The refusal's own usage report is still counted.
      expect(session.usage().observed).toEqual([{ unit: 'requests', amount: 1 }, { unit: 'tokens', amount: 300 }]);
    } finally {
      session.close();
    }
  });

  test('under an author policy a transient failure retries after a backoff that holds no permit and no lane, under the same operation identity', async () => {
    world.provider.script('assess', 'pr-1', ['transient', 'transient', 'ok']);
    world.options['pr-1'] = { retry: { maxAttempts: 3, backoffMilliseconds: 60_000 } };
    const session = openSession(stores, timer);
    try {
      const started = members(session, { permits: 1, window: 1 });
      await until(() => timer.pending().includes(T0 + 60_000), 'pr-1 waits for its first backoff');
      // With one permit and one lane, both siblings finish while pr-1 waits.
      await until(() => received('pr-2').length === 1 && received('pr-3').length === 1, 'the siblings are sent during the backoff');
      const result = await driveUntilSettled(timer, started);
      expect(statuses(result.value.members)).toEqual({ 'pr-1': 'succeeded', 'pr-2': 'succeeded', 'pr-3': 'succeeded' });
      const requests = received('pr-1');
      expect(requests).toHaveLength(3);
      expect(new Set(requests.map((request) => request.operation)).size).toBe(1);
      expect(new Set(requests.map((request) => request.requestAttempt)).size).toBe(3);
      expect(operationTrace(started.events).filter((line) => line.startsWith('assess@pr-1') && line.includes('retry'))).toEqual([
        'assess@pr-1:retry-scheduled:deferred:transient',
        'assess@pr-1:retry-started',
        'assess@pr-1:retry-scheduled:deferred:transient',
        'assess@pr-1:retry-started',
      ]);
    } finally {
      session.close();
    }
  });

  test('a transient refusal exhausts only this run and leaves its required input pending', async () => {
    world.provider.script('assess', 'pr-1', ['transient', 'transient', 'ok']);
    world.options['pr-1'] = { retry: { maxAttempts: 2 } };
    const session = openSession(stores, timer);
    try {
      const started = members(session);
      const result = await driveUntilSettled(timer, started);
      const pr1 = memberOf(result.value, 'pr-1');
      expect(pr1.status).toBe('pending');
      const operation = received('pr-1')[0]?.operation;
      expect(pr1.status === 'pending' ? pr1.blocked : undefined).toEqual({ kind: 'policy-exhausted', operation });
      expect(received('pr-1')).toHaveLength(2);
      expect(operationTrace(started.events)).toContain('assess@pr-1:retry-exhausted:retry-exhausted:policy-exhausted');
      expect(journalContents(session)).toContainEqual(expect.objectContaining({ operation, status: 'retry-exhausted' }));
      const [view] = await inspect(session);
      expect(view).toEqual(expect.objectContaining({ operation, status: 'retry-exhausted' }));
      expect(view?.attempts.map((attempt) => attempt.status)).toEqual(['failed', 'failed']);
      expect(session.usage().reports).toBe(4);
    } finally {
      session.close();
    }
  });

  test('the old default rate-only cap cannot raise the three-total-attempt default', async () => {
    world.provider.script('assess', 'pr-1', ['rate-limit:60000', 'rate-limit:60000', 'rate-limit:60000', 'rate-limit:60000', 'rate-limit:60000', 'rate-limit:60000', 'ok']);
    const session = openSession(stores, timer);
    try {
      const started = members(session);
      const result = await driveUntilSettled(timer, started);
      const pr1 = memberOf(result.value, 'pr-1');
      // The third sent refusal exhausts the total ceiling despite the legacy rate subcap of five retries.
      expect(received('pr-1')).toHaveLength(3);
      expect(new Set(received('pr-1').map((request) => request.operation)).size).toBe(1);
      expect(pr1.status).toBe('pending');
      const operation = received('pr-1')[0]?.operation;
      expect(pr1.status === 'pending' ? pr1.blocked : undefined).toEqual({ kind: 'policy-exhausted', operation });
      expect(operationTrace(started.events)).toContain('assess@pr-1:retry-exhausted:retry-exhausted:policy-exhausted');
      expect(journalContents(session)).toContainEqual(expect.objectContaining({ operation, status: 'retry-exhausted', notBefore: T0 + 180_000 }));
      expect((await inspect(session))[0]).toEqual(expect.objectContaining({ operation, status: 'retry-exhausted', notBefore: T0 + 180_000 }));
    } finally {
      session.close();
    }
  });

  test('the author may override the rate-limit retry cap', async () => {
    world.provider.script('assess', 'pr-1', ['rate-limit:60000', 'rate-limit:60000', 'ok']);
    world.options['pr-1'] = { retry: { rateLimitRetries: 1 } };
    const session = openSession(stores, timer);
    try {
      const result = await driveUntilSettled(timer, members(session));
      expect(received('pr-1')).toHaveLength(2);
      const pr1 = memberOf(result.value, 'pr-1');
      expect(pr1.status).toBe('pending');
      expect(pr1.status === 'pending' ? pr1.blocked?.kind : undefined).toBe('policy-exhausted');
    } finally {
      session.close();
    }
  });

  test('the rate-only subcap applies to untimed normalized rate refusals', async () => {
    world.provider.script('assess', 'pr-1', ['rate-limit', 'rate-limit', 'rate-limit', 'ok']);
    world.options['pr-1'] = { retry: { maxAttempts: 5, rateLimitRetries: 1 } };
    const session = openSession(stores, timer);
    try {
      const result = await driveUntilSettled(timer, members(session));
      expect(received('pr-1')).toHaveLength(2);
      const pr1 = memberOf(result.value, 'pr-1');
      expect(pr1.status).toBe('pending');
      expect(pr1.status === 'pending' ? pr1.blocked?.kind : undefined).toBe('policy-exhausted');
      expect(session.usage().reports).toBeGreaterThanOrEqual(2);
    } finally {
      session.close();
    }
  });

  test('an exact source policy can retry a contextual 404 before the conservative default stop', async () => {
    world.provider.script('assess', 'pr-1', ['contextual-404', 'ok']);
    const source = { source: 'catalog', service: 'catalog-api', connection: 'org-a-read' } as const;
    world.options['pr-1'] = { retrySource: source };
    const observed: IRetryDecisionInput[] = [];
    const policy: ISourceRetryPolicy = {
      id: 'catalog-policy',
      scope: source,
      decide(input) {
        observed.push(input);
        return { kind: 'retry-after', delayMilliseconds: 5_000 };
      },
    };
    const session = openSession(stores, timer);
    try {
      const started = members(session, { retryPolicies: [policy] });
      let settled = false;
      void started.done.then(() => { settled = true; }, () => { settled = true; });
      await until(() => timer.pending().includes(T0 + 5_000) || settled, 'the source decision schedules its delay or the member settles');
      expect(observed).toHaveLength(1);
      expect(observed[0]?.facts).toEqual({ httpStatus: 404, conditions: ['resource-expected-later'] });
      expect(observed[0]?.outcome).toEqual({ kind: 'failed', transient: false });
      const result = await driveUntilSettled(timer, started);
      expect(memberOf(result.value, 'pr-1').status).toBe('succeeded');
      expect(received('pr-1')).toHaveLength(2);
      expect(new Set(received('pr-1').map((request) => request.operation)).size).toBe(1);
    } finally {
      session.close();
    }
  });

  test('current-run exhaustion is visible before a provider floor; a new run waits at that floor then resumes the same acquisition', async () => {
    world.options['pr-1'] = { retry: { maxAttempts: 1 } };
    world.provider.script('assess', 'pr-1', ['rate-limit:60000', 'ok']);
    const session = openSession(stores, timer);
    try {
      const first = await members(session).done;
      const firstRequest = received('pr-1')[0];
      expect(firstRequest).toBeDefined();
      expect(received('pr-1')).toHaveLength(1);
      expect(memberOf(first.value, 'pr-1').status).toBe('pending');
      expect(journalContents(session)).toContainEqual(expect.objectContaining({
        operation: firstRequest?.operation,
        status: 'retry-exhausted',
        notBefore: T0 + 60_000,
        attempts: [expect.objectContaining({ status: 'rate-limited' })],
      }));

      const beforeFloor = await members(session, { deferral: 'exit' }).done;
      expect(beforeFloor.waitingUntil).toBe(T0 + 60_000);
      expect(memberOf(beforeFloor.value, 'pr-1').status).toBe('pending');
      const beforeFloorMember = memberOf(beforeFloor.value, 'pr-1');
      expect(beforeFloorMember.status === 'pending' ? beforeFloorMember.blocked?.kind : undefined).toBe('deferred');
      expect(received('pr-1')).toHaveLength(1);

      timer.advanceTo(T0 + 60_000);
      const afterFloor = await members(session).done;
      expect(memberOf(afterFloor.value, 'pr-1').status).toBe('succeeded');
      const requests = received('pr-1');
      expect(requests).toHaveLength(2);
      expect(requests[1]?.operation).toBe(firstRequest?.operation);
      expect(requests[1]?.requestAttempt).not.toBe(firstRequest?.requestAttempt);
      expect(session.usage().reports).toBe(4);
    } finally {
      session.close();
    }
  });

  test('a caught exhaustion cannot replenish sends in the same step attempt', async () => {
    world.options['pr-1'] = { retry: { maxAttempts: 1, backoffMilliseconds: 0 } };
    world.plans['pr-1'] = 'catch-retry';
    world.provider.script('assess', 'pr-1', ['transient', 'ok', 'ok']);
    const session = openSession(stores, timer);
    try {
      const result = await members(session).done;
      expect(received('pr-1')).toHaveLength(1);
      expect(applied('pr-1')).toHaveLength(0);
      expect(world.log).toEqual(['caught:pr-1:operation-exhausted', 'caught:pr-1:operation-exhausted', 'caught:pr-1:operation-exhausted']);
      expect(memberOf(result.value, 'pr-1').status).toBe('pending');
    } finally {
      session.close();
    }
  });

  test('a later sleep-mode pass in the same run cannot replenish an exhausted member while a sibling waits', async () => {
    world.options['pr-1'] = { retry: { maxAttempts: 1 } };
    world.provider.script('assess', 'pr-1', ['transient', 'ok']);
    world.provider.script('assess', 'pr-2', ['rate-limit:60000', 'ok']);
    const session = openSession(stores, timer);
    try {
      const result = await driveUntilSettled(timer, members(session, { deferral: 'sleep', runId: 'run:one-pass-owner' }));
      expect(received('pr-1')).toHaveLength(1);
      expect(memberOf(result.value, 'pr-1').status).toBe('pending');
      expect(memberOf(result.value, 'pr-2').status).toBe('succeeded');
      expect(received('pr-2')).toHaveLength(2);
      expect(new Set(received('pr-1').map((request) => request.operation)).size).toBe(1);
      expect(session.usage().reports).toBe(4);
    } finally {
      session.close();
    }
  });

  test('an exhausted member does not hold a completed sibling behind its provider floor', async () => {
    world.options['pr-1'] = { retry: { maxAttempts: 1 } };
    world.options['pr-2'] = { retry: { backoffMilliseconds: 0 } };
    world.provider.script('assess', 'pr-1', ['rate-limit:60000', 'ok']);
    world.provider.script('assess', 'pr-2', ['rate-limit:1000', 'ok']);
    const session = openSession(stores, timer);
    try {
      const started = members(session, { deferral: 'sleep', runId: 'run:mixed-exhaustion-floor' });
      await until(() => timer.pending().includes(T0 + 1_000), 'the sibling provider floor');
      timer.advanceTo(T0 + 1_000);
      let done = false;
      void started.done.then(() => { done = true; }, () => { done = true; });
      await until(() => done || timer.pending().includes(T0 + 60_000), 'the run completes or incorrectly waits for the exhausted floor');

      expect(done).toBe(true);
      const result = await started.done;
      expect(memberOf(result.value, 'pr-1')).toEqual(expect.objectContaining({
        status: 'pending',
        blocked: expect.objectContaining({ kind: 'policy-exhausted' }),
      }));
      expect(memberOf(result.value, 'pr-2').status).toBe('succeeded');
      expect(received('pr-1')).toHaveLength(1);
      expect(received('pr-2')).toHaveLength(2);
      expect(timer.pending()).not.toContain(T0 + 60_000);

      expect(session.usage().reports).toBe(4);
    } finally {
      session.close();
    }
  });
});

describe('the durable "not before T" deferral (RUN-011, EXP-8 mechanism 3)', () => {
  const T = T0 + 3 * hour;

  test('exit mode: a quota response defers only that member, siblings finish holding no permit or lane, and the run reports waiting until T', async () => {
    world.provider.script('assess', 'pr-1', ['rate-limit:10800000']);
    const session = openSession(stores, timer);
    try {
      const started = session.start({ deferral: 'exit', permits: 1, window: 1 }, (run) => run.resolveFold(session.fixture.report, freshKey()));
      const result = await started.done;
      expect(statuses(result.value.members)).toEqual({ 'pr-1': 'pending', 'pr-2': 'succeeded', 'pr-3': 'succeeded' });
      const pr1 = memberOf(result.value, 'pr-1');
      const [request] = received('pr-1');
      expect(pr1.status === 'pending' ? pr1.blocked : undefined).toEqual({ kind: 'deferred', operation: request?.operation, notBefore: T });
      // The strict fold waits on the deferred member; it never fails or publishes.
      expect(result.value.outcome).toEqual({ status: 'waiting', pending: ['pr-1'], openDiscovery: false });
      expect(result.waitingUntil).toBe(T);
      expect(journalContents(session)).toContainEqual(expect.objectContaining({ member: 'pr-1', status: 'deferred', notBefore: T }));
      expect(received('pr-1')).toHaveLength(1);
      expect(started.events.filter((event) => event.kind === 'wait')).toEqual([{ kind: 'wait', runId: result.context.runId, phase: 'exiting', until: T, released: true }]);
      // The run released the writer lease.
      expect(session.history.currentWriter()).toBeUndefined();
    } finally {
      session.close();
    }
  });

  test('a later run before T admits nothing and sends nothing; after T it retries under the same operation identity', async () => {
    world.provider.script('assess', 'pr-1', ['rate-limit:10800000']);
    const a = openSession(stores, timer);
    let operation: string | undefined;
    try {
      await members(a, { deferral: 'exit', runId: 'run:A' }).done;
      operation = received('pr-1')[0]?.operation;
    } finally {
      a.close();
    }
    timer.advanceTo(T0 + hour);
    const b = openSession(stores, timer);
    try {
      const started = members(b, { deferral: 'exit', runId: 'run:B' });
      const result = await started.done;
      expect(statuses(result.value.members)).toEqual({ 'pr-1': 'pending', 'pr-2': 'succeeded', 'pr-3': 'succeeded' });
      expect(result.waitingUntil).toBe(T);
      expect(received('pr-1')).toHaveLength(1);
      expect(operationTrace(started.events)).toEqual(['assess@pr-1:blocked:deferred:not-before']);
    } finally {
      b.close();
    }
    timer.advanceTo(T + 60_000);
    const c = openSession(stores, timer);
    try {
      const started = members(c, { deferral: 'exit', runId: 'run:C' });
      const result = await started.done;
      expect(statuses(result.value.members)).toEqual({ 'pr-1': 'succeeded', 'pr-2': 'succeeded', 'pr-3': 'succeeded' });
      expect(result.waitingUntil).toBeUndefined();
      const requests = received('pr-1');
      expect(requests).toHaveLength(2);
      expect(requests[1]?.operation).toBe(operation);
      expect(requests[1]?.requestAttempt).not.toBe(requests[0]?.requestAttempt);
      expect(operationTrace(started.events)).toEqual([
        'assess@pr-1:retry-started',
        'assess@pr-1:request-started:pending',
        'assess@pr-1:usage-acknowledged',
        'assess@pr-1:request-settled:succeeded',
      ]);
    } finally {
      c.close();
    }
  });

  test('sleep mode releases the writer lease once only deferred work remains, lets another holder take it, and resumes at T under the same identity', async () => {
    world.provider.script('assess', 'pr-1', ['rate-limit:10800000']);
    const session = openSession(stores, timer);
    try {
      const started = members(session, { permits: 1 });
      await until(() => started.events.some((event) => event.kind === 'wait' && event.phase === 'sleeping'), 'the run sleeps');
      expect(started.events.filter((event) => event.kind === 'wait')).toEqual([{ kind: 'wait', runId: expect.any(String), phase: 'sleeping', until: T, released: true }]);
      expect(timer.pending()).toEqual([T]);
      // Nothing is in flight and the lease is free: another holder can acquire it and let it go.
      expect(world.provider.inFlight).toBe(0);
      const probe = session.history.acquireWriter({ holder: 'probe', leaseMilliseconds: 1_000 });
      expect(probe.kind).toBe('acquired');
      if (probe.kind === 'acquired') {
        session.history.releaseWriter(probe.lease);
      }
      timer.advanceTo(T);
      const result = await started.done;
      expect(statuses(result.value.members)).toEqual({ 'pr-1': 'succeeded', 'pr-2': 'succeeded', 'pr-3': 'succeeded' });
      expect(result.waitingUntil).toBeUndefined();
      const requests = received('pr-1');
      expect(requests.map((request) => request.operation)).toEqual([requests[0]?.operation, requests[0]?.operation]);
      expect(started.events.filter((event) => event.kind === 'wait').map((event) => event.kind === 'wait' ? event.phase : '')).toEqual(['sleeping', 'resumed']);
    } finally {
      session.close();
    }
  });

  test('a resumed pass re-presents only the deferred work: a member that failed in the first pass keeps its failure and is not sent again', async () => {
    world.provider.script('assess', 'pr-1', ['rate-limit:10800000', 'ok']);
    world.provider.script('assess', 'pr-2', ['permanent', 'ok']);
    const session = openSession(stores, timer);
    try {
      const started = members(session);
      await until(() => timer.pending().includes(T), 'the run sleeps until T');
      timer.advanceTo(T);
      const result = await started.done;
      expect(statuses(result.value.members)).toEqual({ 'pr-1': 'succeeded', 'pr-2': 'failed', 'pr-3': 'succeeded' });
      expect(failureCode(memberOf(result.value, 'pr-2'))).toBe('operation-failed');
      expect(received('pr-2')).toHaveLength(1);
      expect(received('pr-1')).toHaveLength(2);
    } finally {
      session.close();
    }
  });

  test('a stop during the sleep ends the wait at once, keeps the deferral durable and reports waiting until T', async () => {
    world.provider.script('assess', 'pr-1', ['rate-limit:10800000']);
    const session = openSession(stores, timer);
    try {
      const stop = createStopController();
      const started = members(session, { stop });
      await until(() => started.events.some((event) => event.kind === 'wait' && event.phase === 'sleeping'), 'the run sleeps');
      stop.request({ level: 'soft' });
      const result = await started.done;
      expect(result.waitingUntil).toBe(T);
      expect(statuses(result.value.members)).toEqual({ 'pr-1': 'pending', 'pr-2': 'succeeded', 'pr-3': 'succeeded' });
      expect(started.events.filter((event) => event.kind === 'wait').map((event) => event.kind === 'wait' ? event.phase : '')).toEqual(['sleeping', 'stopped']);
      expect(journalContents(session)).toContainEqual(expect.objectContaining({ member: 'pr-1', status: 'deferred', notBefore: T }));
      expect(received('pr-1')).toHaveLength(1);
    } finally {
      session.close();
    }
  });

  test('a run that restarts in sleep mode before T sleeps until T and then retries, sending nothing early', async () => {
    world.provider.script('assess', 'pr-1', ['rate-limit:10800000']);
    const a = openSession(stores, timer);
    try {
      await members(a, { deferral: 'exit' }).done;
    } finally {
      a.close();
    }
    timer.advanceTo(T0 + hour);
    const b = openSession(stores, timer);
    try {
      const started = members(b);
      await until(() => timer.pending().includes(T), 'the restarted run sleeps until T');
      expect(received('pr-1')).toHaveLength(1);
      timer.advanceTo(T);
      const result = await started.done;
      expect(statuses(result.value.members)).toEqual({ 'pr-1': 'succeeded', 'pr-2': 'succeeded', 'pr-3': 'succeeded' });
      expect(received('pr-1')).toHaveLength(2);
    } finally {
      b.close();
    }
  });
});

describe('declaring an operation', () => {
  test('a name that is not an identifier, an empty binding or a call outside an admitted step is refused before anything is recorded', async () => {
    const session = openSession(stores, timer);
    try {
      const outside = await session.start({}, async () => session.supervision.execution().operation({ name: 'assess', binding: 'b', perform: () => Promise.resolve({ kind: 'succeeded', value: 1 }) }).then(() => 'sent', (error: unknown) => error instanceof SupervisionError ? error.code : 'other')).done;
      expect(outside.value).toBe('invalid-request');
      world.options['pr-1'] = { retry: { maxAttempts: 0 } };
      const result = await members(session).done;
      expect(failureCode(memberOf(result.value, 'pr-1'))).toBe('invalid-request');
      expect(received('pr-1')).toHaveLength(0);
      expect(journalContents(session).filter((content) => typeof content === 'object' && content !== null && Reflect.get(content, 'member') === 'pr-1')).toEqual([]);
    } finally {
      session.close();
    }
  });

  test('a run without operation ports refuses an operation as an invalid request and sends nothing', async () => {
    const session = openSession(stores, timer);
    try {
      const result = await members(session, { operations: false }).done;
      expect(result.value.members.map((member) => failureCode(member))).toEqual(['invalid-request', 'invalid-request', 'invalid-request']);
      expect(world.provider.ledger()).toEqual([]);
    } finally {
      session.close();
    }
  });

  test('the subject of a member assessment is the operation owner an operator sees', async () => {
    world.options['pr-1'] = { retry: { maxAttempts: 1 } };
    world.provider.script('assess', 'pr-1', ['lost']);
    const session = openSession(stores, timer);
    try {
      await members(session).done;
      const views = await session.start({}, (run) => run.inspectOperations({ status: 'unknown' })).done;
      expect(views.value.map((view) => [view.subject.subject, view.subject.version, view.member, view.name])).toEqual([[assessmentSubject('pr-1'), 1, 'pr-1', 'assess']]);
    } finally {
      session.close();
    }
  });
});
