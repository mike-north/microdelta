/** Exception and detached-callback boundaries exercise observable async helper lifetimes. */
import { AsyncLocalStorage } from 'node:async_hooks';
import { createHash } from 'node:crypto';
import { describe, expect, test } from '@jest/globals';
import { createTrackingObserver } from '../src/index.js';
import type { ITrackingObserver } from '../src/index.js';

/** Machine supplies host mechanics, leaving lifetime decisions with Tracking. */
function observer(): ITrackingObserver {
  return createTrackingObserver({
    createAsyncContext<T>() { return new AsyncLocalStorage<T>(); },
    sha256(input: string): string { return createHash('sha256').update(input, 'utf8').digest('hex'); },
  });
}
interface IBarrier { readonly promise: Promise<void>; readonly release: () => void }
function barrier(): IBarrier {
  let release: () => void = () => undefined;
  const promise = new Promise<void>((resolve) => { release = resolve; });
  return { promise, release };
}

describe('gap hunt TRK-3 async exceptions and late helpers', () => {
  test('caught tracked async helper failure keeps post-await consumed facts in its consuming frame', async () => {
    const subject = observer();
    const input = subject.tracked({ before: 'before', after: 'after', unread: 'private' }, { path: ['input'] });
    const helper = subject.tracked(async function failAfterAwait(): Promise<never> {
      const before = input.before;
      // eslint-disable-next-line microdelta/tracked-captures -- Native resolved promise supplies only the test-owned async boundary.
      await Promise.resolve();
      const after = input.after;
      // eslint-disable-next-line microdelta/tracked-captures -- Native error construction exposes the consumed leaf values as the expected failure.
      throw new Error(`${before}/${after}`);
    }, { path: ['helper'] });
    const capture = await subject.captureAsync(async () => {
      try { await helper(); } catch (error: unknown) {
        // eslint-disable-next-line microdelta/tracked-captures -- Native error narrowing is fixture validation, not an intended reuse influence.
        if (!(error instanceof Error)) { throw error; }
        return error.message;
      }
      // eslint-disable-next-line microdelta/tracked-captures -- The fixture fails visibly if its helper unexpectedly succeeds.
      throw new Error('Expected failure');
    });
    expect(capture.value).toBe('before/after');
    expect(capture.observations.filter(item => item.kind === 'implementation')).toHaveLength(1);
    expect(capture.observations.filter(item => item.kind === 'fact').map(item => item.address)).toEqual([
      [{ kind: 'property', key: 'before' }], [{ kind: 'property', key: 'after' }],
    ]);
  });

  test.each(['success', 'failure'])('a detached helper callback after capture %s rejects before its body runs', async (ending) => {
    const subject = observer();
    const gate = barrier();
    let calls = 0;
    const helper = subject.tracked(function late(): number {
      // eslint-disable-next-line microdelta/tracked-captures -- The counter proves the rejected late invocation never enters author code.
      calls += 1;
      return 1;
    }, { path: ['late'] });
    let detached: Promise<unknown> = Promise.resolve('not scheduled');
    const failure = new Error('capture failed');
    const operation = subject.captureAsync(async () => {
      detached = (async () => {
        // eslint-disable-next-line microdelta/tracked-captures -- This host-owned barrier deliberately outlives the capture.
        await gate.promise;
        try { return helper(); } catch (error: unknown) { return error; }
      })();
      // eslint-disable-next-line microdelta/tracked-captures -- The test-selected ending closes the same frame by success or failure without becoming retained reuse evidence.
      if (ending === 'failure') {
        // eslint-disable-next-line microdelta/tracked-captures -- Exact error identity verifies failure cleanup rather than a substituted failure.
        throw failure;
      }
      return 'done';
    });
    if (ending === 'failure') { await expect(operation).rejects.toBe(failure); }
    else { expect((await operation).value).toBe('done'); }
    gate.release();
    const late = await detached;
    expect(late).toBeInstanceOf(Error);
    expect(late instanceof Error ? late.message : '').toMatch(/closed/i);
    expect(calls).toBe(0);
    const fresh = subject.capture(() => helper());
    expect(fresh.value).toBe(1);
    expect(fresh.observations).toHaveLength(1);
    expect(calls).toBe(1);
  });
});
