/** TRK-4/5/8 guards on tracked nullable containers must not silently lose their influence. */
import { AsyncLocalStorage } from 'node:async_hooks';
import { createHash } from 'node:crypto';
import { describe, expect, test } from '@jest/globals';
import { observe } from '@microdelta/value';
import { createTrackingObserver } from '../src/index.js';
import type { ICurrentFactProvider } from '../src/index.js';

/** A nullable/optional container is supported data, not an untracked external closure. */
interface IInput { readonly detail?: { readonly name: string } | null }

/** Current selected facts are supplied from a genuinely changed root. */
function current(root: IInput): ICurrentFactProvider {
  return { resolve(_binding, request) {
    if (request.kind !== 'selected') { return { kind: 'unavailable' }; }
    return { kind: 'available', fact: observe(root, request.address, request.operation) };
  } };
}

describe('gap hunt tracked container guard precision', () => {
  test('TRK-5 explicit own presence positive control records container deletion', () => {
    const observer = createTrackingObserver({
      createAsyncContext<T>() { return new AsyncLocalStorage<T>(); },
      sha256(input: string): string { return createHash('sha256').update(input).digest('hex'); },
    });
    const input = observer.tracked<IInput>({ detail: { name: 'Ada' } }, { path: ['input'] });
    const captured = observer.capture(() => observer.hasOwn(input, 'detail'));
    expect(observer.compareCurrent(captured, current({})).kind).toBe('changed');
    expect(observer.compareCurrent(captured, current({ detail: null })).kind).toBe('equal');
  });
  test('TRK-5 explicit null comparison on a tracked container records replacement', () => {
    const observer = createTrackingObserver({
      createAsyncContext<T>() { return new AsyncLocalStorage<T>(); },
      sha256(input: string): string { return createHash('sha256').update(input).digest('hex'); },
    });
    const input = observer.tracked<IInput>({ detail: { name: 'Ada' } }, { path: ['input'] });
    const captured = observer.capture(() => input.detail !== null);
    expect(captured.value).toBe(true);
    expect(observer.compareCurrent(captured, current({ detail: null })).kind).toBe('changed');
  });

  test.each([null, undefined])('TRK-8 container presence guard detects replacement with %s', (replacement) => {
    const observer = createTrackingObserver({
      createAsyncContext<T>() { return new AsyncLocalStorage<T>(); },
      sha256(input: string): string { return createHash('sha256').update(input).digest('hex'); },
    });
    const input = observer.tracked<IInput>({ detail: { name: 'Ada' } }, { path: ['input'] });
    const captured = observer.capture(() => input.detail ? 'present' : 'absent');
    const changed: IInput = replacement === undefined ? {} : { detail: replacement };
    expect(captured.value).toBe('present');
    expect(captured.observations.length).toBeGreaterThan(0);
    expect(observer.compareCurrent(captured, current(changed)).kind).toBe('changed');
  });
});

/** Guards retain kind alone; record payload and identity remain outside the consumed evidence. */
test('TRK-5 terminal container navigation observes only its bounded kind', () => {
  const observer = createTrackingObserver({
    createAsyncContext<T>() { return new AsyncLocalStorage<T>(); },
    sha256(input: string): string { return createHash('sha256').update(input).digest('hex'); },
  });
  const input = observer.tracked<IInput>({ detail: { name: 'Ada' } }, { path: ['input'] });
  const captured = observer.capture(() => input.detail ? 'present' : 'absent');
  expect(captured.observations).toMatchObject([{ operation: 'container-kind', selection: { operation: 'container-kind' } }]);
  expect(captured.observations[0]?.encoded).not.toContain('Ada');
  expect(observer.compareCurrent(captured, current({ detail: { name: 'Grace' } })).kind).toBe('equal');
});

/** A fresh branch frame must forget the previous branch's leaf reads. */
test('TRK-8 changing to an absent container drops the abandoned leaf', () => {
  const observer = createTrackingObserver({
    createAsyncContext<T>() { return new AsyncLocalStorage<T>(); },
    sha256(input: string): string { return createHash('sha256').update(input).digest('hex'); },
  });
  const before = observer.tracked<IInput>({ detail: { name: 'Ada' } }, { path: ['input'] });
  const after = observer.tracked<IInput>({ detail: null }, { path: ['input'] });
  const first = observer.capture(() => before.detail?.name ?? 'absent');
  const second = observer.capture(() => after.detail?.name ?? 'absent');
  expect(first.observations.some((observation) => observation.address.length === 2)).toBe(true);
  expect(second.observations.every((observation) => observation.address.length === 1)).toBe(true);
  expect(second.value).toBe('absent');
});
