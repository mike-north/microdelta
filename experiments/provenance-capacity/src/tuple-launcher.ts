/** Fixed sequential cold-tuple cohorts share one deadline and retained-output allowance. @packageDocumentation */
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { preparedTupleManifest } from './tuple-diagnostic.js';
import type { ICohort } from './tuple-diagnostic.js';
import { runTupleChild } from './tuple-driver.js';
import type { IDiagnosticReceipt, ITupleTask } from './tuple-driver.js';
import { createRetentionPlan, readRetentionPlan, retainedInputPath, retainedInventory, writeRetainedArtifact } from './tuple-retention.js';

/** @internal Remaining worker allowance reserves analysis/receipts and later held-outs. */
export function cohortBudget(elapsedMs: number, retainedBytes: number, cohort: ICohort): { readonly timeoutMs: number; readonly outputBytes: number } {
  if (!Number.isFinite(elapsedMs) || elapsedMs < 0 || elapsedMs >= 120000 || !Number.isSafeInteger(retainedBytes) || retainedBytes < 0) { throw new Error('diagnostic cohort time/artifact bound'); }
  const timeoutMs = Math.floor(120000 - elapsedMs);
  const outputBytes = 1048576 - retainedBytes - (cohort === 'author' ? 393216 : 32768);
  if (timeoutMs < 1 || outputBytes < 1) { throw new Error('diagnostic reservation exhausted'); }
  return { timeoutMs, outputBytes };
}
/** @internal Execute one named cohort; every child closes before the next is started. */
export async function runTupleCohort(directory: string, cohort: ICohort): Promise<void> {
  const start = performance.now(); const before = retainedInventory(directory);
  const receipts: { readonly phase: string; readonly process: IDiagnosticReceipt }[] = [];
  const invoke = async (phase: string, task: ITupleTask): Promise<void> => {
    const budget = cohortBudget(performance.now() - start, retainedInventory(directory).bytes, cohort);
    if (process.memoryUsage().rss > 2147483648) { throw new Error('diagnostic parent RSS boundary'); }
    const result = await runTupleChild(task, { timeoutMs: budget.timeoutMs, rssBytes: 2147483648 });
    receipts.push({ phase, process: result });
    if (result.outcome !== 'completed') { throw new Error(`diagnostic phase stopped: ${phase}/${result.outcome}`); }
  };
  try {
    await invoke('prepare', { kind: 'prepare', directory, cohort });
    const manifest = preparedTupleManifest(directory, cohort);
    if (cohort === 'author') {
      // The same live child path supplies retained positive and fail-closed stop
      // evidence. Lowered thresholds exercise stops without large allocations.
      for (const mode of ['completed', 'deadline', 'rss-limit', 'rss-unavailable'] as const) {
        const budget = cohortBudget(performance.now() - start, retainedInventory(directory).bytes, cohort);
        const result = await runTupleChild({ kind: 'control', mode: mode === 'completed' ? 'normal' : 'wait' }, { timeoutMs: Math.min(budget.timeoutMs, mode === 'deadline' ? 80 : 2000), rssBytes: mode === 'rss-limit' ? 1 : 2147483648 }, mode === 'rss-unavailable' ? () => undefined : undefined);
        receipts.push({ phase: `control-${mode}`, process: result });
        if (result.outcome !== mode) { throw new Error('diagnostic actual control mismatch'); }
      }
    }
    for (const input of manifest.inputs) {
      const budget = cohortBudget(performance.now() - start, retainedInventory(directory).bytes, cohort);
      await invoke(`owner-${String(input.population)}`, { kind: 'owner', input: retainedInputPath(directory, cohort, input.population), output: join(directory, `output-${String(input.population)}.json`), ...input, workerSha256: manifest.workerSha256, codecSha256: manifest.codecSha256, outputBudget: budget.outputBytes, retention: readRetentionPlan(directory) });
      retainedInventory(directory);
    }
    await invoke('analyze', { kind: 'analyze', directory, cohort });
    preparedTupleManifest(directory, cohort);
    const after = retainedInventory(directory);
    for (const file of before.fresh.files) { if (!after.fresh.files.some((current) => current.name === file.name && current.sha256 === file.sha256 && current.bytes === file.bytes)) { throw new Error('prior cohort artifact changed'); } }
    if (JSON.stringify(before.frozen) !== JSON.stringify(after.frozen)) { throw new Error('frozen failed attempt changed'); }
    const highWaterRssBytes = process.resourceUsage().maxRSS * 1024;
    if (highWaterRssBytes > 2147483648 || performance.now() - start >= 120000) { throw new Error('diagnostic parent final bound'); }
    writeRetainedArtifact(directory, `batch-${cohort}.json`, JSON.stringify({ cohort, receipts, elapsedMs: performance.now() - start, parentHighWaterRssBytes: highWaterRssBytes, inventoryBeforeReceipt: after, preparedManifestSha256: createHash('sha256').update(readFileSync(join(directory, `manifest-${cohort}.json`))).digest('hex'), sampling: { intervalMs: 25, childOnly: true, highWaterSeparate: true, transientPeakAvailable: false } }));
    retainedInventory(directory);
  } catch (error) {
    // Failures retain the closed child receipts; no automatic retry/resume is
    // attempted. The fresh-output protocol refuses reuse of a partial cohort.
    writeRetainedArtifact(directory, `batch-${cohort}-failure.json`, JSON.stringify({ cohort, receipts, message: error instanceof Error ? error.message : String(error), elapsedMs: performance.now() - start }));
    throw error;
  }
}
/** Only fixed author or independent held-out cohorts can be requested. */
async function main(): Promise<void> {
  const [directory, cohort, frozenDirectory, frozenFingerprint, secondDirectory, secondFingerprint] = process.argv.slice(2);
  if (directory === undefined || (cohort !== 'author' && cohort !== 'heldout') || (cohort === 'author' ? process.argv.length !== 8 || frozenDirectory === undefined || frozenFingerprint === undefined || secondDirectory === undefined || secondFingerprint === undefined : process.argv.length !== 4)) { throw new Error('tuple launcher arguments'); }
  if (cohort === 'author') {
    if (frozenDirectory === undefined || frozenFingerprint === undefined || secondDirectory === undefined || secondFingerprint === undefined) { throw new Error('tuple sealed failure arguments'); }
    createRetentionPlan(directory, frozenDirectory, frozenFingerprint, 49152, { directory: secondDirectory, fingerprint: secondFingerprint });
  }
  await runTupleCohort(directory, cohort);
  // Status is retained inside the same allowance, not in an uncounted log.
  writeRetainedArtifact(directory, `launcher-status-${cohort}.json`, JSON.stringify({ cohort, retainedBytesBeforeStatus: retainedInventory(directory).bytes }));
  retainedInventory(directory);
}
if (process.argv[1] !== undefined && pathToFileURL(process.argv[1]).href === import.meta.url) { await main(); }
