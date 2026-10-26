/** Fixed contribution-report composition: provider evidence remains source-owned and assessment is independently retained. */
import { authoring, currentExecution } from 'microdelta';
import type { IAuthoring, IComposition, IFoldEntry, IFoldReport, IOperationResponse, IOperationSend, IOperationSharedRate, IResultView, IRunResult, IStepDescriptor, ITrackedView, IUsageSummary, IWorkspace, IWorkspaceRunOptions } from 'microdelta';
import { loadDiscussion, loadPull } from './evidence.js';
import type { IContentBasis, IDiscussion, IDiscussionEntry, IPullDetail } from './evidence.js';
import { discoverAuthored } from './github.js';
import type { ICompletedSearch } from './github.js';
import type { IRestResponse } from './github.js';
import { dailyCoverage, parseRoster, quietFinal, selectPeople, validateAssessment, validateScope } from './model.js';
import type { IAssessment, IPerson } from './model.js';
import type { IReportScope } from './model.js';

/** Application-selected prompt/model/helper values must participate in assessment dependency evidence. @internal */
export interface IPrompt { readonly text: string; readonly model: string; readonly weight: number; readonly helperVersion: string }
/** Independent provider policies remain explicit application inputs. @internal */
export interface ISettling { readonly quietSeconds: number; readonly quietVersion: string; readonly closedDay: string; readonly dailyVersion: string }
/** Current HR, explicit population and report bounds are declared before any person work. @internal */
export interface IReportInputs { readonly csv: string; readonly selected: readonly string[]; readonly scope: IReportScope; readonly prompt: IPrompt; readonly settling: ISettling; readonly assessmentContexts?: Readonly<Record<string, string>>; readonly contentBasis?: IContentBasis }
/** The model receives only consumed evidence and tracked configuration, never an entire tracked source copy. @internal */
export interface IAssessmentRequest { readonly id: string; readonly title: string; readonly body: string; readonly diff: string; readonly merged: boolean; readonly reviewBodies: readonly string[]; readonly commentBodies: readonly string[]; readonly inlineBodies: readonly string[]; readonly prompt: IPrompt; readonly context: string }
/** Host hashing/clock, configured rate association and remote effects are injected at assembly. @internal */
export interface IReportServices {
  readonly githubRate: IOperationSharedRate;
  /** Search can name a narrower authoritative cooldown while still carrying every mandatory API gate. */
  readonly githubSearchRate?: IOperationSharedRate;
  readonly assessmentRate: IOperationSharedRate;
  readonly connection: string;
  readonly retry: { readonly maxAttempts: number; readonly backoffMilliseconds: number };
  digest(value: string): string;
  now(): number;
  trace(event: string): void;
  github(url: string, accept: 'application/vnd.github.diff' | undefined, send: IOperationSend): Promise<IRestResponse>;
  assess(request: IAssessmentRequest, send: IOperationSend): Promise<IOperationResponse<unknown>>;
}
/** Strict per-person outcome names exactly the exhausted authored-PR population. @internal */
export interface IPersonSummary { readonly key: string; readonly name: string; readonly count: number; readonly score: number; readonly status: 'contributions' | 'no-contributions' }
/** Report coverage is explicit; framework fold coverage remains authoritative for completion. @internal */
export interface IControlledReport { readonly population: 'authored-prs'; readonly coverageBasis: 'fixed-controlled-dataset'; readonly contentBasis: IContentBasis; readonly scope: IReportScope; readonly selected: readonly string[]; readonly people: readonly IPersonSummary[] }
/** The example's declared helper capability; no generic framework is introduced. @internal */
export interface IReportHelpers {
  readonly roster: (csv: string, selected: ITrackedView<readonly string[]>) => IRoster;
  readonly acceptRoster: (csv: string, selected: ITrackedView<readonly string[]>) => boolean;
  readonly search: (person: ITrackedView<IPerson>, scope: ITrackedView<IReportScope>) => Promise<ICompletedSearch>;
  readonly fetchDiscussion: (id: string, scope: ITrackedView<IReportScope>, policy: string, basis: ITrackedView<IContentBasis> | undefined) => Promise<IDiscussion>;
  readonly fetchDetail: (id: string, scope: ITrackedView<IReportScope>, policy: string) => Promise<IPullDetail>;
  readonly acceptDiscussion: (data: ITrackedView<IDiscussion>, scope: ITrackedView<IReportScope>, settling: ITrackedView<ISettling>) => boolean;
  readonly acceptDetail: (data: ITrackedView<IPullDetail>, discussion: ITrackedView<IDiscussion>, scope: ITrackedView<IReportScope>, settling: ITrackedView<ISettling>) => boolean;
  readonly assess: (id: string, detail: ITrackedView<IPullDetail>, discussion: ITrackedView<IDiscussion>, prompt: ITrackedView<IPrompt>, context: string) => Promise<IAssessment>;
  readonly summary: (person: ITrackedView<IPerson>, count: number, score: number) => IPersonSummary;
  readonly render: (members: readonly IFoldEntry<IResultView<IPersonSummary>>[], scope: ITrackedView<IReportScope>, selected: ITrackedView<readonly string[]>, basis: ITrackedView<IContentBasis> | undefined) => IControlledReport;
  /** A missing member cannot shorten the required population or become an implicit skip. */
  readonly invalidPopulation: () => never;
}
/** Closed selected HR population; provider discovery is independently completed beneath each person. */
interface IRoster { readonly status: 'complete'; readonly members: readonly IPerson[] }
/** Builders and frozen strict report address are the later executable's concrete handoff. @internal */
export interface IReportApplication { readonly authoring: IAuthoring<IReportInputs, IReportHelpers>; readonly composition: IComposition<IReportInputs, IReportHelpers>; readonly report: IStepDescriptor }
/** Strict success is a framework outcome, distinct from an outer fulfilled JavaScript body. @internal */
export type IReportRunOutcome =
  | { readonly status: 'complete'; readonly report: IControlledReport; readonly fold: IFoldReport; readonly usage: IUsageSummary }
  | { readonly status: 'incomplete'; readonly fold: IFoldReport; readonly usage: IUsageSummary };
/** Existing runtime options remain caller-selected; this function makes no executable/lifetime decision. @internal */
export type IReportExecutionOptions = Omit<IWorkspaceRunOptions<IReportInputs, IReportHelpers>, 'authoring' | 'composition'> & { readonly requestKey: string };
/** Execute the fixed report and preserve strict completion, source failures and usage gaps as distinct facts. @internal */
export function evaluateReport(workspace: IWorkspace, application: IReportApplication, options: IReportExecutionOptions): Promise<IRunResult<IReportRunOutcome>> {
  const { requestKey, ...runOptions } = options;
  return workspace.run({ ...runOptions, authoring: application.authoring, composition: application.composition }, async run => {
    const fold = await run.resolveFold(application.report, { requestKey });
    return fold.outcome.status === 'succeeded' ? { status: 'complete', report: run.read<IControlledReport>(fold.outcome.outcome.reference), fold, usage: run.usage() }
      : { status: 'incomplete', fold, usage: run.usage() };
  });
}
/** Stable analysis identity is independent of input observation, pagination or filesystem location. @internal */
export const reportAnalysis = 'controlled-contribution-report';
/** Declare the fixed possible graph before any remote response instantiates people or PR calls. @internal */
export function composeReport(inputs: IReportInputs, services: IReportServices): IReportApplication {
  validateScope(inputs.scope);
  selectPeople(parseRoster(inputs.csv), inputs.selected);
  /** Every HTTP representation, including continuation pages, uses the runtime's existing operation authority. */
  const transport = (url: string, accept?: 'application/vnd.github.diff'): Promise<IRestResponse> => currentExecution().operation<IRestResponse>({
    name: url.includes('/search/issues?') ? 'github-search' : 'github-detail', binding: services.digest(JSON.stringify([url, accept ?? 'json'])),
    sharedRate: url.includes('/search/issues?') ? services.githubSearchRate ?? services.githubRate : services.githubRate, retry: services.retry,
    retrySource: { source: 'controlled-github-rest', service: 'controlled', connection: services.connection },
    perform: async send => normalizeGithub(await services.github(url, accept, send), services.now()),
  });
  const helpers: IReportHelpers = {
    roster: (csv, selected) => { services.trace('roster-body'); return { status: 'complete', members: selectPeople(parseRoster(csv), strings(selected)) }; },
    acceptRoster: (csv, selected) => { services.trace('roster-hook'); selectPeople(parseRoster(csv), strings(selected)); return true; },
    async search(person, scope) {
      services.trace(`search-start:${person.key}`);
      const ids: string[] = [];
      for (let index = 0; index < scope.repositories.length; index += 1) {
        const repository = scope.repositories[index];
        if (repository === undefined) { throw new Error('incomplete selected population'); }
        const found = await discoverAuthored({ repository, login: person.login, start: scope.start, end: Math.min(scope.end, scope.cutoff), perPage: 100 }, transport);
        ids.push(...found.ids);
      }
      ids.sort(compareIds);
      services.trace(`search-complete:${person.key}`);
      return { count: ids.length, ids };
    },
    fetchDiscussion: (id, scope, _policy, basis) => { services.trace(`discussion-body:${id}`); return loadDiscussion(id, scope, transport, basis); },
    fetchDetail: (id, scope, _policy) => { services.trace(`detail-body:${id}`); return loadPull(id, scope, transport); },
    acceptDiscussion(data, scope, settling) {
      services.trace(`discussion-hook:${data.id}`);
      const coverage = dailyCoverage(scope.start, Math.min(scope.end, scope.cutoff), settling.closedDay);
      return data.complete && coverage.provisional[0] === coverage.provisional[1];
    },
    acceptDetail(data, discussion, scope, settling) {
      services.trace(`detail-hook:${data.id}`);
      return discussion.contentBasis.kind === 'controlled-as-of' && discussion.contentBasis.cutoff === scope.cutoff
        && quietFinal({ terminalAt: data.terminalAt, latestActivity: Math.max(data.latestActivity, discussion.latestActivity), complete: data.complete && discussion.complete }, scope.cutoff, settling.quietSeconds);
    },
    async assess(id, detail, discussion, prompt, context) {
      if (discussion.contentBasis.kind !== 'controlled-as-of') { throw new Error('unverified historical content'); }
      services.trace(`assessment-body:${id}`);
      const request: IAssessmentRequest = { id, title: detail.title, body: detail.body, diff: detail.diff, merged: detail.merged, context,
        reviewBodies: bodies(discussion.reviews), commentBodies: bodies(discussion.comments), inlineBodies: bodies(discussion.inlineComments),
        prompt: { text: prompt.text, model: prompt.model, weight: prompt.weight, helperVersion: prompt.helperVersion } };
      const result = await currentExecution().operation<unknown>({ name: 'assess', binding: services.digest(JSON.stringify(request)), retry: services.retry, sharedRate: services.assessmentRate,
        perform: send => services.assess(request, send) });
      return validateAssessment(result);
    },
    summary(person, count, score) { services.trace(`summary-body:${person.key}`); return { key: person.key, name: person.name, count, score, status: count === 0 ? 'no-contributions' : 'contributions' }; },
    render(members, scope, selected, basis) {
      return { population: 'authored-prs', coverageBasis: 'fixed-controlled-dataset', contentBasis: basis?.kind === 'controlled-as-of' ? { kind: 'controlled-as-of', scenario: basis.scenario, cutoff: basis.cutoff } : { kind: 'unverified' }, scope: { repositories: strings(scope.repositories), start: scope.start, end: scope.end, cutoff: scope.cutoff, observation: scope.observation }, selected: strings(selected).sort(),
        people: members.flatMap(entry => entry.status === 'succeeded' ? [{ key: entry.data.key, name: entry.data.name, count: entry.data.count, score: entry.data.score, status: entry.data.status }] : []) };
    },
    invalidPopulation: () => { throw new Error('incomplete selected population'); },
  };
  const api = authoring<IReportInputs, IReportHelpers>();
  const { forward } = api;
  const discussion = api.sourceSlot<readonly [string], IDiscussion>({ slot: 'discussion' });
  const detail = api.sourceSlot<readonly [string, IDiscussion], IPullDetail>({ slot: 'detail' });
  const assessor = api.stepSlot<readonly [string, IPullDetail, IDiscussion, IPrompt, string], IAssessment>({ slot: 'assessor' });
  const discussionSource = api.suppliedSource<readonly [string], IDiscussion>({ finality: ({ previous, inputs, helpers }) => helpers.acceptDiscussion(previous.data, inputs.scope, inputs.settling),
    run: async ({ args, inputs, helpers, outcome }) => outcome.fresh<IDiscussion>(await helpers.fetchDiscussion(args[0], inputs.scope, inputs.settling.dailyVersion, inputs.contentBasis)) });
  const detailSource = api.suppliedSource<readonly [string, IDiscussion], IPullDetail>({ finality: ({ args, previous, inputs, helpers }) => helpers.acceptDetail(previous.data, args[1], inputs.scope, inputs.settling),
    run: async ({ args, inputs, helpers, outcome }) => outcome.fresh<IPullDetail>(await helpers.fetchDetail(args[0], inputs.scope, inputs.settling.quietVersion)) });
  const assessment = api.suppliedStep<readonly [string, IPullDetail, IDiscussion, IPrompt, string], IAssessment>({ run: ({ args, helpers }) => helpers.assess(args[0], args[1], args[2], args[3], args[4]) });
  const roster = api.source<IRoster>({ subject: 'selected-people', collection: { identity: 'key' }, finality: ({ inputs, helpers }) => helpers.acceptRoster(inputs.csv, inputs.selected), run: ({ inputs, helpers, outcome }) => outcome.fresh<IRoster>(helpers.roster(inputs.csv, inputs.selected)) });
  const people = api.template({ slot: 'person', collection: roster, steps: member => {
    const search = member.source<ICompletedSearch>({ subject: member.subject('search'), finality: () => false, run: async ({ member: person, inputs, helpers, outcome }) => outcome.fresh<ICompletedSearch>(await helpers.search(person, inputs.scope)) });
    const summary = member.memo({ subject: member.subject('summary'), children: { search, discussion, detail, assessor }, run: async ({ calls, member: person, helpers, inputs }) => {
      const completed = await calls.search();
      const count = completed.data.count;
      let score = 0;
      for (let index = 0; index < completed.data.ids.length; index += 1) {
        const id = completed.data.ids[index];
        if (id === undefined) { return helpers.invalidPopulation(); }
        const discussed = await calls.discussion(id);
        const fetched = await calls.detail(id, forward.child<IDiscussion>(discussed));
        const assessed = await calls.assessor(id, forward.child<IPullDetail>(fetched), forward.child<IDiscussion>(discussed), forward.input<IPrompt>('prompt'), inputs.assessmentContexts?.[person.key] ?? '');
        score += assessed.data.score;
      }
      return helpers.summary(person, count, score);
    } });
    return { search, summary };
  } });
  const report = api.fold({ subject: 'report', over: { template: people, step: 'summary' }, run: ({ members, inputs, helpers }) => helpers.render(members, inputs.scope, inputs.selected, inputs.contentBasis) });
  const composition = api.compose({ scope: reportAnalysis, inputs: [{ slot: 'csv', value: inputs.csv }, { slot: 'selected', value: inputs.selected }, { slot: 'scope', value: inputs.scope }, { slot: 'prompt', value: inputs.prompt }, { slot: 'settling', value: inputs.settling }, { slot: 'assessmentContexts', value: inputs.assessmentContexts ?? {} }, { slot: 'contentBasis', value: inputs.contentBasis ?? { kind: 'unverified' } }],
    helpers: [{ slot: 'roster', helper: helpers.roster }, { slot: 'acceptRoster', helper: helpers.acceptRoster }, { slot: 'search', helper: helpers.search }, { slot: 'fetchDiscussion', helper: helpers.fetchDiscussion }, { slot: 'fetchDetail', helper: helpers.fetchDetail }, { slot: 'acceptDiscussion', helper: helpers.acceptDiscussion }, { slot: 'acceptDetail', helper: helpers.acceptDetail }, { slot: 'assess', helper: helpers.assess }, { slot: 'summary', helper: helpers.summary }, { slot: 'render', helper: helpers.render }, { slot: 'invalidPopulation', helper: helpers.invalidPopulation }],
    steps: [{ slot: 'roster', declaration: roster }, { slot: 'report', declaration: report }], templates: [people], supplied: [api.supplySource({ slot: discussion, declaration: discussionSource, subject: ([id]) => `discussion:${String(id)}` }), api.supplySource({ slot: detail, declaration: detailSource, subject: ([id]) => `detail:${String(id)}` }), api.supply({ slot: assessor, declaration: assessment, subject: ([id]) => `assessment:${String(id)}` })] });
  return { authoring: api, composition, report: { scope: reportAnalysis, role: 'step', slot: 'report' } };
}

/** Qualified repository identity orders first, then numeric PR identity; neither page nor display order is identity. */
function compareIds(left: string, right: string): number {
  const [leftRepository, leftNumber] = left.split('#');
  const [rightRepository, rightNumber] = right.split('#');
  return leftRepository === rightRepository ? Number(leftNumber) - Number(rightNumber) : (leftRepository ?? '').localeCompare(rightRepository ?? '');
}

/** Copy only the selected scalar sequence; tracked arrays expose indexed observations, not native array methods. */
function strings(values: ITrackedView<readonly string[]>): string[] {
  const result: string[] = [];
  for (let index = 0; index < values.length; index += 1) { const value = values[index]; if (value === undefined) { throw new Error('incomplete selected population'); } result.push(value); }
  return result;
}

/** Assessment reads text alone; provider identities, paging metadata and unread fields do not flatten into its parent. */
function bodies(values: ITrackedView<readonly IDiscussionEntry[]>): string[] {
  const result: string[] = [];
  for (let index = 0; index < values.length; index += 1) { const value = values[index]; if (value === undefined) { throw new Error('incomplete discussion coverage'); } result.push(value.body); }
  return result;
}

/** Normalize only allowlisted timing/classification evidence; raw headers and bodies never enter runtime facts. @internal */
export function normalizeGithub(response: IRestResponse, now: number): IOperationResponse<IRestResponse> {
  if (response.status === 200) { return { kind: 'succeeded', value: response }; }
  const retryAfter = response.headers['retry-after'];
  const delta = retryAfter !== undefined && /^\d+$/u.test(retryAfter) ? Number(retryAfter) : NaN;
  const seconds = Number.isSafeInteger(delta) && Number.isSafeInteger(delta * 1_000) && Number.isSafeInteger(now + delta * 1_000) ? delta : undefined;
  const date = retryAfter === undefined ? NaN : httpDateEpoch(retryAfter);
  const resetHeader = response.headers['x-ratelimit-reset'];
  const reset = response.headers['x-ratelimit-remaining'] === '0' && resetHeader !== undefined && /^\d+$/u.test(resetHeader) ? Number(resetHeader) * 1_000 : NaN;
  const floor = Math.max(now, seconds === undefined ? Number.isFinite(date) ? date : now : now + seconds * 1_000, Number.isSafeInteger(reset) ? reset : now);
  const rate = response.status === 429 || (response.status === 403 && (retryAfter !== undefined && (seconds !== undefined || Number.isFinite(date)) || response.headers['x-ratelimit-remaining'] === '0' && Number.isSafeInteger(reset)));
  if (rate) { return { kind: 'rate-limited', retryAt: floor, retryFacts: { httpStatus: response.status, providerCode: 'rate-refusal' } }; }
  return { kind: 'failed', transient: response.status >= 500 && response.status < 600, retryFacts: { httpStatus: response.status, providerCode: response.status === 401 || response.status === 403 ? 'access-refusal' : 'http-failure' } };
}

/** HTTP dates have a defined lexical grammar; permissive JavaScript dates such as "1.5" are not provider timing evidence. */
const httpDatePattern = /^(?:[A-Z][a-z]{2}, [0-9]{2} [A-Z][a-z]{2} [0-9]{4} [0-9]{2}:[0-9]{2}:[0-9]{2} GMT|[A-Z][a-z]+, [0-9]{2}-[A-Z][a-z]{2}-[0-9]{2} [0-9]{2}:[0-9]{2}:[0-9]{2} GMT|[A-Z][a-z]{2} [A-Z][a-z]{2} [ 0-9][0-9] [0-9]{2}:[0-9]{2}:[0-9]{2} [0-9]{4})$/u;
/** Calendar names are fixed by HTTP syntax, independently of the host locale or time zone. */
const httpWeekdays = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'] as const;
/** HTTP's English month vocabulary is part of provider protocol validation. */
const httpMonths = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'] as const;
/** Round-trip every supported HTTP date component so JavaScript rollover and local-zone parsing cannot fabricate timing evidence. */
function httpDateEpoch(value: string): number {
  if (!httpDatePattern.test(value)) { return NaN; }
  // The obsolete asctime form omits a zone lexically but still means GMT on the HTTP wire.
  const epoch = Date.parse(value.endsWith('GMT') ? value : `${value} GMT`);
  if (!Number.isSafeInteger(epoch)) { return NaN; }
  const instant = new Date(epoch);
  const weekday = httpWeekdays[instant.getUTCDay()];
  const month = httpMonths[instant.getUTCMonth()];
  if (weekday === undefined || month === undefined) { return NaN; }
  const day = String(instant.getUTCDate()).padStart(2, '0');
  const year = String(instant.getUTCFullYear()).padStart(4, '0');
  const time = [instant.getUTCHours(), instant.getUTCMinutes(), instant.getUTCSeconds()].map(part => String(part).padStart(2, '0')).join(':');
  const imf = `${weekday.slice(0, 3)}, ${day} ${month} ${year} ${time} GMT`;
  const rfc850 = `${weekday}, ${day}-${month}-${year.slice(-2)} ${time} GMT`;
  const asctime = `${weekday.slice(0, 3)} ${month} ${String(instant.getUTCDate()).padStart(2, ' ')} ${time} ${year}`;
  return value === imf || value === rfc850 || value === asctime ? epoch : NaN;
}
