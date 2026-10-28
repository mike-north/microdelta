/** Actual controlled reports cross the installed start/finite-observe boundary; runtime settlement never substitutes for strict report truth. */
import { spawn, spawnSync } from 'node:child_process';
import type { ChildProcessWithoutNullStreams, SpawnSyncReturns } from 'node:child_process';
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

import { afterAll, afterEach, beforeAll, beforeEach, expect, test } from '@jest/globals';
import { openDurableAccounting } from '@microdelta/accounting';
import { openDurableHistory } from '@microdelta/history';
import { createNodeClock, createNodeMachine, createNodeSqlite } from '@microdelta/machine-node';
import type { ICompletedResultReference } from 'microdelta';

import { reportAnalysis } from '../../examples/contribution-report/src/controlled/application.js';
import { isRecord } from '../../examples/contribution-report/src/controlled/github.js';
import { isProcessReport } from './process-protocol.js';
import type { IProcessReport } from './process-protocol.js';

/** The emitted fixture path determines the checkout without relying on the shell's current directory. */
const repository = fileURLToPath(new URL('../../../../../', import.meta.url));
/** One real copied installation supplies the executable and every first-party package to all small cases. */
const consumer = mkdtempSync(join(tmpdir(), 'controlled-report-installed-'));
/** Only generated alpha declarations supply library types; runtime resolution uses the installed ordinary package entries. */
const packages = ['core', 'accounting', 'definition', 'history', 'machine', 'machine-node', 'materialization', 'resolution', 'supervision', 'tracking', 'value'];
/** The actual caller is compiled inside the installed consumer, preserving its application/fixture relative edges. */
const modulePath = join(consumer, 'compiled/fixtures/contribution-report/cli-workload.js');
const executable = join(consumer, 'node_modules/.bin/microdelta');
let directory: string | undefined;

beforeAll(() => {
  writeFileSync(join(consumer, 'package.json'), JSON.stringify({ name: 'controlled-report-cli-consumer', private: true, type: 'module' }));
  const installed = spawnSync('npm', ['install', '--prefix', consumer, '--install-links', '--offline', '--package-lock=false', '--no-audit', '--no-fund', ...packages.map(name => join(repository, 'packages', name))], { encoding: 'utf8', timeout: 90_000 });
  if (installed.status !== 0) { throw new Error(`Coherent local package install failed: ${installed.stderr}`); }
  const source = join(consumer, 'source');
  cpSync(join(repository, 'examples/contribution-report/src/controlled'), join(source, 'examples/contribution-report/src/controlled'), { recursive: true });
  mkdirSync(join(source, 'fixtures/contribution-report'), { recursive: true });
  for (const file of ['cli-workload.ts', 'fixture.ts', 'process-protocol.ts']) {
    cpSync(join(repository, 'fixtures/contribution-report', file), join(source, 'fixtures/contribution-report', file));
  }
  const paths = Object.fromEntries(packages.map(name => [name === 'core' ? 'microdelta' : `@microdelta/${name}`, [join(consumer, 'node_modules', name === 'core' ? 'microdelta' : `@microdelta/${name}`, 'dist/api', `${name === 'core' ? 'microdelta' : name}.alpha.d.ts`)]]));
  writeFileSync(join(consumer, 'tsconfig.json'), JSON.stringify({ compilerOptions: {
    target: 'ES2022', lib: ['ES2022'], module: 'NodeNext', moduleResolution: 'NodeNext', strict: true,
    noUncheckedIndexedAccess: true, exactOptionalPropertyTypes: true, noImplicitOverride: true, noFallthroughCasesInSwitch: true,
    noUnusedLocals: true, noUnusedParameters: true, noEmitOnError: true, verbatimModuleSyntax: true,
    esModuleInterop: false, allowSyntheticDefaultImports: false, skipLibCheck: false,
    types: ['node'], typeRoots: [join(repository, 'node_modules/@types')], paths, rootDir: 'source', outDir: 'compiled',
  }, files: ['source/fixtures/contribution-report/cli-workload.ts'] }));
  const compiled = spawnSync(process.execPath, [join(repository, 'node_modules/typescript/bin/tsc'), '-p', join(consumer, 'tsconfig.json')], { encoding: 'utf8', timeout: 30_000 });
  expect(compiled.status).toBe(0); expect(compiled.stdout + compiled.stderr).toBe('');
}, 120_000);
afterAll(() => { rmSync(consumer, { recursive: true, force: true }); });
beforeEach(() => { directory = mkdtempSync(join(tmpdir(), 'controlled-report-cli-case-')); });
afterEach(() => { if (directory !== undefined) { rmSync(directory, { recursive: true, force: true }); directory = undefined; } });

/** One explicit invocation owns a fresh evidence directory and observation artifact, sharing only durable application stores. */
interface ICase { readonly state: string; readonly proof: string; readonly ledger: string; readonly observation: string; readonly key: string }
/** Give each invocation an independent destination, not a reused execution identity. */
function invocation(name: string): ICase {
  if (directory === undefined) { throw new Error('Case directory was not initialized'); }
  const state = join(directory, 'state'); const proof = join(directory, name);
  mkdirSync(state, { recursive: true }); mkdirSync(proof, { recursive: true });
  return { state, proof, ledger: join(proof, 'calls.jsonl'), observation: join(proof, 'observation.sqlite'), key: `installed:${name}` };
}
/** Only the fixture's import counter uses an environment seam; no provider or credential configuration is loaded. */
function environment(case_: ICase): NodeJS.ProcessEnv { return { ...process.env, CONTROLLED_REPORT_CLI_LEDGER: case_.ledger }; }
/** Normal opaque arguments select only this fixture's small scenario and evidence destinations. */
function argumentsFor(case_: ICase, mode = 'normal'): readonly string[] {
  return ['start', '--module', modulePath, '--observation', case_.observation, '--', case_.state, case_.proof, case_.key, mode];
}
/** Start is the actual installed bin, never a direct CLI function or a second nested run. */
function start(case_: ICase, mode = 'normal'): SpawnSyncReturns<string> {
  return spawnSync(executable, argumentsFor(case_, mode), { cwd: consumer, env: environment(case_), encoding: 'utf8', timeout: 30_000 });
}
/** An explicit exact locator is independently readable from any cwd without loading the caller. */
interface ILocator { readonly location: string; readonly executionId: string }
/** Refuse malformed or absent protocol lines before using them as observation addresses. */
function locator(stdout: string): ILocator {
  const lines = stdout.trimEnd().split('\n');
  expect(lines).toHaveLength(2);
  const first: unknown = JSON.parse(lines[0] ?? 'null');
  if (!isRecord(first) || first.version !== 1 || first.type !== 'locator' || !isRecord(first.locator)
    || typeof first.locator.location !== 'string' || typeof first.locator.executionId !== 'string') { throw new Error('Missing actual CLI locator receipt'); }
  const terminal: unknown = JSON.parse(lines[1] ?? 'null');
  expect(terminal).toMatchObject({ version: 1, type: 'terminal', locator: first.locator, runtime: 'returned', failures: [], stop: 'none', acknowledgment: { kind: 'acknowledged' }, cleanup: 'disposed', transport: 'available' });
  return { location: first.locator.location, executionId: first.locator.executionId };
}
/** One finite read must exit and emit exactly one versioned observed document. */
function observe(case_: ICase, address: ILocator): Readonly<Record<string, unknown>> {
  const read = spawnSync(executable, ['observe', '--location', address.location, '--execution-id', address.executionId], { cwd: consumer, env: environment(case_), encoding: 'utf8', timeout: 10_000 });
  expect(read.status).toBe(0); expect(read.error).toBeUndefined(); expect(read.stderr).toBe('');
  expect(read.stdout.trimEnd().split('\n')).toHaveLength(1);
  const value: unknown = JSON.parse(read.stdout);
  if (!isRecord(value) || value.version !== 1 || !isRecord(value.result) || value.result.kind !== 'observed' || !isRecord(value.result.observation)) { throw new Error('Expected a faithful finite observation'); }
  return value.result.observation;
}
/** Keep the original full fold and usage for assertions, alongside the already established checked process summary. */
function evidence(case_: ICase): { readonly summary: IProcessReport; readonly raw: unknown } {
  const raw: unknown = JSON.parse(readFileSync(join(case_.proof, 'outcome.json'), 'utf8'));
  if (!isProcessReport(raw)) { throw new Error('Invalid actual controlled report evidence'); }
  return { summary: raw, raw };
}
/** Append-only counters identify import, preparation, body, source/provider work, control and disposal independently. */
function counters(case_: ICase): readonly unknown[] {
  return readFileSync(case_.ledger, 'utf8').trimEnd().split('\n').filter(Boolean).map((line): unknown => JSON.parse(line));
}
/** Count only a named fixture fact; unknown log values cannot masquerade as actual work. */
function count(case_: ICase, kind: string): number { return counters(case_).filter(value => isRecord(value) && value.kind === kind).length; }
/** Exact person references come from the current strict fold, not display content or a candidate search. */
function people(summary: IProcessReport): Readonly<Record<string, string>> {
  return Object.fromEntries(summary.people.flatMap(person => person.reference === undefined ? [] : [[person.key, person.reference.locator]]));
}
/** Open and close independent owner APIs before byte snapshots; the oracle itself is not claimed read-only. */
function retained(case_: ICase, reference: ICompletedResultReference): unknown {
  const history = openDurableHistory({ sqlite: createNodeSqlite(), clock: createNodeClock(), sha256: createNodeMachine(), location: join(case_.state, 'history.sqlite'), logicalStore: 'controlled-history' });
  try { return history.reader.readSubtree(reference, []); }
  finally { history.close(); }
}
/** The independent Accounting oracle reads already closed application usage and closes before immutability checks. */
function durableUsage(case_: ICase): ReturnType<ReturnType<typeof openDurableAccounting>['summarizeUsage']> {
  const accounting = openDurableAccounting({ sqlite: createNodeSqlite(), location: join(case_.state, 'usage.sqlite'), logicalStore: 'controlled-usage' });
  try { return accounting.summarizeUsage({ environment: 'production' }); }
  finally { accounting.close(); }
}
/** Only application/observation evidence directories participate; installed code is not an artifact catalog. */
function snapshot(case_: ICase): readonly { readonly path: string; readonly entries: readonly string[]; readonly bytes: readonly { readonly name: string; readonly value: Buffer }[] }[] {
  return [case_.state, case_.proof].map(path => {
    const entries = readdirSync(path).sort();
    return { path, entries, bytes: entries.map(name => ({ name, value: readFileSync(join(path, name)) })) };
  });
}
/** The writer, acknowledgment, disposer, process and independent writable oracles have all closed before this proof starts. */
function settledObservation(case_: ICase, address: ILocator, expectedApplication: unknown): void {
  const before = snapshot(case_); const beforeCounters = counters(case_);
  for (let index = 0; index < 2; index += 1) {
    const read = observe(case_, address);
    expect(read).toMatchObject({ executionId: address.executionId, phase: 'closed', body: 'returned', application: expectedApplication });
    expect(snapshot(case_)).toEqual(before); expect(counters(case_)).toEqual(beforeCounters);
  }
}
/** Strict coverage and separately addressed retained bytes establish actual report truth before inspecting its observation statement. */
function strictReport(case_: ICase, summary: IProcessReport, kind: 'published' | 'reused'): ICompletedResultReference {
  expect(summary.status).toBe('complete'); expect(summary.foldStatus).toBe('succeeded');
  if (summary.reportReference === undefined) { throw new Error('Current strict report has no exact retained reference'); }
  expect(evidence(case_).raw).toMatchObject({ fold: { outcome: { status: 'succeeded', outcome: { kind, reference: summary.reportReference, coverage: { closed: true, required: ['ada', 'grace'], skipped: [] } } } } });
  expect(retained(case_, summary.reportReference)).toMatchObject({ population: 'authored-prs', coverageBasis: 'fixed-controlled-dataset', selected: ['ada', 'grace'], people: [{ key: 'ada', count: 2, score: 4 }, { key: 'grace', count: 2, score: 4 }] });
  for (const url of [summary.runtime.microdelta, summary.runtime.history, summary.runtime.accounting, summary.runtime.machineNode]) {
    expect(realpathSync(fileURLToPath(url)).startsWith(`${realpathSync(join(consumer, 'node_modules'))}${sep}`)).toBe(true);
  }
  expect(summary.runtime.application).toContain('/compiled/examples/contribution-report/src/controlled/application.js');
  return summary.reportReference;
}

// CLI-005 forbids preparation from becoming an execution; this uses the same actual compiled factory as start.
test('compiled caller import and preparation leave report/provider work unstarted and dispose its resources exactly once', () => {
  const case_ = invocation('prepare-only');
  const script = `const module = await import(${JSON.stringify(modulePath)});\nconst prepared = await module.default.prepare(Object.freeze(${JSON.stringify([case_.state, case_.proof, case_.key, 'normal'])}));\nawait prepared.dispose(); await prepared.dispose();\n`;
  const result = spawnSync(process.execPath, ['--input-type=module', '-e', script], { cwd: consumer, env: environment(case_), encoding: 'utf8', timeout: 10_000 });
  expect(result.status).toBe(0); expect(result.stderr).toBe(''); expect(result.stdout).toBe('');
  expect(count(case_, 'import')).toBe(1); expect(count(case_, 'factory')).toBe(1); expect(count(case_, 'dispose')).toBe(1);
  for (const kind of ['body', 'source', 'github', 'assessment', 'control']) { expect(count(case_, kind)).toBe(0); }
  expect(existsSync(case_.observation)).toBe(false); expect(existsSync(join(case_.proof, 'outcome.json'))).toBe(false);
}, 60_000);

test('actual cold strict report and fresh-process reuse are confirmed by separate installed reads and exact owner oracles', () => {
  const first = invocation('cold'); const cold = start(first);
  expect(cold.status).toBe(0); expect(cold.stderr).toBe('');
  const firstAddress = locator(cold.stdout); const firstEvidence = evidence(first).summary;
  const firstReference = strictReport(first, firstEvidence, 'published');
  expect(firstEvidence.requests).toBe(24); expect(firstEvidence.assessments).toBe(4);
  expect(firstEvidence.usage).toMatchObject({ attempts: 28, reports: 4, tokens: 40 });
  expect(durableUsage(first)).toMatchObject({ requestAttempts: 28, reports: 4, observed: [{ unit: 'tokens', amount: 40 }] });
  expect(evidence(first).raw).toMatchObject({ detailedUsage: { requestAttempts: 28, reports: 4, unknown: expect.any(Array) } });
  expect(count(first, 'import')).toBe(1); expect(count(first, 'factory')).toBe(1); expect(count(first, 'body')).toBe(1); expect(count(first, 'dispose')).toBe(1);
  settledObservation(first, firstAddress, { kind: 'confirmed', deliverable: firstReference.locator });

  const next = invocation('reuse'); const reused = start(next);
  expect(reused.status).toBe(0); expect(reused.stderr).toBe('');
  const nextAddress = locator(reused.stdout); const nextEvidence = evidence(next).summary;
  const nextReference = strictReport(next, nextEvidence, 'reused');
  expect(nextAddress.executionId).not.toBe(firstAddress.executionId); expect(nextAddress.location).not.toBe(firstAddress.location);
  expect(nextReference).toEqual(firstReference); expect(people(nextEvidence)).toEqual(people(firstEvidence));
  expect(nextEvidence.requests).toBe(4); expect(nextEvidence.assessments).toBe(0);
  expect(nextEvidence.trace.filter(event => /^(?:detail|discussion|assessment|summary)-body:/u.test(event))).toEqual([]);
  expect(durableUsage(next)).toMatchObject({ requestAttempts: 32, reports: 4, observed: [{ unit: 'tokens', amount: 40 }] });
  expect(count(next, 'import')).toBe(1); expect(count(next, 'factory')).toBe(1); expect(count(next, 'body')).toBe(1); expect(count(next, 'dispose')).toBe(1);
  settledObservation(next, nextAddress, { kind: 'confirmed', deliverable: nextReference.locator });
}, 60_000);

test('actual current required failure remains incomplete with exit-zero runtime and cannot borrow an old readable success', () => {
  const warm = invocation('warm'); const warmed = start(warm); expect(warmed.status).toBe(0);
  const old = strictReport(warm, evidence(warm).summary, 'published');
  const failed = invocation('incomplete'); const result = start(failed, 'fail-ada');
  expect(result.status).toBe(0); expect(result.stderr).toBe('');
  const address = locator(result.stdout); const current = evidence(failed);
  expect(current.summary.status).toBe('incomplete'); expect(current.summary.foldStatus).toBe('failed'); expect(current.summary.reportReference).toBeUndefined();
  // Usage retains the environment's earlier durable facts; current wire counts remain independently asserted below.
  expect(current.raw).toMatchObject({ fold: { outcome: { status: 'failed', failed: expect.any(Array) } }, detailedUsage: { requestAttempts: 31, reports: 4, unknown: expect.any(Array) } });
  expect(current.summary.requests).toBe(3); expect(current.summary.assessments).toBe(0);
  expect(current.summary.people.find(person => person.key === 'ada')?.status).toBe('failed');
  expect(retained(failed, old)).toMatchObject({ selected: ['ada', 'grace'] });
  durableUsage(failed);
  settledObservation(failed, address, { kind: 'incomplete', reasons: ['required-work'] });
}, 60_000);

/** A parent-owned child handle has one bounded readiness barrier and one bounded actual process-exit promise. */
interface ILive { readonly child: ChildProcessWithoutNullStreams; readonly ready: Promise<void>; readonly closed: Promise<number | null>; output(): { readonly stdout: string; readonly stderr: string } }
/** The fixture pauses the entire body before graph admission, so no sibling work can confound active-reader counters. */
function launch(case_: ICase): ILive {
  const child = spawn(executable, argumentsFor(case_, 'barrier'), { cwd: consumer, env: environment(case_) });
  let stdout = ''; let stderr = '';
  const ready = new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => { child.kill('SIGKILL'); reject(new Error('Controlled CLI did not reach its pre-admission barrier')); }, 20_000);
    /** Independent pipes can arrive in either order; readiness requires both the locator line and reached barrier. */
    function reached(): void {
      if (stdout.includes('\n') && stderr.includes('controlled-report-barrier-ready\n')) { clearTimeout(timer); resolve(); }
    }
    child.stdout.on('data', (chunk: Buffer) => { stdout += chunk.toString(); reached(); });
    child.stderr.on('data', (chunk: Buffer) => { stderr += chunk.toString(); reached(); });
    child.once('error', error => { clearTimeout(timer); reject(error); });
    child.once('close', () => { clearTimeout(timer); if (!stdout.includes('\n') || !stderr.includes('controlled-report-barrier-ready\n')) { reject(new Error(`CLI closed before locator and barrier: ${stderr}`)); } });
  });
  const closed = new Promise<number | null>((resolve, reject) => {
    const timer = setTimeout(() => { child.kill('SIGKILL'); reject(new Error('Controlled CLI exceeded its finite process deadline')); }, 40_000);
    child.once('close', code => { clearTimeout(timer); resolve(code); }); child.once('error', error => { clearTimeout(timer); reject(error); });
  });
  return { child, ready, closed, output: () => ({ stdout, stderr }) };
}

test('a finite installed reader is noninterfering while the actual CLI is active before graph work, then settled artifacts remain identical', async () => {
  const case_ = invocation('barrier'); const running = launch(case_);
  try {
    await running.ready;
    const initial: unknown = JSON.parse(running.output().stdout.trim());
    if (!isRecord(initial) || !isRecord(initial.locator) || typeof initial.locator.location !== 'string' || typeof initial.locator.executionId !== 'string') { throw new Error('No active CLI locator'); }
    const address = { location: initial.locator.location, executionId: initial.locator.executionId };
    expect(running.child.exitCode).toBeNull();
    expect(count(case_, 'import')).toBe(1); expect(count(case_, 'factory')).toBe(1); expect(count(case_, 'body')).toBe(1);
    for (const kind of ['source', 'github', 'assessment', 'control', 'dispose']) { expect(count(case_, kind)).toBe(0); }
    const before = counters(case_);
    const current = observe(case_, address);
    expect(current).toMatchObject({ executionId: address.executionId, context: { analysis: reportAnalysis, environment: 'production' } });
    // The graph is paused, while ordinary observation sampling may advance the persisted nonterminal phase.
    expect(['prepared', 'running']).toContain(current.phase);
    expect(counters(case_)).toEqual(before); expect(running.child.exitCode).toBeNull();
    expect(existsSync(join(case_.proof, 'outcome.json'))).toBe(false);
    running.child.stdin.end('release\n');
    expect(await running.closed).toBe(0);
    expect(running.output().stderr).toBe('controlled-report-barrier-ready\n');
    expect(locator(running.output().stdout)).toEqual(address);
    const result = evidence(case_).summary; const reference = strictReport(case_, result, 'published');
    expect(result.requests).toBe(24); expect(result.assessments).toBe(4); expect(count(case_, 'control')).toBe(1); expect(count(case_, 'dispose')).toBe(1);
    durableUsage(case_);
    settledObservation(case_, address, { kind: 'confirmed', deliverable: reference.locator });
  } finally {
    if (running.child.exitCode === null && running.child.signalCode === null) { running.child.kill('SIGKILL'); }
    await running.closed.catch(() => undefined);
  }
}, 60_000);
