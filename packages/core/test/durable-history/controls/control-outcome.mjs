/**
 * Fail-closed judgment for the facade's mutation controls (History's durable
 * authority and Reuse Resolution). A Jest run counts as
 * evidence only when its exit status agrees with its assertion results,
 * exactly the intended suite files ran without runtime errors, every expected
 * test title appears exactly once, and every assertion either passed or
 * failed. Pending, skipped, missing, duplicated or foreign results, an
 * unparseable report and abnormal exits are never success.
 */

/** The durable History suite files every History control run must execute. */
export const intendedSuites = Object.freeze(['durable-history.test.js', 'crash-recovery.test.js']);

/**
 * Judge one run. `exitStatus` is the child's exit code (null when killed);
 * `reportText` is Jest's `--json` output file content, or undefined when none
 * was written; `expectedTitles` is the complete baseline title set, or
 * undefined for the baseline run itself; `suites` is the exact suite file set
 * the run must execute (History's by default). Returns the failing titles, or
 * throws with a diagnostic when the run is not trustworthy evidence.
 */
export function judgeRun({ exitStatus, reportText, expectedTitles, suites: requiredSuites = intendedSuites }) {
  if (exitStatus !== 0 && exitStatus !== 1) {
    throw new Error(`abnormal Jest exit ${String(exitStatus)}`);
  }
  if (typeof reportText !== 'string') {
    throw new Error('Jest wrote no report');
  }
  let report;
  try {
    report = JSON.parse(reportText);
  } catch {
    throw new Error('Jest report is not JSON');
  }
  if (!Array.isArray(report?.testResults) || report.numRuntimeErrorTestSuites !== 0) {
    throw new Error('a suite failed to run');
  }
  const suites = report.testResults.map((suite) => String(suite.name).split(/[\\/]/u).at(-1)).sort();
  if (JSON.stringify(suites) !== JSON.stringify([...requiredSuites].sort())) {
    throw new Error(`unexpected suites ran: ${suites.join(', ')}`);
  }
  const assertions = report.testResults.flatMap((suite) => {
    if (!Array.isArray(suite.assertionResults) || suite.assertionResults.length === 0 || (suite.status === 'failed' && suite.assertionResults.every((a) => a.status === 'passed'))) {
      throw new Error(`suite ${String(suite.name)} has no trustworthy assertions`);
    }
    return suite.assertionResults;
  });
  const titles = assertions.map((assertion) => assertion.fullName);
  if (new Set(titles).size !== titles.length) {
    throw new Error('a test title appears more than once');
  }
  for (const assertion of assertions) {
    if (assertion.status !== 'passed' && assertion.status !== 'failed') {
      throw new Error(`test "${assertion.fullName}" was ${String(assertion.status)}`);
    }
  }
  if (expectedTitles !== undefined) {
    const missing = [...expectedTitles].filter((title) => !titles.includes(title));
    const foreign = titles.filter((title) => !expectedTitles.has(title));
    if (missing.length > 0 || foreign.length > 0) {
      throw new Error(`test titles differ from the baseline: missing [${missing.join('; ')}], unexpected [${foreign.join('; ')}]`);
    }
  }
  const failed = assertions.filter((assertion) => assertion.status === 'failed').map((assertion) => assertion.fullName);
  if ((exitStatus === 0) !== (failed.length === 0)) {
    throw new Error(`Jest exit ${String(exitStatus)} disagrees with ${String(failed.length)} failing tests`);
  }
  return { titles: new Set(titles), failed };
}
