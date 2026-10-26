/** Failure-path contracts for C3's separate-process SQLite lock barrier. */
import { afterEach, expect, test } from '@jest/globals';

import { cleanup } from '../durable-history/support.js';
import { freshStore } from './driver.js';
import { activeContentionLockCount, withIndependentWriteLock } from './contention-lock.js';

afterEach(() => {
  cleanup();
  expect(activeContentionLockCount()).toBe(0);
});

test.each([
  { label: 'startup timeout', scenario: 'no-ready', diagnostic: /did not establish the SQLite write lock/u, startupTimeoutMilliseconds: 100 },
  { label: 'unexpected readiness message', scenario: 'unexpected-ready', diagnostic: /unexpected readiness/u },
  { label: 'early child exit', scenario: 'exit-before-ready', diagnostic: /ended before readiness/u },
] as const)('C3 lock helper reaps the child after $label', async ({ scenario, diagnostic, startupTimeoutMilliseconds }) => {
  await expect(withIndependentWriteLock(freshStore(), async () => undefined, {
    scenario,
    timeoutMilliseconds: 100,
    ...(startupTimeoutMilliseconds === undefined ? {} : { startupTimeoutMilliseconds }),
  })).rejects.toThrow(diagnostic);
  expect(activeContentionLockCount()).toBe(0);
});

test('C3 lock helper reaches the intended readiness failure after delayed worker startup', async () => {
  await expect(withIndependentWriteLock(freshStore(), async () => undefined, {
    scenario: 'delayed-unexpected-ready',
    timeoutMilliseconds: 100,
  })).rejects.toThrow(/unexpected readiness/u);
  expect(activeContentionLockCount()).toBe(0);
});

test('C3 lock helper reaches the callback before the release timeout and reaps its holder', async () => {
  let callbackEntered = false;
  await expect(withIndependentWriteLock(freshStore(), async () => {
    callbackEntered = true;
    return undefined;
  }, { scenario: 'ignore-release', timeoutMilliseconds: 100 })).rejects.toThrow(/did not release the SQLite write lock/u);
  expect(callbackEntered).toBe(true);
  expect(activeContentionLockCount()).toBe(0);
});

test('C3 lock cleanup preserves a callback failure while killing and reaping a holder that ignores release', async () => {
  let callbackEntered = false;
  await expect(withIndependentWriteLock(freshStore(), async () => {
    callbackEntered = true;
    throw new Error('original locked operation failure');
  }, { scenario: 'ignore-release', timeoutMilliseconds: 100 })).rejects.toThrow('original locked operation failure');
  expect(callbackEntered).toBe(true);
  expect(activeContentionLockCount()).toBe(0);
});

test.each([
  ['nonzero exit', 'exit-nonzero-after-release'],
  ['signal exit', 'signal-after-release'],
] as const)('C3 lock helper rejects a holder %s after release and reaps it', async (_label, scenario) => {
  await expect(withIndependentWriteLock(freshStore(), async () => 'operation-result', { scenario, timeoutMilliseconds: 1_000 }))
    .rejects.toThrow(/ended .* after release/u);
  expect(activeContentionLockCount()).toBe(0);
});

test('C3 lock cleanup preserves an undefined callback rejection when release times out', async () => {
  let didReject = false;
  let callbackEntered = false;
  let reason: unknown;
  try {
    await withIndependentWriteLock(freshStore(), async () => { callbackEntered = true; throw undefined; }, { scenario: 'ignore-release', timeoutMilliseconds: 100 });
  } catch (error: unknown) {
    didReject = true;
    reason = error;
  }
  expect(didReject).toBe(true);
  expect(callbackEntered).toBe(true);
  expect(reason).toBeUndefined();
  expect(activeContentionLockCount()).toBe(0);
});
