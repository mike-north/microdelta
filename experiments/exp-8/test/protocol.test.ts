/**
 * EXP-8 single-process assertions for the candidate mechanisms: stop, drain
 * and escalation; publication versus stop and observers; quota deferral and
 * lease handoff; keyed usage acknowledgment; lost responses and repeat safety;
 * retry correlation; event privacy; and late context use. Expected outcomes are
 * derived from the owner decisions recorded in issue #109 and the operations
 * contract, never from program output. Separate-process restarts and process
 * kills are proven in `restart.test.ts`.
 *
 * @see ../../../docs/spec/experiments.md (EXP-0, EXP-8)
 * @see ../../../docs/spec/operations.md (RUN-002, RUN-009, RUN-011..RUN-015, ACC-002, ACC-003, ACC-005, ACC-007, ACC-008)
 * @see ../../../docs/spec/execution.md (PUB-004, PUB-006)
 * @see ../../../docs/spec/acceptance.md (A-11..A-14, A-18, A-19)
 */
import { beforeEach, describe, expect, test } from '@jest/globals';

import { ContextClosedError, Permits, StopController, Store, summarizeUsage } from '../src/protocol.js';
import type { IMemberDeclaration, IRunReport, IStepContext } from '../src/protocol.js';
import {
  FakeClock,
  HOUR,
  MemoryPort,
  T0,
  baseScript,
  cancelMember,
  emptyLedger,
  finishedBodies,
  leaseTtlMs,
  okMember,
  plantedValues,
  quotaAt,
  quotaMember,
  secrets,
} from './fakes.js';
import { afterRuns, eventsOf, kindsOf, later, prepare } from './harness.js';

beforeEach(() => {
  finishedBodies.length = 0;
});

describe('Criterion 1: stop, drain, escalation and honest remote state (RUN-014, RUN-015, A-13)', () => {
  test('soft stop admits no new step, and the admitted step drains to publication', async () => {
    const harness = prepare({
      members: [cancelMember(), okMember(), quotaMember()],
      maxActive: 1,
      onReceive: (request, _index, live) => {
        if (request.name === 'generate') {
          live.stop.request({ level: 'soft' });
          later(() => {
            live.provider.release('generate');
          });
        }
      },
    });
    const report = await harness.run();
    expect(report.status).toBe('stopped');
    expect(report.members).toEqual({
      'm-cancel': { status: 'published', reference: expect.stringMatching(/^result-\d+$/u) },
      'm-ok': { status: 'not-admitted' },
      'm-quota': { status: 'not-admitted' },
    });
    // The drained step made its third request after the stop; nothing else was sent.
    expect(harness.provider.ledger.received.map(request => request.name)).toEqual(['fetch', 'generate', 'polish']);
    expect(eventsOf(report, 'member-not-admitted').map(event => [event.member, event.reason])).toEqual([
      ['m-ok', 'stop-soft'],
      ['m-quota', 'stop-soft'],
    ]);
    expect(eventsOf(report, 'step-admitted').map(event => event.member)).toEqual(['m-cancel']);
  });

  test('soft stop refuses the retry of a deferred operation; the deferral stays durable', async () => {
    const harness = prepare({
      members: [quotaMember()],
      waitMode: 'sleep',
      onReceive: (request, _index, live) => {
        if (request.name === 'assess') {
          live.stop.request({ level: 'soft' });
        }
      },
    });
    const report = await harness.run();
    expect(report).toMatchObject({ status: 'stopped', waitingUntil: quotaAt, members: { 'm-quota': { status: 'waiting', notBefore: quotaAt } } });
    expect(harness.clock.sleeps).toEqual([]);
    expect(harness.provider.ledger.calls).toEqual({ assess: 1 });
    expect(eventsOf(report, 'retry-started')).toEqual([]);
    const state = harness.port.load();
    expect(Object.values(state.operations)).toEqual([expect.objectContaining({ name: 'assess', state: 'deferred', notBefore: quotaAt })]);
    expect(state.lease.holder).toBeNull();
  });

  test('soft stop refuses an in-body transient retry even under an author policy', async () => {
    const harness = prepare({
      members: [okMember({ retry: { maxAttempts: 3, backoffMs: 1000 } })],
      script: { summarize: [{ kind: 'unavailable' }, { kind: 'ok' }] },
      onReceive: (_request, _index, live) => {
        live.stop.request({ level: 'soft' });
      },
    });
    const report = await harness.run();
    expect(report.members).toEqual({ 'm-ok': { status: 'interrupted' } });
    expect(harness.provider.ledger.calls).toEqual({ summarize: 1 });
    expect(eventsOf(report, 'retry-started')).toEqual([]);
    expect(eventsOf(report, 'step-settled', 'm-ok')).toEqual([expect.objectContaining({ status: 'interrupted', reason: 'stop-soft' })]);
  });

  test('counterexample (request drain): soft stop discards paid in-flight step work', async () => {
    const harness = prepare({
      members: [cancelMember()],
      drainUnit: 'request',
      onReceive: (request, _index, live) => {
        if (request.name === 'generate') {
          live.stop.request({ level: 'soft' });
          later(() => {
            live.provider.release('generate');
          });
        }
      },
    });
    const report = await harness.run();
    // Observed cost of the rejected candidate: two paid requests, no reusable result.
    expect(report.members).toEqual({ 'm-cancel': { status: 'interrupted' } });
    expect(harness.provider.ledger.applied.map(entry => entry.name)).toEqual(['fetch', 'generate']);
    expect(harness.provider.ledger.calls).toEqual({ fetch: 1, generate: 1 });
    const state = harness.port.load();
    expect(state.results).toEqual({});
    expect(summarizeUsage(state, afterRuns).known).toEqual({ tokens: 200 });
  });

  test('soft stop has no default deadline: time alone never escalates it', async () => {
    const harness = prepare({
      members: [cancelMember()],
      // The operator's lease TTL exceeds this 30-day request, so the drained step keeps publication authority.
      leaseTtlMs: 60 * 24 * HOUR,
      onReceive: (request, _index, live) => {
        if (request.name === 'generate') {
          live.stop.request({ level: 'soft' });
        }
      },
    });
    const running = harness.run();
    await harness.provider.received('generate');
    harness.clock.advance(T0 + 30 * 24 * HOUR);
    expect(harness.provider.ledger.cancels).toEqual([]);
    harness.provider.release('generate');
    const report = await running;
    expect(report.members).toEqual({ 'm-cancel': { status: 'published', reference: expect.stringMatching(/^result-/u) } });
    expect(eventsOf(report, 'stop-escalated')).toEqual([]);
    expect(eventsOf(report, 'local-abort')).toEqual([]);
  });

  test('an operator deadline escalates an unfinished soft stop to hard', async () => {
    const deadline = T0 + 10 * 60_000;
    const harness = prepare({
      members: [cancelMember()],
      // The lease TTL exceeds the deadline, so the escalation can still record the remote state durably.
      leaseTtlMs: HOUR,
      onReceive: (request, _index, live) => {
        if (request.name === 'generate') {
          live.stop.request({ level: 'soft', deadline });
        }
      },
    });
    const running = harness.run();
    await harness.provider.received('generate');
    harness.clock.advance(deadline);
    const report = await running;
    expect(report.members).toEqual({ 'm-cancel': { status: 'interrupted' } });
    expect(eventsOf(report, 'stop-escalated')).toEqual([expect.objectContaining({ level: 'hard', reason: 'deadline' })]);
    expect(eventsOf(report, 'remote-state')).toEqual([expect.objectContaining({ status: 'cancelled' })]);
    expect(harness.provider.ledger.calls.polish).toBeUndefined();
  });

  test.each([
    ['cancelled', 'cancelled', true],
    ['running', 'running', true],
    ['no-answer', 'unknown', true],
    ['unsupported', 'unknown', false],
  ] as const)('hard stop with provider cancel answer %s records remote state %s', async (answer, recorded, requested) => {
    const harness = prepare({
      members: [cancelMember()],
      cancelAnswer: answer,
      onReceive: (request, _index, live) => {
        if (request.name === 'generate') {
          live.stop.request({ level: 'hard' });
        }
      },
    });
    const report = await harness.run();
    expect(report).toMatchObject({ status: 'stopped', members: { 'm-cancel': { status: 'interrupted' } } });
    const generate = harness.provider.ledger.received.find(request => request.name === 'generate');
    const state = harness.port.load();
    expect(state.requests[generate?.requestAttemptId ?? '']?.state).toBe(recorded);
    expect(state.operations[generate?.operationId ?? '']?.state).toBe(recorded);
    expect(Object.values(state.attempts).map(attempt => attempt.state)).toEqual(['interrupted']);
    expect(state.results).toEqual({});
    // A local abort is always distinct from any remote statement.
    const kinds = kindsOf(report.events.filter(event => ['local-abort', 'remote-cancel-requested', 'remote-state'].includes(event.kind)));
    expect(kinds).toEqual(requested ? ['local-abort', 'remote-cancel-requested', 'remote-state'] : ['local-abort', 'remote-state']);
    expect(eventsOf(report, 'remote-state')).toEqual([expect.objectContaining({ status: recorded, operationId: generate?.operationId })]);
    expect(harness.provider.ledger.cancels.length).toBe(requested ? 1 : 0);
    expect(harness.provider.ledger.calls.polish).toBeUndefined();
  });

  test.each([
    ['hard stop', 'generate', { generate: [{ kind: 'hang' }] }, { status: 'interrupted' }],
    ['deferral', 'assess', { assess: [{ kind: 'rate-limited', retryAt: quotaAt }] }, { status: 'waiting', notBefore: quotaAt }],
    ['unknown outcome', 'summarize', { summarize: [{ kind: 'lost' }] }, { status: 'unknown-outcome', operationId: expect.stringMatching(/^op-/u) }],
  ] as const)('no partial output as success: a body that swallows a %s is not published', async (_case, name, script, outcome) => {
    const greedy: IMemberDeclaration = {
      key: 'm-greedy',
      body: async (context: IStepContext) => {
        try {
          await context.operation({ name, binding: { value: secrets.input } });
        } catch {
          // The author swallows the signal and returns what it has.
        }
        return { partial: secrets.output };
      },
    };
    const harness = prepare({
      members: [greedy],
      script,
      waitMode: 'exit',
      onReceive: (request, _index, live) => {
        if (request.name === 'generate') {
          live.stop.request({ level: 'hard' });
        }
      },
    });
    const report = await harness.run();
    expect(report.members).toEqual({ 'm-greedy': outcome });
    expect(harness.port.load().results).toEqual({});
    expect(eventsOf(report, 'step-settled', 'm-greedy')).toEqual([expect.objectContaining({ reason: 'partial-output-discarded' })]);
    expect(eventsOf(report, 'published')).toEqual([]);
  });

  test('RUN-015: a member cancelled after request one of three keeps its usage, exposes no result, and spares its sibling', async () => {
    const harness = prepare({
      members: [cancelMember(), okMember()],
      onReceive: (request, _index, live) => {
        if (request.name === 'generate') {
          live.stop.request({ level: 'hard', member: 'm-cancel' });
        }
      },
    });
    const report = await harness.run();
    expect(report.status).toBe('settled');
    expect(report.members).toEqual({
      'm-cancel': { status: 'interrupted' },
      'm-ok': { status: 'published', reference: expect.stringMatching(/^result-/u) },
    });
    const state = harness.port.load();
    expect(Object.keys(state.results)).toEqual(['m-ok']);
    const generate = harness.provider.ledger.received.find(request => request.name === 'generate');
    const usage = summarizeUsage(state, afterRuns);
    expect(usage.known).toEqual({ tokens: 200 });
    expect(usage.unknownRequests).toEqual([generate?.requestAttemptId]);
  });

  test('counterexample (arbitrary JavaScript): a body awaiting non-provider work runs on after hard stop, but is not published', async () => {
    let reachGate: () => void = () => undefined;
    const atGate = new Promise<void>(resolve => {
      reachGate = resolve;
    });
    let openGate: () => void = () => undefined;
    const gate = new Promise<void>(resolve => {
      openGate = resolve;
    });
    const slow: IMemberDeclaration = {
      key: 'm-slow',
      body: async (context: IStepContext) => {
        await context.operation({ name: 'summarize', binding: {} });
        reachGate();
        await gate;
        finishedBodies.push('m-slow');
        return { complete: true };
      },
    };
    const harness = prepare({ members: [slow] });
    const running = harness.run();
    await atGate;
    harness.stop.request({ level: 'hard' });
    openGate();
    const report = await running;
    expect(finishedBodies).toEqual(['m-slow']);
    expect(report.members).toEqual({ 'm-slow': { status: 'interrupted' } });
    expect(harness.port.load().results).toEqual({});
    expect(eventsOf(report, 'step-settled', 'm-slow')).toEqual([expect.objectContaining({ status: 'interrupted', reason: 'stop-hard' })]);
  });
});

describe('Criterion 2: committed success survives observers and later stop (A-19, PUB-004)', () => {
  test('a throwing observer cannot invalidate committed output, and the next pass does not re-execute', async () => {
    const ledger = emptyLedger();
    const port = new MemoryPort();
    const first = prepare({
      members: [okMember()],
      port,
      ledger,
      observers: [() => {
        throw new Error(secrets.error);
      }],
    });
    const report = await first.run();
    const reference = report.members['m-ok'];
    expect(reference).toEqual({ status: 'published', reference: expect.stringMatching(/^result-/u) });
    expect(report.diagnostics.filter(diagnostic => diagnostic.code === 'observer-failed')).toHaveLength(report.events.length);
    const second = prepare({ members: [okMember()], port, ledger, clock: new FakeClock(T0 + HOUR) });
    const again = await second.run();
    expect(again.members['m-ok']).toEqual({ status: 'reused', reference: reference?.status === 'published' ? reference.reference : '' });
    expect(ledger.calls).toEqual({ summarize: 1 });
  });

  test('a hard stop right after the publication commit leaves the committed success', async () => {
    const port = new MemoryPort();
    const ledger = emptyLedger();
    const stop = new StopController();
    const harness = prepare({
      members: [okMember()],
      port,
      ledger,
      stop,
      observers: [event => {
        if (event.kind === 'published') {
          stop.request({ level: 'hard' });
        }
      }],
    });
    const report = await harness.run();
    expect(report.members['m-ok']).toEqual({ status: 'published', reference: expect.stringMatching(/^result-/u) });
    expect(Object.values(port.load().attempts).map(attempt => attempt.state)).toEqual(['completed']);
    const again = await prepare({ members: [okMember()], port, ledger, clock: new FakeClock(T0 + HOUR) }).run();
    expect(again.members['m-ok']).toMatchObject({ status: 'reused' });
    expect(ledger.calls).toEqual({ summarize: 1 });
  });
});

describe('Criterion 3: durable quota deferral, lease handoff and honest waiting (RUN-002, RUN-011)', () => {
  test('the deferral is durable and holds no permit; with one permit both siblings complete while it waits', async () => {
    const permits = new Permits(1);
    const harness = prepare({
      members: [quotaMember(), okMember(), cancelMember()],
      script: { ...baseScript(), generate: [{ kind: 'ok' }] },
      permits,
      waitMode: 'exit',
    });
    const report = await harness.run();
    expect(report).toMatchObject({
      status: 'waiting',
      waitingUntil: quotaAt,
      members: {
        'm-quota': { status: 'waiting', notBefore: quotaAt },
        'm-ok': { status: 'published' },
        'm-cancel': { status: 'published' },
      },
    });
    expect(harness.provider.ledger.received.map(request => request.name)).toEqual(['assess', 'summarize', 'fetch', 'generate', 'polish']);
    const scheduled = report.events.findIndex(event => event.kind === 'retry-scheduled' && event.member === 'm-quota');
    const published = report.events.map((event, index) => event.kind === 'published' ? index : -1).filter(index => index >= 0);
    expect(scheduled).toBeGreaterThanOrEqual(0);
    expect(published.every(index => index > scheduled)).toBe(true);
    expect(report.events[scheduled]).toMatchObject({ notBefore: quotaAt, reason: 'rate-limited' });
    const state = harness.port.load();
    expect(Object.values(state.operations).filter(operation => operation.name === 'assess'))
      .toEqual([expect.objectContaining({ state: 'deferred', notBefore: quotaAt })]);
    expect(state.lease.holder).toBeNull();
    expect(permits.held).toBe(0);
  });

  test('sleep mode releases the lease and permits before sleeping, then resumes the same operation after T', async () => {
    const permits = new Permits(1);
    const port = new MemoryPort();
    const clock = new FakeClock(T0);
    let atSleep: unknown;
    clock.onSleep = until => {
      const other = new Store(port, leaseTtlMs);
      const probe = other.acquire(null, clock.now());
      other.release(clock.now());
      atSleep = { until, holderBefore: port.load().lease.holder, held: permits.held, probe: probe.status === 'acquired' ? probe.fence : probe.status };
    };
    const harness = prepare({ members: [quotaMember(), okMember()], permits, port, clock, waitMode: 'sleep' });
    const report = await harness.run();
    expect(atSleep).toEqual({ until: quotaAt, holderBefore: null, held: 0, probe: 2 });
    expect(clock.sleeps).toEqual([quotaAt]);
    expect(report.status).toBe('settled');
    expect(report.members).toMatchObject({ 'm-quota': { status: 'published' }, 'm-ok': { status: 'published' } });
    expect(eventsOf(report, 'lease-acquired').map(event => event.fence)).toEqual([1, 3]);
    const waitIndex = report.events.findIndex(event => event.kind === 'run-waiting');
    expect(kindsOf(report.events.slice(waitIndex, waitIndex + 3))).toEqual(['run-waiting', 'lease-released', 'lease-acquired']);
    const assess = harness.provider.ledger.received.filter(request => request.name === 'assess');
    expect(assess).toHaveLength(2);
    expect(assess[1]?.operationId).toBe(assess[0]?.operationId);
    expect(assess[1]?.requestAttemptId).not.toBe(assess[0]?.requestAttemptId);
    expect(assess[0]?.at).toBeLessThan(quotaAt);
    expect(assess[1]?.at).toBeGreaterThanOrEqual(quotaAt);
    expect(eventsOf(report, 'retry-started', 'm-quota')).toEqual([expect.objectContaining({ operationId: assess[0]?.operationId })]);
  });

  test('a soft stop during the wait cancels the resume; the lease stays released', async () => {
    const clock = new FakeClock(T0);
    const stop = new StopController();
    clock.onSleep = () => {
      stop.request({ level: 'soft' });
    };
    const harness = prepare({ members: [quotaMember()], clock, stop, waitMode: 'sleep' });
    const report = await harness.run();
    expect(report).toMatchObject({ status: 'stopped', members: { 'm-quota': { status: 'waiting', notBefore: quotaAt } } });
    expect(harness.provider.ledger.calls).toEqual({ assess: 1 });
    expect(eventsOf(report, 'lease-acquired')).toHaveLength(1);
    expect(harness.port.load().lease.holder).toBeNull();
  });

  test('counterexample (RUN-011 tension): a deferral after a successful operation re-pays that operation when the step resumes', async () => {
    const twoCalls: IMemberDeclaration = {
      key: 'm-two',
      body: async (context: IStepContext) => {
        await context.operation({ name: 'fetch', binding: { repo: 'fixed' } });
        const assessed = await context.operation({ name: 'assess', binding: { pr: 'fixed' } });
        return { assessed };
      },
    };
    const harness = prepare({ members: [twoCalls], waitMode: 'sleep' });
    const report = await harness.run();
    expect(report.members['m-two']).toMatchObject({ status: 'published' });
    const fetches = harness.provider.ledger.received.filter(request => request.name === 'fetch');
    const assesses = harness.provider.ledger.received.filter(request => request.name === 'assess');
    // The deferred operation keeps its identity; the completed one is a new, paid operation.
    expect(assesses.map(request => request.operationId)).toEqual([assesses[0]?.operationId, assesses[0]?.operationId]);
    expect(fetches).toHaveLength(2);
    expect(fetches[1]?.operationId).not.toBe(fetches[0]?.operationId);
    expect(harness.provider.ledger.applied.filter(entry => entry.name === 'fetch')).toHaveLength(2);
  });

  test('an unknown reset time is not a deferral: no wait and no fabricated progress', async () => {
    const harness = prepare({ members: [quotaMember()], script: { assess: [{ kind: 'rate-limited', retryAt: null }] }, waitMode: 'sleep' });
    const report = await harness.run();
    expect(report).toMatchObject({ status: 'settled', waitingUntil: null, members: { 'm-quota': { status: 'failed' } } });
    expect(harness.clock.sleeps).toEqual([]);
    expect(eventsOf(report, 'retry-scheduled')).toEqual([]);
    expect(eventsOf(report, 'request-settled', 'm-quota')).toEqual([expect.objectContaining({ status: 'not-applied', reason: 'rate-limited' })]);
    expect(eventsOf(report, 'step-settled', 'm-quota')).toEqual([expect.objectContaining({ status: 'failed', reason: 'no-policy' })]);
  });

  test('rate-limit deferrals stop at the declared attempt limit (policy exhausted)', async () => {
    const harness = prepare({
      members: [quotaMember({ retry: { maxAttempts: 2, backoffMs: 0 } })],
      script: { assess: [{ kind: 'rate-limited', retryAt: quotaAt }, { kind: 'rate-limited', retryAt: quotaAt + HOUR }] },
      waitMode: 'sleep',
    });
    const report = await harness.run();
    expect(report.members).toEqual({ 'm-quota': { status: 'failed' } });
    expect(harness.clock.sleeps).toEqual([quotaAt]);
    expect(harness.provider.ledger.calls).toEqual({ assess: 2 });
    expect(eventsOf(report, 'retry-exhausted')).toEqual([expect.objectContaining({ member: 'm-quota', reason: 'policy-exhausted' })]);
  });
});

describe('Criterion 4: intent-before-call accounting and keyed acknowledgment (ACC-002, ACC-003, ACC-005, ACC-007, PUB-006)', () => {
  test('every paid call has a durable intent before the provider receives it', async () => {
    const port = new MemoryPort();
    const atReceipt: unknown[] = [];
    const harness = prepare({
      members: [cancelMember()],
      port,
      script: { ...baseScript(), generate: [{ kind: 'ok' }] },
      onReceive: request => {
        const durable = port.load();
        atReceipt.push([request.name, durable.requests[request.requestAttemptId]?.state, durable.operations[request.operationId]?.state]);
      },
    });
    await harness.run();
    expect(atReceipt).toEqual([
      ['fetch', 'pending', 'pending'],
      ['generate', 'pending', 'pending'],
      ['polish', 'pending', 'pending'],
    ]);
    const boundaries = port.commits.filter(commit => commit.subject === 'm-cancel').map(commit => commit.boundary);
    expect(boundaries.slice(1, 4)).toEqual(['operation-intent', 'usage-acknowledged', 'request-settled']);
  });

  test('a lost acknowledgment after the usage write retains the usage exactly once', async () => {
    const port = new MemoryPort();
    port.faults.push({ boundary: 'usage-acknowledged', subject: 'm-ok', mode: 'ack-lost' });
    const report = await prepare({ members: [okMember()], port }).run();
    expect(report.members['m-ok']).toMatchObject({ status: 'published' });
    expect(report.diagnostics.map(diagnostic => diagnostic.code)).toContain('acknowledgment-lost');
    // The reload shows this attempt's own write landed: it is this attempt's acknowledgment, not a duplicate.
    expect(eventsOf(report, 'usage-acknowledged')).toEqual([expect.objectContaining({ status: 'acknowledged', quantities: { tokens: 100 } })]);
    const state = port.load();
    expect(Object.keys(state.usage)).toHaveLength(1);
    expect(summarizeUsage(state, afterRuns).known).toEqual({ tokens: 100 });
  });

  test('duplicate delivery of one report counts once', async () => {
    const port = new MemoryPort();
    const report = await prepare({ members: [okMember()], port, script: { summarize: [{ kind: 'ok', late: 'duplicate' }] } }).run();
    expect(eventsOf(report, 'usage-acknowledged').map(event => event.status)).toEqual(['acknowledged', 'duplicate']);
    const state = port.load();
    expect(Object.keys(state.usage)).toHaveLength(1);
    expect(summarizeUsage(state, afterRuns).known).toEqual({ tokens: 100 });
  });

  test('a conflicting redelivery keeps the first quantities and is diagnosed', async () => {
    const port = new MemoryPort();
    const report = await prepare({ members: [okMember()], port, script: { summarize: [{ kind: 'ok', late: 'conflict' }] } }).run();
    expect(eventsOf(report, 'usage-acknowledged').map(event => event.status)).toEqual(['acknowledged', 'conflict']);
    expect(report.diagnostics.map(diagnostic => diagnostic.code)).toContain('usage-conflict');
    expect(summarizeUsage(port.load(), afterRuns).known).toEqual({ tokens: 100 });
  });

  test('failed persistence issues no acknowledgment and leaves the usage unknown, not zero', async () => {
    const port = new MemoryPort();
    port.faults.push({ boundary: 'usage-acknowledged', subject: 'm-ok', mode: 'fail-before' });
    const harness = prepare({ members: [okMember()], port });
    const report = await harness.run();
    expect(eventsOf(report, 'usage-acknowledged')).toEqual([]);
    expect(report.diagnostics.map(diagnostic => diagnostic.code)).toContain('usage-not-durable');
    expect(report.members['m-ok']).toMatchObject({ status: 'published' });
    const usage = summarizeUsage(port.load(), afterRuns);
    expect(usage.known).toEqual({});
    expect(usage.unknownRequests).toEqual([harness.provider.ledger.received[0]?.requestAttemptId]);
  });

  test('a response without a usage report reads as unknown usage, not zero', async () => {
    const port = new MemoryPort();
    await prepare({ members: [okMember()], port, script: { summarize: [{ kind: 'ok', usage: null }] } }).run();
    const usage = summarizeUsage(port.load(), afterRuns);
    expect(usage.known.tokens).toBeUndefined();
    expect(usage.unknownRequests).toHaveLength(1);
  });

  test('independent request attempts with their own reports count separately', async () => {
    const port = new MemoryPort();
    await prepare({
      members: [okMember({ retry: { maxAttempts: 2, backoffMs: 0 } })],
      port,
      script: { summarize: [{ kind: 'unavailable' }, { kind: 'ok' }] },
    }).run();
    const state = port.load();
    expect(Object.keys(state.usage)).toHaveLength(2);
    expect(summarizeUsage(state, afterRuns).known).toEqual({ requests: 1, tokens: 100 });
  });
});

describe('Criterion 5: lost responses and repeat safety (RUN-012, A-12)', () => {
  test('a lost response on a non-idempotent operation is unknown and never replayed, even under a retry policy', async () => {
    const port = new MemoryPort();
    const ledger = emptyLedger();
    const policy = { retry: { maxAttempts: 3, backoffMs: 0 } };
    const harness = prepare({ members: [okMember(policy)], port, ledger, script: { summarize: [{ kind: 'lost' }, { kind: 'ok' }] } });
    const report = await harness.run();
    const operationId = ledger.received[0]?.operationId ?? '';
    expect(report.members).toEqual({ 'm-ok': { status: 'unknown-outcome', operationId } });
    expect(ledger.applied).toHaveLength(1);
    expect(ledger.calls).toEqual({ summarize: 1 });
    expect(port.load().operations[operationId]?.state).toBe('unknown');
    expect(eventsOf(report, 'request-settled', 'm-ok')).toEqual([expect.objectContaining({ status: 'unknown', reason: 'lost-response' })]);
    const again = await prepare({
      members: [okMember(policy)],
      port,
      ledger,
      clock: new FakeClock(T0 + HOUR),
      script: { summarize: [{ kind: 'lost' }, { kind: 'ok' }] },
    }).run();
    expect(again.members).toEqual({ 'm-ok': { status: 'unknown-outcome', operationId } });
    expect(eventsOf(again, 'member-blocked')).toEqual([expect.objectContaining({ member: 'm-ok', operationId, reason: 'not-repeat-safe' })]);
    expect(eventsOf(again, 'step-admitted')).toEqual([]);
    expect(ledger.calls).toEqual({ summarize: 1 });
  });

  test('a declared safe-to-repeat operation retries with the same operation ID and a new attempt ID', async () => {
    const ledger = emptyLedger();
    const harness = prepare({
      members: [okMember({ safeToRepeat: true, retry: { maxAttempts: 2, backoffMs: 1000 } })],
      ledger,
      script: { summarize: [{ kind: 'lost' }, { kind: 'ok' }] },
    });
    const report = await harness.run();
    expect(report.members['m-ok']).toMatchObject({ status: 'published' });
    const [first, second] = ledger.received;
    expect(second?.operationId).toBe(first?.operationId);
    expect(second?.requestAttemptId).not.toBe(first?.requestAttemptId);
    // The provider has no idempotency keys: the author accepted a possible second effect.
    expect(ledger.applied).toHaveLength(2);
    expect(harness.clock.sleeps).toHaveLength(1);
    // Criterion 6 within one process: one operation, distinct attempts, one step attempt, member and run.
    const started = eventsOf(report, 'request-started', 'm-ok');
    expect(started.map(event => event.operationId)).toEqual([first?.operationId, first?.operationId]);
    expect(started.map(event => event.requestAttemptId)).toEqual([first?.requestAttemptId, second?.requestAttemptId]);
    expect(new Set(started.map(event => event.stepAttemptId)).size).toBe(1);
    expect(started.every(event => event.runId === report.runId && event.member === 'm-ok')).toBe(true);
    expect(kindsOf(report.events.filter(event => event.kind === 'retry-scheduled' || event.kind === 'retry-started'))).toEqual(['retry-scheduled', 'retry-started']);
  });

  test('provider idempotency keys: repeating the same operation performs one effect', async () => {
    const ledger = emptyLedger();
    const report = await prepare({
      members: [okMember({ retry: { maxAttempts: 2, backoffMs: 0 } })],
      ledger,
      idempotencyKeys: true,
      script: { summarize: [{ kind: 'lost' }, { kind: 'ok' }] },
    }).run();
    expect(report.members['m-ok']).toMatchObject({ status: 'published' });
    expect(ledger.received).toHaveLength(2);
    expect(ledger.applied).toHaveLength(1);
  });

  test('a changed binding is a distinct operation; the earlier operation keeps its own identity', async () => {
    const port = new MemoryPort();
    const ledger = emptyLedger();
    await prepare({ members: [quotaMember()], port, ledger, waitMode: 'exit' }).run();
    const report = await prepare({
      members: [quotaMember({ binding: { pr: 'changed' } })],
      port,
      ledger,
      clock: new FakeClock(quotaAt + 60_000),
    }).run();
    expect(report.members['m-quota']).toMatchObject({ status: 'published' });
    const [first, second] = ledger.received;
    expect(second?.operationId).not.toBe(first?.operationId);
    expect(eventsOf(report, 'retry-started')).toEqual([]);
    const operations = port.load().operations;
    expect(operations[first?.operationId ?? '']?.state).toBe('deferred');
    expect(operations[second?.operationId ?? '']?.state).toBe('succeeded');
  });

  test('a transient failure without an author policy is not retried', async () => {
    const harness = prepare({ members: [okMember()], script: { summarize: [{ kind: 'unavailable' }, { kind: 'ok' }] } });
    const report = await harness.run();
    expect(report.members).toEqual({ 'm-ok': { status: 'failed' } });
    expect(harness.provider.ledger.calls).toEqual({ summarize: 1 });
    expect(eventsOf(report, 'retry-scheduled')).toEqual([]);
  });

  test('a transient failure under a policy backs off, retries, exhausts, and its sibling continues', async () => {
    const harness = prepare({
      members: [okMember({ retry: { maxAttempts: 2, backoffMs: 500 } }), cancelMember()],
      script: { ...baseScript(), summarize: [{ kind: 'unavailable' }], generate: [{ kind: 'ok' }] },
    });
    const report = await harness.run();
    expect(report.members).toMatchObject({ 'm-ok': { status: 'failed' }, 'm-cancel': { status: 'published' } });
    expect(harness.provider.ledger.calls.summarize).toBe(2);
    expect(eventsOf(report, 'retry-exhausted', 'm-ok')).toEqual([expect.objectContaining({ reason: 'policy-exhausted' })]);
    expect(harness.clock.sleeps).toHaveLength(1);
  });
});

describe('Criterion 7: event privacy (owner decision: identifiers, statuses, timings, usage, references only)', () => {
  test('no event or diagnostic contains a planted input, argument, output, provider-body or error value', async () => {
    const port = new MemoryPort();
    const ledger = emptyLedger();
    const throwing: IMemberDeclaration = {
      key: 'm-throws',
      body: async (context: IStepContext) => {
        await context.operation({ name: 'fetch', binding: { secret: secrets.input } });
        throw new Error(secrets.error);
      },
    };
    const reports: IRunReport[] = [];
    reports.push(await prepare({
      members: [okMember(), quotaMember(), cancelMember(), throwing],
      port,
      ledger,
      waitMode: 'exit',
      cancelAnswer: 'no-answer',
      observers: [() => {
        throw new Error(secrets.error);
      }],
      onReceive: (request, _index, live) => {
        if (request.name === 'generate') {
          live.stop.request({ level: 'hard', member: 'm-cancel' });
        }
      },
    }).run());
    reports.push(await prepare({
      members: [okMember({ retry: { maxAttempts: 2, backoffMs: 0 } }, 'm-lost')],
      ledger,
      script: { summarize: [{ kind: 'lost' }] },
    }).run());
    const published = JSON.stringify(reports.map(report => ({ events: report.events, diagnostics: report.diagnostics, members: report.members })));
    for (const value of plantedValues) {
      expect(published).not.toContain(value);
    }
    // Positive control: the planted values really flowed through the system.
    expect(port.text).toContain(secrets.output);
    expect(port.text).toContain(secrets.provider);
    expect(JSON.stringify(ledger.received)).toContain(secrets.input);
    expect(reports[0]?.diagnostics.map(diagnostic => diagnostic.code)).toContain('body-failed');
  });

  test('counterexample (member keys are identifiers): a key derived from a sensitive value appears in events', async () => {
    const key = `member-${secrets.input}`;
    const report = await prepare({ members: [okMember({}, key)] }).run();
    expect(JSON.stringify(report.events)).toContain(secrets.input);
  });
});

describe('A-18 and writer lease', () => {
  test('a step context used after its step settled fails clearly and sends nothing', async () => {
    let escaped: IStepContext | undefined;
    const capture: IMemberDeclaration = {
      key: 'm-escape',
      body: (context: IStepContext) => {
        escaped = context;
        return Promise.resolve({ done: true });
      },
    };
    const harness = prepare({ members: [capture] });
    await harness.run();
    await expect(escaped?.operation({ name: 'summarize', binding: {} })).rejects.toBeInstanceOf(ContextClosedError);
    expect(harness.provider.ledger.calls).toEqual({});
    expect(harness.port.load().requests).toEqual({});
  });

  test('a live foreign lease refuses the writer; nothing runs', async () => {
    const port = new MemoryPort();
    const holder = new Store(port, leaseTtlMs);
    expect(holder.acquire(null, T0)).toMatchObject({ status: 'acquired', fence: 1 });
    const harness = prepare({ members: [okMember()], port, clock: new FakeClock(T0 + 1000) });
    const report = await harness.run();
    expect(report).toMatchObject({ status: 'writer-busy', members: {} });
    expect(harness.provider.ledger.calls).toEqual({});
  });

  test('recovery after a dead holder: running attempts become interrupted and pending intents unknown', () => {
    const port = new MemoryPort();
    const dead = new Store(port, leaseTtlMs);
    const acquired = dead.acquire(null, T0);
    const runId = acquired.status === 'acquired' ? acquired.runId : '';
    const stepAttemptId = dead.beginAttempt('m-ok', runId, T0);
    const intent = dead.intent({ member: 'm-ok', stepAttemptId, runId, name: 'summarize', bindingDigest: '{}', safeToRepeat: false, retry: null }, undefined, T0);
    const live = new Store(port, leaseTtlMs);
    expect(live.acquire(null, T0 + 60_000)).toMatchObject({ status: 'busy', holder: runId });
    const recovered = live.acquire(null, T0 + HOUR);
    expect(recovered).toMatchObject({
      status: 'acquired',
      fence: 2,
      recovered: [{ requestAttemptId: intent.requestAttemptId, operationId: intent.operationId, member: 'm-ok' }],
    });
    const state = port.load();
    expect(state.attempts[stepAttemptId]?.state).toBe('interrupted');
    expect(state.requests[intent.requestAttemptId]?.state).toBe('unknown');
    expect(state.operations[intent.operationId]?.state).toBe('unknown');
    expect(summarizeUsage(state, T0 + HOUR).unknownRequests).toEqual([intent.requestAttemptId]);
  });
});
