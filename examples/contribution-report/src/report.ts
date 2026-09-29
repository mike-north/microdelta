/**
 * Ordinary (nonmemoized) report assembly. It runs on every run, reads each
 * summary's small exact result and orders contributors by their stable keys,
 * whatever order the summaries were resolved in. It has no completed-result
 * identity and no hidden memoization. The report names the selected scope; it
 * does not claim complete repository coverage.
 */
import type { IResolutionOutcome, IWorkspaceRun } from 'microdelta';

import { config, contributorKeys } from './analysis.js';
import type { IContributorKey, ISummary } from './analysis.js';

/** The assembled repository report. */
export interface IReport {
  readonly repository: string;
  readonly window: { readonly start: string; readonly end: string };
  /** The explicitly selected contributors; not a discovered complete population. */
  readonly selected: readonly IContributorKey[];
  readonly contributors: readonly (ISummary & { readonly key: IContributorKey })[];
}

/** Assemble the report from the summaries' exact results, ordered by stable key. */
export function assembleReport(run: IWorkspaceRun, outcomes: Readonly<Record<IContributorKey, IResolutionOutcome>>): IReport {
  const selected = [...contributorKeys].sort();
  const contributors = selected.map((key) => {
    const outcome = outcomes[key];
    if (outcome.kind === 'refused') {
      throw new Error(`the summary of ${key} was refused: ${outcome.reason}`);
    }
    if (outcome.kind === 'skipped') {
      throw new Error(`the summary of ${key} was skipped by a gate`);
    }
    return { key, ...run.read<ISummary>(outcome.reference) };
  });
  return { repository: config.repository, window: config.window, selected, contributors };
}

/** Render the report as text. */
export function renderReport(report: IReport): string {
  const header = `Contribution report for ${report.repository}, ${report.window.start} to ${report.window.end} (exclusive)`;
  const scope = `Selected contributors: ${report.selected.join(', ')} (not complete repository coverage)`;
  return [header, scope, ...report.contributors.map((entry) => `- ${entry.key}: ${entry.sentence}`)].join('\n');
}
