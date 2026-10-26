/** Harness-only fixed dataset and transport ledger. The application sees only REST responses, never this backing set. */
import { createHash } from 'node:crypto';
import { registerSharedRateSurface } from 'microdelta';
import type { IOperationSend, ISharedRateSurfaceDeclaration } from 'microdelta';
import type { IAssessmentRequest, IReportInputs, IReportServices } from '../../examples/contribution-report/src/controlled/application.js';
import type { IRestResponse } from '../../examples/contribution-report/src/controlled/github.js';

/** Four independently expected PRs split evenly across two selected people. */
export const baseInputs: IReportInputs = {
  csv: 'employee_id,github_login,name,active\nada,ada,Ada,true\ngrace,grace,Grace,true\n', selected: ['ada', 'grace'],
  scope: { repositories: ['acme/widget'], start: 1_767_225_600, end: 1_767_398_400, cutoff: 1_767_398_400, observation: 'observation-a' },
  prompt: { text: 'Assess the contribution', model: 'controlled-model', weight: 1, helperVersion: 'rubric-a' },
  settling: { quietSeconds: 3_600, quietVersion: 'quiet-a', closedDay: '2026-01-02', dailyVersion: 'daily-a' },
  contentBasis: { kind: 'controlled-as-of', scenario: 'fixture-base', cutoff: 1_767_398_400 },
};
/** Wire mutation controls live only in the remote harness, independently from assessment expectations. */
export interface IFixtureOptions { readonly ids?: Readonly<Record<string, readonly number[]>>; readonly merged?: readonly number[]; readonly label?: string; readonly diff?: string; readonly searchPageSize?: number; readonly access?: string; readonly environment?: string; readonly requestLimit?: number; readonly intervalMilliseconds?: number; readonly github?: (url: string, send: IOperationSend) => Promise<IRestResponse | undefined>; readonly assess?: (request: IAssessmentRequest, send: IOperationSend) => Promise<unknown> }
/** Independent request, operation and source/body evidence. */
export interface IFixture { readonly services: IReportServices; readonly trace: string[]; readonly requests: { readonly url: string; readonly operation: string; readonly attempt: string; readonly at: number }[]; readonly assessments: IAssessmentRequest[] }
/** Unique access domains keep one test's configured shared ledger independent from another. */
let fixtures = 0;
/** Build a transport from a fixed synthetic distribution; it exposes no manifest endpoint. */
export function fixture(options: IFixtureOptions = {}): IFixture {
  fixtures += 1;
  const access = options.access ?? `fixture:${String(fixtures)}`;
  const trace: string[] = [];
  const requests: IFixture['requests'] = [];
  const assessments: IAssessmentRequest[] = [];
  const gates: ISharedRateSurfaceDeclaration['gates'] = [{ id: 'api', ...(options.requestLimit === undefined ? {} : { limit: { units: options.requestLimit, intervalMilliseconds: options.intervalMilliseconds ?? 25, costBasis: 'requests' } }) }];
  const shared = registerSharedRateSurface({ environment: options.environment ?? 'production', service: 'controlled', accessContext: access, surface: 'github-and-assessment', gates });
  const services: IReportServices = {
    githubRate: { surface: shared, cooldownGateId: 'api' }, assessmentRate: { surface: shared, cooldownGateId: 'api' }, connection: access,
    retry: { maxAttempts: 2, backoffMilliseconds: 0 }, digest: value => createHash('sha256').update(value).digest('hex'), now: () => Date.now(), trace: event => trace.push(event),
    async github(value, accept, send) {
      requests.push({ url: value, operation: send.operation, attempt: send.requestAttempt, at: Date.now() });
      const scripted = await options.github?.(value, send); if (scripted !== undefined) { return scripted; }
      const url = new URL(value);
      if (url.pathname === '/search/issues') {
        const q = url.searchParams.get('q') ?? '';
        const login = /author:([^ ]+)/u.exec(q)?.[1] ?? '';
        const ids = options.ids?.[login] ?? (login === 'ada' ? [101, 102] : [201, 202]);
        const page = Number(url.searchParams.get('page'));
        const size = options.searchPageSize ?? 1;
        const selected = ids.slice((page - 1) * size, page * size);
        const following = new URL(value); following.searchParams.set('page', String(page + 1));
        return { status: 200, headers: page * size >= ids.length ? {} : { link: `<${following.toString()}>; rel="next"` }, body: { total_count: ids.length, incomplete_results: false, items: selected.map(number => ({ id: 10_000 + number, node_id: `issue-${String(number)}`, number, repository_url: 'https://api.github.com/repos/acme/widget', created_at: '2026-01-01T12:00:00Z', user: { login }, pull_request: { url: `https://api.github.com/repos/acme/widget/pulls/${String(number)}` } })) } };
      }
      const number = Number(/\/(?:pulls|issues)\/([0-9]+)/u.exec(url.pathname)?.[1]);
      if (url.pathname.endsWith('/reviews')) { return { status: 200, headers: {}, body: [{ id: number, body: 'Review evidence', state: 'APPROVED', submitted_at: '2026-01-01T14:00:00Z', user: { login: 'reviewer' }, commit_id: 'abc' }] }; }
      if (url.pathname.endsWith('/comments')) { return { status: 200, headers: {}, body: [{ id: number, body: 'Comment evidence', created_at: '2026-01-01T15:00:00Z', updated_at: '2026-01-01T15:00:00Z', user: { login: 'commenter' } }] }; }
      if (accept === 'application/vnd.github.diff') { return { status: 200, headers: {}, body: options.diff ?? '+ widget fix' }; }
      const merged = options.merged?.includes(number) ?? true;
      return { status: 200, headers: {}, body: { id: number + 20_000, number, base: { repo: { full_name: 'acme/widget' } }, title: `PR ${String(number)}`, body: 'Description', state: merged ? 'closed' : 'open', created_at: '2026-01-01T12:00:00Z', updated_at: '2026-01-01T13:00:00Z', closed_at: merged ? '2026-01-01T13:00:00Z' : null, merged_at: merged ? '2026-01-01T13:00:00Z' : null, labels: [{ name: options.label ?? 'unread' }] } };
    },
    async assess(request, send) {
      assessments.push(request);
      const output = await options.assess?.(request, send) ?? { score: (request.merged ? 2 : 1) * request.prompt.weight + (request.diff.includes('major') ? 1 : 0) + (request.context === 'leadership' ? 1 : 0), explanation: `Synthetic assessment${request.context.length > 0 ? ' with role context' : ''}` };
      trace.push(`assessment-send:${String(Date.now())}`);
      return { kind: 'succeeded', value: output, usage: { report: send.requestAttempt, quantities: [{ unit: 'tokens', amount: 10 }] } };
    },
  };
  return { services, trace, requests, assessments };
}
