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
 * - Rubric P is the paid-like assessor: each assessment is one declared
 *   external operation sent to the example's fake provider
 *   (`provider.ts`), which scores as rubric A does. The framework persists
 *   the operation's identity before the send, counts its usage once, and
 *   owns retry, deferral, stop and the outcome of a lost response; the
 *   assessment step isolates the paid call, so a completed assessment is
 *   reused rather than paid for again.
 *
 * The summary consumes an assessment's `score` and never its explanation, so
 * switching A to B reruns assessments only, while C changes the score of any
 * merged bug fix and reruns exactly the summaries that consumed one.
 */
import { createHash } from 'node:crypto';

import { currentExecution } from 'microdelta';
import type { IResultView } from 'microdelta';

import type { IPullRequest } from './activity.js';
import type { IPaidAssessment, IPaidAssessor } from './provider.js';

/** Which assessor implementation the composition supplies. */
export type IRubric = 'A' | 'B' | 'C' | 'P';

/** Every rubric, in display order. */
export const rubrics: readonly IRubric[] = ['A', 'B', 'C', 'P'];

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

/**
 * The paid-like provider this process sends assessments to. It is external
 * service state, like the fixture file: selected once per process by the
 * command line, never an analysis input.
 */
let paidProvider: IPaidAssessor | undefined;

/** Select the paid-like provider for the rest of this process. */
export function usePaidAssessor(provider: IPaidAssessor): void {
  paidProvider = provider;
}

/**
 * Rubric P: one paid-like assessment of a PR, made as a declared external
 * operation through the live run's execution controls. Its binding is a
 * digest of the request it sends (the PR number and merged flag), never the
 * request itself, so a changed request is a new operation while a retry of
 * the same request keeps its identity. The operation is not declared safe to
 * repeat: a lost response stays unknown until an operator settles it.
 */
export async function assessRubricP(number: number, pullRequest: IResultView<IPullRequest>): Promise<IAssessment> {
  const provider = paidProvider;
  if (provider === undefined) {
    throw new Error('no paid-like assessor is selected for this process');
  }
  const merged = pullRequest.merged;
  const binding = `sha256:${createHash('sha256').update(JSON.stringify({ number, merged })).digest('hex')}`;
  const assessed: IPaidAssessment = await currentExecution().operation<IPaidAssessment>({
    name: 'assess',
    binding,
    perform: (send) => provider.assess(number, merged, send),
  });
  return { score: assessed.score, explanation: assessed.explanation };
}
