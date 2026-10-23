/** Durable reuse must agree with an independent cold current computation after each input transition. */
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import { describe, expect, test } from '@jest/globals';

/** Narrow untrusted subprocess JSON at the boundary rather than casting its result. */
interface IResult { readonly kind: string; readonly reference: unknown; readonly value: unknown }
function resultOf(value: unknown): IResult {
  if (typeof value !== 'object' || value === null || !('kind' in value) || typeof value.kind !== 'string' || !('reference' in value) || !('value' in value)) { throw new Error('Malformed worker result'); }
  return { kind: value.kind, reference: value.reference, value: value.value };
}
const worker = fileURLToPath(new URL('./gap-hunt-contracts-operation-worker.js', import.meta.url));
function resolve(location: string, variant: string, operation: string, request: string): IResult {
  const child = spawnSync(process.execPath, [worker, location, variant, operation, request], { encoding: 'utf8' });
  if (child.status !== 0) { throw new Error(child.stderr); }
  return resultOf(JSON.parse(child.stdout));
}

/** An oracle store has no old candidate, so its result cannot inherit false reuse. */
describe('gap hunt fresh-process consumer operation matrix', () => {
  test.each([
    ['type', 'record', 'missing'], ['type', 'record', 'null'], ['type', 'null', 'record'],
    ['array', 'record', 'array'], ['array', 'array', 'record'], ['array', 'array', 'null'],
    ['nullish', 'record', 'null'], ['nullish', 'record', 'missing'], ['nullish', 'null', 'record'],
    ['optional', 'record', 'null'], ['optional', 'record', 'nested-null'], ['optional', 'missing', 'record'],
  ])('%s agrees with cold current value for %s → %s', (operation, before, after) => {
    const directory = mkdtempSync(join(tmpdir(), 'microdelta-operations-'));
    try {
      const retained = join(directory, 'retained.sqlite');
      resolve(retained, before, operation, 'first');
      const actual = resolve(retained, after, operation, 'second');
      const oracle = resolve(join(directory, 'cold.sqlite'), after, operation, 'cold');
      expect(actual.value).toEqual(oracle.value);
    } finally { rmSync(directory, { recursive: true, force: true }); }
  });

  test('TRK-5 falsey guard values remain distinct consumption across restart despite equal branch output', () => {
    const directory = mkdtempSync(join(tmpdir(), 'microdelta-falsey-'));
    try {
      const retained = join(directory, 'retained.sqlite');
      const original = resolve(retained, 'flag-zero', 'falsey', 'zero');
      let previous = original;
      for (const variant of ['flag-empty', 'flag-false', 'flag-null', 'flag-undefined', 'flag-nan', 'flag-negative-zero']) {
        const current = resolve(retained, variant, 'falsey', variant);
        expect(current.value).toEqual({ value: 'falsey' });
        expect(current.kind).toBe('published');
        expect(current.reference).not.toEqual(previous.reference);
        previous = current;
      }
      const restored = resolve(retained, 'flag-zero', 'falsey', 'rollback');
      expect(restored.kind).toBe('reused');
      expect(restored.reference).toEqual(original.reference);
    } finally { rmSync(directory, { recursive: true, force: true }); }
  });

  test('TRK-8 durable scalar branch replacement abandons old reads and detects newly active reads', () => {
    const directory = mkdtempSync(join(tmpdir(), 'microdelta-branches-'));
    try {
      const retained = join(directory, 'retained.sqlite');
      const first = resolve(retained, 'record', 'branch', 'one');
      expect(first.value).toEqual({ value: 'Ada' });
      const flipped = resolve(retained, 'branch-other', 'branch', 'two');
      expect(flipped.kind).toBe('published');
      expect(flipped.value).toEqual({ value: 2 });
      const abandoned = resolve(retained, 'branch-abandoned', 'branch', 'three');
      expect(abandoned.kind).toBe('reused');
      expect(abandoned.reference).toEqual(flipped.reference);
      const active = resolve(retained, 'branch-active', 'branch', 'four');
      expect(active.kind).toBe('published');
      expect(active.value).toEqual({ value: 3 });
      const restored = resolve(retained, 'record', 'branch', 'five');
      expect(restored.kind).toBe('reused');
      expect(restored.reference).toEqual(first.reference);
    } finally { rmSync(directory, { recursive: true, force: true }); }
  });

  test('TRK-6 historical path rebinds through two equal identities and detects both later leaf updates', () => {
    const directory = mkdtempSync(join(tmpdir(), 'microdelta-rebinding-'));
    try {
      const retained = join(directory, 'retained.sqlite');
      const first = resolve(retained, 'record', 'leaf', 'one');
      const equal = resolve(retained, 'new-author-equal', 'leaf', 'two');
      expect(equal.kind).toBe('reused');
      expect(equal.reference).toEqual(first.reference);
      const changed = resolve(retained, 'new-author-change', 'leaf', 'three');
      expect(changed.kind).toBe('published');
      expect(changed.value).toEqual({ value: 'Grace' });
      const equalAgain = resolve(retained, 'third-author-equal', 'leaf', 'four');
      expect(equalAgain.kind).toBe('reused');
      expect(equalAgain.reference).toEqual(changed.reference);
      const changedAgain = resolve(retained, 'third-author-change', 'leaf', 'five');
      expect(changedAgain.kind).toBe('published');
      expect(changedAgain.value).toEqual({ value: 'Katherine' });
    } finally { rmSync(directory, { recursive: true, force: true }); }
  });
});
