/**
 * Operator settlement of unknown operations and honest, durable remote state
 * after a hard stop, on the real packages (RUN-012, RUN-014, ACC-005; EXP-8
 * resolution 5; supervisor rulings on #119).
 *
 * Expected values come from those rulings:
 *
 * - an operator resolves or abandons an unknown operation through a
 *   programmatic action; either is recorded durably and unblocks the member;
 * - usage the operator learns is acknowledged through Accounting's existing
 *   report under an operator-namespaced report identity; abandoning leaves
 *   the operation's usage unknown, because unknown is never zero;
 * - a hard stop's remote state (cancelled, running or unknown) is persisted
 *   in the operation journal by operation and request attempt, so a later run
 *   and the operator still see it after a restart; a provider-confirmed
 *   cancellation settles the operation, while running or unknown keeps it
 *   unknown.
 *
 * @see ../../../../docs/spec/operations.md (RUN-012, RUN-014 owner decisions, ACC-005)
 * @see ../../../../docs/spec/acceptance.md (A-13, A-14)
 * @see ../../../../experiments/exp-8/decision.md (resolution 5, CX-4)
 * @see ../../../../docs/plans/m5-operations.md (planned evidence `operator-resolves-unknown`)
 */
import { afterEach, beforeEach, describe, expect, test } from '@jest/globals';
import { SupervisionError, createStopController } from '@microdelta/supervision';

import { createWorld, installWorld } from './fixture.js';
import type { IWorld } from './fixture.js';
import { fakeTimer, openSession, operationTrace, statuses, tempStores, until } from './harness.js';
import type { IFakeTimer, IOperationSession, IOperationStores } from './harness.js';
import { inspect, memberOf, members, received } from './support.js';

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

/** Leave pr-1's assessment unknown through a lost response, returning its operation identity. */
async function leaveUnknown(): Promise<string> {
  world.provider.script('assess', 'pr-1', ['lost']);
  const session = openSession(stores, timer);
  try {
    await members(session).done;
  } finally {
    session.close();
  }
  const operation = received('pr-1')[0]?.operation;
  if (operation === undefined) {
    throw new Error('pr-1 was never sent');
  }
  return operation;
}

/** The Supervision code a promise rejects with. */
function codeOf(pending: Promise<unknown>): Promise<string> {
  return pending.then(() => 'resolved', (error: unknown) => error instanceof SupervisionError ? error.code : 'other');
}

describe('operator settlement of an unknown operation (EXP-8 resolution 5)', () => {
  test('resolving with learned usage records it under the operator namespace, is recorded, and unblocks the member', async () => {
    const operation = await leaveUnknown();
    const session = openSession(stores, timer);
    try {
      const unknown = await session.start({}, (run) => run.inspectOperations({ status: 'unknown' })).done;
      expect(unknown.value.map((view) => view.operation)).toEqual([operation]);
      const settled = session.start({ runId: 'run:operator' }, (run) => run.settleOperation({
        action: 'resolve',
        operation,
        operator: 'operator.ada',
        outcome: 'succeeded',
        usage: { report: 'invoice-7', quantities: [{ unit: 'tokens', amount: 100 }] },
      }));
      const view = (await settled.done).value;
      expect(view).toEqual(expect.objectContaining({
        operation,
        status: 'resolved',
        settlement: { action: 'resolve', outcome: 'succeeded', operator: 'operator.ada', at: timer.currentEpochMilliseconds(), report: 'operator:invoice-7' },
      }));
      expect(operationTrace(settled.events)).toEqual(['assess@pr-1:resolved:resolved:operator']);
      // The usage the operator learned is counted once, so the operation's usage is now known.
      expect(session.accounting.summarizeUsage({ environment: 'env:production', operation })).toEqual(expect.objectContaining({ status: 'complete', observed: [{ unit: 'tokens', amount: 100 }], reports: 1 }));
      // The settlement is durable: a fresh read sees it.
      expect((await inspect(session)).find((entry) => entry.operation === operation)?.status).toBe('resolved');
      // The member is no longer blocked: its next execution makes a new operation.
      const result = await members(session).done;
      expect(statuses(result.value.members)).toEqual({ 'pr-1': 'succeeded', 'pr-2': 'succeeded', 'pr-3': 'succeeded' });
      const requests = received('pr-1');
      expect(requests).toHaveLength(2);
      expect(requests[1]?.operation).not.toBe(operation);
    } finally {
      session.close();
    }
  });

  test('abandoning keeps the usage unknown, is recorded, and unblocks the member', async () => {
    const operation = await leaveUnknown();
    const session = openSession(stores, timer);
    try {
      const view = (await session.start({}, (run) => run.settleOperation({ action: 'abandon', operation, operator: 'operator.ada' })).done).value;
      expect(view.status).toBe('abandoned');
      expect(view.settlement).toEqual({ action: 'abandon', outcome: undefined, operator: 'operator.ada', at: timer.currentEpochMilliseconds(), report: undefined });
      const usage = session.accounting.summarizeUsage({ environment: 'env:production', operation });
      expect(usage.status).toBe('incomplete');
      const result = await members(session).done;
      expect(memberOf(result.value, 'pr-1').status).toBe('succeeded');
    } finally {
      session.close();
    }
  });

  test('only an unknown operation can be settled, and a missing one is refused', async () => {
    await leaveUnknown();
    const session = openSession(stores, timer);
    try {
      const succeeded = (await inspect(session)).find((view) => view.status === 'succeeded');
      expect(succeeded).toBeDefined();
      const refused = await session.start({}, (run) => Promise.all([
        codeOf(run.settleOperation({ action: 'abandon', operation: succeeded?.operation ?? 'none', operator: 'operator.ada' })),
        codeOf(run.settleOperation({ action: 'abandon', operation: 'op-missing', operator: 'operator.ada' })),
        codeOf(run.settleOperation({ action: 'abandon', operation: succeeded?.operation ?? 'none', operator: 'not an identifier!' })),
      ])).done;
      expect(refused.value).toEqual(['invalid-request', 'invalid-request', 'invalid-request']);
    } finally {
      session.close();
    }
  });
});

describe('durable remote state after a hard stop (RUN-014, supervisor ruling on #119)', () => {
  /** Hard-stop pr-1 while its request is in flight, with the provider answering `cancel`. */
  async function hardStopInFlight(session: IOperationSession, cancel: 'cancelled' | 'running' | undefined): Promise<void> {
    world.cancel = cancel;
    world.provider.script('assess', 'pr-1', ['hang']);
    const stop = createStopController();
    const started = members(session, { stop, permits: 3 });
    await until(() => world.provider.inFlight > 0 && received('pr-1').length === 1, 'pr-1 is in flight');
    stop.request({ level: 'hard' });
    const result = await started.done;
    expect(memberOf(result.value, 'pr-1').status).toBe('cancelled');
  }

  test('without provider cancellation the attempt reads unknown after a restart, and the member stays blocked', async () => {
    const a = openSession(stores, timer);
    try {
      await hardStopInFlight(a, undefined);
    } finally {
      a.close();
    }
    const b = openSession(stores, timer);
    try {
      const [view] = (await inspect(b)).filter((entry) => entry.member === 'pr-1');
      expect(view?.status).toBe('unknown');
      expect(view?.attempts.map((attempt) => [attempt.status, attempt.remote])).toEqual([['unknown', 'unknown']]);
      const result = await members(b).done;
      expect(memberOf(result.value, 'pr-1').status).toBe('pending');
      expect(received('pr-1')).toHaveLength(1);
    } finally {
      b.close();
    }
  });

  test('a provider that says the work continues is recorded running, and the outcome stays unknown', async () => {
    const a = openSession(stores, timer);
    try {
      await hardStopInFlight(a, 'running');
    } finally {
      a.close();
    }
    const b = openSession(stores, timer);
    try {
      const [view] = (await inspect(b)).filter((entry) => entry.member === 'pr-1');
      expect(view?.status).toBe('unknown');
      expect(view?.attempts.map((attempt) => [attempt.status, attempt.remote])).toEqual([['unknown', 'running']]);
    } finally {
      b.close();
    }
  });

  test('a provider-confirmed cancellation settles the operation, so a later run sends a new one', async () => {
    const a = openSession(stores, timer);
    try {
      await hardStopInFlight(a, 'cancelled');
    } finally {
      a.close();
    }
    const b = openSession(stores, timer);
    try {
      const [view] = (await inspect(b)).filter((entry) => entry.member === 'pr-1');
      expect(view?.status).toBe('cancelled');
      expect(view?.attempts.map((attempt) => [attempt.status, attempt.remote])).toEqual([['cancelled', 'cancelled']]);
      const result = await members(b).done;
      expect(memberOf(result.value, 'pr-1').status).toBe('succeeded');
      const requests = received('pr-1');
      expect(requests).toHaveLength(2);
      expect(requests[1]?.operation).not.toBe(requests[0]?.operation);
    } finally {
      b.close();
    }
  });
});
