/** Tests-first four-root accounting, immutable evidence and exact C-only held-out input reuse. */
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, test } from '@jest/globals';
import { artifactInventory } from '../src/tuple-driver.js';
import { inventoryFingerprint } from '../src/tuple-retention.js';
import { coldProvenance } from '../src/guards.js';
import { createHeldoutRetentionPlan, heldoutInputPath, heldoutRetainedInventory, validateHeldoutInputs, writeHeldoutArtifact } from '../src/tuple-heldout-retention.js';
import type { IOriginalAuthorPins } from '../src/tuple-heldout-retention.js';

/** Small independent source pin fixtures are not claims about the real retained author. */
const author: IOriginalAuthorPins = { sourceCommit: 'a'.repeat(40), manifestSha256: 'b'.repeat(64), analysisSha256: 'c'.repeat(64), batchSha256: 'd'.repeat(64), workerPrefixSha256: 'e'.repeat(64), errorsSourceSha256: 'f'.repeat(64) };
function paths(): { readonly parent: string; readonly a: string; readonly b: string; readonly c: string; readonly d: string } {
  const parent = mkdtempSync(join(tmpdir(), 'tuple-heldout-retention-test-')); const result = { parent, a: join(parent, 'a'), b: join(parent, 'b'), c: join(parent, 'c'), d: join(parent, 'd') };
  for (const path of [result.a, result.b, result.c, result.d]) { mkdirSync(path); } return result;
}
function pin(directory: string): { readonly directory: string; readonly fingerprint: string } { return { directory, fingerprint: inventoryFingerprint(artifactInventory(directory)) }; }
test('fresh held-outs reuse only exact C inputs, keep every prior byte, and count all four roots', () => {
  const p = paths();
  try {
    writeFileSync(join(p.a, 'failure.json'), 'rejected A'); writeFileSync(join(p.b, 'failure.json'), 'rejected B');
    for (const population of [3, 9, 17, 64]) { writeFileSync(join(p.c, `input-${String(population)}.json`), JSON.stringify({ population, input: coldProvenance(population, 'a'.repeat(64)) })); }
    writeFileSync(join(p.c, 'output-3.json'), 'unaccepted partial output'); const prior = [p.a, p.b, p.c].map(artifactInventory);
    createHeldoutRetentionPlan(p.d, pin(p.a), pin(p.b), pin(p.c), author); validateHeldoutInputs(p.d);
    expect(heldoutInputPath(p.d, 3)).toBe(join(realpathSync(p.c), 'input-3.json')); expect(() => heldoutInputPath(p.d, 1)).toThrow();
    writeHeldoutArtifact(p.d, 'output-3.json', 'fresh actual output'); expect(readFileSync(join(p.c, 'output-3.json'), 'utf8')).toBe('unaccepted partial output');
    const total = heldoutRetainedInventory(p.d); expect(total.fileBytes).toBe(prior.reduce((sum, value) => sum + value.bytes, artifactInventory(p.d).bytes)); expect(total.bytes).toBe(total.fileBytes + 49152);
    expect([p.a, p.b, p.c].map(artifactInventory)).toEqual(prior); expect(() => writeHeldoutArtifact(p.d, 'output-3.json', 'overwrite')).toThrow();
    writeFileSync(join(p.c, 'input-3.json'), '{}'); expect(() => heldoutRetainedInventory(p.d)).toThrow(); expect(() => writeHeldoutArtifact(p.d, 'refused.json', 'x')).toThrow();
  } finally { rmSync(p.parent, { recursive: true, force: true }); }
});
test('four individually safe roots cannot evade the same cumulative 1 MiB cap', () => {
  const p = paths();
  try {
    for (const directory of [p.a, p.b, p.c]) { writeFileSync(join(directory, 'prior.json'), 'x'.repeat(300000)); }
    createHeldoutRetentionPlan(p.d, pin(p.a), pin(p.b), pin(p.c), author);
    expect(() => writeHeldoutArtifact(p.d, 'overflow.json', 'x'.repeat(100000))).toThrow(); expect(() => readFileSync(join(p.d, 'overflow.json'))).toThrow();
  } finally { rmSync(p.parent, { recursive: true, force: true }); }
});
test('wrong seals, aliases, symlinks and non-current inputs refuse without resetting or copying', () => {
  const p = paths();
  try {
    writeFileSync(join(p.a, 'prior.json'), 'a'); writeFileSync(join(p.b, 'prior.json'), 'b'); writeFileSync(join(p.c, 'input-3.json'), '{}');
    symlinkSync(p.c, join(p.parent, 'alias'));
    for (const bad of [{ directory: p.c, fingerprint: 'f'.repeat(64) }, pin(p.a), { directory: join(p.parent, 'alias'), fingerprint: pin(p.c).fingerprint }, pin(p.d)]) {
      expect(() => createHeldoutRetentionPlan(p.d, pin(p.a), pin(p.b), bad, author)).toThrow(); expect(artifactInventory(p.d).files).toHaveLength(0);
    }
    createHeldoutRetentionPlan(p.d, pin(p.a), pin(p.b), pin(p.c), author); expect(() => validateHeldoutInputs(p.d)).toThrow(); expect(artifactInventory(p.d).files.map((file) => file.name)).toEqual(['retention-plan.json']);
  } finally { rmSync(p.parent, { recursive: true, force: true }); }
});
