/** CR-2 and fixed admission through the actual report/facade, with controlled host clocks and real durable owners. */
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { performance } from 'node:perf_hooks';
import { afterEach, beforeEach, describe, expect, jest, test } from '@jest/globals';
import { openDurableAccounting } from '@microdelta/accounting';
import type { IDurableAccounting } from '@microdelta/accounting';
import { openDurableHistory } from '@microdelta/history';
import type { IDurableHistory } from '@microdelta/history';
import { createNodeClock, createNodeMachine, createNodeSqlite } from '@microdelta/machine-node';
import { createStopController, openWorkspace, registerSharedRateSurface } from 'microdelta';
import type { IRunEvent, ISourceRetryPolicy, IWorkspace, IWorkspaceAccounting, IWorkspaceRunOptions } from 'microdelta';
import { composeReport } from '../src/controlled/application.js';
import type { IReportHelpers, IReportInputs, IReportServices } from '../src/controlled/application.js';
import { githubRetryPolicy } from '../src/controlled/github-retry.js';
import { baseInputs, fixture } from './fixture.js';
import type { IFixture } from './fixture.js';

/** Epoch and elapsed time advance independently from real event-loop drainage. */
const origin = Date.UTC(2030, 0, 1);
let elapsed = 0;
let lastElapsed = 0;
let directory: string;
let accounting: IDurableAccounting;
let workspace: IWorkspace;
let history: IDurableHistory;
let keys = 0;
beforeEach(() => {
  elapsed = Math.max(lastElapsed, Math.ceil(performance.now()));
  jest.spyOn(performance, 'now').mockImplementation(() => elapsed);
  jest.useFakeTimers({ now: origin, doNotFake: ['performance', 'nextTick', 'setImmediate', 'hrtime'] });
  directory = mkdtempSync(join(tmpdir(), 'controlled-report-provider-'));
  accounting = openDurableAccounting({ sqlite: createNodeSqlite(), location: join(directory, 'usage.sqlite'), logicalStore: 'controlled-usage' });
  workspace = openWorkspace({ location: join(directory, 'history.sqlite'), logicalStore: 'controlled-history', accounting });
  history = openDurableHistory({ sqlite: createNodeSqlite(), clock: createNodeClock(), sha256: createNodeMachine(), location: join(directory, 'history.sqlite'), logicalStore: 'controlled-history' });
});
afterEach(() => { workspace.close(); history.close(); accounting.close(); lastElapsed = elapsed; jest.useRealTimers(); jest.restoreAllMocks(); rmSync(directory, { recursive: true, force: true }); });
/** No fake sleep authorizes sending: timers wake the real runtime to recheck current clocks/gates. */
async function advance(milliseconds: number): Promise<void> { elapsed += milliseconds; await jest.advanceTimersByTimeAsync(milliseconds); }
/** Real event-loop turns permit durable passes to settle without moving either test clock. */
async function until(condition: () => boolean, description: string): Promise<void> {
  for (let turn = 0; turn < 5000; turn += 1) { if (condition()) { return; } await new Promise<void>(resolve => setImmediate(resolve)); }
  throw new Error(`Unreached controlled state: ${description}`);
}
/** One person isolates provider timing from any other normal request pass. */
const one: IReportInputs = { ...baseInputs, selected: ['ada'] };
/** The report's real requests retain operation identity, truthful fold outcome and Accounting evidence. */
function start(fake: IFixture, extra: Partial<IWorkspaceRunOptions<IReportInputs, IReportHelpers>> = {}, inputs: IReportInputs = one) {
  keys += 1;
  const application = composeReport(inputs, fake.services);
  const events: IRunEvent[] = [];
  const done = workspace.run({ authoring: application.authoring, composition: application.composition, environment: 'production', permits: 1, window: 2, observers: [{ observe: event => events.push(event) }], ...extra }, async run => ({
    fold: await run.resolveFold(application.report, { requestKey: `provider:${String(keys)}` }), usage: run.usage(), operations: await run.inspectOperations(),
  }));
  done.catch(() => undefined);
  return { done, events };
}
/** Shared source registration is exact and reuses no caller-private body or credential. */
function policy(fake: IFixture, backoff = 0, maximumDelay = 10_000, maximumTotalWait = 20_000): ISourceRetryPolicy {
  return githubRetryPolicy(fake.services.connection, { backoffMilliseconds: backoff, maximumDelayMilliseconds: maximumDelay, maximumTotalWaitMilliseconds: maximumTotalWait }, () => Date.now());
}
/** A retry waits before a threshold with no extra actual attempt or network permit debit. */
function searches(fake: IFixture) { return fake.requests.filter(request => request.url.includes('/search/issues')); }
/** Distinct concrete search/core handles share the API gate while retaining authoritative search-only attribution. */
function searchAssociation(original: IFixture): IFixture {
  const declaration = { environment: 'production', service: 'controlled', accessContext: original.services.connection };
  const core = registerSharedRateSurface({ ...declaration, surface: 'core', gates: [{ id: 'api' }] });
  const search = registerSharedRateSurface({ ...declaration, surface: 'search', gates: [{ id: 'api' }, { id: 'search' }] });
  return { ...original, services: { ...original.services, githubRate: { surface: core, cooldownGateId: 'api' }, githubSearchRate: { surface: search, cooldownGateId: 'search' }, assessmentRate: { surface: core, cooldownGateId: 'api' } } };
}

describe('CR-2 actual report source operations', () => {
  test('search-only cooldown holds no permit and lets independent core/assessment settle under the same API scope', async () => {
    let refused = false;
    const fake = searchAssociation(fixture({ ids: { ada: [101], grace: [201] }, github: async url => { if (!refused && url.includes('author%3Agrace')) { refused = true; return { status: 429, headers: { 'retry-after': '1' }, body: {} }; } return undefined; } }));
    const stop = createStopController();
    const active = start(fake, { stop }, baseInputs);
    try {
      await until(() => active.events.some(event => event.kind === 'operation' && event.phase === 'retry-scheduled' && event.notBefore === origin + 1000), 'authoritative narrow cooldown is published');
      for (let turn = 0; turn < 100; turn += 1) { await new Promise<void>(resolve => setImmediate(resolve)); }
      expect(fake.trace).toContain('summary-body:ada');
      expect(fake.assessments).toHaveLength(1);
      expect(searches(fake).filter(request => request.url.includes('author%3Agrace'))).toHaveLength(1);
      await advance(999); expect(fake.assessments).toHaveLength(1);
      await advance(1);
      expect((await active.done).value.fold.outcome.status).toBe('succeeded');
    } finally { stop.request({ level: 'hard' }); await active.done.catch(() => undefined); }
  });
  test('a narrow search cooldown never bypasses the full API/search union when a core refusal publishes a stronger floor', async () => {
    let searchRefused = false;
    let coreRefused = false;
    const fake = searchAssociation(fixture({ ids: { ada: [101], grace: [201] }, github: async url => {
      if (!searchRefused && url.includes('author%3Agrace')) { searchRefused = true; return { status: 429, headers: { 'retry-after': '1' }, body: {} }; }
      if (!coreRefused && url.includes('/pulls/101/reviews')) { coreRefused = true; return { status: 429, headers: { 'retry-after': '2' }, body: {} }; }
      return undefined;
    } }));
    const active = start(fake, {}, baseInputs);
    await until(() => searchRefused && active.events.some(event => event.kind === 'operation' && event.phase === 'retry-scheduled'), 'search refusal has been classified');
    for (let turn = 0; turn < 100; turn += 1) { await new Promise<void>(resolve => setImmediate(resolve)); }
    expect(coreRefused).toBe(true);
    await advance(999);
    expect(searches(fake).filter(request => request.url.includes('author%3Agrace'))).toHaveLength(1);
    await advance(1);
    expect(searches(fake).filter(request => request.url.includes('author%3Agrace'))).toHaveLength(1);
    await advance(999);
    expect(searches(fake).filter(request => request.url.includes('author%3Agrace'))).toHaveLength(1);
    await advance(1);
    expect((await active.done).value.fold.outcome.status).toBe('succeeded');
    expect(searches(fake).filter(request => request.url.includes('author%3Agrace')).map(request => request.at)).toEqual([origin, origin + 2000]);
  });
  test('new runs keep in-process fixed-rate cost, while independent access scope proceeds without waiting', async () => {
    const fake = fixture({ ids: { ada: [] }, requestLimit: 1, intervalMilliseconds: 100 });
    expect((await start(fake).done).value.fold.outcome.status).toBe('succeeded');
    const active = start(fake);
    await until(() => jest.getTimerCount() > 0, 'new run shares prior request cost');
    expect(fake.requests).toHaveLength(1);
    const separate = openWorkspace({ location: join(directory, 'independent.sqlite'), logicalStore: 'independent-history', accounting });
    try {
      const other = fixture({ ids: { ada: [] }, requestLimit: 1, intervalMilliseconds: 100 });
      const application = composeReport(one, other.services);
      const result = await separate.run({ authoring: application.authoring, composition: application.composition, environment: 'production' }, run => run.resolveFold(application.report, { requestKey: 'independent' }));
      expect(result.value.outcome.status).toBe('succeeded'); expect(other.requests).toHaveLength(1);
      expect(fake.requests).toHaveLength(1);
      await advance(99); expect(fake.requests).toHaveLength(1);
      await advance(1); expect((await active.done).value.fold.outcome.status).toBe('succeeded');
      expect(fake.requests).toHaveLength(2);
    } finally { separate.close(); }
  });
  test.each([
    [429, { 'retry-after': '1' }],
    [403, { 'retry-after': new Date(origin + 1000).toUTCString() }],
    [403, { 'x-ratelimit-remaining': '0', 'x-ratelimit-reset': String((origin + 1000) / 1000) }],
  ])('rate status%s honors max(provider floor, local backoff), releases deferred-only writer and resumes same operation', async (status, headers) => {
    let refused = false;
    const fake = fixture({ ids: { ada: [101] }, github: async url => { if (!refused && url.includes('/search/issues')) { refused = true; return { status, headers, body: { private: 'PRIVATE_RESPONSE' } }; } return undefined; } });
    const active = start(fake, { retryPolicies: [policy(fake, 1500)] });
    await until(() => active.events.some(event => event.kind === 'wait' && event.phase === 'sleeping'), 'durable deferred-only pass released writer');
    expect(searches(fake)).toHaveLength(1);
    expect(accounting.summarizeUsage({ environment: 'production' }).requestAttempts).toBe(1);
    expect(history.currentWriter()).toBeUndefined();
    const probe = history.acquireWriter({ holder: 'deferred-probe', leaseMilliseconds: 10_000 });
    expect(probe.kind).toBe('acquired'); if (probe.kind === 'acquired') { history.releaseWriter(probe.lease); }
    await advance(1499);
    expect(searches(fake)).toHaveLength(1);
    await advance(1);
    const result = await active.done;
    expect(result.value.fold.outcome.status).toBe('succeeded');
    expect(searches(fake).map(request => request.at)).toEqual([origin, origin + 1500]);
    expect(new Set(searches(fake).map(request => request.operation)).size).toBe(1);
    expect(new Set(searches(fake).map(request => request.attempt)).size).toBe(2);
    expect(result.value.usage.unknown.length).toBeGreaterThan(0);
    expect(JSON.stringify(active.events)).not.toMatch(/PRIVATE_RESPONSE|retry-after|x-ratelimit-reset/u);
  });
  test('same-operation durable floor survives close/reopen; a new run sends nothing just before the floor', async () => {
    let refused = false;
    const fake = fixture({ ids: { ada: [101] }, github: async url => { if (!refused && url.includes('/search/issues')) { refused = true; return { status: 429, headers: { 'retry-after': '1' }, body: {} }; } return undefined; } });
    const first = await start(fake, { deferral: 'exit', retryPolicies: [policy(fake)] }).done;
    expect(first.waitingUntil).toBe(origin + 1000); expect(first.value.fold.outcome.status).toBe('waiting');
    const operation = searches(fake)[0]?.operation;
    workspace.close(); workspace = openWorkspace({ location: join(directory, 'history.sqlite'), logicalStore: 'controlled-history', accounting });
    await advance(999);
    const early = await start(fake, { deferral: 'exit', retryPolicies: [policy(fake)] }).done;
    expect(early.waitingUntil).toBe(origin + 1000); expect(searches(fake)).toHaveLength(1);
    await advance(1);
    const resumed = await start(fake, { deferral: 'exit', retryPolicies: [policy(fake)] }).done;
    expect(resumed.value.fold.outcome.status).toBe('succeeded');
    expect(searches(fake).map(request => request.operation)).toEqual([operation, operation]);
  });
  test('cancelling a durable wait prevents every later request and assessment', async () => {
    const fake = fixture({ ids: { ada: [101] }, github: async url => url.includes('/search/issues') ? { status: 429, headers: { 'retry-after': '1' }, body: {} } : undefined });
    const stop = createStopController();
    const active = start(fake, { stop, retryPolicies: [policy(fake)] });
    await until(() => active.events.some(event => event.kind === 'wait' && event.phase === 'sleeping'), 'report sleeps on durable floor');
    stop.request({ level: 'hard' });
    const result = await active.done;
    await advance(1001);
    expect(result.stop.level).toBe('hard'); expect(result.value.fold.outcome.status).not.toBe('succeeded');
    expect(fake.requests).toHaveLength(1); expect(fake.assessments).toHaveLength(0);
    expect(result.value.usage.requestAttempts).toBe(1);
  });
  test.each([401, 403, 404])('authentication/non-rate status%s does not become a rate retry or empty success', async status => {
    const fake = fixture({ github: async () => ({ status, headers: { authorization: 'PRIVATE_TOKEN' }, body: { message: 'PRIVATE_ERROR' } }) });
    const result = await start(fake, { retryPolicies: [policy(fake)] }).done;
    expect(result.value.fold.outcome.status).not.toBe('succeeded');
    expect(fake.requests).toHaveLength(1); expect(fake.assessments).toHaveLength(0);
    expect(result.stop.level).toBe('none');
    expect(result.diagnostics.join(' ')).not.toMatch(/PRIVATE_TOKEN|PRIVATE_ERROR/u);
  });
  test('source budget rejection leaves required report incomplete without shortening provider minimum; fresh run has ordinary reuse', async () => {
    let refused = false;
    const fake = fixture({ ids: { ada: [101] }, github: async url => { if (!refused && url.includes('/search/issues')) { refused = true; return { status: 429, headers: { 'retry-after': '2' }, body: {} }; } return undefined; } });
    const rejected = await start(fake, { retryPolicies: [policy(fake, 0, 1999)] }).done;
    expect(rejected.stop.level).toBe('none'); expect(rejected.value.fold.outcome.status).not.toBe('succeeded'); expect(searches(fake)).toHaveLength(1);
    expect(rejected.value.operations).toContainEqual(expect.objectContaining({ status: 'retry-exhausted', notBefore: origin + 2000 }));
    await advance(1999);
    const early = await start(fake, { deferral: 'exit', retryPolicies: [policy(fake)] }).done;
    expect(early.value.fold.outcome.status).not.toBe('succeeded'); expect(searches(fake)).toHaveLength(1);
    await advance(1);
    const resumed = await start(fake, { retryPolicies: [policy(fake)] }).done;
    expect(resumed.value.fold.outcome.status).toBe('succeeded'); expect(searches(fake)).toHaveLength(2);
  });
  test('finite allowance exhaustion remains pending without soft-stop rejection, and ambiguous lost response usage remains unknown', async () => {
    const original = fixture({ ids: { ada: [101] }, github: async url => { if (url.includes('/search/issues')) { throw new Error('PRIVATE_TRANSPORT'); } return undefined; } });
    const fake = { ...original, services: { ...original.services, retry: { maxAttempts: 2, backoffMilliseconds: 0 } } };
    const exhausted = await start(fake).done;
    expect(exhausted.stop.level).toBe('none'); expect(exhausted.value.fold.outcome.status).toBe('waiting');
    expect(searches(fake)).toHaveLength(2); expect(exhausted.value.usage.unknown.length).toBe(2); expect(exhausted.value.usage.observed).toEqual([]);
    const sourceOperation = searches(fake)[0]?.operation;
    const changed = fixture({ ids: { ada: [101] } });
    const resumed = await start({ ...changed, services: { ...changed.services, githubRate: fake.services.githubRate, assessmentRate: fake.services.assessmentRate, connection: fake.services.connection } }).done;
    expect(resumed.value.fold.outcome.status).toBe('succeeded');
    expect(searches(changed)[0]?.operation).toBe(sourceOperation);
  });
  test.each(['soft', 'hard', 'deadline'] as const)('explicit %s retry rejection after required allowance exhaustion preserves the accepted drain boundary', async level => {
    let exhausted = false;
    let jsonOperation: string | undefined;
    const original = fixture({ ids: { ada: [101], grace: [201] }, github: async url => { if (url.includes('author%3Aada')) { exhausted = true; throw new Error('PRIVATE_LOST_RESPONSE'); } return undefined; } });
    const fake = { ...original, services: { ...original.services, retry: { maxAttempts: 1, backoffMilliseconds: 0 }, github: async (url: string, accept: 'application/vnd.github.diff' | undefined, send: Parameters<IReportServices['github']>[2]) => {
      if (url.endsWith('/pulls/201') && accept === undefined) { jsonOperation = send.operation; }
      return original.services.github(url, accept, send);
    } } };
    const stop = createStopController();
    let rejected = false;
    const active = start(fake, { stop, observers: [{ observe: event => {
      if (event.kind === 'operation' && event.phase === 'request-settled' && event.status === 'succeeded' && event.operation === jsonOperation) {
        expect(exhausted).toBe(true);
        rejected = true;
        stop.request(level === 'deadline' ? { level: 'soft', deadline: Date.now() } : { level });
      }
    } }] }, baseInputs);
    const result = await active.done;
    expect(rejected).toBe(true); expect(result.stop.level).toBe(level === 'soft' ? 'soft' : 'hard');
    expect(result.value.fold.outcome.status).not.toBe('succeeded');
    expect(fake.requests.filter(request => request.url.includes('author%3Aada'))).toHaveLength(1);
    const grace = result.value.fold.members.find(member => member.key === 'grace');
    expect(grace?.status).toBe(level === 'soft' ? 'succeeded' : 'cancelled');
    expect(history.findCandidates({ analysis: 'controlled-contribution-report', environment: 'production', subject: 'detail:acme/widget#201', version: 1 })).toHaveLength(level === 'soft' ? 1 : 0);
    expect(fake.assessments).toHaveLength(level === 'soft' ? 1 : 0);
  });
});

describe('actual report final send authority', () => {
  test('hard stop in begin observer prevents the provider send after intent and preserves no successful strict result', async () => {
    const fake = fixture({ ids: { ada: [101] } });
    const stop = createStopController();
    const active = start(fake, { stop, observers: [{ observe: event => { if (event.kind === 'send' && event.phase === 'begin') { stop.request({ level: 'hard' }); } } }] });
    const result = await active.done;
    expect(fake.requests).toHaveLength(0); expect(fake.assessments).toHaveLength(0);
    expect(result.value.fold.outcome.status).not.toBe('succeeded');
    expect(result.value.operations.flatMap(operation => operation.attempts.map(attempt => attempt.status))).toEqual(['not-sent']);
  });
  test('unconfirmed usage intent rolls back an unsent shared reservation; a new authorized empty search can use the capacity', async () => {
    const fake = fixture({ ids: { ada: [], grace: [] }, requestLimit: 1, intervalMilliseconds: 100 });
    const refusing: IWorkspaceAccounting = { recordUsageIntent: () => { throw new Error('intent not committed'); }, acknowledgeUsage: value => accounting.acknowledgeUsage(value), summarizeUsage: query => accounting.summarizeUsage(query) };
    workspace.close(); workspace = openWorkspace({ location: join(directory, 'history.sqlite'), logicalStore: 'controlled-history', accounting: refusing });
    const refused = await start(fake, { deferral: 'exit' }).done;
    expect(fake.requests).toHaveLength(0); expect(refused.value.fold.outcome.status).not.toBe('succeeded');
    workspace.close(); workspace = openWorkspace({ location: join(directory, 'history.sqlite'), logicalStore: 'controlled-history', accounting });
    const resumed = await start(fake, { deferral: 'exit' }, { ...baseInputs, selected: ['grace'] }).done;
    expect(resumed.value.fold.outcome.status).toBe('succeeded'); expect(fake.requests).toHaveLength(1);
  });
  test('a successor writer fencing in begin observer prevents every transport invocation', async () => {
    const fake = fixture({ ids: { ada: [101] } });
    let successor: ReturnType<IDurableHistory['acquireWriter']> | undefined;
    const active = start(fake, { deferral: 'exit', writerWait: { deadline: origin + 100, pollMilliseconds: 1 }, observers: [{ observe: event => {
      if (event.kind !== 'send' || event.phase !== 'begin') { return; }
      const held = history.currentWriter(); if (held === undefined) { throw new Error('Expected active writer'); }
      elapsed += held.expiresAt - Date.now(); jest.setSystemTime(held.expiresAt);
      successor = history.acquireWriter({ holder: 'successor', leaseMilliseconds: 10_000 });
    } }] });
    let settled = false;
    try { const result = await active.done; settled = result.value.fold.outcome.status === 'succeeded'; } catch { settled = false; }
    expect(successor?.kind).toBe('acquired'); expect(fake.requests).toHaveLength(0); expect(settled).toBe(false);
    if (successor?.kind === 'acquired') { history.releaseWriter(successor.lease); }
  });
  test('quantity cost and request gates both remain mandatory on every actual source and assessment path', async () => {
    const original = fixture({ ids: { ada: [101] } });
    const surface = registerSharedRateSurface({ environment: 'production', service: 'controlled', accessContext: original.services.connection, surface: 'quantity', gates: [{ id: 'all-requests', limit: { units: 2, intervalMilliseconds: 100, costBasis: 'requests' } }, { id: 'units', limit: { units: 3, intervalMilliseconds: 100, costBasis: 'quantity' } }] });
    const services: IReportServices = { ...original.services, githubRate: { surface, cooldownGateId: 'all-requests', quantityCost: 2 }, assessmentRate: { surface, cooldownGateId: 'all-requests', quantityCost: 3 } };
    const fake = { ...original, services };
    const active = start(fake);
    for (let count = 1; count <= 6; count += 1) {
      await until(() => fake.requests.length === count && jest.getTimerCount() > 0, `quantity gate waits after send ${String(count)}`);
      expect(fake.assessments).toHaveLength(0);
      await advance(99); expect(fake.requests).toHaveLength(count);
      await advance(1);
    }
    const result = await active.done;
    expect(result.value.fold.outcome.status).toBe('succeeded'); expect(fake.assessments).toHaveLength(1);
    expect(fake.requests.map(request => request.at)).toEqual([0, 100, 200, 300, 400, 500].map(offset => origin + offset));
    expect(fake.trace).toContain(`assessment-send:${String(origin + 600)}`);
  });
});
