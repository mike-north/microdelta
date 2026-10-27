/** Actual tiny processes test stop/reap, while file controls enforce a shared bounded allowance. */
import { mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, test } from '@jest/globals';
import { artifactInventory, readOwnedRss, runTupleChild, writeTupleArtifact } from '../src/tuple-driver.js';
import { consumeColdWorker } from '../src/cold-bridge.js';
import { coldProvenance } from '../src/guards.js';
import { createHeldoutRetentionPlan, readHeldoutRetentionPlan } from '../src/tuple-heldout-retention.js';
import { createRetentionPlan, inventoryFingerprint, readRetentionPlan } from '../src/tuple-retention.js';
import { classifyRssProbe, probeOwnedRss } from '../src/tuple-rss.js';

test('normal process has actual RSS samples and is reaped before its receipt', async () => {
  const receipt = await runTupleChild({ kind: 'control', mode: 'normal' }, { timeoutMs: 2000, rssBytes: 2147483648 });
  expect(receipt).toMatchObject({ outcome: 'completed', reaped: true, exitCode: 0, signal: null, stdoutBytes: 6, stderrBytes: 0 });
  expect(receipt.samples).toBeGreaterThan(0); expect(receipt.sampledPeakRssBytes).toBeGreaterThan(0);
  expect(receipt.rssTrace.first).toMatchObject({ ownedPid: receipt.pid, expectedParentPid: process.pid, classification: 'observed', parsed: { pid: receipt.pid, parentPid: process.pid } });
  expect(receipt.rssTrace.probes).toBeGreaterThan(0);
  expect(Buffer.byteLength(JSON.stringify(receipt.rssTrace))).toBeLessThanOrEqual(4096);
  expect(() => process.kill(receipt.pid, 0)).toThrow();
});
test('deadline, lowered RSS ceiling and missing RSS each kill and reap actual waiting children', async () => {
  for (const mode of ['deadline', 'rss-limit', 'rss-unavailable'] as const) {
    const receipt = await runTupleChild({ kind: 'control', mode: 'wait' }, { timeoutMs: mode === 'deadline' ? 80 : 2000, rssBytes: mode === 'rss-limit' ? 1 : 2147483648 }, mode === 'rss-unavailable' ? () => undefined : undefined);
    expect(receipt).toMatchObject({ outcome: mode, reaped: true, exitCode: null, signal: 'SIGKILL' });
    expect(receipt.elapsedMs).toBeLessThan(3000); expect(() => process.kill(receipt.pid, 0)).toThrow();
  }
});
test('limits reject before launching a child rather than weakening fixed bounds', async () => {
  for (const limits of [{ timeoutMs: 120001, rssBytes: 1 }, { timeoutMs: 1000, rssBytes: 2147483649 }, { timeoutMs: 0, rssBytes: 1 }]) {
    await expect(runTupleChild({ kind: 'control', mode: 'wait' }, limits)).rejects.toThrow();
  }
});
test('shared inventory refuses cumulative overflow, overwrite, traversal and symlink before emission', () => {
  const directory = mkdtempSync(join(tmpdir(), 'tuple-budget-test-'));
  try {
    writeTupleArtifact(directory, 'a.json', 'a'.repeat(600000));
    expect(artifactInventory(directory).bytes).toBe(600000);
    expect(() => writeTupleArtifact(directory, 'b.json', 'b'.repeat(500000))).toThrow();
    expect(() => readFileSync(join(directory, 'b.json'))).toThrow();
    expect(() => writeTupleArtifact(directory, 'a.json', 'x')).toThrow();
    expect(() => writeTupleArtifact(directory, '../escape', 'x')).toThrow();
    symlinkSync(join(directory, 'a.json'), join(directory, 'link'));
    expect(() => artifactInventory(directory)).toThrow();
  } finally { rmSync(directory, { recursive: true, force: true }); }
});

test('root directory symlink is refused before any artifact is emitted through its target', () => {
  const parent = mkdtempSync(join(tmpdir(), 'tuple-root-budget-test-'));
  const directory = join(parent, 'real'); const link = join(parent, 'alias');
  try {
    mkdirSync(directory); symlinkSync(directory, link);
    expect(() => writeTupleArtifact(link, 'escaped.json', 'x')).toThrow();
    expect(() => readFileSync(join(directory, 'escaped.json'))).toThrow();
    writeTupleArtifact(directory, 'normal.json', 'x');
    expect(artifactInventory(directory).bytes).toBe(1);
  } finally { rmSync(parent, { recursive: true, force: true }); }
});

test('owner input/output path and cumulative allowance are preflighted before a child starts', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'tuple-owner-budget-test-'));
  try {
    writeTupleArtifact(directory, 'input-1.json', '{}');
    const task = { kind: 'owner', input: join(directory, 'input-1.json'), output: join(directory, 'output-1.json'), inputSha256: createHash('sha256').update('{}').digest('hex'), workerSha256: 'b'.repeat(64), codecSha256: 'c'.repeat(64), outputBudget: 1048576 } as const;
    let samples = 0; const sample = (): number => { samples++; return 1024; };
    await expect(runTupleChild(task, { timeoutMs: 1000, rssBytes: 2147483648 }, sample)).rejects.toThrow();
    await expect(runTupleChild({ ...task, outputBudget: 1, output: join(directory, '..', 'output-1.json') }, { timeoutMs: 1000, rssBytes: 2147483648 }, sample)).rejects.toThrow();
    expect(() => readFileSync(task.output)).toThrow();
    symlinkSync(task.input, join(directory, 'input-2.json'));
    await expect(runTupleChild({ ...task, input: join(directory, 'input-2.json'), outputBudget: 1 }, { timeoutMs: 1000, rssBytes: 2147483648 }, sample)).rejects.toThrow();
    rmSync(join(directory, 'input-2.json'));
    writeTupleArtifact(directory, 'output-1.json', '{}');
    await expect(runTupleChild({ ...task, outputBudget: 1 }, { timeoutMs: 1000, rssBytes: 2147483648 }, sample)).rejects.toThrow();
    expect(samples).toBe(0);
  } finally { rmSync(directory, { recursive: true, force: true }); }
});

test('positive RSS followed by missing/invalid/throw or false terminal marker on a live child stays failclosed', async () => {
  for (const mode of ['missing', 'invalid', 'throw', 'false-terminal', 'false-zombie']) {
    let calls = 0;
    const sample = (pid: number): number | 'not-running' | 'zombie' | undefined => {
      if (++calls === 1) { return readOwnedRss(pid); }
      if (mode === 'throw') { throw new Error('live sample failed'); }
      return mode === 'missing' ? undefined : mode === 'invalid' ? Number.NaN : mode === 'false-zombie' ? 'zombie' : 'not-running';
    };
    const result = await runTupleChild({ kind: 'control', mode: 'wait' }, { timeoutMs: 2000, rssBytes: 2147483648 }, sample);
    expect(result).toMatchObject({ outcome: 'rss-unavailable', exitCode: null, signal: 'SIGKILL', reaped: true, terminalNoLongerRunningObserved: false });
    expect(result.samples).toBeGreaterThan(0); expect(() => process.kill(result.pid, 0)).toThrow();
  }
});

test('kernel-confirmed ended child with an initial positive sample awaits actual exit/close, rather than false missing RSS', async () => {
  let calls = 0; let positive = false;
  const sample = (pid: number): number | 'not-running' | 'zombie' | undefined => {
    if (++calls === 1) { const reading = readOwnedRss(pid); positive = typeof reading === 'number' && reading > 0; return reading; }
    // A fixed finite helper lets the already-started normal child actually exit
    // while this parent's exit callback is pending; no author workload is run.
    execFileSync(process.execPath, ['-e', 'setTimeout(() => undefined, 180)'], { timeout: 1000, maxBuffer: 1024 });
    return readOwnedRss(pid);
  };
  const result = await runTupleChild({ kind: 'control', mode: 'uncoordinated-normal' }, { timeoutMs: 2000, rssBytes: 2147483648 }, sample);
  expect(positive).toBe(true);
  expect(result).toMatchObject({ outcome: 'completed', exitCode: 0, signal: null, reaped: true, terminalNoLongerRunningObserved: true, terminalWitness: 'owned-zombie-rss-zero' });
  expect(result.samples).toBeGreaterThan(0); expect(() => process.kill(result.pid, 0)).toThrow();
});

test('sealed exact two-root owner preflight admits only pinned old input and globally bounded fresh output', async () => {
  const parent = mkdtempSync(join(tmpdir(), 'tuple-sealed-owner-test-')); const frozen = join(parent, 'old'); const fresh = join(parent, 'fresh');
  try {
    mkdirSync(frozen); mkdirSync(fresh); writeTupleArtifact(frozen, 'input-1.json', '{}');
    createRetentionPlan(fresh, frozen, inventoryFingerprint(artifactInventory(frozen)), 49152);
    const retention = readRetentionPlan(fresh);
    const task = { kind: 'owner', input: join(frozen, 'input-1.json'), output: join(fresh, 'output-1.json'), inputSha256: createHash('sha256').update('{}').digest('hex'), workerSha256: 'b'.repeat(64), codecSha256: 'c'.repeat(64), outputBudget: 1, retention } as const;
    // The real child rejects deliberately wrong executable hashes before codec
    // execution. This tests preflight admission/ownership, not candidate output.
    const result = await runTupleChild(task, { timeoutMs: 2000, rssBytes: 2147483648 });
    expect(result.reaped).toBe(true); expect(result.outcome).not.toBe('completed');
    expect(() => readFileSync(task.output)).toThrow();
    await expect(runTupleChild({ ...task, retention: { ...retention, frozenInventorySha256: 'f'.repeat(64) } }, { timeoutMs: 1000, rssBytes: 2147483648 })).rejects.toThrow();
    await expect(runTupleChild({ ...task, outputBudget: 1048576 }, { timeoutMs: 1000, rssBytes: 2147483648 })).rejects.toThrow();
    expect(artifactInventory(frozen).files).toHaveLength(1);
  } finally { rmSync(parent, { recursive: true, force: true }); }
});

test('failed default-shaped probe is retained after a positive sample while live child is killed/reaped', async () => {
  let probes = 0;
  const result = await runTupleChild({ kind: 'control', mode: 'wait' }, { timeoutMs: 2000, rssBytes: 2147483648 }, (pid) => {
    if (++probes === 1) { return probeOwnedRss(pid, process.pid); }
    return classifyRssProbe(pid, process.pid, { status: null, signal: null, code: 'EPERM', stdout: null, stderr: 'denied\n' }, () => 'error');
  });
  expect(result).toMatchObject({ outcome: 'rss-unavailable', reaped: true, signal: 'SIGKILL' });
  expect(result.samples).toBeGreaterThan(0);
  expect(result.rssTrace.first).toMatchObject({ classification: 'observed' });
  expect(result.rssTrace.failing).toMatchObject({ ps: { status: null, signal: null, code: 'EPERM', stdout: null, stderr: 'denied\n' }, classification: 'unavailable', reason: 'ps-failed' });
  expect(result.rssTrace.last).toEqual(result.rssTrace.failing);
  expect(() => process.kill(result.pid, 0)).toThrow();
});

/** Neither a second failure's bytes nor its identity may disappear at worker admission. */
test('owner three-root preflight refuses second-root overflow and mutation before child launch', async () => {
  const parent = mkdtempSync(join(tmpdir(), 'tuple-three-owner-test-')); const frozen = join(parent, 'old'); const second = join(parent, 'second'); const fresh = join(parent, 'fresh');
  try {
    mkdirSync(frozen); mkdirSync(second); mkdirSync(fresh);
    writeTupleArtifact(frozen, 'input-1.json', '{}'); writeTupleArtifact(second, 'failure.json', 'b'.repeat(300000));
    createRetentionPlan(fresh, frozen, inventoryFingerprint(artifactInventory(frozen)), 49152, { directory: second, fingerprint: inventoryFingerprint(artifactInventory(second)) });
    const retention = readRetentionPlan(fresh);
    const task = { kind: 'owner', input: join(frozen, 'input-1.json'), output: join(fresh, 'output-1.json'), inputSha256: createHash('sha256').update('{}').digest('hex'), workerSha256: 'b'.repeat(64), codecSha256: 'c'.repeat(64), outputBudget: 800000, retention } as const;
    let samples = 0; const sample = (): number => { samples++; return 1024; };
    await expect(runTupleChild(task, { timeoutMs: 1000, rssBytes: 2147483648 }, sample)).rejects.toThrow();
    rmSync(join(second, 'failure.json')); writeTupleArtifact(second, 'failure.json', 'changed');
    await expect(runTupleChild({ ...task, outputBudget: 1 }, { timeoutMs: 1000, rssBytes: 2147483648 }, sample)).rejects.toThrow();
    expect(samples).toBe(0); expect(() => readFileSync(task.output)).toThrow();
  } finally { rmSync(parent, { recursive: true, force: true }); }
});

/** Actual normal children retain a live positive final sample, then close after confirmed release. */
test('post-work ready requires a final OS RSS sample and successful release before normal close', async () => {
  const result = await runTupleChild({ kind: 'control', mode: 'normal' }, { timeoutMs: 2000, rssBytes: 2147483648 });
  expect(result).toMatchObject({ outcome: 'completed', exitCode: 0, reaped: true, terminalNoLongerRunningObserved: false, terminalWitness: 'none', protocol: { ready: true, releaseDispatched: true, releaseConfirmed: true, failure: null } });
  expect(result.protocol.finalRssBytes).toBeGreaterThan(0); expect(result.protocol.finalRssBytes).toBeLessThanOrEqual(2147483648);
  expect(result.rssTrace.last?.classification).toBe('observed'); expect(() => process.kill(result.pid, 0)).toThrow();
});
test('a ready child with unavailable zero invalid or excessive final RSS is killed and reaped', async () => {
  for (const reading of [undefined, 0, Number.NaN, 2147483649]) {
    const result = await runTupleChild({ kind: 'control', mode: 'normal' }, { timeoutMs: 2000, rssBytes: 2147483648 }, (pid, phase) => phase === 'final' ? reading : readOwnedRss(pid));
    expect(result).toMatchObject({ outcome: 'rss-unavailable', reaped: true, signal: 'SIGKILL', protocol: { ready: true, releaseDispatched: false, releaseConfirmed: false, failure: 'invalid-final-rss' } });
    expect(() => process.kill(result.pid, 0)).toThrow();
  }
});
test('released child that hangs still reaches deadline SIGKILL and actual reap without an OS-terminal waiver', async () => {
  const result = await runTupleChild({ kind: 'control', mode: 'released-hang' }, { timeoutMs: 250, rssBytes: 2147483648 });
  expect(result).toMatchObject({ outcome: 'deadline', reaped: true, signal: 'SIGKILL', terminalNoLongerRunningObserved: false, terminalWitness: 'none', protocol: { ready: true, releaseDispatched: true, releaseConfirmed: true } });
  expect(() => process.kill(result.pid, 0)).toThrow();
});
test('no ready malformed ready or duplicate ready fails closed before success can be recorded', async () => {
  for (const mode of ['early-close', 'malformed-ready', 'duplicate-ready'] as const) {
    // Isolate the missing-ready guard from an independent ending RSS refusal.
    // This seam cannot bypass the separate actual final OS probe or accept close.
    const result = await runTupleChild({ kind: 'control', mode }, { timeoutMs: 2000, rssBytes: 2147483648 }, mode === 'early-close' ? () => 1024 : undefined);
    expect(result).toMatchObject({ outcome: 'failed', reaped: true, protocol: { failure: mode === 'early-close' ? 'closed-before-release' : 'invalid-or-duplicate-ready' } });
    expect(() => process.kill(result.pid, 0)).toThrow();
  }
});

test('output enforcement remains armed during the termination-only phase after release', async () => {
  const result = await runTupleChild({ kind: 'control', mode: 'released-output' }, { timeoutMs: 2000, rssBytes: 2147483648 });
  expect(result).toMatchObject({ outcome: 'output-limit', reaped: true, signal: 'SIGKILL', terminalWitness: 'none', protocol: { ready: true, releaseDispatched: true, releaseConfirmed: true } });
  expect(result.stdoutBytes).toBeGreaterThan(65536); expect(() => process.kill(result.pid, 0)).toThrow();
});

test('fresh held-out admission reads only sealed C and counts A B C D before a worker can start', async () => {
  const parent = mkdtempSync(join(tmpdir(), 'tuple-four-owner-test-')); const a = join(parent, 'a'); const b = join(parent, 'b'); const c = join(parent, 'c'); const d = join(parent, 'd');
  try {
    for (const directory of [a, b, c, d]) { mkdirSync(directory); }
    writeTupleArtifact(a, 'input-3.json', '{}'); writeTupleArtifact(b, 'failure.json', 'b'.repeat(300000));
    for (const population of [3, 9, 17, 64]) { writeTupleArtifact(c, `input-${String(population)}.json`, JSON.stringify({ population, input: coldProvenance(population, 'a'.repeat(64)) })); }
    const pin = (directory: string): { readonly directory: string; readonly fingerprint: string } => ({ directory, fingerprint: inventoryFingerprint(artifactInventory(directory)) });
    createHeldoutRetentionPlan(d, pin(a), pin(b), pin(c), { sourceCommit: 'a'.repeat(40), manifestSha256: 'b'.repeat(64), analysisSha256: 'c'.repeat(64), batchSha256: 'd'.repeat(64), workerPrefixSha256: 'e'.repeat(64), errorsSourceSha256: 'f'.repeat(64) });
    const heldoutRetention = readHeldoutRetentionPlan(d);
    const task = { kind: 'owner', input: join(c, 'input-3.json'), output: join(d, 'output-3.json'), inputSha256: createHash('sha256').update(readFileSync(join(c, 'input-3.json'))).digest('hex'), workerSha256: 'b'.repeat(64), codecSha256: 'c'.repeat(64), outputBudget: 1, heldoutRetention } as const;
    // Wrong executable hashes stop the admitted actual child before codec work.
    // Isolate admission/identity refusal from an independent ending RSS refusal:
    // synthetic periodic samples prove this path only, never resource evidence.
    // Successful-worker tests still require actual periodic and final OS probes.
    let admittedSamples = 0;
    const admitted = await runTupleChild(task, { timeoutMs: 2000, rssBytes: 2147483648 }, () => { admittedSamples++; return 1024; });
    expect(admittedSamples).toBeGreaterThan(0);
    // Nonzero owner exit is the failure; no ready message entered the release gate.
    expect(admitted).toMatchObject({ outcome: 'failed', exitCode: 1, signal: null, reaped: true, protocol: { ready: false, finalRssBytes: null, releaseDispatched: false, releaseConfirmed: false, failure: null } });
    expect(() => process.kill(admitted.pid, 0)).toThrow(); expect(() => readFileSync(task.output)).toThrow();
    let samples = 0; const sample = (): number => { samples++; return 1024; };
    await expect(runTupleChild({ ...task, outputBudget: 800000 }, { timeoutMs: 1000, rssBytes: 2147483648 }, sample)).rejects.toThrow();
    await expect(runTupleChild({ ...task, input: join(a, 'input-3.json') }, { timeoutMs: 1000, rssBytes: 2147483648 }, sample)).rejects.toThrow();
    await expect(runTupleChild({ ...task, heldoutRetention: { ...heldoutRetention, externalEvidenceAllowanceBytes: 0 } }, { timeoutMs: 1000, rssBytes: 2147483648 }, sample)).rejects.toThrow();
    rmSync(join(c, 'input-3.json')); writeTupleArtifact(c, 'input-3.json', 'changed');
    await expect(runTupleChild(task, { timeoutMs: 1000, rssBytes: 2147483648 }, sample)).rejects.toThrow(); expect(samples).toBe(0);
  } finally { rmSync(parent, { recursive: true, force: true }); }
});

/** A tiny unit fixture exercises the real owner-local CLI handler and actual-output bridge. */
test('actual owner output reaches Value after owner-local ready final RSS release and close', async () => {
  const parent = mkdtempSync(join(tmpdir(), 'tuple-owned-release-test-')); const a = join(parent, 'a'); const b = join(parent, 'b'); const c = join(parent, 'c'); const d = join(parent, 'd');
  try {
    for (const directory of [a, b, c, d]) { mkdirSync(directory); }
    for (const population of [3, 9, 17, 64]) { writeTupleArtifact(c, `input-${String(population)}.json`, JSON.stringify({ population, input: coldProvenance(population, 'a'.repeat(64)) })); }
    const pin = (directory: string): { readonly directory: string; readonly fingerprint: string } => ({ directory, fingerprint: inventoryFingerprint(artifactInventory(directory)) });
    createHeldoutRetentionPlan(d, pin(a), pin(b), pin(c), { sourceCommit: 'a'.repeat(40), manifestSha256: 'b'.repeat(64), analysisSha256: 'c'.repeat(64), batchSha256: 'd'.repeat(64), workerPrefixSha256: 'e'.repeat(64), errorsSourceSha256: 'f'.repeat(64) });
    const hashFile = (path: string): string => createHash('sha256').update(readFileSync(path)).digest('hex');
    const workerSha256 = hashFile('packages/resolution/.test-build/test/provenance-cold-worker.js'); const codecSha256 = hashFile('packages/resolution/.test-build/src/provenance-wire.js'); const inputSha256 = hashFile(join(c, 'input-3.json'));
    const result = await runTupleChild({ kind: 'owner', input: join(c, 'input-3.json'), output: join(d, 'output-3.json'), inputSha256, workerSha256, codecSha256, outputBudget: 10000, heldoutRetention: readHeldoutRetentionPlan(d) }, { timeoutMs: 2000, rssBytes: 2147483648 });
    expect(result).toMatchObject({ outcome: 'completed', exitCode: 0, reaped: true, protocol: { ready: true, releaseDispatched: true, releaseConfirmed: true, failure: null } });
    expect(result.protocol.finalRssBytes).toBeGreaterThan(0); expect(() => process.kill(result.pid, 0)).toThrow();
    expect(consumeColdWorker(readFileSync(join(d, 'output-3.json'), 'utf8'), { population: 3, inputSha256, workerSha256, codecSha256, implementationDigest: 'a'.repeat(64) })).toMatchObject({ population: 3, utf16: 7043, utf8: 7043 });
  } finally { rmSync(parent, { recursive: true, force: true }); }
});
