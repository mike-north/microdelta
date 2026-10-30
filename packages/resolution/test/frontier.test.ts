/**
 * Request-bound frontier lifetime (WPD-11). These protocol tests use opaque run
 * identities and immutable snapshots; they acquire no page, publish no History
 * result and cannot establish live traversal or restart behavior.
 */
import { AsyncLocalStorage } from 'node:async_hooks';
import { createHash } from 'node:crypto';

import { describe, expect, test } from '@jest/globals';
import { createTrackingObserver } from '@microdelta/tracking';
import type { ITraversalBinding } from '@microdelta/definition';
import type { ITrackingObserverHost } from '@microdelta/tracking';

import { createFrontierCaptures } from '../src/frontier.js';

/** Snapshot host mechanics do not decide eligibility or stop policy. */
const host: ITrackingObserverHost = {
  createAsyncContext<T>() { return new AsyncLocalStorage<T>(); },
  sha256(input: string): string { return createHash('sha256').update(input).digest('hex'); },
};

/** One fixed declared relationship; the Definition owner suite proves its minting. */
const binding: ITraversalBinding = {
  slot: 'person-prs', query: { scope: 'test', role: 'input', slot: 'query' },
  page: { scope: 'test', role: 'callable', slot: 'page' },
  collection: { scope: 'test', role: 'step', slot: 'frontier' },
  template: 'prs', fold: { scope: 'test', role: 'step', slot: 'summary' },
};

/** A controller exposes only the identity/root checks the run owner supplies. */
function fixture() {
  const owner = {};
  let current: object | undefined = owner;
  let rootAllowed = true;
  const snapshots = createTrackingObserver(host);
  const controller = createFrontierCaptures({
    binding, owner, currentOwner: () => current,
    assertRoot: () => { if (!rootAllowed) { throw new Error('Root request is refused'); } },
    snapshot: (value: object): object => {
      const owned = snapshots.tracked(value, { path: ['fixture-snapshot'] });
      return snapshots.capture(() => snapshots.snapshotOutput(owned)).value;
    },
  });
  return {
    controller,
    foreignRun(): void { current = {}; },
    leaveRun(): void { current = undefined; },
    softStop(): void { rootAllowed = false; controller.stop(); },
  };
}

describe('immutable request frontier captures', () => {
  test('freezes the offered value and preserves F1 when F2 supersedes new-capture eligibility', () => {
    const run = fixture();
    const value = { members: [{ id: 'A' }], status: 'open' };
    const f1 = run.controller.offer(value);
    const capture = run.controller.capture(f1, 'request-one');
    value.members[0] = { id: 'mutated-author-object' };
    const f2 = run.controller.offer({ members: [{ id: 'A' }, { id: 'B' }], status: 'complete' });
    expect(() => run.controller.capture(f1, 'superseded-start')).toThrow();
    expect(run.controller.read(capture, 'request-one', binding.collection)).toEqual({ members: [{ id: 'A' }], status: 'open' });
    const next = run.controller.capture(f2, 'request-two');
    const current = run.controller.read(next, 'request-two', binding.collection);
    expect(current).toEqual({ members: [{ id: 'A' }, { id: 'B' }], status: 'complete' });
    expect(Object.isFrozen(current)).toBe(true);
  });

  test('soft producer stop refuses new captures but keeps admitted request evidence through drain', () => {
    const run = fixture();
    const offer = run.controller.offer({ members: [{ id: 'A' }], status: 'open' });
    const capture = run.controller.capture(offer, 'admitted');
    run.softStop();
    expect(() => run.controller.offer({ members: [], status: 'complete' })).toThrow();
    expect(() => run.controller.capture(offer, 'after-failure')).toThrow();
    expect(run.controller.read(capture, 'admitted', binding.collection)).toEqual({ members: [{ id: 'A' }], status: 'open' });
    // A resumed pass retains the normal request association; its separate
    // History pass key does not create a new frontier capture.
    expect(run.controller.read(capture, 'admitted', binding.collection)).toEqual({ members: [{ id: 'A' }], status: 'open' });
    run.controller.dispose();
    expect(() => run.controller.read(capture, 'admitted', binding.collection)).toThrow();
  });

  test('rejects foreign, forged, absent and wrong-request/collection evidence before use', () => {
    const run = fixture();
    const other = fixture();
    const offer = run.controller.offer({ members: [], status: 'open' });
    const capture = run.controller.capture(offer, 'one');
    expect(() => run.controller.capture({ ...offer }, 'one')).toThrow();
    expect(() => other.controller.capture(offer, 'one')).toThrow();
    expect(() => run.controller.capture(undefined, 'one')).toThrow();
    expect(() => run.controller.read({ ...capture }, 'one', binding.collection)).toThrow();
    expect(() => run.controller.read(capture, 'two', binding.collection)).toThrow();
    expect(() => run.controller.read(capture, 'one#pass:not-a-pass', binding.collection)).toThrow();
    expect(() => run.controller.read(capture, 'one', binding.fold)).toThrow();
    expect(() => other.controller.read(capture, 'one', binding.collection)).toThrow();
    run.foreignRun();
    expect(() => run.controller.read(capture, 'one', binding.collection)).toThrow();
  });

  test('closed run authority never revives an old offer or captured request', () => {
    const run = fixture();
    const offer = run.controller.offer({ members: [], status: 'open' });
    const capture = run.controller.capture(offer, 'one');
    run.leaveRun();
    expect(() => run.controller.capture(offer, 'two')).toThrow();
    expect(() => run.controller.read(capture, 'one', binding.collection)).toThrow();
  });
});
