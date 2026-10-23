/** Warm retained output must match a cold computation's complete supported snapshot after restart. */
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import { describe, expect, test } from '@jest/globals';
interface IResult { readonly kind: string; readonly reference: unknown; readonly wire: string }
const worker = fileURLToPath(new URL('./gap-hunt-contracts-output-worker.js', import.meta.url));
function resolve(location: string, variant: string, request: string, slot = 'output'): IResult {
  const child = spawnSync(process.execPath, [worker, location, variant, request, slot], { encoding: 'utf8' });
  if (child.status !== 0) { throw new Error(child.stderr); }
  const value: unknown = JSON.parse(child.stdout);
  if (typeof value !== 'object' || value === null || !('kind' in value) || typeof value.kind !== 'string' || !('reference' in value) || !('wire' in value) || typeof value.wire !== 'string') { throw new Error('Malformed output worker'); }
  return { kind: value.kind, reference: value.reference, wire: value.wire };
}
describe('gap hunt TRK-8 durable pass-through output shape', () => {
  test('scalar-only output reuses under identical current input as a positive control', () => {
    const directory = mkdtempSync(join(tmpdir(), 'microdelta-output-scalar-'));
    try {
      const retained = join(directory, 'retained.sqlite');
      const original = resolve(retained, 'base', 'first', 'scalar');
      const current = resolve(retained, 'base', 'second', 'scalar');
      expect(current.kind).toBe('reused');
      expect(current.reference).toEqual(original.reference);
      expect(current.wire).toBe(original.wire);
    } finally { rmSync(directory, { recursive: true, force: true }); }
  });
  test.each([
    ['base', 'base', 'reused'], ['base', 'unread', 'reused'], ['base', 'order', 'published'], ['base', 'value', 'published'],
    ['missing', 'undefined', 'published'], ['hole', 'slot', 'published'],
    ['inherited', 'inherited-change', 'published'], ['inherited', 'own', 'published'],
  ])('%s → %s agrees with cold output and rollback retains the original exact result', (before, after, expected) => {
    const directory = mkdtempSync(join(tmpdir(), 'microdelta-output-'));
    try {
      const retained = join(directory, 'retained.sqlite');
      const original = resolve(retained, before, 'one');
      const actual = resolve(retained, after, 'two');
      const cold = resolve(join(directory, 'cold.sqlite'), after, 'cold');
      expect(actual.kind).toBe(expected);
      expect(actual.wire).toBe(cold.wire);
      if (expected === 'reused') { expect(actual.reference).toEqual(original.reference); }
      const restored = resolve(retained, before, 'three');
      expect(restored.kind).toBe('reused');
      expect(restored.reference).toEqual(original.reference);
      expect(restored.wire).toBe(original.wire);
    } finally { rmSync(directory, { recursive: true, force: true }); }
  });
});
