/**
 * Specifies the false-success cases the History mutation-control judgment must
 * reject. These run in the facade's `npm test`; the controls themselves are an
 * on-demand command because each one reruns the full durable suites.
 */
import assert from 'node:assert/strict';
import { test } from 'node:test';

import { intendedSuites, judgeRun } from './control-outcome.mjs';

/** A well-formed report with the given per-suite assertion statuses. */
function report(statusesBySuite, extra = {}) {
  return JSON.stringify({
    numRuntimeErrorTestSuites: 0,
    testResults: Object.entries(statusesBySuite).map(([suite, statuses]) => ({
      name: `/x/.test-build/test/durable-history/${suite}`,
      status: statuses.includes('failed') ? 'failed' : 'passed',
      assertionResults: statuses.map((status, index) => ({ fullName: `${suite} ${String(index)}`, status })),
    })),
    ...extra,
  });
}

const healthy = { [intendedSuites[0]]: ['passed', 'passed'], [intendedSuites[1]]: ['passed'] };
const baselineTitles = judgeRun({ exitStatus: 0, reportText: report(healthy) }).titles;

test('a complete passing run and a named rejection are accepted', () => {
  assert.deepEqual(judgeRun({ exitStatus: 0, reportText: report(healthy), expectedTitles: baselineTitles }).failed, []);
  const rejected = judgeRun({ exitStatus: 1, reportText: report({ ...healthy, [intendedSuites[1]]: ['failed'] }), expectedTitles: baselineTitles });
  assert.deepEqual(rejected.failed, [`${intendedSuites[1]} 0`]);
});

test('abnormal exits, missing or malformed reports and runtime suite errors are not evidence', () => {
  assert.throws(() => judgeRun({ exitStatus: null, reportText: report(healthy) }), /abnormal/u);
  assert.throws(() => judgeRun({ exitStatus: 2, reportText: report(healthy) }), /abnormal/u);
  assert.throws(() => judgeRun({ exitStatus: 0, reportText: undefined }), /no report/u);
  assert.throws(() => judgeRun({ exitStatus: 0, reportText: '{' }), /not JSON/u);
  assert.throws(() => judgeRun({ exitStatus: 1, reportText: report(healthy, { numRuntimeErrorTestSuites: 1 }) }), /failed to run/u);
});

test('a suite that loads no assertions, a missing or foreign suite, or a status disagreement is rejected', () => {
  assert.throws(() => judgeRun({ exitStatus: 1, reportText: report({ ...healthy, [intendedSuites[1]]: [] }) }), /no trustworthy/u);
  assert.throws(() => judgeRun({ exitStatus: 0, reportText: report({ [intendedSuites[0]]: ['passed'] }) }), /unexpected suites/u);
  assert.throws(() => judgeRun({ exitStatus: 0, reportText: report({ ...healthy, 'other.test.js': ['passed'] }) }), /unexpected suites/u);
  assert.throws(() => judgeRun({ exitStatus: 1, reportText: report(healthy) }), /disagrees/u);
  assert.throws(() => judgeRun({ exitStatus: 0, reportText: report({ ...healthy, [intendedSuites[1]]: ['failed'] }) }), /disagrees/u);
});

test('pending, skipped, missing or unexpected tests never count as a rejection or a clean restore', () => {
  assert.throws(() => judgeRun({ exitStatus: 0, reportText: report({ ...healthy, [intendedSuites[1]]: ['pending'] }), expectedTitles: baselineTitles }), /was pending/u);
  assert.throws(() => judgeRun({ exitStatus: 0, reportText: report({ ...healthy, [intendedSuites[0]]: ['passed'] }), expectedTitles: baselineTitles }), /differ from the baseline/u);
  assert.throws(() => judgeRun({ exitStatus: 0, reportText: report({ ...healthy, [intendedSuites[0]]: ['passed', 'passed', 'passed'] }), expectedTitles: baselineTitles }), /differ from the baseline/u);
});
