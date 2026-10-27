/** One-purpose parent for bounded cold-tuple diagnostics; no arbitrary executable dispatch. @packageDocumentation */
import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, lstatSync, readFileSync, readdirSync, realpathSync, writeFileSync } from 'node:fs';
import { basename, dirname, join, resolve as resolvePath } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createReleaseGate } from './tuple-lifecycle.js';
import { heldoutInventoryForPlan, heldoutRetainedInventory, validateHeldoutInputs } from './tuple-heldout-retention.js';
import type { IHeldoutRetentionPlan } from './tuple-heldout-retention.js';
import type { IReleaseState } from './tuple-lifecycle.js';
import type { IRetentionPlan } from './tuple-retention.js';
import { probeOwnedRss, retainRssObservation } from './tuple-rss.js';
import type { IRssProbeResult, IRssReading, IRssTrace } from './tuple-rss.js';

/** The named assembly test experiment resolves its own root, never a supplied executable. */
const root = fileURLToPath(new URL('../../../../', import.meta.url));
/** @internal Read the unchanged classification for owner-scoped fixture controls. */
export function readOwnedRss(pid: number): IRssReading { return probeOwnedRss(pid, process.pid).reading; }

/** @internal Selected named diagnostic child, never a caller-supplied executable. */
export type ITupleTask = { readonly kind: 'control'; readonly mode: 'normal' | 'wait' | 'early-close' | 'malformed-ready' | 'duplicate-ready' | 'released-hang' | 'released-output' | 'uncoordinated-normal' } | { readonly kind: 'prepare' | 'analyze'; readonly directory: string; readonly cohort: 'author' | 'heldout' } | { readonly kind: 'prepare-heldout' | 'analyze-heldout'; readonly directory: string } | { readonly kind: 'owner'; readonly input: string; readonly output: string; readonly inputSha256: string; readonly workerSha256: string; readonly codecSha256: string; readonly outputBudget: number; readonly retention?: IRetentionPlan; readonly heldoutRetention?: IHeldoutRetentionPlan };
/** @internal Test controls may lower limits; they can never raise the fixed diagnostic ceiling. */
export interface IDiagnosticLimits { readonly timeoutMs: number; readonly rssBytes: number }
/** @internal A returned receipt always witnesses child close/reap, including failed stops. */
export interface IDiagnosticReceipt { readonly outcome: 'completed' | 'deadline' | 'rss-limit' | 'rss-unavailable' | 'output-limit' | 'failed'; readonly pid: number; readonly reaped: true; readonly exitCode: number | null; readonly signal: string | null; readonly samples: number; readonly sampledPeakRssBytes: number; readonly elapsedMs: number; readonly stdoutBytes: number; readonly stderrBytes: number; readonly terminalNoLongerRunningObserved: boolean; readonly rssFailureDetail: string | null; readonly terminalWitness: 'none' | 'ps-no-match-and-kernel-esrch' | 'owned-zombie-rss-zero'; readonly rssTrace: IRssTrace; readonly protocol: IReleaseState }
/** @internal Run one fixed child under fail-closed deadline/RSS/output limits and await close. */
export async function runTupleChild(task: ITupleTask, limits: IDiagnosticLimits, sample?: (pid: number, phase: 'periodic' | 'final') => IRssReading | IRssProbeResult): Promise<IDiagnosticReceipt> {
  if (!Number.isSafeInteger(limits.timeoutMs) || limits.timeoutMs < 1 || limits.timeoutMs > 120000 || !Number.isSafeInteger(limits.rssBytes) || limits.rssBytes < 1 || limits.rssBytes > 2147483648) { throw new Error('diagnostic fixed limits'); }
  const freshHeldout = task.kind === 'prepare-heldout' || task.kind === 'analyze-heldout';
  const script = task.kind === 'owner' ? join(root, 'packages/resolution/.test-build/test/provenance-cold-worker.js') : fileURLToPath(new URL(task.kind === 'control' ? './tuple-control.js' : freshHeldout ? './tuple-heldout.js' : './tuple-diagnostic.js', import.meta.url));
  const args = task.kind === 'control' ? [task.mode] : task.kind === 'owner' ? [task.input, task.output, task.inputSha256, task.workerSha256, task.codecSha256, String(task.outputBudget)] : 'cohort' in task ? [task.kind, task.directory, task.cohort] : [task.kind, task.directory];
  if (task.kind === 'owner' && (!Number.isSafeInteger(task.outputBudget) || task.outputBudget < 1 || task.outputBudget > 1048576)) { throw new Error('diagnostic output budget'); }
  if (task.kind === 'owner') {
    const directory = dirname(task.input); const outputDirectory = dirname(task.output);
    const inventory = artifactInventory(directory); const outputInventory = artifactInventory(outputDirectory);
    let retainedBytes = inventory.bytes;
    let allowedInputRoot = resolvePath(outputDirectory) === resolvePath(directory);
    if (task.retention !== undefined) {
      const plan = task.retention; const frozen = artifactInventory(plan.frozenDirectory);
      const frozenRoot = realpathSync(plan.frozenDirectory); const freshRoot = realpathSync(outputDirectory);
      if (frozenRoot === freshRoot || frozen.bytes !== plan.frozenBytes || plan.externalEvidenceAllowanceBytes !== 49152 || createHash('sha256').update(JSON.stringify(frozen)).digest('hex') !== plan.frozenInventorySha256) { throw new Error('owner sealed failure inventory'); }
      let additionalBytes = 0;
      if (plan.additionalFailure !== undefined) {
        const extra = plan.additionalFailure; const extraInventory = artifactInventory(extra.directory); const extraRoot = realpathSync(extra.directory);
        if (extraRoot === frozenRoot || extraRoot === freshRoot || extraInventory.bytes !== extra.bytes || createHash('sha256').update(JSON.stringify(extraInventory)).digest('hex') !== extra.fingerprint) { throw new Error('owner additional sealed failure inventory'); }
        additionalBytes = extraInventory.bytes;
      }
      retainedBytes = frozen.bytes + additionalBytes + outputInventory.bytes + plan.externalEvidenceAllowanceBytes;
      allowedInputRoot = realpathSync(directory) === frozenRoot || realpathSync(directory) === freshRoot;
    }
    if (task.heldoutRetention !== undefined) {
      if (task.retention !== undefined) { throw new Error('owner conflicting retention lineages'); }
      retainedBytes = heldoutInventoryForPlan(outputDirectory, task.heldoutRetention).bytes; validateHeldoutInputs(outputDirectory);
      allowedInputRoot = realpathSync(directory) === realpathSync(task.heldoutRetention.prior.directory);
      if (!/^input-(?:3|9|17|64)\.json$/u.test(basename(task.input)) || basename(task.output) !== basename(task.input).replace('input-', 'output-')) { throw new Error('owner fixed fresh heldout population'); }
    }
    const stat = lstatSync(task.input);
    if (!allowedInputRoot || !/^input-[0-9]+\.json$/u.test(basename(task.input)) || !/^output-[0-9]+\.json$/u.test(basename(task.output)) || !stat.isFile() || stat.isSymbolicLink() || existsSync(task.output) || task.outputBudget > 1048576 - retainedBytes || createHash('sha256').update(readFileSync(task.input)).digest('hex') !== task.inputSha256) { throw new Error('owner artifact preflight'); }
  } else if (task.kind !== 'control') { if (freshHeldout) { heldoutRetainedInventory(task.directory); } else { artifactInventory(task.directory); } }
  return await new Promise<IDiagnosticReceipt>((resolve, reject) => {
    const requiresReady = !(task.kind === 'control' && task.mode === 'uncoordinated-normal');
    const start = performance.now(); const child = spawn(process.execPath, [script, ...args], { cwd: root, stdio: ['ignore', 'pipe', 'pipe', 'ipc'] });
    if (child.stdout === null || child.stderr === null) {
      child.kill('SIGKILL'); child.once('close', () => { reject(new Error('diagnostic owned output pipes unavailable')); }); return;
    }
    let outcome: IDiagnosticReceipt['outcome'] = 'completed'; let samples = 0; let peak = 0; let stdoutBytes = 0; let stderrBytes = 0;
    let terminalNoLongerRunningObserved = false; let rssFailureDetail: string | null = null;
    let terminalWitness: IDiagnosticReceipt['terminalWitness'] = 'none';
    let rssTrace: IRssTrace = { probes: 0, first: null, last: null, failing: null };
    let closeResult: { readonly exitCode: number | null; readonly signal: string | null } | undefined;
    // Selected executables never spawn descendants. Signals target the owned live
    // child only, never a group/PID after exit; the receipt waits for actual close.
    const stop = (reason: IDiagnosticReceipt['outcome']): void => {
      if (outcome === 'completed') { outcome = reason; }
      gate.cancel(reason);
      if (!terminalNoLongerRunningObserved && child.exitCode === null && child.signalCode === null) { child.kill('SIGKILL'); }
    };
    const observe = (): void => {
      if (outcome !== 'completed' || child.exitCode !== null || child.signalCode !== null || child.pid === undefined) { return; }
      let reading: number | 'not-running' | 'zombie' | undefined;
      try {
        const result = sample === undefined ? probeOwnedRss(child.pid, process.pid) : sample(child.pid, 'periodic');
        if (typeof result === 'object') { rssTrace = retainRssObservation(rssTrace, result.observation); reading = result.reading; }
        else { reading = result; }
      } catch { reading = undefined; rssFailureDetail = 'sampler-threw'; }
      if (reading === 'not-running' || reading === 'zombie') {
        // A supplied marker has no authority. Re-query this exact owned PID's
        // actual OS state before pausing sampling or waiting for exit/close.
        const confirmation = probeOwnedRss(child.pid, process.pid);
        rssTrace = retainRssObservation(rssTrace, confirmation.observation);
        const confirmed = confirmation.reading;
        if (samples === 0 || (confirmed !== 'not-running' && confirmed !== 'zombie')) { rssFailureDetail = 'unconfirmed-terminal-marker-or-no-positive-sample'; stop('rss-unavailable'); return; }
        terminalNoLongerRunningObserved = true;
        terminalWitness = confirmed === 'zombie' ? 'owned-zombie-rss-zero' : 'ps-no-match-and-kernel-esrch';
        clearInterval(sampler);
        // Execution is positively finished; the deadline remains armed until
        // actual exit/close. Never signal an absent/recycled PID while awaiting
        // the parent callback. Neither a prior sample nor later exit alone
        // authorizes this branch, and zero initial samples still reject.
        return;
      }
      const bytes = typeof reading === 'number' ? reading : undefined;
      if (bytes === undefined || !Number.isSafeInteger(bytes) || bytes < 1) { rssFailureDetail ??= 'missing-or-invalid-rss'; stop('rss-unavailable'); return; }
      samples++; peak = Math.max(peak, bytes); if (bytes > limits.rssBytes) { stop('rss-limit'); }
    };
    const finalRss = (): number | undefined => {
      if (child.pid === undefined) { return undefined; }
      // A test sampler may refuse completion; it cannot manufacture the final
      // positive host proof, which always comes from this independent OS probe.
      if (sample !== undefined) {
        const control = sample(child.pid, 'final'); const reading = typeof control === 'object' ? control.reading : control;
        if (typeof reading !== 'number' || !Number.isSafeInteger(reading) || reading < 1 || reading > limits.rssBytes) { return undefined; }
      }
      const result = probeOwnedRss(child.pid, process.pid); rssTrace = retainRssObservation(rssTrace, result.observation);
      if (typeof result.reading !== 'number') { return undefined; }
      samples++; peak = Math.max(peak, result.reading); return result.reading;
    };
    const gate = createReleaseGate({ rssLimit: limits.rssBytes, finalRss,
      pauseSampling: () => { clearInterval(sampler); },
      dispatch: (done) => child.send('tuple-release', done),
      fail: (reason) => { if (reason === 'invalid-final-rss') { rssFailureDetail = reason; stop('rss-unavailable'); } else { stop('failed'); } },
      settle: () => {
        if (closeResult === undefined || child.pid === undefined) { return; }
        clearTimeout(deadline); clearInterval(sampler);
        resolve({ outcome, pid: child.pid, reaped: true, ...closeResult, samples, sampledPeakRssBytes: peak, elapsedMs: performance.now() - start, stdoutBytes, stderrBytes, terminalNoLongerRunningObserved, rssFailureDetail, terminalWitness, rssTrace, protocol: gate.state() });
      },
    }, requiresReady);
    const deadline = setTimeout(() => { stop('deadline'); }, limits.timeoutMs);
    const sampler = setInterval(observe, 25);
    child.once('spawn', observe);
    child.on('message', (message: unknown) => { gate.message(message); });
    child.stdout.on('data', (chunk: Buffer) => { stdoutBytes += chunk.byteLength; if (stdoutBytes + stderrBytes > 65536) { stop('output-limit'); } });
    child.stderr.on('data', (chunk: Buffer) => { stderrBytes += chunk.byteLength; if (stdoutBytes + stderrBytes > 65536) { stop('output-limit'); } });
    child.once('error', (error) => {
      if (child.pid !== undefined) { stop('failed'); }
      else { clearTimeout(deadline); clearInterval(sampler); reject(error); }
    });
    child.once('close', (exitCode, signal) => {
      closeResult = { exitCode, signal };
      if (child.pid === undefined) { clearTimeout(deadline); clearInterval(sampler); reject(new Error('diagnostic never obtained child ownership')); return; }
      if (outcome === 'completed' && samples === 0) { outcome = 'rss-unavailable'; }
      if (outcome === 'completed' && (exitCode !== 0 || signal !== null)) { outcome = 'failed'; }
      // Close can precede send confirmation. The deadline remains armed until
      // both facts arrive or a stop is recorded; release is never an OS witness.
      gate.closed(exitCode === 0 && signal === null, outcome !== 'completed');
    });
  });
}
/** @internal Retained files are individually and cumulatively bounded, without following symlinks. */
export function artifactInventory(directory: string): { readonly bytes: number; readonly files: readonly { readonly name: string; readonly bytes: number; readonly sha256: string }[] } {
  const directoryStat = lstatSync(directory);
  if (!directoryStat.isDirectory() || directoryStat.isSymbolicLink()) { throw new Error('diagnostic root directory surface'); }
  let bytes = 0;
  const files = readdirSync(directory).sort().map((name) => {
    const path = join(directory, name); const stat = lstatSync(path);
    if (!stat.isFile() || stat.isSymbolicLink() || stat.size > 1048576) { throw new Error('diagnostic artifact surface/individual budget'); }
    bytes += stat.size; if (!Number.isSafeInteger(bytes) || bytes > 1048576) { throw new Error('diagnostic cumulative artifact budget'); }
    return { name, bytes: stat.size, sha256: createHash('sha256').update(readFileSync(path)).digest('hex') };
  });
  return { bytes, files };
}
/** @internal A fresh artifact is preflighted against the remaining shared diagnostic allowance. */
export function writeTupleArtifact(directory: string, name: string, text: string): void {
  if (!/^[a-zA-Z0-9-]+\.json$/u.test(name)) { throw new Error('diagnostic artifact name'); }
  if (artifactInventory(directory).bytes + Buffer.byteLength(text) > 1048576) { throw new Error('diagnostic cumulative output budget'); }
  writeFileSync(join(directory, name), text, { flag: 'wx' });
}
