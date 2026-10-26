/**
 * Deterministic assessor choices for the completed-search boundary probe.
 * Each score reads merged status from one exact separately retrieved detail.
 */
import type { IResultView } from 'microdelta';

import type { IPullRequest } from './activity.js';

/** One assessment; summary consumes its score only. */
export interface IAssessment {
  readonly score: number;
  readonly explanation: string;
}

/** The supplied assessor's ID and forwarded-detail arguments. */
export type IAssessorParameters = readonly [number, IPullRequest];

/** Names the exact assessors selected by the composed consumer. */
export type IRubric = 'A' | 'B' | 'C' | 'P';

/** Rubric A scores merged work two and open work one. */
export function assessRubricA(number: number, detail: IResultView<IPullRequest>): IAssessment {
  const score = detail.merged ? 2 : 1;
  return { score, explanation: `PR ${String(number)} scores ${String(score)}.` };
}

/** Rubric B has equal scores with a distinct explanation, exercising slot replacement. */
export function assessRubricB(number: number, detail: IResultView<IPullRequest>): IAssessment {
  const score = detail.merged ? 2 : 1;
  return { score, explanation: `Alternative score for PR ${String(number)}: ${String(score)}.` };
}

/** Rubric C gives merged bug fixes one additional point. */
export function assessRubricC(number: number, detail: IResultView<IPullRequest>): IAssessment {
  let bugFix = false;
  if (detail.merged) {
    for (let index = 0; index < detail.labels.length; index += 1) {
      if (detail.labels[index] === 'bug') {
        bugFix = true;
      }
    }
  }
  const score = bugFix ? 3 : detail.merged ? 2 : 1;
  return { score, explanation: `Rubric C scores PR ${String(number)} ${String(score)}.` };
}

/** Rubric P remains deterministic in this no-provider diagnostic consumer. */
export function assessRubricP(number: number, detail: IResultView<IPullRequest>): IAssessment {
  return assessRubricA(number, detail);
}
