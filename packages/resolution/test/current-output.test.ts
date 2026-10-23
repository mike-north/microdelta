/**
 * REUSE-001/TRK-8 current explicit-output facts are reconstructed at the
 * recorded binding and subtree, using Tracking's own MDS1 comparison. These
 * owner tests complement the fresh-process exact-reference fixtures in Core.
 */
import { AsyncLocalStorage } from 'node:async_hooks';
import { createHash } from 'node:crypto';

import { describe, expect, test } from '@jest/globals';
import { createTrackingObserver } from '@microdelta/tracking';
import type { ICurrentFactRequest, ITrackingObserverHost } from '@microdelta/tracking';

import { ownFactProvider } from '../src/current.js';
import type { ICurrentSlots } from '../src/current.js';

/** Only host mechanics are supplied here; Tracking owns the observation rules. */
const host: ITrackingObserverHost = {
  createAsyncContext<T>() { return new AsyncLocalStorage<T>(); },
  sha256(input: string): string { return createHash('sha256').update(input, 'utf8').digest('hex'); },
};

/** The declared slot includes an unread sibling to expose accidental widening. */
interface IConfig {
  readonly selected: object;
  readonly unread: string;
}

/** Current declaration correspondence is explicit and never inferred from old data. */
function slots(config: IConfig): ICurrentSlots {
  return { inputs: new Map([['config', { status: 'bound', value: config }]]), helpers: new Map() };
}

/** One captured pass-through result; the returned subtree is the only deep fact. */
function capturedInput(config: IConfig) {
  const observer = createTrackingObserver(host);
  const input = observer.tracked({ config }, { path: ['inputs'] });
  const capture = observer.capture(() => observer.snapshotOutput({ value: input.config.selected }));
  expect(capture.observations.filter(observation => observation.kind === 'materialized-output')).toHaveLength(1);
  return { observer, capture };
}

/** Compare original output evidence against a newly bound declared input. */
function compareInput(before: IConfig, after: IConfig): string {
  const { observer, capture } = capturedInput(before);
  const validation = createTrackingObserver(host);
  return observer.compareCurrent(capture, ownFactProvider({ validation, slots: slots(after), self: () => undefined })).kind;
}

/** Exact subtree selection remains distinct from the surrounding input record. */
const outputAtSelected: ICurrentFactRequest = {
  kind: 'materialized-output',
  address: [{ kind: 'property', key: 'config' }, { kind: 'property', key: 'selected' }],
  encodingVersion: 'MDS1',
};

describe('current materialized output facts', () => {
  test('unchanged declared-input output and an unread sibling edit compare equal', () => {
    const original = { selected: { a: 1, b: 2 }, unread: 'before' };
    expect(compareInput(original, { selected: { a: 1, b: 2 }, unread: 'before' })).toBe('equal');
    expect(compareInput(original, { selected: { a: 1, b: 2 }, unread: 'after' })).toBe('equal');
  });

  test('a changed selected leaf and changed record insertion order compare as MDS1 output changes', () => {
    const original = { selected: { a: 1, b: 2 }, unread: 'before' };
    expect(compareInput(original, { selected: { a: 3, b: 2 }, unread: 'before' })).toBe('changed');
    expect(compareInput(original, { selected: { b: 2, a: 1 }, unread: 'before' })).toBe('changed');
  });

  test('missing versus present undefined and sparse hole versus present undefined remain distinct output shapes', () => {
    expect(compareInput({ selected: {}, unread: '' }, { selected: { a: undefined }, unread: '' })).toBe('changed');
    expect(compareInput({ selected: new Array<undefined>(1), unread: '' }, { selected: [undefined], unread: '' })).toBe('changed');
  });

  test('member and forwarded argument output compare at their own current bindings', () => {
    const memberObserver = createTrackingObserver(host);
    const member = memberObserver.tracked({ selected: { score: 3 }, unread: 'one' }, { path: ['member'] });
    const memberCapture = memberObserver.capture(() => memberObserver.snapshotOutput({ value: member.selected }));
    const memberProvider = ownFactProvider({
      validation: createTrackingObserver(host), slots: slots({ selected: {}, unread: '' }), self: () => undefined,
      member: { selected: { score: 3 }, unread: 'two' },
    });
    expect(memberObserver.compareCurrent(memberCapture, memberProvider).kind).toBe('equal');
    const changedMember = ownFactProvider({
      validation: createTrackingObserver(host), slots: slots({ selected: {}, unread: '' }), self: () => undefined,
      member: { selected: { score: 4 }, unread: 'one' },
    });
    expect(memberObserver.compareCurrent(memberCapture, changedMember).kind).toBe('changed');

    const argumentObserver = createTrackingObserver(host);
    const argument = argumentObserver.tracked([{ score: 3 }], { path: ['argument'] });
    const argumentCapture = argumentObserver.capture(() => argumentObserver.snapshotOutput({ value: argument[0] }));
    const argumentProvider = ownFactProvider({
      validation: createTrackingObserver(host), slots: slots({ selected: {}, unread: '' }), self: () => undefined,
      arguments: [{ kind: 'data', value: { score: 3 } }],
    });
    expect(argumentObserver.compareCurrent(argumentCapture, argumentProvider).kind).toBe('equal');
    const changedArgument = ownFactProvider({
      validation: createTrackingObserver(host), slots: slots({ selected: {}, unread: '' }), self: () => undefined,
      arguments: [{ kind: 'data', value: { score: 4 } }],
    });
    expect(argumentObserver.compareCurrent(argumentCapture, changedArgument).kind).toBe('changed');
    const opaqueArgument = ownFactProvider({
      validation: createTrackingObserver(host), slots: slots({ selected: {}, unread: '' }), self: () => undefined,
      arguments: [{ kind: 'opaque', reason: 'not reconstructible' }],
    });
    const explicit = argumentCapture.observations.find(observation => observation.kind === 'materialized-output');
    if (explicit === undefined) { throw new Error('Expected recorded argument output'); }
    expect(opaqueArgument.resolve(explicit.binding, explicit.selection).kind).toBe('incompatible');
    // The preceding navigation-kind fact may report a changed shape before this output fact.
    expect(argumentObserver.compareCurrent(argumentCapture, opaqueArgument).kind).not.toBe('equal');
  });

  test('selection cannot use a stored value, scalar root, foreign binding or missing declaration', () => {
    const validation = createTrackingObserver(host);
    const provider = ownFactProvider({
      validation, slots: slots({ selected: { a: 2 }, unread: 'text' }), self: () => undefined,
    });
    const current = provider.resolve({ path: ['inputs'] }, outputAtSelected);
    expect(current.kind).toBe('available');
    if (current.kind !== 'available') { throw new Error('Current subtree was not supplied'); }
    expect(current.fact).toEqual({ a: 2 });
    expect(provider.resolve({ path: ['inputs', 'foreign'] }, outputAtSelected).kind).toBe('unavailable');
    expect(provider.resolve({ path: ['inputs'] }, {
      kind: 'materialized-output', address: [{ kind: 'property', key: 'config' }, { kind: 'property', key: 'unread' }], encodingVersion: 'MDS1',
    }).kind).toBe('incompatible');
    const missing = ownFactProvider({
      validation: createTrackingObserver(host),
      slots: { inputs: new Map([['config', { status: 'missing' }]]), helpers: new Map() }, self: () => undefined,
    });
    expect(missing.resolve({ path: ['inputs'] }, outputAtSelected).kind).toBe('unavailable');
    const ambiguous = ownFactProvider({
      validation: createTrackingObserver(host),
      slots: { inputs: new Map([['config', { status: 'ambiguous' }]]), helpers: new Map() }, self: () => undefined,
    });
    expect(ambiguous.resolve({ path: ['inputs'] }, outputAtSelected).kind).toBe('ambiguous');
  });

  test('unsupported current data rejects visibly instead of supplying a comparable fact', () => {
    const provider = ownFactProvider({
      validation: createTrackingObserver(host),
      slots: slots({ selected: { unsupported: new Date(0) }, unread: '' }), self: () => undefined,
    });
    expect(() => provider.resolve({ path: ['inputs'] }, outputAtSelected)).toThrow(/unsupported/i);
  });
});
