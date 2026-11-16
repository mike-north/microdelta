/**
 * Bounded standalone TEST-6 driver. Each worker owns one OS-process lifetime;
 * only the fixture's durable store and validated receipts cross that boundary.
 * Frozen budgets follow the measured 16-key smoke, not a library performance promise.
 */
import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { arch, cpus, platform } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { promisify } from 'node:util';
import { assertReactiveCostQualification, parseReactiveCostReceipts } from './reactive-cost.js';

/** Host-observed smoke B made member/fold kernels costly relative to local filtering and retained retrieval. @internal */
export const reactiveCostBudgets = Object.freeze({ memberIterations: 50_000_000, foldIterations: 500_000_000, leaseMilliseconds: 300_000, phaseTimeoutMilliseconds: 180_000 });
/** A child timeout bounds synchronous CPU starvation as well as asynchronous waits. */
const execute = promisify(execFile);

/** Freeze exact fixture/declaration bytes beside bounded readable measurements and complete raw receipts. @internal */
export async function qualifyReactiveCost(directory: string, population: 16 | 512): Promise<void> {
  mkdirSync(directory, { recursive: true });
  const revision = (await execute('git', ['rev-parse', 'HEAD'])).stdout.trim();
  const sourceFiles = ['reactive-cost.ts', 'reactive-cost-worker.ts', 'reactive-cost-qualification.ts', 'reactive-cost.test.ts', 'test-d/reactive-cost.test-d.ts'].map(file => `fixtures/contribution-report/${file}`);
  const declarationFiles = ['core/microdelta', 'definition/definition', 'history/history', 'machine/machine', 'machine-node/machine-node', 'resolution/resolution', 'supervision/supervision', 'tracking/tracking'].map(value => { const [owner, entry] = value.split('/'); return `packages/${String(owner)}/dist/api/${String(entry)}.alpha.d.ts`; });
  const digest = (files: readonly string[]): Readonly<Record<string, string>> => Object.fromEntries(files.map(file => [file, createHash('sha256').update(readFileSync(file)).digest('hex')]));
  const identity = { revision, fixtureSha256: digest(sourceFiles), generatedAlphaSha256: digest(declarationFiles), host: { node: process.version, platform: platform(), architecture: arch(), cpu: cpus()[0]?.model ?? 'unknown' } };
  writeFileSync(join(directory, 'identity.json'), JSON.stringify(identity));
  for (const phase of ['cold', 'restart'] as const) {
    try {
      const result = await execute(process.execPath, [new URL('./reactive-cost-worker.js', import.meta.url).pathname, JSON.stringify({ directory, phase, population, ...reactiveCostBudgets, suppressCachedRead: false })], { timeout: reactiveCostBudgets.phaseTimeoutMilliseconds, killSignal: 'SIGKILL', maxBuffer: 1_048_576 });
      writeFileSync(join(directory, `${phase}.log`), result.stdout + result.stderr);
    } catch (error: unknown) {
      writeFileSync(join(directory, 'failure.json'), JSON.stringify({ phase, status: 'partial', message: error instanceof Error ? error.message : String(error) }));
      throw error;
    }
  }
  const receipts = parseReactiveCostReceipts(readFileSync(join(directory, 'receipts.json'), 'utf8'));
  assertReactiveCostQualification(receipts, population);
  writeFileSync(join(directory, 'qualification.json'), JSON.stringify({ schema: 'test6-reactive-cost-v1', population, budgets: reactiveCostBudgets, identity, status: 'passed', phases: receipts.map(receipt => ({ phase: receipt.phase, pid: receipt.pid, selectedIdentities: receipt.members.length, bodies: receipt.bodies, requestWallMilliseconds: receipt.requestWallMilliseconds, measurement: receipt.measurement, ...(receipt.filter === undefined ? {} : { filter: { measurement: receipt.filter.measurement, fixtureResults: receipt.filter.before.results, fixtureAcceptances: receipt.filter.before.acceptances, snapshotsUnchanged: true, requestsUnchanged: true } }) })), limitations: ['Process CPU/time/I-O describe whole phases; verification costs are outside the local filter interval.', 'maxRSS is the process-lifetime high-water mark, in KiB; it is not a per-phase RSS peak.', 'Heap uses baseline/final and timer samples; zero timer samples means boundary-only observations, not a covered peak.', 'Store bytes cover the main SQLite file at phase return, excluding sidecars.', 'The single-child cached-output oracle establishes observation behavior, not corpus-wide observation cost.', 'No facade-selected payload-load or fingerprint-attributed CPU/I-O measurement is exposed or claimed.'] }));
}

/** Only the measured smoke and bounded qualification populations are accepted by this executable. */
if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const population = Number(process.argv[3] ?? '16');
  if (population !== 16 && population !== 512) { throw new Error('qualification population must be 16 or 512'); }
  const directory = process.argv[2];
  if (directory === undefined) { throw new Error('qualification requires a separate output directory'); }
  await qualifyReactiveCost(resolve(directory), population);
}
