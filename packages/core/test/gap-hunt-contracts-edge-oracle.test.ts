/** Bounded differential matrix checks current semantic values against independent cold SQLite stores. */
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import { describe, expect, test } from '@jest/globals';

interface IResult { readonly kind: string; readonly reference: unknown; readonly value: unknown }
function resultOf(value: unknown): IResult {
  if (typeof value !== 'object' || value === null || !('kind' in value) || typeof value.kind !== 'string' || !('reference' in value) || !('value' in value)) { throw new Error('Malformed worker response'); }
  return { kind: value.kind, reference: value.reference, value: value.value };
}
const worker = fileURLToPath(new URL('./gap-hunt-contracts-edge-worker.js', import.meta.url));
function run(location: string, key: string, variant: string, slot: string, request: string): IResult {
  const child = spawnSync(process.execPath, [worker, location, Buffer.from(key, 'utf16le').toString('base64'), variant, slot, request], { encoding: 'utf8' });
  if (child.status !== 0) { throw new Error(child.stderr); }
  return resultOf(JSON.parse(child.stdout));
}

/** Every matrix row has an explicit mutation sequence and reuse expectation, never random generation. */
function sequence(key: string, slot: string, variants: readonly string[], kinds?: readonly string[]): void {
  const directory = mkdtempSync(join(tmpdir(), 'microdelta-edge-oracle-'));
  try {
    const retained = join(directory, 'retained.sqlite');
    for (const [index, variant] of variants.entries()) {
      const actual = run(retained, key, variant, slot, `warm-${index}`);
      const oracle = run(join(directory, `cold-${index}.sqlite`), key, variant, slot, `cold-${index}`);
      expect(actual.value).toEqual(oracle.value);
      if (kinds !== undefined) { expect(actual.kind).toBe(kinds[index]); }
    }
  } finally { rmSync(directory, { recursive: true, force: true }); }
}

describe('gap hunt finite special-key and value oracle', () => {
  test.each(['then', '__proto__', 'constructor', 'a.b[0]', '0', '01', '🧭', '\ud800'])('literal special key %s: unread/equal-inherited/changed/current rollback', (key) => {
    sequence(key, 'leaf', ['base', 'unread-change', 'inherited-same', 'leaf-change', 'inherited-change', 'base'], ['published', 'reused', 'reused', 'published', 'reused', 'reused']);
  });
  test.each(['then', '__proto__', 'constructor', 'a.b[0]', '0', '🧭'])('membership special key %s distinguishes present undefined and missing', (key) => {
    // Missing uses a null-prototype dictionary; intrinsic Object.prototype
    // presence is a separate supported-domain boundary probe.
    sequence(key, 'membership', ['base', 'present-undefined', 'inherited-same', 'missing']);
  });
  test.each(['a.b[0]', '0', '🧭'])('value conditional %s equates missing/present undefined but detects actual values', (key) => {
    sequence(key, 'condition', ['missing', 'present-undefined', 'base', 'leaf-change', 'missing'], ['published', 'reused', 'published', 'published', 'reused']);
  });
  test('sparse hole and present undefined have equal positional value reads, then a fill changes it', () => {
    sequence('unused', 'position', ['rows-hole', 'rows-undefined', 'rows-fill', 'rows-hole'], ['published', 'reused', 'published', 'reused']);
  });
  test('sparse hole and present undefined have distinct indexed membership facts', () => {
    sequence('unused', 'arrayMembership', ['rows-hole', 'rows-undefined', 'rows-fill', 'rows-hole'], ['published', 'published', 'reused', 'reused']);
  });
  test('canonical number atoms distinguish zero signs, NaN and infinities across restart and rollback', () => {
    sequence('unused', 'number', ['base', 'negative-zero', 'nan', 'infinity', 'negative-infinity', 'nan', 'negative-zero'], ['published', 'published', 'published', 'published', 'published', 'reused', 'reused']);
  });
});
