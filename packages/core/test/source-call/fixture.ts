/**
 * SCD-1–6 consumer fixture through the generated facade. A tracked roster owns
 * person boundaries; completed ID-only search precedes detail calls. Only the
 * assessor observes detail fields, through the exact forwarded child carrier.
 * Helpers model remote state and instrumentation, never runtime orchestration.
 */
import { authoring, sourceOutcome } from 'microdelta';
import type { IAuthoring, IComposition, IPreviousResult, ISourceOutcome, IStepDescriptor } from 'microdelta';

/** Qualified IDs name remote entities independently of person membership. */
export interface IDetail { readonly id: string; readonly merged: boolean; readonly title: string }
/** A certified completed population for one person. */
export interface ISearch { readonly count: number; readonly ids: readonly string[] }
/** Application prompt forwarded independently from detail data. */
export interface IPrompt { readonly weight: number; readonly text: string }
/** Only the score is required by a person's strict summary. */
export interface IAssessment { readonly score: number; readonly explanation: string }
/** One person's independently retained result. */
export interface ISummary { readonly person: string; readonly count: number; readonly total: number }
/** The explicit selected roster, supplied as current application input. */
export interface IPerson { readonly key: string; readonly argument: string }
/** Current composition inputs whose consumed portions govern compatibility. */
export interface IInputs {
  readonly selected: readonly IPerson[];
  readonly argumentMode: 'tracked' | 'untracked' | 'opaque';
  readonly prompt: IPrompt;
  readonly policy: { readonly binding: string; readonly revision: number };
}
/** The controlled external world changes between resolutions or processes. */
export interface IWorld {
  readonly searches: Readonly<Record<string, ISearch>>;
  readonly details: Readonly<Record<string, IDetail>>;
  readonly accepts: Readonly<Record<string, boolean>>;
  readonly trace: string[];
  readonly retain?: boolean;
  readonly searchFailures?: Readonly<Record<string, 'failed' | 'truncated'>>;
  readonly detailFailures?: readonly string[];
}
/** Controlled defaults make the hand-computed totals Ada=2 and Grace=1. */
export function createWorld(): IWorld {
  return {
    searches: { ada: { count: 2, ids: ['repo#101', 'repo#102'] }, grace: { count: 1, ids: ['repo#201'] } },
    details: { 'repo#101': { id: 'repo#101', merged: false, title: '101' }, 'repo#102': { id: 'repo#102', merged: false, title: '102' }, 'repo#103': { id: 'repo#103', merged: true, title: '103' }, 'repo#201': { id: 'repo#201', merged: false, title: '201' } },
    accepts: {}, trace: [],
  };
}
/** Only helpers reach the external fixture state. */
let world = createWorld();
/** Install the remote state and its independent execution ledger. */
export function installWorld(next: IWorld): void { world = next; }

/** The adapter and consumer reject a missing identity instead of inventing partial success. */
function invalidPopulation(): never { throw new Error('uncertified search population'); }

/** Optional controlled adapter; its implementation always uses the existing supervised operation port. */
let acquisition: ((id: string, argument: string, policy: string, detail: IDetail) => Promise<IDetail>) | undefined;
/** Install a supervised adapter for acquisition tests; ordinary fixture processes use the local remote world. */
export function installAcquisition(next: typeof acquisition): void { acquisition = next; }
/** A controlled unfinished search is genuinely pending until its adapter certifies completion. */
let searchBarrier: ((person: string) => Promise<void>) | undefined;
/** Hold search completion without changing the runtime or manufacturing an empty result. */
export function installSearchBarrier(next: typeof searchBarrier): void { searchBarrier = next; }

/** A complete search either certifies its exact ID population or rejects. */
async function search(person: string): Promise<ISourceOutcome<ISearch>> {
  world.trace.push(`search-start:${person}`);
  await Promise.resolve();
  await searchBarrier?.(person);
  const failure = world.searchFailures?.[person];
  if (failure !== undefined) { throw new Error(`search ${failure}`); }
  const completed = world.searches[person];
  if (completed === undefined || completed.count !== completed.ids.length || new Set(completed.ids).size !== completed.count || [...completed.ids].some(id => !/^repo#[1-9][0-9]*$/u.test(id))) { throw new Error('uncertified search population'); }
  world.trace.push(`search-complete:${person}`);
  return sourceOutcome.fresh<ISearch>({ count: completed.count, ids: [...completed.ids] });
}
/** Refresh one separately addressed detail; previous eligibility is observable. */
async function fetchDetail(id: string, argument: string, policy: string, previous: IPreviousResult<IDetail> | undefined): Promise<ISourceOutcome<IDetail>> {
  world.trace.push(`detail:${id}:${argument}:${policy}:previous=${String(previous !== undefined)}`);
  await Promise.resolve();
  if (world.detailFailures?.includes(id) === true) { throw new Error('required detail failed'); }
  if (world.retain === true && previous !== undefined) { return sourceOutcome.retain(previous); }
  const detail = world.details[id];
  if (detail === undefined) { throw new Error('missing fixture detail'); }
  const refreshed = acquisition === undefined ? { ...detail } : await acquisition(id, argument, policy, detail);
  return sourceOutcome.fresh<IDetail>(refreshed);
}
/** Every resolution reestablishes current acceptance; nothing stores this answer. */
function acceptDetail(id: string, previous: IPreviousResult<IDetail>, revision: number): boolean {
  world.trace.push(`finality:${id}:${String(revision)}:${String(previous.data.merged)}`);
  return world.accepts[id] === true;
}
/** Instrumentation observes the author step boundary without consuming its output. */
function assessed(id: string): void { world.trace.push(`assess:${id}`); }
/** A summary body is counted independently from child verification and publication. */
function summarized(person: string): void { world.trace.push(`summary:${person}`); }

/** Declared helpers preserve remote effects and counters behind tracked call boundaries. */
export interface IHelpers {
  readonly search: typeof search;
  readonly fetchDetail: typeof fetchDetail;
  readonly acceptDetail: typeof acceptDetail;
  readonly assessed: typeof assessed;
  readonly summarized: typeof summarized;
  readonly invalidPopulation: typeof invalidPopulation;
}
/** Author-visible variations; no hidden person prefix is added to call identity. */
export interface IVariation {
  readonly selected?: readonly IPerson[];
  readonly prompt?: IPrompt;
  readonly policy?: IInputs['policy'];
  readonly implementation?: 'original' | 'revised';
  readonly supplied?: 'once' | 'none' | 'twice';
  readonly order?: 'forward' | 'reverse';
  readonly argumentMode?: IInputs['argumentMode'];
  readonly sourceSubject?: 'detail' | 'assessment';
  readonly sourceSlot?: string;
  readonly consumeArgument?: boolean;
}
/** A fresh composition and the strict outer consumer's address. */
export interface IFixture {
  readonly authoring: IAuthoring<IInputs, IHelpers>;
  readonly composition: IComposition<IInputs, IHelpers>;
  readonly report: IStepDescriptor;
}
/** Fixed scope/store identities permit exact restart comparisons. */
export const scope = 'source-call:contribution-report';
/** Durable store identity is independent of filesystem location. */
export const logicalStore = 'source-call:history';

/** Build the accepted completed-search shape once, with no nested collection API. */
export function composeFixture(variation: IVariation = {}): IFixture {
  const api = authoring<IInputs, IHelpers>();
  const { forward } = api;
  const detail = api.sourceSlot<readonly [string, string, unknown?], IDetail>({ slot: variation.sourceSlot ?? 'detail' });
  const assessor = api.stepSlot<readonly [string, IDetail, IPrompt], IAssessment>({ slot: 'assessor' });
  const implementation = api.suppliedSource<readonly [string, string, unknown?], IDetail>({
    finality: ({ args, previous, inputs, helpers }) => helpers.acceptDetail(args[0], previous, inputs.policy.revision),
    run: variation.consumeArgument === false
      ? ({ args, previous, inputs, helpers }) => helpers.fetchDetail(args[0], 'unconsumed', inputs.policy.binding, previous)
      : variation.implementation === 'revised'
      ? async ({ args, previous, inputs, helpers }) => { const refreshed = await helpers.fetchDetail(args[0], args[1], inputs.policy.binding, previous); return refreshed; }
      : ({ args, previous, inputs, helpers }) => helpers.fetchDetail(args[0], args[1], inputs.policy.binding, previous),
  });
  const assess = api.suppliedStep<readonly [string, IDetail, IPrompt], IAssessment>({ run: ({ args, helpers }) => {
    helpers.assessed(args[0]);
    return { score: (args[1].merged ? 2 : 1) * args[2].weight, explanation: `${args[0]}:${args[2].text}` };
  } });
  const roster = api.source<{ readonly status: 'complete'; readonly members: readonly IPerson[] }>({
    subject: 'selected-people', collection: { identity: 'key' },
    finality: () => true,
    run: ({ inputs, outcome }) => {
      const selected: IPerson[] = [];
      for (let index = 0; index < inputs.selected.length; index += 1) { const person = inputs.selected[index]; if (person !== undefined) { selected.push({ key: person.key, argument: person.argument }); } }
      return outcome.fresh<{ readonly status: 'complete'; readonly members: readonly IPerson[] }>({ status: 'complete', members: selected });
    },
  });
  const people = api.template({ slot: 'person', collection: roster, steps: member => {
    const completed = member.source<ISearch>({ subject: member.subject('search'), finality: () => false, run: ({ member: person, helpers }) => helpers.search(person.key) });
    const summary = member.memo({ subject: member.subject('summary'), children: { search: completed, detail, assessor }, run: async ({ calls, member: person, helpers, inputs, untracked }) => {
      if (inputs.argumentMode === 'untracked') { untracked(inputs.policy, 'revision'); }
      const searched = await calls.search();
      const count = searched.data.count;
      let total = 0;
      for (let index = 0; index < searched.data.ids.length; index += 1) {
        const id = searched.data.ids[index];
        if (id === undefined) { return helpers.invalidPopulation(); }
        const fetched = inputs.argumentMode === 'opaque' ? await calls.detail(id, person.argument, () => 0) : await calls.detail(id, person.argument);
        const assessment = await calls.assessor(id, forward.child<IDetail>(fetched), forward.input<IPrompt>('prompt'));
        total += assessment.data.score;
      }
      helpers.summarized(person.key);
      return { person: person.key, count, total };
    } });
    return { search: completed, summary };
  } });
  const report = api.fold({ subject: 'strict-report', over: { template: people, step: 'summary' }, run: ({ members }) => ({ people: members.flatMap(entry => entry.status === 'succeeded' ? [{ key: entry.key, count: entry.data.count, total: entry.data.total }] : []) }) });
  const registration = api.supplySource({ slot: detail, declaration: implementation, subject: variation.sourceSubject === 'assessment' ? ([id]) => `assessment:${String(id)}` : ([id]) => `detail:${String(id)}` });
  const supplied = [...(variation.supplied === 'none' ? [] : variation.supplied === 'twice' ? [registration, registration] : [registration]), api.supply({ slot: assessor, declaration: assess, subject: ([id]) => `assessment:${String(id)}` })];
  const steps = [{ slot: 'roster', declaration: roster }, { slot: 'report', declaration: report }];
  const composition = api.compose({ scope, inputs: [
    { slot: 'argumentMode', value: variation.argumentMode ?? 'tracked' },
    { slot: 'selected', value: variation.selected ?? [{ key: 'ada', argument: 'same' }, { key: 'grace', argument: 'same' }] },
    { slot: 'prompt', value: variation.prompt ?? { weight: 1, text: 'default' } },
    { slot: 'policy', value: variation.policy ?? { binding: 'standard', revision: 1 } },
  ], helpers: [{ slot: 'search', helper: search }, { slot: 'fetchDetail', helper: fetchDetail }, { slot: 'acceptDetail', helper: acceptDetail }, { slot: 'assessed', helper: assessed }, { slot: 'summarized', helper: summarized }, { slot: 'invalidPopulation', helper: invalidPopulation }], steps: variation.order === 'reverse' ? [...steps].reverse() : steps, templates: [people], supplied: variation.order === 'reverse' ? [...supplied].reverse() : supplied });
  return { authoring: api, composition, report: { scope, role: 'step', slot: 'report' } };
}
