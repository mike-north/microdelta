/** Tests-first two-root immutability, exact input reuse and global output accounting. */
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, test } from '@jest/globals';
import { coldProvenance } from '../src/guards.js';
import { artifactInventory } from '../src/tuple-driver.js';
import { createRetentionPlan, inventoryFingerprint, retainedInputPath, retainedInventory, validateRetainedInputs, writeRetainedArtifact } from '../src/tuple-retention.js';

/** Isolated temporary directories model old/new evidence without touching the real failed root. */
function directories(): { readonly parent: string; readonly frozen: string; readonly fresh: string } {
  const parent = mkdtempSync(join(tmpdir(), 'tuple-retention-test-')); const frozen = join(parent, 'old'); const fresh = join(parent, 'new');
  mkdirSync(frozen); mkdirSync(fresh); return { parent, frozen, fresh };
}
test('sealed six inputs are reused read-only only after exact current corpus validation', () => {
  const paths = directories();
  try {
    for (const population of [1, 2, 8, 12, 32, 100]) { writeFileSync(join(paths.frozen, `input-${String(population)}.json`), JSON.stringify({ population, input: coldProvenance(population, 'a'.repeat(64)) })); }
    writeFileSync(join(paths.frozen, 'output-1.json'), 'unaccepted old output');
    const before = artifactInventory(paths.frozen);
    createRetentionPlan(paths.fresh, paths.frozen, inventoryFingerprint(before), 49152);
    validateRetainedInputs(paths.fresh);
    expect(retainedInputPath(paths.fresh, 'author', 1)).toBe(join(realpathSync(paths.frozen), 'input-1.json'));
    expect(retainedInputPath(paths.fresh, 'heldout', 3)).toBe(join(paths.fresh, 'input-3.json'));
    expect(() => retainedInputPath(paths.fresh, 'author', 3)).toThrow();
    expect(() => retainedInputPath(paths.fresh, 'heldout', 150000)).toThrow();
    writeRetainedArtifact(paths.fresh, 'output-1.json', 'fresh independent output');
    expect(readFileSync(join(paths.frozen, 'output-1.json'), 'utf8')).toBe('unaccepted old output');
    expect(artifactInventory(paths.frozen)).toEqual(before);
    const total = retainedInventory(paths.fresh);
    expect(total.bytes).toBe(total.fileBytes + 49152); expect(total.fileBytes).toBe(before.bytes + artifactInventory(paths.fresh).bytes);
  } finally { rmSync(paths.parent, { recursive: true, force: true }); }
});
test('two individual-safe roots cannot evade the shared cap or mutate sealed evidence', () => {
  const paths = directories();
  try {
    writeFileSync(join(paths.frozen, 'old.json'), 'a'.repeat(600000));
    createRetentionPlan(paths.fresh, paths.frozen, inventoryFingerprint(artifactInventory(paths.frozen)), 49152);
    expect(() => writeRetainedArtifact(paths.fresh, 'new.json', 'b'.repeat(450000))).toThrow();
    expect(() => readFileSync(join(paths.fresh, 'new.json'))).toThrow();
    writeFileSync(join(paths.frozen, 'old.json'), 'changed');
    expect(() => retainedInventory(paths.fresh)).toThrow();
  } finally { rmSync(paths.parent, { recursive: true, force: true }); }
});
test('wrong fingerprints, aliased/symlink roots and mismatched cold input refuse before use', () => {
  const paths = directories();
  try {
    writeFileSync(join(paths.frozen, 'input-1.json'), '{}');
    const fingerprint = inventoryFingerprint(artifactInventory(paths.frozen));
    expect(() => createRetentionPlan(paths.fresh, paths.frozen, 'f'.repeat(64), 49152)).toThrow();
    expect(() => createRetentionPlan(paths.frozen, paths.frozen, fingerprint, 49152)).toThrow();
    symlinkSync(paths.frozen, join(paths.parent, 'alias'));
    expect(() => createRetentionPlan(paths.fresh, join(paths.parent, 'alias'), fingerprint, 49152)).toThrow();
    createRetentionPlan(paths.fresh, paths.frozen, fingerprint, 49152);
    expect(() => validateRetainedInputs(paths.fresh)).toThrow();
    expect(artifactInventory(paths.frozen).files).toHaveLength(1);
  } finally { rmSync(paths.parent, { recursive: true, force: true }); }
});

/** Both rejected attempts remain charged and sealed; only the original supplies inputs. */
test('three-root plan seals both failures and charges their combined bytes before every write', () => {
  const paths = directories(); const second = join(paths.parent, 'second'); mkdirSync(second);
  try {
    writeFileSync(join(paths.frozen, 'old.json'), 'a'.repeat(300000));
    writeFileSync(join(second, 'failure.json'), 'b'.repeat(300000));
    const beforeA = artifactInventory(paths.frozen); const beforeB = artifactInventory(second);
    createRetentionPlan(paths.fresh, paths.frozen, inventoryFingerprint(beforeA), 49152, { directory: second, fingerprint: inventoryFingerprint(beforeB) });
    const total = retainedInventory(paths.fresh);
    expect(total.fileBytes).toBe(beforeA.bytes + beforeB.bytes + artifactInventory(paths.fresh).bytes);
    expect(retainedInputPath(paths.fresh, 'author', 1)).toBe(join(realpathSync(paths.frozen), 'input-1.json'));
    expect(() => writeRetainedArtifact(paths.fresh, 'new.json', 'x'.repeat(450000))).toThrow();
    writeRetainedArtifact(paths.fresh, 'new.json', 'fresh');
    expect(() => writeRetainedArtifact(paths.fresh, 'new.json', 'overwrite')).toThrow();
    expect(artifactInventory(paths.frozen)).toEqual(beforeA); expect(artifactInventory(second)).toEqual(beforeB);
    writeFileSync(join(second, 'failure.json'), 'tampered');
    expect(() => retainedInventory(paths.fresh)).toThrow();
    expect(() => writeRetainedArtifact(paths.fresh, 'refused.json', 'x')).toThrow();
  } finally { rmSync(paths.parent, { recursive: true, force: true }); }
});
test('second failure cannot alias either root, use a symlink, or evade its fingerprint', () => {
  const paths = directories(); const second = join(paths.parent, 'second'); mkdirSync(second);
  try {
    writeFileSync(join(paths.frozen, 'old.json'), 'a'); writeFileSync(join(second, 'failure.json'), 'b');
    const a = inventoryFingerprint(artifactInventory(paths.frozen)); const b = inventoryFingerprint(artifactInventory(second));
    symlinkSync(second, join(paths.parent, 'alias-second'));
    for (const invalid of [{ directory: paths.frozen, fingerprint: a }, { directory: paths.fresh, fingerprint: inventoryFingerprint(artifactInventory(paths.fresh)) }, { directory: join(paths.parent, 'alias-second'), fingerprint: b }, { directory: second, fingerprint: 'f'.repeat(64) }]) {
      expect(() => createRetentionPlan(paths.fresh, paths.frozen, a, 49152, invalid)).toThrow();
      expect(artifactInventory(paths.fresh).files).toHaveLength(0);
    }
  } finally { rmSync(paths.parent, { recursive: true, force: true }); }
});
