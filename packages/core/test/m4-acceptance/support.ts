/**
 * Shared assertions of the M4 acceptance suites. Each states one observable
 * outcome of an independent process in the plan's vocabulary: which author
 * bodies ran, and which members kept the exact references an earlier process
 * published.
 *
 * @see ../../../../docs/plans/m4-composition.md (Planned evidence names)
 */
import { afterEach, expect } from '@jest/globals';

import { scenario } from './harness.js';
import type { IProcessRun, IScenario } from './harness.js';

/**
 * A fresh scenario per call, removed after the test that created it.
 * Register once per suite file with {@link removeScenarios}.
 */
const created: IScenario[] = [];

/** Create a scenario that is removed after the current test. */
export function freshScenario(): IScenario {
  const made = scenario();
  created.push(made);
  return made;
}

/** Remove every scenario the current test created. Call once at suite scope. */
export function removeScenarios(): void {
  afterEach(() => {
    for (const made of created.splice(0)) {
      made.remove();
    }
  });
}

/** An assessor trace entry: the PR number and the rubric implementation that assessed it. */
export function assessed(rubric: 'A' | 'B' | 'C', numbers: readonly string[]): string[] {
  return numbers.map((number) => `${number}/${rubric}`);
}

/** The body traces of one helper, sorted, so a process's member order never matters to a count. */
export function sortedBodies(run: IProcessRun, helper: 'activity' | 'assess' | 'summary'): string[] {
  return [...run.bodies(helper)].sort();
}

/** No member body ran in a process: no activity check, assessment or summary. */
export function expectNoMemberBodies(run: IProcessRun): void {
  expect(run.bodies('activity')).toEqual([]);
  expect(run.bodies('assess')).toEqual([]);
  expect(run.bodies('summary')).toEqual([]);
}

/** No member body and no report body ran in a process. */
export function expectNoMemberOrReportBodies(run: IProcessRun): void {
  expectNoMemberBodies(run);
  expect(run.bodies('report')).toEqual([]);
}

/**
 * Every listed member was reused with the exact reference `earlier` settled
 * for it, with no candidate miss, and its acceptance followed current results.
 */
export function expectRetained(run: IProcessRun, earlier: IProcessRun, keys: readonly string[]): void {
  for (const key of keys) {
    expect(run.member(key)).toEqual({ status: 'succeeded', kind: 'reused', reference: earlier.reference(key), misses: [], accepted: expect.any(Array) });
  }
}

/** The fold ran no body, admitted no work and published nothing in this process. */
export function expectNoFoldWork(run: IProcessRun): void {
  expect(run.bodies('report')).toEqual([]);
  expect(run.admissions.filter((admission) => admission.endsWith(':report:acme/widget:2026-Q1'))).toEqual([]);
  expect(run.phases('report', null)).toEqual([]);
  expect(run.result.report).toBeNull();
}
