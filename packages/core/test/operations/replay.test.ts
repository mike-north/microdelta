/**
 * No blind replay on the real packages (RUN-012, A-12; EXP-8 mechanism 5,
 * counterexamples CX-6 and CX-7, resolution 4), and the owner ruling that an
 * unknown operation counts as unsettled.
 *
 * Expected values come from the owner decision of 2026-09-30 and EXP-8:
 *
 * - a lost response on a call without provider idempotency is **unknown** and
 *   is never replayed, in this pass or later passes, until an operator
 *   settles it; its member stays pending, never failed or succeeded, so a
 *   strict fold over it waits;
 * - once a step attempt meets an unknown outcome or a deferral, every further
 *   operation it makes rethrows that signal without sending (the taint
 *   guard), so a body that catches and retries by hand sends nothing more
 *   and a deferred call is never sent before its time;
 * - retrying an unknown outcome needs a safety basis (the author's
 *   safe-to-repeat declaration, or provider idempotency keys) and an author
 *   policy allowing another attempt; it reuses the operation identity, and
 *   with idempotency keys the provider applies the effect once.
 *
 * @see ../../../../docs/spec/operations.md (RUN-010, RUN-012 owner decision)
 * @see ../../../../docs/spec/acceptance.md (A-11, A-12)
 * @see ../../../../experiments/exp-8/decision.md (mechanism 5, CX-6, CX-7, resolution 4)
 * @see ../../../../docs/plans/m5-operations.md (planned evidence `no-blind-replay`)
 */
import { afterEach, beforeEach, describe, expect, test } from '@jest/globals';

import { createWorld, installWorld } from './fixture.js';
import type { IWorld } from './fixture.js';
import { T0, fakeTimer, hour, openSession, operationTrace, statuses, tempStores } from './harness.js';
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

describe('a lost response without a safety basis (RUN-012)', () => {
  test('is unknown, is sent once, and is not replayed by this pass or a later one', async () => {
    world.provider.script('assess', 'pr-1', ['lost', 'ok']);
    const a = openSession(stores, timer);
    let operation: string | undefined;
    try {
      const started = members(a);
      const result = await started.done;
      expect(statuses(result.value.members)).toEqual({ 'pr-1': 'pending', 'pr-2': 'succeeded', 'pr-3': 'succeeded' });
      operation = received('pr-1')[0]?.operation;
      const pr1 = memberOf(result.value, 'pr-1');
      expect(pr1.status === 'pending' ? pr1.blocked : undefined).toEqual({ kind: 'unknown-outcome', operation, reason: 'not-repeat-safe' });
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
      expect(statuses(result.value.members)).toEqual({ 'pr-1': 'pending', 'pr-2': 'succeeded', 'pr-3': 'succeeded' });
      expect(operationTrace(started.events)).toEqual(['assess@pr-1:blocked:unknown:not-repeat-safe']);
      expect(received('pr-1')).toHaveLength(1);
      expect(applied('pr-1')).toHaveLength(1);
    } finally {
      b.close();
    }
  });

  test('keeps its member pending and a strict fold over it waiting, never failed or succeeded (owner ruling on #119)', async () => {
    world.provider.script('assess', 'pr-2', ['lost']);
    const session = openSession(stores, timer);
    try {
      const result = await fold(session).done;
      expect(statuses(result.value.members)).toEqual({ 'pr-1': 'succeeded', 'pr-2': 'pending', 'pr-3': 'succeeded' });
      expect(result.value.outcome).toEqual({ status: 'waiting', pending: ['pr-2'], openDiscovery: false });
      // A later pass still waits: the unknown operation stays unsettled until an operator settles it.
      const again = await fold(session).done;
      expect(again.value.outcome).toEqual({ status: 'waiting', pending: ['pr-2'], openDiscovery: false });
      expect(received('pr-2')).toHaveLength(1);
    } finally {
      session.close();
    }
  });

  test('a body that catches the unknown outcome and calls again sends it once (CX-6)', async () => {
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

describe('retrying an unknown outcome needs a safety basis and a policy (EXP-8 resolution 4)', () => {
  test('safe to repeat with a policy: the retry reuses the operation identity, and the author accepted both effects', async () => {
    world.options['pr-1'] = { safeToRepeat: true, retry: { maxAttempts: 2 } };
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
    world.options['pr-1'] = { providerIdempotency: true, retry: { maxAttempts: 2 } };
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

  test('safe to repeat without a policy allowing another attempt still blocks, as policy exhausted', async () => {
    world.options['pr-1'] = { safeToRepeat: true };
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

  test('a repeat-safe operation whose policy ran out blocks later runs before their bodies run', async () => {
    world.options['pr-1'] = { safeToRepeat: true, retry: { maxAttempts: 2 } };
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
      const started = members(b);
      const result = await started.done;
      const pr1 = memberOf(result.value, 'pr-1');
      expect(pr1.status === 'pending' ? pr1.blocked : undefined).toEqual({ kind: 'unknown-outcome', operation: received('pr-1')[0]?.operation, reason: 'policy-exhausted' });
      expect(operationTrace(started.events)).toEqual(['assess@pr-1:blocked:unknown:policy-exhausted']);
      expect(received('pr-1')).toHaveLength(2);
    } finally {
      b.close();
    }
  });
});
