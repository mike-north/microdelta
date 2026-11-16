/**
 * The coordinator is one explicitly shared Supervision owner: its configured
 * rolling debits outlive run labels, satisfy every selected gate atomically,
 * and become refundable only while a send is known not to have started.
 *
 * @see ../../../docs/spec/operations.md (RUN-019)
 * @see ../../../docs/spec/acceptance.md (A-12e, A-12h, A-12j, A-12k, A-12l)
 */
import { describe, expect, test } from '@jest/globals';
import { createSharedRateCoordinator, type ISharedRateGateDeclaration } from '../src/index.js';
import { _inspectSharedRateDebits, _installSharedRateConstantPlan } from '../src/shared-rate-coordinator.js';

interface IControlledClock {
  currentEpochMilliseconds(): number;
  currentElapsedMilliseconds(): number;
  setEpoch(value: number): void;
  setElapsed(value: number): void;
}

function controlledClock(initial = 0): IControlledClock {
  let elapsed = initial;
  let epoch = 0;
  return {
    currentEpochMilliseconds: (): number => epoch,
    currentElapsedMilliseconds: (): number => elapsed,
    setEpoch(value: number): void {
      epoch = value;
    },
    setElapsed(value: number): void {
      elapsed = value;
    },
  };
}

const scope = { environment: 'test', service: 'catalog-service', accessContext: 'account-a' } as const;

function surface(coordinator: ReturnType<typeof createSharedRateCoordinator>, name: string, gates: readonly ISharedRateGateDeclaration[] = [{ id: 'api', limit: { units: 10, intervalMilliseconds: 60_000, costBasis: 'quantity' } }]) {
  return coordinator.registerSurface({ ...scope, surface: name, gates });
}

describe('shared rate coordinator core', () => {
  test('shares exact rolling weighted capacity across runs and surfaces, expiring at the open cutoff', () => {
    const clock = controlledClock();
    const owner = createSharedRateCoordinator({ elapsedClock: clock, epochClock: clock });
    const catalog = surface(owner, 'catalog');
    const search = surface(owner, 'search');

    for (const [handle, run, quantityCost] of [[search, 'run-a', 4], [search, 'run-b', 4], [catalog, 'run-c', 1], [catalog, 'run-a', 1]] as const) {
      const reservation = owner.admit({ surface: handle, run, quantityCost });
      expect(reservation.kind).toBe('admitted');
      if (reservation.kind === 'admitted') {
        expect(reservation.commitPossibleSend()).toEqual({ kind: 'committed' });
      }
    }
    expect(owner.admit({ surface: search, run: 'retry', quantityCost: 4 })).toMatchObject({ kind: 'wait' });

    clock.setElapsed(59_999);
    expect(owner.admit({ surface: search, run: 'retry', quantityCost: 4 })).toMatchObject({ kind: 'wait' });
    clock.setElapsed(60_000);
    const exactExpiry = owner.admit({ surface: search, run: 'retry', quantityCost: 4 });
    expect(exactExpiry.kind).toBe('admitted');
    if (exactExpiry.kind === 'admitted') {
      exactExpiry.rollbackBeforeSend();
    }
  });

  test('has a base gate without a synthetic limit and keeps unrelated access scopes independent', () => {
    const clock = controlledClock();
    const owner = createSharedRateCoordinator({ elapsedClock: clock, epochClock: clock });
    const accountA = surface(owner, 'plain');
    const exhaustedInAccountA = owner.admit({ surface: accountA, run: 'same-label', quantityCost: 10 });
    expect(exhaustedInAccountA.kind).toBe('admitted');
    if (exhaustedInAccountA.kind === 'admitted') {
      exhaustedInAccountA.commitPossibleSend();
    }
    expect(owner.admit({ surface: accountA, run: 'same-label', quantityCost: 1 }).kind).toBe('wait');
    const anotherAccount = owner.registerSurface({ ...scope, accessContext: 'account-b', surface: 'plain', gates: [{ id: 'api', limit: { units: 10, intervalMilliseconds: 60_000, costBasis: 'quantity' } }] });
    const accountBDebit = owner.admit({ surface: anotherAccount, run: 'same-label', quantityCost: 10 });
    expect(accountBDebit.kind).toBe('admitted');
    if (accountBDebit.kind === 'admitted') {
      expect(accountBDebit.commitPossibleSend()).toEqual({ kind: 'committed' });
    }
    const anotherService = owner.registerSurface({ ...scope, service: 'other-service', surface: 'plain', gates: [{ id: 'api', limit: { units: 10, intervalMilliseconds: 60_000, costBasis: 'quantity' } }] });
    const otherServiceDebit = owner.admit({ surface: anotherService, run: 'same-label', quantityCost: 10 });
    expect(otherServiceDebit.kind).toBe('admitted');
    if (otherServiceDebit.kind === 'admitted') {
      expect(otherServiceDebit.commitPossibleSend()).toEqual({ kind: 'committed' });
    }
    const unconfigured = owner.registerSurface({ ...scope, surface: 'unconfigured' });
    expect(owner.admit({ surface: unconfigured, run: 'no-policy' }).kind).toBe('admitted');
    expect(owner.registerSurface({ ...scope, surface: 'plain', gates: [{ id: 'api', limit: { units: 10, intervalMilliseconds: 60_000, costBasis: 'quantity' } }] })).toBe(accountA);
  });

  test('requires every configured gate atomically and separates search cooldown from API cooldown', () => {
    const clock = controlledClock();
    const owner = createSharedRateCoordinator({ elapsedClock: clock, epochClock: clock });
    const catalog = surface(owner, 'catalog', [{ id: 'api', limit: { units: 2, intervalMilliseconds: 60_000, costBasis: 'quantity' } }]);
    const search = surface(owner, 'search', [
      { id: 'api', limit: { units: 2, intervalMilliseconds: 60_000, costBasis: 'quantity' } },
      { id: 'search', limit: { units: 1, intervalMilliseconds: 60_000, costBasis: 'quantity' } },
    ]);

    const searchDebit = owner.admit({ surface: search, run: 'one', quantityCost: 1 });
    expect(searchDebit.kind).toBe('admitted');
    if (searchDebit.kind === 'admitted') {
      searchDebit.commitPossibleSend();
    }
    const rejected = owner.admit({ surface: search, run: 'two', quantityCost: 1 });
    expect(rejected.kind).toBe('wait');
    owner.observeCooldown(search, 'search', 50_000);
    owner.observeCooldown(search, 'search', 40_000);
    const catalogDebit = owner.admit({ surface: catalog, run: 'three', quantityCost: 1 });
    expect(catalogDebit.kind).toBe('admitted');
    if (catalogDebit.kind === 'admitted') {
      catalogDebit.commitPossibleSend();
    }
    expect(owner.admit({ surface: search, run: 'five', quantityCost: 1 })).toMatchObject({ kind: 'wait', notBefore: 50_000 });
    owner.observeCooldown(search, 'api', 80_000);
    expect(owner.admit({ surface: catalog, run: 'six', quantityCost: 1 })).toMatchObject({ kind: 'wait', notBefore: 80_000 });

    const apiFullSearchAvailable = surface(owner, 'other-search', [
      { id: 'api', limit: { units: 2, intervalMilliseconds: 60_000, costBasis: 'quantity' } },
      { id: 'other-search', limit: { units: 1, intervalMilliseconds: 60_000, costBasis: 'quantity' } },
    ]);
    expect(owner.admit({ surface: apiFullSearchAvailable, run: 'api-full', quantityCost: 1 }).kind).toBe('wait');
    expect(_inspectSharedRateDebits(owner, apiFullSearchAvailable, 'other-search')).toEqual([]);
  });

  test('shares known cooldowns without numeric pacing and refuses unknown associations', () => {
    const clock = controlledClock();
    const owner = createSharedRateCoordinator({ elapsedClock: clock, epochClock: clock });
    const catalog = owner.registerSurface({ ...scope, surface: 'no-limit-catalog', gates: [{ id: 'known-api' }] });
    const search = owner.registerSurface({ ...scope, surface: 'no-limit-search', gates: [{ id: 'known-api' }, { id: 'known-search' }] });
    owner.observeCooldown(search, 'known-api', 40);
    expect(owner.admit({ surface: catalog, run: 'catalog' })).toMatchObject({ kind: 'wait', notBefore: 40 });
    owner.observeCooldown(search, 'known-search', 50);
    expect(owner.admit({ surface: catalog, run: 'catalog-again' }).kind).toBe('wait');
    expect(() => owner.observeCooldown(search, 'guessed-hostname', 60)).toThrow();
  });

  test('keeps elapsed debit expiry independent from forward and backward epoch corrections', () => {
    const clock = controlledClock();
    const owner = createSharedRateCoordinator({ elapsedClock: clock, epochClock: clock });
    const handle = surface(owner, 'separate-clocks', [{ id: 'api', limit: { units: 1, intervalMilliseconds: 60, costBasis: 'quantity' } }]);
    const first = owner.admit({ surface: handle, run: 'first', quantityCost: 1 });
    expect(first.kind).toBe('admitted');
    if (first.kind === 'admitted') {
      first.commitPossibleSend();
    }
    clock.setEpoch(10_000_000);
    clock.setElapsed(59);
    expect(owner.admit({ surface: handle, run: 'forward-correction', quantityCost: 1 }).kind).toBe('wait');
    clock.setEpoch(-10_000_000);
    expect(owner.admit({ surface: handle, run: 'backward-correction', quantityCost: 1 }).kind).toBe('wait');
    clock.setElapsed(60);
    expect(owner.admit({ surface: handle, run: 'expired', quantityCost: 1 }).kind).toBe('admitted');
  });

  test('rejects malformed declarations and unknown costs before changing any gate', () => {
    const clock = controlledClock();
    const owner = createSharedRateCoordinator({ elapsedClock: clock, epochClock: clock });
    const invalid = [
      { units: 0, intervalMilliseconds: 1, costBasis: 'quantity' as const },
      { units: 1.5, intervalMilliseconds: 1, costBasis: 'quantity' as const },
      { units: Number.POSITIVE_INFINITY, intervalMilliseconds: 1, costBasis: 'quantity' as const },
      { units: Number.MAX_SAFE_INTEGER + 1, intervalMilliseconds: 1, costBasis: 'quantity' as const },
      { units: -1, intervalMilliseconds: 1, costBasis: 'quantity' as const },
      { units: 1, intervalMilliseconds: 0, costBasis: 'quantity' as const },
      { units: 1, intervalMilliseconds: -1, costBasis: 'quantity' as const },
      { units: 1, intervalMilliseconds: 1.5, costBasis: 'quantity' as const },
      { units: 1, intervalMilliseconds: Number.NaN, costBasis: 'quantity' as const },
    ];
    for (const limit of invalid) {
      expect(() => surface(owner, `bad-${String(limit.units)}-${String(limit.intervalMilliseconds)}`, [{ id: 'bad', limit }])).toThrow();
    }
    const handle = surface(owner, 'validation');
    expect(owner.admit({ surface: handle, run: 'unknown-cost' }).kind).toBe('refused');
    expect(owner.admit({ surface: handle, run: 'too-large', quantityCost: 11 }).kind).toBe('refused');
    expect(owner.admit({ surface: handle, run: 'fraction', quantityCost: 1.5 }).kind).toBe('refused');
    for (const cost of [0, -1, Number.POSITIVE_INFINITY, Number.NaN, Number.MAX_SAFE_INTEGER + 1]) {
      expect(owner.admit({ surface: handle, run: `invalid-${String(cost)}`, quantityCost: cost }).kind).toBe('refused');
    }
    expect(() => surface(owner, 'validation', [{ id: 'api', limit: { units: 11, intervalMilliseconds: 60_000, costBasis: 'quantity' } }])).toThrow();
    expect(() => surface(owner, 'overflow-declaration', [{ id: 'huge', limit: { units: Number.MAX_SAFE_INTEGER, intervalMilliseconds: 1, costBasis: 'quantity' } }])).not.toThrow();
    expect(owner.admit({ surface: handle, run: 'clean', quantityCost: 10 }).kind).toBe('admitted');
  });

  test('retains evidence and fails closed on a decreasing elapsed clock', () => {
    const clock = controlledClock(5);
    const owner = createSharedRateCoordinator({ elapsedClock: clock, epochClock: clock });
    const handle = surface(owner, 'clock');
    const first = owner.admit({ surface: handle, run: 'first', quantityCost: 4 });
    expect(first.kind).toBe('admitted');
    if (first.kind === 'admitted') {
      first.commitPossibleSend();
    }
    clock.setElapsed(4);
    expect(owner.admit({ surface: handle, run: 'bad-time', quantityCost: 1 })).toMatchObject({ kind: 'timing-failure' });
    expect(_inspectSharedRateDebits(owner, handle, 'api')).toEqual([{ at: 5, cost: 4 }]);
  });

  test('rolls back only a pre-send reservation and never refunds a possible send', () => {
    const clock = controlledClock();
    const owner = createSharedRateCoordinator({ elapsedClock: clock, epochClock: clock });
    const handle = surface(owner, 'commit');
    const rolledBack = owner.admit({ surface: handle, run: 'before-send', quantityCost: 4 });
    expect(rolledBack.kind).toBe('admitted');
    if (rolledBack.kind === 'admitted') {
      rolledBack.rollbackBeforeSend();
      rolledBack.rollbackBeforeSend();
    }
    expect(_inspectSharedRateDebits(owner, handle, 'api')).toEqual([]);

    const possibleSend = owner.admit({ surface: handle, run: 'after-send', quantityCost: 4 });
    expect(possibleSend.kind).toBe('admitted');
    if (possibleSend.kind === 'admitted') {
      possibleSend.commitPossibleSend();
      possibleSend.rollbackBeforeSend();
    }
    expect(_inspectSharedRateDebits(owner, handle, 'api')).toEqual([{ at: 0, cost: 4 }]);
  });

  test('rechecks a single-use reservation at commit time, including competing reservations and new cooldowns', () => {
    const clock = controlledClock();
    const owner = createSharedRateCoordinator({ elapsedClock: clock, epochClock: clock });
    const handle = surface(owner, 'fresh-commit', [{ id: 'api', limit: { units: 1, intervalMilliseconds: 100, costBasis: 'quantity' } }]);
    const first = owner.admit({ surface: handle, run: 'first', quantityCost: 1 });
    const competing = owner.admit({ surface: handle, run: 'second', quantityCost: 1 });
    expect(first.kind).toBe('admitted');
    expect(competing.kind).toBe('admitted');
    if (first.kind === 'admitted' && competing.kind === 'admitted') {
      clock.setElapsed(20);
      expect(first.commitPossibleSend()).toEqual({ kind: 'committed' });
      expect(competing.commitPossibleSend()).toMatchObject({ kind: 'wait' });
      expect(_inspectSharedRateDebits(owner, handle, 'api')).toEqual([{ at: 20, cost: 1 }]);
    }

    clock.setElapsed(120);
    const stale = owner.admit({ surface: handle, run: 'stale', quantityCost: 1 });
    expect(stale.kind).toBe('admitted');
    if (stale.kind === 'admitted') {
      owner.observeCooldown(handle, 'api', 50);
      expect(stale.commitPossibleSend()).toMatchObject({ kind: 'wait', notBefore: 50 });
      stale.rollbackBeforeSend();
    }
    expect(_inspectSharedRateDebits(owner, handle, 'api')).toEqual([]);
  });

  test('rejects every invalid elapsed reading without expiring retained debits', () => {
    for (const invalidReading of [-1, 1.5, Number.POSITIVE_INFINITY, Number.MAX_SAFE_INTEGER + 1]) {
      const clock = controlledClock(5);
      const owner = createSharedRateCoordinator({ elapsedClock: clock, epochClock: clock });
      const handle = surface(owner, `bad-clock-${String(invalidReading)}`);
      const first = owner.admit({ surface: handle, run: 'first', quantityCost: 2 });
      if (first.kind === 'admitted') {
        first.commitPossibleSend();
      }
      clock.setElapsed(invalidReading);
      expect(owner.admit({ surface: handle, run: 'invalid', quantityCost: 1 }).kind).toBe('timing-failure');
      expect(_inspectSharedRateDebits(owner, handle, 'api')).toEqual([{ at: 5, cost: 2 }]);
    }
  });

  test('keeps thrown host clock details out of timing diagnostics', () => {
    const marker = 'private-clock-error-7f3a';
    const elapsedFailure = createSharedRateCoordinator({
      elapsedClock: { currentElapsedMilliseconds: (): number => { throw new Error(marker); } },
      epochClock: { currentEpochMilliseconds: (): number => 0 },
    });
    const elapsedSurface = elapsedFailure.registerSurface({ ...scope, surface: 'throwing-elapsed' });
    expect(elapsedFailure.admit({ surface: elapsedSurface, run: 'elapsed' })).toMatchObject({ kind: 'timing-failure', reason: 'Elapsed clock read failed' });

    const epochFailure = createSharedRateCoordinator({
      elapsedClock: { currentElapsedMilliseconds: (): number => 0 },
      epochClock: { currentEpochMilliseconds: (): number => { throw new Error(marker); } },
    });
    const epochSurface = epochFailure.registerSurface({ ...scope, surface: 'throwing-epoch' });
    const result = epochFailure.admit({ surface: epochSurface, run: 'epoch' });
    expect(result).toMatchObject({ kind: 'timing-failure', reason: 'Epoch clock read failed' });
    expect(result.kind === 'timing-failure' ? result.reason : '').not.toContain(marker);
  });

  test('rejects forged surface objects and ignores caller attempts to omit registered gates', () => {
    const clock = controlledClock();
    const owner = createSharedRateCoordinator({ elapsedClock: clock, epochClock: clock });
    const handle = surface(owner, 'identity-and-membership', [{ id: 'api', limit: { units: 1, intervalMilliseconds: 60_000, costBasis: 'requests' } }]);
    const committed = owner.admit({ surface: handle, run: 'registered' });
    expect(committed.kind).toBe('admitted');
    if (committed.kind === 'admitted') {
      committed.commitPossibleSend();
    }
    const forged = { surface: { id: handle.id }, run: 'forged', gates: [] };
    expect(() => owner.admit(forged)).toThrow();
    const omission = { surface: handle, run: 'omit-api', gates: [] };
    expect(owner.admit(omission).kind).toBe('wait');
  });

  test('applies additive constant plan pacing without weakening configured gates', () => {
    const clock = controlledClock();
    const owner = createSharedRateCoordinator({ elapsedClock: clock, epochClock: clock });
    const handle = surface(owner, 'policy');
    _installSharedRateConstantPlan(owner, handle, { gate: { id: 'policy', limit: { units: 1, intervalMilliseconds: 10, costBasis: 'quantity' } }, paceMilliseconds: 10 });
    expect(owner.admit({ surface: handle, run: 'early', quantityCost: 1 })).toMatchObject({ kind: 'wait', retryAtElapsed: 10 });
    clock.setElapsed(10);
    const first = owner.admit({ surface: handle, run: 'first', quantityCost: 1 });
    expect(first.kind).toBe('admitted');
    if (first.kind === 'admitted') {
      first.commitPossibleSend();
    }
    expect(owner.admit({ surface: handle, run: 'later', quantityCost: 1 })).toMatchObject({ kind: 'wait', retryAtElapsed: 20 });
    clock.setElapsed(20);
    expect(owner.admit({ surface: handle, run: 'later', quantityCost: 1 }).kind).toBe('admitted');
  });

  test('cannot replace an existing configured gate with a weaker plan', () => {
    const clock = controlledClock();
    const owner = createSharedRateCoordinator({ elapsedClock: clock, epochClock: clock });
    const handle = surface(owner, 'immutable-plan', [{ id: 'api', limit: { units: 2, intervalMilliseconds: 60, costBasis: 'quantity' } }]);
    expect(() => _installSharedRateConstantPlan(owner, handle, { gate: { id: 'api', limit: { units: 20, intervalMilliseconds: 1, costBasis: 'quantity' } }, paceMilliseconds: 0 })).toThrow();
  });

  test('adds policy pacing without displacing a known absolute cooldown', () => {
    const clock = controlledClock();
    const owner = createSharedRateCoordinator({ elapsedClock: clock, epochClock: clock });
    const handle = surface(owner, 'policy-with-floor', [{ id: 'known-api', limit: { units: 2, intervalMilliseconds: 60, costBasis: 'quantity' } }]);
    owner.observeCooldown(handle, 'known-api', 50);
    expect(owner.admit({ surface: handle, run: 'known-floor-before-plan', quantityCost: 1 })).toMatchObject({ kind: 'wait', notBefore: 50 });
    _installSharedRateConstantPlan(owner, handle, { gate: { id: 'policy', limit: { units: 1, intervalMilliseconds: 10, costBasis: 'quantity' } }, paceMilliseconds: 10 });
    expect(owner.admit({ surface: handle, run: 'policy-pacing', quantityCost: 1 })).toMatchObject({ kind: 'wait', retryAtElapsed: 10 });
    clock.setElapsed(10);
    expect(owner.admit({ surface: handle, run: 'known-floor-after-plan', quantityCost: 1 })).toMatchObject({ kind: 'wait', notBefore: 50 });
  });

  test('does not mistake a fixed-minute reset for a rolling window', () => {
    const clock = controlledClock(59_999);
    const owner = createSharedRateCoordinator({ elapsedClock: clock, epochClock: clock });
    const handle = surface(owner, 'boundary');
    const first = owner.admit({ surface: handle, run: 'minute-one', quantityCost: 10 });
    expect(first.kind).toBe('admitted');
    if (first.kind === 'admitted') {
      first.commitPossibleSend();
    }
    clock.setElapsed(60_001);
    expect(owner.admit({ surface: handle, run: 'minute-two', quantityCost: 1 })).toMatchObject({ kind: 'wait' });
  });

  test('rejects a token-bucket burst that exceeds the exact rolling-window bound', () => {
    const clock = controlledClock();
    const owner = createSharedRateCoordinator({ elapsedClock: clock, epochClock: clock });
    const handle = surface(owner, 'token-bucket', [{ id: 'api', limit: { units: 10, intervalMilliseconds: 60_000, costBasis: 'quantity' } }]);
    const first = owner.admit({ surface: handle, run: 'initial', quantityCost: 10 });
    if (first.kind === 'admitted') {
      first.commitPossibleSend();
    }
    clock.setElapsed(54_000);
    expect(owner.admit({ surface: handle, run: 'burst', quantityCost: 9 })).toMatchObject({ kind: 'wait', retryAtElapsed: 60_000 });
  });

  test('waits until cumulative weighted expiry is sufficient, not merely the first expiry', () => {
    const clock = controlledClock();
    const owner = createSharedRateCoordinator({ elapsedClock: clock, epochClock: clock });
    const handle = surface(owner, 'staggered-expiry');
    for (const [elapsed, cost] of [[0, 3], [30_000, 3], [40_000, 4]] as const) {
      clock.setElapsed(elapsed);
      const reservation = owner.admit({ surface: handle, run: `at-${String(elapsed)}`, quantityCost: cost });
      expect(reservation.kind).toBe('admitted');
      if (reservation.kind === 'admitted') {
        expect(reservation.commitPossibleSend()).toEqual({ kind: 'committed' });
      }
    }
    clock.setElapsed(60_000);
    expect(owner.admit({ surface: handle, run: 'too-little-expired', quantityCost: 4 })).toMatchObject({ kind: 'wait', retryAtElapsed: 90_000 });
    clock.setElapsed(89_999);
    expect(owner.admit({ surface: handle, run: 'still-too-little-expired', quantityCost: 4 })).toMatchObject({ kind: 'wait', retryAtElapsed: 90_000 });
    clock.setElapsed(90_000);
    expect(owner.admit({ surface: handle, run: 'enough-expired', quantityCost: 4 }).kind).toBe('admitted');
  });

  test('charges request-count and quantity gates in their own declared units', () => {
    const clock = controlledClock();
    const owner = createSharedRateCoordinator({ elapsedClock: clock, epochClock: clock });
    const handle = surface(owner, 'mixed-costs', [
      { id: 'api-requests', limit: { units: 1, intervalMilliseconds: 60_000, costBasis: 'requests' } },
      { id: 'quantity', limit: { units: 4, intervalMilliseconds: 60_000, costBasis: 'quantity' } },
    ]);
    const reservation = owner.admit({ surface: handle, run: 'mixed', quantityCost: 4 });
    expect(reservation.kind).toBe('admitted');
    if (reservation.kind === 'admitted') {
      expect(reservation.commitPossibleSend()).toEqual({ kind: 'committed' });
    }
    expect(_inspectSharedRateDebits(owner, handle, 'api-requests')).toEqual([{ at: 0, cost: 1 }]);
    expect(_inspectSharedRateDebits(owner, handle, 'quantity')).toEqual([{ at: 0, cost: 4 }]);
  });

  test('snapshots cost evidence and accepted absolute floor before returning a reservation', () => {
    const clock = controlledClock();
    const owner = createSharedRateCoordinator({ elapsedClock: clock, epochClock: clock });
    const handle = surface(owner, 'immutable-evidence', [{ id: 'api', limit: { units: 5, intervalMilliseconds: 60_000, costBasis: 'quantity' } }]);
    clock.setEpoch(10);
    let reads = 0;
    const request = {
      surface: handle,
      run: 'mutable-request',
      acceptedNotBefore: 10,
      get quantityCost(): number {
        reads += 1;
        return reads === 1 ? 4 : 1;
      },
    };
    const reservation = owner.admit(request);
    expect(reservation.kind).toBe('admitted');
    request.acceptedNotBefore = 20;
    clock.setEpoch(11);
    if (reservation.kind === 'admitted') {
      expect(reservation.commitPossibleSend()).toEqual({ kind: 'committed' });
    }
    expect(reads).toBe(1);
    expect(_inspectSharedRateDebits(owner, handle, 'api')).toEqual([{ at: 0, cost: 4 }]);

    const floorBlocked = owner.admit({ surface: handle, run: 'floor', quantityCost: 1, acceptedNotBefore: 30 });
    expect(floorBlocked).toMatchObject({ kind: 'wait', notBefore: 30 });
    clock.setEpoch(45);
    const preview = owner.admit({ surface: handle, run: 'floor-correction', quantityCost: 1, acceptedNotBefore: 40 });
    expect(preview.kind).toBe('admitted');
    clock.setEpoch(39);
    if (preview.kind === 'admitted') {
      expect(preview.commitPossibleSend()).toMatchObject({ kind: 'wait', notBefore: 40 });
    }
  });

  test('rejects an expiry calculation that would overflow safe elapsed milliseconds', () => {
    const clock = controlledClock(Number.MAX_SAFE_INTEGER);
    const owner = createSharedRateCoordinator({ elapsedClock: clock, epochClock: clock });
    const handle = surface(owner, 'expiry-overflow', [{ id: 'api', limit: { units: 1, intervalMilliseconds: 1, costBasis: 'quantity' } }]);
    const first = owner.admit({ surface: handle, run: 'first', quantityCost: 1 });
    if (first.kind === 'admitted') {
      first.commitPossibleSend();
    }
    expect(owner.admit({ surface: handle, run: 'overflow', quantityCost: 1 })).toMatchObject({ kind: 'refused' });
  });

  test('rejects checked rolling sums that overflow safe integer arithmetic', () => {
    const clock = controlledClock();
    const owner = createSharedRateCoordinator({ elapsedClock: clock, epochClock: clock });
    const handle = surface(owner, 'sum-overflow', [{ id: 'huge', limit: { units: Number.MAX_SAFE_INTEGER, intervalMilliseconds: 100, costBasis: 'quantity' } }]);
    const first = owner.admit({ surface: handle, run: 'maximum', quantityCost: Number.MAX_SAFE_INTEGER });
    expect(first.kind).toBe('admitted');
    if (first.kind === 'admitted') {
      expect(first.commitPossibleSend()).toEqual({ kind: 'committed' });
    }
    expect(owner.admit({ surface: handle, run: 'overflow', quantityCost: 1 })).toMatchObject({ kind: 'refused' });
    expect(_inspectSharedRateDebits(owner, handle, 'huge')).toEqual([{ at: 0, cost: Number.MAX_SAFE_INTEGER }]);
  });
});
