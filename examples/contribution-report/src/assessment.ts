/**
 * The assessor implementations the composition can supply to the summary's
 * `assessor` step slot. Each rubric assesses one authored pull request: the PR
 * number arrives as a derived argument and the PR record as a view forwarded
 * from the member's activity. Scores are a fixture rubric, not a measure of
 * contribution quality.
 *
 * - Rubric A scores a merged PR 2 and an unmerged PR 1, and explains why.
 * - Rubric B scores exactly as A; only its explanation text differs.
 * - Rubric C scores as A, except that a merged PR labelled `bug` scores 3.
 *
 * The summary consumes an assessment's `score` and never its explanation, so
 * switching A to B reruns assessments only, while C changes the score of any
 * merged bug fix and reruns exactly the summaries that consumed one.
 */
import type { IResultView } from 'microdelta';

import type { IPullRequest } from './activity.js';

/** Which assessor implementation the composition supplies. */
export type IRubric = 'A' | 'B' | 'C';

/** Every rubric, in display order. */
export const rubrics: readonly IRubric[] = ['A', 'B', 'C'];

/** One PR's assessment. The summary reads only `score`. */
export interface IAssessment {
  readonly score: number;
  readonly explanation: string;
}

/** The assessor slot's call signature: the PR number (derived) and the PR record (forwarded). */
export type IAssessorParameters = readonly [number, IPullRequest];

/**
 * Rubric A. Each rubric is self-contained: a declared helper's tracked
 * implementation is its own function, so rubrics share no scoring code.
 */
export function assessRubricA(number: number, pullRequest: IResultView<IPullRequest>): IAssessment {
  const score = pullRequest.merged ? 2 : 1;
  const state = pullRequest.merged ? 'was merged' : 'is not merged';
  return { score, explanation: `PR ${String(number)} ${state}, so rubric A scores it ${String(score)}.` };
}

/** Rubric B: rubric A's scores with reworded explanations. */
export function assessRubricB(number: number, pullRequest: IResultView<IPullRequest>): IAssessment {
  const score = pullRequest.merged ? 2 : 1;
  const state = pullRequest.merged ? 'Merged' : 'Unmerged';
  return { score, explanation: `${state} pull request ${String(number)} earns ${String(score)} under rubric B.` };
}

/** Rubric C: rubric A, except that a merged PR labelled `bug` scores 3. */
export function assessRubricC(number: number, pullRequest: IResultView<IPullRequest>): IAssessment {
  let bugFix = false;
  if (pullRequest.merged) {
    const labels = pullRequest.labels;
    for (let index = 0; index < labels.length; index += 1) {
      if (labels[index] === 'bug') {
        bugFix = true;
      }
    }
  }
  const score = bugFix ? 3 : pullRequest.merged ? 2 : 1;
  return { score, explanation: `PR ${String(number)} ${bugFix ? 'is a merged bug fix' : pullRequest.merged ? 'was merged' : 'is not merged'}, so rubric C scores it ${String(score)}.` };
}
