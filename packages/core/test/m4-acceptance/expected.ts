/**
 * Independently specified expectations for the M4 acceptance world, derived
 * by hand from the M4 plan's concrete fixture decisions, the contribution
 * example's attribution rules and the rubric definitions in `analysis.ts`,
 * never from program output.
 *
 * Window `[2026-01-01, 2026-04-01)`. A contributor is discovered when they
 * authored a PR created in the window or submitted a non-pending review in it.
 *
 * - Ada authored 101 (merged, `feature`), 102 (merged, `docs`) and 103 (open);
 *   98 predates the window. Reviews rv-ada-1..5 are in the window; rv-ada-0
 *   predates it and rv-ada-6 is pending. Authored 3, merged 2, reviews 5.
 * - Ben authored 201 (merged, `bug`) and 202 (open); 204 is created exactly
 *   at the exclusive end. Reviews rv-ben-1..3; rv-ben-4 follows the window.
 *   Authored 2, merged 1, reviews 3.
 * - Cy authored 301 (merged, no label) and submitted rv-cy-1. Authored 1,
 *   merged 1, reviews 1.
 * - Dot is not discovered: PR 99 predates the window, rv-dot-1 is pending and
 *   rv-dot-2 follows it. The insertion case adds Dot's PR 401 (open, created
 *   2026-02-20): authored 1, merged 0, reviews 0.
 *
 * Rubric A (and B, which scores identically) scores a merged PR 2, a merged
 * `bug` PR `mergedBugScore` (default 2) and an open PR 1: Ada 2 + 2 + 1 = 5,
 * Ben 2 + 1 = 3, Cy 2, Dot 1. With `mergedBugScore` 3 only Ben's 201 changes:
 * Ben 3 + 1 = 4. Rubric C scores an open PR 0: Ada 2 + 2 + 0 = 4, Ben
 * 2 + 0 = 2, Cy 2.
 *
 * @see ../../../../docs/plans/m4-composition.md (Concrete fixture decisions)
 * @see ../../../../examples/contribution-report/README.md (Attribution rules)
 */
import type { IReport, ISummary } from './analysis.js';

/** Designated member keys of the base population, in canonical key order. */
export const designatedKeys = ['person:ada', 'person:ben', 'person:cy'] as const;

/** Custom (upstream profile id) member keys of the base population, in canonical key order. */
export const customKeys = ['gh:1001', 'gh:2002', 'gh:3003'] as const;

/** The PRs each base member's summary assesses, one assessor call each, in call order. */
export const assessedBy = { 'person:ada': ['101', '102', '103'], 'person:ben': ['201', '202'], 'person:cy': ['301'] } as const;

/** Every assessed PR of the base population, sorted as strings. */
export const allAssessed = ['101', '102', '103', '201', '202', '301'] as const;

/** Ada's summary under rubric A. */
export const ada: ISummary = Object.freeze({ name: 'Ada', authored: 3, merged: 2, reviews: 5, score: 5, sentence: 'Ada authored 3 pull requests, 2 of which were merged, and submitted 5 reviews.' });

/** Ben's summary under rubric A (singular "was merged"). */
export const ben: ISummary = Object.freeze({ name: 'Ben', authored: 2, merged: 1, reviews: 3, score: 3, sentence: 'Ben authored 2 pull requests, 1 of which was merged, and submitted 3 reviews.' });

/** Cy's summary under rubric A (every noun singular). */
export const cy: ISummary = Object.freeze({ name: 'Cy', authored: 1, merged: 1, reviews: 1, score: 2, sentence: 'Cy authored 1 pull request, 1 of which was merged, and submitted 1 review.' });

/** Dot's summary once PR 401 exists, under rubric A. */
export const dot: ISummary = Object.freeze({ name: 'Dot', authored: 1, merged: 0, reviews: 0, score: 1, sentence: 'Dot authored 1 pull request, 0 of which were merged, and submitted 0 reviews.' });

/** The report's scope fields. */
const scope = { repository: 'acme/widget', window: { start: '2026-01-01', end: '2026-04-01' } } as const;

/** One required report entry. */
function entry(key: string, summary: ISummary, score: number = summary.score): { readonly key: string; readonly score: number; readonly sentence: string } {
  return { key, score, sentence: summary.sentence };
}

/** The report at threshold 1 under rubric A, keyed by designated identity. */
export const reportAt1: IReport = {
  ...scope,
  minimumAuthored: 1,
  required: [entry('person:ada', ada), entry('person:ben', ben), entry('person:cy', cy)],
  excluded: [],
};

/** The report at threshold 2: Cy (one authored PR) is excluded by the gate. */
export const reportAt2: IReport = {
  ...scope,
  minimumAuthored: 2,
  required: [entry('person:ada', ada), entry('person:ben', ben)],
  excluded: ['person:cy'],
};

/** Build a report entry with an explicit key and score, for variants of the base population. */
export { entry };

/** The report's scope fields, for variants of the base population. */
export { scope };

/** The history subject of one PR's assessment. */
export function assessmentSubject(number: string): string {
  return `assessment:acme/widget:${number}`;
}

/** The history subject of one member's summary. */
export function summarySubject(key: string): string {
  return `summary:acme/widget:2026-Q1:${key}`;
}

/** The history subject of the strict report. */
export const reportSubject = 'report:acme/widget:2026-Q1';
