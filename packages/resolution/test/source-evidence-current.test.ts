/**
 * WPD captured currentness compares only the source's consumed frontier facts.
 * These Tracking/Resolution owner tests have no producer, provider, History
 * publisher or complete traversal and cannot establish the live handoff.
 */
import { AsyncLocalStorage } from 'node:async_hooks';
import { createHash } from 'node:crypto';

import { describe, expect, test } from '@jest/globals';
import { createTrackingObserver } from '@microdelta/tracking';
import type { ITrackingObserverHost } from '@microdelta/tracking';

import { ownFactProvider } from '../src/current.js';

/** Host mechanics supply no frontier selection or currentness policy. */
const host: ITrackingObserverHost = {
  createAsyncContext<T>() { return new AsyncLocalStorage<T>(); },
  sha256(input: string): string { return createHash('sha256').update(input, 'utf8').digest('hex'); },
};

/** One observed member value beside a deliberately unread sibling. */
interface IFrontier { readonly member: { readonly id: string }; readonly unread: number }

/** A request's current evidence is supplied separately from declared inputs and members. */
function compare(after: IFrontier | undefined): string {
  const observer = createTrackingObserver(host);
  const evidence = observer.tracked({ member: { id: 'fixture/repo#101' }, unread: 1 }, { path: ['source-evidence'] });
  const captured = observer.capture(() => evidence.member.id);
  const options = {
    validation: createTrackingObserver(host), slots: { inputs: new Map(), helpers: new Map() },
    self: () => undefined, sourceEvidence: after,
  };
  return observer.compareCurrent(captured, ownFactProvider(options)).kind;
}

describe('captured source-evidence current facts', () => {
  test('preserves equal consumed facts and ignores an unread sibling', () => {
    expect(compare({ member: { id: 'fixture/repo#101' }, unread: 1 })).toBe('equal');
    expect(compare({ member: { id: 'fixture/repo#101' }, unread: 2 })).toBe('equal');
  });
  test('a changed consumed fact is a miss instead of reuse', () => {
    expect(compare({ member: { id: 'fixture/repo#102' }, unread: 1 })).toBe('changed');
  });
  test('absent captured evidence cannot justify a historical frontier observation', () => {
    expect(compare(undefined)).toBe('unavailable');
  });
});
