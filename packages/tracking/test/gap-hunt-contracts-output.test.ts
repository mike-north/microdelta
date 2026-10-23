/** Returned subtrees consume their transported shape, including lookup and enumeration semantics. */
import { AsyncLocalStorage } from 'node:async_hooks';
import { createHash } from 'node:crypto';
import { describe, expect, test } from '@jest/globals';
import { createTrackingObserver } from '../src/index.js';
import type { ICurrentFactProvider } from '../src/index.js';

interface IOutputCase {
  readonly name: string;
  readonly before: object;
  readonly after: object;
  readonly expected: 'equal' | 'changed';
}
/** Define inherited enumerable data without conflating it with owned fields. */
function inherited(value: string): object {
  const prototype: object = Object.create(null) as object;
  Object.defineProperty(prototype, 'role', { value, enumerable: true });
  const result: object = Object.create(prototype) as object;
  Object.defineProperty(result, 'name', { value: 'Ada', enumerable: true });
  return result;
}
const hole = new Array<undefined>(1);
const cases: readonly IOutputCase[] = [
  { name: 'changed returned leaf', before: { name: 'Ada' }, after: { name: 'Grace' }, expected: 'changed' },
  { name: 'equal detached shape', before: { name: 'Ada' }, after: { name: 'Ada' }, expected: 'equal' },
  { name: 'record insertion order', before: { a: 1, b: 2 }, after: { b: 2, a: 1 }, expected: 'changed' },
  { name: 'missing versus present undefined', before: {}, after: { name: undefined }, expected: 'changed' },
  { name: 'array hole versus present undefined', before: hole, after: [undefined], expected: 'changed' },
  { name: 'inherited data value', before: inherited('author'), after: inherited('reviewer'), expected: 'changed' },
  { name: 'equal custom lookup chain', before: inherited('author'), after: inherited('author'), expected: 'equal' },
  { name: 'inherited versus own data', before: inherited('author'), after: { name: 'Ada', role: 'author' }, expected: 'changed' },
];

describe('gap hunt TRK-8 explicit output current-shape precision', () => {
  test.each(cases)('$name', row => {
    const subject = createTrackingObserver({
      createAsyncContext<T>() { return new AsyncLocalStorage<T>(); },
      sha256(input: string): string { return createHash('sha256').update(input, 'utf8').digest('hex'); },
    });
    const input = subject.tracked({ selected: row.before, unread: 'before' }, { path: ['input'] });
    const capture = subject.capture(() => subject.snapshotOutput({ value: input.selected }));
    expect(capture.observations).toHaveLength(1);
    expect(capture.observations[0]).toMatchObject({ kind: 'materialized-output', address: [{ kind: 'property', key: 'selected' }] });
    /** A new current root supplies exactly the requested selected subtree; unread edits stay outside the request. */
    const next = { selected: row.after, unread: 'changed unread sibling' };
    const provider: ICurrentFactProvider = { resolve(binding, request) {
      expect(binding.path).toEqual(['input']);
      if (request.kind !== 'materialized-output') { return { kind: 'incompatible' }; }
      expect(request.address).toEqual([{ kind: 'property', key: 'selected' }]);
      return { kind: 'available', fact: next.selected };
    } };
    expect(subject.compareCurrent(capture, provider).kind).toBe(row.expected);
    expect(Object.isFrozen(capture.value)).toBe(true);
    expect(Object.isFrozen(capture.value.value)).toBe(true);
  });
});
