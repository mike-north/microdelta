/** Fresh held-out composition preserves the original author proof while pinning a revised diagnostic lifecycle. @packageDocumentation */
import { constants as bufferConstants } from 'node:buffer';
import { createHash } from 'node:crypto';
import { readFileSync, realpathSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { consumeColdWorker } from './cold-bridge.js';
import { tupleCapacity, tupleLedger } from './tuple-accounting.js';
import { runTupleChild } from './tuple-driver.js';
import type { IDiagnosticReceipt, ITupleTask } from './tuple-driver.js';
import { waitForParentRelease } from './tuple-lifecycle.js';
import { tupleSourceIdentities } from './tuple-diagnostic.js';
import { createHeldoutRetentionPlan, heldoutInputPath, heldoutRetainedInventory, readHeldoutRetentionPlan, validateHeldoutInputs, writeHeldoutArtifact } from './tuple-heldout-retention.js';
import type { IFileIdentity } from './tuple-diagnostic.js';
import type { IOriginalAuthorPins } from './tuple-heldout-retention.js';
/** @internal Unchanged semantic authorities and changed host harness remain explicitly separate. */
export interface ITupleLineage { readonly unchangedAuthorities: number; readonly unchangedAuthoritiesSha256: string; readonly changedHarness: readonly string[]; readonly addedHarness: readonly string[]; readonly workerComputationPrefixSha256: string; readonly newlyPinnedDependencies: readonly string[]; readonly originalDependencyEmitPinned: false }
/** Named implementation root, never a caller-selected module or private Resolution import. */
const root = fileURLToPath(new URL('../../../../', import.meta.url));
/** Cold shape identity is independent of any captured implementation. */
const implementationDigest = 'a'.repeat(64);
/** Host-harness changes cannot authorize semantic changes to Value, codec, channel or accounting. */
function changedHarness(path: string): boolean {
  return /^(?:experiments\/provenance-capacity\/src\/tuple-(?:control|diagnostic|driver|launcher|retention|rss)\.ts|\.test-build\/experiments\/provenance-capacity\/src\/tuple-(?:control|diagnostic|driver|launcher|retention|rss)\.js|packages\/resolution\/(?:test\/provenance-cold-worker\.ts|\.test-build\/test\/provenance-cold-worker\.js))$/u.test(path);
}
/** Only this fixed composition, retention and lifecycle helper may extend the source manifest. */
function addedHarness(path: string): boolean { return /^(?:experiments\/provenance-capacity\/src\/tuple-(?:lifecycle|heldout|heldout-retention)\.ts|\.test-build\/experiments\/provenance-capacity\/src\/tuple-(?:lifecycle|heldout|heldout-retention)\.js)$/u.test(path); }
/** Parsed identity records cannot omit or duplicate a semantic authority. */
function identities(value: unknown): readonly IFileIdentity[] {
  if (!Array.isArray(value) || value.length > 52) { throw new Error('heldout source identity bound'); }
  const result: IFileIdentity[] = [];
  for (const raw of value) {
    const item: unknown = raw;
    if (typeof item !== 'object' || item === null || Array.isArray(item) || Object.keys(item).join(',') !== 'path,bytes,sha256' || !('path' in item) || typeof item.path !== 'string' || item.path.startsWith('/') || item.path.split('/').includes('..') || !('bytes' in item) || typeof item.bytes !== 'number' || !Number.isSafeInteger(item.bytes) || item.bytes < 0 || !('sha256' in item) || typeof item.sha256 !== 'string' || !/^[a-f0-9]{64}$/u.test(item.sha256)) { throw new Error('heldout source identity shape'); }
    result.push({ path: item.path, bytes: item.bytes, sha256: item.sha256 });
  }
  if (new Set(result.map((item) => item.path)).size !== result.length) { throw new Error('heldout duplicate source identity'); }
  return result;
}
/** Exact bytes, not a declared source version, bind both historical and current records. */
function hash(text: string | Buffer): string { return createHash('sha256').update(text).digest('hex'); }
/** @internal Compare every original semantic authority without treating old harness hashes as current. */
export function compareTupleLineage(previous: unknown, current: readonly IFileIdentity[], workerPrefixSha256: string, original: IOriginalAuthorPins): ITupleLineage {
  const old = identities(previous); const next = identities(current); const unchanged: IFileIdentity[] = []; const changed: string[] = [];
  if (!/^[a-f0-9]{64}$/u.test(workerPrefixSha256) || workerPrefixSha256 !== original.workerPrefixSha256) { throw new Error('heldout owner computation changed'); }
  for (const item of old) {
    const match = next.find((entry) => entry.path === item.path);
    if (match === undefined) { throw new Error('heldout original authority missing'); }
    if (changedHarness(item.path)) { if (item.bytes !== match.bytes || item.sha256 !== match.sha256) { changed.push(item.path); } }
    else {
      if (item.bytes !== match.bytes || item.sha256 !== match.sha256) { throw new Error('heldout semantic authority changed'); }
      unchanged.push(item);
    }
  }
  // The original manifest omitted this pre-existing dependency. Source is
  // checked against the original commit's separate source pin; only the current
  // runtime is pinned here. No historical emitted hash is invented.
  const newlyPinnedDependencies = ['packages/resolution/src/errors.ts', 'packages/resolution/.test-build/src/errors.js'];
  if (old.some((item) => newlyPinnedDependencies.includes(item.path)) || newlyPinnedDependencies.some((path) => !next.some((item) => item.path === path)) || next.find((item) => item.path === newlyPinnedDependencies[0])?.sha256 !== original.errorsSourceSha256) { throw new Error('heldout pre-existing semantic dependency changed or missing'); }
  const extra = next.filter((item) => !old.some((entry) => entry.path === item.path)).map((item) => item.path);
  if (extra.some((path) => !addedHarness(path) && !newlyPinnedDependencies.includes(path))) { throw new Error('heldout unapproved source extension'); }
  const added = extra.filter(addedHarness);
  return { unchangedAuthorities: unchanged.length, unchangedAuthoritiesSha256: hash(JSON.stringify(unchanged)), changedHarness: changed, addedHarness: added, workerComputationPrefixSha256: workerPrefixSha256, newlyPinnedDependencies, originalDependencyEmitPinned: false };
}
/** Reconstruct current pins while retaining exact source attribution for the original author evidence. */
function expectedFreshManifest(directory: string): { readonly cohort: 'heldout'; readonly retention: ReturnType<typeof readHeldoutRetentionPlan>; readonly implementationDigest: string; readonly runtime: { readonly node: string; readonly v8: string; readonly executable: string; readonly maximumStringLength: number; readonly valueEntry: string }; readonly identities: readonly IFileIdentity[]; readonly codeLineage: ITupleLineage; readonly workerSha256: string; readonly codecSha256: string; readonly inputs: readonly { readonly population: number; readonly inputSha256: string }[] } {
  heldoutRetainedInventory(directory); validateHeldoutInputs(directory); const plan = readHeldoutRetentionPlan(directory);
  for (const [name, expected] of [['manifest-author.json', plan.originalAuthor.manifestSha256], ['analysis-author.json', plan.originalAuthor.analysisSha256], ['batch-author.json', plan.originalAuthor.batchSha256]]) {
    if (name === undefined || expected === undefined || hash(readFileSync(join(plan.prior.directory, name))) !== expected) { throw new Error('heldout original author receipt changed'); }
  }
  const original: unknown = JSON.parse(readFileSync(join(plan.prior.directory, 'manifest-author.json'), 'utf8'));
  if (typeof original !== 'object' || original === null || !('cohort' in original) || original.cohort !== 'author' || !('identities' in original)) { throw new Error('heldout original author manifest'); }
  const current = tupleSourceIdentities(); const worker = readFileSync(join(root, 'packages/resolution/test/provenance-cold-worker.ts'), 'utf8'); const boundary = worker.indexOf('/** Test-host lifecycle');
  if (boundary < 0 || worker.lastIndexOf('/** Test-host lifecycle') !== boundary) { throw new Error('heldout owner lifecycle boundary'); }
  const codeLineage = compareTupleLineage(original.identities, current, hash(worker.slice(0, boundary)), plan.originalAuthor);
  return { cohort: 'heldout', retention: plan, implementationDigest,
    runtime: { node: process.version, v8: process.versions.v8, executable: process.execPath, maximumStringLength: bufferConstants.MAX_STRING_LENGTH, valueEntry: realpathSync(fileURLToPath(import.meta.resolve('@microdelta/value'))) },
    identities: current, codeLineage,
    workerSha256: hash(readFileSync(join(root, 'packages/resolution/.test-build/test/provenance-cold-worker.js'))), codecSha256: hash(readFileSync(join(root, 'packages/resolution/.test-build/src/provenance-wire.js'))),
    inputs: [3, 9, 17, 64].map((population) => ({ population, inputSha256: hash(readFileSync(heldoutInputPath(directory, population))) })) };
}
/** @internal No source/runtime/lineage or input mutation can hide behind an existing manifest. */
export function preparedFreshHeldoutManifest(directory: string): ReturnType<typeof expectedFreshManifest> {
  const expected = expectedFreshManifest(directory);
  if (readFileSync(join(directory, 'manifest-heldout.json'), 'utf8') !== JSON.stringify(expected)) { throw new Error('heldout current prepared identity changed'); }
  return expected;
}
/** @internal Fresh held-out metadata cannot reuse partial owner artifacts from the original root. */
export function prepareFreshHeldout(directory: string): void {
  const inventory = heldoutRetainedInventory(directory);
  if (inventory.fresh.files.length !== 1 || inventory.fresh.files[0]?.name !== 'retention-plan.json') { throw new Error('heldout fresh preparation sequence'); }
  writeHeldoutArtifact(directory, 'manifest-heldout.json', JSON.stringify(expectedFreshManifest(directory)));
}
/** @internal Analyze only all four fresh owner outputs through the existing bridge and accounting. */
export function analyzeFreshHeldout(directory: string): void {
  const manifest = preparedFreshHeldoutManifest(directory);
  const results = manifest.inputs.map((input) => consumeColdWorker(readFileSync(join(directory, `output-${String(input.population)}.json`), 'utf8'), { ...input, workerSha256: manifest.workerSha256, codecSha256: manifest.codecSha256, implementationDigest }));
  const highWaterRssBytes = process.resourceUsage().maxRSS * 1024;
  if (highWaterRssBytes > 2147483648) { throw new Error('heldout analysis high-water bound'); }
  writeHeldoutArtifact(directory, 'analysis-heldout.json', JSON.stringify({ cohort: 'heldout', originalAuthor: manifest.retention.originalAuthor, runtime: manifest.runtime, results, ledger: tupleLedger(), targetPopulation: 150000, capacity: tupleCapacity(150000, manifest.runtime.maximumStringLength), highWaterRssBytes, currentInventory: heldoutRetainedInventory(directory), limits: { totalRetainedBytes: 1048576, maximumPopulation: 100, perCanonicalBytes: 1048576, timeoutMs: 120000, sampledRssBytes: 2147483648, trueTransientPeakAvailable: false } }));
}

/** @internal One deadline and a final metadata reserve remain across all four fresh workers. */
export function freshHeldoutBudget(elapsedMs: number, retainedBytes: number): { readonly timeoutMs: number; readonly outputBytes: number } {
  if (!Number.isFinite(elapsedMs) || elapsedMs < 0 || elapsedMs >= 120000 || !Number.isSafeInteger(retainedBytes) || retainedBytes < 0) { throw new Error('heldout fixed time or retained bound'); }
  const timeoutMs = Math.floor(120000 - elapsedMs); const outputBytes = 1048576 - retainedBytes - 32768;
  if (timeoutMs < 1 || outputBytes < 1) { throw new Error('heldout metadata reservation exhausted'); }
  return { timeoutMs, outputBytes };
}

/** The original author lineage is a retained source/value proof with an explicit historical runtime-pin gap. */
const originalAuthor: IOriginalAuthorPins = {
  sourceCommit: '7b1accbc4fb0797e4226ff990b538e8a4c8d71c8',
  manifestSha256: '7c7b5ffae165c6d249b7e3a8b9c2c4d2732e38f56bcbc264687433c036d79255',
  analysisSha256: '9cf8bfda4d7b4ab21187f11352d12087423247f3cf9e5f4e72eff283d6d9f066',
  batchSha256: 'cb9746d0037dc80a8b1b414d1f0949fe45ed960a535620a8938a5a903454e282',
  workerPrefixSha256: '7f9237beecfe47b76e6c9d0945c1e5e03038ed5b55a64a4e4ad25258d2de6552',
  errorsSourceSha256: '4f2850418b7f5cfc4b413855b145a1add0abb41f437ce41f6433f0a5f1ca8b2e',
};
/** @internal A single fresh cohort never resumes partial output or runs an original-author replay. */
export async function runFreshHeldout(directory: string): Promise<void> {
  const start = performance.now(); const before = heldoutRetainedInventory(directory);
  const receipts: { readonly phase: string; readonly process: IDiagnosticReceipt }[] = [];
  const invoke = async (phase: string, task: ITupleTask): Promise<void> => {
    const budget = freshHeldoutBudget(performance.now() - start, heldoutRetainedInventory(directory).bytes);
    if (process.memoryUsage().rss > 2147483648) { throw new Error('heldout parent RSS bound'); }
    const processReceipt = await runTupleChild(task, { timeoutMs: budget.timeoutMs, rssBytes: 2147483648 }); receipts.push({ phase, process: processReceipt });
    if (processReceipt.outcome !== 'completed') { throw new Error(`heldout stopped: ${phase}/${processReceipt.outcome}`); }
  };
  try {
    await invoke('prepare', { kind: 'prepare-heldout', directory }); const manifest = preparedFreshHeldoutManifest(directory);
    for (const input of manifest.inputs) {
      const budget = freshHeldoutBudget(performance.now() - start, heldoutRetainedInventory(directory).bytes);
      await invoke(`owner-${String(input.population)}`, { kind: 'owner', input: heldoutInputPath(directory, input.population), output: join(directory, `output-${String(input.population)}.json`), ...input, workerSha256: manifest.workerSha256, codecSha256: manifest.codecSha256, outputBudget: budget.outputBytes, heldoutRetention: readHeldoutRetentionPlan(directory) });
      heldoutRetainedInventory(directory);
    }
    await invoke('analyze', { kind: 'analyze-heldout', directory }); preparedFreshHeldoutManifest(directory);
    const after = heldoutRetainedInventory(directory);
    if (JSON.stringify(before.frozen) !== JSON.stringify(after.frozen) || before.fresh.files.some((old) => !after.fresh.files.some((next) => old.name === next.name && old.bytes === next.bytes && old.sha256 === next.sha256))) { throw new Error('heldout preserved evidence changed'); }
    const highWaterRssBytes = process.resourceUsage().maxRSS * 1024;
    if (highWaterRssBytes > 2147483648 || performance.now() - start >= 120000) { throw new Error('heldout parent final bound'); }
    writeHeldoutArtifact(directory, 'batch-heldout.json', JSON.stringify({ cohort: 'heldout', receipts, elapsedMs: performance.now() - start, parentHighWaterRssBytes: highWaterRssBytes, inventoryBeforeReceipt: after, preparedManifestSha256: hash(readFileSync(join(directory, 'manifest-heldout.json'))), sampling: { intervalMs: 25, childOnly: true, highWaterSeparate: true, transientPeakAvailable: false, terminationOnlyAfterFinalRssDispatch: true } }));
    writeHeldoutArtifact(directory, 'launcher-status-heldout.json', JSON.stringify({ cohort: 'heldout', retainedBytesBeforeStatus: heldoutRetainedInventory(directory).bytes }));
  } catch (error) {
    // Failure evidence is fresh and append-only. No retry, partial continuation,
    // old output credit or overwrite follows a stopped child.
    const message = error instanceof Error ? error.message : String(error);
    writeHeldoutArtifact(directory, 'batch-heldout-failure.json', JSON.stringify({ cohort: 'heldout', receipts, message: message.slice(0, 1024), messageTruncated: message.length > 1024, elapsedMs: performance.now() - start }));
    throw error;
  }
}
/** Only the exact three sealed priors can establish a fresh held-out parent invocation. */
async function parentMain(): Promise<void> {
  const [directory, first, firstHash, second, secondHash, prior, priorHash] = process.argv.slice(2);
  if (process.argv.length !== 9 || directory === undefined || first === undefined || firstHash === undefined || second === undefined || secondHash === undefined || prior === undefined || priorHash === undefined) { throw new Error('heldout fixed launcher arguments'); }
  createHeldoutRetentionPlan(directory, { directory: first, fingerprint: firstHash }, { directory: second, fingerprint: secondHash }, { directory: prior, fingerprint: priorHash }, originalAuthor);
  await runFreshHeldout(directory);
}
/** Child modes finish all work before entering the synchronous-release exit protocol. */
function childMain(): void {
  const [mode, directory] = process.argv.slice(2);
  if (process.argv.length !== 4 || directory === undefined) { throw new Error('heldout fixed child arguments'); }
  if (mode === 'prepare-heldout') { prepareFreshHeldout(directory); }
  else if (mode === 'analyze-heldout') { analyzeFreshHeldout(directory); }
  else { throw new Error('heldout fixed child mode'); }
  waitForParentRelease();
}
if (process.argv[1] !== undefined && pathToFileURL(process.argv[1]).href === import.meta.url) {
  if (process.argv[2] === 'prepare-heldout' || process.argv[2] === 'analyze-heldout') { childMain(); }
  else { await parentMain(); }
}
