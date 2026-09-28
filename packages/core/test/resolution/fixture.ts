/**
 * The M3 contributor-summary authoring fixture for Reuse Resolution, written as
 * an author would write it against Definition's generated alpha builders and
 * Resolution's binding family. Two explicitly selected members (`person:ada`,
 * `person:ben`) each declare a retained activity source and a memoized summary
 * whose only child is that member's activity. Every `composeContributors` call
 * allocates fresh declarations, callbacks and inputs, standing in for a new
 * process after a complete restart; nothing depends on surviving closures.
 *
 * External data lives in `world.remote`, reached only through the declared
 * `checkActivity` helper (the fixture's source adapter). Invocation counts are
 * kept by the helpers each callback calls exactly once, so the Definition
 * callbacks themselves capture nothing but their typed context.
 *
 * Fixture attribution (docs/plans/m3-contribution-analysis.md, concrete
 * fixture decisions): Ada has PRs 101 and 102 merged, 103 open and five
 * submitted reviews (authored 3, merged 2, reviews 5); Ben has PR 201 merged,
 * 202 open and three reviews (authored 2, merged 1, reviews 3).
 *
 * @see ../../../../docs/plans/m3-contribution-analysis.md
 * @see ../../../../docs/spec/execution.md
 */
import { declarations } from '@microdelta/definition';
import type { IAnyMemoDeclaration, IAnySourceDeclaration, IBindingDescriptor, IComposition, IDeclarations } from '@microdelta/definition';
import { sourceOutcome } from '@microdelta/resolution';
import type { IPreviousResult, IResolutionFamily, IResultView, ISourceOutcome } from '@microdelta/resolution';
import type { ITrackedView } from '@microdelta/tracking';

/** The analysis scope of the fixture composition. */
export const analysis = 'contribution-report:acme/widget';

/** The two explicitly selected contributor keys. */
export type IMemberKey = 'person:ada' | 'person:ben';

/** Fixture configuration: explicit repository identity and reporting window. */
export interface IConfig {
  readonly repository: string;
  readonly window: { readonly start: string; readonly end: string };
}

/** One authored pull request as the fixture source reports it. */
export interface IPullRequest {
  readonly number: number;
  readonly merged: boolean;
  /** Deliberately unread by the summary. */
  readonly labels: readonly string[];
}

/** One contributor's activity record: nested profile, pull requests and submitted reviews. */
export interface IActivity {
  readonly profile: { readonly id: string; readonly name: string; readonly avatarUrl: string };
  readonly pullRequests: readonly IPullRequest[];
  readonly reviews: readonly { readonly id: string }[];
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
  readonly checkActivity: (previous: IPreviousResult<IActivity> | undefined, config: ITrackedView<IConfig>, key: IMemberKey, variant: string) => ISourceOutcome<IActivity>;
  readonly acceptActivity: (previous: IPreviousResult<IActivity>, config: ITrackedView<IConfig>, key: IMemberKey) => unknown;
  readonly summarize: (activity: IResultView<IActivity>, format: ITrackedView<IFormat>, key: IMemberKey) => ISummary;
  readonly format: IFormat;
  readonly unused: () => string;
}

/** Resolution's binding family for this fixture. */
export type IFamily = IResolutionFamily<IInputs, IHelpers>;

/** What the fixture source adapter does when its check runs. */
export type ICheckPolicy =
  | 'fresh'
  | 'retain'
  | 'retain-stashed'
  | 'retain-forged-carrier'
  | 'return-forged-envelope'
  | 'return-raw-data'
  | 'throw';

/** What the fixture finality policy answers. */
export type IFinalityPolicy = 'final' | 'not-final' | 'throw' | 'non-boolean';

/** Mutable fixture world: remote data, policies and invocation counts. */
export interface IWorld {
  /** Current remote activity per member. */
  remote: Record<IMemberKey, IActivity>;
  /** Check policy per member. */
  check: Record<IMemberKey, ICheckPolicy>;
  /** Finality policy per member. */
  finality: Record<IMemberKey, IFinalityPolicy>;
  /** Whether each member's summary body throws. */
  summaryThrows: Record<IMemberKey, boolean>;
  /** Counts of source check/retrieval runs per member. */
  checks: Record<IMemberKey, number>;
  /** Counts of finality hook evaluations per member. */
  finalities: Record<IMemberKey, number>;
  /** Counts of summary body executions per member. */
  summaries: Record<IMemberKey, number>;
  /** Previous carriers seen by checks, per member (to retain later illegally). */
  carriers: Partial<Record<IMemberKey, IPreviousResult<IActivity>>>;
  /** Whether each check received an eligible previous carrier. */
  sawPrevious: Record<IMemberKey, boolean[]>;
}

/** The fixture activity for Ada (authored 3, merged 2, reviews 5). */
export function adaActivity(overrides: { readonly name?: string; readonly profileId?: string; readonly merged103?: boolean; readonly avatar?: string; readonly label?: string } = {}): IActivity {
  return {
    profile: { id: overrides.profileId ?? 'gh:1001', name: overrides.name ?? 'Ada', avatarUrl: overrides.avatar ?? 'https://avatars.example/ada.png' },
    pullRequests: [
      { number: 101, merged: true, labels: [overrides.label ?? 'feature'] },
      { number: 102, merged: true, labels: ['docs'] },
      { number: 103, merged: overrides.merged103 ?? false, labels: [] },
    ],
    reviews: [{ id: 'r1' }, { id: 'r2' }, { id: 'r3' }, { id: 'r4' }, { id: 'r5' }],
  };
}

/** The fixture activity for Ben (authored 2, merged 1, reviews 3). */
export function benActivity(overrides: { readonly name?: string; readonly merged202?: boolean } = {}): IActivity {
  return {
    profile: { id: 'gh:2002', name: overrides.name ?? 'Ben', avatarUrl: 'https://avatars.example/ben.png' },
    pullRequests: [
      { number: 201, merged: true, labels: ['bug'] },
      { number: 202, merged: overrides.merged202 ?? false, labels: [] },
    ],
    reviews: [{ id: 's1' }, { id: 's2' }, { id: 's3' }],
  };
}

/** A fresh world with both members fetching fresh data and finality accepting. */
export function createWorld(): IWorld {
  return {
    remote: { 'person:ada': adaActivity(), 'person:ben': benActivity() },
    check: { 'person:ada': 'fresh', 'person:ben': 'fresh' },
    finality: { 'person:ada': 'final', 'person:ben': 'final' },
    summaryThrows: { 'person:ada': false, 'person:ben': false },
    checks: { 'person:ada': 0, 'person:ben': 0 },
    finalities: { 'person:ada': 0, 'person:ben': 0 },
    summaries: { 'person:ada': 0, 'person:ben': 0 },
    carriers: {},
    sawPrevious: { 'person:ada': [], 'person:ben': [] },
  };
}

/** The world the fixture helpers read; each test installs a fresh one. */
export let world: IWorld = createWorld();

/** Install a fresh world for a test. */
export function resetWorld(): IWorld {
  world = createWorld();
  return world;
}

/**
 * Deliberately forge a value of another type for a negative control. The one
 * assertion is the point of the control: Resolution must reject the forgery at
 * runtime, whatever its static type claims.
 */
function forged<T>(value: unknown): T {
  return value as T;
}

/** Deep copy of remote data so no stored result shares a container with the world. */
function copy<T>(value: T): T {
  return structuredClone(value);
}

/**
 * The fixture source adapter: reads the configured repository and window,
 * then fetches or retains according to the member's check policy.
 */
function checkActivity(previous: IPreviousResult<IActivity> | undefined, config: ITrackedView<IConfig>, key: IMemberKey, variant: string): ISourceOutcome<IActivity> {
  world.checks[key] += 1;
  world.sawPrevious[key].push(previous !== undefined);
  if (config.repository !== 'acme/widget' || config.window.start.length === 0 || variant.length === 0) {
    throw new Error('fixture source adapter expects the acme/widget configuration');
  }
  const policy = world.check[key];
  switch (policy) {
    case 'fresh':
      if (previous !== undefined) {
        world.carriers[key] = previous;
      }
      return sourceOutcome.fresh(copy(world.remote[key]));
    case 'retain':
      if (previous === undefined) {
        // A cold check has nothing to retain; an author that tries anyway must fail.
        return sourceOutcome.retain(forged<IPreviousResult<IActivity>>(undefined));
      }
      return sourceOutcome.retain(previous);
    case 'retain-stashed': {
      const stashed = world.carriers[key];
      if (stashed === undefined) {
        throw new Error('no stashed carrier');
      }
      return sourceOutcome.retain(stashed);
    }
    case 'retain-forged-carrier':
      return sourceOutcome.retain(forged<IPreviousResult<IActivity>>(Object.freeze({ data: previous?.data })));
    case 'return-forged-envelope':
      return forged<ISourceOutcome<IActivity>>(Object.freeze({ kind: 'retain', previous }));
    case 'return-raw-data':
      return forged<ISourceOutcome<IActivity>>(copy(world.remote[key]));
    case 'throw':
      throw new Error('fixture source unavailable');
    default: {
      const exhaustive: never = policy;
      return exhaustive;
    }
  }
}

/** The fixture finality policy: a terminal-snapshot decision configured per member. */
function acceptActivity(previous: IPreviousResult<IActivity>, config: ITrackedView<IConfig>, key: IMemberKey): unknown {
  world.finalities[key] += 1;
  if (previous.data.profile.id.length === 0 || config.repository.length === 0) {
    return false;
  }
  const policy = world.finality[key];
  if (policy === 'throw') {
    throw new Error('fixture finality policy unavailable');
  }
  return policy === 'non-boolean' ? 'yes' : policy === 'final';
}

/**
 * Summarize one contributor's activity with indexed loops over the exact
 * retained records. Reads profile name, each PR's merged status and the review
 * count; never reads labels, avatar or profile identity.
 */
function summarize(activity: IResultView<IActivity>, format: ITrackedView<IFormat>, key: IMemberKey): ISummary {
  world.summaries[key] += 1;
  if (world.summaryThrows[key]) {
    throw new Error('fixture summary failure');
  }
  let merged = 0;
  const authored = activity.pullRequests.length;
  for (let index = 0; index < authored; index += 1) {
    const pullRequest = activity.pullRequests[index];
    if (pullRequest?.merged === true) {
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
  // Revised wording path that yields the same sentence.
  return [`${name} authored ${pulls}`, mergedText, `and submitted ${reviewText}.`].join(', ');
}

/** A declared helper no callback calls. */
function unused(): string {
  return 'never called';
}

/** A changed implementation of the uncalled helper. */
function unusedRevised(): string {
  return 'still never called';
}

/** Author-visible variations of one fixture build. */
export interface IVariation {
  /** Registration order of the two members. */
  readonly order?: 'ada-first' | 'ben-first';
  /** Summary compatibility version for both members. */
  readonly summaryVersion?: number;
  /** Ada's activity source implementation variant. */
  readonly adaSource?: 'original' | 'changed';
  /** Whether Ada's activity declares a finality hook. */
  readonly adaFinality?: 'present' | 'absent';
  /** Which formatter implementation is registered. */
  readonly formatter?: 'original' | 'revised';
  /** Which uncalled helper implementation is registered. */
  readonly unusedHelper?: 'original' | 'revised';
  /** Ada's activity slot name (structural correspondence). */
  readonly adaActivitySlot?: string;
  /** The declared configuration. */
  readonly config?: IConfig;
}

/** The default declared configuration. */
export const defaultConfig: IConfig = { repository: 'acme/widget', window: { start: '2026-01-01', end: '2026-04-01' } };

/** One fresh composition with its builders and step descriptors. */
export interface IContributors {
  readonly builders: IDeclarations<IFamily>;
  readonly composition: IComposition<IFamily>;
  readonly steps: Readonly<Record<IMemberKey, { readonly activity: IBindingDescriptor; readonly summary: IBindingDescriptor }>>;
  readonly declarations: Readonly<Record<IMemberKey, { readonly activity: IAnySourceDeclaration<IFamily>; readonly summary: IAnyMemoDeclaration<IFamily> }>>;
}

/** The declared input and helper slots every callback receives. */
export const bindingSlots = { inputs: ['config'], helpers: ['checkActivity', 'acceptActivity', 'summarize', 'format', 'unused'] } as const;

/** Compose both contributors with fresh allocations. */
export function composeContributors(variation: IVariation = {}): IContributors {
  const builders = declarations<IFamily>();
  const { source, memo, compose } = builders;
  const adaFinality = variation.adaFinality ?? 'present';
  const adaActivity = variation.adaSource === 'changed'
    ? source<IActivity>({
        subject: 'activity:acme/widget:2026-Q1:person:ada',
        label: 'Ada activity',
        finality: ({ previous, inputs, helpers }) => helpers.acceptActivity(previous, inputs.config, 'person:ada'),
        run: ({ previous, inputs, helpers }) => helpers.checkActivity(previous, inputs.config, 'person:ada', 'changed retrieval'),
      })
    : adaFinality === 'absent'
      ? source<IActivity>({
          subject: 'activity:acme/widget:2026-Q1:person:ada',
          label: 'Ada activity',
          run: ({ previous, inputs, helpers }) => helpers.checkActivity(previous, inputs.config, 'person:ada', 'retrieval'),
        })
      : source<IActivity>({
          subject: 'activity:acme/widget:2026-Q1:person:ada',
          label: 'Ada activity',
          finality: ({ previous, inputs, helpers }) => helpers.acceptActivity(previous, inputs.config, 'person:ada'),
          run: ({ previous, inputs, helpers }) => helpers.checkActivity(previous, inputs.config, 'person:ada', 'retrieval'),
        });
  const benActivitySource = source<IActivity>({
    subject: 'activity:acme/widget:2026-Q1:person:ben',
    label: 'Ben activity',
    finality: ({ previous, inputs, helpers }) => helpers.acceptActivity(previous, inputs.config, 'person:ben'),
    run: ({ previous, inputs, helpers }) => helpers.checkActivity(previous, inputs.config, 'person:ben', 'retrieval'),
  });
  const adaSlot = variation.adaActivitySlot ?? 'activity';
  const adaSummary = adaSlot === 'activity'
    ? memo({
        subject: 'summary:acme/widget:2026-Q1:person:ada',
        label: 'Ada summary',
        version: variation.summaryVersion ?? 1,
        children: { activity: adaActivity },
        run: async ({ helpers, calls }) => {
          const { data: activity } = await calls.activity();
          return helpers.summarize(activity, helpers.format, 'person:ada');
        },
      })
    : memo({
        subject: 'summary:acme/widget:2026-Q1:person:ada',
        label: 'Ada summary',
        version: variation.summaryVersion ?? 1,
        children: { events: adaActivity },
        run: async ({ helpers, calls }) => {
          const { data: activity } = await calls.events();
          return helpers.summarize(activity, helpers.format, 'person:ada');
        },
      });
  const benSummary = memo({
    subject: 'summary:acme/widget:2026-Q1:person:ben',
    label: 'Ben summary',
    version: variation.summaryVersion ?? 1,
    children: { activity: benActivitySource },
    run: async ({ helpers, calls }) => {
      const { data: activity } = await calls.activity();
      return helpers.summarize(activity, helpers.format, 'person:ben');
    },
  });
  const ada = { key: 'person:ada', steps: [{ slot: adaSlot, declaration: adaActivity }, { slot: 'summary', declaration: adaSummary }] };
  const ben = { key: 'person:ben', steps: [{ slot: 'activity', declaration: benActivitySource }, { slot: 'summary', declaration: benSummary }] };
  const helpers = [
    { slot: 'checkActivity', helper: checkActivity },
    { slot: 'acceptActivity', helper: acceptActivity },
    { slot: 'summarize', helper: summarize },
    { slot: 'format', helper: variation.formatter === 'revised' ? formatRevised : format },
    { slot: 'unused', helper: variation.unusedHelper === 'revised' ? unusedRevised : unused },
  ];
  const composition = compose({
    scope: analysis,
    inputs: [{ slot: 'config', value: variation.config ?? defaultConfig }],
    helpers: variation.order === 'ben-first' ? [...helpers].reverse() : helpers,
    members: variation.order === 'ben-first' ? [ben, ada] : [ada, ben],
  });
  const step = (memberKey: IMemberKey, slot: string): IBindingDescriptor => ({ scope: analysis, role: 'step', slot, memberKey });
  return {
    builders,
    composition,
    steps: {
      'person:ada': { activity: step('person:ada', adaSlot), summary: step('person:ada', 'summary') },
      'person:ben': { activity: step('person:ben', 'activity'), summary: step('person:ben', 'summary') },
    },
    declarations: {
      'person:ada': { activity: adaActivity, summary: adaSummary },
      'person:ben': { activity: benActivitySource, summary: benSummary },
    },
  };
}
