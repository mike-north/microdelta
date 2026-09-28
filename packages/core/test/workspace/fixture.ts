/**
 * The M3 contributor-summary analysis authored through the facade's alpha
 * workspace surface, as an author writes it: `authoring()` builders, a fixed
 * composition of two explicitly selected members (`person:ada`,
 * `person:ben`), each with a retained activity source and a memoized summary
 * whose only child is that member's activity. Every `composeContributors`
 * call allocates fresh declarations, callbacks and inputs, standing in for a
 * new process after a complete restart.
 *
 * External data lives in `world.remote`, reached only through the declared
 * `checkActivity` helper (the fixture's source adapter). Counts are kept by
 * the helpers each callback calls, so callbacks capture nothing but their
 * typed context. Helpers also record the run context they observe through
 * `currentRun()`, proving scoped lookup without a context parameter.
 *
 * Fixture attribution (docs/plans/m3-contribution-analysis.md, concrete
 * fixture decisions): Ada has PRs 101 and 102 merged, 103 open and five
 * submitted reviews (authored 3, merged 2, reviews 5); Ben has PR 201 merged,
 * 202 open and three reviews (authored 2, merged 1, reviews 3).
 *
 * @see ../../../../docs/plans/m3-contribution-analysis.md
 */
import { authoring, currentRun, sourceOutcome } from '../../src/index.js';
import type {
  IAuthoring,
  IComposition,
  IPreviousResult,
  IResultView,
  IRunContext,
  ISourceOutcome,
  IStepDescriptor,
  ITrackedView,
} from '../../src/index.js';

/** The analysis scope of the fixture composition. */
export const analysis = 'contribution-report:acme/widget';

/** The two explicitly selected contributor keys. */
export type IMemberKey = 'person:ada' | 'person:ben';

/** Both member keys in their stable (display) order. */
export const memberKeys: readonly IMemberKey[] = Object.freeze(['person:ada', 'person:ben']);

/** Fixture configuration: explicit repository identity and reporting window. */
export interface IConfig {
  readonly repository: string;
  readonly window: { readonly start: string; readonly end: string };
}

/** One contributor's activity record: nested profile, pull requests and submitted reviews. */
export interface IActivity {
  readonly profile: { readonly id: string; readonly name: string; readonly avatarUrl: string };
  readonly pullRequests: readonly { readonly number: number; readonly merged: boolean; readonly labels: readonly string[] }[];
  readonly reviews: readonly { readonly id: string }[];
  /** An ordinary author data field named like a thenable member; never read by the summary. */
  readonly then?: string;
}

/** A contributor summary: structured statistics and the sentence built from them. */
export interface ISummary {
  readonly name: string;
  readonly authored: number;
  readonly merged: number;
  readonly reviews: number;
  readonly sentence: string;
}

/** The declared input record. */
export interface IInputs {
  readonly config: IConfig;
}

/** The deterministic sentence formatter. */
export type IFormat = (name: string, authored: number, merged: number, reviews: number) => string;

/** The declared helper record. */
export interface IHelpers {
  readonly checkActivity: (previous: IPreviousResult<IActivity> | undefined, config: ITrackedView<IConfig>, key: IMemberKey) => ISourceOutcome<IActivity>;
  readonly acceptActivity: (previous: IPreviousResult<IActivity>, key: IMemberKey) => boolean;
  readonly summarize: (activity: IResultView<IActivity>, format: ITrackedView<IFormat>, key: IMemberKey) => ISummary;
  readonly format: IFormat;
}

/** What the fixture source adapter does when its check runs. */
export type ICheckPolicy = 'fresh' | 'retain';

/** Mutable fixture world: remote data, policies, counts and observed contexts. */
export interface IWorld {
  remote: Record<IMemberKey, IActivity>;
  check: Record<IMemberKey, ICheckPolicy>;
  /** Whether each member's current finality hook accepts its eligible previous result. */
  final: Record<IMemberKey, boolean>;
  checks: Record<IMemberKey, number>;
  finalities: Record<IMemberKey, number>;
  summaries: Record<IMemberKey, number>;
  /** Run contexts the summarize helper looked up with `currentRun()`. */
  contexts: IRunContext[];
}

/** The fixture activity for Ada (authored 3, merged 2, reviews 5). */
export function adaActivity(overrides: { readonly merged103?: boolean; readonly avatar?: string; readonly label?: string; readonly then?: string } = {}): IActivity {
  return {
    ...(overrides.then === undefined ? {} : { then: overrides.then }),
    profile: { id: 'gh:1001', name: 'Ada', avatarUrl: overrides.avatar ?? 'https://avatars.example/ada.png' },
    pullRequests: [
      { number: 101, merged: true, labels: [overrides.label ?? 'feature'] },
      { number: 102, merged: true, labels: ['docs'] },
      { number: 103, merged: overrides.merged103 ?? false, labels: [] },
    ],
    reviews: [{ id: 'r1' }, { id: 'r2' }, { id: 'r3' }, { id: 'r4' }, { id: 'r5' }],
  };
}

/** The fixture activity for Ben (authored 2, merged 1, reviews 3). */
export function benActivity(): IActivity {
  return {
    profile: { id: 'gh:2002', name: 'Ben', avatarUrl: 'https://avatars.example/ben.png' },
    pullRequests: [
      { number: 201, merged: true, labels: ['bug'] },
      { number: 202, merged: false, labels: [] },
    ],
    reviews: [{ id: 's1' }, { id: 's2' }, { id: 's3' }],
  };
}

/** A fresh world: fresh checks, accepting finality, zero counts. */
export function createWorld(): IWorld {
  return {
    remote: { 'person:ada': adaActivity(), 'person:ben': benActivity() },
    check: { 'person:ada': 'fresh', 'person:ben': 'fresh' },
    final: { 'person:ada': true, 'person:ben': true },
    checks: { 'person:ada': 0, 'person:ben': 0 },
    finalities: { 'person:ada': 0, 'person:ben': 0 },
    summaries: { 'person:ada': 0, 'person:ben': 0 },
    contexts: [],
  };
}

/** The world the fixture helpers read; each test installs a fresh one. */
export let world: IWorld = createWorld();

/** Install a fresh world for a test. */
export function resetWorld(): IWorld {
  world = createWorld();
  return world;
}

/** Deep copy of remote data (JSON-safe) so no stored result shares a container with the world. */
function copy<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

/** The fixture source adapter: fetches fresh data or retains the eligible previous result. */
function checkActivity(previous: IPreviousResult<IActivity> | undefined, config: ITrackedView<IConfig>, key: IMemberKey): ISourceOutcome<IActivity> {
  world.checks[key] += 1;
  if (config.repository !== 'acme/widget') {
    throw new Error('fixture source adapter expects the acme/widget configuration');
  }
  if (world.check[key] === 'retain' && previous !== undefined) {
    return sourceOutcome.retain(previous);
  }
  return sourceOutcome.fresh(copy(world.remote[key]));
}

/** The fixture finality policy, configured per member. */
function acceptActivity(previous: IPreviousResult<IActivity>, key: IMemberKey): boolean {
  world.finalities[key] += 1;
  return previous.data.profile.id.length > 0 && world.final[key];
}

/**
 * Summarize one contributor's activity with indexed loops over the exact
 * retained records. Reads profile name, each PR's merged status and the review
 * count; never reads labels, avatar, profile identity or `then`.
 */
function summarize(activity: IResultView<IActivity>, format: ITrackedView<IFormat>, key: IMemberKey): ISummary {
  world.summaries[key] += 1;
  world.contexts.push(currentRun());
  let merged = 0;
  const authored = activity.pullRequests.length;
  for (let index = 0; index < authored; index += 1) {
    if (activity.pullRequests[index]?.merged === true) {
      merged += 1;
    }
  }
  const reviews = activity.reviews.length;
  const name = activity.profile.name;
  return { name, authored, merged, reviews, sentence: format(name, authored, merged, reviews) };
}

/** The deterministic formatter with singular/plural handling. */
function format(name: string, authored: number, merged: number, reviews: number): string {
  const pulls = authored === 1 ? '1 pull request' : `${String(authored)} pull requests`;
  const mergedText = merged === 1 ? '1 of which was merged' : `${String(merged)} of which were merged`;
  const reviewText = reviews === 1 ? '1 review' : `${String(reviews)} reviews`;
  return `${name} authored ${pulls}, ${mergedText}, and submitted ${reviewText}.`;
}

/** A changed formatter implementation with identical output for the fixture data. */
function formatRevised(name: string, authored: number, merged: number, reviews: number): string {
  const pulls = authored === 1 ? '1 pull request' : `${String(authored)} pull requests`;
  const mergedText = merged === 1 ? '1 of which was merged' : `${String(merged)} of which were merged`;
  const reviewText = reviews === 1 ? '1 review' : `${String(reviews)} reviews`;
  return [`${name} authored ${pulls}`, mergedText, `and submitted ${reviewText}.`].join(', ');
}

/** Author-visible variations of one fixture build. */
export interface IVariation {
  /** Registration order of the two members. */
  readonly order?: 'ada-first' | 'ben-first';
  /** Which formatter implementation is registered. */
  readonly formatter?: 'original' | 'revised';
}

/** The default declared configuration. */
export const defaultConfig: IConfig = { repository: 'acme/widget', window: { start: '2026-01-01', end: '2026-04-01' } };

/** One fresh composition with its builders and step descriptors. */
export interface IContributors {
  readonly authoring: IAuthoring<IInputs, IHelpers>;
  readonly composition: IComposition<IInputs, IHelpers>;
  readonly steps: Readonly<Record<IMemberKey, { readonly activity: IStepDescriptor; readonly summary: IStepDescriptor }>>;
}

/** Compose both contributors with fresh allocations. */
export function composeContributors(variation: IVariation = {}): IContributors {
  const builders = authoring<IInputs, IHelpers>();
  const { source, memo, compose } = builders;
  const adaSource = source<IActivity>({
    subject: 'activity:acme/widget:2026-Q1:person:ada',
    label: 'Ada activity',
    finality: ({ previous, helpers }) => helpers.acceptActivity(previous, 'person:ada'),
    run: ({ previous, inputs, helpers }) => helpers.checkActivity(previous, inputs.config, 'person:ada'),
  });
  const benSource = source<IActivity>({
    subject: 'activity:acme/widget:2026-Q1:person:ben',
    label: 'Ben activity',
    finality: ({ previous, helpers }) => helpers.acceptActivity(previous, 'person:ben'),
    run: ({ previous, inputs, helpers }) => helpers.checkActivity(previous, inputs.config, 'person:ben'),
  });
  const adaSummary = memo({
    subject: 'summary:acme/widget:2026-Q1:person:ada',
    label: 'Ada summary',
    children: { activity: adaSource },
    run: async ({ helpers, calls }) => {
      const { data: activity } = await calls.activity();
      return helpers.summarize(activity, helpers.format, 'person:ada');
    },
  });
  const benSummary = memo({
    subject: 'summary:acme/widget:2026-Q1:person:ben',
    label: 'Ben summary',
    children: { activity: benSource },
    run: async ({ helpers, calls }) => {
      const { data: activity } = await calls.activity();
      return helpers.summarize(activity, helpers.format, 'person:ben');
    },
  });
  const ada = { key: 'person:ada', steps: [{ slot: 'activity', declaration: adaSource }, { slot: 'summary', declaration: adaSummary }] };
  const ben = { key: 'person:ben', steps: [{ slot: 'activity', declaration: benSource }, { slot: 'summary', declaration: benSummary }] };
  const composition = compose({
    scope: analysis,
    inputs: [{ slot: 'config', value: defaultConfig }],
    helpers: [
      { slot: 'checkActivity', helper: checkActivity },
      { slot: 'acceptActivity', helper: acceptActivity },
      { slot: 'summarize', helper: summarize },
      { slot: 'format', helper: variation.formatter === 'revised' ? formatRevised : format },
    ],
    members: variation.order === 'ben-first' ? [ben, ada] : [ada, ben],
  });
  const step = (memberKey: IMemberKey, slot: string): IStepDescriptor => ({ scope: analysis, role: 'step', slot, memberKey });
  return {
    authoring: builders,
    composition,
    steps: {
      'person:ada': { activity: step('person:ada', 'activity'), summary: step('person:ada', 'summary') },
      'person:ben': { activity: step('person:ben', 'activity'), summary: step('person:ben', 'summary') },
    },
  };
}
