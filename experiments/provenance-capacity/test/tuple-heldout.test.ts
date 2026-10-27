/** Tests-first cross-revision evidence checks distinguish semantic authorities from host lifecycle changes. */
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, test } from '@jest/globals';
import { tupleSourceIdentities } from '../src/tuple-diagnostic.js';
import { artifactInventory } from '../src/tuple-driver.js';
import { inventoryFingerprint } from '../src/tuple-retention.js';
import { coldProvenance } from '../src/guards.js';
import { expectedColdTuple } from '../src/tuple-accounting.js';
import { createHeldoutRetentionPlan, writeHeldoutArtifact } from '../src/tuple-heldout-retention.js';
import { compareTupleLineage, prepareFreshHeldout, analyzeFreshHeldout, freshHeldoutBudget } from '../src/tuple-heldout.js';
import type { IOriginalAuthorPins } from '../src/tuple-heldout-retention.js';

const h = 'a'.repeat(64); const old = [
  { path: 'packages/value/src/value.ts', bytes: 10, sha256: h },
  { path: 'packages/value/dist/src/value.js', bytes: 11, sha256: h },
  { path: 'experiments/provenance-capacity/src/tuple-accounting.ts', bytes: 12, sha256: h },
  { path: 'experiments/provenance-capacity/src/tuple-driver.ts', bytes: 13, sha256: h },
  { path: 'packages/resolution/test/provenance-cold-worker.ts', bytes: 14, sha256: h },
];
const pins: IOriginalAuthorPins = { sourceCommit: 'b'.repeat(40), manifestSha256: h, analysisSha256: h, batchSha256: h, workerPrefixSha256: h, errorsSourceSha256: h };
const current = [...old.map((entry) => entry.path.endsWith('tuple-driver.ts') || entry.path.endsWith('provenance-cold-worker.ts') ? { ...entry, sha256: 'c'.repeat(64) } : entry), { path: 'packages/resolution/src/errors.ts', bytes: 20, sha256: h }, { path: 'packages/resolution/.test-build/src/errors.js', bytes: 21, sha256: 'd'.repeat(64) }];
test('source lineage retains exact semantic authority hashes while naming changed and added lifecycle code', () => {
  const result = compareTupleLineage(old, [...current, { path: 'experiments/provenance-capacity/src/tuple-heldout.ts', bytes: 20, sha256: h }], h, pins);
  expect(result.unchangedAuthorities).toBe(3); expect(result.changedHarness).toEqual(['experiments/provenance-capacity/src/tuple-driver.ts', 'packages/resolution/test/provenance-cold-worker.ts']); expect(result.addedHarness).toEqual(['experiments/provenance-capacity/src/tuple-heldout.ts']); expect(result.workerComputationPrefixSha256).toBe(h);
});
test('changed missing duplicate or unapproved authorities and changed worker computation refuse', () => {
  for (const changed of [current.map((item, i) => i === 0 ? { ...item, sha256: 'd'.repeat(64) } : item), current.slice(1), [...current, current[0]], [...current, { path: 'experiments/provenance-capacity/src/unknown.ts', bytes: 1, sha256: h }]]) {
    expect(() => compareTupleLineage(old, changed.filter((item) => item !== undefined), h, pins)).toThrow();
  }
  expect(() => compareTupleLineage(old, current, 'f'.repeat(64), pins)).toThrow();
});
/** A tiny fictional author record tests pin mechanics; it is not accepted real author evidence. */
test('fresh preparation writes one current manifest without copying C inputs or partial outputs', () => {
  const parent = mkdtempSync(join(tmpdir(), 'tuple-heldout-prepare-test-')); const a = join(parent, 'a'); const b = join(parent, 'b'); const c = join(parent, 'c'); const d = join(parent, 'd');
  try {
    for (const directory of [a, b, c, d]) { mkdirSync(directory); }
    writeFileSync(join(a, 'failure.json'), 'a'); writeFileSync(join(b, 'failure.json'), 'b');
    for (const population of [3, 9, 17, 64]) { writeFileSync(join(c, `input-${String(population)}.json`), JSON.stringify({ population, input: coldProvenance(population, 'a'.repeat(64)) })); }
    writeFileSync(join(c, 'output-3.json'), 'unaccepted old partial owner output');
    const identities = tupleSourceIdentities().filter((entry) => !/tuple-(?:lifecycle|heldout(?:-retention)?)\.(?:ts|js)$/u.test(entry.path) && !['packages/resolution/src/errors.ts', 'packages/resolution/.test-build/src/errors.js'].includes(entry.path));
    const manifest = JSON.stringify({ cohort: 'author', identities }); const analysis = '{}'; const batch = '{}';
    writeFileSync(join(c, 'manifest-author.json'), manifest); writeFileSync(join(c, 'analysis-author.json'), analysis); writeFileSync(join(c, 'batch-author.json'), batch);
    const hash = (text: string): string => createHash('sha256').update(text).digest('hex');
    const workerSource = readFileSync('packages/resolution/test/provenance-cold-worker.ts', 'utf8'); const prefix = workerSource.slice(0, workerSource.indexOf('/** Test-host lifecycle'));
    const author = { sourceCommit: 'b'.repeat(40), manifestSha256: hash(manifest), analysisSha256: hash(analysis), batchSha256: hash(batch), workerPrefixSha256: hash(prefix), errorsSourceSha256: hash(readFileSync('packages/resolution/src/errors.ts', 'utf8')) };
    const pin = (directory: string): { readonly directory: string; readonly fingerprint: string } => ({ directory, fingerprint: inventoryFingerprint(artifactInventory(directory)) });
    createHeldoutRetentionPlan(d, pin(a), pin(b), pin(c), author); const before = artifactInventory(c);
    prepareFreshHeldout(d);
    expect(artifactInventory(d).files.map((entry) => entry.name)).toEqual(['manifest-heldout.json', 'retention-plan.json']); expect(artifactInventory(c)).toEqual(before);
    expect(() => prepareFreshHeldout(d)).toThrow(); expect(() => analyzeFreshHeldout(d)).toThrow(/ENOENT.*output-3\.json/u);
    expect(() => readFileSync(join(d, 'analysis-heldout.json'))).toThrow();
    const prepared: unknown = JSON.parse(readFileSync(join(d, 'manifest-heldout.json'), 'utf8'));
    if (typeof prepared !== 'object' || prepared === null || !('workerSha256' in prepared) || typeof prepared.workerSha256 !== 'string' || !('codecSha256' in prepared) || typeof prepared.codecSha256 !== 'string') { throw new Error('prepared fixture identities'); }
    // Independent ordinary expected bodies are unit fixtures, not a claim that
    // a real owner worker ran. The released diagnostic must obtain fresh workers.
    for (const population of [3, 9, 17, 64]) {
      const content = expectedColdTuple(population, 'a'.repeat(64));
      writeHeldoutArtifact(d, `output-${String(population)}.json`, JSON.stringify({ population, inputSha256: hash(readFileSync(join(c, `input-${String(population)}.json`), 'utf8')), workerSha256: prepared.workerSha256, codecSha256: prepared.codecSha256, outputSha256: hash(JSON.stringify(content)), highWaterRssBytes: 1024, content }));
    }
    analyzeFreshHeldout(d);
    const measured: unknown = JSON.parse(readFileSync(join(d, 'analysis-heldout.json'), 'utf8'));
    expect(measured).toMatchObject({ cohort: 'heldout', results: [{ population: 3, utf16: 7043 }, { population: 9, utf16: 18647 }, { population: 17, utf16: 34220 }, { population: 64, utf16: 125776 }] });
    expect(artifactInventory(c)).toEqual(before);
  } finally { rmSync(parent, { recursive: true, force: true }); }
});

test('fixed fresh-heldout budget preserves metadata and the single deadline rather than resetting either', () => {
  expect(freshHeldoutBudget(100, 900000)).toEqual({ timeoutMs: 119900, outputBytes: 1048576 - 900000 - 32768 });
  for (const [elapsed, retained] of [[120000, 0], [0, 1048576], [-1, 0], [0, -1], [Number.NaN, 0]]) {
    if (elapsed === undefined || retained === undefined) { throw new Error('budget fixture'); }
    expect(() => freshHeldoutBudget(elapsed, retained)).toThrow();
  }
});
test('fresh held-out CLI requires all three sealed priors before creating any plan', () => {
  const directory = mkdtempSync(join(tmpdir(), 'tuple-heldout-cli-test-'));
  try {
    expect(() => execFileSync(process.execPath, [fileURLToPath(new URL('../src/tuple-heldout.js', import.meta.url)), directory, 'a', 'f'.repeat(64), 'b', 'f'.repeat(64)], { timeout: 2000, maxBuffer: 4096, stdio: 'pipe' })).toThrow();
    expect(artifactInventory(directory).files).toHaveLength(0);
  } finally { rmSync(directory, { recursive: true, force: true }); }
});

test('current D graph pins the pre-existing error dependency while preserving the old emitted-pin gap', () => {
  const graph = tupleSourceIdentities();
  expect(graph.some((entry) => entry.path === 'packages/resolution/src/errors.ts')).toBe(true);
  expect(graph.some((entry) => entry.path === 'packages/resolution/.test-build/src/errors.js')).toBe(true);
  const lineage = compareTupleLineage(old, current, h, pins);
  expect(lineage).toMatchObject({ newlyPinnedDependencies: ['packages/resolution/src/errors.ts', 'packages/resolution/.test-build/src/errors.js'], originalDependencyEmitPinned: false });
  expect(() => compareTupleLineage(old, current.map((entry) => entry.path === 'packages/resolution/src/errors.ts' ? { ...entry, sha256: 'f'.repeat(64) } : entry), h, pins)).toThrow();
  expect(() => compareTupleLineage(old, current.filter((entry) => entry.path !== 'packages/resolution/.test-build/src/errors.js'), h, pins)).toThrow();
});
