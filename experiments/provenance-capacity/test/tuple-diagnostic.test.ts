/** Tests-first preparation refuses missing/substituted actual outputs and keeps cohorts bounded. */
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, test } from '@jest/globals';
import { analyzeTupleOutputs, prepareTupleInputs } from '../src/tuple-diagnostic.js';
import { artifactInventory } from '../src/tuple-driver.js';
import { coldProvenance } from '../src/guards.js';
import { createRetentionPlan, inventoryFingerprint } from '../src/tuple-retention.js';

test('preparation pins the six fixed tiny inputs; analysis requires actual worker artifacts', () => {
  const parent = mkdtempSync(join(tmpdir(), 'tuple-prepare-test-')); const directory = join(parent, 'fresh'); const frozen = join(parent, 'old');
  try {
    mkdirSync(directory); mkdirSync(frozen);
    for (const population of [1, 2, 8, 12, 32, 100]) { writeFileSync(join(frozen, `input-${String(population)}.json`), JSON.stringify({ population, input: coldProvenance(population, 'a'.repeat(64)) })); }
    writeFileSync(join(frozen, 'output-1.json'), 'old output is not new candidate evidence');
    const old = artifactInventory(frozen);
    createRetentionPlan(directory, frozen, inventoryFingerprint(old), 49152);
    prepareTupleInputs(directory, 'author');
    const inventory = artifactInventory(directory);
    expect(inventory.files.map((file) => file.name)).toEqual(['manifest-author.json', 'retention-plan.json']);
    expect(artifactInventory(frozen)).toEqual(old);
    expect(inventory.bytes).toBeLessThan(400000);
    expect(() => analyzeTupleOutputs(directory, 'author')).toThrow();
    expect(() => readFileSync(join(directory, 'analysis-author.json'))).toThrow();
    expect(() => prepareTupleInputs(directory, 'author')).toThrow();
    expect(() => prepareTupleInputs(directory, 'heldout')).toThrow();
  } finally { rmSync(parent, { recursive: true, force: true }); }
});
