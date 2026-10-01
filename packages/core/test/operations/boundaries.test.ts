/**
 * Boundary cases of external operations on the real packages, from the
 * independent review of the first submission. Each case states the rule it
 * pins; the expected values are written by hand from the owner decisions and
 * EXP-8:
 *
 * - a stop refuses a resumable deferral at admission, even for the child of a
 *   draining step, so the resumed body never runs (RUN-014, EXP-8 drain unit);
 * - the writer lease is released only when no pass is active, including when
 *   the last active pass ends while another request sleeps (EXP-8
 *   resolution 1);
 * - an operation in flight in this run is never judged dead: a second call
 *   at the same address, or another request's admission, is refused instead
 *   of recovering it as unknown;
 * - provider idempotency keys are unique across stores sharing a provider
 *   account, so one store's request is never deduplicated against another's;
 * - an Accounting intent that is not durable sends nothing and leaves the
 *   member pending (retried after a short delay), never failed (ACC-007);
 * - a sleeping run that wakes while another holder has the lease returns
 *   waiting rather than failing;
 * - an attempt that ended sends nothing more;
 * - a caller's request key cannot collide with a derived pass key;
 * - Resolution's relaxed historical check still refuses a dependency of
 *   another analysis (RUN-017, RES-007).
 *
 * @see ../../../../docs/spec/operations.md (RUN-011, RUN-012, RUN-014, RUN-017, ACC-007)
 * @see ../../../../experiments/exp-8/decision.md (mechanisms 1, 3, 5; resolution 1)
 */

import { afterEach, beforeEach, describe, expect, test } from '@jest/globals';
import { createNodeSqlite } from '@microdelta/machine-node';
import { ResolutionError } from '@microdelta/resolution';
import { SupervisionError, createStopController } from '@microdelta/supervision';
import type { ICompletedResultReference } from '@microdelta/history';

import { faultySqlite } from '../accounting/support.js';
import { createWorld, installWorld } from './fixture.js';
import type { IWorld } from './fixture.js';
import { T0, fakeTimer, freshKey, hour, openSession, statuses, tempStores, until } from './harness.js';
import type { IFakeTimer, IOperationStores } from './harness.js';
import { applied, driveUntilSettled, failureCode, fold, journalContents, memberOf, members, received } from './support.js';

let stores: IOperationStores;
let timer: IFakeTimer;
let world: IWorld;

beforeEach(() => {
  stores = tempStores();
  timer = fakeTimer();
  world = installWorld(createWorld(() => timer.currentEpochMilliseconds(), ['pr-1', 'pr-2', 'pr-3'], stores.ledger));
});

afterEach(() => {
  stores.remove();
});

/** A fresh world over the same persisted provider ledger, standing in for a new process. */
function newWorld(keys: readonly string[] = ['pr-1', 'pr-2', 'pr-3']): IWorld {
  world = installWorld(createWorld(() => timer.currentEpochMilliseconds(), keys, stores.ledger));
  return world;
}

/** The Supervision code a promise rejects with. */
function codeOf(pending: Promise<unknown>): Promise<string> {
  return pending.then(() => 'resolved', (error: unknown) => error instanceof SupervisionError || error instanceof ResolutionError ? error.code : 'other');
}

describe('stop intent and resumed deferrals (RUN-014)', () => {
  test('a stop refuses a resumable deferral at admission, even for the child of a draining step, so the resumed body never runs', async () => {
    world.gates.open('parent');
    world.provider.script('paid', 'parent', ['rate-limit:3600000']);
    const a = openSession(stores, timer);
    try {
      const first = await a.start({ deferral: 'exit' }, (run) => run.resolve(a.fixture.parent, freshKey())).done;
      expect(first.waitingUntil).toBe(T0 + hour);
    } finally {
      a.close();
    }
    timer.advanceTo(T0 + hour + 1);
    newWorld();
    const b = openSession(stores, timer);
    try {
      const stop = createStopController();
      const started = b.start({ deferral: 'exit', stop }, (run) => run.resolve(b.fixture.parent, freshKey()));
      await until(() => world.log.includes('waiting:parent'), 'the parent is admitted and draining');
      stop.request({ level: 'soft' });
      world.gates.open('parent');
      const result = await started.done;
      expect(result.value.kind).toBe('refused');
      // The child's resumed deferral was refused before its body ran: nothing was retried.
      expect(world.log).not.toContain('paid-start');
      expect(received('parent', 'paid')).toHaveLength(1);
    } finally {
      b.close();
    }
  });
});

describe('the writer lease while a request sleeps (EXP-8 resolution 1)', () => {
  test('the lease is kept while another pass is active, and released when the last active pass ends while a request sleeps', async () => {
    world.provider.script('assess', 'pr-1', ['rate-limit:3600000']);
    const session = openSession(stores, timer);
    try {
      const started = session.start({}, (run) => Promise.all([
        run.resolveMembers({ template: 'pr', step: 'assess' }, freshKey()),
        run.resolve(session.fixture.parent, freshKey()),
      ]));
      await until(() => started.events.some((event) => event.kind === 'wait' && event.phase === 'sleeping'), 'the members request sleeps');
      await until(() => world.log.includes('waiting:parent'), 'the parent pass is active');
      // Another pass is active: the lease is held, and no other holder can take it.
      expect(started.events.find((event) => event.kind === 'wait')).toEqual(expect.objectContaining({ phase: 'sleeping', released: false }));
      expect(session.history.currentWriter()).toBeDefined();
      expect(session.history.acquireWriter({ holder: 'probe', leaseMilliseconds: 1_000 }).kind).toBe('held');
      // The last active pass ends while the members request still sleeps: only deferred work remains.
      world.gates.open('parent');
      await until(() => session.history.currentWriter() === undefined, 'the lease is released once only deferred work remains');
      timer.advanceTo(T0 + hour);
      const result = await started.done;
      expect(statuses(result.value[0].members)).toEqual({ 'pr-1': 'succeeded', 'pr-2': 'succeeded', 'pr-3': 'succeeded' });
      expect(result.value[1].kind).toBe('published');
    } finally {
      session.close();
    }
  });

  test('a woken pass without a writer-wait deadline waits for the lease, sends nothing while another holder has it, and completes once it is released', async () => {
    world.provider.script('assess', 'pr-1', ['rate-limit:3600000']);
    const session = openSession(stores, timer);
    try {
      const started = members(session);
      await until(() => started.events.some((event) => event.kind === 'wait' && event.phase === 'sleeping'), 'the run sleeps');
      const probe = session.history.acquireWriter({ holder: 'probe', leaseMilliseconds: 10 * hour });
      if (probe.kind !== 'acquired') {
        throw new Error('the probe did not acquire the lease');
      }
      timer.advanceTo(T0 + hour);
      // No default deadline: the woken pass polls for the lease on the default one-second interval and does not return.
      for (let poll = 1; poll <= 3; poll += 1) {
        await until(() => timer.pending().includes(T0 + hour + poll * 1_000), `the woken pass polls (${String(poll)})`);
        timer.advanceTo(T0 + hour + poll * 1_000);
      }
      let settled = false;
      void started.done.then(() => {
        settled = true;
      }, () => {
        settled = true;
      });
      await until(() => timer.pending().includes(T0 + hour + 4_000), 'the woken pass keeps waiting');
      expect(settled).toBe(false);
      expect(received('pr-1')).toHaveLength(1);
      session.history.releaseWriter(probe.lease);
      timer.advanceTo(T0 + hour + 4_000);
      const result = await started.done;
      expect(statuses(result.value.members)).toEqual({ 'pr-1': 'succeeded', 'pr-2': 'succeeded', 'pr-3': 'succeeded' });
      expect(result.waitingUntil).toBeUndefined();
      expect(started.events.filter((event) => event.kind === 'wait').map((event) => event.kind === 'wait' ? event.phase : '')).toEqual(['sleeping', 'resumed']);
      expect(received('pr-1')).toHaveLength(2);
    } finally {
      session.close();
    }
  });

  test('a soft stop during a woken pass\'s wait for the lease returns the earlier report with waitingUntil, as a stop during the sleep does (#139)', async () => {
    world.provider.script('assess', 'pr-1', ['rate-limit:3600000']);
    const session = openSession(stores, timer);
    try {
      const stop = createStopController();
      const started = members(session, { stop });
      await until(() => started.events.some((event) => event.kind === 'wait' && event.phase === 'sleeping'), 'the run sleeps');
      expect(session.history.acquireWriter({ holder: 'probe', leaseMilliseconds: 10 * hour }).kind).toBe('acquired');
      timer.advanceTo(T0 + hour);
      await until(() => timer.pending().includes(T0 + hour + 1_000), 'the woken pass waits for the lease');
      stop.request({ level: 'soft' });
      // The caller keeps its sibling report: the stop ends the wait, not the request.
      const result = await started.done;
      expect(result.waitingUntil).toBe(T0 + hour);
      expect(statuses(result.value.members)).toEqual({ 'pr-1': 'pending', 'pr-2': 'succeeded', 'pr-3': 'succeeded' });
      expect(started.events.filter((event) => event.kind === 'wait').map((event) => event.kind === 'wait' ? event.phase : '')).toEqual(['sleeping', 'resumed', 'stopped']);
      expect(received('pr-1')).toHaveLength(1);
      expect(journalContents(session)).toContainEqual(expect.objectContaining({ member: 'pr-1', status: 'deferred', notBefore: T0 + hour }));
    } finally {
      session.close();
    }
  });
});

describe('waking with a writer-wait deadline', () => {
  test('a woken request waits for the lease under the run\'s deadline, as any normal request does, and resumes once the holder lets go', async () => {
    world.provider.script('assess', 'pr-1', ['rate-limit:3600000']);
    const session = openSession(stores, timer);
    try {
      const started = members(session, { writerWait: { deadline: T0 + 2 * hour, pollMilliseconds: 60_000 } });
      await until(() => started.events.some((event) => event.kind === 'wait' && event.phase === 'sleeping'), 'the run sleeps');
      const probe = session.history.acquireWriter({ holder: 'probe', leaseMilliseconds: 10 * hour });
      if (probe.kind !== 'acquired') {
        throw new Error('the probe did not acquire the lease');
      }
      timer.advanceTo(T0 + hour);
      // Woken: it polls for the lease rather than returning, and sends nothing while another holder has it.
      await until(() => timer.pending().includes(T0 + hour + 60_000), 'the woken request polls for the lease');
      expect(received('pr-1')).toHaveLength(1);
      session.history.releaseWriter(probe.lease);
      timer.advanceTo(T0 + hour + 60_000);
      const result = await started.done;
      expect(statuses(result.value.members)).toEqual({ 'pr-1': 'succeeded', 'pr-2': 'succeeded', 'pr-3': 'succeeded' });
      expect(result.waitingUntil).toBeUndefined();
      expect(started.events.filter((event) => event.kind === 'wait').map((event) => event.kind === 'wait' ? event.phase : '')).toEqual(['sleeping', 'resumed']);
    } finally {
      session.close();
    }
  });

  test('a woken request whose deadline passes while another holder keeps the lease fails with writer-busy, as any normal request does', async () => {
    world.provider.script('assess', 'pr-1', ['rate-limit:3600000']);
    const session = openSession(stores, timer);
    try {
      const started = members(session, { writerWait: { deadline: T0 + hour + 30_000, pollMilliseconds: 60_000 } });
      await until(() => started.events.some((event) => event.kind === 'wait' && event.phase === 'sleeping'), 'the run sleeps');
      expect(session.history.acquireWriter({ holder: 'probe', leaseMilliseconds: 10 * hour }).kind).toBe('acquired');
      timer.advanceTo(T0 + hour);
      await until(() => timer.pending().includes(T0 + hour + 30_000), 'the woken request waits until its deadline');
      timer.advanceTo(T0 + hour + 30_000);
      expect(await codeOf(started.done)).toBe('writer-busy');
      expect(received('pr-1')).toHaveLength(1);
    } finally {
      session.close();
    }
  });
});

describe('operations in flight in this run are never judged dead', () => {
  test('a second call at the same address while the first is in flight is refused, and the first settles normally', async () => {
    world.keys = ['pr-1'];
    world.plans['pr-1'] = 'concurrent';
    world.provider.script('assess', 'pr-1', ['hang']);
    const session = openSession(stores, timer);
    try {
      const started = members(session);
      await until(() => received('pr-1').length === 1 && world.provider.inFlight === 1, 'the first call is in flight');
      world.gates.open('pr-1:second');
      await until(() => world.log.some((line) => line.startsWith('pr-1:second')), 'the second call settled');
      world.provider.release('assess', 'pr-1');
      await started.done;
      expect(world.log).toEqual(['pr-1:second:invalid-request', 'pr-1:first:succeeded']);
      expect(received('pr-1')).toHaveLength(1);
    } finally {
      session.close();
    }
  });

  test('two calls at the same address started in the same turn make one operation and one send', async () => {
    world.keys = ['pr-1'];
    world.plans['pr-1'] = 'twin';
    const session = openSession(stores, timer);
    try {
      await members(session).done;
      expect(world.log).toEqual(['pr-1:twin:succeeded,invalid-request']);
      expect(received('pr-1')).toHaveLength(1);
    } finally {
      session.close();
    }
  });

  test('another request of the same run is denied admission while the operation is in flight, never recovering it as unknown', async () => {
    world.provider.script('assess', 'pr-1', ['hang']);
    const session = openSession(stores, timer);
    try {
      const started = session.start({ permits: 3 }, async (run) => {
        const first = run.resolveMembers({ template: 'pr', step: 'assess' }, freshKey());
        await until(() => received('pr-1').length === 1 && world.provider.inFlight === 1, 'pr-1 is in flight');
        const second = await run.resolveMembers({ template: 'pr', step: 'assess' }, freshKey());
        world.provider.release('assess', 'pr-1');
        return [await first, second] as const;
      });
      const result = await started.done;
      const [first, second] = result.value;
      const pr1 = memberOf(second, 'pr-1');
      expect(pr1.status).toBe('pending');
      expect(pr1.status === 'pending' ? pr1.blocked : 'not pending').toBeUndefined();
      expect(memberOf(first, 'pr-1').status).toBe('succeeded');
      expect(started.events.some((event) => event.kind === 'operation' && event.phase === 'recovered')).toBe(false);
      expect(received('pr-1')).toHaveLength(1);
    } finally {
      session.close();
    }
  });
});

describe('provider idempotency keys are globally unique', () => {
  test('two stores that mint the same attempt numbers and share one provider account send different keys, so neither request is dropped', async () => {
    world.options['pr-1'] = { providerIdempotency: true };
    world.keys = ['pr-1'];
    const first = openSession(stores, timer);
    try {
      await members(first).done;
    } finally {
      first.close();
    }
    const other = tempStores();
    try {
      const second = openSession({ history: other.history, accounting: other.accounting }, timer);
      try {
        await members(second).done;
      } finally {
        second.close();
      }
    } finally {
      other.remove();
    }
    const keys = received('pr-1').map((entry) => entry.idempotencyKey);
    expect(keys).toHaveLength(2);
    expect(keys[0]).not.toBe(keys[1]);
    expect(applied('pr-1')).toHaveLength(2);
  });
});

describe('an Accounting intent that is not durable (ACC-007)', () => {
  test('a busy Accounting store sends nothing and leaves the member pending, retried once the store is free', async () => {
    world.keys = ['pr-1'];
    const session = openSession(stores, timer);
    const holder = createNodeSqlite().openSqlite(stores.accounting);
    try {
      holder.exec('BEGIN IMMEDIATE');
      const result = await members(session, { deferral: 'exit' }).done;
      holder.exec('ROLLBACK');
      // AccountingBusyError: nothing was sent, and the member waits rather than failing.
      expect(memberOf(result.value, 'pr-1')).toEqual(expect.objectContaining({ status: 'pending', blocked: expect.objectContaining({ kind: 'deferred' }) }));
      expect(result.waitingUntil).toBeDefined();
      expect(received('pr-1')).toHaveLength(0);
      timer.advanceTo(result.waitingUntil ?? T0);
      const retried = await members(session, { deferral: 'exit' }).done;
      expect(memberOf(retried.value, 'pr-1').status).toBe('succeeded');
      expect(received('pr-1')).toHaveLength(1);
      expect(session.usage()).toEqual(expect.objectContaining({ status: 'complete', observed: [{ unit: 'tokens', amount: 100 }] }));
    } finally {
      holder.close();
      session.close();
    }
  });

  test('an intent whose commit is not confirmed sends nothing, leaves the member pending, and sleep mode retries it', async () => {
    world.keys = ['pr-1'];
    const faulty = faultySqlite();
    const session = openSession(stores, timer, { accountingSqlite: faulty.capability });
    try {
      // AccountingDurabilityUnknownError: the work ran, the commit did not confirm.
      faulty.arm({ role: 'intent', timing: 'before-commit', action: 'throw' });
      const started = members(session);
      const result = await driveUntilSettled(timer, started);
      expect(memberOf(result.value, 'pr-1').status).toBe('succeeded');
      expect(started.events.filter((event) => event.kind === 'wait').map((event) => event.kind === 'wait' ? event.phase : '')).toEqual(['sleeping', 'resumed']);
      expect(received('pr-1')).toHaveLength(1);
      expect(applied('pr-1')).toHaveLength(1);
      expect(session.usage()).toEqual(expect.objectContaining({ status: 'complete', requestAttempts: 1 }));
    } finally {
      session.close();
    }
  });
});

describe('an intent that landed though its commit was not confirmed (ACC-007, ACC-005)', () => {
  test('the retry reuses the unsent request attempt, so the landed intent gets its usage and the summary is complete with one intent', async () => {
    world.keys = ['pr-1'];
    const faulty = faultySqlite();
    const session = openSession(stores, timer, { accountingSqlite: faulty.capability });
    try {
      // The intent commits, then the adapter cannot confirm it: AccountingDurabilityUnknownError with the intent durable.
      faulty.arm({ role: 'intent', timing: 'after-commit', action: 'throw' });
      const result = await driveUntilSettled(timer, members(session));
      expect(memberOf(result.value, 'pr-1').status).toBe('succeeded');
      expect(received('pr-1')).toHaveLength(1);
      const [request] = received('pr-1');
      // Exactly one intent, the landed one, and it has its usage: nothing reads unknown forever.
      expect(session.usage()).toEqual(expect.objectContaining({ status: 'complete', requestAttempts: 1, reports: 1, unknown: [] }));
      expect(request?.requestAttempt.endsWith('/1')).toBe(true);
    } finally {
      session.close();
    }
  });
});

describe('the backoff of non-durable intents and the shape of identities', () => {
  test('consecutive non-durable intents of one operation back off 1 s, doubling, capped at 60 s, recorded durably', async () => {
    world.keys = ['pr-1'];
    const faulty = faultySqlite();
    const session = openSession(stores, timer, { accountingSqlite: faulty.capability });
    try {
      const delays: number[] = [];
      for (let round = 0; round < 8; round += 1) {
        faulty.arm({ role: 'intent', timing: 'before-commit', action: 'throw' });
        const before = timer.currentEpochMilliseconds();
        const result = await members(session, { deferral: 'exit' }).done;
        expect(memberOf(result.value, 'pr-1').status).toBe('pending');
        const deferred = journalContents(session).find((content) => typeof content === 'object' && content !== null && Reflect.get(content, 'member') === 'pr-1');
        const notBefore: unknown = typeof deferred === 'object' && deferred !== null ? Reflect.get(deferred, 'notBefore') : undefined;
        expect(result.waitingUntil).toBe(notBefore);
        delays.push(typeof notBefore === 'number' ? notBefore - before : Number.NaN);
        timer.advanceTo(typeof notBefore === 'number' ? notBefore : before);
      }
      expect(delays).toEqual([1_000, 2_000, 4_000, 8_000, 16_000, 32_000, 60_000, 60_000]);
      expect(received('pr-1')).toHaveLength(0);
      const done = await members(session, { deferral: 'exit' }).done;
      expect(memberOf(done.value, 'pr-1').status).toBe('succeeded');
      expect(session.usage()).toEqual(expect.objectContaining({ status: 'complete', requestAttempts: 1 }));
    } finally {
      session.close();
    }
  });

  test('an identifier from the random source that is not exactly 32 lowercase hexadecimal characters is refused before anything is sent', async () => {
    world.keys = ['pr-1'];
    const session = openSession(stores, timer, { random: { randomIdentifier: () => '0123456789abcdefghij0123456789ab' } });
    try {
      const result = await members(session).done;
      expect(failureCode(memberOf(result.value, 'pr-1'))).toBe('invalid-request');
      expect(received('pr-1')).toHaveLength(0);
      expect(journalContents(session)).toEqual([]);
    } finally {
      session.close();
    }
  });
});

describe('operations follow-ups (#139)', () => {
  test('a durable intent resets the backoff: after Accounting recovers, the next non-durable intent waits 1 s again', async () => {
    world.keys = ['pr-1'];
    world.provider.script('assess', 'pr-1', ['rate-limit:60000', 'ok']);
    const faulty = faultySqlite();
    const session = openSession(stores, timer, { accountingSqlite: faulty.capability });
    /** Run once in exit mode and report the deferral's delay from this run's start. */
    const delayOfRun = async (): Promise<number> => {
      const before = timer.currentEpochMilliseconds();
      const result = await members(session, { deferral: 'exit' }).done;
      const until = result.waitingUntil;
      if (until === undefined) {
        throw new Error('the run left nothing waiting');
      }
      timer.advanceTo(until);
      return until - before;
    };
    try {
      // 1: a non-durable intent backs off 1 s.
      faulty.arm({ role: 'intent', timing: 'before-commit', action: 'throw' });
      const first = await delayOfRun();
      // 2: a durable intent; the request is rate-limited for 60 s, so the operation needs another attempt.
      const second = await delayOfRun();
      // 3: a non-durable intent again backs off from 1 s, not from where the earlier failure left it.
      faulty.arm({ role: 'intent', timing: 'before-commit', action: 'throw' });
      const third = await delayOfRun();
      expect([first, second, third]).toEqual([1_000, 60_000, 1_000]);
      expect(received('pr-1')).toHaveLength(1);
      const done = await members(session, { deferral: 'exit' }).done;
      expect(memberOf(done.value, 'pr-1').status).toBe('succeeded');
    } finally {
      session.close();
    }
  });

  test('settling an operation waits for the writer lease while another holder has it briefly, then records the settlement', async () => {
    world.keys = ['pr-1'];
    world.provider.script('assess', 'pr-1', ['lost']);
    const session = openSession(stores, timer);
    try {
      await members(session).done;
      const operation = received('pr-1')[0]?.operation ?? 'none';
      const probe = session.history.acquireWriter({ holder: 'probe', leaseMilliseconds: hour });
      if (probe.kind !== 'acquired') {
        throw new Error('the probe did not acquire the lease');
      }
      const started = session.start({}, (run) => run.settleOperation({ action: 'abandon', operation, operator: 'operator.ada' }));
      let settled = false;
      void started.done.then(() => {
        settled = true;
      }, () => {
        settled = true;
      });
      const now = timer.currentEpochMilliseconds();
      await until(() => timer.pending().includes(now + 1_000), 'the settlement waits for the lease');
      expect(settled).toBe(false);
      session.history.releaseWriter(probe.lease);
      timer.advanceTo(now + 1_000);
      expect((await started.done).value.status).toBe('abandoned');
    } finally {
      session.close();
    }
  });

  test('after AccountingDurabilityUnknownError the unsent attempt is reused with its first attribution: one intent, credited to the run that recorded it', async () => {
    world.keys = ['pr-1'];
    const faulty = faultySqlite();
    const session = openSession(stores, timer, { accountingSqlite: faulty.capability });
    try {
      // The intent lands, then its commit is not confirmed.
      faulty.arm({ role: 'intent', timing: 'after-commit', action: 'throw' });
      const a = await members(session, { deferral: 'exit', runId: 'run:A' }).done;
      timer.advanceTo(a.waitingUntil ?? T0);
      const b = await members(session, { deferral: 'exit', runId: 'run:B' }).done;
      expect(memberOf(b.value, 'pr-1').status).toBe('succeeded');
      expect(received('pr-1').map((entry) => entry.requestAttempt.split('/').at(-1))).toEqual(['1']);
      expect(session.usage()).toEqual(expect.objectContaining({ status: 'complete', requestAttempts: 1, reports: 1 }));
      expect(session.accounting.summarizeUsage({ environment: 'env:production', run: 'run:A' })).toEqual(expect.objectContaining({ requestAttempts: 1, reports: 1 }));
      expect(session.accounting.summarizeUsage({ environment: 'env:production', run: 'run:B' })).toEqual(expect.objectContaining({ requestAttempts: 0, reports: 0 }));
    } finally {
      session.close();
    }
  });

  test('after AccountingBusyError, which recorded nothing, a fresh attempt is minted with the current attribution: one intent, credited to the run that sent it', async () => {
    world.keys = ['pr-1'];
    const session = openSession(stores, timer);
    const holder = createNodeSqlite().openSqlite(stores.accounting);
    try {
      holder.exec('BEGIN IMMEDIATE');
      const a = await members(session, { deferral: 'exit', runId: 'run:A' }).done;
      holder.exec('ROLLBACK');
      timer.advanceTo(a.waitingUntil ?? T0);
      const b = await members(session, { deferral: 'exit', runId: 'run:B' }).done;
      expect(memberOf(b.value, 'pr-1').status).toBe('succeeded');
      // The never-recorded attempt stays in the record as not sent; the send is a fresh request attempt.
      expect(received('pr-1').map((entry) => entry.requestAttempt.split('/').at(-1))).toEqual(['2']);
      expect(journalContents(session)).toContainEqual(expect.objectContaining({
        member: 'pr-1',
        status: 'succeeded',
        attempts: [expect.objectContaining({ status: 'not-sent', run: 'run:A' }), expect.objectContaining({ status: 'succeeded', run: 'run:B' })],
      }));
      expect(session.usage()).toEqual(expect.objectContaining({ status: 'complete', requestAttempts: 1, reports: 1 }));
      expect(session.accounting.summarizeUsage({ environment: 'env:production', run: 'run:B' })).toEqual(expect.objectContaining({ requestAttempts: 1, reports: 1 }));
      expect(session.accounting.summarizeUsage({ environment: 'env:production', run: 'run:A' })).toEqual(expect.objectContaining({ requestAttempts: 0, reports: 0 }));
    } finally {
      holder.close();
      session.close();
    }
  });
});

describe('ended attempts and request keys', () => {
  test('an operation an ended attempt starts later is refused and sends nothing', async () => {
    world.keys = ['pr-1'];
    world.plans['pr-1'] = 'detached';
    const session = openSession(stores, timer);
    try {
      const result = await session.start({}, async (run) => {
        const report = await run.resolveMembers({ template: 'pr', step: 'assess' }, freshKey());
        world.gates.open('pr-1:late');
        await until(() => world.log.some((line) => line.includes('detached')), 'the detached call settled');
        return report;
      }).done;
      expect(memberOf(result.value, 'pr-1').status).toBe('succeeded');
      expect(world.log).toEqual(['caught-detached:pr-1:invalid-request']);
      expect(received('pr-1')).toHaveLength(0);
    } finally {
      session.close();
    }
  });

  test('a caller request key cannot take the reserved pass separator, so it never collides with a derived pass key', async () => {
    const session = openSession(stores, timer);
    try {
      const codes = await session.start({}, (run) => Promise.all([
        codeOf(run.resolveMembers({ template: 'pr', step: 'assess' }, { requestKey: 'request#pass:2' })),
        codeOf(run.resolveFold(session.fixture.report, { requestKey: 'request#pass:3' })),
        codeOf(run.resolve(session.fixture.parent, { requestKey: 'x#pass:2' })),
      ])).done;
      expect(codes.value).toEqual(['invalid-request', 'invalid-request', 'invalid-request']);
      expect(world.provider.ledger()).toEqual([]);
    } finally {
      session.close();
    }
  });
});

describe("Resolution's relaxed historical check (RUN-017, RES-007)", () => {
  test('a candidate whose recorded dependency belongs to another analysis is integrity damage, never reused', async () => {
    let foreign: ICompletedResultReference | undefined;
    const first = openSession(stores, timer);
    try {
      const report = await fold(first).done;
      const pr1 = memberOf(report.value, 'pr-1');
      foreign = pr1.status === 'succeeded' ? pr1.outcome.reference : undefined;
      expect(report.value.outcome.status).toBe('succeeded');
    } finally {
      first.close();
    }
    const damaged = openSession(stores, timer, {
      wrapHistory: (history) => ({
        ...history,
        // The port presents pr-1's recorded member result as another analysis's, as damaged evidence would.
        readEnvelope: (reference) => {
          const envelope = history.readEnvelope(reference);
          return reference.locator === foreign?.locator ? { ...envelope, analysis: 'analysis:other' } : envelope;
        },
      }),
    });
    try {
      expect(await codeOf(fold(damaged).done)).toBe('integrity');
    } finally {
      damaged.close();
    }
  });
});
