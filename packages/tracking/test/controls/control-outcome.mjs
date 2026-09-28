/**
 * Judgment of one Jest run of the lazy-view suite for the discrimination
 * controls. Kept pure (process result in, verdict out) so its fail-closed rules
 * are tested directly in `control-outcome.test.mjs`.
 *
 * A run is valid evidence only when the process exited normally with Jest's
 * own status (0 when everything passed, 1 when assertions failed), produced a
 * parseable report for exactly the intended suite file with no runtime suite
 * error, contained every intended test title exactly once, and every assertion
 * either passed or failed. Pending, skipped, todo or otherwise unexecuted
 * assertions make the run invalid rather than counting as rejections.
 */

/** Outcome statuses that mean an assertion actually executed. */
const executed = new Set(['passed', 'failed']);

/**
 * Validate a process result as an execution of the intended suite. Returns
 * the per-title statuses, or the reason the run cannot be used as evidence.
 */
function readRun(run, suite) {
  if (run.signal !== null || (run.status !== 0 && run.status !== 1)) {
    return { valid: false, reason: `abnormal Jest exit (status ${String(run.status)}, signal ${String(run.signal)})` };
  }
  let report;
  try {
    report = JSON.parse(run.stdout);
  } catch {
    return { valid: false, reason: 'Jest produced no parseable JSON report' };
  }
  const files = Array.isArray(report?.testResults) ? report.testResults : [];
  if (files.length !== 1 || typeof files[0].name !== 'string' || !files[0].name.replaceAll('\\', '/').endsWith(`/${suite.path}`)) {
    return { valid: false, reason: `report does not describe exactly the intended suite ${suite.path}` };
  }
  if (report.numRuntimeErrorTestSuites !== 0 || !Array.isArray(files[0].assertionResults)) {
    return { valid: false, reason: 'the intended suite failed to run' };
  }
  const statuses = new Map();
  for (const assertion of files[0].assertionResults) {
    if (!executed.has(assertion.status)) {
      return { valid: false, reason: `assertion "${String(assertion.title)}" did not execute (${String(assertion.status)})` };
    }
    if (statuses.has(assertion.title)) {
      return { valid: false, reason: `assertion "${String(assertion.title)}" is not uniquely named` };
    }
    statuses.set(assertion.title, assertion.status);
  }
  const missing = suite.titles.filter((title) => !statuses.has(title));
  if (missing.length > 0) {
    return { valid: false, reason: `intended suite is incomplete; missing ${missing.join(' | ')}` };
  }
  const anyFailed = [...statuses.values()].includes('failed');
  if (anyFailed !== (run.status === 1)) {
    return { valid: false, reason: `Jest exit status ${String(run.status)} disagrees with its assertion results` };
  }
  return { valid: true, statuses };
}

/** Titles of executed assertions that failed. */
function failedTitles(statuses) {
  return [...statuses].filter(([, status]) => status === 'failed').map(([title]) => title);
}

/**
 * Whether a run with a deliberately wrong implementation rejects it through
 * every named assertion. Only an actual failure in a valid run counts.
 */
export function rejectsControl(run, suite, mustFail) {
  const read = readRun(run, suite);
  if (!read.valid) {
    return { rejected: false, reason: read.reason, failed: [] };
  }
  const failed = failedTitles(read.statuses);
  const survived = mustFail.filter((title) => read.statuses.get(title) !== 'failed');
  return survived.length === 0
    ? { rejected: true, failed }
    : { rejected: false, reason: `not rejected by ${survived.join(' | ')}`, failed };
}

/** Whether a run with the intended implementation executed the complete suite and passed it. */
export function restoredPasses(run, suite) {
  const read = readRun(run, suite);
  if (!read.valid) {
    return { passed: false, reason: read.reason };
  }
  const failed = failedTitles(read.statuses);
  return run.status === 0 && failed.length === 0
    ? { passed: true }
    : { passed: false, reason: `failing ${failed.join(' | ')}` };
}
