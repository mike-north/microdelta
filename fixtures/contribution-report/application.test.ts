/** The actual generated facade must compose source hooks, supervised acquisition and strict person boundaries. */
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, test } from '@jest/globals';
import { openDurableAccounting } from '@microdelta/accounting';
import type { IDurableAccounting } from '@microdelta/accounting';
import { createNodeSqlite } from '@microdelta/machine-node';
import { openWorkspace } from 'microdelta';
import type { ICompletedResultReference, IWorkspace } from 'microdelta';
import { composeReport, evaluateReport } from '../../examples/contribution-report/src/controlled/application.js';
import type { IControlledReport, IReportInputs } from '../../examples/contribution-report/src/controlled/application.js';
import { baseInputs, fixture } from './fixture.js';
import type { IFixture } from './fixture.js';

let directory: string;
let workspace: IWorkspace;
let accounting: IDurableAccounting;
let keys = 0;
beforeEach(() => { directory = mkdtempSync(join(tmpdir(), 'controlled-report-')); accounting = openDurableAccounting({ sqlite: createNodeSqlite(), location: join(directory, 'usage.sqlite'), logicalStore: 'controlled-usage' }); workspace = openWorkspace({ location: join(directory, 'history.sqlite'), logicalStore: 'controlled-history', accounting }); });
afterEach(() => { workspace.close(); accounting.close(); rmSync(directory, { recursive: true, force: true }); });
/** Outer body fulfillment is deliberately reported separately from the strict framework outcome. */
async function run(fake: IFixture, inputs: IReportInputs = baseInputs) {
  keys += 1;
  const application = composeReport(inputs, fake.services);
  return workspace.run({ authoring: application.authoring, composition: application.composition, environment: 'production', permits: 2, window: 2 }, async active => {
    const result = await active.resolveFold(application.report, { requestKey: `report:${String(keys)}` });
    return { result, usage: active.usage(), report: result.outcome.status === 'succeeded' ? active.read<IControlledReport>(result.outcome.outcome.reference) : undefined };
  });
}
/** Independent person references expose current reuse without trusting report text. */
function references(members: readonly { readonly key: string; readonly status: string; readonly outcome?: { readonly reference: ICompletedResultReference } }[]): Readonly<Record<string, string>> { return Object.fromEntries(members.flatMap(member => member.outcome === undefined ? [] : [[member.key, member.outcome.reference.locator]])); }

describe('controlled application through production generated facade', () => {
  test('endpoint completion alone cannot authorize historical assessment or quiet finality', async () => {
    const fake = fixture();
    const result = await run(fake, { ...baseInputs, contentBasis: { kind: 'unverified' } });
    expect(result.value.result.outcome.status).toBe('failed');
    expect(result.value.report).toBeUndefined();
    expect(fake.assessments).toHaveLength(0);
    const controlled = fixture();
    const completed = await run(controlled);
    expect(completed.value.report).toMatchObject({ contentBasis: { kind: 'controlled-as-of', scenario: 'fixture-base', cutoff: baseInputs.scope.cutoff } });
  });
  test('same local observation with a changed cutoff cannot relabel a prior controlled temporal guarantee', async () => {
    await run(fixture());
    const fake = fixture();
    const result = await run(fake, { ...baseInputs, scope: { ...baseInputs.scope, cutoff: baseInputs.scope.cutoff + 1 } });
    expect(result.value.result.outcome.status).toBe('failed');
    expect(result.value.report).toBeUndefined();
    expect(fake.assessments).toHaveLength(0);
  });
  test('concrete execution handoff classifies strict success separately from a fulfilled incomplete body', async () => {
    const complete = composeReport(baseInputs, fixture().services);
    const first = await evaluateReport(workspace, complete, { environment: 'production', requestKey: 'typed-complete' });
    expect(first.value.status).toBe('complete');
    const failed = composeReport(baseInputs, fixture({ github: async () => ({ status: 403, headers: {}, body: { private: 'must remain private' } }) }).services);
    const second = await evaluateReport(workspace, failed, { environment: 'production', requestKey: 'typed-incomplete' });
    expect(second.value.status).toBe('incomplete');
    expect('report' in second.value).toBe(false);
  });
  test('compatible shared PR calls share; differing consumed person context cannot alias', async () => {
    const sharedInputs = { ...baseInputs, csv: baseInputs.csv.replace('grace,grace,Grace', 'grace,ada,Grace') };
    const compatible = fixture({ ids: { ada: [101] } });
    const first = await run(compatible, sharedInputs);
    expect(first.value.result.outcome.status).toBe('succeeded');
    expect(compatible.assessments).toHaveLength(1);
    const differing = fixture({ ids: { ada: [101] } });
    const second = await run(differing, { ...sharedInputs, assessmentContexts: { ada: 'leadership', grace: 'individual' } });
    expect(second.value.result.outcome.status).toBe('succeeded');
    expect(differing.assessments).toHaveLength(2);
    expect(second.value.report?.people.map(person => person.score)).toEqual([3, 2]);
  });
  test('provisional current refresh changes consumed evidence only, while unread detail and equal score preserve exact parent', async () => {
    const inputs = { ...baseInputs, settling: { ...baseInputs.settling, quietSeconds: 1_000_000, closedDay: '2025-12-31' } };
    const first = await run(fixture(), inputs);
    const unread = fixture({ label: 'changed-unread-label' });
    const second = await run(unread, { ...inputs, scope: { ...inputs.scope, observation: 'observation-b' } });
    expect(references(second.value.result.members)).toEqual(references(first.value.result.members));
    expect(unread.trace.filter(event => event.startsWith('detail-body:'))).toHaveLength(4);
    expect(unread.assessments).toHaveLength(0);
    expect(unread.trace.filter(event => event.startsWith('summary-body:'))).toEqual([]);
    const changed = fixture({ merged: [102, 201, 202] });
    const third = await run(changed, { ...inputs, scope: { ...inputs.scope, observation: 'observation-c' } });
    expect(changed.assessments.map(request => request.id)).toEqual(['acme/widget#101']);
    expect(third.value.report?.people.map(person => person.score)).toEqual([3, 4]);
    expect(references(third.value.result.members).grace).toBe(references(first.value.result.members).grace);
    expect(references(third.value.result.members).ada).not.toBe(references(first.value.result.members).ada);
  });
  test('membership changes do not replay removed detail, and surviving assessments retain', async () => {
    const first = await run(fixture());
    const changed = fixture({ ids: { ada: [101, 103], grace: [201, 202] }, searchPageSize: 2 });
    const second = await run(changed);
    expect(second.value.report?.people.map(person => person.count)).toEqual([2, 2]);
    expect(changed.trace.filter(event => event.startsWith('detail-body:'))).toEqual(['detail-body:acme/widget#103']);
    expect(changed.trace.some(event => event.includes('#102'))).toBe(false);
    expect(changed.assessments.map(request => request.id)).toEqual(['acme/widget#103']);
    expect(references(second.value.result.members).grace).toBe(references(first.value.result.members).grace);
  });
  test('prompt/model/helper changes reexecute assessments but equal consumed scores retain strict people', async () => {
    const first = await run(fixture());
    for (const prompt of [{ ...baseInputs.prompt, text: 'New prompt' }, { ...baseInputs.prompt, model: 'other-model' }, { ...baseInputs.prompt, helperVersion: 'rubric-b' }]) {
      const changed = fixture();
      const next = await run(changed, { ...baseInputs, prompt });
      expect(changed.assessments).toHaveLength(4);
      expect(references(next.value.result.members)).toEqual(references(first.value.result.members));
      expect(changed.trace.filter(event => event.startsWith('summary-body:'))).toEqual([]);
    }
  });
  test('two fresh paginated searches complete before each person details and assessments; exact strict population', async () => {
    const fake = fixture();
    const result = await run(fake);
    expect(result.value.result.outcome.status).toBe('succeeded');
    expect(result.value.report).toMatchObject({ population: 'authored-prs', coverageBasis: 'fixed-controlled-dataset', selected: ['ada', 'grace'], people: [{ key: 'ada', count: 2, score: 4, status: 'contributions' }, { key: 'grace', count: 2, score: 4, status: 'contributions' }] });
    expect(fake.requests.filter(request => request.url.includes('/search/issues'))).toHaveLength(4);
    expect(fake.requests).toHaveLength(24);
    expect(fake.assessments.map(request => request.id).sort()).toEqual(['acme/widget#101', 'acme/widget#102', 'acme/widget#201', 'acme/widget#202']);
    expect(fake.trace.indexOf('search-complete:ada')).toBeLessThan(fake.trace.indexOf('discussion-body:acme/widget#101'));
    expect(fake.trace.indexOf('search-complete:grace')).toBeLessThan(fake.trace.indexOf('discussion-body:acme/widget#201'));
    expect(result.value.usage).toMatchObject({ requestAttempts: 28, reports: 4, observed: [{ unit: 'tokens', amount: 40 }] });
  });
  test('current source hooks retain settled evidence and exact person references while search reestablishes membership', async () => {
    const first = await run(fixture());
    const fake = fixture();
    const next = await run(fake);
    expect(references(next.value.result.members)).toEqual(references(first.value.result.members));
    expect(fake.trace.filter(event => /^(?:detail|discussion)-hook:/u.test(event))).toHaveLength(8);
    expect(fake.trace.filter(event => /^(?:detail|discussion|assessment|summary)-body:/u.test(event))).toEqual([]);
    expect(fake.requests).toHaveLength(4);
    expect(fake.assessments).toHaveLength(0);
  });
  test('certified empty yields no contributions; malformed discovery cannot manufacture strict success', async () => {
    const empty = fixture({ ids: { ada: [], grace: [] } });
    const result = await run(empty);
    expect(result.value.report?.people).toEqual([{ key: 'ada', name: 'Ada', count: 0, score: 0, status: 'no-contributions' }, { key: 'grace', name: 'Grace', count: 0, score: 0, status: 'no-contributions' }]);
    expect(empty.assessments).toHaveLength(0);
    const failed = fixture({ github: async url => url.includes('author%3Aada') ? { status: 200, headers: {}, body: { total_count: 0, incomplete_results: true, items: [] } } : undefined });
    const incomplete = await run(failed);
    expect(incomplete.value.result.outcome.status).toBe('failed');
    expect(incomplete.value.report).toBeUndefined();
    expect(incomplete.value.result.members.find(member => member.key === 'grace')?.status).toBe('succeeded');
  });
  test('search, discussion, detail and assessment all consume one configured fixed request gate', async () => {
    const fake = fixture({ requestLimit: 1, intervalMilliseconds: 8, ids: { ada: [101] } });
    const result = await run(fake, { ...baseInputs, selected: ['ada'] });
    expect(result.value.result.outcome.status).toBe('succeeded');
    expect(fake.requests).toHaveLength(6);
    expect(fake.assessments).toHaveLength(1);
    expect(result.value.usage.requestAttempts).toBe(7);
    // A bypassed path would send within the closed rolling interval.
    const sends = [...fake.requests.map(request => request.at), ...fake.trace.filter(event => event.startsWith('assessment-send:')).map(event => Number(event.slice('assessment-send:'.length)))].sort((a, b) => a - b);
    expect(sends).toHaveLength(7);
    for (let index = 1; index < sends.length; index += 1) { expect((sends[index] ?? 0) - (sends[index - 1] ?? 0)).toBeGreaterThanOrEqual(7); }
  });
});
