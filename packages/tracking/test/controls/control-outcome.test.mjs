/**
 * Fail-closed rules for judging lazy-view control runs. Only named assertions
 * that actually failed in a validly executed intended suite can reject a wrong
 * behavior; the restored implementation must run the complete intended suite
 * with every assertion passing and a successful process exit.
 *
 * @see https://jestjs.io/docs/cli#--json
 */
import assert from 'node:assert/strict';
import test from 'node:test';

import { rejectsControl, restoredPasses } from './control-outcome.mjs';

const suite = {
  path: '.test-build/test/lazy-view.test.js',
  titles: ['leaf read', 'parity', 'lifetime'],
};

/** A Jest `--json` report for the given suite file and assertion statuses. */
function report(assertions, options = {}) {
  const statuses = assertions.map(([, status]) => status);
  const count = (status) => statuses.filter((candidate) => candidate === status).length;
  return JSON.stringify({
    numTotalTests: assertions.length,
    numFailedTests: count('failed'),
    numPassedTests: count('passed'),
    numPendingTests: count('pending'),
    numTodoTests: count('todo'),
    numRuntimeErrorTestSuites: options.runtimeError === true ? 1 : 0,
    testResults: [{
      name: `/workspace/packages/tracking/${options.path ?? suite.path}`,
      status: options.runtimeError === true || statuses.includes('failed') ? 'failed' : 'passed',
      message: options.runtimeError === true ? 'Test suite failed to run' : '',
      assertionResults: assertions.map(([title, status]) => ({ title, status })),
    }],
  });
}

/** A completed process result. */
const run = (status, stdout, signal = null) => ({ status, signal, stdout });

const allPassed = suite.titles.map((title) => [title, 'passed']);

test('a control is rejected only by named assertions that actually failed', () => {
  const failing = run(1, report([['leaf read', 'failed'], ['parity', 'failed'], ['lifetime', 'passed']]));
  assert.equal(rejectsControl(failing, suite, ['leaf read', 'parity']).rejected, true);
  assert.equal(rejectsControl(failing, suite, ['lifetime']).rejected, false);
});

test('pending, skipped or todo named assertions cannot reject a control', () => {
  for (const status of ['pending', 'skipped', 'todo', 'disabled']) {
    const skipped = run(0, report([['leaf read', status], ['parity', 'passed'], ['lifetime', 'passed']]));
    assert.equal(rejectsControl(skipped, suite, ['leaf read']).rejected, false, status);
  }
});

test('abnormal execution cannot reject a control', () => {
  const cases = [
    run(1, report([], { runtimeError: true })),
    run(null, '', 'SIGKILL'),
    run(1, 'not json'),
    run(1, report([['leaf read', 'failed'], ['parity', 'passed'], ['lifetime', 'passed']], { path: '.test-build/test/other.test.js' })),
    run(0, report([['leaf read', 'failed'], ['parity', 'passed'], ['lifetime', 'passed']])),
    run(2, report([['leaf read', 'failed'], ['parity', 'passed'], ['lifetime', 'passed']])),
  ];
  for (const candidate of cases) {
    assert.equal(rejectsControl(candidate, suite, ['leaf read']).rejected, false, JSON.stringify(candidate).slice(0, 120));
  }
});

test('an incomplete intended suite cannot reject a control', () => {
  const incomplete = run(1, report([['leaf read', 'failed'], ['parity', 'passed']]));
  assert.equal(rejectsControl(incomplete, suite, ['leaf read']).rejected, false);
});

test('the restored implementation passes only a complete, all-passed, successful run', () => {
  assert.equal(restoredPasses(run(0, report(allPassed)), suite).passed, true);
  const cases = [
    run(1, report([], { runtimeError: true })),
    run(0, report([])),
    run(1, report(allPassed)),
    run(null, '', 'SIGTERM'),
    run(0, 'not json'),
    run(0, report(allPassed.slice(1))),
    run(0, report([['leaf read', 'pending'], ['parity', 'passed'], ['lifetime', 'passed']])),
    run(0, report(allPassed, { path: '.test-build/test/other.test.js' })),
    run(1, report([['leaf read', 'failed'], ['parity', 'passed'], ['lifetime', 'passed']])),
  ];
  for (const candidate of cases) {
    assert.equal(restoredPasses(candidate, suite).passed, false, JSON.stringify(candidate).slice(0, 120));
  }
});
