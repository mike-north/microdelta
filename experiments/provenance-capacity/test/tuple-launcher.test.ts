/** Tests-first cohort limits prevent resetting deadline or spending reviewer/receipt reservations. */
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { artifactInventory } from '../src/tuple-driver.js';
import { inventoryFingerprint } from '../src/tuple-retention.js';
import { expect, test } from '@jest/globals';
import { cohortBudget } from '../src/tuple-launcher.js';

test('author worker allowance preserves held-out and receipt reserve under the same cap', () => {
  const author = cohortBudget(100, 200000, 'author'); const heldout = cohortBudget(100, 200000, 'heldout');
  expect(author).toEqual({ timeoutMs: 119900, outputBytes: 1048576 - 200000 - 393216 });
  expect(heldout).toEqual({ timeoutMs: 119900, outputBytes: 1048576 - 200000 - 32768 });
  expect(author.outputBytes).toBeLessThan(heldout.outputBytes);
  for (const [elapsed, bytes] of [[120000, 0], [1, 1048576], [-1, 0], [0, -1], [0, Number.MAX_SAFE_INTEGER]]) {
    if (elapsed === undefined || bytes === undefined) { throw new Error('limit fixture'); }
    expect(() => cohortBudget(elapsed, bytes, 'author')).toThrow();
  }
});

/** Compatibility reading an old plan never authorizes a new author invocation without both failures. */
test('fresh author CLI cannot omit the second sealed failure and write a plan', () => {
  const parent = mkdtempSync(join(tmpdir(), 'tuple-cli-test-')); const frozen = join(parent, 'old'); const fresh = join(parent, 'fresh');
  try {
    mkdirSync(frozen); mkdirSync(fresh);
    expect(() => execFileSync(process.execPath, [fileURLToPath(new URL('../src/tuple-launcher.js', import.meta.url)), fresh, 'author', frozen, inventoryFingerprint(artifactInventory(frozen))], { timeout: 2000, maxBuffer: 4096, stdio: 'pipe' })).toThrow();
    expect(artifactInventory(fresh).files).toHaveLength(0);
  } finally { rmSync(parent, { recursive: true, force: true }); }
});
