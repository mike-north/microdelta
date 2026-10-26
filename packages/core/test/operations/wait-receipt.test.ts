/**
 * RUN-010/011 and CLI-005: deferred work left beside a failed strict fold
 * remains a run-level receipt, without making that terminal failure wait.
 * The real Resolution, Supervision, History and Accounting owners run over
 * the existing authored operation graph; provider responses and time alone
 * are controlled. Assertions distinguish left-behind work from a deferral
 * that sleep mode actually resumed, and body return from report success.
 */
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, test } from '@jest/globals';
import { createNodeClock, createNodeElapsedClock, createNodeRandom, createNodeSqlite, createNodeSqliteReader, createNodeTimer } from '@microdelta/machine-node';
import { createResolution } from '@microdelta/resolution';
import { createSupervision, openExecutionObservationReader } from '@microdelta/supervision';
import type { IFoldReport, IRunEvent } from '@microdelta/supervision';
import { createTrackingObserver } from '@microdelta/tracking';

import { writerFor } from '../../src/writer.js';
import { analysis, createWorld, installWorld, useSupervision } from './fixture.js';
import type { IWorld } from './fixture.js';
import { T0, fakeTimer, freshKey, machine, openSession, production, statuses, tempStores, until } from './harness.js';
import type { IFakeTimer, IOperationSession, IOperationStores } from './harness.js';
import { fold, memberOf, received } from './support.js';

/** A controlled timer that also exposes every scheduled time, including cancelled callbacks. */
interface IRecordingTimer extends IFakeTimer {
  readonly scheduled: readonly number[];
}

/** Record timer admission independently of wait lifecycle events. */
function recordingTimer(): IRecordingTimer {
  const timer = fakeTimer();
  const scheduled: number[] = [];
  return {
    ...timer,
    scheduled,
    schedule(at, callback, options) {
      scheduled.push(at);
      return timer.schedule(at, callback, options);
    },
  };
}

/** Stores and authored inputs are fresh per test; separate runs within a test share durable authority. */
let stores: IOperationStores;
let timer: IRecordingTimer;
let world: IWorld;

beforeEach(() => {
  stores = tempStores();
  timer = recordingTimer();
  world = installWorld(createWorld(() => timer.currentEpochMilliseconds()));
});
afterEach(() => { stores.remove(); });

/** One genuinely successful member, one quota-deferred member, and one isolated terminal provider refusal. */
function mixedResponses(): void {
  world.provider.script('assess', 'pr-2', ['rate-limit:10000', 'ok']);
  world.provider.script('assess', 'pr-3', ['permanent']);
}

/** A strict failed report preserves the independent current result and the exact pending operation. */
function expectMixed(report: IFoldReport, until: number = T0 + 10_000): void {
  expect(statuses(report.members)).toEqual({ 'pr-1': 'succeeded', 'pr-2': 'pending', 'pr-3': 'failed' });
  expect(report.outcome).toMatchObject({ status: 'failed', failed: ['pr-3'], cancelled: [], pending: ['pr-2'], openDiscovery: false });
  expect(memberOf(report, 'pr-2')).toMatchObject({ blocked: { kind: 'deferred', operation: received('pr-2')[0]?.operation, notBefore: until } });
}

/** Failure must neither enter the strict fold body nor manufacture its publication. */
function expectNoStrictReport(session: IOperationSession, events: readonly IRunEvent[]): void {
  expect(events.filter((event) => event.kind === 'step' && event.event.step.slot === 'report' && ['claim', 'execute', 'publish'].includes(event.event.phase))).toEqual([]);
  expect(session.history.readCurrent({ analysis, environment: production, subject: 'report:acme/widget' })).toBeUndefined();
}

/** No deferred retry was attempted, slept for, or turned into a synthetic wait lifecycle event. */
function expectImmediateFailure(events: readonly IRunEvent[], floors: readonly number[]): void {
  expect(events.filter((event) => event.kind === 'wait')).toEqual([]);
  expect(events.filter((event) => event.kind === 'operation' && event.phase === 'retry-started')).toEqual([]);
  expect(events.filter((event) => event.kind === 'step' && event.event.phase === 'execute' && event.event.step.slot === 'assess')).toHaveLength(world.keys.length);
  expect(timer.currentEpochMilliseconds()).toBe(T0);
  for (const floor of floors) { expect(timer.scheduled).not.toContain(floor); }
}

describe('failed strict folds retain actual deferred-work receipts (RUN-010/011, CLI-005)', () => {
  test.each(['exit', undefined] as const)('mixed failure returns its deferred floor immediately under %s deferral', async (deferral) => {
    mixedResponses();
    const session = openSession(stores, timer);
    try {
      const started = fold(session, { ...(deferral === undefined ? {} : { deferral }), window: 1, permits: 1 });
      const result = await started.done;
      expectMixed(result.value);
      expectNoStrictReport(session, started.events);
      expectImmediateFailure(started.events, [T0 + 10_000]);
      expect(world.provider.ledger().filter((entry) => entry.kind === 'received').map((entry) => entry.key)).toEqual(['pr-1', 'pr-2', 'pr-3']);
      expect(session.usage().requestAttempts).toBe(3);
      expect(result.stop.level).toBe('none');
      // A terminal failed fold leaves this real sibling waiting even though no wait is performed.
      expect(result.waitingUntil).toBe(T0 + 10_000);
    } finally { session.close(); }
  });

  test('an observed mixed failure closes with the same floor while body disposition and incomplete application remain separate', async () => {
    mixedResponses();
    const session = openSession(stores, timer);
    const directory = mkdtempSync(join(tmpdir(), 'microdelta-failed-fold-receipt-'));
    const host = { sqlite: createNodeSqlite(), reader: createNodeSqliteReader(), random: createNodeRandom(), clock: createNodeClock(), elapsedClock: createNodeElapsedClock(), timer: createNodeTimer() };
    const supervision = createSupervision({ context: machine, timer, observation: host });
    // The authored helper uses the observed run's real operation authority, not the session's unused supervisor.
    useSupervision(supervision);
    const events: IRunEvent[] = [];
    try {
      const observed = supervision.startObserved({
        analysis, environment: production, observationLocation: join(directory, 'run.sqlite'),
        writer: writerFor(session.history, 'observed-failed-fold', 86_400_000),
        operations: { journal: session.journal, accounting: session.accounting, random: createNodeRandom() },
        window: 1, permits: 1,
        observers: [{ observe: (event) => { events.push(event); } }],
        resolution: (ports) => createResolution({
          declarations: session.fixture.builders, composition: session.fixture.composition,
          bindings: { inputs: session.fixture.composition.topology.inputs, helpers: session.fixture.composition.topology.helpers },
          environment: production, history: session.history, tracking: createTrackingObserver(machine), host: machine,
          admission: ports.admission, observer: ports.observer, execution: ports.execution,
        }),
      }, async (run, application) => {
        const report = await run.resolveFold(session.fixture.report, freshKey());
        application.submit({ kind: 'incomplete', reasons: ['required-work'] });
        return report;
      });
      const result = await observed.result;
      expectMixed(result.value);
      expectNoStrictReport(session, events);
      expectImmediateFailure(events, [T0 + 10_000]);
      expect(session.usage().requestAttempts).toBe(3);
      expect(await observed.acknowledgment).toMatchObject({ kind: 'acknowledged' });
      const reader = openExecutionObservationReader(host.reader, observed.locator);
      try {
        expect(reader.read()).toMatchObject({ result: { kind: 'observed', observation: {
          phase: 'closed', body: 'returned', stop: { level: 'none' },
          application: { kind: 'incomplete', reasons: ['required-work'] }, eventCounts: { wait: 0 },
          waitingUntil: T0 + 10_000,
        } } });
      } finally { reader.close(); }
      expect(result.waitingUntil).toBe(T0 + 10_000);
    } finally { session.close(); rmSync(directory, { recursive: true, force: true }); }
  });

  test('several deferred siblings retain their earliest actual floor despite a failed member', async () => {
    world.keys = ['pr-1', 'pr-2', 'pr-3', 'pr-4'];
    world.provider.script('assess', 'pr-2', ['rate-limit:30000']);
    world.provider.script('assess', 'pr-3', ['permanent']);
    world.provider.script('assess', 'pr-4', ['rate-limit:10000']);
    const session = openSession(stores, timer);
    try {
      const started = fold(session, { window: 1, permits: 1 });
      const result = await started.done;
      expect(statuses(result.value.members)).toEqual({ 'pr-1': 'succeeded', 'pr-2': 'pending', 'pr-3': 'failed', 'pr-4': 'pending' });
      expect(result.value.outcome).toMatchObject({ status: 'failed', failed: ['pr-3'], pending: ['pr-2', 'pr-4'] });
      expect(memberOf(result.value, 'pr-2')).toMatchObject({ blocked: { kind: 'deferred', notBefore: T0 + 30_000 } });
      expect(memberOf(result.value, 'pr-4')).toMatchObject({ blocked: { kind: 'deferred', notBefore: T0 + 10_000 } });
      expectNoStrictReport(session, started.events);
      expectImmediateFailure(started.events, [T0 + 10_000, T0 + 30_000]);
      expect(session.usage().requestAttempts).toBe(4);
      expect(result.waitingUntil).toBe(T0 + 10_000);
    } finally { session.close(); }
  });

  test('a final failed request cannot replace a smaller floor already left by a different request', async () => {
    world.provider.script('paid', 'parent', ['rate-limit:5000']);
    world.options['parent'] = { retry: { maxAttempts: 2 } };
    world.gates.open('parent');
    world.provider.script('assess', 'pr-2', ['rate-limit:30000']);
    world.provider.script('assess', 'pr-3', ['permanent']);
    const session = openSession(stores, timer);
    try {
      const started = session.start({ deferral: 'exit', window: 1, permits: 1 }, async (run) => {
        await run.resolve(session.fixture.parent, freshKey());
        return run.resolveFold(session.fixture.report, freshKey());
      });
      const result = await started.done;
      expectMixed(result.value, T0 + 30_000);
      expect(started.events.filter((event) => event.kind === 'wait').map((event) => event.until)).toEqual([T0 + 5_000]);
      expect(timer.scheduled).not.toContain(T0 + 30_000);
      expect(session.usage().requestAttempts).toBe(4);
      expectNoStrictReport(session, started.events);
      expect(result.waitingUntil).toBe(T0 + 5_000);
    } finally { session.close(); }
  });

  test('a terminal failed fold without deferred work has no waiting floor', async () => {
    world.provider.script('assess', 'pr-3', ['permanent']);
    const session = openSession(stores, timer);
    try {
      const started = fold(session);
      const result = await started.done;
      expect(statuses(result.value.members)).toEqual({ 'pr-1': 'succeeded', 'pr-2': 'succeeded', 'pr-3': 'failed' });
      expect(result.value.outcome).toMatchObject({ status: 'failed', pending: [] });
      expectNoStrictReport(session, started.events);
      expectImmediateFailure(started.events, []);
      expect(session.usage().requestAttempts).toBe(3);
      expect(result.waitingUntil).toBeUndefined();
    } finally { session.close(); }
  });

  test('a purely pending exit request still reports its real floor without publishing', async () => {
    world.provider.script('assess', 'pr-2', ['rate-limit:10000']);
    const session = openSession(stores, timer);
    try {
      const started = fold(session, { deferral: 'exit' });
      const result = await started.done;
      expect(result.value.outcome).toEqual({ status: 'waiting', pending: ['pr-2'], openDiscovery: false });
      expect(memberOf(result.value, 'pr-2')).toMatchObject({ blocked: { kind: 'deferred', notBefore: T0 + 10_000 } });
      expectNoStrictReport(session, started.events);
      expect(started.events.filter((event) => event.kind === 'wait').map((event) => [event.phase, event.until])).toEqual([['exiting', T0 + 10_000]]);
      expect(result.waitingUntil).toBe(T0 + 10_000);
    } finally { session.close(); }
  });

  test('successful default sleep resumes the deferred work and leaves no stale waiting floor', async () => {
    world.provider.script('assess', 'pr-2', ['rate-limit:10000', 'ok']);
    const session = openSession(stores, timer);
    try {
      const started = fold(session, { window: 1, permits: 1 });
      await until(() => timer.pending().includes(T0 + 10_000), 'the genuine deferred sleep');
      expect(received('pr-2')).toHaveLength(1);
      timer.advanceTo(T0 + 9_999);
      await new Promise<void>((resolve) => { setImmediate(resolve); });
      expect(received('pr-2')).toHaveLength(1);
      timer.advanceTo(T0 + 10_000);
      const result = await started.done;
      expect(statuses(result.value.members)).toEqual({ 'pr-1': 'succeeded', 'pr-2': 'succeeded', 'pr-3': 'succeeded' });
      expect(result.value.outcome.status).toBe('succeeded');
      expect(received('pr-2')).toHaveLength(2);
      expect(received('pr-2')[1]?.operation).toBe(received('pr-2')[0]?.operation);
      expect(started.events.filter((event) => event.kind === 'wait').map((event) => [event.phase, event.until])).toEqual([['sleeping', T0 + 10_000], ['resumed', T0 + 10_000]]);
      expect(session.usage().requestAttempts).toBe(4);
      expect(result.waitingUntil).toBeUndefined();
    } finally { session.close(); }
  });

  test('a fresh run before the retained floor sends and claims no deferred member work', async () => {
    mixedResponses();
    const firstSession = openSession(stores, timer);
    try { await fold(firstSession, { deferral: 'exit', window: 1, permits: 1 }).done; }
    finally { firstSession.close(); }
    const sentBefore = [...received('pr-2')];
    // A new run may reattempt the failed sibling independently; keep its refusal explicit.
    world.provider.script('assess', 'pr-3', ['permanent']);
    timer.advanceTo(T0 + 5_000);
    const session = openSession(stores, timer);
    try {
      const started = fold(session, { deferral: 'exit', window: 1, permits: 1 });
      const result = await started.done;
      expectMixed(result.value);
      expect(received('pr-2')).toEqual(sentBefore);
      expect(started.events.filter((event) => event.kind === 'step' && event.event.step.memberKey === 'pr-2' && ['claim', 'execute', 'publish'].includes(event.event.phase))).toEqual([]);
      expect(started.events).toContainEqual(expect.objectContaining({ kind: 'operation', phase: 'blocked', reason: 'not-before', operation: sentBefore[0]?.operation }));
      expect(session.usage().requestAttempts).toBe(4);
      expectNoStrictReport(session, started.events);
      expect(result.waitingUntil).toBe(T0 + 10_000);
    } finally { session.close(); }
  });
});
