/** Fixed assembly prepare/analyze child for the capped actual-output tuple experiment. @packageDocumentation */
import { constants as bufferConstants } from 'node:buffer';
import { createHash } from 'node:crypto';
import { lstatSync, readFileSync, readdirSync, realpathSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { consumeColdWorker } from './cold-bridge.js';
import { coldProvenance } from './guards.js';
import { tupleCapacity, tupleLedger } from './tuple-accounting.js';
import { artifactInventory } from './tuple-driver.js';
import { readRetentionPlan, retainedInputPath, retainedInventory, validateRetainedInputs, writeRetainedArtifact } from './tuple-retention.js';
import type { IRetentionPlan } from './tuple-retention.js';

/** Source-tree location is selected by this emitted assembly experiment. */
const root = fileURLToPath(new URL('../../../../', import.meta.url));
/** This mathematical fixture is independent of a private captured implementation. */
const implementationDigest = 'a'.repeat(64);

/** @internal Cohorts share one retained-output allowance; held-outs never reset the inventory. */
export type ICohort = 'author' | 'heldout';
/** @internal Full shapes remain tiny; reviewers receive different complete sizes. */
export function cohortPopulations(cohort: ICohort): readonly number[] { return cohort === 'author' ? [1, 2, 8, 12, 32, 100] : [3, 9, 17, 64]; }
/** Hashing exact files binds source, emitted implementation, generated Value and inputs. */
function digest(data: string | Buffer): string { return createHash('sha256').update(data).digest('hex'); }
/** One immutable identity entry; source contents are never copied into diagnostic output. */
interface IFileIdentity { readonly path: string; readonly bytes: number; readonly sha256: string }
/** Record all relevant source/generated files instead of relying on an entrypoint hash alone. */
function sourceIdentities(): readonly IFileIdentity[] {
  const result: IFileIdentity[] = [];
  const visit = (relative: string): void => {
    const path = join(root, relative); const stat = lstatSync(path);
    if (stat.isSymbolicLink()) { throw new Error('diagnostic source symlink'); }
    if (stat.isDirectory()) { for (const name of readdirSync(path).sort()) { visit(`${relative}/${name}`); } }
    else if (stat.isFile()) { result.push({ path: relative, bytes: stat.size, sha256: digest(readFileSync(path)) }); }
    else { throw new Error('diagnostic source surface'); }
  };
  for (const path of ['packages/value/src', 'packages/value/dist', 'packages/resolution/src/provenance-wire.ts', 'packages/resolution/test/provenance-cold-channel.ts', 'packages/resolution/test/provenance-cold-worker.ts', 'packages/resolution/.test-build/src/provenance-wire.js', 'packages/resolution/.test-build/test/provenance-cold-channel.js', 'packages/resolution/.test-build/test/provenance-cold-worker.js', 'experiments/provenance-capacity/src', '.test-build/experiments/provenance-capacity/src']) { visit(path); }
  return result;
}
/** Expected manifest is reconstructed from bounded independent input and current real files. */
function expectedManifest(directory: string, cohort: ICohort): { readonly cohort: ICohort; readonly retention: IRetentionPlan; readonly implementationDigest: string; readonly runtime: { readonly node: string; readonly v8: string; readonly executable: string; readonly maximumStringLength: number; readonly valueEntry: string }; readonly identities: readonly IFileIdentity[]; readonly workerSha256: string; readonly codecSha256: string; readonly inputs: readonly { readonly population: number; readonly inputSha256: string }[] } {
  return { cohort, retention: readRetentionPlan(directory), implementationDigest, runtime: { node: process.version, v8: process.versions.v8, executable: process.execPath, maximumStringLength: bufferConstants.MAX_STRING_LENGTH, valueEntry: realpathSync(fileURLToPath(import.meta.resolve('@microdelta/value'))) }, identities: sourceIdentities(),
    workerSha256: digest(readFileSync(join(root, 'packages/resolution/.test-build/test/provenance-cold-worker.js'))), codecSha256: digest(readFileSync(join(root, 'packages/resolution/.test-build/src/provenance-wire.js'))),
    inputs: cohortPopulations(cohort).map((population) => ({ population, inputSha256: digest(inputText(population)) })) };
}
/** No complete shape exceeds the fixed N100 independent cold corpus. */
function inputText(population: number): string { return JSON.stringify({ population, input: coldProvenance(population, implementationDigest) }); }
/** @internal Read only a manifest exactly matching current source/runtime and bounded inputs. */
export function preparedTupleManifest(directory: string, cohort: ICohort): ReturnType<typeof expectedManifest> {
  retainedInventory(directory); validateRetainedInputs(directory);
  const expected = expectedManifest(directory, cohort);
  if (readFileSync(join(directory, `manifest-${cohort}.json`), 'utf8') !== JSON.stringify(expected)) { throw new Error('diagnostic prepared source/runtime/fixture identity changed'); }
  for (const input of expected.inputs) {
    if (digest(readFileSync(retainedInputPath(directory, cohort, input.population))) !== input.inputSha256) { throw new Error('diagnostic prepared input changed'); }
  }
  return expected;
}
/** @internal Prepare only the fixed tiny corpus and exact generated/source identities. */
export function prepareTupleInputs(directory: string, cohort: ICohort): void {
  const inventory = artifactInventory(directory);
  retainedInventory(directory); validateRetainedInputs(directory);
  if (cohort === 'author' ? inventory.files.length !== 1 || inventory.files[0]?.name !== 'retention-plan.json' : !inventory.files.some((file) => file.name === 'analysis-author.json')) { throw new Error('diagnostic cohort sequence'); }
  if (cohort === 'heldout') { preparedTupleManifest(directory, 'author'); }
  const manifest = expectedManifest(directory, cohort);
  // Author inputs are reused read-only after sealed-hash AND current corpus
  // validation. No previous output/receipt participates in this fresh attempt.
  if (cohort === 'heldout') { for (const population of cohortPopulations(cohort)) { writeRetainedArtifact(directory, `input-${String(population)}.json`, inputText(population)); } }
  writeRetainedArtifact(directory, `manifest-${cohort}.json`, JSON.stringify(manifest));
}
/** @internal Analyze actual owner artifacts, never a reconstructed substitute. */
export function analyzeTupleOutputs(directory: string, cohort: ICohort): void {
  const manifest = preparedTupleManifest(directory, cohort);
  const results = manifest.inputs.map((input) => consumeColdWorker(readFileSync(join(directory, `output-${String(input.population)}.json`), 'utf8'), { ...input, workerSha256: manifest.workerSha256, codecSha256: manifest.codecSha256, implementationDigest }));
  const highWaterRssBytes = process.resourceUsage().maxRSS * 1024;
  if (highWaterRssBytes > 2147483648) { throw new Error('diagnostic analysis high-water bound'); }
  // All candidate full-size results below are arithmetic only, after every tiny
  // actual-output comparison. No target population/tree/canonical text is built.
  const result = { cohort, runtime: manifest.runtime, results, ledger: tupleLedger(), targetPopulation: 150000, capacity: tupleCapacity(150000, manifest.runtime.maximumStringLength), highWaterRssBytes, currentInventory: retainedInventory(directory), limits: { totalRetainedBytes: 1048576, maximumPopulation: 100, perCanonicalBytes: 1048576, timeoutMs: 120000, sampledRssBytes: 2147483648, trueTransientPeakAvailable: false } };
  writeRetainedArtifact(directory, `analysis-${cohort}.json`, JSON.stringify(result));
}
/** Fixed child command modes never expose arbitrary scripts or population sizes. */
function main(): void {
  const [mode, directory, cohort] = process.argv.slice(2);
  if (process.argv.length !== 5 || directory === undefined || (cohort !== 'author' && cohort !== 'heldout')) { throw new Error('diagnostic child arguments'); }
  if (mode === 'prepare') { prepareTupleInputs(directory, cohort); }
  else if (mode === 'analyze') { analyzeTupleOutputs(directory, cohort); }
  else { throw new Error('diagnostic child mode'); }
}
if (process.argv[1] !== undefined && pathToFileURL(process.argv[1]).href === import.meta.url) { main(); }
