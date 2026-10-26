/** Generated application declarations preserve concrete inputs, strict outcomes and the production facade's source-call boundary. */
import { expectError, expectType } from 'tsd';
import { authoring } from 'microdelta';
import type { IOperationSend, ITrackedView, IWorkspace } from 'microdelta';
import { composeReport, evaluateReport } from '../.test-build/src/controlled/application.js';
import type { IAssessmentRequest, IReportApplication, IReportInputs, IReportRunOutcome, IReportServices } from '../.test-build/src/controlled/application.js';
import type { IPullDetail } from '../.test-build/src/controlled/evidence.js';

declare const inputs: IReportInputs;
declare const services: IReportServices;
declare const workspace: IWorkspace;
declare const send: IOperationSend;
expectType<IReportApplication>(composeReport(inputs, services));
expectError(composeReport({ ...inputs, selected: [101] }, services));
expectError(composeReport({ ...inputs, scope: { ...inputs.scope, cutoff: 'yesterday' } }, services));
declare const request: IAssessmentRequest;
expectError(services.assess({ id: request.id, title: request.title, body: request.body, diff: request.diff, merged: request.merged, reviewBodies: [], commentBodies: [], inlineBodies: [], prompt: request.prompt }, send));
const result = await evaluateReport(workspace, composeReport(inputs, services), { environment: 'production', requestKey: 'type-contract' });
expectType<IReportRunOutcome>(result.value);
if (result.value.status === 'complete') { expectType<'authored-prs'>(result.value.report.population); }
else { expectError(result.value.report); }
expectError(evaluateReport(workspace, composeReport(inputs, services), { requestKey: 'missing-environment' }));

const api = authoring<Record<never, never>, Record<never, never>>();
const detail = api.sourceSlot<readonly [string], IPullDetail>({ slot: 'detail' });
expectError(api.suppliedSource<readonly [string], IPullDetail>({ run: () => ({ id: 'acme/widget#101', title: '', body: '', diff: '', merged: false, terminalAt: null, latestActivity: 0, complete: true, labels: [] }) }));
const source = api.suppliedSource<readonly [string], IPullDetail>({ run: ({ outcome, args }) => outcome.fresh<IPullDetail>({ id: args[0], title: '', body: '', diff: '', merged: false, terminalAt: null, latestActivity: 0, complete: true, labels: [] }) });
const memo = api.suppliedStep<readonly [string], IPullDetail>({ run: ({ args }) => ({ id: args[0], title: '', body: '', diff: '', merged: false, terminalAt: null, latestActivity: 0, complete: true, labels: [] }) });
expectError(api.supplySource({ slot: detail, declaration: memo, subject: () => 'wrong-kind' }));
void api.supplySource({ slot: detail, declaration: source, subject: ([id]) => `detail:${String(id)}` });
const parent = api.memo({ subject: 'parent', children: { detail }, run: async ({ calls }) => { const child = await calls.detail('acme/widget#101'); return { title: child.data.title }; } });
declare const calls: Parameters<typeof parent.run>[0]['calls'];
declare const childData: Awaited<ReturnType<typeof calls.detail>>['data'];
expectType<ITrackedView<IPullDetail>>(childData);
expectError(calls.detail(101));
