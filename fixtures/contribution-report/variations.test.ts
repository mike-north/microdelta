/** Independent-process report variations bind current work to public committed receipts. */
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, relative, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { afterEach, beforeEach, describe, expect, test } from '@jest/globals';
import { openDurableHistory } from '@microdelta/history';
import type { ICompletedEnvelope } from '@microdelta/history';
import { createNodeClock, createNodeMachine, createNodeSqlite } from '@microdelta/machine-node';
import type { ICompletedResultReference } from 'microdelta';
import type { IControlledReport, IReportInputs } from '../../examples/contribution-report/src/controlled/application.js';
import { baseInputs } from './fixture.js';

interface IBindingAddress {
  readonly scope: string;
  readonly role: string;
  readonly slot: string;
  readonly memberKey?: string;
  readonly template?: string;
  readonly collection?: string;
}

/** A receipt is evidence of one exact reference committed or accepted in one run. */
interface ICommittedStepReceipt {
  readonly runId: string;
  readonly phase: 'publish' | 'accept';
  readonly step: IBindingAddress;
  readonly reference: ICompletedResultReference;
}

interface IVariationPerson {
  readonly key: string;
  readonly status: string;
  readonly reference?: ICompletedResultReference;
}

interface IRuntimeResolution {
  readonly application: string;
  readonly applicationSourceHash: string;
  readonly microdelta: string;
  readonly history: string;
  readonly accounting: string;
  readonly machineNode: string;
}

/** The process fixture exposes current fold membership, public event receipts, and independent transport evidence. */
interface IVariationRun {
  readonly status: 'complete' | 'incomplete';
  readonly foldStatus: string;
  readonly people: readonly IVariationPerson[];
  readonly trace: readonly string[];
  readonly requests: number;
  readonly assessments: number;
  readonly usage: { readonly attempts: number; readonly reports: number; readonly unknown: number; readonly tokens: number };
  readonly receipts: readonly ICommittedStepReceipt[];
  readonly reportReference?: ICompletedResultReference;
  readonly report?: IControlledReport;
  readonly runtime: IRuntimeResolution;
}

interface IStoredEnvelope {
  readonly value: ICompletedEnvelope;
}

interface IExactHistory {
  readonly envelope: IStoredEnvelope;
  readonly data: unknown;
}

/** Expected fixture usage accumulates independently from the child's counters across one test's process runs. */
interface IExpectedUsage { attempts: number; reports: number; unknown: number; tokens: number }

const worker = fileURLToPath(new URL('./process-worker.js', import.meta.url));
const repositoryRoot = resolve(fileURLToPath(new URL('../../../../../', import.meta.url)));
const emittedRoot = resolve(fileURLToPath(new URL('../../', import.meta.url)));
const helperApplication = 'examples/contribution-report/src/controlled/application.js';
const baselineAssessReturn = '            return validateAssessment(result);';
const helperBAssessReturn = [
  '            const validated = validateAssessment(result);',
  "            return { score: validated.score, explanation: `${validated.explanation} [helper B]` };",
].join('\n');

/** The large quiet window and still-provisional day make both current source policies refresh identically in every text case. */
const refreshInputs: IReportInputs = {
  ...baseInputs,
  settling: { ...baseInputs.settling, quietSeconds: 1_000_000, closedDay: '2025-12-31' },
};

let directory: string;
let request = 0;
let expectedUsage: IExpectedUsage;

beforeEach(() => {
  request = 0;
  expectedUsage = { attempts: 0, reports: 0, unknown: 0, tokens: 0 };
  directory = mkdtempSync(join(tmpdir(), 'controlled-report-variations-'));
});

afterEach(() => { rmSync(directory, { recursive: true, force: true }); });

/** Narrow JSON before using any report or receipt field in a test oracle. */
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** Validate a durable result locator before it crosses the independent process boundary. */
function isReference(value: unknown): value is ICompletedResultReference {
  return isRecord(value) && value.kind === 'completed-result' && typeof value.locator === 'string';
}

/** Validate descriptor identity without inferring a source or PR from event order. */
function isBindingAddress(value: unknown): value is IBindingAddress {
  return isRecord(value) && typeof value.scope === 'string' && typeof value.role === 'string' && typeof value.slot === 'string'
    && (value.memberKey === undefined || typeof value.memberKey === 'string')
    && (value.template === undefined || typeof value.template === 'string')
    && (value.collection === undefined || typeof value.collection === 'string');
}

/** Only successful public lifecycle positions can name a current result reference. */
function isReceipt(value: unknown): value is ICommittedStepReceipt {
  return isRecord(value) && typeof value.runId === 'string' && (value.phase === 'publish' || value.phase === 'accept')
    && isBindingAddress(value.step) && isReference(value.reference);
}

/** Reject incomplete worker evidence before it can be used as an acceptance oracle. */
function isVariationRun(value: unknown): value is IVariationRun {
  if (!isRecord(value)) { return false; }
  const usage = value.usage;
  const runtime = value.runtime;
  return (value.status === 'complete' || value.status === 'incomplete') && typeof value.foldStatus === 'string'
    && Array.isArray(value.people) && value.people.every(person => isRecord(person) && typeof person.key === 'string' && typeof person.status === 'string' && (person.reference === undefined || isReference(person.reference)))
    && Array.isArray(value.trace) && value.trace.every(entry => typeof entry === 'string')
    && typeof value.requests === 'number' && typeof value.assessments === 'number'
    && isRecord(usage) && ['attempts', 'reports', 'unknown', 'tokens'].every(key => typeof usage[key] === 'number')
    && Array.isArray(value.receipts) && value.receipts.every(isReceipt)
    && (value.report === undefined || isRecord(value.report))
    && isRecord(runtime) && ['application', 'applicationSourceHash', 'microdelta', 'history', 'accounting', 'machineNode'].every(key => typeof runtime[key] === 'string')
    && (value.reportReference === undefined || isReference(value.reportReference))
    && (value.status !== 'complete' || value.foldStatus === 'succeeded' && value.reportReference !== undefined);
}

/** Launch one JSON-only job; a child is a complete application and admission lifetime. */
function launch(inputs: IReportInputs, options: Readonly<Record<string, unknown>> = {}, workerPath = worker): ReturnType<typeof spawnSync> {
  request += 1;
  const job = { directory, requestKey: `variation:${String(request)}`, inputs, options };
  return spawnSync(process.execPath, [workerPath, JSON.stringify(job)], { encoding: 'utf8', timeout: 60_000 });
}

/** A valid run must carry typed fold membership and committed public step receipts. */
function run(inputs: IReportInputs = refreshInputs, options: Readonly<Record<string, unknown>> = {}, workerPath = worker): IVariationRun {
  const ledgerOffset = sends().length;
  const child = launch(inputs, options, workerPath);
  if (child.status !== 0) { throw new Error(`Controlled worker failed: ${child.stderr}`); }
  const parsed: unknown = JSON.parse(child.stdout.toString());
  if (!isVariationRun(parsed)) { throw new Error('Controlled worker omitted typed fold or committed step receipt evidence'); }
  const allSends = sends();
  const runSends = allSends.slice(ledgerOffset);
  const providerSends = allSends.filter(entry => entry.kind === 'github');
  const modelSends = allSends.filter(entry => entry.kind === 'assessment');
  expect(runSends.filter(entry => entry.kind === 'github')).toHaveLength(parsed.requests);
  expect(runSends.filter(entry => entry.kind === 'assessment')).toHaveLength(parsed.assessments);
  expect(parsed.usage).toEqual({ attempts: providerSends.length + modelSends.length, reports: modelSends.length, unknown: providerSends.length, tokens: modelSends.length * 10 });
  if (parsed.status === 'complete') {
    const selected = [...inputs.selected].sort();
    expect(parsed.foldStatus).toBe('succeeded');
    expect(parsed.people.map(person => person.key)).toEqual(selected);
    expect(parsed.people.every(person => person.status === 'succeeded' && person.reference !== undefined)).toBe(true);
    expect(parsed.report?.selected).toEqual(selected);
    expect(parsed.report?.scope).toEqual({ ...inputs.scope, repositories: [...inputs.scope.repositories].sort() });
    const reportReceipt = receiptFor(parsed, 'report', 'report');
    expect(reportReceipt.reference).toEqual(parsed.reportReference);
    if (parsed.reportReference === undefined) { throw new Error('A succeeded strict fold must expose its exact report reference'); }
    expect(exact(parsed.reportReference).data).toEqual(parsed.report);
  }
  return parsed;
}

/** Read transport and model sends written by the child, not counters derived from the report payload. */
function sends(): readonly Record<string, unknown>[] {
  const path = join(directory, 'wire-ledger.jsonl');
  if (!existsSync(path)) { return []; }
  return readFileSync(path, 'utf8').trim().split('\n').filter(line => line.length > 0).map(line => {
    const value: unknown = JSON.parse(line);
    if (!isRecord(value)) { throw new Error('Invalid fixture send ledger entry'); }
    return value;
  });
}

/** Public History reads follow the exact saved receipt reference, never a latest candidate. */
function exact(reference: ICompletedResultReference): IExactHistory {
  const history = openDurableHistory({ sqlite: createNodeSqlite(), clock: createNodeClock(), sha256: createNodeMachine(), location: join(directory, 'history.sqlite'), logicalStore: 'controlled-history' });
  try {
    const envelope = history.readEnvelope(reference);
    return { envelope: { value: envelope }, data: history.reader.readSubtree(reference, []) };
  } finally { history.close(); }
}

/** Map a slot's current lifecycle receipts by their public envelope subject. */
function referencesBySubject(runResult: IVariationRun, slot: string): ReadonlyMap<string, ICommittedStepReceipt> {
  const found = new Map<string, ICommittedStepReceipt>();
  for (const receipt of runResult.receipts) {
    if (receipt.step.slot !== slot) { continue; }
    const subject = exact(receipt.reference).envelope.value.subject;
    if (found.has(subject)) { throw new Error(`Multiple current receipts for ${slot} subject ${subject}`); }
    found.set(subject, receipt);
  }
  return found;
}

/** Read the exact immutable child result for one fixture-defined subject. */
function receiptFor(runResult: IVariationRun, slot: string, subject: string): ICommittedStepReceipt {
  const receipt = referencesBySubject(runResult, slot).get(subject);
  if (receipt === undefined) { throw new Error(`Missing current ${slot} receipt for ${subject}`); }
  return receipt;
}

/** Convert only the exact current assessment receipts to subject/reference evidence. */
function assessmentReferences(runResult: IVariationRun): ReadonlyMap<string, string> {
  return new Map([...referencesBySubject(runResult, 'assessor')].map(([subject, receipt]) => [subject, receipt.reference.locator]));
}

/** Return current exact source locators without comparing run-specific event identities. */
function sourceReferences(runResult: IVariationRun, slot: string): ReadonlyMap<string, string> {
  return new Map([...referencesBySubject(runResult, slot)].map(([subject, receipt]) => [subject, receipt.reference.locator]));
}

/** The strict fold's current member list, rather than historical candidates, defines people in this report. */
function personReferences(runResult: IVariationRun): ReadonlyMap<string, string> {
  return new Map(runResult.people.flatMap(person => person.reference === undefined ? [] : [[person.key, person.reference.locator]]));
}

/** Save whole public immutable envelopes and payloads before a variation can create newer publications. */
function snapshotsBySubject(runResult: IVariationRun, slot: string): ReadonlyMap<string, IExactHistory> {
  return new Map([...referencesBySubject(runResult, slot)].map(([subject, receipt]) => [subject, exact(receipt.reference)]));
}

/** Re-read saved locators after later writes to prove old envelopes and payloads remain immutable. */
function expectSnapshotsUnchanged(snapshots: ReadonlyMap<string, IExactHistory>): void {
  for (const snapshot of snapshots.values()) { expect(exact(snapshot.envelope.value.reference)).toEqual(snapshot); }
}

/** Fixture-keyed PR identities are independent from report order and receipt order. */
function prNumbers(selected: readonly string[]): readonly number[] {
  return selected.flatMap(key => key === 'ada' ? [101, 102] : key === 'grace' ? [201, 202] : []);
}

/** Assert independent request URLs, fresh-body versus revalidation hooks, model sends and summaries against the authored fixture. */
function expectRunEvidence(runResult: IVariationRun, sent: readonly Record<string, unknown>[], selected: readonly string[], sourceBodies: boolean, assessmentBodies: number, summaryBodies: readonly string[], sourceHookSubjects = prNumbers(selected).length): void {
  const people = [...selected].sort();
  const numbers = prNumbers(people);
  const provider = sent.filter(entry => entry.kind === 'github');
  const models = sent.filter(entry => entry.kind === 'assessment');
  const urls = provider.flatMap(entry => typeof entry.url === 'string' ? [{ entry, url: new URL(entry.url) }] : []);
  const searchUrls = urls.filter(({ url }) => url.pathname === '/search/issues');
  expect(searchUrls).toHaveLength(numbers.length);
  const createdRange = `${new Date(baseInputs.scope.start * 1000).toISOString()}..${new Date(baseInputs.scope.end * 1000 - 1000).toISOString()}`;
  for (const person of people) {
    const expectedPages = [1, 2].map(page => String(page)).sort();
    const actual = searchUrls.filter(({ url }) => (url.searchParams.get('q') ?? '').includes(`author:${person}`));
    expect(actual.map(({ url }) => url.searchParams.get('page')).sort()).toEqual(expectedPages);
    for (const { url } of actual) {
      expect(url.searchParams.get('q')).toBe(`is:pr repo:acme/widget author:${person} created:${createdRange}`);
      expect(url.searchParams.get('sort')).toBe('created');
      expect(url.searchParams.get('order')).toBe('asc');
      expect(url.searchParams.get('per_page')).toBe('100');
    }
  }
  const sourceCount = sourceBodies ? numbers.length : 0;
  const countRoute = (path: (url: URL) => boolean, accept?: string): number => urls.filter(({ entry, url }) => path(url) && (accept === undefined ? entry.accept === undefined : entry.accept === accept)).length;
  for (const number of numbers) {
    expect(countRoute(url => url.pathname === `/repos/acme/widget/pulls/${String(number)}`)).toBe(sourceBodies ? 1 : 0);
    expect(countRoute(url => url.pathname === `/repos/acme/widget/pulls/${String(number)}`, 'application/vnd.github.diff')).toBe(sourceBodies ? 1 : 0);
    expect(countRoute(url => url.pathname === `/repos/acme/widget/pulls/${String(number)}/reviews`)).toBe(sourceBodies ? 1 : 0);
    expect(countRoute(url => url.pathname === `/repos/acme/widget/issues/${String(number)}/comments`)).toBe(sourceBodies ? 1 : 0);
    expect(countRoute(url => url.pathname === `/repos/acme/widget/pulls/${String(number)}/comments`)).toBe(sourceBodies ? 1 : 0);
  }
  expect(provider).toHaveLength(numbers.length + sourceCount * 5);
  expect(models).toHaveLength(assessmentBodies);
  expect(runResult.requests).toBe(provider.length);
  expect(runResult.assessments).toBe(models.length);
  expect(runResult.status).toBe('complete');
  expect(runResult.foldStatus).toBe('succeeded');
  const expectedSubjects = numbers.map(number => `acme/widget#${String(number)}`).sort();
  expect([...referencesBySubject(runResult, 'detail').keys()].map(subject => subject.replace(/^detail:/u, '')).sort()).toEqual(expectedSubjects);
  expect([...referencesBySubject(runResult, 'discussion').keys()].map(subject => subject.replace(/^discussion:/u, '')).sort()).toEqual(expectedSubjects);
  expect([...referencesBySubject(runResult, 'assessor').keys()].map(subject => subject.replace(/^assessment:/u, '')).sort()).toEqual(expectedSubjects);
  expect([...referencesBySubject(runResult, 'summary').keys()].sort()).toEqual(people.map(person => `summary:${person}`));
  const expectedProviderSends = numbers.length + sourceCount * 5;
  expect(provider).toHaveLength(expectedProviderSends);
  const expectedModelSubjects = assessmentBodies === 0 ? [] : assessmentBodies === 1 ? ['acme/widget#101'] : numbers.map(number => `acme/widget#${String(number)}`);
  expect(models.map(entry => entry.id).sort()).toEqual(expectedModelSubjects.sort());
  expectedUsage.attempts += expectedProviderSends + assessmentBodies;
  expectedUsage.reports += assessmentBodies;
  expectedUsage.unknown += expectedProviderSends;
  expectedUsage.tokens += assessmentBodies * 10;
  expect(runResult.usage).toEqual(expectedUsage);
  for (const person of people) {
    expect(runResult.trace.filter(event => event === `search-start:${person}`)).toHaveLength(1);
    expect(runResult.trace.filter(event => event === `search-complete:${person}`)).toHaveLength(1);
  }
  // Acceptance hooks validate prior sources; a first-run publication has no previous envelope to accept.
  expect(runResult.trace.filter(event => /^(?:detail|discussion)-hook:/u.test(event))).toHaveLength(sourceHookSubjects * 2);
  expect(runResult.trace.filter(event => /^detail-hook:/u.test(event))).toHaveLength(sourceHookSubjects);
  expect(runResult.trace.filter(event => /^discussion-hook:/u.test(event))).toHaveLength(sourceHookSubjects);
  expect(runResult.trace.filter(event => /^detail-body:/u.test(event))).toHaveLength(sourceCount);
  expect(runResult.trace.filter(event => /^discussion-body:/u.test(event))).toHaveLength(sourceCount);
  expect(runResult.trace.filter(event => /^assessment-body:/u.test(event))).toHaveLength(assessmentBodies);
  expect(runResult.trace.filter(event => /^summary-body:/u.test(event))).toEqual(summaryBodies.map(person => `summary-body:${person}`));
}

/** Assert one cold and one identical-process control before a controlled variation. */
function establishUnchangedControl(inputs: IReportInputs = refreshInputs, workerPath = worker, expectUnchangedSourceBodies = true): { readonly cold: IVariationRun; readonly unchanged: IVariationRun } {
  const sendsBeforeCold = sends().length;
  const cold = run(inputs, {}, workerPath);
  expectRunEvidence(cold, sends().slice(sendsBeforeCold), inputs.selected, true, 4, inputs.selected, 0);
  const sendsBeforeUnchanged = sends().length;
  const unchanged = run(inputs, {}, workerPath);
  expectRunEvidence(unchanged, sends().slice(sendsBeforeUnchanged), inputs.selected, expectUnchangedSourceBodies, 0, []);
  expect(cold.status).toBe('complete');
  expect(cold.foldStatus).toBe('succeeded');
  expect(unchanged.status).toBe('complete');
  expect(unchanged.foldStatus).toBe('succeeded');
  expect(unchanged.trace.filter(event => /^(?:detail|discussion)-hook:/u.test(event))).toHaveLength(8);
  expect(unchanged.trace.filter(event => /^(?:detail|discussion)-body:/u.test(event))).toHaveLength(expectUnchangedSourceBodies ? 8 : 0);
  expect(unchanged.trace.filter(event => /^(?:assessment|summary)-body:/u.test(event))).toEqual([]);
  expect(unchanged.assessments).toBe(0);
  expect(sends().slice(sendsBeforeUnchanged).filter(entry => entry.kind === 'assessment')).toEqual([]);
  expect(assessmentReferences(unchanged)).toEqual(assessmentReferences(cold));
  expect(personReferences(unchanged)).toEqual(personReferences(cold));
  expect([...referencesBySubject(unchanged, 'assessor').values()].every(receipt => receipt.phase === 'accept')).toBe(true);
  expect([...referencesBySubject(unchanged, 'summary').values()].every(receipt => receipt.phase === 'accept')).toBe(true);
  expect([...referencesBySubject(cold, 'assessor').values()].every(receipt => receipt.phase === 'publish')).toBe(true);
  expect([...referencesBySubject(cold, 'detail').values()].every(receipt => receipt.phase === 'publish')).toBe(true);
  expect([...referencesBySubject(cold, 'discussion').values()].every(receipt => receipt.phase === 'publish')).toBe(true);
  expect([...referencesBySubject(unchanged, 'detail').values()].every(receipt => receipt.phase === (expectUnchangedSourceBodies ? 'publish' : 'accept'))).toBe(true);
  expect([...referencesBySubject(unchanged, 'discussion').values()].every(receipt => receipt.phase === (expectUnchangedSourceBodies ? 'publish' : 'accept'))).toBe(true);
  expect(receiptFor(cold, 'report', 'report').phase).toBe('publish');
  expect(receiptFor(unchanged, 'report', 'report').phase).toBe('accept');
  expect(exact(receiptFor(cold, 'detail', 'detail:acme/widget#101').reference).envelope.value.subject).toBe('detail:acme/widget#101');
  return { cold, unchanged };
}

/** Hash every copied file so the helper deployment differs only in its intended method body. */
function manifest(root: string): ReadonlyMap<string, string> {
  const result = new Map<string, string>();
  const visit = (directoryPath: string): void => {
    for (const entry of readdirSync(directoryPath, { withFileTypes: true })) {
      const path = join(directoryPath, entry.name);
      if (entry.isDirectory()) { visit(path); }
      else if (entry.isFile()) { result.set(relative(root, path), createHash('sha256').update(readFileSync(path)).digest('hex')); }
    }
  };
  visit(root);
  return result;
}

/** Build an isolated ESM worker/application graph; its package imports still resolve through the public workspace packages. */
function applicationGraph(name: string): { readonly worker: string; readonly root: string; readonly manifest: ReadonlyMap<string, string> } {
  const root = join(directory, 'graphs', name);
  const fixtureSource = join(emittedRoot, 'fixtures/contribution-report');
  const exampleSource = join(emittedRoot, 'examples/contribution-report');
  mkdirSync(join(root, 'fixtures'), { recursive: true });
  mkdirSync(join(root, 'examples'), { recursive: true });
  const fixtureTarget = join(root, 'fixtures/contribution-report');
  const exampleTarget = join(root, 'examples/contribution-report');
  copyTree(fixtureSource, fixtureTarget);
  copyTree(exampleSource, exampleTarget);
  copyFileSync(join(repositoryRoot, 'package.json'), join(root, 'package.json'));
  symlinkSync(join(repositoryRoot, 'node_modules'), join(root, 'node_modules'), 'dir');
  const graphManifest = manifest(root);
  return { worker: join(fixtureTarget, 'process-worker.js'), root, manifest: graphManifest };
}

/** Change one exact emitted helper return only after an unchanged copy has run through this same path. */
function replaceHelperBody(root: string): void {
  const applicationPath = join(root, helperApplication);
  const original = readFileSync(applicationPath, 'utf8');
  if (original.split(baselineAssessReturn).length !== 2) { throw new Error('Expected exactly one emitted assess return for the helper artifact'); }
  writeFileSync(applicationPath, original.replace(baselineAssessReturn, helperBAssessReturn));
}

/** Extract the one emitted assess method body so artifact comparison targets code invoked by the supplied helper. */
function emittedAssessMethod(path: string): string {
  const source = readFileSync(path, 'utf8');
  const methods = [...source.matchAll(/        async assess\([\s\S]*?\n        \},(?=\n        summary\()/gu)];
  if (methods.length !== 1) { throw new Error(`Expected one emitted helpers.assess method, found ${String(methods.length)}`); }
  const method = methods[0]?.[0];
  if (method === undefined) { throw new Error('The emitted helpers.assess method was not captured'); }
  return method.slice(0, method.lastIndexOf('\n        },'));
}

/** Recursively copy only compiler-emitted fixture-owned files into one disposable application graph. */
function copyTree(source: string, target: string): void {
  mkdirSync(target, { recursive: true });
  for (const entry of readdirSync(source, { withFileTypes: true })) {
    const from = join(source, entry.name);
    const to = join(target, entry.name);
    if (entry.isDirectory()) { copyTree(from, to); }
    else if (entry.isFile()) { copyFileSync(from, to); }
  }
}

/** Compile each isolated graph's generated alpha declarations against the same public package exports. */
function checkGraphDeclarations(root: string): void {
  writeFileSync(join(root, 'variant-types.ts'), [
    "import type { IReportApplication } from './examples/contribution-report/src/controlled/application.js';",
    "import type { IRunEvent } from 'microdelta';",
    'export type IGraphDeclarationProof = { readonly application: IReportApplication; readonly event: IRunEvent };',
    '',
  ].join('\n'));
  const packages = ['microdelta', '@microdelta/accounting', '@microdelta/definition', '@microdelta/history', '@microdelta/machine', '@microdelta/machine-node', '@microdelta/materialization', '@microdelta/resolution', '@microdelta/supervision', '@microdelta/tracking', '@microdelta/value'];
  const paths = Object.fromEntries(packages.map(name => [name, [relative(root, join(repositoryRoot, 'node_modules', name, 'dist', 'api', `${name.replace(/^@microdelta\//u, '')}.alpha.d.ts`))]]));
  paths.microdelta = [relative(root, join(repositoryRoot, 'node_modules/microdelta/dist/api/microdelta.alpha.d.ts'))];
  writeFileSync(join(root, 'variant-tsconfig.json'), JSON.stringify({
    compilerOptions: { target: 'ES2022', module: 'NodeNext', moduleResolution: 'NodeNext', strict: true, noEmit: true, skipLibCheck: false, types: [], baseUrl: '.', paths },
    files: ['./variant-types.ts'],
  }));
  const tsc = join(repositoryRoot, 'node_modules/typescript/bin/tsc');
  const result = spawnSync(process.execPath, [tsc, '-p', join(root, 'variant-tsconfig.json')], { encoding: 'utf8', timeout: 60_000 });
  if (result.status !== 0) { throw new Error(`Isolated generated declaration resolution failed: ${result.stdout}${result.stderr}`); }
}

/** Read the independent child ledger before and after a preflight refusal. */
function ledgerLength(): number { return sends().length; }

describe('controlled report variation oracles', () => {
  test('unchanged independent-process control exposes exact current step references', () => {
    const { cold, unchanged } = establishUnchangedControl();
    expect(cold.receipts.length).toBeGreaterThan(0);
    expect(unchanged.receipts.every(receipt => receipt.runId !== '')).toBe(true);
    expect(unchanged.foldStatus).toBe('succeeded');
    expect(unchanged.report?.selected).toEqual(['ada', 'grace']);
    expect(receiptFor(unchanged, 'report', 'report').phase).toBe('accept');
  });

  test('one consumed PR diff refreshes one assessment and Ada summary only', () => {
    const { cold } = establishUnchangedControl();
    const oldSnapshots = ['detail', 'discussion', 'assessor', 'summary', 'report'].map(slot => snapshotsBySubject(cold, slot));
    const priorAssessments = assessmentReferences(cold);
    const priorPeople = personReferences(cold);
    const priorDetail = receiptFor(cold, 'detail', 'detail:acme/widget#101');
    const sendsBeforeChanged = sends().length;
    const changed = run(refreshInputs, { diffs: { '101': '+ major widget redesign' } });
    const changedSends = sends().slice(sendsBeforeChanged);
    expectRunEvidence(changed, changedSends, refreshInputs.selected, true, 1, ['ada']);

    expect(changed.status).toBe('complete');
    expect(changed.foldStatus).toBe('succeeded');
    expect(changed.trace.filter(event => event === 'assessment-body:acme/widget#101')).toHaveLength(1);
    expect(changed.trace.filter(event => event.startsWith('assessment-body:'))).toHaveLength(1);
    expect(changed.trace.filter(event => event.startsWith('summary-body:'))).toEqual(['summary-body:ada']);
    expect(changed.assessments).toBe(1);
    expect(changedSends.filter(entry => entry.kind === 'assessment')).toHaveLength(1);
    expect(changedSends.filter(entry => entry.kind === 'assessment')).toContainEqual(expect.objectContaining({ id: 'acme/widget#101', diff: '+ major widget redesign' }));
    const changedAssessments = assessmentReferences(changed);
    expect(changedAssessments.size).toBe(4);
    expect(changedAssessments.get('assessment:acme/widget#101')).not.toBe(priorAssessments.get('assessment:acme/widget#101'));
    for (const number of [102, 201, 202]) {
      expect(changedAssessments.get(`assessment:acme/widget#${String(number)}`)).toBe(priorAssessments.get(`assessment:acme/widget#${String(number)}`));
    }
    const changedPeople = personReferences(changed);
    expect(changedPeople.get('ada')).not.toBe(priorPeople.get('ada'));
    expect(changedPeople.get('grace')).toBe(priorPeople.get('grace'));
    expect(exact(receiptFor(cold, 'assessor', 'assessment:acme/widget#101').reference).data).toMatchObject({ score: 2 });
    const changedAssessment = exact(receiptFor(changed, 'assessor', 'assessment:acme/widget#101').reference);
    expect(changedAssessment.data).toMatchObject({ score: 3 });
    expect(changedAssessment.envelope.value.provenance).not.toEqual(exact(receiptFor(cold, 'assessor', 'assessment:acme/widget#101').reference).envelope.value.provenance);
    expect(receiptFor(changed, 'assessor', 'assessment:acme/widget#101').phase).toBe('publish');
    expect(changed.report?.people.map(person => [person.key, person.score])).toEqual([['ada', 5], ['grace', 4]]);
    const currentDetailRefs = referencesBySubject(changed, 'detail');
    const baselineDetailRefs = referencesBySubject(cold, 'detail');
    expect([...currentDetailRefs.keys()].sort()).toEqual([...baselineDetailRefs.keys()].sort());
    for (const [subject, receipt] of currentDetailRefs) {
      expect(receipt.phase).toBe('publish');
      expect(receipt.reference.locator).not.toBe(baselineDetailRefs.get(subject)?.reference.locator);
    }
    const currentDiscussionRefs = referencesBySubject(changed, 'discussion');
    expect([...currentDiscussionRefs.keys()].sort()).toEqual([...referencesBySubject(cold, 'discussion').keys()].sort());
    const baselineDiscussionRefs = referencesBySubject(cold, 'discussion');
    for (const [subject, receipt] of currentDiscussionRefs) {
      expect(receipt.phase).toBe('publish');
      expect(receipt.reference.locator).not.toBe(baselineDiscussionRefs.get(subject)?.reference.locator);
    }
    expect(receiptFor(changed, 'summary', 'summary:ada').phase).toBe('publish');
    expect(receiptFor(changed, 'summary', 'summary:grace').phase).toBe('accept');
    expect(receiptFor(changed, 'report', 'report').reference).not.toEqual(receiptFor(cold, 'report', 'report').reference);
    expect(exact(priorDetail.reference).data).toMatchObject({ diff: '+ widget fix' });
    expect(exact(receiptFor(changed, 'detail', 'detail:acme/widget#101').reference).data).toMatchObject({ diff: '+ major widget redesign' });
    for (const snapshots of oldSnapshots) { expectSnapshotsUnchanged(snapshots); }
  });

  test('one submitted review body refreshes one assessment while equal scores retain both summaries', () => {
    const { cold } = establishUnchangedControl();
    const oldSnapshots = ['detail', 'discussion', 'assessor', 'summary', 'report'].map(slot => snapshotsBySubject(cold, slot));
    const priorAssessments = assessmentReferences(cold);
    const priorPeople = personReferences(cold);
    const priorDiscussion = receiptFor(cold, 'discussion', 'discussion:acme/widget#101');
    const sendsBeforeChanged = sends().length;
    const changed = run(refreshInputs, { reviews: { '101': 'A newly submitted body with one changed sentence.' } });
    const changedSends = sends().slice(sendsBeforeChanged);
    expectRunEvidence(changed, changedSends, refreshInputs.selected, true, 1, []);

    expect(changed.status).toBe('complete');
    expect(changed.trace.filter(event => event.startsWith('assessment-body:'))).toEqual(['assessment-body:acme/widget#101']);
    expect(changed.trace.filter(event => event.startsWith('summary-body:'))).toEqual([]);
    expect(changed.assessments).toBe(1);
    const sendsAfter = changedSends.filter(entry => entry.kind === 'assessment');
    expect(sendsAfter).toHaveLength(1);
    expect(sendsAfter).toContainEqual(expect.objectContaining({ id: 'acme/widget#101', reviewBodies: ['A newly submitted body with one changed sentence.'] }));
    const changedAssessments = assessmentReferences(changed);
    expect(changedAssessments.get('assessment:acme/widget#101')).not.toBe(priorAssessments.get('assessment:acme/widget#101'));
    for (const number of [102, 201, 202]) {
      expect(changedAssessments.get(`assessment:acme/widget#${String(number)}`)).toBe(priorAssessments.get(`assessment:acme/widget#${String(number)}`));
    }
    expect(personReferences(changed)).toEqual(priorPeople);
    expect([...referencesBySubject(changed, 'summary').values()].every(receipt => receipt.phase === 'accept')).toBe(true);
    expect(receiptFor(changed, 'report', 'report').phase).toBe('accept');
    expect(changed.report?.people.map(person => [person.key, person.score])).toEqual([['ada', 4], ['grace', 4]]);
    expect(exact(receiptFor(cold, 'assessor', 'assessment:acme/widget#101').reference).data).toMatchObject({ score: 2 });
    const priorAssessment = exact(receiptFor(cold, 'assessor', 'assessment:acme/widget#101').reference);
    const currentAssessment = exact(receiptFor(changed, 'assessor', 'assessment:acme/widget#101').reference);
    expect(priorAssessment.data).toMatchObject({ score: 2 });
    expect(currentAssessment.data).toMatchObject({ score: 2 });
    expect(currentAssessment.envelope.value.provenance).not.toEqual(priorAssessment.envelope.value.provenance);
    const currentDiscussions = referencesBySubject(changed, 'discussion');
    const baselineDiscussions = referencesBySubject(cold, 'discussion');
    expect([...currentDiscussions.keys()].sort()).toEqual([...baselineDiscussions.keys()].sort());
    for (const [subject, receipt] of currentDiscussions) {
      expect(receipt.phase).toBe('publish');
      expect(receipt.reference.locator).not.toBe(baselineDiscussions.get(subject)?.reference.locator);
    }
    const currentDetails = referencesBySubject(changed, 'detail');
    const baselineDetails = referencesBySubject(cold, 'detail');
    expect([...currentDetails.keys()].sort()).toEqual([...baselineDetails.keys()].sort());
    for (const [subject, receipt] of currentDetails) {
      expect(receipt.phase).toBe('publish');
      expect(receipt.reference.locator).not.toBe(baselineDetails.get(subject)?.reference.locator);
    }
    expect(receiptFor(changed, 'assessor', 'assessment:acme/widget#101').phase).toBe('publish');
    expect(exact(priorDiscussion.reference).data).toMatchObject({ reviews: [{ id: 101, body: 'Review evidence', author: 'reviewer', at: expect.any(Number) }] });
    expect(exact(receiptFor(changed, 'discussion', 'discussion:acme/widget#101').reference).data).toMatchObject({ reviews: [{ id: 101, body: 'A newly submitted body with one changed sentence.', author: 'reviewer', at: expect.any(Number) }] });
    for (const snapshots of oldSnapshots) { expectSnapshotsUnchanged(snapshots); }
  });

  test('current HR name changes refresh one person and deactivation removes Grace from current membership', () => {
    const { cold } = establishUnchangedControl(baseInputs, worker, false);
    const oldSnapshots = ['roster', 'search', 'discussion', 'detail', 'assessor', 'summary', 'report'].map(slot => snapshotsBySubject(cold, slot));
    const priorAssessments = assessmentReferences(cold);
    const priorPeople = personReferences(cold);
    const renamedCsv = baseInputs.csv.replace('ada,ada,Ada,true', 'ada,ada,Ada Lovelace,true');
    const sendsBeforeRename = sends().length;
    const renamed = run({ ...baseInputs, csv: renamedCsv });
    expectRunEvidence(renamed, sends().slice(sendsBeforeRename), baseInputs.selected, false, 0, ['ada']);
    expect(renamed.status).toBe('complete');
    expect(renamed.foldStatus).toBe('succeeded');
    expect(renamed.report?.people.map(person => [person.key, person.name])).toEqual([['ada', 'Ada Lovelace'], ['grace', 'Grace']]);
    expect(renamed.trace.filter(event => event.startsWith('summary-body:'))).toEqual(['summary-body:ada']);
    expect(personReferences(renamed).get('ada')).not.toBe(priorPeople.get('ada'));
    expect(personReferences(renamed).get('grace')).toBe(priorPeople.get('grace'));
    expect(assessmentReferences(renamed)).toEqual(priorAssessments);
    expect(sourceReferences(renamed, 'detail')).toEqual(sourceReferences(cold, 'detail'));
    expect(sourceReferences(renamed, 'discussion')).toEqual(sourceReferences(cold, 'discussion'));
    expect([...referencesBySubject(renamed, 'detail').values()].every(receipt => receipt.phase === 'accept')).toBe(true);
    expect([...referencesBySubject(renamed, 'discussion').values()].every(receipt => receipt.phase === 'accept')).toBe(true);
    const renamedRoster = receiptFor(renamed, 'roster', 'selected-people');
    expect(renamedRoster.phase).toBe('publish');
    expect(renamedRoster.reference).not.toEqual(receiptFor(cold, 'roster', 'selected-people').reference);
    expect(exact(renamedRoster.reference).data).toMatchObject({ members: [{ key: 'ada', name: 'Ada Lovelace' }, { key: 'grace', name: 'Grace' }] });
    expect(receiptFor(renamed, 'summary', 'summary:ada').phase).toBe('publish');
    expect(receiptFor(renamed, 'summary', 'summary:grace').phase).toBe('accept');

    const inactiveCsv = renamedCsv.replace('grace,grace,Grace,true', 'grace,grace,Grace,false');
    const beforeRefusal = ledgerLength();
    const refused = launch({ ...baseInputs, csv: inactiveCsv });
    expect(refused.status).not.toBe(0);
    expect(refused.stderr.toString()).toContain('invalid selection');
    expect(ledgerLength()).toBe(beforeRefusal);
    const graceHistory = receiptFor(renamed, 'summary', 'summary:grace').reference;
    const beforeAllowed = sends().length;
    const allowed = run({ ...baseInputs, csv: inactiveCsv, selected: ['ada'] });
    const afterAllowed = sends().slice(beforeAllowed);
    expectRunEvidence(allowed, afterAllowed, ['ada'], false, 0, []);
    expect(allowed.status).toBe('complete');
    expect(allowed.foldStatus).toBe('succeeded');
    expect(allowed.report?.selected).toEqual(['ada']);
    expect(allowed.report?.scope).toEqual({ ...baseInputs.scope, repositories: ['acme/widget'] });
    expect(allowed.people.map(person => person.key)).toEqual(['ada']);
    expect(allowed.people.every(person => person.status === 'succeeded' && person.reference !== undefined)).toBe(true);
    expect(personReferences(allowed).get('ada')).toBe(personReferences(renamed).get('ada'));
    expect(assessmentReferences(allowed)).toEqual(new Map([...priorAssessments].filter(([subject]) => subject.endsWith('#101') || subject.endsWith('#102'))));
    expect(sourceReferences(allowed, 'detail')).toEqual(new Map([...sourceReferences(renamed, 'detail')].filter(([subject]) => subject.endsWith('#101') || subject.endsWith('#102'))));
    expect(sourceReferences(allowed, 'discussion')).toEqual(new Map([...sourceReferences(renamed, 'discussion')].filter(([subject]) => subject.endsWith('#101') || subject.endsWith('#102'))));
    expect(allowed.trace.some(event => /(?:grace|#20[12])/u.test(event))).toBe(false);
    expect(afterAllowed.some(entry => entry.kind === 'assessment' || typeof entry.url === 'string' && /(?:author%3Agrace|pulls\/(?:201|202)|issues\/(?:201|202))/u.test(entry.url))).toBe(false);
    expect(exact(graceHistory).envelope.value.subject).toBe('summary:grace');
    for (const snapshots of oldSnapshots) { expectSnapshotsUnchanged(snapshots); }
    expect(referencesBySubject(allowed, 'summary').has('summary:grace')).toBe(false);
  });

  test('actual called helper code changes between isolated ESM graphs and invalidates all shared assessments', () => {
    const baseGraph = applicationGraph('helper-base');
    const copiedGraph = applicationGraph('helper-copy');
    checkGraphDeclarations(baseGraph.root);
    checkGraphDeclarations(copiedGraph.root);
    const baseManifest = manifest(baseGraph.root);
    const copiedManifest = manifest(copiedGraph.root);
    expect([...baseManifest.keys()].sort()).toEqual([...copiedManifest.keys()].sort());
    expect(copiedManifest).toEqual(baseManifest);
    const originalMethod = emittedAssessMethod(join(copiedGraph.root, helperApplication));
    expect(originalMethod).toContain(baselineAssessReturn);
    const { cold, unchanged } = establishUnchangedControl(baseInputs, baseGraph.worker, false);
    expect(cold.runtime.application).toBe(pathToFileURL(realpathSync(join(baseGraph.root, helperApplication))).href);
    expect(cold.runtime.applicationSourceHash).toBe(baseGraph.manifest.get(helperApplication));
    expect(unchanged.runtime.application).toBe(cold.runtime.application);
    expect(unchanged.runtime.applicationSourceHash).toBe(cold.runtime.applicationSourceHash);
    const unchangedOffset = sends().length;
    const copiedUnchanged = run(baseInputs, {}, copiedGraph.worker);
    const copiedUnchangedSends = sends().slice(unchangedOffset);
    expectRunEvidence(copiedUnchanged, copiedUnchangedSends, baseInputs.selected, false, 0, []);
    expect(copiedUnchanged.runtime.application).toBe(pathToFileURL(realpathSync(join(copiedGraph.root, helperApplication))).href);
    expect(copiedUnchanged.runtime.applicationSourceHash).toBe(copiedGraph.manifest.get(helperApplication));
    expect(copiedUnchanged.runtime.application).not.toBe(cold.runtime.application);
    expect(copiedUnchanged.runtime.microdelta).toBe(cold.runtime.microdelta);
    expect(copiedUnchanged.runtime.history).toBe(cold.runtime.history);
    expect(copiedUnchanged.runtime.accounting).toBe(cold.runtime.accounting);
    expect(copiedUnchanged.runtime.machineNode).toBe(cold.runtime.machineNode);
    expect(copiedUnchanged.runtime.applicationSourceHash).toBe(cold.runtime.applicationSourceHash);
    expect(assessmentReferences(copiedUnchanged)).toEqual(assessmentReferences(cold));
    expect(personReferences(copiedUnchanged)).toEqual(personReferences(cold));
    expect(sourceReferences(copiedUnchanged, 'detail')).toEqual(sourceReferences(cold, 'detail'));
    expect(sourceReferences(copiedUnchanged, 'discussion')).toEqual(sourceReferences(cold, 'discussion'));
    expect([...referencesBySubject(copiedUnchanged, 'detail').values()].every(receipt => receipt.phase === 'accept')).toBe(true);
    expect([...referencesBySubject(copiedUnchanged, 'discussion').values()].every(receipt => receipt.phase === 'accept')).toBe(true);
    const oldSnapshots = ['detail', 'discussion', 'assessor', 'summary', 'report'].map(slot => snapshotsBySubject(cold, slot));
    const priorAssessments = assessmentReferences(cold);
    const priorPeople = personReferences(cold);
    replaceHelperBody(copiedGraph.root);
    const helperManifest = manifest(copiedGraph.root);
    const changedPaths = [...baseManifest.keys()].filter(path => baseManifest.get(path) !== helperManifest.get(path));
    expect([...baseManifest.keys()].sort()).toEqual([...helperManifest.keys()].sort());
    expect(changedPaths).toEqual([helperApplication]);
    const changedMethod = emittedAssessMethod(join(copiedGraph.root, helperApplication));
    expect(changedMethod).toBe(originalMethod.replace(baselineAssessReturn, helperBAssessReturn));
    const sendsBeforeChanged = sends().length;
    const changed = run(baseInputs, {}, copiedGraph.worker);
    const changedSends = sends().slice(sendsBeforeChanged);
    expectRunEvidence(changed, changedSends, baseInputs.selected, false, 4, []);

    expect(changed.status).toBe('complete');
    expect(changed.foldStatus).toBe('succeeded');
    expect(changed.runtime.application).toBe(pathToFileURL(realpathSync(join(copiedGraph.root, helperApplication))).href);
    expect(changed.runtime.application).toBe(copiedUnchanged.runtime.application);
    expect(changed.runtime.applicationSourceHash).toBe(helperManifest.get(helperApplication));
    expect(changed.runtime.applicationSourceHash).not.toBe(copiedUnchanged.runtime.applicationSourceHash);
    expect(changed.runtime.microdelta).toBe(cold.runtime.microdelta);
    expect(changed.runtime.history).toBe(cold.runtime.history);
    expect(changed.runtime.accounting).toBe(cold.runtime.accounting);
    expect(changed.runtime.machineNode).toBe(cold.runtime.machineNode);
    expect(changed.trace.filter(event => event.startsWith('assessment-body:'))).toHaveLength(4);
    expect(changed.assessments).toBe(4);
    const helperSends = changedSends.filter(entry => entry.kind === 'assessment');
    expect(helperSends).toHaveLength(4);
    expect(helperSends.every(entry => isRecord(entry.prompt) && entry.prompt.helperVersion === 'rubric-a')).toBe(true);
    expect(changed.report?.people.map(person => [person.key, person.score])).toEqual([['ada', 4], ['grace', 4]]);
    const changedAssessments = assessmentReferences(changed);
    expect(changedAssessments.size).toBe(4);
    for (const [subject, reference] of changedAssessments) {
      expect(reference).not.toBe(priorAssessments.get(subject));
      const currentAssessor = exact(receiptFor(changed, 'assessor', subject).reference);
      expect(currentAssessor.data).toEqual({ score: 2, explanation: 'Synthetic assessment [helper B]' });
      expect(currentAssessor.envelope.value.provenance).not.toEqual(exact(receiptFor(cold, 'assessor', subject).reference).envelope.value.provenance);
    }
    expect(personReferences(changed)).toEqual(priorPeople);
    expect([...referencesBySubject(changed, 'summary').values()].every(receipt => receipt.phase === 'accept')).toBe(true);
    expect([...referencesBySubject(changed, 'detail').values()].every(receipt => receipt.phase === 'accept')).toBe(true);
    expect([...referencesBySubject(changed, 'discussion').values()].every(receipt => receipt.phase === 'accept')).toBe(true);
    expect(sourceReferences(changed, 'detail')).toEqual(sourceReferences(copiedUnchanged, 'detail'));
    expect(sourceReferences(changed, 'discussion')).toEqual(sourceReferences(copiedUnchanged, 'discussion'));
    expect(changed.trace.filter(event => event.startsWith('summary-body:'))).toEqual([]);
    expect(changed.trace.filter(event => event.startsWith('detail-body:'))).toEqual([]);
    expect(changed.trace.filter(event => event.startsWith('discussion-body:'))).toEqual([]);

    const sendsBeforeRetained = sends().length;
    const retainedHelperB = run(baseInputs, {}, copiedGraph.worker);
    const retainedSends = sends().slice(sendsBeforeRetained);
    expectRunEvidence(retainedHelperB, retainedSends, baseInputs.selected, false, 0, []);
    expect(assessmentReferences(retainedHelperB)).toEqual(changedAssessments);
    expect(retainedHelperB.assessments).toBe(0);
    expect(retainedHelperB.trace.filter(event => event.startsWith('assessment-body:'))).toEqual([]);
    for (const snapshots of oldSnapshots) { expectSnapshotsUnchanged(snapshots); }
    expect(retainedSends.filter(entry => entry.kind === 'assessment')).toEqual([]);
  });
});
