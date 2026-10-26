/**
 * Controlled composition of the real History, Accounting, Resolution and
 * Supervision packages for #238. Expected sends and floors come from the
 * fixed handoff, A-12e/h/k and #235 acceptance-time semantics. Advanced fair
 * rounds, adaptive policy and serial recovery are deliberately unqualified.
 */
import { afterEach, beforeEach, describe, expect, test } from '@jest/globals';
import { createSharedRateCoordinator, createStopController } from '@microdelta/supervision';
import type { IOperationSharedRate, IRetryDecision, IRetrySourceScope, ISharedRateDispatchOptions } from '@microdelta/supervision';

import { cleanup, rawReaderCount } from '../durable-history/support.js';
import { createWorld, installWorld } from './fixture.js';
import type { IWorld } from './fixture.js';
import { T0, openSession, production, tempStores, until } from './harness.js';
import type { IFakeTimer, IOperationStores } from './harness.js';
import { journalContents, memberOf, members, received } from './support.js';

/** Epoch corrections and early timer callbacks are controlled independently of elapsed time. */
interface IControlledTimer extends IFakeTimer {
  correctTo(epoch: number): void;
  wakeEarly(): void;
}

/** A timer callback grants only a chance to recheck, including if the host wakes early. */
function controlledTimer(): IControlledTimer {
  let epoch = T0;
  const callbacks: { readonly at: number; readonly callback: () => void; active: boolean }[] = [];
  const timer: IControlledTimer = {
    currentEpochMilliseconds: () => epoch,
    schedule(at, callback) {
      const entry = { at, callback, active: true };
      callbacks.push(entry);
      return () => { entry.active = false; };
    },
    pending: () => callbacks.filter((entry) => entry.active).map((entry) => entry.at),
    correctTo(value) { epoch = value; },
    advanceTo(value) {
      epoch = value;
      for (const entry of callbacks.filter((candidate) => candidate.active && candidate.at <= value)) {
        entry.active = false;
        entry.callback();
      }
    },
    wakeEarly() {
      const entry = callbacks.find((candidate) => candidate.active);
      if (entry === undefined) { throw new Error('No controlled wake was armed'); }
      entry.active = false;
      entry.callback();
    },
  };
  return timer;
}

/** Bounded event-loop drainage exposes no-send assertions without an arbitrary wall delay. */
async function settle(): Promise<void> {
  for (let round = 0; round < 5; round += 1) { await new Promise<void>((resolve) => { setImmediate(resolve); }); }
}

let stores: IOperationStores;
let timer: IControlledTimer;
let world: IWorld;
let elapsed: number;
let sharedRates: ISharedRateDispatchOptions;

beforeEach(() => {
  stores = tempStores();
  timer = controlledTimer();
  elapsed = 0;
  const elapsedClock = { currentElapsedMilliseconds: () => elapsed };
  sharedRates = { coordinator: createSharedRateCoordinator({ epochClock: timer, elapsedClock }), elapsedClock };
  world = installWorld(createWorld(() => timer.currentEpochMilliseconds(), ['pr-1', 'pr-2'], stores.ledger));
});

afterEach(() => {
  try { cleanup(); expect(rawReaderCount()).toBe(0); } finally { stores.remove(); }
});

/** A registered API scope with optional overlapping memberships. */
function association(account = 'account:a', surface = 'catalog', narrow = false): IOperationSharedRate {
  return { surface: sharedRates.coordinator.registerSurface({ environment: production, service: 'catalog', accessContext: account, surface,
    gates: [{ id: 'api' }, ...(narrow ? [{ id: 'search' }] : [])],
  }), cooldownGateId: narrow ? 'search' : 'api' };
}

/** The adapter family is independent of the explicitly registered logical surface. */
const source: IRetrySourceScope = { source: 'fixture-adapter', service: 'catalog', connection: 'account:a' };

describe('fixed shared admission across real owner boundaries (#238)', () => {
  test('a shared cooldown wait holds neither a request permit nor Accounting intent while an unrelated member progresses', async () => {
    const rate = association();
    world.options['pr-1'] = { sharedRate: rate, retry: { maxAttempts: 1 } };
    world.options['pr-2'] = { sharedRate: association('account:b'), retry: { maxAttempts: 1 } };
    sharedRates.coordinator.observeCooldown(rate.surface, 'api', T0 + 100);
    const session = openSession(stores, timer, { sharedRates });
    try {
      const run = members(session, { permits: 1 });
      await until(() => received('pr-2').length === 1 && timer.pending().length > 0, 'independent member sends while the matching member waits');
      expect(received('pr-1')).toHaveLength(0);
      expect(session.usage()).toMatchObject({ requestAttempts: 1, reports: 1 });
      expect(journalContents(session)).toHaveLength(1);
      timer.wakeEarly();
      await settle();
      expect(received('pr-1')).toHaveLength(0);
      expect(timer.pending()).toContain(T0 + 100);
      timer.advanceTo(T0 + 99);
      await settle();
      expect(received('pr-1')).toHaveLength(0);
      timer.advanceTo(T0 + 100);
      const result = await run.done;
      expect(memberOf(result.value, 'pr-1').status).toBe('succeeded');
      expect(session.usage()).toMatchObject({ requestAttempts: 2, reports: 2, unknown: [] });
    } finally { session.close(); }
  });

  test('a narrow refusal floor does not narrow all-gate admission or block catalog on the same API', async () => {
    const search = association('account:a', 'search', true);
    const catalog = association();
    world.options['pr-1'] = { sharedRate: search };
    world.options['pr-2'] = { sharedRate: catalog };
    sharedRates.coordinator.observeCooldown(search.surface, 'search', T0 + 50);
    sharedRates.coordinator.observeCooldown(search.surface, 'api', T0 + 100);
    const session = openSession(stores, timer, { sharedRates });
    try {
      const run = members(session);
      await until(() => timer.pending().length >= 2, 'both requests wait for their full gate union');
      timer.advanceTo(T0 + 50);
      await settle();
      expect(received('pr-1')).toHaveLength(0);
      expect(received('pr-2')).toHaveLength(0);
      // A new narrower floor affects only search after the API floor passes.
      sharedRates.coordinator.observeCooldown(search.surface, 'search', T0 + 150);
      timer.advanceTo(T0 + 100);
      await until(() => received('pr-2').length === 1, 'catalog passes the API floor');
      expect(received('pr-1')).toHaveLength(0);
      timer.advanceTo(T0 + 150);
      await run.done;
      expect(received('pr-1')).toHaveLength(1);
    } finally { session.close(); }
  });

  test('normalized cooldown publishes before a slow classifier, and a matching initial path sees it without numeric policy', async () => {
    world.keys = ['pr-1'];
    const rate = association();
    world.options['pr-1'] = { sharedRate: rate, retrySource: source };
    world.provider.script('assess', 'pr-1', ['rate-limit:100']);
    const stop = createStopController();
    let deciding = false;
    const session = openSession(stores, timer, { sharedRates });
    try {
      const run = members(session, { stop, retryPolicies: [{ id: 'slow', scope: source, decide: () => { deciding = true; return new Promise<IRetryDecision>(() => undefined); } }] });
      await until(() => deciding, 'classifier waits on the recorded refusal');
      expect(sharedRates.coordinator.admit({ surface: rate.surface, run: 'other-path' })).toEqual({ kind: 'wait', notBefore: T0 + 100 });
      stop.request({ level: 'hard' });
      await run.done;
      expect(received('pr-1')).toHaveLength(1);
    } finally { session.close(); }
  });

  test('an immediate retry cannot bypass a known floor and finite allowance remains independent of shared waiting', async () => {
    world.keys = ['pr-1'];
    const rate = association();
    world.options['pr-1'] = { sharedRate: rate, retrySource: source, retry: { maxAttempts: 2 } };
    world.provider.script('assess', 'pr-1', ['rate-limit:100', 'rate-limit:100']);
    const session = openSession(stores, timer, { sharedRates });
    try {
      const run = members(session, { retryPolicies: [{ id: 'immediate', scope: source, decide: () => ({ kind: 'retry-now' }) }] });
      await until(() => timer.pending().length > 0, 'accepted floor waits');
      expect(received('pr-1')).toHaveLength(1);
      timer.wakeEarly();
      await settle();
      expect(received('pr-1')).toHaveLength(1);
      timer.advanceTo(T0 + 100);
      const result = await run.done;
      expect(received('pr-1')).toHaveLength(2);
      expect(memberOf(result.value, 'pr-1').status).toBe('pending');
      expect(session.usage()).toMatchObject({ requestAttempts: 2, reports: 2 });
    } finally { session.close(); }
  });

  test('retry duration and durable epoch floor are anchored together at delayed decision acceptance and independently rechecked', async () => {
    world.keys = ['pr-1'];
    const rate = association();
    world.options['pr-1'] = { sharedRate: rate, retrySource: source };
    world.provider.script('assess', 'pr-1', ['transient', 'ok']);
    let finish: ((decision: IRetryDecision) => void) | undefined;
    const session = openSession(stores, timer, { sharedRates });
    try {
      const run = members(session, { retryPolicies: [{ id: 'delayed', scope: source, decide: () => new Promise<IRetryDecision>((resolve) => { finish = resolve; }) }] });
      await until(() => finish !== undefined, 'source decision is still pending');
      elapsed = 50;
      timer.correctTo(T0 + 100);
      finish?.({ kind: 'retry-after', delayMilliseconds: 100 });
      await until(() => timer.pending().includes(T0 + 200), 'acceptance produces the durable epoch floor');
      expect(journalContents(session)).toEqual([expect.objectContaining({ notBefore: T0 + 200, classification: expect.objectContaining({ delayMilliseconds: 100, notBefore: T0 + 200 }) })]);
      timer.advanceTo(T0 + 1_000);
      await settle();
      expect(received('pr-1')).toHaveLength(1);
      expect(session.usage()).toMatchObject({ requestAttempts: 1 });
      elapsed = 149;
      timer.wakeEarly();
      await settle();
      expect(received('pr-1')).toHaveLength(1);
      elapsed = 150;
      timer.correctTo(T0 + 150);
      timer.wakeEarly();
      await settle();
      expect(received('pr-1')).toHaveLength(1);
      timer.advanceTo(T0 + 200);
      const result = await run.done;
      expect(received('pr-1')).toHaveLength(2);
      expect(memberOf(result.value, 'pr-1').status).toBe('succeeded');
    } finally { session.close(); }
  });

  test('a new engine retains the durable accepted epoch floor and does not require the prior process elapsed timestamp', async () => {
    world.keys = ['pr-1'];
    const rate = association();
    world.options['pr-1'] = { sharedRate: rate, retrySource: source };
    world.provider.script('assess', 'pr-1', ['transient', 'ok']);
    const first = openSession(stores, timer, { sharedRates });
    try {
      await members(first, { deferral: 'exit', retryPolicies: [{ id: 'wait', scope: source, decide: () => ({ kind: 'retry-after', delayMilliseconds: 100 }) }] }).done;
      expect(journalContents(first)).toEqual([expect.objectContaining({ notBefore: T0 + 100 })]);
    } finally { first.close(); }
    // A recreated owner represents process-local state being lost. The
    // accepted epoch floor belongs to the durable operation, not this ledger.
    const elapsedClock = { currentElapsedMilliseconds: () => 0 };
    sharedRates = { coordinator: createSharedRateCoordinator({ epochClock: timer, elapsedClock }), elapsedClock };
    world.options['pr-1'] = { sharedRate: association(), retrySource: source };
    const second = openSession(stores, timer, { sharedRates });
    try {
      const early = await members(second, { deferral: 'exit' }).done;
      expect(early.waitingUntil).toBe(T0 + 100);
      expect(received('pr-1')).toHaveLength(1);
      timer.advanceTo(T0 + 100);
      await members(second).done;
      expect(received('pr-1')).toHaveLength(2);
    } finally { second.close(); }
  });
  test('the reserved base gate covers all registered surfaces in one environment/service/access domain', async () => {
    const catalog = association();
    const search = association('account:a', 'search', true);
    world.options['pr-1'] = { sharedRate: { ...catalog, cooldownGateId: 'base' } };
    world.options['pr-2'] = { sharedRate: search };
    // Explicit provider knowledge names base only for a domain-wide refusal.
    // No operation defaults a missing cooldown attribution to this broad gate.
    sharedRates.coordinator.observeCooldown(catalog.surface, 'base', T0 + 100);
    const session = openSession(stores, timer, { sharedRates });
    try {
      const run = members(session);
      await until(() => timer.pending().length >= 2, 'both registered surfaces wait for the domain base gate');
      expect(received('pr-1')).toHaveLength(0);
      expect(received('pr-2')).toHaveLength(0);
      timer.advanceTo(T0 + 100);
      await run.done;
      expect(received('pr-1')).toHaveLength(1);
      expect(received('pr-2')).toHaveLength(1);
    } finally { session.close(); }
  });

  test('a soft stop cancels a retry waiting on shared admission without a second intent or provider call', async () => {
    world.keys = ['pr-1'];
    const rate = association();
    world.options['pr-1'] = { sharedRate: rate, retrySource: source, retry: { maxAttempts: 2 } };
    world.plans['pr-1'] = 'catch-retry';
    world.provider.script('assess', 'pr-1', ['transient', 'ok']);
    const stop = createStopController();
    const session = openSession(stores, timer, { sharedRates });
    try {
      const run = members(session, { stop, retryPolicies: [{ id: 'immediate', scope: source, decide: () => {
        // Another controlled path learns a shared cooldown while this
        // operation accepts immediate retry; neither decision cancels the other.
        sharedRates.coordinator.observeCooldown(rate.surface, 'api', T0 + 100);
        return { kind: 'retry-now' };
      } }] });
      await until(() => timer.pending().includes(T0 + 100), 'the retry waits at shared admission');
      expect(received('pr-1')).toHaveLength(1);
      expect(session.usage()).toMatchObject({ requestAttempts: 1, reports: 1 });
      stop.request({ level: 'soft' });
      const result = await run.done;
      timer.advanceTo(T0 + 100);
      await settle();
      expect(received('pr-1')).toHaveLength(1);
      expect(session.usage()).toMatchObject({ requestAttempts: 1, reports: 1 });
      expect(memberOf(result.value, 'pr-1').status).not.toBe('succeeded');
    } finally { session.close(); }
  });

});
