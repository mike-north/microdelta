/** CR-4/5 and failure/privacy outcomes belong to this report, beyond the component policy helpers. */
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, test } from '@jest/globals';
import { openDurableAccounting } from '@microdelta/accounting';
import type { IDurableAccounting } from '@microdelta/accounting';
import { openDurableHistory } from '@microdelta/history';
import type { IDurableHistory } from '@microdelta/history';
import { createNodeClock, createNodeMachine, createNodeSqlite } from '@microdelta/machine-node';
import { openWorkspace } from 'microdelta';
import type { IRunEvent, IWorkspace } from 'microdelta';
import { composeReport, evaluateReport, reportAnalysis } from '../src/controlled/application.js';
import type { IReportInputs, IReportServices } from '../src/controlled/application.js';
import { baseInputs, fixture } from './fixture.js';
import type { IFixture } from './fixture.js';

let directory: string;
let accounting: IDurableAccounting;
let workspace: IWorkspace;
let history: IDurableHistory;
let keys = 0;
beforeEach(() => { directory = mkdtempSync(join(tmpdir(), 'controlled-settling-')); accounting = openDurableAccounting({ sqlite: createNodeSqlite(), location: join(directory, 'usage.sqlite'), logicalStore: 'controlled-usage' }); workspace = openWorkspace({ location: join(directory, 'history.sqlite'), logicalStore: 'controlled-history', accounting }); history = openDurableHistory({ sqlite: createNodeSqlite(), clock: createNodeClock(), sha256: createNodeMachine(), location: join(directory, 'history.sqlite'), logicalStore: 'controlled-history' }); });
afterEach(() => { workspace.close(); history.close(); accounting.close(); rmSync(directory, { recursive: true, force: true }); });
/** The declared current policy is supplied afresh; no accepted answer is copied from an earlier run. */
async function run(fake: IFixture, inputs: IReportInputs = baseInputs) {
  keys += 1;
  const events: IRunEvent[] = [];
  const application = composeReport(inputs, fake.services);
  const result = await evaluateReport(workspace, application, { environment: 'production', requestKey: `settling:${String(keys)}`, permits: 2, window: 2, observers: [{ observe: event => events.push(event) }] });
  return { ...result, events };
}
/** Current accepted references are compared with immutable History, never inferred from body counts alone. */
function exact(subject: string) {
  const envelope = history.findCandidates({ analysis: reportAnalysis, environment: 'production', subject, version: 1 })[0];
  if (envelope === undefined) { throw new Error(`Expected durable subject ${subject}`); }
  return { envelope, data: history.reader.readSubtree(envelope.reference, []) };
}

describe('independent quiet/daily report sources', () => {
  test.each(['quiet-final', 'daily-final'] as const)('%s does not imply global finality; advanced observation refreshes only the independently provisional source', async mode => {
    const inputs: IReportInputs = { ...baseInputs, settling: mode === 'quiet-final' ? { ...baseInputs.settling, closedDay: '2025-12-31' } : { ...baseInputs.settling, quietSeconds: 1_000_000 } };
    const first = await run(fixture(), inputs);
    expect(first.value.status).toBe('complete');
    const detail = exact('detail:acme/widget#101'); const discussion = exact('discussion:acme/widget#101'); const person = exact('summary:ada');
    const fake = fixture();
    const second = await run(fake, { ...inputs, scope: { ...inputs.scope, observation: 'observation-b' } });
    expect(second.value.status).toBe('complete');
    expect(fake.trace.filter(event => event.startsWith('discussion-body:'))).toHaveLength(mode === 'quiet-final' ? 4 : 0);
    expect(fake.trace.filter(event => event.startsWith('detail-body:'))).toHaveLength(mode === 'daily-final' ? 4 : 0);
    expect(exact('detail:acme/widget#101').envelope.reference).toEqual(mode === 'quiet-final' ? detail.envelope.reference : expect.not.objectContaining({ locator: detail.envelope.reference.locator }));
    expect(exact('discussion:acme/widget#101').envelope.reference).toEqual(mode === 'daily-final' ? discussion.envelope.reference : expect.not.objectContaining({ locator: discussion.envelope.reference.locator }));
    expect(exact('summary:ada').envelope.reference).toEqual(person.envelope.reference);
    expect(fake.assessments).toHaveLength(0);
  });
  test('late relevant comment arrival on advanced observation revokes affected quietness while equal assessed score retains exact person', async () => {
    const inputs = { ...baseInputs, settling: { ...baseInputs.settling, closedDay: '2025-12-31' } };
    await run(fixture(), inputs);
    const originalDetail = exact('detail:acme/widget#101'); const unaffected = exact('detail:acme/widget#201'); const person = exact('summary:ada');
    const fake = fixture({ github: async url => url.includes('/issues/101/comments') ? { status: 200, headers: {}, body: [{ id: 1, body: 'Late-arriving evidence', user: { login: 'commenter' }, created_at: '2026-01-02T23:30:00Z', updated_at: '2026-01-02T23:30:00Z' }] } : undefined });
    const next = await run(fake, { ...inputs, scope: { ...inputs.scope, observation: 'observation-b' } });
    expect(next.value.status).toBe('complete');
    expect(fake.trace.filter(event => event.startsWith('detail-body:'))).toEqual(['detail-body:acme/widget#101']);
    expect(fake.assessments.map(request => request.id)).toEqual(['acme/widget#101']);
    expect(exact('detail:acme/widget#101').envelope.reference).not.toEqual(originalDetail.envelope.reference);
    expect(exact('detail:acme/widget#201')).toEqual(unaffected);
    expect(exact('summary:ada').envelope.reference).toEqual(person.envelope.reference);
    expect(history.reader.readSubtree(originalDetail.envelope.reference, [])).toEqual(originalDetail.data);
  });
  test.each(['quiet', 'daily'] as const)('changing only %s source policy invalidates its affected evidence while the unrelated source remains exact', async kind => {
    await run(fixture());
    const detail = exact('detail:acme/widget#101'); const discussion = exact('discussion:acme/widget#101'); const person = exact('summary:ada');
    const fake = fixture();
    const settling = kind === 'quiet' ? { ...baseInputs.settling, quietVersion: 'quiet-b', quietSeconds: 1_000_000 } : { ...baseInputs.settling, dailyVersion: 'daily-b', closedDay: '2025-12-31' };
    await run(fake, { ...baseInputs, settling });
    expect(fake.trace.filter(event => event.startsWith('detail-body:'))).toHaveLength(kind === 'quiet' ? 4 : 0);
    expect(fake.trace.filter(event => event.startsWith('discussion-body:'))).toHaveLength(kind === 'daily' ? 4 : 0);
    if (kind === 'quiet') { expect(exact('discussion:acme/widget#101')).toEqual(discussion); }
    else { expect(exact('detail:acme/widget#101')).toEqual(detail); }
    expect(exact('summary:ada').envelope.reference).toEqual(person.envelope.reference);
  });
  test.each(['open', 'recent', 'future'] as const)('%s relevant evidence cannot become quietly final on unchanged PR identity', async kind => {
    const options = { ...(kind === 'open' ? { merged: [102, 201, 202] } : {}), github: async (url: string) => kind !== 'open' && url.includes('/issues/101/comments') ? { status: 200, headers: {}, body: [{ id: 1, body: 'Relevant activity', user: { login: 'commenter' }, created_at: kind === 'recent' ? '2026-01-02T23:30:00Z' : '2026-01-04T00:00:00Z', updated_at: kind === 'recent' ? '2026-01-02T23:30:00Z' : '2026-01-04T00:00:00Z' }] } : undefined };
    await run(fixture(options));
    const fake = fixture(options);
    await run(fake);
    expect(fake.trace.filter(event => event.startsWith('detail-body:'))).toEqual(['detail-body:acme/widget#101']);
    expect(fake.assessments).toHaveLength(0);
  });
});

describe('strict failure, unknown usage and public privacy', () => {
  test('malformed assessment output cannot publish reusable assessment/person success or hide an acknowledged model bill', async () => {
    const fake = fixture({ assess: async request => request.id.endsWith('#101') ? { score: 'fabricated', explanation: 'PRIVATE_MODEL_BODY' } : { score: 2, explanation: 'Valid' } });
    const result = await run(fake);
    expect(result.value.status).toBe('incomplete'); expect(result.value.fold.outcome.status).toBe('failed');
    expect(result.value.fold.members.find(person => person.key === 'grace')?.status).toBe('succeeded');
    expect(history.findCandidates({ analysis: reportAnalysis, environment: 'production', subject: 'assessment:acme/widget#101', version: 1 })).toEqual([]);
    expect(history.findCandidates({ analysis: reportAnalysis, environment: 'production', subject: 'summary:ada', version: 1 })).toEqual([]);
    expect(result.value.usage.reports).toBe(3); expect(result.value.usage.observed).toEqual([{ unit: 'tokens', amount: 30 }]);
  });
  test('lost model responses preserve previous readable work, honest usage gaps and incomplete Ada; fresh allowance completes later', async () => {
    await run(fixture());
    const previousAda = exact('summary:ada');
    const inputs = { ...baseInputs, prompt: { ...baseInputs.prompt, weight: 2 } };
    const lost = fixture({ assess: async request => { if (request.id.endsWith('#101')) { throw new Error('PRIVATE_LOST_MODEL'); } return { score: 4, explanation: 'Valid' }; } });
    const failed = await run(lost, inputs);
    expect(failed.value.status).toBe('incomplete'); expect(failed.value.fold.outcome.status).toBe('waiting');
    expect(lost.assessments.filter(request => request.id.endsWith('#101'))).toHaveLength(2);
    expect(failed.value.fold.members.find(person => person.key === 'grace')?.status).toBe('succeeded');
    expect(exact('summary:ada')).toEqual(previousAda);
    expect(failed.value.usage.unknown.length).toBeGreaterThan(0);
    const resumed = fixture();
    const result = await run(resumed, inputs);
    expect(result.value.status).toBe('complete');
    if (result.value.status === 'complete') { expect(result.value.report.people.map(person => person.score)).toEqual([8, 8]); }
    expect(resumed.assessments.map(request => request.id)).toEqual(['acme/widget#101', 'acme/widget#102']);
    expect(result.value.usage.unknown.length).toBeGreaterThan(0);
  });
  test('synthetic credentials, private content and assessment context stay out of public identities/events/report/diagnostics; missing usage stays unknown', async () => {
    const original = fixture({ assess: async () => ({ score: 2, explanation: 'PRIVATE_MODEL_RESPONSE' }) });
    const services: IReportServices = { ...original.services, github: async (url, accept, send) => {
      const response = await original.services.github(url, accept, send);
      return { ...response, headers: { ...response.headers, authorization: 'PRIVATE_AUTH_TOKEN', 'x-private-header': 'PRIVATE_HEADER' } };
    } };
    const fake = { ...original, services };
    const result = await run(fake, { ...baseInputs, assessmentContexts: { ada: 'PRIVATE_CONTEXT', grace: 'PRIVATE_CONTEXT' } });
    expect(result.value.status).toBe('complete');
    const publicFacts = JSON.stringify({ events: result.events, diagnostics: result.diagnostics, trace: fake.trace, report: result.value.status === 'complete' ? result.value.report : undefined });
    expect(publicFacts).not.toMatch(/PRIVATE_AUTH_TOKEN|PRIVATE_HEADER|PRIVATE_CONTEXT|PRIVATE_MODEL_RESPONSE|authorization/u);
    expect(result.value.usage.unknown.length).toBe(24);
    expect(result.value.usage.status).toBe('incomplete');
  });
});
