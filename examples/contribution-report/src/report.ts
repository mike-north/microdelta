/**
 * Text rendering of one strict report or status report request for the
 * command line. This is presentation outside the framework: it formats a
 * fold's exact result together with the framework's coverage, or explains why
 * the fold did not run. Coverage always comes from the fold's typed outcome,
 * never from the fold body, so the text never claims more than the settled
 * population supports.
 */
import type { ICompleteOutcomeFoldCoverage, IFoldCoverage, IOutcomeFoldCoverage, IOutcomeFoldRunOutcome, IStrictFoldOutcome } from 'microdelta';

import type { IReport, IStatusReport } from './analysis.js';

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

/** Render a folded status report with its framework coverage. */
export function renderStatus(report: IStatusReport, coverage: ICompleteOutcomeFoldCoverage): string {
  const header = `Contributor status for ${report.repository}, ${report.window.start} to ${report.window.end} (exclusive)`;
  const line = (entry: IStatusReport['entries'][number]): string => {
    switch (entry.status) {
      case 'succeeded':
        return `- ${entry.key}: succeeded (score ${String(entry.score)})`;
      case 'skipped':
        return `- ${entry.key}: skipped by the gate`;
      case 'failed':
      case 'cancelled':
        return `- ${entry.key}: ${entry.status}`;
      default: {
        const exhaustive: never = entry.status;
        return exhaustive;
      }
    }
  };
  // A folded outcome fold's coverage is always complete: closed discovery and nothing pending.
  return [header, ...report.entries.map(line), `Coverage: ${settledCounts(coverage)}; discovery closed`].join('\n');
}

/** The settled counts of an outcome fold's coverage. */
function settledCounts(coverage: IOutcomeFoldCoverage): string {
  return `${String(coverage.succeeded.length)} succeeded, ${String(coverage.skipped.length)} skipped, ${String(coverage.failed.length)} failed, ${String(coverage.cancelled.length)} cancelled`;
}

/**
 * Explain a status report that did not fold: it waits while discovery is
 * open or a member is unsettled, claiming no completeness, or it failed or
 * was refused. None of these ran its body.
 */
export function renderStatusUnfinished(outcome: Exclude<IOutcomeFoldRunOutcome, { readonly status: 'folded' }>): string {
  switch (outcome.status) {
    case 'waiting': {
      const { coverage } = outcome;
      const pending = coverage.pending.length === 0 ? 'no member is pending' : `pending ${coverage.pending.join(', ')}`;
      return [
        `Contributor status waiting: ${pending}`,
        `Coverage so far: ${settledCounts(coverage)}, ${String(coverage.pending.length)} pending; discovery ${coverage.openDiscovery ? 'open' : 'closed'}`,
      ].join('\n');
    }
    case 'failed':
      return `Contributor status failed: ${outcome.diagnostic}`;
    case 'pending':
    case 'cancelled':
      return `Contributor status ${outcome.status}: ${outcome.reason}`;
    default: {
      const exhaustive: never = outcome;
      return exhaustive;
    }
  }
}
