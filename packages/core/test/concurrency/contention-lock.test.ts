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
  ['startup timeout', 'no-ready', /did not establish the SQLite write lock/u],
  ['unexpected readiness message', 'unexpected-ready', /unexpected readiness/u],
  ['early child exit', 'exit-before-ready', /ended before readiness/u],
  ['release timeout', 'ignore-release', /did not release the SQLite write lock/u],
] as const)('C3 lock helper reaps the child after %s', async (_label, scenario, diagnostic) => {
  await expect(withIndependentWriteLock(freshStore(), async () => undefined, { scenario, timeoutMilliseconds: 100 }))
    .rejects.toThrow(diagnostic);
  expect(activeContentionLockCount()).toBe(0);
});

test('C3 lock cleanup preserves a callback failure while killing and reaping a holder that ignores release', async () => {
  await expect(withIndependentWriteLock(freshStore(), async () => {
    throw new Error('original locked operation failure');
  }, { scenario: 'ignore-release', timeoutMilliseconds: 100 })).rejects.toThrow('original locked operation failure');
  expect(activeContentionLockCount()).toBe(0);
});
