/**
 * Text rendering of one strict report request for the command line. This is
 * presentation outside the framework: it formats the report fold's exact
 * result together with the framework's coverage, or explains why the strict
 * report did not run. Coverage always comes from the fold's typed outcome,
 * never from the report body, so the text never claims more than closed
 * discovery supports.
 */
import type { IFoldCoverage, IStrictFoldOutcome } from 'microdelta';

import type { IReport } from './analysis.js';

/** Render a completed report with its framework coverage. */
export function renderReport(report: IReport, coverage: IFoldCoverage): string {
  const header = `Contribution report for ${report.repository}, ${report.window.start} to ${report.window.end} (exclusive)`;
  const threshold = report.minimumAuthored === 1 ? '1 authored pull request' : `${String(report.minimumAuthored)} authored pull requests`;
  const scope = `Required: contributors with at least ${threshold} in the window`;
  const skipped = coverage.skipped.length === 0 ? '0 skipped' : `${String(coverage.skipped.length)} skipped (${coverage.skipped.join(', ')})`;
  return [
    header,
    scope,
    ...report.required.map((entry) => `- ${entry.key} (score ${String(entry.score)}): ${entry.sentence}`),
    ...report.excluded.map((key) => `- ${key}: excluded by the gate`),
    // A reused or published strict fold's coverage is always over closed discovery.
    `Coverage: ${String(coverage.required.length)} required, ${skipped}; discovery closed`,
  ].join('\n');
}

/** Explain a strict report that did not succeed: it neither ran its body nor published. */
export function renderUnfinished(outcome: Exclude<IStrictFoldOutcome, { readonly status: 'succeeded' }>): string {
  switch (outcome.status) {
    case 'waiting': {
      const discovery = outcome.openDiscovery ? 'discovery is still open' : 'discovery is closed';
      const pending = outcome.pending.length === 0 ? 'no member is pending' : `pending members: ${outcome.pending.join(', ')}`;
      return `Report waiting: ${discovery}; ${pending}`;
    }
    case 'failed':
      return `Report failed: ${outcome.diagnostic}`;
    case 'pending':
    case 'cancelled':
      return `Report ${outcome.status}: ${outcome.reason}`;
    default: {
      const exhaustive: never = outcome;
      return exhaustive;
    }
  }
}
