/** Independent-process report variations bind current work to public committed receipts. */
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, relative, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { afterEach, beforeEach, describe, expect, test } from '@jest/globals';
import { openDurableHistory } from '@microdelta/history';
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
  readonly microdelta: string;
  readonly history: string;
  readonly accounting: string;
  readonly machine: string;
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
  readonly report?: IControlledReport;
  readonly runtime: IRuntimeResolution;
}

interface IStoredEnvelope {
  readonly reference: ICompletedResultReference;
  readonly subject: string;
  readonly provenance: unknown;
}

interface IExactHistory {
  readonly envelope: IStoredEnvelope;
  readonly data: unknown;
}

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

beforeEach(() => {
  request = 0;
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
    && isRecord(runtime) && ['application', 'microdelta', 'history', 'accounting', 'machine'].every(key => typeof runtime[key] === 'string');
}

/** Launch one JSON-only job; a child is a complete application and admission lifetime. */
function launch(inputs: IReportInputs, options: Readonly<Record<string, unknown>> = {}, workerPath = worker): ReturnType<typeof spawnSync> {
  request += 1;
  const job = { directory, requestKey: `variation:${String(request)}`, inputs, options };
  return spawnSync(process.execPath, [workerPath, JSON.stringify(job)], { encoding: 'utf8', timeout: 60_000 });
}

/** A valid run must carry typed fold membership and committed public step receipts. */
function run(inputs: IReportInputs = refreshInputs, options: Readonly<Record<string, unknown>> = {}, workerPath = worker): IVariationRun {
  const child = launch(inputs, options, workerPath);
  if (child.status !== 0) { throw new Error(`Controlled worker failed: ${child.stderr}`); }
  const parsed: unknown = JSON.parse(child.stdout.toString());
  if (!isVariationRun(parsed)) { throw new Error('Controlled worker omitted typed fold or committed step receipt evidence'); }
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
    return { envelope: { reference: envelope.reference, subject: envelope.subject, provenance: envelope.provenance }, data: history.reader.readSubtree(reference, []) };
  } finally { history.close(); }
}

/** Map a slot's current lifecycle receipts by their public envelope subject. */
function referencesBySubject(runResult: IVariationRun, slot: string): ReadonlyMap<string, ICommittedStepReceipt> {
  const found = new Map<string, ICommittedStepReceipt>();
  for (const receipt of runResult.receipts) {
    if (receipt.step.slot !== slot) { continue; }
    const subject = exact(receipt.reference).envelope.subject;
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

/** The strict fold's current member list, rather than historical candidates, defines people in this report. */
function personReferences(runResult: IVariationRun): ReadonlyMap<string, string> {
  return new Map(runResult.people.flatMap(person => person.reference === undefined ? [] : [[person.key, person.reference.locator]]));
}

/** Assert one cold and one identical-process control before a controlled variation. */
function establishUnchangedControl(inputs: IReportInputs = refreshInputs, expectDetailBodies = true): { readonly cold: IVariationRun; readonly unchanged: IVariationRun } {
  const cold = run(inputs);
  const sendsBeforeUnchanged = sends().length;
  const unchanged = run(inputs);
  expect(cold.status).toBe('complete');
  expect(cold.foldStatus).toBe('succeeded');
  expect(unchanged.status).toBe('complete');
  expect(unchanged.foldStatus).toBe('succeeded');
  expect(unchanged.trace.filter(event => /^(?:detail|discussion)-hook:/u.test(event))).toHaveLength(8);
  expect(unchanged.trace.filter(event => /^(?:detail|discussion)-body:/u.test(event))).toHaveLength(expectDetailBodies ? 8 : 0);
  expect(unchanged.trace.filter(event => /^(?:assessment|summary)-body:/u.test(event))).toEqual([]);
  expect(unchanged.assessments).toBe(0);
  expect(sends().slice(sendsBeforeUnchanged).filter(entry => entry.kind === 'assessment')).toEqual([]);
  expect(assessmentReferences(unchanged)).toEqual(assessmentReferences(cold));
  expect(personReferences(unchanged)).toEqual(personReferences(cold));
  expect([...referencesBySubject(unchanged, 'assessor').values()].every(receipt => receipt.phase === 'accept')).toBe(true);
  expect([...referencesBySubject(unchanged, 'summary').values()].every(receipt => receipt.phase === 'accept')).toBe(true);
  expect([...referencesBySubject(cold, 'assessor').values()].every(receipt => receipt.phase === 'publish')).toBe(true);
  expect(exact(receiptFor(cold, 'detail', 'detail:acme/widget#101').reference).envelope.subject).toBe('detail:acme/widget#101');
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
function applicationGraph(name: string, helperB: boolean): { readonly worker: string; readonly root: string; readonly manifest: ReadonlyMap<string, string> } {
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
  const applicationPath = join(root, helperApplication);
  if (helperB) {
    const original = readFileSync(applicationPath, 'utf8');
    if (original.split(baselineAssessReturn).length !== 2) { throw new Error('Expected exactly one emitted assess return for the helper artifact'); }
    writeFileSync(applicationPath, original.replace(baselineAssessReturn, helperBAssessReturn));
  }
  const graphManifest = manifest(root);
  return { worker: join(fixtureTarget, 'process-worker.js'), root, manifest: graphManifest };
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
    const priorAssessments = assessmentReferences(cold);
    const priorPeople = personReferences(cold);
    const priorDetail = receiptFor(cold, 'detail', 'detail:acme/widget#101');
    const sendsBeforeChanged = sends().length;
    const changed = run(refreshInputs, { diffs: { '101': '+ major widget redesign' } });
    const changedSends = sends().slice(sendsBeforeChanged);

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
    expect(exact(receiptFor(changed, 'assessor', 'assessment:acme/widget#101').reference).data).toMatchObject({ score: 3 });
    expect(changed.report?.people.map(person => [person.key, person.score])).toEqual([['ada', 5], ['grace', 4]]);
    expect(exact(priorDetail.reference).data).toMatchObject({ diff: '+ widget fix' });
    expect(exact(receiptFor(changed, 'detail', 'detail:acme/widget#101').reference).data).toMatchObject({ diff: '+ major widget redesign' });
  });

  test('one submitted review body refreshes one assessment while equal scores retain both summaries', () => {
    const { cold } = establishUnchangedControl();
    const priorAssessments = assessmentReferences(cold);
    const priorPeople = personReferences(cold);
    const priorDiscussion = receiptFor(cold, 'discussion', 'discussion:acme/widget#101');
    const sendsBeforeChanged = sends().length;
    const changed = run(refreshInputs, { reviews: { '101': 'A newly submitted body with one changed sentence.' } });
    const changedSends = sends().slice(sendsBeforeChanged);

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
    expect(changed.report?.people.map(person => [person.key, person.score])).toEqual([['ada', 4], ['grace', 4]]);
    expect(exact(receiptFor(cold, 'assessor', 'assessment:acme/widget#101').reference).data).toMatchObject({ score: 2 });
    expect(exact(receiptFor(changed, 'assessor', 'assessment:acme/widget#101').reference).data).toMatchObject({ score: 2 });
    expect(exact(priorDiscussion.reference).data).toMatchObject({ reviews: [{ id: 101, body: 'Review evidence', author: 'reviewer', at: expect.any(Number) }] });
    expect(exact(receiptFor(changed, 'discussion', 'discussion:acme/widget#101').reference).data).toMatchObject({ reviews: [{ id: 101, body: 'A newly submitted body with one changed sentence.', author: 'reviewer', at: expect.any(Number) }] });
  });

  test('current HR name changes refresh one person and deactivation removes Grace from current membership', () => {
    const { cold } = establishUnchangedControl(baseInputs, false);
    const priorAssessments = assessmentReferences(cold);
    const priorPeople = personReferences(cold);
    const renamedCsv = baseInputs.csv.replace('ada,ada,Ada,true', 'ada,ada,Ada Lovelace,true');
    const renamed = run({ ...baseInputs, csv: renamedCsv });
    expect(renamed.report?.people.map(person => [person.key, person.name])).toEqual([['ada', 'Ada Lovelace'], ['grace', 'Grace']]);
    expect(renamed.trace.filter(event => event.startsWith('summary-body:'))).toEqual(['summary-body:ada']);
    expect(personReferences(renamed).get('ada')).not.toBe(priorPeople.get('ada'));
    expect(personReferences(renamed).get('grace')).toBe(priorPeople.get('grace'));
    expect(assessmentReferences(renamed)).toEqual(priorAssessments);
    expect(exact(receiptFor(renamed, 'roster', 'selected-people').reference).data).toMatchObject({ members: [{ key: 'ada', name: 'Ada Lovelace' }, { key: 'grace', name: 'Grace' }] });

    const inactiveCsv = renamedCsv.replace('grace,grace,Grace,true', 'grace,grace,Grace,false');
    const beforeRefusal = ledgerLength();
    const refused = launch({ ...baseInputs, csv: inactiveCsv });
    expect(refused.status).not.toBe(0);
    expect(ledgerLength()).toBe(beforeRefusal);
    const graceHistory = receiptFor(renamed, 'summary', 'summary:grace').reference;
    const beforeAllowed = sends().length;
    const allowed = run({ ...baseInputs, csv: inactiveCsv, selected: ['ada'] });
    const afterAllowed = sends().slice(beforeAllowed);
    expect(allowed.status).toBe('complete');
    expect(allowed.foldStatus).toBe('succeeded');
    expect(allowed.report?.selected).toEqual(['ada']);
    expect(allowed.people.map(person => person.key)).toEqual(['ada']);
    expect(personReferences(allowed).get('ada')).toBe(personReferences(renamed).get('ada'));
    expect(assessmentReferences(allowed)).toEqual(new Map([...priorAssessments].filter(([subject]) => subject.endsWith('#101') || subject.endsWith('#102'))));
    expect(allowed.trace.some(event => /(?:grace|#20[12])/u.test(event))).toBe(false);
    expect(afterAllowed.some(entry => entry.kind === 'assessment' || typeof entry.url === 'string' && /(?:author%3Agrace|pulls\/(?:201|202)|issues\/(?:201|202))/u.test(entry.url))).toBe(false);
    expect(exact(graceHistory).envelope.subject).toBe('summary:grace');
    expect(referencesBySubject(allowed, 'summary').has('summary:grace')).toBe(false);
  });

  test('actual called helper code changes between isolated ESM graphs and invalidates all shared assessments', () => {
    const baseGraph = applicationGraph('helper-base', false);
    const helperGraph = applicationGraph('helper-b', true);
    checkGraphDeclarations(baseGraph.root);
    checkGraphDeclarations(helperGraph.root);
    const changedPaths = [...baseGraph.manifest.keys()].filter(path => baseGraph.manifest.get(path) !== helperGraph.manifest.get(path));
    expect([...baseGraph.manifest.keys()].sort()).toEqual([...helperGraph.manifest.keys()].sort());
    expect(changedPaths).toEqual([helperApplication]);
    const { cold } = establishUnchangedControl(baseInputs, false);
    const priorAssessments = assessmentReferences(cold);
    const priorPeople = personReferences(cold);
    const sendsBeforeChanged = sends().length;
    const changed = run(baseInputs, {}, helperGraph.worker);
    const changedSends = sends().slice(sendsBeforeChanged);

    expect(changed.status).toBe('complete');
    expect(changed.foldStatus).toBe('succeeded');
    expect(changed.runtime.application).toBe(pathToFileURL(realpathSync(join(helperGraph.root, helperApplication))).href);
    expect(changed.runtime.application).not.toBe(pathToFileURL(realpathSync(join(baseGraph.root, helperApplication))).href);
    expect(changed.runtime.microdelta).toBe(cold.runtime.microdelta);
    expect(changed.runtime.history).toBe(cold.runtime.history);
    expect(changed.runtime.accounting).toBe(cold.runtime.accounting);
    expect(changed.runtime.machine).toBe(cold.runtime.machine);
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
      expect(exact(receiptFor(changed, 'assessor', subject).reference).data).toEqual({ score: 2, explanation: 'Synthetic assessment [helper B]' });
    }
    expect(personReferences(changed)).toEqual(priorPeople);
    expect(changed.trace.filter(event => event.startsWith('summary-body:'))).toEqual([]);
    expect(changed.trace.filter(event => event.startsWith('detail-body:'))).toEqual([]);
    expect(changed.trace.filter(event => event.startsWith('discussion-body:'))).toEqual([]);

    const sendsBeforeRetained = sends().length;
    const retainedHelperB = run(baseInputs, {}, helperGraph.worker);
    const retainedSends = sends().slice(sendsBeforeRetained);
    expect(assessmentReferences(retainedHelperB)).toEqual(changedAssessments);
    expect(retainedHelperB.assessments).toBe(0);
    expect(retainedHelperB.trace.filter(event => event.startsWith('assessment-body:'))).toEqual([]);
    expect(retainedSends.filter(entry => entry.kind === 'assessment')).toEqual([]);
  });
});
