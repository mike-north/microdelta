/** The alpha assertion identifies one open Tracking frame without observing data or granting frame authority (TRK-3, A-18). */
import { AsyncLocalStorage } from 'node:async_hooks';
import { createHash } from 'node:crypto';
import { expect, test } from '@jest/globals';
import type { IMachine } from '@microdelta/machine';
import { createTrackingObserver } from '../src/index.js';

/** Host contexts are independent so the observer, rather than the host, owns frame identity. */
const machine: IMachine = {
  createAsyncContext<T>() { return new AsyncLocalStorage<T>(); },
  snapshot<T>(value: T): T { return structuredClone(value); },
  sha256(input: string): string { return createHash('sha256').update(input, 'utf8').digest('hex'); },
};

test('a current-frame assertion rejects nested and late calls, then accepts the restored owner', () => {
  const observer = createTrackingObserver(machine);
  expect(() => observer.currentCaptureAssertion()).toThrow(/capture/i);
  const outer = observer.capture(() => {
    // eslint-disable-next-line microdelta/tracked-captures -- This owner-lifecycle fixture asks the observer for its frame assertion inside the capture.
    const assertOwner = observer.currentCaptureAssertion();
    assertOwner();
    const inner = observer.capture(() => {
      // eslint-disable-next-line microdelta/tracked-captures -- This negative fixture deliberately tests an assertion from the surrounding frame.
      expect(assertOwner).toThrow(/capture|frame/i);
      // eslint-disable-next-line microdelta/tracked-captures -- The nested observer frame must mint its own assertion.
      const assertInner = observer.currentCaptureAssertion();
      assertInner();
      return assertInner;
    });
    // eslint-disable-next-line microdelta/tracked-captures -- Test assertion checks that the nested frame recorded no facts.
    expect(inner.observations).toHaveLength(0);
    // eslint-disable-next-line microdelta/tracked-captures -- Test assertion checks the nested frame is now closed.
    expect(inner.value).toThrow(/capture|frame/i);
    assertOwner();
    return assertOwner;
  });
  expect(outer.observations).toHaveLength(0);
  expect(outer.value).toThrow(/capture|frame/i);
});

test('an assertion survives await, but not a sibling capture on the same observer', async () => {
  const observer = createTrackingObserver(machine);
  const foreign = createTrackingObserver(machine);
  const outer = await observer.captureAsync(async () => {
    // eslint-disable-next-line microdelta/tracked-captures -- This lifecycle fixture captures the observer's current frame assertion.
    const assertOwner = observer.currentCaptureAssertion();
    // eslint-disable-next-line microdelta/tracked-captures -- Await is needed to prove the same frame remains current across async work.
    await Promise.resolve();
    assertOwner();
    // eslint-disable-next-line microdelta/tracked-captures -- A different observer's capture must not divert this observer's frame.
    foreign.capture(() => assertOwner());
    // eslint-disable-next-line microdelta/tracked-captures -- A sibling capture on this observer must reject the saved assertion.
    observer.capture(() => expect(assertOwner).toThrow(/capture|frame/i));
    assertOwner();
    return assertOwner;
  });
  expect(outer.observations).toHaveLength(0);
  expect(outer.value).toThrow(/capture|frame/i);
});
