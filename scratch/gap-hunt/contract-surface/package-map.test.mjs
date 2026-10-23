/** Current implementation maps must not deny facade wiring proven by its suite. */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const root = new URL('../../../', import.meta.url);
test('current package map acknowledges caller-supplied facade Accounting assembly', () => {
  const map = readFileSync(new URL('docs/package-map.md', root), 'utf8');
  // Companion runtime proof: workspace-operations/operations.test.ts, 15 tests.
  assert.doesNotMatch(map, /facade does not yet wire the accounting port/u);
  assert.doesNotMatch(map, /composed with it only in the facade's tests until facade assembly/u);
});
