/**
 * The contribution analysis, authored against the facade's alpha workspace
 * surface. Two explicitly selected contributors (`person:ada`, `person:ben`)
 * each declare a retained activity source and a memoized summary whose only
 * child is that contributor's activity; the fixed relationships exist before
 * any run. Subjects are complete opaque author strings; the framework never
 * derives them from names. Callbacks use only their typed context: tracked
 * inputs and helpers, a source's `previous` and `outcome`, and a memo's
 * declared `calls`.
 */
import { authoring } from 'microdelta';
import type { IAuthoring, IComposition, IPreviousResult, IResultView, ISourceOutcome, ISourceOutcomes, IStepDescriptor, ITrackedView } from 'microdelta';

import { checkActivity, isFinal } from './activity.js';
import type { IActivity, IConfig } from './activity.js';

/** The analysis scope: one repository and quarter. */
export const analysisScope = 'contribution-report:acme/widget:2026-Q1';

/** The explicitly selected contributors, in their stable display order. */
export const contributorKeys = ['person:ada', 'person:ben'] as const;

/** One selected contributor key. */
export type IContributorKey = (typeof contributorKeys)[number];

/** The declared configuration: repository identity and reporting window. */
export const config: IConfig = { repository: 'acme/widget', window: { start: '2026-01-01', end: '2026-04-01' } };

/** A contributor summary: statistics and the sentence the template builds from them. */
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

/** The deterministic sentence template. */
export type IFormat = (name: string, authored: number, merged: number, reviews: number) => string;

/** The declared helper record. Helpers take domain values only, never run context. */
export interface IHelpers {
  readonly checkActivity: (outcome: ISourceOutcomes, config: ITrackedView<IConfig>, key: string) => ISourceOutcome<IActivity>;
  readonly isFinal: (previous: IPreviousResult<IActivity>) => boolean;
  readonly summarize: (activity: IResultView<IActivity>, format: ITrackedView<IFormat>) => ISummary;
  readonly format: IFormat;
}

/**
 * Count one contributor's statistics with indexed loops over the exact
 * retained activity and render the sentence. Reads the profile name, each
 * PR's merged status and the number of PRs and reviews; never labels, avatar,
 * profile identity or revision, so changes to those alone keep the summary.
 */
function summarize(activity: IResultView<IActivity>, format: ITrackedView<IFormat>): ISummary {
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

/** The template string with deterministic singular/plural handling. */
function format(name: string, authored: number, merged: number, reviews: number): string {
  const pulls = authored === 1 ? '1 pull request' : `${String(authored)} pull requests`;
  const mergedText = merged === 1 ? '1 of which was merged' : `${String(merged)} of which were merged`;
  const reviewText = reviews === 1 ? '1 review' : `${String(reviews)} reviews`;
  return `${name} authored ${pulls}, ${mergedText}, and submitted ${reviewText}.`;
}

/** The composed analysis: builders, frozen composition and step addresses. */
export interface IAnalysis {
  readonly authoring: IAuthoring<IInputs, IHelpers>;
  readonly composition: IComposition<IInputs, IHelpers>;
  readonly summaries: Readonly<Record<IContributorKey, IStepDescriptor>>;
}

/**
 * Declare and compose the analysis. Each contributor's declarations are
 * written out with literal keys: a callback that captured a loop variable
 * would carry an untracked closure value. `order` only changes registration
 * order; explicit member keys, not order, identify each contributor's steps.
 */
export function composeAnalysis(order: readonly IContributorKey[] = contributorKeys): IAnalysis {
  const builders = authoring<IInputs, IHelpers>();
  const { source, memo, compose } = builders;
  const adaActivity = source<IActivity>({
    subject: 'activity:acme/widget:2026-Q1:person:ada',
    label: 'Ada activity',
    finality: ({ previous, helpers }) => helpers.isFinal(previous),
    run: ({ inputs, helpers, outcome }) => helpers.checkActivity(outcome, inputs.config, 'person:ada'),
  });
  const adaSummary = memo({
    subject: 'summary:acme/widget:2026-Q1:person:ada',
    label: 'Ada summary',
    children: { activity: adaActivity },
    run: async ({ helpers, calls }) => {
      const { data } = await calls.activity();
      return helpers.summarize(data, helpers.format);
    },
  });
  const benActivity = source<IActivity>({
    subject: 'activity:acme/widget:2026-Q1:person:ben',
    label: 'Ben activity',
    finality: ({ previous, helpers }) => helpers.isFinal(previous),
    run: ({ inputs, helpers, outcome }) => helpers.checkActivity(outcome, inputs.config, 'person:ben'),
  });
  const benSummary = memo({
    subject: 'summary:acme/widget:2026-Q1:person:ben',
    label: 'Ben summary',
    children: { activity: benActivity },
    run: async ({ helpers, calls }) => {
      const { data } = await calls.activity();
      return helpers.summarize(data, helpers.format);
    },
  });
  const registrations = {
    'person:ada': { key: 'person:ada', steps: [{ slot: 'activity', declaration: adaActivity }, { slot: 'summary', declaration: adaSummary }] },
    'person:ben': { key: 'person:ben', steps: [{ slot: 'activity', declaration: benActivity }, { slot: 'summary', declaration: benSummary }] },
  };
  const composition = compose({
    scope: analysisScope,
    inputs: [{ slot: 'config', value: config }],
    helpers: [
      { slot: 'checkActivity', helper: checkActivity },
      { slot: 'isFinal', helper: isFinal },
      { slot: 'summarize', helper: summarize },
      { slot: 'format', helper: format },
    ],
    members: order.map((key) => registrations[key]),
  });
  const step = (key: IContributorKey): IStepDescriptor => ({ scope: analysisScope, role: 'step', slot: 'summary', memberKey: key });
  return { authoring: builders, composition, summaries: { 'person:ada': step('person:ada'), 'person:ben': step('person:ben') } };
}
