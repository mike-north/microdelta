/**
 * Shared fixtures and assertions of the M5 acceptance suites: the base world,
 * the scenario lifecycle, and compact views of what a process observed. Each
 * helper states one observable outcome in the plan's vocabulary; expected
 * values are written by hand in the suites, never derived from these helpers.
 *
 * @see ../../../../docs/plans/m5-operations.md (Planned evidence names)
 */
import { afterEach, jest } from '@jest/globals';

import type { IWorld, IWorldPullRequest } from './analysis.js';
import { scenario } from './harness.js';
import type { IProcessRun, IScenario } from './harness.js';

/** The planted secret every pull request title carries; it must never appear in framework output. */
export const plantedTitle = 'PLANTED-m5-title-c0ffee';

/** The History subject of one member's assessment step. */
export function assessmentSubject(key: string): string {
  return `assessment:${key}`;
}

/**
 * The base world: three pull requests, pr-1 and pr-3 merged (score 2) and
 * pr-2 not merged (score 1), no declarations and no script, so every request
 * is answered `ok` with 100 tokens.
 */
export function baseWorld(changes: Partial<IWorld> = {}): IWorld {
  const pullRequests: IWorldPullRequest[] = [
    { key: 'pr-1', merged: true, title: `${plantedTitle} add the widget cache` },
    { key: 'pr-2', merged: false, title: `${plantedTitle} draft the widget docs` },
    { key: 'pr-3', merged: true, title: `${plantedTitle} fix the widget race` },
  ];
  return { pullRequests, declarations: {}, script: {}, ...changes };
}

/** Scenarios the current test created; removed after it. */
const created: IScenario[] = [];

/** Create a scenario with the base world written, removed after the current test. */
export function freshScenario(world: IWorld = baseWorld()): IScenario {
  const made = scenario();
  created.push(made);
  made.writeWorld(world);
  return made;
}

/**
 * Remove every scenario the current test created, and give each test a
 * per-test timeout fit for several worker processes and real lease expiries
 * on a slow host. Call once at suite scope.
 */
export function removeScenarios(): void {
  jest.setTimeout(120_000);
  afterEach(() => {
    for (const made of created.splice(0)) {
      made.remove();
    }
  });
}

/** Each member's status in a process's result, by key. */
export function statuses(run: IProcessRun): Readonly<Record<string, string>> {
  return Object.fromEntries(Object.entries(run.result.members).map(([key, member]) => [key, member.status]));
}

/** The usage summary fields the suites assert, by hand: unknown attempts are counted, never zero. */
export interface IUsageView {
  readonly status: string;
  readonly observed: readonly { readonly unit: string; readonly amount: number }[];
  readonly unknown: number;
  readonly operations: number;
  readonly reports: number;
  readonly requestAttempts: number;
}

/** A usage summary as the facade or Accounting's adapter reports it, structurally. */
export interface IAnyUsageSummary {
  readonly status: string;
  readonly observed: readonly { readonly unit: string; readonly amount: number }[];
  readonly unknown: readonly unknown[];
  readonly operations: number;
  readonly reports: number;
  readonly requestAttempts: number;
}

/** The compact view of one usage summary. */
export function usageOf(summary: IAnyUsageSummary | null): IUsageView {
  if (summary === null) {
    throw new Error('the process reported no usage summary');
  }
  const { status, observed, unknown, operations, reports, requestAttempts } = summary;
  return { status, observed: observed.map(({ unit, amount }) => ({ unit, amount })), unknown: unknown.length, operations, reports, requestAttempts };
}

/** A process that must have finished cleanly: exit 0, no signal, nothing on stderr. */
export function clean(run: IProcessRun): IProcessRun {
  if (run.status !== 0 || run.signal !== null || run.stderr !== '') {
    throw new Error(`the process did not finish cleanly (${String(run.status)}/${String(run.signal)}): ${JSON.stringify(run.error)} ${run.stderr}`);
  }
  return run;
}

/** The operation identity of a member's most recent operation in a process's inspection, failing clearly when absent. */
export function operationOf(run: IProcessRun, key: string): string {
  const views = run.result.operations.filter((view) => view.member === key);
  const last = views.at(-1);
  if (last === undefined) {
    throw new Error(`no operation of ${key}: ${JSON.stringify(run.result.operations)}`);
  }
  return last.operation;
}
