/** Presence operations must not consume the unsupported intrinsic value behind a present property. */
import { AsyncLocalStorage } from 'node:async_hooks';
import { createHash } from 'node:crypto';
import { describe, expect, test } from '@jest/globals';
import { observe } from '@microdelta/value';
import { createTrackingObserver } from '../src/index.js';

const observer = createTrackingObserver({
  createAsyncContext<T>() { return new AsyncLocalStorage<T>(); },
  sha256(input: string): string { return createHash('sha256').update(input, 'utf8').digest('hex'); },
});

describe('gap hunt TRK-5 intrinsic presence versus selected value', () => {
  test.each(['constructor', '__proto__', 'toString', 'hasOwnProperty'])('%s own-presence does not select intrinsic member data', (key) => {
    expect(observe({}, [{ kind: 'property', key }], 'own').fact).toBe(false);
  });

  test.each(['constructor', '__proto__', 'toString', 'hasOwnProperty'])('%s inherited membership does not select intrinsic member data', (key) => {
    expect(observe({}, [{ kind: 'property', key }], 'membership').fact).toBe(true);
  });

  test('selected intrinsic values remain intentionally unsupported', () => {
    for (const key of ['constructor', '__proto__', 'toString', 'hasOwnProperty']) {
      expect(() => observe({}, [{ kind: 'property', key }], 'value')).toThrow(/intrinsic/i);
    }
  });

  test('ordinary tracked membership needs only a boolean fact, not Object.prototype.constructor', () => {
    const input = observer.tracked({}, { path: ['plain'] });
    const capture = observer.capture(() => 'constructor' in input);
    expect(capture.value).toBe(true);
    expect(capture.observations).toHaveLength(1);
    expect(capture.observations[0]).toMatchObject({ operation: 'membership' });
  });

  test('own data property shadows intrinsic member and custom prototype membership remains supported', () => {
    const prototype = { constructor: 'data' };
    const plain: object = {};
    Object.setPrototypeOf(plain, prototype);
    const address = [{ kind: 'property' as const, key: 'constructor' }];
    expect(observe(plain, address, 'own').fact).toBe(false);
    expect(observe(plain, address, 'membership').fact).toBe(true);
    expect(observe(plain, address, 'value').fact).toBe('data');
    expect(observe({ constructor: 'own' }, address, 'own').fact).toBe(true);
  });
});
