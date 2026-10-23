/** Fresh current roots challenge operation precision independently of workspace persistence. */
import { AsyncLocalStorage } from 'node:async_hooks';
import { createHash } from 'node:crypto';
import { describe, expect, test } from '@jest/globals';
import { observe } from '@microdelta/value';
import { createTrackingObserver } from '../src/index.js';
import type { ICurrentFactProvider, ITrackingObserver } from '../src/index.js';

/** Supply host mechanics only; the observer still owns semantic decisions. */
function observer(): ITrackingObserver {
  return createTrackingObserver({
    createAsyncContext<T>() { return new AsyncLocalStorage<T>(); },
    sha256(input: string): string { return createHash('sha256').update(input, 'utf8').digest('hex'); },
  });
}

/** Current facts come from a new root, avoiding stale-wrapper comparison as an accidental oracle. */
function current(root: unknown): ICurrentFactProvider {
  return { resolve(_binding, request) {
    if (request.kind === 'selected') { return { kind: 'available', fact: observe(root, request.address, request.operation) }; }
    if (request.kind === 'implementation') { return { kind: 'available', fact: root }; }
    return { kind: 'unavailable' };
  } };
}

/** Each row states an independent TRK-5 operation and its expected change boundary. */
interface ICase {
  readonly name: string;
  readonly old: { readonly optional?: string | undefined; readonly rows: readonly number[]; readonly unread: string };
  readonly next: ICase['old'];
  readonly operation: 'optional' | 'own' | 'membership' | 'index' | 'length';
  readonly expected: 'equal' | 'changed';
}
const base: ICase['old'] = { rows: [1, 2], unread: 'old' };
const cases: readonly ICase[] = [
  { name: 'missing versus present undefined value', old: base, next: { ...base, optional: undefined }, operation: 'optional', expected: 'equal' },
  { name: 'missing versus present undefined own presence', old: base, next: { ...base, optional: undefined }, operation: 'own', expected: 'changed' },
  { name: 'missing versus present undefined membership', old: base, next: { ...base, optional: undefined }, operation: 'membership', expected: 'changed' },
  { name: 'unread field edit', old: base, next: { ...base, unread: 'new' }, operation: 'index', expected: 'equal' },
  { name: 'same length element replacement', old: base, next: { ...base, rows: [9, 2] }, operation: 'length', expected: 'equal' },
  { name: 'append changes length', old: base, next: { ...base, rows: [1, 2, 3] }, operation: 'length', expected: 'changed' },
  { name: 'insert before consumed position', old: base, next: { ...base, rows: [9, 1, 2] }, operation: 'index', expected: 'changed' },
  { name: 'edit after consumed position', old: base, next: { ...base, rows: [1, 9] }, operation: 'index', expected: 'equal' },
];

describe('gap hunt TRK-5 invalidation matrix', () => {
  test.each(cases)('$name', (row) => {
    const subject = observer();
    const input = subject.tracked(row.old, { path: ['input'] });
    const capture = subject.capture(() => {
      // eslint-disable-next-line microdelta/tracked-captures -- Test-owned operation selection is fixed before capture and is not retained consumer state.
      switch (row.operation) {
        case 'optional': return input.optional;
        case 'own': return subject.hasOwn(input, 'optional');
        case 'membership': return 'optional' in input;
        case 'index': return input.rows[0];
        case 'length': return input.rows.length;
      }
    });
    expect(subject.compareCurrent(capture, current(row.next)).kind).toBe(row.expected);
  });

  test('TRK-2 called helper implementation changes invalidate', () => {
    const subject = observer();
    const first = subject.tracked(function helper(): number { return 1; }, { path: ['helper'] });
    const capture = subject.capture(() => first());
    expect(subject.compareCurrent(capture, current(function helper(): number { return 2; })).kind).toBe('changed');
  });

  test('TRK-2 emitted comment and function-name edits conservatively invalidate', () => {
    const subject = observer();
    const first = subject.tracked(function helper(): number { return 1; }, { path: ['helper'] });
    const capture = subject.capture(() => first());
    expect(subject.compareCurrent(capture, current(function renamed(): number { return 1; })).kind).toBe('changed');
    expect(subject.compareCurrent(capture, current(function helper(): number { /* changed comment */ return 1; })).kind).toBe('changed');
  });

  test('TRK-2 uncalled helper contributes no evidence', () => {
    const subject = observer();
    subject.tracked(function unused(): number { return 1; }, { path: ['helper'] });
    const capture = subject.capture(() => 7);
    expect(capture.observations).toEqual([]);
    expect(subject.compareCurrent(capture, current(function unused(): number { return 2; })).kind).toBe('equal');
  });

  test('TRK-5 reflection fails visibly and explicit selected serialization remains available', () => {
    const subject = observer();
    const input = subject.tracked({ name: 'Ada', unread: 'private' }, { path: ['input'] });
    expect(() => JSON.stringify(input)).toThrow(/reflection|unsupported/i);
    // eslint-disable-next-line microdelta/tracked-captures -- Native JSON serialization of explicitly selected scalars is the DX workaround under test.
    const capture = subject.capture(() => JSON.stringify({ name: input.name }));
    expect(capture.value).toBe('{"name":"Ada"}');
    expect(subject.compareCurrent(capture, current({ name: 'Ada', unread: 'changed' })).kind).toBe('equal');
  });
});

/** Ordered ranking reads only its explicit keys and scores; member payloads remain separate facts. */
test('TRK-5 ordered ranking changes with selected scores and ignores unselected member fields', () => {
  const subject = observer();
  const root = { members: [{ key: 'a', score: 2, avatar: 'old-a' }, { key: 'b', score: 1, avatar: 'old-b' }] };
  const input = subject.tracked(root, { path: ['ranking'] });
  const capture = subject.capture(() => {
    const selected: { key: string; score: number }[] = [];
    for (let index = 0; index < input.members.length; index += 1) {
      const member = input.members[index];
      if (member !== undefined) { selected.push({ key: member.key, score: member.score }); }
    }
    selected.sort((left, right) => right.score - left.score);
    return selected.map(member => member.key);
  });
  expect(capture.value).toEqual(['a', 'b']);
  expect(subject.compareCurrent(capture, current({ members: root.members.map(member => ({ ...member, avatar: 'new' })) })).kind).toBe('equal');
  expect(subject.compareCurrent(capture, current({ members: [{ key: 'a', score: 0, avatar: 'old-a' }, root.members[1]] })).kind).toBe('changed');
  expect(JSON.stringify(capture.observations)).not.toContain('avatar');
});
