/**
 * Supplement to unchanged 9267a44 reproductions: their historical zero-fact
 * diagnostic blocks their final invalidation assertion after #155 adds a
 * container-kind fact. This independently reaches that same behavioral check;
 * it does not replace or weaken the preserved original reproduction.
 */
import { AsyncLocalStorage } from 'node:async_hooks';
import { createHash } from 'node:crypto';

import { expect, test } from '@jest/globals';
import { observe } from '@microdelta/value';

import { createTrackingObserver } from '../src/index.js';
import type { ICurrentFactProvider } from '../src/index.js';

interface IInput { readonly detail?: { readonly name: string } | null }

test.each([null, undefined])('original blocked compareCurrent expectation: record to %s is changed', (replacement) => {
  const observer = createTrackingObserver({
    createAsyncContext<T>() { return new AsyncLocalStorage<T>(); },
    sha256(input: string): string { return createHash('sha256').update(input).digest('hex'); },
  });
  const input = observer.tracked<IInput>({ detail: { name: 'Ada' } }, { path: ['input'] });
  const captured = observer.capture(() => input.detail ? 'present' : 'absent');
  const changed: IInput = replacement === undefined ? {} : { detail: replacement };
  const current: ICurrentFactProvider = { resolve(_binding, request) {
    if (request.kind !== 'selected') { return { kind: 'unavailable' }; }
    return { kind: 'available', fact: observe(changed, request.address, request.operation) };
  } };
  expect(captured.value).toBe('present');
  expect(captured.observations).toHaveLength(1);
  expect(captured.observations[0]).toMatchObject({ kind: 'fact', operation: 'container-kind', address: [{ kind: 'property', key: 'detail' }] });
  expect(observer.compareCurrent(captured, current).kind).toBe('changed');
});
