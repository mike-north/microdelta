/**
 * Integrity of the acceptance harness's planned process kills. A run that
 * plans a SIGKILL at a History commit boundary is evidence for a publication
 * kill boundary (A-09/PUB-004) only if the worker actually died there. So the
 * harness counts a planned kill as reached only when the worker was
 * terminated by SIGKILL *and* left the instrumented host's fault trace naming
 * the requested role, occurrence and before/after boundary. Anything else is
 * a missed planned kill, and the harness must fail with enough detail to name
 * its cause: the requested fault, exit status and signal, the actual fault
 * trace or its absence, the worker's own error and its stderr.
 *
 * The process-level cases make the planned kill unreachable deterministically
 * (a failing author body or observer stops the call before the summary
 * publication), so they do not depend on a scheduling race. Outcomes a real
 * worker cannot produce on demand (SIGKILL with no or a mismatched trace) are
 * judged through the same pure judgement with synthetic exits. Runs with no
 * planned fault keep their ordinary semantics: an intentional error is a
 * status-3 result with an `error` line, never a harness failure.
 *
 * @see ../../../../docs/spec/acceptance.md (A-09)
 * @see ../../../../docs/spec/execution.md (PUB-004)
 */
import { afterEach, beforeEach, describe, expect, test } from '@jest/globals';

import { baseWorld, judgeCompletedWorker, judgePlannedKill, scenario } from './harness.js';
import type { IPlannedFault, IScenario, IWorkerExit } from './harness.js';

/** The lost-acknowledgment boundary the crash suite plans: just after the summary publication commits. */
const publishAfter: IPlannedFault = { role: 'publish', occurrence: 2, when: 'after' };

/** The instrumented host's trace for a kill at `fault`, as a reached kill leaves it. */
function faultTrace(fault: IPlannedFault): Readonly<Record<string, unknown>> {
  return { t: 'fault', role: fault.role, occurrence: fault.occurrence, when: fault.when, note: `${fault.when} commit of ${fault.role} #${String(fault.occurrence)}` };
}

/** Earlier worker output that precedes any kill; it carries no fault evidence. */
const progress: readonly Readonly<Record<string, unknown>>[] = [
  { t: 'event', member: 'person:ada', slot: 'summary', phase: 'execute' },
  { t: 'trace', helper: 'summary', key: 'person:ada' },
];

/** A synthetic worker exit. */
function exit(overrides: Partial<IWorkerExit>): IWorkerExit {
  return { status: null, signal: 'SIGKILL', lines: [...progress, faultTrace(publishAfter)], stderr: '', ...overrides };
}

/** The diagnostic of a judgement that must be a miss. */
function missDiagnostic(exitObserved: IWorkerExit, plan: IPlannedFault = publishAfter): string {
  const judgement = judgePlannedKill(plan, exitObserved);
  expect(judgement.kind).toBe('missed');
  return judgement.kind === 'missed' ? judgement.diagnostic : '';
}

describe('planned-kill judgement', () => {
  test('SIGKILL with the trace of the requested role, occurrence and boundary is a reached kill', () => {
    expect(judgePlannedKill(publishAfter, exit({}))).toEqual({ kind: 'reached' });
  });

  test('SIGKILL without any fault trace is a miss that says no trace was written', () => {
    const diagnostic = missDiagnostic(exit({ lines: progress, stderr: 'killed externally' }));
    expect(diagnostic).toMatch(/requested SIGKILL after commit of publish #2/u);
    expect(diagnostic).toMatch(/status null, signal SIGKILL/u);
    expect(diagnostic).toMatch(/fault trace: none/u);
    expect(diagnostic).toMatch(/killed externally/u);
  });

  for (const mismatch of [
    { name: 'role', trace: { role: 'stage', occurrence: 2, when: 'after' as const } },
    { name: 'occurrence', trace: { role: 'publish', occurrence: 1, when: 'after' as const } },
    { name: 'before/after boundary', trace: { role: 'publish', occurrence: 2, when: 'before' as const } },
  ]) {
    test(`SIGKILL with a trace of a different ${mismatch.name} is a miss that shows the actual trace`, () => {
      const diagnostic = missDiagnostic(exit({ lines: [...progress, faultTrace(mismatch.trace)] }));
      expect(diagnostic).toMatch(/requested SIGKILL after commit of publish #2/u);
      expect(diagnostic).toContain(`fault trace: ${JSON.stringify(faultTrace(mismatch.trace))}`);
    });
  }

  test('a matching trace without SIGKILL is a miss', () => {
    const diagnostic = missDiagnostic(exit({ status: 0, signal: null }));
    expect(diagnostic).toMatch(/status 0, signal null/u);
  });

  test('a worker that exits with its own error is a miss that carries the genuine error and stderr', () => {
    const diagnostic = missDiagnostic(exit({
      status: 3,
      signal: null,
      lines: [...progress, { t: 'error', name: 'StaleWriterError', code: null, message: 'Writer lease microdelta-run:x/1 expired at 5' }],
      stderr: 'worker stderr detail',
    }));
    expect(diagnostic).toMatch(/requested SIGKILL after commit of publish #2/u);
    expect(diagnostic).toMatch(/status 3, signal null/u);
    expect(diagnostic).toMatch(/fault trace: none/u);
    expect(diagnostic).toMatch(/worker error: StaleWriterError \(code null\): Writer lease microdelta-run:x\/1 expired at 5/u);
    expect(diagnostic).toMatch(/worker stderr detail/u);
  });
});

describe('planned kills through independent worker processes', () => {
  let s: IScenario;

  beforeEach(() => {
    // The crash suite's setup: a cold report publishes Ada's summary, then a
    // consumed change and a not-final answer make a later resolve execute and
    // publish the summary as History transaction #2 of each role.
    s = scenario();
    s.writeWorld(baseWorld());
    s.run({ kind: 'report' }, { keys: s.saveKeys('cold').file });
    s.writeWorld({
      ...baseWorld(),
      pullRequests: baseWorld().pullRequests.map((pull) => (pull.number === 103 ? { ...pull, merged: true } : pull)),
      final: { 'person:ada': false, 'person:ben': true },
    });
  });

  afterEach(() => {
    s.remove();
  });

  /** The message of the harness failure `attempt` must raise. */
  function harnessFailure(attempt: () => unknown): string {
    let thrown: unknown;
    try {
      attempt();
    } catch (error: unknown) {
      thrown = error;
    }
    expect(thrown).toBeInstanceOf(Error);
    return thrown instanceof Error ? thrown.message : '';
  }

  test('a reachable planned kill returns the killed process with the matching fault trace', () => {
    const killed = s.run({ kind: 'resolve', member: 'person:ada' }, { keys: s.saveKeys('reached').file, fault: publishAfter });
    expect(killed.signal).toBe('SIGKILL');
    expect(killed.lines.filter((line) => line['t'] === 'fault')).toEqual([faultTrace(publishAfter)]);
  });

  test('a planned kill made unreachable by a failing author body fails the harness with the genuine execution failure', () => {
    const message = harnessFailure(() => s.run({ kind: 'resolve', member: 'person:ada' }, { keys: s.saveKeys('author').file, fault: publishAfter, failSummary: 'person:ada' }));
    expect(message).toMatch(/requested SIGKILL after commit of publish #2/u);
    expect(message).toMatch(/status 3, signal null/u);
    expect(message).toMatch(/fault trace: none/u);
    expect(message).toMatch(/worker error: ResolutionError \(code execution-failure\): /u);
  });

  test('a planned kill made unreachable by a failing observer fails the harness with the genuine observer failure', () => {
    const message = harnessFailure(() => s.run({ kind: 'resolve', member: 'person:ada' }, { keys: s.saveKeys('observer').file, fault: publishAfter, throwAt: { phase: 'execute', memberKey: 'person:ada', slot: 'summary' } }));
    expect(message).toMatch(/requested SIGKILL after commit of publish #2/u);
    expect(message).toMatch(/status 3, signal null/u);
    expect(message).toMatch(/fault trace: none/u);
    expect(message).toMatch(/worker error: \w+ \(code observer-failure\): Lifecycle observer failed at execute for .*person:ada/u);
  });

  test('without a planned fault, a failing author body is an ordinary status-3 result with its error line', () => {
    const failed = s.run({ kind: 'resolve', member: 'person:ada' }, { keys: s.saveKeys('author-unplanned').file, failSummary: 'person:ada' });
    expect(failed.status).toBe(3);
    expect(failed.signal).toBeNull();
    expect(failed.result).toBeUndefined();
    expect(failed.error).toMatchObject({ code: 'execution-failure' });
    expect(failed.lines.filter((line) => line['t'] === 'fault')).toEqual([]);
  });

  test('without a planned fault, a failing observer is an ordinary status-3 result with its error line', () => {
    const failed = s.run({ kind: 'resolve', member: 'person:ada' }, { keys: s.saveKeys('observer-unplanned').file, throwAt: { phase: 'execute', memberKey: 'person:ada', slot: 'summary' } });
    expect(failed.status).toBe(3);
    expect(failed.signal).toBeNull();
    expect(failed.result).toBeUndefined();
    expect(failed.error).toMatchObject({ code: 'observer-failure' });
    expect(failed.lines.filter((line) => line['t'] === 'fault')).toEqual([]);
  });
});

describe('an unplanned worker exit must have finished its command', () => {
  test('status 0 with a result line, or status 3 with an error line, is a finished command', () => {
    expect(judgeCompletedWorker({ status: 0, signal: null, lines: [...progress, { t: 'result', outcome: {} }], stderr: '' })).toBeUndefined();
    expect(judgeCompletedWorker({ status: 3, signal: null, lines: [...progress, { t: 'error', name: 'ResolutionError', code: 'execution-failure', message: 'x' }], stderr: '' })).toBeUndefined();
  });

  test('status 0 with neither a result nor an error line is a harness failure naming what the worker left', () => {
    // Regression: a worker whose event loop drained with work pending exited 0 having written no result.
    const diagnostic = judgeCompletedWorker({ status: 0, signal: null, lines: [...progress], stderr: 'pending work never settled' });
    expect(diagnostic).toMatch(/exited with status 0 but wrote no result line/u);
    expect(diagnostic).toMatch(/last line: .*"helper":"summary"/u);
    expect(diagnostic).toMatch(/stderr: pending work never settled/u);
  });

  test.each([
    ['status 0 with only an error line', 0, { t: 'error', name: 'ResolutionError', code: 'execution-failure', message: 'x' }, /status 0 but wrote no result line/u],
    ['status 3 with only a result line', 3, { t: 'result', outcome: {} }, /status 3 but wrote no error line/u],
  ] as const)('a line kind that does not match the exit status is a harness failure: %s', (_label, status, line, message) => {
    expect(judgeCompletedWorker({ status, signal: null, lines: [...progress, line], stderr: '' })).toMatch(message);
  });

  test('status 3 without an error line, or with no output at all, is also a harness failure', () => {
    expect(judgeCompletedWorker({ status: 3, signal: null, lines: [], stderr: '' })).toMatch(/exited with status 3 but wrote no error line.*last line: none/su);
  });
});
