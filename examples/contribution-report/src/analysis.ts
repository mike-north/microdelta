/**
 * The contribution analysis, authored against the facade's alpha workspace
 * surface. Given repository identity and a reporting window it discovers the
 * repository's contributors, summarizes each required contributor with a
 * nested, supplied assessor, and folds every required summary into one
 * strict repository report.
 *
 * - `contributors` is a composition-level keyed collection source: discovery
 *   yields contributor records keyed by designated identity `key`, with a
 *   completion status.
 * - `contributor` is a fanout template over that collection, built once
 *   against a symbolic member and instantiated per member key (or per custom
 *   key `id`). Its tracked gate requires a member when its authored count
 *   reaches `config.minimumAuthored`; gated-out members are skipped instances.
 * - Each member instance has an `activity` source that reads its member's
 *   `key` through the member binding, and a `summary` memo that calls
 *   `activity`, then the supplied `assessor` slot once per authored PR with the
 *   PR number as a derived argument and the PR record forwarded from the
 *   activity result. The summary consumes each assessment's `score` only.
 * - `report` is a strict fold over every member's summary: it runs only once
 *   discovery is closed and every required member succeeded.
 * - `status` is an outcome (tolerant) fold over the same summaries: once
 *   every member has settled it lists each contributor's settled status,
 *   failures included, while the framework reports coverage; it never runs
 *   while a member is unsettled.
 *
 * Subjects are complete opaque author strings; member subjects are
 * `prefix:key`. Callbacks use only their typed context and the canonical
 * `forward` origins; helpers take domain values, never run context.
 */
import { authoring } from 'microdelta';
import type {
  IAuthoring,
  IComposition,
  IFoldEntry,
  IMemberBuilder,
  IOutcomeEntry,
  IPreviousResult,
  IResultView,
  ISlotSubject,
  ISourceOutcome,
  ISourceOutcomes,
  IStepDescriptor,
  ITrackedView,
} from 'microdelta';

import { checkActivity, isFinal } from './activity.js';
import type { IActivity, IPullRequest } from './activity.js';
import { assessRubricA, assessRubricB, assessRubricC, assessRubricP } from './assessment.js';
import type { IAssessment, IAssessorParameters, IRubric } from './assessment.js';
import { discover, isDiscoveryFinal } from './discovery.js';
import type { IContributor, IContributors } from './discovery.js';
import type { IConfig } from './fixture.js';

/** The analysis scope: one repository and quarter. */
export const analysisScope = 'contribution-report:acme/widget:2026-Q1';

/** The template slot whose instances are the contributors. */
export const templateSlot = 'contributor';

/** The composition-level slot holding the discovery collection. */
export const collectionSlot = 'contributors';

/** The configuration every variation shares; the gate threshold is chosen per variation. */
export const baseConfig: Omit<IConfig, 'minimumAuthored'> = { repository: 'acme/widget', window: { start: '2026-01-01', end: '2026-04-01' } };

/** A contributor summary: M3's statistics and sentence, plus the total assessed score. */
export interface ISummary {
  readonly name: string;
  readonly authored: number;
  readonly merged: number;
  readonly reviews: number;
  /** The sum of the consumed assessment scores of every authored PR. */
  readonly score: number;
  readonly sentence: string;
}

/** One required contributor as the report lists it. */
export interface IReportEntry {
  readonly key: string;
  readonly score: number;
  readonly sentence: string;
}

/**
 * The strict report's result. It lists required members in key order and
 * members the gate excluded, and states the scope and threshold. Coverage is
 * the framework's outcome, not something the report claims.
 */
export interface IReport {
  readonly repository: string;
  readonly window: { readonly start: string; readonly end: string };
  readonly minimumAuthored: number;
  readonly required: readonly IReportEntry[];
  readonly excluded: readonly string[];
}

/** The declared input record. */
export interface IInputs {
  readonly config: IConfig;
}

/** One contributor's settled status as the status report lists it; only a succeeded member has a score. */
export interface IStatusEntry {
  readonly key: string;
  readonly status: 'succeeded' | 'skipped' | 'failed' | 'cancelled';
  readonly score: number | null;
}

/**
 * The outcome fold's result: every current contributor's settled status in
 * key order, with the scope it covers. Coverage is the framework's outcome,
 * not something the report claims.
 */
export interface IStatusReport {
  readonly repository: string;
  readonly window: { readonly start: string; readonly end: string };
  readonly entries: readonly IStatusEntry[];
}

/** The entries the status report receives: one per current member, with its settled status. */
export type IStatusEntries = readonly IOutcomeEntry<IResultView<ISummary>>[];

/** The deterministic sentence template. */
export type IFormat = (name: string, authored: number, merged: number, reviews: number) => string;

/** The entries the strict report receives: one per current member. */
export type ISummaryEntries = readonly IFoldEntry<IResultView<ISummary>>[];

/** The declared helper record. Helpers take domain values only, never run context. */
export interface IHelpers {
  readonly discover: (outcome: ISourceOutcomes, config: ITrackedView<IConfig>) => ISourceOutcome<IContributors>;
  readonly isDiscoveryFinal: (previous: IPreviousResult<IContributors>) => boolean;
  readonly checkActivity: (outcome: ISourceOutcomes, config: ITrackedView<IConfig>, key: string) => ISourceOutcome<IActivity>;
  readonly isFinal: (previous: IPreviousResult<IActivity>) => boolean;
  readonly assessRubricA: typeof assessRubricA;
  readonly assessRubricB: typeof assessRubricB;
  readonly assessRubricC: typeof assessRubricC;
  readonly assessRubricP: typeof assessRubricP;
  readonly summarize: (activity: IResultView<IActivity>, scores: readonly number[], format: ITrackedView<IFormat>) => ISummary;
  readonly format: IFormat;
  readonly render: (members: ISummaryEntries, config: ITrackedView<IConfig>) => IReport;
  readonly renderStatus: (members: IStatusEntries, config: ITrackedView<IConfig>) => IStatusReport;
}

/**
 * Count one contributor's statistics with indexed loops over the exact
 * retained activity, total the consumed assessment scores and render the
 * sentence. Reads the profile name, each PR's merged status and the number
 * of PRs and reviews; never labels, avatar, profile identity or revision.
 */
function summarize(activity: IResultView<IActivity>, scores: readonly number[], format: ITrackedView<IFormat>): ISummary {
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
  const name = activity.profile.name;
  return { name, authored, merged, reviews, score, sentence: format(name, authored, merged, reviews) };
}

/** The template string with deterministic singular/plural handling. */
function format(name: string, authored: number, merged: number, reviews: number): string {
  const pulls = authored === 1 ? '1 pull request' : `${String(authored)} pull requests`;
  const mergedText = merged === 1 ? '1 of which was merged' : `${String(merged)} of which were merged`;
  const reviewText = reviews === 1 ? '1 review' : `${String(reviews)} reviews`;
  return `${name} authored ${pulls}, ${mergedText}, and submitted ${reviewText}.`;
}

/**
 * The strict report body: every succeeded member in the entries' canonical
 * key order with its sentence and score, every skipped member as excluded by
 * the gate, and the repository, window and threshold. It reads each summary's
 * `sentence` and `score` only.
 */
function render(members: ISummaryEntries, config: ITrackedView<IConfig>): IReport {
  const required: IReportEntry[] = [];
  const excluded: string[] = [];
  for (const entry of members) {
    if (entry.status === 'succeeded') {
      required.push({ key: entry.key, score: entry.data.score, sentence: entry.data.sentence });
    } else {
      excluded.push(entry.key);
    }
  }
  return {
    repository: config.repository,
    window: { start: config.window.start, end: config.window.end },
    minimumAuthored: config.minimumAuthored,
    required,
    excluded,
  };
}

/**
 * The outcome fold body: every current member's settled status in the
 * entries' canonical key order, with the score of each succeeded member
 * (the only summary field it reads), and the repository and window.
 */
function renderStatus(members: IStatusEntries, config: ITrackedView<IConfig>): IStatusReport {
  return {
    repository: config.repository,
    window: { start: config.window.start, end: config.window.end },
    entries: members.map((entry) => ({ key: entry.key, status: entry.status, score: entry.status === 'succeeded' ? entry.data.score : null })),
  };
}

/** Which member key the template uses: designated identity `key` or the custom key `id`. */
export type IKeyChoice = 'key' | 'id';

/** Author-visible choices of one composition. */
export interface IVariation {
  /** The assessor implementation supplied to the `assessor` slot. */
  readonly rubric: IRubric;
  /** The gate threshold input. */
  readonly minimumAuthored: number;
  /** Designated identity or the custom key. */
  readonly key: IKeyChoice;
  /** Register helpers and composition steps in reverse; registration order is never identity. */
  readonly reverse: boolean;
}

/** The default variation: rubric A, threshold 1, designated identity, forward registration. */
export const defaultVariation: IVariation = { rubric: 'A', minimumAuthored: 1, key: 'key', reverse: false };

/** The composed analysis: builders, frozen composition and the step addresses the entry operations use. */
export interface IAnalysis {
  readonly authoring: IAuthoring<IInputs, IHelpers>;
  readonly composition: IComposition<IInputs, IHelpers>;
  /** The strict report fold. */
  readonly report: IStepDescriptor;
  /** The outcome (tolerant) status fold. */
  readonly status: IStepDescriptor;
  /** The discovery collection source. */
  readonly discovery: IStepDescriptor;
  /** One member's summary instance. */
  summary(memberKey: string): IStepDescriptor;
}

/** Order a registration list by the variation. */
function ordered<T>(items: readonly T[], variation: IVariation): readonly T[] {
  return variation.reverse ? [...items].reverse() : items;
}

/** The complete history subject of one PR's assessment, from its derived PR number only. */
const assessmentSubject: ISlotSubject<IAssessorParameters> = (derived) => {
  const number = derived[0];
  if (number === undefined) {
    throw new Error('an assessment subject needs the derived pull request number');
  }
  return `assessment:acme/widget:${String(number)}`;
};

/**
 * Declare and compose the analysis. Every call allocates fresh declarations,
 * callbacks and inputs, as each process does; member keys and slots, never
 * registration order, connect results across runs.
 */
export function composeAnalysis(variation: IVariation = defaultVariation): IAnalysis {
  const builders = authoring<IInputs, IHelpers>();
  const { source, template, fold, outcomeFold, stepSlot, suppliedStep, supply, forward, compose } = builders;
  const assessor = stepSlot<IAssessorParameters, IAssessment>({ slot: 'assessor' });

  const contributors = source<IContributors>({
    subject: 'contributors:acme/widget:2026-Q1',
    label: 'contributor discovery',
    collection: { identity: 'key' },
    finality: ({ previous, helpers }) => helpers.isDiscoveryFinal(previous),
    run: ({ inputs, helpers, outcome }) => helpers.discover(outcome, inputs.config),
  });

  /** The member steps, built once against the symbolic member. */
  const steps = (member: IMemberBuilder<IInputs, IHelpers, IContributor>) => {
    const activity = member.source<IActivity>({
      subject: member.subject('activity:acme/widget:2026-Q1'),
      label: 'contributor activity',
      finality: ({ previous, helpers }) => helpers.isFinal(previous),
      run: ({ member: contributor, inputs, helpers, outcome }) => helpers.checkActivity(outcome, inputs.config, contributor.key),
    });
    const summary = member.memo({
      subject: member.subject('summary:acme/widget:2026-Q1'),
      label: 'contributor summary',
      children: { activity, assess: assessor },
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

  const report = fold({
    subject: 'report:acme/widget:2026-Q1',
    label: 'contribution report',
    over: { template: contributor, step: 'summary' },
    run: ({ members, inputs, helpers }) => helpers.render(members, inputs.config),
  });

  const status = outcomeFold({
    subject: 'status:acme/widget:2026-Q1',
    label: 'contributor status',
    over: { template: contributor, step: 'summary' },
    run: ({ members, inputs, helpers }) => helpers.renderStatus(members, inputs.config),
  });

  const rubricSteps = {
    A: suppliedStep<IAssessorParameters, IAssessment>({ label: 'rubric A', run: ({ args, helpers }) => helpers.assessRubricA(args[0], args[1]) }),
    B: suppliedStep<IAssessorParameters, IAssessment>({ label: 'rubric B', run: ({ args, helpers }) => helpers.assessRubricB(args[0], args[1]) }),
    C: suppliedStep<IAssessorParameters, IAssessment>({ label: 'rubric C', run: ({ args, helpers }) => helpers.assessRubricC(args[0], args[1]) }),
    P: suppliedStep<IAssessorParameters, IAssessment>({ label: 'rubric P (paid-like)', run: ({ args, helpers }) => helpers.assessRubricP(args[0], args[1]) }),
  };

  const composition = compose({
    scope: analysisScope,
    inputs: [{ slot: 'config', value: { ...baseConfig, minimumAuthored: variation.minimumAuthored } }],
    helpers: ordered([
      { slot: 'discover', helper: discover },
      { slot: 'isDiscoveryFinal', helper: isDiscoveryFinal },
      { slot: 'checkActivity', helper: checkActivity },
      { slot: 'isFinal', helper: isFinal },
      { slot: 'assessRubricA', helper: assessRubricA },
      { slot: 'assessRubricB', helper: assessRubricB },
      { slot: 'assessRubricC', helper: assessRubricC },
      { slot: 'assessRubricP', helper: assessRubricP },
      { slot: 'summarize', helper: summarize },
      { slot: 'format', helper: format },
      { slot: 'render', helper: render },
      { slot: 'renderStatus', helper: renderStatus },
    ], variation),
    steps: ordered([{ slot: collectionSlot, declaration: contributors }, { slot: 'report', declaration: report }, { slot: 'status', declaration: status }], variation),
    templates: [contributor],
    supplied: [supply({ slot: assessor, declaration: rubricSteps[variation.rubric], subject: assessmentSubject })],
  });

  return {
    authoring: builders,
    composition,
    report: Object.freeze({ scope: analysisScope, role: 'step', slot: 'report' }),
    status: Object.freeze({ scope: analysisScope, role: 'step', slot: 'status' }),
    discovery: Object.freeze({ scope: analysisScope, role: 'step', slot: collectionSlot }),
    summary: (memberKey) => Object.freeze({ scope: analysisScope, role: 'step', slot: 'summary', template: templateSlot, collection: collectionSlot, memberKey }),
  };
}
