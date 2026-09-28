/**
 * The M3 contributor analysis as an acceptance worker process authors it
 * through the built `microdelta` facade's alpha surface. Each process calls
 * `composeAnalysis(variation)` afresh, so nothing survives a process exit but
 * durable History: declarations, callbacks, helpers and input objects are all
 * newly allocated from the variation the parent passes on the command line.
 *
 * Two fixed members (`person:ada`, `person:ben`) each declare a retained
 * activity source and a memoized summary whose only child is that member's
 * activity. External repository activity lives in a *world file* the parent
 * writes per scenario step (standing in for a live GitHub API); only the
 * declared source adapter reads it, applying the contribution example's
 * attribution rules: unique authored PRs created in the half-open window,
 * current merged status, unique submitted reviews in the window, pending
 * reviews excluded.
 *
 * Every helper call is written synchronously to the trace (fd 1), so the
 * parent can count bodies, checks and finality evaluations even when the
 * process is killed mid-run. Variation branches are distinct literal
 * callbacks, never closures over variation values: a captured value would be
 * untracked closure state.
 *
 * @see ../../../../docs/plans/m3-contribution-analysis.md (Concrete fixture decisions)
 * @see ../../../../examples/contribution-report/README.md (Attribution rules)
 */
import { readFileSync, writeSync } from 'node:fs';

import { authoring } from 'microdelta';
import type { IAuthoring, IComposition, IPreviousResult, IResultView, ISourceOutcome, ISourceOutcomes, IStepDescriptor, ITrackedView } from 'microdelta';

/** The analysis scope: one repository and quarter. */
export const analysisScope = 'contribution-report:acme/widget:2026-Q1';

/** The two explicitly selected contributor keys, in stable display order. */
export const memberKeys = ['person:ada', 'person:ben'] as const;

/** One selected contributor key. */
export type IMemberKey = (typeof memberKeys)[number];

/** What the source check does for a member. */
export type ICheckPolicy = 'fresh' | 'retain' | 'mutate-previous';

/** Raw external repository activity plus the current source policy answers. */
export interface IWorld {
  readonly repository: string;
  readonly profiles: readonly { readonly key: string; readonly id: string; readonly name: string; readonly avatarUrl: string }[];
  readonly pullRequests: readonly { readonly number: number; readonly author: string; readonly createdAt: string; readonly merged: boolean; readonly labels: readonly string[] }[];
  readonly reviews: readonly { readonly id: string; readonly author: string; readonly submittedAt: string; readonly state: 'submitted' | 'pending' }[];
  /** Current source check behavior per member. */
  readonly check: Readonly<Record<IMemberKey, ICheckPolicy>>;
  /** Current finality hook answer per member. */
  readonly final: Readonly<Record<IMemberKey, boolean>>;
}

/** Declared configuration: repository, window, and where the external world lives. */
export interface IConfig {
  readonly repository: string;
  readonly window: { readonly start: string; readonly end: string };
  readonly world: string;
}

/** One member's selected activity: the source result a summary reads. */
export interface IActivity {
  readonly profile: { readonly id: string; readonly name: string; readonly avatarUrl: string };
  readonly pullRequests: readonly { readonly number: number; readonly merged: boolean; readonly labels: readonly string[] }[];
  readonly reviews: readonly { readonly id: string }[];
}

/** A contributor summary: statistics and the sentence built from them. */
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

/** The sentence template. */
export type IFormat = (name: string, authored: number, merged: number, reviews: number) => string;

/** The declared helper record. Helpers take domain values only, never run context. */
export interface IHelpers {
  readonly checkActivity: (outcome: ISourceOutcomes, previous: IPreviousResult<IActivity> | undefined, config: ITrackedView<IConfig>, key: string) => ISourceOutcome<IActivity>;
  readonly acceptActivity: (previous: IPreviousResult<IActivity>, config: ITrackedView<IConfig>, key: string) => boolean;
  readonly rejectActivity: (previous: IPreviousResult<IActivity>, key: string) => boolean;
  readonly acceptCurrent: (config: ITrackedView<IConfig>, key: string) => boolean;
  readonly summarize: (activity: IResultView<IActivity>, format: ITrackedView<IFormat>, key: string) => ISummary;
  readonly format: IFormat;
  readonly legend: () => string;
}

/** Author-visible variations of one process's declarations. */
export interface IVariation {
  /** Registration order of members and helpers. */
  readonly order?: 'ada-first' | 'ben-first';
  /** Display labels; never correspondence. */
  readonly labels?: 'original' | 'renamed';
  /** The called sentence template implementation. */
  readonly formatter?: 'original' | 'revised';
  /** The declared but uncalled legend helper implementation. */
  readonly legend?: 'original' | 'revised';
  /** Compatibility version of both summaries. */
  readonly summaryVersion?: number;
  /** Ada's source check implementation. */
  readonly adaSource?: 'original' | 'changed';
  /** Ada's finality hook: present, absent, or a changed hook that rejects. */
  readonly adaFinality?: 'present' | 'absent' | 'changed';
  /**
   * Both members' finality hooks decide from current declared inputs and the
   * external world only, never reading the previous result, so a restart's
   * validation window contains no policy read of source payload at all.
   */
  readonly blindFinality?: boolean;
}

/** Write one trace line synchronously, so it survives a later SIGKILL. */
export function trace(entry: Readonly<Record<string, unknown>>): void {
  writeSync(1, `${JSON.stringify({ t: 'trace', ...entry })}\n`);
}

/** Read the current external world. */
function readWorld(path: string): IWorld {
  // The world file is written by the harness parent in this exact shape.
  return JSON.parse(readFileSync(path, 'utf8')) as IWorld;
}

/** Whether an ISO timestamp falls in the half-open window. */
function inWindow(timestamp: string, window: { readonly start: string; readonly end: string }): boolean {
  const time = Date.parse(timestamp);
  return time >= Date.parse(`${window.start}T00:00:00Z`) && time < Date.parse(`${window.end}T00:00:00Z`);
}

/** Select one member's activity from the raw world under the attribution rules. */
function selectActivity(world: IWorld, key: string, window: { readonly start: string; readonly end: string }): IActivity {
  const profile = world.profiles.find((candidate) => candidate.key === key);
  if (profile === undefined) {
    throw new Error(`no profile for ${key}`);
  }
  return {
    profile: { id: profile.id, name: profile.name, avatarUrl: profile.avatarUrl },
    pullRequests: world.pullRequests
      .filter((pull) => pull.author === key && inWindow(pull.createdAt, window))
      .sort((left, right) => left.number - right.number)
      .map((pull) => ({ number: pull.number, merged: pull.merged, labels: [...pull.labels] })),
    reviews: world.reviews
      .filter((review) => review.author === key && review.state === 'submitted' && inWindow(review.submittedAt, window))
      .map((review) => ({ id: review.id }))
      .sort((left, right) => (left.id < right.id ? -1 : left.id > right.id ? 1 : 0)),
  };
}

/** The declared source check: fresh data, explicit retention, or an attempted previous-data mutation then fresh data. */
function checkActivity(outcome: ISourceOutcomes, previous: IPreviousResult<IActivity> | undefined, config: ITrackedView<IConfig>, key: string): ISourceOutcome<IActivity> {
  const world = readWorld(config.world);
  const policy = world.check[key === 'person:ada' ? 'person:ada' : 'person:ben'];
  trace({ helper: 'check', key, previous: previous !== undefined, policy });
  if (policy === 'retain' && previous !== undefined) {
    return outcome.retain(previous);
  }
  if (policy === 'mutate-previous' && previous !== undefined) {
    // An author attempting to change the eligible previous result it was given.
    let mutated: boolean;
    try {
      mutated = Reflect.set(previous.data.profile, 'name', 'Mallory');
    } catch {
      mutated = false;
    }
    trace({ helper: 'mutate-previous', key, mutated, nameAfter: previous.data.profile.name });
  }
  return outcome.fresh(selectActivity(world, key, { start: config.window.start, end: config.window.end }));
}

/** The declared finality policy: the world's current answer for the member. */
function acceptActivity(previous: IPreviousResult<IActivity>, config: ITrackedView<IConfig>, key: string): boolean {
  const world = readWorld(config.world);
  trace({ helper: 'finality', key });
  return previous.data.profile.id.length > 0 && world.final[key === 'person:ada' ? 'person:ada' : 'person:ben'];
}

/** A finality policy that decides without reading the previous result. */
function acceptCurrent(config: ITrackedView<IConfig>, key: string): boolean {
  const world = readWorld(config.world);
  trace({ helper: 'finality-blind', key });
  return world.final[key === 'person:ada' ? 'person:ada' : 'person:ben'];
}

/** A changed finality policy that never accepts. */
function rejectActivity(previous: IPreviousResult<IActivity>, key: string): boolean {
  trace({ helper: 'finality-changed', key });
  return previous.data.profile.id.length === 0;
}

/**
 * Count one member's statistics with indexed loops over the exact retained
 * activity. Reads profile name, each PR's merged status, and the PR and
 * review counts; never labels, avatar or profile identity.
 */
function summarize(activity: IResultView<IActivity>, format: ITrackedView<IFormat>, key: string): ISummary {
  trace({ helper: 'summary', key });
  // Author-body failure injection for the unsuccessful-attempt case; the parent sets it per process.
  if (process.env['MICRODELTA_ACCEPTANCE_FAIL_SUMMARY'] === key) {
    throw new Error(`injected summary failure for ${key}`);
  }
  const authored = activity.pullRequests.length;
  let merged = 0;
  for (let index = 0; index < authored; index += 1) {
    if (activity.pullRequests[index]?.merged === true) {
      merged += 1;
    }
  }
  const reviews = activity.reviews.length;
  const name = activity.profile.name;
  return { name, authored, merged, reviews, sentence: format(name, authored, merged, reviews) };
}

/** The sentence template with deterministic singular/plural handling. */
function format(name: string, authored: number, merged: number, reviews: number): string {
  const pulls = authored === 1 ? '1 pull request' : `${String(authored)} pull requests`;
  const mergedText = merged === 1 ? '1 of which was merged' : `${String(merged)} of which were merged`;
  const reviewText = reviews === 1 ? '1 review' : `${String(reviews)} reviews`;
  return `${name} authored ${pulls}, ${mergedText}, and submitted ${reviewText}.`;
}

/** A revised template implementation producing identical sentences. */
function formatRevised(name: string, authored: number, merged: number, reviews: number): string {
  const pulls = authored === 1 ? '1 pull request' : `${String(authored)} pull requests`;
  const mergedText = merged === 1 ? '1 of which was merged' : `${String(merged)} of which were merged`;
  const reviewText = reviews === 1 ? '1 review' : `${String(reviews)} reviews`;
  return [`${name} authored ${pulls}`, mergedText, `and submitted ${reviewText}.`].join(', ');
}

/** A declared helper no callback calls. */
function legend(): string {
  return 'counts cover the selected window';
}

/** A changed implementation of the uncalled helper. */
function legendRevised(): string {
  return 'counts cover the selected window only';
}

/** One process's composed analysis. */
export interface IAnalysis {
  readonly authoring: IAuthoring<IInputs, IHelpers>;
  readonly composition: IComposition<IInputs, IHelpers>;
  readonly summaries: Readonly<Record<IMemberKey, IStepDescriptor>>;
  readonly activities: Readonly<Record<IMemberKey, IStepDescriptor>>;
}

/** The declared window and repository. */
export const reportWindow = { start: '2026-01-01', end: '2026-04-01' } as const;

/**
 * Declare and compose the analysis for one process.
 * @param variation - Author-visible declaration variations.
 * @param worldPath - Location of the external world file.
 * @returns Fresh builders, composition and step addresses.
 */
export function composeAnalysis(variation: IVariation, worldPath: string): IAnalysis {
  const builders = authoring<IInputs, IHelpers>();
  const { source, memo, compose } = builders;
  const renamed = variation.labels === 'renamed';
  const adaSubject = 'activity:acme/widget:2026-Q1:person:ada';
  const adaLabel = renamed ? 'Ada Lovelace — activity' : 'Ada activity';
  const adaActivity = variation.adaSource === 'changed'
    ? source<IActivity>({
        subject: adaSubject,
        label: adaLabel,
        finality: ({ previous, inputs, helpers }) => helpers.acceptActivity(previous, inputs.config, 'person:ada'),
        // A changed retrieval implementation (different code, same data).
        run: ({ previous, inputs, helpers, outcome }) => {
          const checked = helpers.checkActivity(outcome, previous, inputs.config, 'person:ada');
          return checked;
        },
      })
    : variation.adaFinality === 'absent'
      ? source<IActivity>({
          subject: adaSubject,
          label: adaLabel,
          run: ({ previous, inputs, helpers, outcome }) => helpers.checkActivity(outcome, previous, inputs.config, 'person:ada'),
        })
      : variation.adaFinality === 'changed'
        ? source<IActivity>({
            subject: adaSubject,
            label: adaLabel,
            finality: ({ previous, helpers }) => helpers.rejectActivity(previous, 'person:ada'),
            run: ({ previous, inputs, helpers, outcome }) => helpers.checkActivity(outcome, previous, inputs.config, 'person:ada'),
          })
        : variation.blindFinality === true
          ? source<IActivity>({
              subject: adaSubject,
              label: adaLabel,
              finality: ({ inputs, helpers }) => helpers.acceptCurrent(inputs.config, 'person:ada'),
              run: ({ previous, inputs, helpers, outcome }) => helpers.checkActivity(outcome, previous, inputs.config, 'person:ada'),
            })
          : source<IActivity>({
              subject: adaSubject,
              label: adaLabel,
              finality: ({ previous, inputs, helpers }) => helpers.acceptActivity(previous, inputs.config, 'person:ada'),
              run: ({ previous, inputs, helpers, outcome }) => helpers.checkActivity(outcome, previous, inputs.config, 'person:ada'),
            });
  const benLabel = renamed ? 'Ben Bitdiddle — activity' : 'Ben activity';
  const benActivity = variation.blindFinality === true
    ? source<IActivity>({
        subject: 'activity:acme/widget:2026-Q1:person:ben',
        label: benLabel,
        finality: ({ inputs, helpers }) => helpers.acceptCurrent(inputs.config, 'person:ben'),
        run: ({ previous, inputs, helpers, outcome }) => helpers.checkActivity(outcome, previous, inputs.config, 'person:ben'),
      })
    : source<IActivity>({
        subject: 'activity:acme/widget:2026-Q1:person:ben',
        label: benLabel,
        finality: ({ previous, inputs, helpers }) => helpers.acceptActivity(previous, inputs.config, 'person:ben'),
        run: ({ previous, inputs, helpers, outcome }) => helpers.checkActivity(outcome, previous, inputs.config, 'person:ben'),
      });
  const adaSummary = memo({
    subject: 'summary:acme/widget:2026-Q1:person:ada',
    label: renamed ? 'Ada Lovelace — summary' : 'Ada summary',
    version: variation.summaryVersion ?? 1,
    children: { activity: adaActivity },
    run: async ({ helpers, calls }) => {
      const { data } = await calls.activity();
      return helpers.summarize(data, helpers.format, 'person:ada');
    },
  });
  const benSummary = memo({
    subject: 'summary:acme/widget:2026-Q1:person:ben',
    label: renamed ? 'Ben Bitdiddle — summary' : 'Ben summary',
    version: variation.summaryVersion ?? 1,
    children: { activity: benActivity },
    run: async ({ helpers, calls }) => {
      const { data } = await calls.activity();
      return helpers.summarize(data, helpers.format, 'person:ben');
    },
  });
  const ada = { key: 'person:ada', steps: [{ slot: 'activity', declaration: adaActivity }, { slot: 'summary', declaration: adaSummary }] };
  const ben = { key: 'person:ben', steps: [{ slot: 'activity', declaration: benActivity }, { slot: 'summary', declaration: benSummary }] };
  const helpers = [
    { slot: 'checkActivity', helper: checkActivity },
    { slot: 'acceptActivity', helper: acceptActivity },
    { slot: 'rejectActivity', helper: rejectActivity },
    { slot: 'acceptCurrent', helper: acceptCurrent },
    { slot: 'summarize', helper: summarize },
    { slot: 'format', helper: variation.formatter === 'revised' ? formatRevised : format },
    { slot: 'legend', helper: variation.legend === 'revised' ? legendRevised : legend },
  ];
  const benFirst = variation.order === 'ben-first';
  const composition = compose({
    scope: analysisScope,
    inputs: [{ slot: 'config', value: { repository: 'acme/widget', window: { ...reportWindow }, world: worldPath } }],
    helpers: benFirst ? [...helpers].reverse() : helpers,
    members: benFirst ? [ben, ada] : [ada, ben],
  });
  const step = (memberKey: IMemberKey, slot: string): IStepDescriptor => ({ scope: analysisScope, role: 'step', slot, memberKey });
  return {
    authoring: builders,
    composition,
    summaries: { 'person:ada': step('person:ada', 'summary'), 'person:ben': step('person:ben', 'summary') },
    activities: { 'person:ada': step('person:ada', 'activity'), 'person:ben': step('person:ben', 'activity') },
  };
}
