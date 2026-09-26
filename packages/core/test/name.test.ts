import { describe, expect, test } from '@jest/globals';

import { nameOf, syntheticNamePrefixes, syntheticNames } from '../src/name/index.js';

/** Give a valid function a fixture name without relying on transpiler inference. */
function namedFixture(name: unknown): () => void {
  const fn = (): void => {};
  Object.defineProperty(fn, 'name', { value: name, configurable: true });
  return fn;
}

describe('name', () => {
  test('NM-1: derives declared function, class, and inferred arrow names', () => {
    function build(): void {}
    class Report {}
    const f = (): void => {};

    expect(nameOf(build)).toBe('build');
    expect(nameOf(Report)).toBe('Report');
    expect(nameOf(f)).toBe('f');
  });

  test('NM-1: reports absence for anonymous expressions and bound functions', () => {
    expect(nameOf(() => {})).toBeUndefined();
    expect(nameOf(function (): void {})).toBeUndefined();
    expect(nameOf(function (): void {}.bind(null))).toBeUndefined();
    expect(nameOf(function build(): void {}.bind(null))).toBeUndefined();
  });

  test('NM-1: an explicit override wins over declared and synthetic names', () => {
    expect(nameOf(() => {}, 'x')).toBe('x');
    expect(nameOf(function build(): void {}, 'override')).toBe('override');
    expect(nameOf(namedFixture('default'), 'anonymous')).toBe('anonymous');
    expect(nameOf(namedFixture('build'), '')).toBe('');
    expect(nameOf(namedFixture('build'), undefined)).toBe('build');
  });

  test('NM-2: exports the immutable exact-name and prefix rejection vocabulary', () => {
    expect(syntheticNames).toEqual(['', 'anonymous', 'default']);
    expect(syntheticNamePrefixes).toEqual(['bound ']);
    expect(Object.isFrozen(syntheticNames)).toBe(true);
    expect(Object.isFrozen(syntheticNamePrefixes)).toBe(true);

    for (const name of syntheticNames) {
      expect(nameOf(namedFixture(name))).toBeUndefined();
    }
    for (const prefix of syntheticNamePrefixes) {
      expect(nameOf(namedFixture(prefix))).toBeUndefined();
      expect(nameOf(namedFixture(`${prefix}build`))).toBeUndefined();
    }
  });

  test('NM-1: rejects only exact names and declared prefixes without normalization', () => {
    for (const name of ['anonymousReport', 'defaultReport', 'boundary', 'Build', ' build ']) {
      expect(nameOf(namedFixture(name))).toBe(name);
    }
  });

  test('NM-1: malformed or throwing names on valid functions report absence', () => {
    expect(nameOf(namedFixture(7))).toBeUndefined();
    const throwing = new Proxy((): void => {}, {
      get(): never {
        throw new Error('name access is unavailable');
      },
    });
    expect(nameOf(throwing)).toBeUndefined();
    expect(nameOf(throwing, 'explicit')).toBe('explicit');
  });
});
