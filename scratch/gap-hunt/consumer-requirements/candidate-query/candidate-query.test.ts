import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { beforeAll, expect, test } from '@jest/globals';

/** One unchanged candidate query's instruction count, independent of wall time. */
interface IMeasurement {
  readonly implementation: string;
  readonly filler: string;
  readonly population: number;
  readonly vm_steps: number;
}

/** Validate diagnostic records instead of trusting an external JSON assertion. */
function measurement(value: unknown): IMeasurement {
  if (typeof value !== 'object' || value === null
    || !('implementation' in value) || typeof value.implementation !== 'string'
    || !('filler' in value) || typeof value.filler !== 'string'
    || !('population' in value) || typeof value.population !== 'number'
    || !('vm_steps' in value) || typeof value.vm_steps !== 'number') {
    throw new Error('Malformed measurement');
  }
  return { implementation: value.implementation, filler: value.filler,
    population: value.population, vm_steps: value.vm_steps };
}

/** Keep one bounded subprocess for the entire matrix; no consumer database is opened. */
let rows: readonly IMeasurement[] = [];
beforeAll(() => {
  const output = execFileSync('python3', [fileURLToPath(new URL('../repro.py', import.meta.url)), '--diagnostic-only'], { encoding: 'utf8' });
  const decoded: unknown = JSON.parse(output);
  if (typeof decoded !== 'object' || decoded === null || !('rows' in decoded) || !Array.isArray(decoded.rows)) {
    throw new Error('Missing measurements');
  }
  rows = decoded.rows.map((row: unknown) => measurement(row));
});

/** Select an independently measured row, never synthesize a missing counter. */
function steps(implementation: string, filler: string, population: number): number {
  const row = rows.find((entry) => entry.implementation === implementation && entry.filler === filler && entry.population === population);
  if (row === undefined) { throw new Error('Missing measurement'); }
  return row.vm_steps;
}

test('published exact lookup ignores unrelated same-analysis subjects', () => {
  expect(steps('published', 'same-analysis', 10000)).toBe(steps('published', 'same-analysis', 100));
});
test('other-analysis filler does not grow main candidate query work', () => {
  expect(steps('main', 'other-analysis', 10000)).toBe(steps('main', 'other-analysis', 100));
});
test('all captured semantic and absent-subject controls completed', () => {
  // Python asserts same-environment order, version, absent and promotion isolation before emitting.
  expect(rows).toHaveLength(18);
});
test('main exact lookup must not scan every unrelated same-analysis subject', () => {
  // Doubling allowance is deliberately generous for 10x unrelated growth;
  // this is a regression discriminator, not a universal constant-time SLA.
  expect(steps('main', 'same-analysis', 1000)).toBeLessThanOrEqual(2 * steps('main', 'same-analysis', 100));
});
