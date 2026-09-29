/**
 * The M4 contribution analysis as an acceptance worker process authors it
 * through the built `microdelta` facade's alpha surface, in the shape the M4
 * plan's authoring walkthrough gives it. Each process calls
 * `composeAnalysis(variation)` afresh, so nothing survives a process exit but
 * durable History and the files the parent wrote: declarations, callbacks,
 * helpers and input objects are all newly allocated.
 *
 * - `contributors` is a composition-level keyed collection source. Its check
 *   discovers the repository's contributors from the *world file* (the
 *   stand-in for a live GitHub API): a contributor is discovered when they
 *   authored a PR created in the window or submitted a non-pending review in
 *   the window. Records are listed in the world's profile order, keyed by
 *   designated identity `key` (`person:ada`). Its finality accepts the
 *   previous listing while the world's listing revision and completion status
 *   are unchanged.
 * - `contributor` is a fanout template over that collection, built once
 *   against a symbolic member, keyed by `key` or (custom-key variant) by the
 *   upstream profile `id` (`gh:1001`). Its tracked gate requires a member when
 *   its authored count reaches `config.minimumAuthored`.
 * - Each member instance has an `activity` source that selects its member's
 *   activity through the member binding's `key`, and a `summary` memo that
 *   calls `activity`, then the supplied `assessor` slot once per authored PR
 *   with the PR number as a derived argument and the PR record forwarded from
 *   the activity result. The summary consumes each assessment's `score` only.
 * - `report` is a strict fold over every member's summary.
 *
 * Upstream records reference contributors by upstream profile `id`, so the
 * designated `key` can be renamed without touching activity (the custom-key
 * case). Every helper call that stands for a body writes one trace line
 * synchronously to fd 1, so the parent counts bodies from author-level
 * evidence. Variation branches are distinct literal callbacks, never closures
 * over variation values: a captured value would be untracked closure state.
 *
 * @see ../../../../docs/plans/m4-composition.md (Authoring shape and worked walkthrough; Concrete fixture decisions)
 * @see ../../../../examples/contribution-report/README.md (Attribution rules)
 */
import { readFileSync, writeSync } from 'node:fs';

import { authoring } from 'microdelta';
import type {
  IAuthoring,
  ICollectionResult,
  ICollectionStatus,
  IComposition,
  IFoldEntry,
  IMemberBuilder,
  IPreviousResult,
  IResultView,
  ISlotSubject,
  ISourceOutcome,
  ISourceOutcomes,
  IStepDescriptor,
  ITrackedView,
} from 'microdelta';

/** The analysis scope: one repository and quarter. */
export const analysisScope = 'contribution-report:acme/widget:2026-Q1';

/** The template slot whose instances are the contributors. */
export const templateSlot = 'contributor';

/** The composition-level slot holding the discovery collection. */
export const collectionSlot = 'contributors';

/** The composition-level slot holding the strict report fold. */
export const reportSlot = 'report';

/** The reporting window, half-open UTC `[start, end)`. */
export const reportWindow = { start: '2026-01-01', end: '2026-04-01' } as const;

/** One upstream profile. `key` is stable contributor identity (absent only in the missing-identity world); `id` is the upstream account id every record references. */
export interface IWorldProfile {
  readonly key?: string;
  readonly id: string;
  readonly name: string;
  readonly avatarUrl: string;
}

/** One upstream pull request, authored by an upstream account id. */
export interface IWorldPullRequest {
  readonly number: number;
  readonly author: string;
  readonly createdAt: string;
  readonly merged: boolean;
  readonly labels: readonly string[];
}

/** One upstream review by an upstream account id. Pending reviews were never submitted. */
export interface IWorldReview {
  readonly id: string;
  readonly author: string;
  readonly submittedAt: string;
  readonly state: 'submitted' | 'pending';
}

/** An admission decision the world's policy makes for one step. */
export type IDecision = 'denied' | 'cancelled';

/**
 * The external world one process sees: upstream data and current policy
 * answers, written by the parent before each process starts.
 */
export interface IWorld {
  readonly repository: string;
  /** The upstream contributor listing's revision; changes whenever what it lists or its order changes, like an ETag. */
  readonly revision: number;
  /** Whether the upstream reports its contributor listing as complete or still open. */
  readonly listing: ICollectionStatus;
  /** Whether a member's previous activity is still final under its current source policy. */
  readonly activityFinal: boolean;
  readonly profiles: readonly IWorldProfile[];
  readonly pullRequests: readonly IWorldPullRequest[];
  readonly reviews: readonly IWorldReview[];
  /** Display names whose summary body fails, standing in for an author error. */
  readonly failSummary: readonly string[];
  /** Admission decisions by `<slot>/<member key>` for member steps, or `<slot>` for composition-level steps. */
  readonly decisions: Readonly<Record<string, IDecision>>;
}

/** Declared configuration: repository, window and the gate threshold. */
export interface IConfig {
  readonly repository: string;
  readonly window: { readonly start: string; readonly end: string };
  /** A discovered contributor is required when their authored PR count in the window reaches this. */
  readonly minimumAuthored: number;
}

/** Declared rubric configuration every assessor implementation reads. */
export interface IRubric {
  /** Explanation wording; never changes a score. */
  readonly wording: string;
  /** The score of a merged PR labelled `bug`. */
  readonly mergedBugScore: number;
}

/** The declared input record. */
export interface IInputs {
  readonly config: IConfig;
  readonly rubric: IRubric;
}

/** One discovered contributor record. */
export interface IContributor {
  /** Designated identity; absent only when the upstream profile has none. */
  readonly key?: string;
  /** Upstream profile id: the custom key. */
  readonly id: string;
  /** Display name; no member work reads it from the discovery record. */
  readonly name: string;
  /** Authored PRs created in the window; read by the gate. */
  readonly authored: number;
}

/** The discovery result: members, completion status and the listing revision it came from. */
export interface IContributors extends ICollectionResult<IContributor> {
  /** Read only by discovery's finality policy. */
  readonly revision: number;
}

/** One authored pull request as a member's activity holds it. */
export interface IPullRequest {
  readonly number: number;
  readonly merged: boolean;
  /** Read only by the assessor, and only for merged PRs. */
  readonly labels: readonly string[];
}

/** One contributor's selected activity. The summary reads the profile name, PR merged flags and numbers, and the review count. */
export interface IActivity {
  readonly profile: { readonly id: string; readonly name: string; readonly avatarUrl: string };
  readonly pullRequests: readonly IPullRequest[];
  readonly reviews: readonly { readonly id: string }[];
}

/** One PR's assessment. The summary consumes only `score`. */
export interface IAssessment {
  readonly score: number;
  readonly explanation: string;
}

/**
 * The assessor slot's call signature: the PR number (derived), the PR record
 * (forwarded) and, only in the unreconstructible variant, a function.
 */
export type IAssessorParameters = readonly [number, IPullRequest, unknown?];

/** A contributor summary: M3's statistics and sentence, plus the total consumed assessment score. */
export interface ISummary {
  readonly name: string;
  readonly authored: number;
  readonly merged: number;
  readonly reviews: number;
  readonly score: number;
  readonly sentence: string;
}

/** One required contributor as the report lists it. */
export interface IReportEntry {
  readonly key: string;
  readonly score: number;
  readonly sentence: string;
}

/** The strict report's result: scope, threshold, required members in key order and gate exclusions. */
export interface IReport {
  readonly repository: string;
  readonly window: { readonly start: string; readonly end: string };
  readonly minimumAuthored: number;
  readonly required: readonly IReportEntry[];
  readonly excluded: readonly string[];
}

/** The entries the strict report receives: one per current member. */
export type ISummaryEntries = readonly IFoldEntry<IResultView<ISummary>>[];

/** The sentence template. */
export type IFormat = (name: string, authored: number, merged: number, reviews: number) => string;

/** The declared helper record. Helpers take domain values only, never run context. */
export interface IHelpers {
  readonly discover: (outcome: ISourceOutcomes, config: ITrackedView<IConfig>) => ISourceOutcome<IContributors>;
  readonly isDiscoveryFinal: (previous: IPreviousResult<IContributors>) => boolean;
  readonly checkActivity: (outcome: ISourceOutcomes, config: ITrackedView<IConfig>, key: string) => ISourceOutcome<IActivity>;
  readonly isActivityFinal: (previous: IPreviousResult<IActivity>) => boolean;
  readonly assessA: (number: number, pullRequest: IResultView<IPullRequest>, rubric: ITrackedView<IRubric>) => IAssessment;
  readonly assessB: (number: number, pullRequest: IResultView<IPullRequest>, rubric: ITrackedView<IRubric>) => IAssessment;
  readonly assessC: (number: number, pullRequest: IResultView<IPullRequest>, rubric: ITrackedView<IRubric>) => IAssessment;
  readonly summarize: (activity: IResultView<IActivity>, scores: readonly number[], format: ITrackedView<IFormat>) => ISummary;
  readonly format: IFormat;
  readonly render: (members: ISummaryEntries, config: ITrackedView<IConfig>) => IReport;
  readonly renderRequired: (members: ISummaryEntries, config: ITrackedView<IConfig>) => IReport;
}

/** The world file this process reads, set once by the worker before any run. */
let worldFile: string | undefined;

/** Select the world file for the rest of this process. */
export function useWorld(path: string): void {
  worldFile = path;
}

/** Read the current external world. */
export function readWorld(): IWorld {
  if (worldFile === undefined) {
    throw new Error('no world file selected for this process');
  }
  // The harness parent writes the world file in exactly this shape.
  return JSON.parse(readFileSync(worldFile, 'utf8')) as IWorld;
}

/** Write one trace line synchronously. */
export function trace(entry: Readonly<Record<string, unknown>>): void {
  writeSync(1, `${JSON.stringify({ t: 'trace', ...entry })}\n`);
}

/** Whether an ISO timestamp falls in the half-open window. */
function inWindow(timestamp: string, window: { readonly start: string; readonly end: string }): boolean {
  const time = Date.parse(timestamp);
  return time >= Date.parse(`${window.start}T00:00:00Z`) && time < Date.parse(`${window.end}T00:00:00Z`);
}

/** An account's unique authored PRs created in the window, ordered by number. */
function authoredBy(world: IWorld, account: string, window: IConfig['window']): IWorldPullRequest[] {
  return world.pullRequests.filter((pull) => pull.author === account && inWindow(pull.createdAt, window)).sort((left, right) => left.number - right.number);
}

/** An account's unique submitted reviews in the window, ordered by id. */
function reviewedBy(world: IWorld, account: string, window: IConfig['window']): IWorldReview[] {
  return world.reviews
    .filter((review) => review.author === account && review.state === 'submitted' && inWindow(review.submittedAt, window))
    .sort((left, right) => (left.id < right.id ? -1 : left.id > right.id ? 1 : 0));
}

/** The discovery check: the current upstream listing, under the upstream's current completion status. */
function discover(outcome: ISourceOutcomes, config: ITrackedView<IConfig>): ISourceOutcome<IContributors> {
  trace({ helper: 'discover' });
  const world = readWorld();
  const window = { start: config.window.start, end: config.window.end };
  if (world.repository !== config.repository) {
    throw new Error(`the world holds ${world.repository}, not ${config.repository}`);
  }
  const members = world.profiles.flatMap((profile): IContributor[] => {
    const authored = authoredBy(world, profile.id, window).length;
    const reviewed = reviewedBy(world, profile.id, window).length;
    if (authored === 0 && reviewed === 0) {
      return [];
    }
    return [profile.key === undefined ? { id: profile.id, name: profile.name, authored } : { key: profile.key, id: profile.id, name: profile.name, authored }];
  });
  const listing: IContributors = { revision: world.revision, status: world.listing, members };
  return outcome.fresh(listing);
}

/** Discovery's finality policy: the previous listing stands while its revision and completion status are current. */
function isDiscoveryFinal(previous: IPreviousResult<IContributors>): boolean {
  const world = readWorld();
  return previous.data.revision === world.revision && previous.data.status === world.listing;
}

/** The member activity check: fresh upstream data for the contributor with designated identity `key`. */
function checkActivity(outcome: ISourceOutcomes, config: ITrackedView<IConfig>, key: string): ISourceOutcome<IActivity> {
  trace({ helper: 'activity', key });
  const world = readWorld();
  const profile = world.profiles.find((candidate) => candidate.key === key);
  if (profile === undefined) {
    throw new Error(`no upstream profile for ${key}`);
  }
  const window = { start: config.window.start, end: config.window.end };
  const activity: IActivity = {
    profile: { id: profile.id, name: profile.name, avatarUrl: profile.avatarUrl },
    pullRequests: authoredBy(world, profile.id, window).map((pull) => ({ number: pull.number, merged: pull.merged, labels: [...pull.labels] })),
    reviews: reviewedBy(world, profile.id, window).map((review) => ({ id: review.id })),
  };
  return outcome.fresh(activity);
}

/** The member activity finality policy: the world's current answer for an existing previous result. */
function isActivityFinal(previous: IPreviousResult<IActivity>): boolean {
  return previous.data.profile.id.length > 0 && readWorld().activityFinal;
}

/** Whether a PR carries the `bug` label; read with an indexed loop so each label is its own observed fact. */
function isBugFix(pullRequest: IResultView<IPullRequest>): boolean {
  const labels = pullRequest.labels;
  for (let index = 0; index < labels.length; index += 1) {
    if (labels[index] === 'bug') {
      return true;
    }
  }
  return false;
}

/**
 * Rubric A: a merged PR scores 2 (a merged `bug` PR scores
 * `rubric.mergedBugScore`), an unmerged PR 1. Each rubric is self-contained:
 * a helper's tracked implementation is its own function.
 */
function assessA(number: number, pullRequest: IResultView<IPullRequest>, rubric: ITrackedView<IRubric>): IAssessment {
  trace({ helper: 'assess', number, rubric: 'A' });
  const score = pullRequest.merged ? (isBugFix(pullRequest) ? rubric.mergedBugScore : 2) : 1;
  return { score, explanation: `${rubric.wording}: rubric A scores PR ${String(number)} ${String(score)}.` };
}

/** Rubric B: rubric A's scores, with its own code and differently structured explanations. */
function assessB(number: number, pullRequest: IResultView<IPullRequest>, rubric: ITrackedView<IRubric>): IAssessment {
  trace({ helper: 'assess', number, rubric: 'B' });
  let score = 1;
  if (pullRequest.merged) {
    score = isBugFix(pullRequest) ? rubric.mergedBugScore : 2;
  }
  return { score, explanation: [`PR ${String(number)}`, `earns ${String(score)} under rubric B`, rubric.wording].join(' / ') };
}

/** Rubric C: rubric A, except that an unmerged PR scores 0. */
function assessC(number: number, pullRequest: IResultView<IPullRequest>, rubric: ITrackedView<IRubric>): IAssessment {
  trace({ helper: 'assess', number, rubric: 'C' });
  const score = pullRequest.merged ? (isBugFix(pullRequest) ? rubric.mergedBugScore : 2) : 0;
  return { score, explanation: `${rubric.wording}: rubric C scores PR ${String(number)} ${String(score)}.` };
}

/**
 * Count one contributor's statistics with indexed loops over the exact
 * activity, total the consumed assessment scores and render the sentence.
 * Reads the profile name, each PR's merged status and the PR and review
 * counts; never labels, avatar or profile identity. A world-listed name makes
 * it fail, standing in for an author error.
 */
function summarize(activity: IResultView<IActivity>, scores: readonly number[], format: ITrackedView<IFormat>): ISummary {
  const name = activity.profile.name;
  trace({ helper: 'summary', name });
  if (readWorld().failSummary.includes(name)) {
    throw new Error(`injected summary failure for ${name}`);
  }
  const authored = activity.pullRequests.length;
  let merged = 0;
  for (let index = 0; index < authored; index += 1) {
    if (activity.pullRequests[index]?.merged === true) {
      merged += 1;
    }
  }
  let score = 0;
  for (const assessed of scores) {
    score += assessed;
  }
  const reviews = activity.reviews.length;
  return { name, authored, merged, reviews, score, sentence: format(name, authored, merged, reviews) };
}

/** The sentence template with deterministic singular/plural handling. */
function format(name: string, authored: number, merged: number, reviews: number): string {
  const pulls = authored === 1 ? '1 pull request' : `${String(authored)} pull requests`;
  const mergedText = merged === 1 ? '1 of which was merged' : `${String(merged)} of which were merged`;
  const reviewText = reviews === 1 ? '1 review' : `${String(reviews)} reviews`;
  return `${name} authored ${pulls}, ${mergedText}, and submitted ${reviewText}.`;
}

/**
 * The strict report body: every succeeded member in the entries' canonical
 * key order with its sentence and score, every skipped member as excluded by
 * the gate, and the repository, window and threshold. It reads each
 * summary's `sentence` and `score` only.
 */
function render(members: ISummaryEntries, config: ITrackedView<IConfig>): IReport {
  trace({ helper: 'report', body: 'lists-skipped', entries: members.map((entry) => `${entry.key}=${entry.status}`) });
  const required: IReportEntry[] = [];
  const excluded: string[] = [];
  for (const entry of members) {
    if (entry.status === 'succeeded') {
      required.push({ key: entry.key, score: entry.data.score, sentence: entry.data.sentence });
    } else {
      excluded.push(entry.key);
    }
  }
  return { repository: config.repository, window: { start: config.window.start, end: config.window.end }, minimumAuthored: config.minimumAuthored, required, excluded };
}

/** A report body that lists required members only and silently drops every exclusion, so coverage must come from the framework. */
function renderRequired(members: ISummaryEntries, config: ITrackedView<IConfig>): IReport {
  trace({ helper: 'report', body: 'omits-skipped', entries: members.map((entry) => `${entry.key}=${entry.status}`) });
  const required: IReportEntry[] = [];
  for (const entry of members) {
    if (entry.status === 'succeeded') {
      required.push({ key: entry.key, score: entry.data.score, sentence: entry.data.sentence });
    }
  }
  return { repository: config.repository, window: { start: config.window.start, end: config.window.end }, minimumAuthored: config.minimumAuthored, required, excluded: [] };
}

/** Which implementation the summary memo declares. */
export type ISummaryVariant =
  /** The plan's summary. */
  | 'standard'
  /** Makes an observed untracked read of the rubric wording before deriving any argument. */
  | 'untracked'
  /** Passes a function as a third assessor argument, which no value can reconstruct. */
  | 'unreconstructible'
  /** Tries to create a member operation named by its activity result after the composition froze. */
  | 'result-created';

/** Author-visible choices of one process's composition. */
export interface IVariation {
  /** Register helpers, composition steps, templates and supplies in reverse; registration order is never identity. */
  readonly reverse?: boolean;
  /** Designated identity `key` (default) or the custom key `id`. */
  readonly key?: 'key' | 'id';
  /** The gate threshold input (default 1). */
  readonly minimumAuthored?: number;
  /** The rubric input (default wording `standard`, merged bug score 2). */
  readonly rubric?: IRubric;
  /** Which assessor implementation(s) the composition supplies: one rubric (default A), none, or both A and B. */
  readonly assessor?: 'A' | 'B' | 'C' | 'none' | 'A+B';
  /** The summary memo's implementation (default `standard`). */
  readonly summary?: ISummaryVariant;
  /** The report body (default `lists-skipped`). */
  readonly report?: 'lists-skipped' | 'omits-skipped';
  /** Mutate every author-owned array, record and input object after composing. */
  readonly mutateAfterCompose?: boolean;
}

/** The default rubric input. */
export const defaultRubric: IRubric = { wording: 'standard', mergedBugScore: 2 };

/** One process's composed analysis. */
export interface IAnalysis {
  readonly authoring: IAuthoring<IInputs, IHelpers>;
  readonly composition: IComposition<IInputs, IHelpers>;
  /** Template step-factory invocations while composing this process's build. */
  readonly factoryCalls: number;
  /** The strict report fold. */
  readonly report: IStepDescriptor;
  /** One member's summary instance. */
  summary(memberKey: string): IStepDescriptor;
}

/** The complete history subject of one PR's assessment, from its derived PR number only. */
const assessmentSubject: ISlotSubject<IAssessorParameters> = (derived) => {
  const number = derived[0];
  if (number === undefined) {
    throw new Error('an assessment subject needs the derived pull request number');
  }
  return `assessment:acme/widget:${String(number)}`;
};

/** Order a registration list by the variation, as a fresh mutable array. */
function ordered<T>(items: readonly T[], variation: IVariation): T[] {
  return variation.reverse === true ? [...items].reverse() : [...items];
}

/**
 * Declare and compose the analysis for one process.
 * @param variation - Author-visible declaration choices.
 * @returns Fresh builders, the frozen composition and step addresses.
 */
export function composeAnalysis(variation: IVariation = {}): IAnalysis {
  const builders = authoring<IInputs, IHelpers>();
  const { source, template, fold, stepSlot, suppliedStep, supply, forward, compose } = builders;
  const assessor = stepSlot<IAssessorParameters, IAssessment>({ slot: 'assessor' });

  const contributors = source<IContributors>({
    subject: 'contributors:acme/widget:2026-Q1',
    label: 'contributor discovery',
    collection: { identity: 'key' },
    finality: ({ previous, helpers }) => helpers.isDiscoveryFinal(previous),
    run: ({ inputs, helpers, outcome }) => helpers.discover(outcome, inputs.config),
  });

  let factoryCalls = 0;
  /** The factory's returned record, kept so the mutation variant can change it after composing. */
  let factoryRecord: Record<string, unknown> = {};
  /** The member steps, built once against the symbolic member. */
  const steps = (member: IMemberBuilder<IInputs, IHelpers, IContributor>) => {
    factoryCalls += 1;
    const activity = member.source<IActivity>({
      subject: member.subject('activity:acme/widget:2026-Q1'),
      label: 'contributor activity',
      finality: ({ previous, helpers }) => helpers.isActivityFinal(previous),
      run: ({ member: contributor, inputs, helpers, outcome }) => helpers.checkActivity(outcome, inputs.config, contributor.key ?? ''),
    });
    const subject = member.subject('summary:acme/widget:2026-Q1');
    const children = { activity, assess: assessor };
    const summary = variation.summary === 'untracked'
      ? member.memo({
          subject,
          label: 'contributor summary',
          children,
          run: async ({ calls, helpers, inputs, untracked }) => {
            const selected = await calls.activity();
            // An observed untracked read before any derived argument: recorded evidence can no longer justify the PR numbers derived below.
            const wording = untracked(inputs.rubric, 'wording');
            const scores: number[] = [];
            const count = wording.length > 0 ? selected.data.pullRequests.length : 0;
            for (let index = 0; index < count; index += 1) {
              const pullRequest = selected.data.pullRequests[index];
              if (pullRequest === undefined) {
                continue;
              }
              const assessed = await calls.assess(pullRequest.number, forward.child<IPullRequest>(selected, ['pullRequests', index]));
              scores.push(assessed.data.score);
            }
            return helpers.summarize(selected.data, scores, helpers.format);
          },
        })
      : variation.summary === 'unreconstructible'
        ? member.memo({
            subject,
            label: 'contributor summary',
            children,
            run: async ({ calls, helpers }) => {
              const selected = await calls.activity();
              const scores: number[] = [];
              const count = selected.data.pullRequests.length;
              for (let index = 0; index < count; index += 1) {
                const pullRequest = selected.data.pullRequests[index];
                if (pullRequest === undefined) {
                  continue;
                }
                // A function argument keeps no value: it is recorded unreconstructible.
                const assessed = await calls.assess(pullRequest.number, forward.child<IPullRequest>(selected, ['pullRequests', index]), () => index);
                scores.push(assessed.data.score);
              }
              return helpers.summarize(selected.data, scores, helpers.format);
            },
          })
        : variation.summary === 'result-created'
          ? member.memo({
              subject,
              label: 'contributor summary',
              children,
              run: async ({ calls, helpers }) => {
                const selected = await calls.activity();
                // CMP-9: try to add an operation named by a child's result through the frozen member builder.
                // eslint-disable-next-line microdelta/tracked-captures -- Deliberate CMP-9 violation: the frozen member builder is captured to prove a result-created operation is rejected before any admission.
                member.memo({ subject: member.subject(`created:${selected.data.profile.name}`), run: () => ({ created: true }) });
                return helpers.summarize(selected.data, [], helpers.format);
              },
            })
          : member.memo({
              subject,
              label: 'contributor summary',
              children,
              run: async ({ calls, helpers }) => {
                const selected = await calls.activity();
                const scores: number[] = [];
                const count = selected.data.pullRequests.length;
                for (let index = 0; index < count; index += 1) {
                  const pullRequest = selected.data.pullRequests[index];
                  if (pullRequest === undefined) {
                    continue;
                  }
                  // The PR number is a derived scalar; the PR record is forwarded from the activity result.
                  const assessed = await calls.assess(pullRequest.number, forward.child<IPullRequest>(selected, ['pullRequests', index]));
                  scores.push(assessed.data.score);
                }
                return helpers.summarize(selected.data, scores, helpers.format);
              },
            });
    factoryRecord = { activity, summary };
    return { activity, summary };
  };

  const contributor = variation.key === 'id'
    ? template({
        slot: templateSlot,
        collection: contributors,
        key: (member) => member.id,
        gate: ({ member, inputs }) => member.authored >= inputs.config.minimumAuthored,
        steps,
      })
    : template({
        slot: templateSlot,
        collection: contributors,
        gate: ({ member, inputs }) => member.authored >= inputs.config.minimumAuthored,
        steps,
      });

  const over = { template: contributor, step: 'summary' } as const;
  const report = variation.report === 'omits-skipped'
    ? fold({ subject: 'report:acme/widget:2026-Q1', label: 'contribution report', over, run: ({ members, inputs, helpers }) => helpers.renderRequired(members, inputs.config) })
    : fold({ subject: 'report:acme/widget:2026-Q1', label: 'contribution report', over, run: ({ members, inputs, helpers }) => helpers.render(members, inputs.config) });

  const rubricSteps = {
    A: suppliedStep<IAssessorParameters, IAssessment>({ label: 'rubric A', run: ({ args, inputs, helpers }) => helpers.assessA(args[0], args[1], inputs.rubric) }),
    B: suppliedStep<IAssessorParameters, IAssessment>({ label: 'rubric B', run: ({ args, inputs, helpers }) => helpers.assessB(args[0], args[1], inputs.rubric) }),
    C: suppliedStep<IAssessorParameters, IAssessment>({ label: 'rubric C', run: ({ args, inputs, helpers }) => helpers.assessC(args[0], args[1], inputs.rubric) }),
  };
  const chosen = variation.assessor ?? 'A';
  const supplied = ordered(
    chosen === 'none'
      ? []
      : chosen === 'A+B'
        ? [supply({ slot: assessor, declaration: rubricSteps.A, subject: assessmentSubject }), supply({ slot: assessor, declaration: rubricSteps.B, subject: assessmentSubject })]
        : [supply({ slot: assessor, declaration: rubricSteps[chosen], subject: assessmentSubject })],
    variation,
  );

  const config: { repository: string; window: { start: string; end: string }; minimumAuthored: number } = {
    repository: 'acme/widget',
    window: { start: reportWindow.start, end: reportWindow.end },
    minimumAuthored: variation.minimumAuthored ?? 1,
  };
  const rubric: { wording: string; mergedBugScore: number } = { ...(variation.rubric ?? defaultRubric) };
  const inputs: { slot: string; value: unknown }[] = [{ slot: 'config', value: config }, { slot: 'rubric', value: rubric }];
  const helpers = ordered([
    { slot: 'discover', helper: discover },
    { slot: 'isDiscoveryFinal', helper: isDiscoveryFinal },
    { slot: 'checkActivity', helper: checkActivity },
    { slot: 'isActivityFinal', helper: isActivityFinal },
    { slot: 'assessA', helper: assessA },
    { slot: 'assessB', helper: assessB },
    { slot: 'assessC', helper: assessC },
    { slot: 'summarize', helper: summarize },
    { slot: 'format', helper: format },
    { slot: 'render', helper: render },
    { slot: 'renderRequired', helper: renderRequired },
  ], variation);
  const compositionSteps = ordered([{ slot: collectionSlot, declaration: contributors }, { slot: reportSlot, declaration: report }], variation);
  const templates = ordered([contributor], variation);
  const composition = compose({ scope: analysisScope, inputs, helpers, steps: compositionSteps, templates, supplied });

  if (variation.mutateAfterCompose === true) {
    // CMP-1: every author-owned array, record and input object changes after the freeze.
    compositionSteps.push({ slot: 'late', declaration: contributors });
    compositionSteps.reverse();
    templates.push(contributor);
    supplied.length = 0;
    helpers.reverse();
    inputs.push({ slot: 'late', value: { minimumAuthored: 99 } });
    config.minimumAuthored = 99;
    config.window.start = '2025-01-01';
    rubric.mergedBugScore = 99;
    Reflect.deleteProperty(factoryRecord, 'summary');
    factoryRecord['late'] = contributors;
  }

  return {
    authoring: builders,
    composition,
    factoryCalls,
    report: Object.freeze({ scope: analysisScope, role: 'step', slot: reportSlot }),
    summary: (memberKey) => Object.freeze({ scope: analysisScope, role: 'step', slot: 'summary', template: templateSlot, collection: collectionSlot, memberKey }),
  };
}
