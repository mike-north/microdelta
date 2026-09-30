/**
 * EXP-8 assertions added from the PR #111 review and the supervisor's
 * resolutions on issue #109: an author's catch-and-retry cannot bypass the
 * replay or deferral rules; stop intent reaches work that is waiting for time
 * or for a permit; usage acknowledgment reports what actually became durable;
 * and a soft-stop drain cannot outlive publication authority (an unexpired,
 * current lease). Each was written before its fix and observed failing.
 *
 * @see ../../../docs/spec/operations.md (RUN-002, RUN-011, RUN-012, RUN-014, RUN-015, ACC-003, ACC-005, ACC-007)
 * @see ../../../docs/spec/execution.md (PUB-004, PUB-006)
 */
import { describe, expect, test } from '@jest/globals';

import { Permits, Store, summarizeUsage } from '../src/protocol.js';
import type { IMemberDeclaration, IStepContext } from '../src/protocol.js';
import { FakeClock, HOUR, MemoryPort, T0, baseScript, cancelMember, emptyLedger, leaseTtlMs, okMember, quotaAt, quotaMember, secrets } from './fakes.js';
import type { IScript } from './fakes.js';
import { afterRuns, eventsOf, flush, prepare } from './harness.js';

/** A member whose author retries its single call by hand, catching every failure. */
function retryingByHand(key: string, name: string, attempts: number, retry?: { maxAttempts: number; backoffMs: number }): IMemberDeclaration {
  return {
    key,
    body: async (context: IStepContext) => {
      for (let attempt = 0; attempt < attempts; attempt++) {
        try {
          return await context.operation({ name, binding: { value: secrets.input }, ...(retry === undefined ? {} : { retry }) });
        } catch {
          // The author retries by hand.
        }
      }
      return { gaveUp: true };
    },
  };
}

describe('catch-and-retry cannot bypass the replay or deferral rules (Criteria 3 and 5)', () => {
  test('a body that retries a lost non-idempotent call by hand sends it once', async () => {
    const ledger = emptyLedger();
    const harness = prepare({
      members: [retryingByHand('m-retry', 'summarize', 3, { maxAttempts: 3, backoffMs: 0 })],
      ledger,
      script: { summarize: [{ kind: 'lost' }] },
    });
    const report = await harness.run();
    expect(ledger.calls).toEqual({ summarize: 1 });
    expect(ledger.applied).toHaveLength(1);
    expect(report.members).toEqual({ 'm-retry': { status: 'unknown-outcome', operationId: ledger.received[0]?.operationId } });
    expect(harness.port.load().results).toEqual({});
  });

  test('a body that retries a rate-limited call by hand sends nothing before T and keeps the durable deferral', async () => {
    const harness = prepare({ members: [retryingByHand('m-quota', 'assess', 2)], waitMode: 'exit' });
    const report = await harness.run();
    expect(harness.provider.ledger.calls).toEqual({ assess: 1 });
    expect(report).toMatchObject({ status: 'waiting', waitingUntil: quotaAt, members: { 'm-quota': { status: 'waiting', notBefore: quotaAt } } });
    expect(Object.values(harness.port.load().operations)).toEqual([expect.objectContaining({ state: 'deferred', notBefore: quotaAt })]);
  });

  test('a tainted attempt sends no further paid call of any operation', async () => {
    const twoCalls: IMemberDeclaration = {
      key: 'm-two',
      body: async (context: IStepContext) => {
        try {
          await context.operation({ name: 'assess', binding: { pr: 'fixed' } });
        } catch {
          // The author ignores the deferral and carries on.
        }
        return { summary: await context.operation({ name: 'summarize', binding: {} }) };
      },
    };
    const harness = prepare({ members: [twoCalls], waitMode: 'exit' });
    const report = await harness.run();
    expect(harness.provider.ledger.calls).toEqual({ assess: 1 });
    expect(report.members).toEqual({ 'm-two': { status: 'waiting', notBefore: quotaAt } });
  });

  test('the store refuses an intent that would clear a deferral before its time', () => {
    const port = new MemoryPort();
    const store = new Store(port, leaseTtlMs);
    const acquired = store.acquire(null, T0);
    const runId = acquired.status === 'acquired' ? acquired.runId : '';
    const stepAttemptId = store.beginAttempt('m-quota', runId, T0);
    const input = { member: 'm-quota', stepAttemptId, runId, name: 'assess', bindingDigest: '{}', safeToRepeat: false, retry: null };
    const first = store.intent(input, undefined, T0);
    const notBefore = T0 + 60_000;
    store.settleRequest(first.requestAttemptId, 'not-applied', 'deferred', notBefore, T0);
    expect(() => store.intent(input, first.operationId, notBefore - 1)).toThrow(/deferred/u);
    expect(port.load().operations[first.operationId]).toMatchObject({ state: 'deferred', notBefore });
    expect(store.intent(input, first.operationId, notBefore).operationId).toBe(first.operationId);
  });
});

describe('stop intent reaches waiting work at once (Criterion 1)', () => {
  test('a stop during a sleep-mode wait ends the pass without waiting for T', async () => {
    const clock = new FakeClock(T0, true);
    const harness = prepare({ members: [quotaMember()], clock, waitMode: 'sleep' });
    let settled = false;
    const running = harness.run().then(report => {
      settled = true;
      return report;
    });
    try {
      await flush(5);
      expect(clock.sleeping).toBe(1);
      harness.stop.request({ level: 'soft' });
      await flush();
      expect(settled).toBe(true);
      const report = await running;
      expect(report).toMatchObject({ status: 'stopped', members: { 'm-quota': { status: 'waiting', notBefore: quotaAt } } });
      expect(harness.provider.ledger.calls).toEqual({ assess: 1 });
      expect(harness.port.load().lease.holder).toBeNull();
    } finally {
      clock.wake();
    }
  });

  test('a hard stop reaches a body queued for a request permit', async () => {
    const settledOrder: string[] = [];
    const hanging: IMemberDeclaration = {
      key: 'm-hang',
      body: async (context: IStepContext) => ({ out: await context.operation({ name: 'generate', binding: {} }) }),
    };
    const harness = prepare({
      members: [hanging, okMember()],
      permits: new Permits(1),
      script: { generate: [{ kind: 'hang' }], summarize: [{ kind: 'ok' }] },
      observers: [event => {
        if (event.kind === 'step-settled' || event.kind === 'published') {
          settledOrder.push(event.member ?? '');
        }
      }],
    });
    const running = harness.run();
    await harness.provider.received('generate');
    harness.stop.request({ level: 'hard', member: 'm-ok' });
    await flush();
    expect(settledOrder).toEqual(['m-ok']);
    harness.provider.release('generate');
    const report = await running;
    expect(report.members).toEqual({
      'm-hang': { status: 'published', reference: expect.stringMatching(/^result-/u) },
      'm-ok': { status: 'interrupted' },
    });
    expect(harness.provider.ledger.calls).toEqual({ generate: 1 });
  });
});

describe('usage acknowledgment reports what became durable (Criterion 4)', () => {
  test('a second ambiguous usage commit is reported as unknown durability, not as not durable', async () => {
    const port = new MemoryPort();
    port.faults.push(
      { boundary: 'usage-acknowledged', subject: 'm-ok', mode: 'unknown-not-written' },
      { boundary: 'usage-acknowledged', subject: 'm-ok', mode: 'unknown-not-written' },
    );
    const report = await prepare({ members: [okMember()], port }).run();
    const codes = report.diagnostics.map(diagnostic => diagnostic.code);
    expect(codes).toContain('usage-durability-unknown');
    expect(codes).not.toContain('usage-not-durable');
    expect(eventsOf(report, 'usage-acknowledged')).toEqual([]);
    expect(report.members['m-ok']).toMatchObject({ status: 'published' });
  });

  test('an ambiguous commit that did not land is written by the re-acknowledgment', async () => {
    const port = new MemoryPort();
    port.faults.push({ boundary: 'usage-acknowledged', subject: 'm-ok', mode: 'unknown-not-written' });
    const report = await prepare({ members: [okMember()], port }).run();
    expect(eventsOf(report, 'usage-acknowledged')).toEqual([expect.objectContaining({ status: 'acknowledged', quantities: { tokens: 100 } })]);
    expect(Object.keys(port.load().usage)).toHaveLength(1);
  });

  test('the same report ID on different operations is counted for each operation', async () => {
    const port = new MemoryPort();
    const report = await prepare({
      members: [cancelMember()],
      port,
      script: {
        fetch: [{ kind: 'ok', reportId: 'shared-report' }],
        generate: [{ kind: 'ok', reportId: 'shared-report' }],
        polish: [{ kind: 'ok', reportId: 'shared-report' }],
      },
    }).run();
    expect(eventsOf(report, 'usage-acknowledged').map(event => event.status)).toEqual(['acknowledged', 'acknowledged', 'acknowledged']);
    const state = port.load();
    expect(Object.keys(state.usage)).toHaveLength(3);
    expect(summarizeUsage(state, afterRuns).known).toEqual({ tokens: 300 });
  });

  test('a report naming an unknown operation, or another operation\'s request, is refused', async () => {
    const port = new MemoryPort();
    const ledger = emptyLedger();
    const script: IScript = { ...baseScript(), generate: [{ kind: 'ok' }] };
    await prepare({ members: [cancelMember()], port, ledger, script }).run();
    const [fetched, generated] = ledger.received;
    ledger.late.push(
      { operationId: 'op-unknown', requestAttemptId: fetched?.requestAttemptId ?? '', report: { reportId: 'late-1', quantities: { tokens: 7 } }, deliverAt: T0 },
      { operationId: generated?.operationId ?? '', requestAttemptId: fetched?.requestAttemptId ?? '', report: { reportId: 'late-2', quantities: { tokens: 9 } }, deliverAt: T0 },
    );
    const report = await prepare({ members: [cancelMember()], port, ledger, script, clock: new FakeClock(T0 + HOUR) }).run();
    expect(report.diagnostics.filter(diagnostic => diagnostic.code === 'usage-unattributable')).toHaveLength(2);
    const state = port.load();
    expect(Object.keys(state.usage)).toHaveLength(3);
    expect(summarizeUsage(state, afterRuns).known).toEqual({ tokens: 300 });
  });

  test('the usage view reports a dead intent as unknown and a live one as pending', () => {
    const port = new MemoryPort();
    const store = new Store(port, leaseTtlMs);
    const acquired = store.acquire(null, T0);
    const runId = acquired.status === 'acquired' ? acquired.runId : '';
    const stepAttemptId = store.beginAttempt('m-ok', runId, T0);
    const intent = store.intent({ member: 'm-ok', stepAttemptId, runId, name: 'summarize', bindingDigest: '{}', safeToRepeat: false, retry: null }, undefined, T0);
    const state = port.load();
    expect(summarizeUsage(state, T0 + 1000)).toMatchObject({ pendingRequests: [intent.requestAttemptId], unknownRequests: [] });
    expect(summarizeUsage(state, T0 + HOUR)).toMatchObject({ pendingRequests: [], unknownRequests: [intent.requestAttemptId] });
  });

  test('provider-controlled unit names that are not identifiers never reach events', async () => {
    const port = new MemoryPort();
    const oddUnit = `${secrets.provider} body`;
    const report = await prepare({
      members: [okMember()],
      port,
      script: { summarize: [{ kind: 'ok', usage: { tokens: 100, [oddUnit]: 3 } }] },
    }).run();
    expect(JSON.stringify(report)).not.toContain(secrets.provider);
    expect(eventsOf(report, 'usage-acknowledged')).toEqual([expect.objectContaining({ quantities: { tokens: 100 } })]);
    expect(report.diagnostics.map(diagnostic => diagnostic.code)).toContain('usage-unit-dropped');
    // Accounting evidence stays in the store; only the event view drops the unit.
    expect(summarizeUsage(port.load(), afterRuns).known).toEqual({ tokens: 100, [oddUnit]: 3 });
  });

  test('a blocked member whose repeat-safe policy is exhausted reports policy-exhausted', async () => {
    const port = new MemoryPort();
    const ledger = emptyLedger();
    const declaration = { safeToRepeat: true, retry: { maxAttempts: 1, backoffMs: 0 } };
    const first = await prepare({ members: [okMember(declaration)], port, ledger, script: { summarize: [{ kind: 'lost' }] } }).run();
    expect(eventsOf(first, 'step-settled', 'm-ok')).toEqual([expect.objectContaining({ status: 'unknown-outcome', reason: 'policy-exhausted' })]);
    const again = await prepare({ members: [okMember(declaration)], port, ledger, clock: new FakeClock(T0 + HOUR) }).run();
    expect(eventsOf(again, 'member-blocked', 'm-ok')).toEqual([expect.objectContaining({ reason: 'policy-exhausted' })]);
    expect(ledger.calls).toEqual({ summarize: 1 });
  });
});

describe('a drain cannot outlive publication authority (supervisor ruling; PUB-004, RUN-015)', () => {
  test.each([
    ['another writer takes over', true],
    ['the lease merely expires', false],
  ])('when %s during a drained request, the late completion neither publishes nor rewrites the lease', async (_case, takeover) => {
    const port = new MemoryPort();
    const clock = new FakeClock(T0);
    const harness = prepare({
      members: [cancelMember()],
      port,
      clock,
      onReceive: (request, _index, live) => {
        if (request.name === 'generate') {
          live.stop.request({ level: 'soft' });
        }
      },
    });
    const running = harness.run();
    await harness.provider.received('generate');
    // No commit renews the lease while the request drains, and nothing renews it on a timer.
    clock.advance(T0 + 2 * leaseTtlMs);
    if (takeover) {
      expect(new Store(port, leaseTtlMs).acquire(null, clock.now())).toMatchObject({ status: 'acquired', fence: 2 });
    }
    const leaseBefore = port.load().lease;
    harness.provider.release('generate');
    const report = await running;
    expect(report.status).toBe('lease-lost');
    expect(report.members).toEqual({ 'm-cancel': { status: 'interrupted' } });
    expect(eventsOf(report, 'step-settled', 'm-cancel')).toEqual([expect.objectContaining({ status: 'interrupted', reason: 'lease-lost' })]);
    expect(harness.provider.ledger.calls.polish).toBeUndefined();
    const state = port.load();
    expect(state.results).toEqual({});
    expect(state.lease).toEqual(leaseBefore);
    // Usage acknowledged while authority was held is preserved; the late report could not be made durable.
    expect(summarizeUsage(state, afterRuns).known).toEqual({ tokens: 100 });
    expect(report.diagnostics.map(diagnostic => diagnostic.code)).toContain('usage-not-durable');
  });
});
