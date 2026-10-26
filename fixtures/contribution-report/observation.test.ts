/** The controlled report itself classifies current strict work for one exact observed execution. */
import { existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, test } from '@jest/globals';
import Database from 'better-sqlite3';
import { openDurableAccounting } from '@microdelta/accounting';
import type { IDurableAccounting } from '@microdelta/accounting';
import { openDurableHistory } from '@microdelta/history';
import { createNodeClock, createNodeMachine, createNodeSqlite } from '@microdelta/machine-node';
import { openExecutionObservationReader, openWorkspace } from 'microdelta';
import type { IExecutionObservation, IObservedRun, IWorkspace } from 'microdelta';
import { composeReport, evaluateObservedReport, evaluateReport, reportAnalysis } from '../../examples/contribution-report/src/controlled/application.js';
import type { IReportInputs, IReportRunOutcome } from '../../examples/contribution-report/src/controlled/application.js';
import { baseInputs, fixture } from './fixture.js';
import type { IFixture } from './fixture.js';

/** Each case has an independent History and Accounting scope, with finite observation artifacts. */
let directory: string;
let workspace: IWorkspace;
let accounting: IDurableAccounting;
let store: string;
let reportStore: string;
let sequence: number;
beforeEach(() => {
  directory = mkdtempSync(join(tmpdir(), 'controlled-observation-'));
  store = join(directory, 'history.sqlite');
  reportStore = 'controlled-history';
  accounting = openDurableAccounting({ sqlite: createNodeSqlite(), location: join(directory, 'usage.sqlite'), logicalStore: 'controlled-usage' });
  workspace = openWorkspace({ location: store, logicalStore: reportStore, accounting });
  sequence = 0;
});
afterEach(() => { workspace.close(); accounting.close(); rmSync(directory, { recursive: true, force: true }); });

/** The exact report is checked through a separate History reader, not inferred from an observation assertion. */
function retained(reference: Extract<IReportRunOutcome, { readonly status: 'complete' }>['fold']['outcome']): unknown {
  if (reference.status !== 'succeeded') { throw new Error('Expected current strict success'); }
  const history = openDurableHistory({ sqlite: createNodeSqlite(), clock: createNodeClock(), sha256: createNodeMachine(), location: store, logicalStore: reportStore });
  try { return history.reader.readSubtree(reference.outcome.reference, []); }
  finally { history.close(); }
}

/** A finite reader is useful after the body and acknowledgment have settled; it never joins the run. */
function observation<T>(observed: IObservedRun<T>): IExecutionObservation {
  const reader = openExecutionObservationReader(observed.locator);
  try {
    const document = reader.read();
    if (document.result.kind !== 'observed') { throw new Error(`Expected exact observation, received ${document.result.kind}`); }
    return document.result.observation;
  } finally { reader.close(); }
}

/** Every launch chooses a fresh request and artifact while sharing the same production application. */
function observed(fake: IFixture, inputs: IReportInputs = baseInputs, options: { readonly environment?: string; readonly workspace?: IWorkspace; readonly admission?: Parameters<typeof evaluateObservedReport>[2]['admission']; readonly observers?: Parameters<typeof evaluateObservedReport>[2]['observers'] } = {}) {
  sequence += 1;
  return evaluateObservedReport(options.workspace ?? workspace, composeReport(inputs, fake.services), {
    environment: options.environment ?? 'production', requestKey: `observed:${String(sequence)}`,
    observationLocation: join(directory, `execution-${String(sequence)}.sqlite`), permits: 2, window: 2,
    ...(options.admission === undefined ? {} : { admission: options.admission }),
    ...(options.observers === undefined ? {} : { observers: options.observers }),
  });
}

/** Fault only an already prepared observation artifact, discovered without assuming its private table spelling. */
function refuseObservationUpdates(location: string): void {
  const database = new Database(location);
  try {
    const rows: unknown = database.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%'").all();
    if (!Array.isArray(rows) || rows.length !== 1 || typeof rows[0] !== 'object' || rows[0] === null) { throw new Error('Expected one prepared observation table'); }
    const name: unknown = Reflect.get(rows[0], 'name');
    if (typeof name !== 'string' || !/^[a-z_]+$/u.test(name)) { throw new Error('Unexpected observation table name'); }
    database.exec(`CREATE TRIGGER refuse_observation_update BEFORE UPDATE ON ${name} BEGIN SELECT RAISE(FAIL, 'injected observation write fault'); END`);
  } finally { database.close(); }
}

describe('controlled strict report observation', () => {
  test('fresh and validated-reuse strict success confirm their exact current retained report', async () => {
    const firstFixture = fixture();
    const first = observed(firstFixture);
    const firstResult = await first.result;
    expect(await first.acknowledgment).toMatchObject({ kind: 'acknowledged' });
    expect(firstResult.value.status).toBe('complete');
    if (firstResult.value.status !== 'complete' || firstResult.value.fold.outcome.status !== 'succeeded') { throw new Error('Expected strict completion'); }
    const firstFold = firstResult.value.fold.outcome;
    expect(firstFold.outcome.kind).toBe('published');
    expect(firstFold.outcome.coverage).toMatchObject({ closed: true, required: ['ada', 'grace'], skipped: [] });
    expect(retained(firstFold)).toEqual(firstResult.value.report);
    expect(firstResult.value.usage.requestAttempts).toBe(28);
    expect(observation(first).application).toEqual({ kind: 'confirmed', deliverable: firstFold.outcome.reference.locator });
    const reusedFixture = fixture();
    const second = observed(reusedFixture);
    const secondResult = await second.result;
    expect(await second.acknowledgment).toMatchObject({ kind: 'acknowledged' });
    expect(secondResult.value.status).toBe('complete');
    if (secondResult.value.status !== 'complete' || secondResult.value.fold.outcome.status !== 'succeeded') { throw new Error('Expected validated reuse'); }
    expect(secondResult.value.fold.outcome.outcome.kind).toBe('reused');
    expect(secondResult.value.fold.outcome.outcome.reference).toEqual(firstFold.outcome.reference);
    expect(retained(secondResult.value.fold.outcome)).toEqual(secondResult.value.report);
    expect(reusedFixture.assessments).toHaveLength(0);
    expect(observation(second).application).toEqual({ kind: 'confirmed', deliverable: firstFold.outcome.reference.locator });
  });

  test('old readable report cannot confirm when current required work fails', async () => {
    const warm = observed(fixture());
    const first = await warm.result;
    await warm.acknowledgment;
    if (first.value.status !== 'complete') { throw new Error('Expected warm report'); }
    const old = first.value.fold.outcome;
    const failed = observed(fixture({ github: async url => url.includes('author%3Aada') ? { status: 403, headers: {}, body: {} } : undefined }));
    const result = await failed.result;
    await failed.acknowledgment;
    expect(result.value.status).toBe('incomplete');
    expect(result.value.fold.outcome.status).toBe('failed');
    expect('report' in result.value).toBe(false);
    expect(retained(old)).toEqual(first.value.report);
    expect(observation(failed).application).toEqual({ kind: 'incomplete', reasons: ['required-work'] });
  });

  test('closed empty searches and explicitly empty selection confirm only their current scope', async () => {
    const searched = observed(fixture({ ids: { ada: [], grace: [] } }));
    const searchedResult = await searched.result;
    await searched.acknowledgment;
    expect(searchedResult.value.status).toBe('complete');
    if (searchedResult.value.status !== 'complete' || searchedResult.value.fold.outcome.status !== 'succeeded') { throw new Error('Expected certified empty searches'); }
    expect(searchedResult.value.report.people.map(person => person.status)).toEqual(['no-contributions', 'no-contributions']);
    expect(retained(searchedResult.value.fold.outcome)).toEqual(searchedResult.value.report);
    expect(observation(searched).application).toEqual({ kind: 'confirmed', deliverable: searchedResult.value.fold.outcome.outcome.reference.locator });
    const empty = observed(fixture(), { ...baseInputs, selected: [] }, { environment: 'trial' });
    const emptyResult = await empty.result;
    await empty.acknowledgment;
    expect(emptyResult.value.status).toBe('complete');
    if (emptyResult.value.status !== 'complete' || emptyResult.value.fold.outcome.status !== 'succeeded') { throw new Error('Expected explicit empty trial'); }
    expect(emptyResult.value.report.people).toEqual([]);
    expect(emptyResult.value.fold.outcome.outcome.coverage.required).toEqual([]);
    expect(observation(empty).application).toEqual({ kind: 'confirmed', deliverable: emptyResult.value.fold.outcome.outcome.reference.locator });
  });

  test('failed search and lost assessment preserve typed incomplete evidence without a report locator', async () => {
    const failed = observed(fixture({ github: async url => url.includes('author%3Aada') ? { status: 200, headers: {}, body: { total_count: 0, incomplete_results: true, items: [] } } : undefined }));
    const failedResult = await failed.result;
    await failed.acknowledgment;
    expect(failedResult.value.status).toBe('incomplete');
    expect(failedResult.value.fold.outcome.status).toBe('failed');
    expect(observation(failed).application).toEqual({ kind: 'incomplete', reasons: ['required-work'] });
    const lost = observed(fixture({ assess: async request => { if (request.id.endsWith('#101')) { throw new Error('unresolved remote outcome'); } return { score: 2, explanation: 'Valid' }; } }));
    const lostResult = await lost.result;
    await lost.acknowledgment;
    expect(lostResult.value.status).toBe('incomplete');
    expect(lostResult.value.fold.outcome.status).toBe('waiting');
    expect(lostResult.value.usage.unknown.length).toBeGreaterThan(0);
    expect(observation(lost).application).toEqual({ kind: 'incomplete', reasons: ['required-work'] });
  });

  test('an unsplittable capped search cannot certify an empty population or report', async () => {
    const narrow: IReportInputs = { ...baseInputs, scope: { ...baseInputs.scope, start: baseInputs.scope.end - 1 } };
    const fake = fixture({ github: async url => url.includes('/search/issues') ? { status: 200, headers: {}, body: { total_count: 1_001, incomplete_results: false, items: [] } } : undefined });
    const run = observed(fake, narrow);
    const result = await run.result;
    await run.acknowledgment;
    expect(result.value.status).toBe('incomplete');
    expect(result.value.fold.outcome.status).toBe('failed');
    expect('report' in result.value).toBe(false);
    expect(fake.assessments).toHaveLength(0);
    expect(observation(run).application).toEqual({ kind: 'incomplete', reasons: ['required-work'] });
  });

  test.each(['denied', 'cancelled'] as const)('fold %s at admission remains typed incomplete rather than confirming an empty report', async kind => {
    const fake = fixture();
    const run = observed(fake, { ...baseInputs, selected: [] }, { admission: { admit: request => request.step.slot === 'report' ? { kind, reason: 'test fold gate' } : { kind: 'admitted' } } });
    const result = await run.result;
    await run.acknowledgment;
    expect(result.value.status).toBe('incomplete');
    expect(result.value.fold.outcome.status).toBe(kind === 'denied' ? 'pending' : 'cancelled');
    expect('report' in result.value).toBe(false);
    expect(fake.requests).toHaveLength(0);
    expect(observation(run).application).toEqual({ kind: 'incomplete', reasons: ['publication'] });
  });

  test('open discovery and a cancelled required member expose their distinct typed reasons', async () => {
    const openFixture = fixture();
    const open = observed(openFixture, baseInputs, { admission: { admit: request => request.step.slot === 'roster' ? { kind: 'denied', reason: 'test discovery gate' } : { kind: 'admitted' } } });
    const openResult = await open.result;
    await open.acknowledgment;
    expect(openResult.value.status).toBe('incomplete');
    expect(openResult.value.fold.outcome).toMatchObject({ status: 'waiting', openDiscovery: true });
    expect(openFixture.requests).toHaveLength(0);
    expect(observation(open).application).toEqual({ kind: 'incomplete', reasons: ['coverage'] });
    const cancelledFixture = fixture();
    const cancelled = observed(cancelledFixture, baseInputs, { admission: { admit: request => request.step.slot === 'search' && request.step.memberKey === 'ada'
      ? { kind: 'cancelled', reason: 'test required member withdrawal' } : { kind: 'admitted' } } });
    const cancelledResult = await cancelled.result;
    await cancelled.acknowledgment;
    expect(cancelledResult.value.status).toBe('incomplete');
    expect(cancelledResult.value.fold.outcome).toMatchObject({ status: 'failed', cancelled: ['ada'] });
    expect(observation(cancelled).application).toEqual({ kind: 'incomplete', reasons: ['required-work'] });
  });

  test('unexpected strict request failure leaves classification absent with its original body error', async () => {
    const fake = fixture();
    const run = evaluateObservedReport(workspace, composeReport(baseInputs, fake.services), { environment: 'production', requestKey: '', observationLocation: join(directory, 'invalid-request.sqlite') });
    await expect(run.result).rejects.toThrow();
    expect(await run.acknowledgment).toMatchObject({ kind: 'acknowledged' });
    expect(observation(run)).toMatchObject({ body: 'threw', application: { kind: 'not-classified' } });
  });

  test('a strict report can confirm while current usage remains unknown', async () => {
    const fake = fixture();
    const assess = fake.services.assess;
    const withoutReports: IFixture = { ...fake, services: { ...fake.services, assess: async (request, send) => {
      const response = await assess(request, send);
      return response.kind === 'succeeded' ? { kind: 'succeeded', value: response.value } : response;
    } } };
    const run = observed(withoutReports);
    const result = await run.result;
    await run.acknowledgment;
    expect(result.value.status).toBe('complete');
    if (result.value.status !== 'complete' || result.value.fold.outcome.status !== 'succeeded') { throw new Error('Expected current strict completion'); }
    expect(result.value.usage.status).toBe('incomplete');
    expect(result.value.usage.unknown.length).toBeGreaterThan(0);
    expect(observation(run).application).toEqual({ kind: 'confirmed', deliverable: result.value.fold.outcome.outcome.reference.locator });
  });

  test('unrepresentable actual retained locator leaves complete report intact and observation unclassified', async () => {
    workspace.close();
    store = join(directory, 'long-history.sqlite');
    reportStore = 'long-report-store-' + 'x'.repeat(300);
    workspace = openWorkspace({ location: store, logicalStore: reportStore, accounting });
    const fake = fixture();
    const run = observed(fake);
    const result = await run.result;
    await run.acknowledgment;
    expect(result.value.status).toBe('complete');
    if (result.value.status !== 'complete' || result.value.fold.outcome.status !== 'succeeded') { throw new Error('Expected retained strict report'); }
    const actual = result.value.fold.outcome.outcome.reference.locator;
    expect(actual.length).toBeGreaterThan(256);
    expect(retained(result.value.fold.outcome)).toEqual(result.value.report);
    expect(fake.assessments).toHaveLength(4);
    expect(observation(run).application).toEqual({ kind: 'not-classified' });
  });

  test('a later unrelated read failure preserves the original error after strict report confirmation', async () => {
    const failure = new Error('later exact read failure');
    const failingWorkspace: IWorkspace = {
      ...workspace,
      startObserved(options, body) {
        return workspace.startObserved(options, (run, application) => body({ ...run, read: () => { throw failure; } }, application));
      },
    };
    const run = observed(fixture(), baseInputs, { workspace: failingWorkspace });
    await expect(run.result).rejects.toBe(failure);
    expect(await run.acknowledgment).toMatchObject({ kind: 'acknowledged' });
    expect(observation(run)).toMatchObject({ body: 'threw', application: { kind: 'confirmed', deliverable: expect.any(String) } });
    const history = openDurableHistory({ sqlite: createNodeSqlite(), clock: createNodeClock(), sha256: createNodeMachine(), location: store, logicalStore: reportStore });
    try { expect(history.findCandidates({ analysis: reportAnalysis, environment: 'production', subject: 'report', version: 1 })).toHaveLength(1); }
    finally { history.close(); }
  });

  test('later usage presentation failure also leaves the already retained report confirmed', async () => {
    const failure = new Error('later usage presentation failure');
    const failingWorkspace: IWorkspace = { ...workspace, startObserved(options, body) {
      return workspace.startObserved(options, (run, application) => body({ ...run, usage: () => { throw failure; } }, application));
    } };
    const run = observed(fixture(), baseInputs, { workspace: failingWorkspace });
    await expect(run.result).rejects.toBe(failure);
    expect(await run.acknowledgment).toMatchObject({ kind: 'acknowledged' });
    expect(observation(run)).toMatchObject({ body: 'threw', application: { kind: 'confirmed', deliverable: expect.any(String) } });
  });

  test('an oversized actual locator never replaces a later unrelated read error', async () => {
    workspace.close();
    store = join(directory, 'long-history.sqlite');
    reportStore = 'long-report-store-' + 'x'.repeat(300);
    workspace = openWorkspace({ location: store, logicalStore: reportStore, accounting });
    const failure = new Error('later read failed after oversized retained report');
    const failingWorkspace: IWorkspace = { ...workspace, startObserved(options, body) {
      return workspace.startObserved(options, (run, application) => body({ ...run, read: () => { throw failure; } }, application));
    } };
    const run = observed(fixture(), baseInputs, { workspace: failingWorkspace });
    await expect(run.result).rejects.toBe(failure);
    await run.acknowledgment;
    expect(observation(run)).toMatchObject({ body: 'threw', application: { kind: 'not-classified' } });
    const history = openDurableHistory({ sqlite: createNodeSqlite(), clock: createNodeClock(), sha256: createNodeMachine(), location: store, logicalStore: reportStore });
    try {
      const retainedReport = history.findCandidates({ analysis: reportAnalysis, environment: 'production', subject: 'report', version: 1 })[0];
      expect(retainedReport?.reference.locator.length).toBeGreaterThan(256);
    } finally { history.close(); }
  });

  test('mid-run and terminal observation write faults preserve the real report and never rerun analysis', async () => {
    const location = join(directory, 'execution-1.sqlite');
    let injected = false;
    let held = false;
    const fake = fixture({ github: async url => {
      if (url.includes('author%3Aada') && !held) { held = true; await new Promise(resolve => setTimeout(resolve, 1_250)); }
      return undefined;
    } });
    const run = observed(fake, baseInputs, { observers: [{ observe: () => {
      if (!injected) { refuseObservationUpdates(location); injected = true; }
    } }] });
    const result = await run.result;
    const acknowledgment = await run.acknowledgment;
    expect(injected).toBe(true);
    expect(result.value.status).toBe('complete');
    if (result.value.status !== 'complete' || result.value.fold.outcome.status !== 'succeeded') { throw new Error('Expected strict report despite observation fault'); }
    expect(retained(result.value.fold.outcome)).toEqual(result.value.report);
    expect(fake.requests).toHaveLength(24);
    expect(fake.assessments).toHaveLength(4);
    expect(acknowledgment.kind).toBe('uncertain');
    expect(acknowledgment).toMatchObject({ observationFaults: { count: expect.any(Number) } });
    expect(observation(run).phase).not.toBe('closed');
  });

  test('prepared-store refusal starts no application work and preserves independent unprepared acknowledgment', async () => {
    sequence += 1;
    const blocked = join(directory, 'occupied.sqlite');
    writeFileSync(blocked, 'foreign-file');
    const fake = fixture();
    const run = evaluateObservedReport(workspace, composeReport(baseInputs, fake.services), { environment: 'production', requestKey: 'blocked', observationLocation: blocked });
    await expect(run.result).rejects.toThrow();
    expect(await run.acknowledgment).toEqual({ kind: 'unprepared' });
    expect(fake.trace).toEqual([]);
    expect(fake.requests).toEqual([]);
    expect(existsSync(blocked)).toBe(true);
  });

  test('the normal entry keeps the same complete outcome without an observation artifact', async () => {
    const result = await evaluateReport(workspace, composeReport(baseInputs, fixture().services), { environment: 'production', requestKey: 'normal' });
    expect(result.value.status).toBe('complete');
    expect(result.value.fold.outcome.status).toBe('succeeded');
    expect(result.value.usage.requestAttempts).toBe(28);
    expect(existsSync(join(directory, 'execution-1.sqlite'))).toBe(false);
  });
});
