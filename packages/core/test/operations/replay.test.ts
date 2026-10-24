/**
 * Finite data-acquisition replay on the real packages (RUN-011/012, A-12).
 * An uncertain response remains evidence with unknown usage while a later
 * request attempt may acquire the required value within a run's allowance.
 *
 * The tests retain the durable safety controls from EXP-8:
 *
 * - an exhausted lost response remains **unknown**, leaving its member
 *   pending, never failed or succeeded, so a strict fold waits;
 * - once a step attempt meets an unknown outcome or a deferral, every further
 *   operation it makes rethrows that signal without sending (the taint
 *   guard), so a body that catches and retries by hand sends nothing more
 *   and a deferred call is never sent before its time;
 * - a classified retry reuses the operation identity; provider idempotency
 *   can deduplicate effects but does not grant retry allowance.
 *
 * @see ../../../../docs/spec/operations.md (RUN-010, RUN-012 owner decision)
 * @see ../../../../docs/spec/acceptance.md (A-11, A-12)
 * @see ../../../../experiments/exp-8/decision.md (mechanism 5, CX-6, CX-7, resolution 4)
 * @see ../../../../docs/plans/m5-operations.md (planned evidence `no-blind-replay`)
 */
import { afterEach, beforeEach, describe, expect, test } from '@jest/globals';

import { createWorld, installWorld } from './fixture.js';
import type { IWorld } from './fixture.js';
import { T0, fakeTimer, hour, openSession, operationTrace, statuses, tempStores, until } from './harness.js';
import type { IFakeTimer, IOperationStores } from './harness.js';
import { applied, fold, journalContents, memberOf, members, received } from './support.js';

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

describe('run-scoped acquisition retries (RUN-011, A-12a/c/i)', () => {
  test('a lost response retries without an effect-safety declaration under a finite override, preserving unknown usage', async () => {
    world.options['pr-1'] = { retry: { maxAttempts: 2, backoffMilliseconds: 0 } };
    world.provider.script('assess', 'pr-1', ['lost', 'ok']);
    const session = openSession(stores, timer);
    try {
      const result = await members(session).done;
      expect(memberOf(result.value, 'pr-1').status).toBe('succeeded');
      const requests = received('pr-1');
      expect(requests).toHaveLength(2);
      expect(requests[1]?.operation).toBe(requests[0]?.operation);
      expect(requests[1]?.requestAttempt).not.toBe(requests[0]?.requestAttempt);
      expect(applied('pr-1')).toHaveLength(2);
      expect(session.usage().unknown).toEqual([expect.objectContaining({ operation: requests[0]?.operation, requestAttempt: requests[0]?.requestAttempt })]);
      expect(journalContents(session)).toContainEqual(expect.objectContaining({ operation: requests[0]?.operation, status: 'succeeded' }));
    } finally {
      session.close();
    }
  });

  test('a rejected perform is also unknown and may retry without a safety declaration', async () => {
    world.options['pr-1'] = { retry: { maxAttempts: 2, backoffMilliseconds: 0 } };
    world.provider.script('assess', 'pr-1', ['lost-unapplied', 'ok']);
    const session = openSession(stores, timer);
    try {
      const result = await members(session).done;
      expect(memberOf(result.value, 'pr-1').status).toBe('succeeded');
      expect(received('pr-1')).toHaveLength(2);
      expect(applied('pr-1')).toHaveLength(1);
      expect(session.usage().unknown).toHaveLength(1);
    } finally {
      session.close();
    }
  });

  test('the omitted policy sends at most three attempts with an increasing default delay', async () => {
    world.provider.script('assess', 'pr-1', ['lost', 'lost', 'lost', 'ok']);
    const session = openSession(stores, timer);
    try {
      const started = members(session);
      await until(() => timer.pending().includes(T0 + 2_000), 'first default retry wait');
      expect(timer.pending()).toContain(T0 + 2_000);
      timer.advanceTo(T0 + 2_000);
      await until(() => timer.pending().some((at) => at > T0 + 2_000), 'second default retry wait');
      expect(timer.pending()).toContain(T0 + 6_000);
      timer.advanceTo(T0 + 6_000);
      const result = await started.done;
      expect(memberOf(result.value, 'pr-1').status).toBe('pending');
      expect(received('pr-1')).toHaveLength(3);
      expect(session.usage().unknown).toHaveLength(3);
    } finally {
      session.close();
    }
  });

  test('a new invocation with the same caller runId gets fresh allowance under the same operation address', async () => {
    world.options['pr-1'] = { retry: { maxAttempts: 2, backoffMilliseconds: 0 } };
    world.provider.script('assess', 'pr-1', ['lost', 'lost', 'ok']);
    const session = openSession(stores, timer);
    try {
      const first = await members(session, { runId: 'run:repeated' }).done;
      expect(memberOf(first.value, 'pr-1').status).toBe('pending');
      expect(received('pr-1')).toHaveLength(2);
      const second = await members(session, { runId: 'run:repeated' }).done;
      expect(memberOf(second.value, 'pr-1').status).toBe('succeeded');
      const requests = received('pr-1');
      expect(requests).toHaveLength(3);
      expect(new Set(requests.map((request) => request.operation)).size).toBe(1);
      expect(new Set(requests.map((request) => request.requestAttempt)).size).toBe(3);
      expect(session.usage().unknown).toHaveLength(2);
    } finally {
      session.close();
    }
  });

  test('a deferred pass and lease reacquisition in one run do not replenish the sent-attempt tally', async () => {
    world.options['pr-1'] = { retry: { maxAttempts: 2 } };
    world.provider.script('assess', 'pr-1', ['rate-limit:10000', 'lost', 'ok']);
    const session = openSession(stores, timer);
    try {
      const started = members(session, { runId: 'run:passes', deferral: 'sleep' });
      await until(() => timer.pending().includes(T0 + 10_000), 'provider not-before deferral');
      expect(received('pr-1')).toHaveLength(1);
      timer.advanceTo(T0 + 10_000);
      const result = await started.done;
      expect(memberOf(result.value, 'pr-1').status).toBe('pending');
      expect(received('pr-1')).toHaveLength(2);
      expect(new Set(received('pr-1').map((request) => request.operation)).size).toBe(1);
      expect(started.events).toContainEqual(expect.objectContaining({ kind: 'wait', phase: 'sleeping', released: true }));
      expect(started.events).toContainEqual(expect.objectContaining({ kind: 'wait', phase: 'resumed' }));
    } finally {
      session.close();
    }
  });

  test('a legacy rate-only cap cannot grant unknown-response attempts beyond the default total', async () => {
    world.options['pr-1'] = { retry: { rateLimitRetries: 1, backoffMilliseconds: 0 } };
    world.provider.script('assess', 'pr-1', ['lost', 'lost', 'lost', 'ok']);
    const session = openSession(stores, timer);
    try {
      const result = await members(session).done;
      expect(memberOf(result.value, 'pr-1').status).toBe('pending');
      expect(received('pr-1')).toHaveLength(3);
      expect(session.usage().unknown).toHaveLength(3);
    } finally {
      session.close();
    }
  });
});

describe('an exhausted lost response remains unsettled (RUN-011/012)', () => {
  test('the current run stops at its explicit cap; a new run can acquire the value with history intact', async () => {
    world.options['pr-1'] = { retry: { maxAttempts: 1 } };
    world.provider.script('assess', 'pr-1', ['lost', 'ok']);
    const a = openSession(stores, timer);
    let operation: string | undefined;
    try {
      const started = members(a);
      const result = await started.done;
      expect(statuses(result.value.members)).toEqual({ 'pr-1': 'pending', 'pr-2': 'succeeded', 'pr-3': 'succeeded' });
      operation = received('pr-1')[0]?.operation;
      const pr1 = memberOf(result.value, 'pr-1');
      expect(pr1.status === 'pending' ? pr1.blocked : undefined).toEqual({ kind: 'unknown-outcome', operation, reason: 'policy-exhausted' });
      expect(operationTrace(started.events).filter((line) => line.startsWith('assess@pr-1'))).toEqual([
        'assess@pr-1:request-started:pending',
        'assess@pr-1:request-settled:unknown:lost-response',
      ]);
      expect(journalContents(a)).toContainEqual(expect.objectContaining({ operation, status: 'unknown' }));
      // Its usage is unknown, never zero.
      expect(a.usage().unknown.map((entry) => entry.operation)).toEqual([operation]);
    } finally {
      a.close();
    }
    const b = openSession(stores, timer);
    try {
      const started = members(b);
      const result = await started.done;
      expect(statuses(result.value.members)).toEqual({ 'pr-1': 'succeeded', 'pr-2': 'succeeded', 'pr-3': 'succeeded' });
      expect(operationTrace(started.events)).toContain('assess@pr-1:retry-started');
      expect(received('pr-1')).toHaveLength(2);
      expect(applied('pr-1')).toHaveLength(2);
      expect(b.usage().unknown.map((entry) => entry.operation)).toEqual([operation]);
    } finally {
      b.close();
    }
  });

  test('keeps a capped unknown member pending and a strict fold waiting', async () => {
    world.options['pr-2'] = { retry: { maxAttempts: 1 } };
    world.provider.script('assess', 'pr-2', ['lost', 'lost']);
    const session = openSession(stores, timer);
    try {
      const result = await fold(session).done;
      expect(statuses(result.value.members)).toEqual({ 'pr-1': 'succeeded', 'pr-2': 'pending', 'pr-3': 'succeeded' });
      expect(result.value.outcome).toEqual({ status: 'waiting', pending: ['pr-2'], openDiscovery: false });
      // A separately invoked run has fresh allowance, but another lost response still leaves the strict fold waiting.
      const again = await fold(session).done;
      expect(again.value.outcome).toEqual({ status: 'waiting', pending: ['pr-2'], openDiscovery: false });
      expect(received('pr-2')).toHaveLength(2);
    } finally {
      session.close();
    }
  });

  test('a body that catches the unknown outcome and calls again sends it once (CX-6)', async () => {
    world.options['pr-1'] = { retry: { maxAttempts: 1 } };
    world.plans['pr-1'] = 'catch-retry';
    world.provider.script('assess', 'pr-1', ['lost', 'ok', 'ok']);
    const session = openSession(stores, timer);
    try {
      const result = await members(session).done;
      expect(received('pr-1')).toHaveLength(1);
      expect(applied('pr-1')).toHaveLength(1);
      expect(world.log).toEqual(['caught:pr-1:operation-unknown', 'caught:pr-1:operation-unknown', 'caught:pr-1:operation-unknown']);
      // The body returned a fallback, but the tainted attempt publishes nothing.
      expect(memberOf(result.value, 'pr-1').status).toBe('pending');
    } finally {
      session.close();
    }
  });

  test('a tainted attempt sends no further operation of any name', async () => {
    world.options['pr-1'] = { retry: { maxAttempts: 1 } };
    world.plans['pr-1'] = 'two-ops';
    world.provider.script('assess', 'pr-1', ['lost']);
    const session = openSession(stores, timer);
    try {
      const result = await members(session).done;
      expect(received('pr-1', 'polish')).toHaveLength(0);
      expect(world.log).toEqual(['caught:pr-1:operation-unknown', 'caught-polish:pr-1:operation-unknown']);
      expect(memberOf(result.value, 'pr-1').status).toBe('pending');
    } finally {
      session.close();
    }
  });

  test('a body that catches a deferral and calls again sends nothing before T and keeps the deferral (CX-7)', async () => {
    world.plans['pr-1'] = 'catch-retry';
    world.provider.script('assess', 'pr-1', ['rate-limit:10800000', 'ok', 'ok']);
    const session = openSession(stores, timer);
    try {
      const result = await members(session, { deferral: 'exit' }).done;
      expect(received('pr-1')).toHaveLength(1);
      expect(world.log).toEqual(['caught:pr-1:operation-deferred', 'caught:pr-1:operation-deferred', 'caught:pr-1:operation-deferred']);
      expect(memberOf(result.value, 'pr-1').status).toBe('pending');
      expect(result.waitingUntil).toBe(T0 + 3 * hour);
      expect(journalContents(session)).toContainEqual(expect.objectContaining({ member: 'pr-1', status: 'deferred', notBefore: T0 + 3 * hour }));
    } finally {
      session.close();
    }
  });
});

describe('a finite retry may also carry deduplication hints (RUN-011/012)', () => {
  test('an explicit finite policy reuses the operation identity, independent of the effect-safety hint', async () => {
    world.options['pr-1'] = { safeToRepeat: true, retry: { maxAttempts: 2, backoffMilliseconds: 0 } };
    world.provider.script('assess', 'pr-1', ['lost', 'ok']);
    const session = openSession(stores, timer);
    try {
      const started = members(session);
      const result = await started.done;
      expect(memberOf(result.value, 'pr-1').status).toBe('succeeded');
      const requests = received('pr-1');
      expect(requests).toHaveLength(2);
      expect(requests[1]?.operation).toBe(requests[0]?.operation);
      expect(requests[1]?.requestAttempt).not.toBe(requests[0]?.requestAttempt);
      expect(applied('pr-1')).toHaveLength(2);
      expect(operationTrace(started.events).filter((line) => line.startsWith('assess@pr-1'))).toEqual([
        'assess@pr-1:request-started:pending',
        'assess@pr-1:request-settled:unknown:lost-response',
        'assess@pr-1:retry-scheduled:unknown:lost-response',
        'assess@pr-1:retry-started',
        'assess@pr-1:request-started:pending',
        'assess@pr-1:usage-acknowledged',
        'assess@pr-1:request-settled:succeeded',
      ]);
    } finally {
      session.close();
    }
  });

  test('provider idempotency keys: the retry carries the same key and the provider applies the effect once', async () => {
    world.options['pr-1'] = { providerIdempotency: true, retry: { maxAttempts: 2, backoffMilliseconds: 0 } };
    world.provider.script('assess', 'pr-1', ['lost', 'ok']);
    const session = openSession(stores, timer);
    try {
      const result = await members(session).done;
      expect(memberOf(result.value, 'pr-1').status).toBe('succeeded');
      const requests = received('pr-1');
      expect(requests).toHaveLength(2);
      expect(requests.map((request) => request.idempotencyKey)).toEqual([requests[0]?.operation, requests[0]?.operation]);
      expect(applied('pr-1')).toHaveLength(1);
    } finally {
      session.close();
    }
  });

  test('a one-attempt override blocks retry even when the author supplied a safety hint', async () => {
    world.options['pr-1'] = { safeToRepeat: true, retry: { maxAttempts: 1 } };
    world.provider.script('assess', 'pr-1', ['lost', 'ok']);
    const session = openSession(stores, timer);
    try {
      const result = await members(session).done;
      const pr1 = memberOf(result.value, 'pr-1');
      expect(pr1.status === 'pending' ? pr1.blocked?.kind === 'unknown-outcome' && pr1.blocked.reason : undefined).toBe('policy-exhausted');
      expect(received('pr-1')).toHaveLength(1);
    } finally {
      session.close();
    }
  });

  test('a reopened session starts a fresh tally even when the earlier run spent its allowance', async () => {
    world.options['pr-1'] = { safeToRepeat: true, retry: { maxAttempts: 2, backoffMilliseconds: 0 } };
    world.provider.script('assess', 'pr-1', ['lost', 'lost', 'ok']);
    const a = openSession(stores, timer);
    try {
      const result = await members(a).done;
      // Both attempts the policy allows were spent in the first run.
      expect(memberOf(result.value, 'pr-1').status).toBe('pending');
      expect(received('pr-1')).toHaveLength(2);
    } finally {
      a.close();
    }
    const b = openSession(stores, timer);
    try {
      const result = await members(b).done;
      expect(memberOf(result.value, 'pr-1').status).toBe('succeeded');
      expect(received('pr-1')).toHaveLength(3);
      expect(b.usage().unknown).toHaveLength(2);
    } finally {
      b.close();
    }
  });
});
