/**
 * TEST-4.6 / RUN-003 evidence through the actual controlled report: a ready
 * person's current result is independent of another person's unfinished search,
 * and strict failure preserves both successful and quota-pending member facts.
 */
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, jest, test } from '@jest/globals';
import { openDurableAccounting } from '@microdelta/accounting';
import type { IDurableAccounting } from '@microdelta/accounting';
import { openDurableHistory } from '@microdelta/history';
import type { IDurableHistory } from '@microdelta/history';
import { createNodeClock, createNodeMachine, createNodeSqlite } from '@microdelta/machine-node';
import { createStopController, openWorkspace, registerSharedRateSurface } from 'microdelta';
import type { ICompletedResultReference, IRunEvent, IRunResult, IStopController, IWorkspace } from 'microdelta';
import { composeReport, evaluateReport, reportAnalysis } from '../../examples/contribution-report/src/controlled/application.js';
import type { IReportInputs, IReportRunOutcome } from '../../examples/contribution-report/src/controlled/application.js';
import { baseInputs, fixture } from './fixture.js';
import type { IFixture } from './fixture.js';

/** All persisted evidence and rate associations belong to this case alone. */
let directory: string;
let workspace: IWorkspace;
let accounting: IDurableAccounting;
let history: IDurableHistory;
let requests = 0;
beforeEach(() => {
  directory = mkdtempSync(join(tmpdir(), 'controlled-mixed-evidence-'));
  accounting = openDurableAccounting({ sqlite: createNodeSqlite(), location: join(directory, 'usage.sqlite'), logicalStore: 'mixed-usage' });
  workspace = openWorkspace({ location: join(directory, 'history.sqlite'), logicalStore: 'mixed-history', accounting });
  history = openDurableHistory({ sqlite: createNodeSqlite(), clock: createNodeClock(), sha256: createNodeMachine(), location: join(directory, 'history.sqlite'), logicalStore: 'mixed-history' });
});
afterEach(() => { workspace.close(); history.close(); accounting.close(); jest.useRealTimers(); rmSync(directory, { recursive: true, force: true }); });

/** A provider barrier controls a real response; release is safe on every test exit. */
function barrier(): { readonly reached: () => boolean; readonly enter: () => Promise<void>; readonly release: () => void } {
  let entered = false;
  let release = (): void => undefined;
  const held = new Promise<void>(resolve => { release = resolve; });
  return { reached: () => entered, enter: () => { entered = true; return held; }, release: () => release() };
}

/** Event-loop drainage cannot advance the provider clock or grant a request. */
async function until(condition: () => boolean, description: string): Promise<void> {
  for (let turn = 0; turn < 5_000; turn += 1) {
    if (condition()) { return; }
    await new Promise<void>(resolve => setImmediate(resolve));
  }
  throw new Error(`Unreached controlled state: ${description}`);
}

/** A launch receipt retains current run evidence without substituting History heads. */
interface IActiveReport {
  readonly result: Promise<IRunResult<IReportRunOutcome>>;
  readonly events: readonly IRunEvent[];
  readonly stop: IStopController;
  readonly settled: () => boolean;
}

/** Existing finite deferral mode is a test choice, not a CLI lifetime policy. */
function begin(fake: IFixture, inputs: IReportInputs = baseInputs, deferral?: 'exit'): IActiveReport {
  requests += 1;
  const events: IRunEvent[] = [];
  const stop = createStopController();
  let settled = false;
  const result = evaluateReport(workspace, composeReport(inputs, fake.services), {
    environment: 'production', requestKey: `mixed:${String(requests)}`, permits: 2, window: 3, stop,
    observers: [{ observe: event => events.push(event) }], ...(deferral === undefined ? {} : { deferral }),
  });
  void result.then(() => { settled = true; }, () => { settled = true; });
  return { result, events, stop, settled: () => settled };
}

/** Structural events identify the current summary; the exact reader establishes its subject. */
function hasSummary(active: IActiveReport, key: string, phase: 'accept' | 'publish'): boolean {
  return active.events.some(event => event.kind === 'step' && event.event.step.slot === 'summary' && event.event.step.memberKey === key && event.event.phase === phase && event.event.reference !== undefined);
}

/** Match committed exact references to independently expected scoped subjects. */
function currentReference(active: IActiveReport, subject: string, phase?: 'accept' | 'publish'): ICompletedResultReference {
  const references = new Map<string, ICompletedResultReference>();
  for (const event of active.events) {
    if (event.kind !== 'step' || (event.event.phase !== 'publish' && event.event.phase !== 'accept') || event.event.reference === undefined || (phase !== undefined && event.event.phase !== phase)) { continue; }
    const envelope = history.readEnvelope(event.event.reference);
    if (envelope.analysis === reportAnalysis && envelope.environment === 'production' && envelope.subject === subject) { references.set(envelope.reference.locator, envelope.reference); }
  }
  expect(references.size).toBe(1);
  const reference = references.values().next().value;
  if (reference === undefined) { throw new Error(`Missing current exact evidence for ${subject}`); }
  return reference;
}

/** Provider routes are classified from the independent fixture's expected people/PR IDs. */
function providerCount(fake: IFixture, login: string, ids: readonly number[]): number {
  return fake.requests.filter(request => {
    const url = new URL(request.url);
    return url.pathname === '/search/issues' ? url.searchParams.get('q')?.includes(`author:${login} `) === true
      : ids.some(id => new RegExp(`/(?:pulls|issues)/${String(id)}(?:/|$)`, 'u').test(url.pathname));
  }).length;
}

/** A report's current strict outcome is required before its payload is trusted. */
function completed(result: IRunResult<IReportRunOutcome>): Extract<IReportRunOutcome, { readonly status: 'complete' }> {
  expect(result.value.status).toBe('complete');
  if (result.value.status !== 'complete' || result.value.fold.outcome.status !== 'succeeded') { throw new Error('Expected current strict completion'); }
  return result.value;
}

describe('actual report independence at controlled barriers', () => {
  test.each([false, true])('A is currently complete while B page two is held; seeded reuse = %s', async seeded => {
    const seed = seeded ? completed(await begin(fixture()).result) : undefined;
    const seededAda = seed?.fold.members.find(member => member.key === 'ada');
    const saved = seededAda?.status === 'succeeded' ? seededAda.outcome.reference : undefined;
    const old = saved === undefined ? undefined : { envelope: history.readEnvelope(saved), data: history.reader.readSubtree(saved, []) };
    const secondPage = barrier();
    const fake = fixture({ github: async value => {
      const url = new URL(value);
      if (url.pathname === '/search/issues' && url.searchParams.get('q')?.includes('author:grace ') === true && url.searchParams.get('page') === '2') { await secondPage.enter(); }
      return undefined;
    } });
    const active = begin(fake);
    try {
      await until(() => secondPage.reached() && hasSummary(active, 'ada', seeded ? 'accept' : 'publish'), 'B continuation held and A currently succeeded');
      const current = currentReference(active, 'summary:ada', seeded ? 'accept' : 'publish');
      expect(history.reader.readSubtree(current, [])).toEqual({ key: 'ada', name: 'Ada', count: 2, score: 4, status: 'contributions' });
      expect(active.settled()).toBe(false);
      expect(active.events.some(event => event.kind === 'step' && event.event.step.slot === 'report' && ['execute', 'publish', 'accept'].includes(event.event.phase))).toBe(false);
      expect(fake.trace.filter(event => event === 'search-complete:ada')).toHaveLength(1);
      expect(fake.trace).not.toContain('search-complete:grace');
      expect(fake.trace.filter(event => /^(?:detail|discussion|assessment)-body:acme\/widget#20[12]$/u.test(event) || event === 'summary-body:grace')).toEqual([]);
      expect(providerCount(fake, 'ada', [101, 102])).toBe(seeded ? 2 : 12);
      expect(providerCount(fake, 'grace', [201, 202])).toBe(2);
      expect(fake.requests).toHaveLength(seeded ? 4 : 14);
      expect(fake.assessments.map(request => request.id)).toEqual(seeded ? [] : ['acme/widget#101', 'acme/widget#102']);
      expect(fake.trace.filter(event => event === 'summary-body:ada')).toHaveLength(seeded ? 0 : 1);
      expect(fake.trace.filter(event => /^detail-body:acme\/widget#10[12]$/u.test(event))).toHaveLength(seeded ? 0 : 2);
      if (seeded) {
        expect(current).toEqual(saved);
        expect(saved).toBeDefined();
        if (saved === undefined) { throw new Error('Expected seed reference from its typed member outcome'); }
        expect({ envelope: history.readEnvelope(saved), data: history.reader.readSubtree(saved, []) }).toEqual(old);
        expect(history.readAcceptances(saved, 'production').length).toBeGreaterThan(0);
      }
      const atBarrier = { envelope: history.readEnvelope(current), data: history.reader.readSubtree(current, []) };
      secondPage.release();
      const value = completed(await active.result);
      expect(value.report.people.map(person => [person.key, person.count, person.score])).toEqual([['ada', 2, 4], ['grace', 2, 4]]);
      expect(value.fold.members.find(member => member.key === 'ada')).toMatchObject({ status: 'succeeded', outcome: { reference: current } });
      expect({ envelope: history.readEnvelope(current), data: history.reader.readSubtree(current, []) }).toEqual(atBarrier);
      expect(fake.requests).toHaveLength(seeded ? 4 : 24);
      expect(fake.assessments).toHaveLength(seeded ? 0 : 4);
    } finally {
      secondPage.release();
      if (!active.settled()) { active.stop.request({ level: 'hard' }); }
      await active.result.catch(() => undefined);
    }
  });
});

describe('actual strict report with success, quota wait and isolated source failure', () => {
  test('finite partial evidence names failed C and quota-pending B while current A remains exact', async () => {
    const origin = Date.UTC(2030, 0, 1);
    jest.useFakeTimers({ now: origin, doNotFake: ['performance', 'nextTick', 'setImmediate', 'hrtime'] });
    const inputs: IReportInputs = { ...baseInputs, csv: `${baseInputs.csv}cy,cy,Cy,true\n`, selected: ['ada', 'grace', 'cy'] };
    const quota = barrier();
    let refused = false;
    const original = fixture({ ids: { ada: [101], grace: [201], cy: [301] }, github: async value => {
      const url = new URL(value);
      if (url.pathname !== '/search/issues') { return undefined; }
      const query = url.searchParams.get('q') ?? '';
      if (query.includes('author:cy ')) { return { status: 403, headers: {}, body: {} }; }
      if (query.includes('author:grace ') && !refused) { await quota.enter(); refused = true; return { status: 429, headers: { 'retry-after': '1' }, body: {} }; }
      return undefined;
    } });
    const association = { environment: 'production', service: 'controlled', accessContext: original.services.connection };
    const core = registerSharedRateSurface({ ...association, surface: 'core', gates: [{ id: 'api' }] });
    const search = registerSharedRateSurface({ ...association, surface: 'search', gates: [{ id: 'api' }, { id: 'search' }] });
    const fake: IFixture = { ...original, services: { ...original.services, githubRate: { surface: core, cooldownGateId: 'api' }, githubSearchRate: { surface: search, cooldownGateId: 'search' }, assessmentRate: { surface: core, cooldownGateId: 'api' } } };
    const active = begin(fake, inputs, 'exit');
    try {
      await until(() => quota.reached() && hasSummary(active, 'ada', 'publish') && providerCount(fake, 'cy', [301]) === 1, 'current A, isolated C request, and held quota response');
      const a = currentReference(active, 'summary:ada', 'publish');
      const immutableA = { envelope: history.readEnvelope(a), data: history.reader.readSubtree(a, []) };
      expect(active.settled()).toBe(false);
      expect(fake.requests).toHaveLength(8);
      expect(fake.assessments.map(request => request.id)).toEqual(['acme/widget#101']);
      quota.release();
      const result = await active.result;
      expect(result.value.status).toBe('incomplete');
      expect('report' in result.value).toBe(false);
      expect(result.value.fold.discovery).toMatchObject({ kind: 'keyed', completion: 'complete', keys: ['ada', 'cy', 'grace'] });
      expect(result.value.fold.outcome).toEqual({ status: 'failed', failed: ['cy'], cancelled: [], pending: ['grace'], openDiscovery: false, diagnostic: expect.any(String) });
      expect(result.value.fold.members.map(member => [member.key, member.status])).toEqual([['ada', 'succeeded'], ['cy', 'failed'], ['grace', 'pending']]);
      expect(result.value.fold.members.find(member => member.key === 'ada')).toMatchObject({ status: 'succeeded', outcome: { kind: 'published', reference: a } });
      expect(result.value.fold.members.find(member => member.key === 'cy')).toMatchObject({ status: 'failed', error: { code: 'execution-failure' } });
      expect(result.value.fold.members.find(member => member.key === 'grace')).toMatchObject({ status: 'pending', blocked: { kind: 'deferred', operation: expect.any(String), notBefore: origin + 1_000 } });
      expect(result.waitingUntil).toBe(origin + 1_000);
      expect(result.stop.level).toBe('none');
      expect(fake.requests).toHaveLength(8);
      expect(providerCount(fake, 'ada', [101])).toBe(6);
      expect(providerCount(fake, 'grace', [201])).toBe(1);
      expect(providerCount(fake, 'cy', [301])).toBe(1);
      expect(fake.trace.filter(event => /^(?:detail|discussion|assessment)-body:acme\/widget#(?:201|301)$/u.test(event) || /^summary-body:(?:grace|cy)$/u.test(event))).toEqual([]);
      expect(active.events.some(event => event.kind === 'step' && event.event.step.slot === 'report' && ['execute', 'publish', 'accept'].includes(event.event.phase))).toBe(false);
      expect(result.value.usage).toMatchObject({ requestAttempts: 9, reports: 1, observed: [{ unit: 'tokens', amount: 10 }] });
      const firstPartial = JSON.stringify(result.value.fold);
      const immediate = await begin(fake, inputs, 'exit').result;
      expect(immediate.value.status).toBe('incomplete');
      expect(immediate.waitingUntil).toBe(origin + 1_000);
      expect(fake.requests).toHaveLength(8);
      await jest.advanceTimersByTimeAsync(999);
      const early = await begin(fake, inputs, 'exit').result;
      expect(early.value.status).toBe('incomplete');
      expect(early.waitingUntil).toBe(origin + 1_000);
      expect(fake.requests).toHaveLength(8);
      expect(fake.assessments).toHaveLength(1);
      await jest.advanceTimersByTimeAsync(1);
      const resumed = await begin(fake, inputs, 'exit').result;
      expect(resumed.value.status).toBe('incomplete');
      expect(resumed.value.fold.outcome).toMatchObject({ status: 'failed', failed: ['cy'], pending: [] });
      expect(resumed.value.fold.members.find(member => member.key === 'grace')?.status).toBe('succeeded');
      expect(resumed.value.fold.members.find(member => member.key === 'ada')).toMatchObject({ status: 'succeeded', outcome: { kind: 'reused', reference: a } });
      expect(fake.assessments.map(request => request.id)).toEqual(['acme/widget#101', 'acme/widget#201']);
      expect(JSON.stringify(result.value.fold)).toBe(firstPartial);
      expect({ envelope: history.readEnvelope(a), data: history.reader.readSubtree(a, []) }).toEqual(immutableA);
    } finally {
      quota.release();
      if (!active.settled()) { active.stop.request({ level: 'hard' }); }
      await active.result.catch(() => undefined);
    }
  });
});
