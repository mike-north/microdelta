/** Failure receipts must stay readable at qualification scale while preserving the actual blocking facts. */
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, jest, test } from '@jest/globals';
import { qualificationWriterLeaseMilliseconds } from './workload-budget.js';
import { captureWorkloadProcessFailure, summarizeWorkloadFailure, WorkloadIncompleteError } from './workload-failure.js';
import type { IWorkloadFailureInput } from './workload-failure.js';
import { runWorkloadPhase } from './workload-worker.js';

const directories: string[] = [];
afterEach(() => { jest.restoreAllMocks(); for (const directory of directories.splice(0)) { rmSync(directory, { recursive: true, force: true }); } });

/** Synthetic cardinalities exercise output size independently from the live worker's real fencing regression. */
function failureInput(count: number): IWorkloadFailureInput {
  return {
    fold: { outcome: { status: 'waiting' }, discovery: { kind: 'keyed', completion: 'complete', keys: Array.from({ length: count }, (_, index) => `person-${String(index)}`) },
      members: Array.from({ length: count }, (_, index) => ({ key: `person-${String(index)}`, status: 'pending', reason: 'lease-lost' })) },
    usage: { status: 'incomplete', operations: count + 2, requestAttempts: count + 3, reports: 2,
      unknown: Array.from({ length: count }, (_, index) => ({ operation: `operation-${String(index)}`, requestAttempt: `attempt-${String(index)}`, attribution: { run: 'run', member: null, stepAttempt: null } })) },
    diagnostics: Array.from({ length: count }, () => `writer lease is no longer current ${'x'.repeat(5_000)}`),
    stop: { level: 'soft', cause: 'deadline', deadline: 123_456 }, waitingUntil: 234_567,
  };
}

describe('bounded workload failure evidence', () => {
  test('the parent preserves structured child evidence and actual elapsed time without repeating stderr', () => {
    const child = { status: 'incomplete', measurementScope: 'partial-through-run-return', usage: { requestAttempts: 7 } };
    expect(captureWorkloadProcessFailure('cold', 42.5, 1, `Node warning\n${JSON.stringify(child)}\n`, undefined))
      .toEqual({ phase: 'cold', status: 'process-failed', elapsedMilliseconds: 42.5, exitStatus: 1, processError: null, workerReceipt: child, stderrTail: null });
  });

  test('timeout and malformed output preserve a bounded tail with unavailable child measurements', () => {
    const failure = captureWorkloadProcessFailure('restart', 120.5, null, `${'x'.repeat(30_000)}\nnot-json\n`, 'timeout');
    expect(failure).toMatchObject({ phase: 'restart', status: 'process-failed', elapsedMilliseconds: 120.5, exitStatus: null, processError: 'timeout', workerReceipt: null });
    expect(failure.stderrTail?.endsWith('not-json\n')).toBe(true);
    expect(failure.stderrTail?.length).toBeLessThanOrEqual(8_192);
    expect(JSON.stringify(failure).length).toBeLessThan(8_500);
    expect(captureWorkloadProcessFailure('cold', 1, 1, '{"status":"complete"}\n', undefined).workerReceipt).toBeNull();
  });

  test('large arrays become exact counts and one bounded first pending reason and diagnostic', () => {
    const small = summarizeWorkloadFailure(failureInput(1));
    const large = summarizeWorkloadFailure(failureInput(20_000));
    expect(large).toMatchObject({ foldStatus: 'waiting', discovery: { kind: 'keyed', completion: 'complete', keys: 20_000 }, memberStatuses: { pending: 20_000 },
      firstPending: { key: 'person-0', status: 'pending', reason: 'lease-lost' }, diagnostic: { count: 20_000, firstTruncated: true },
      stop: { level: 'soft', cause: 'deadline', deadline: 123_456 }, waitingUntil: 234_567,
      usage: { status: 'incomplete', operations: 20_002, requestAttempts: 20_003, reports: 2, unknown: 20_000 } });
    expect(large.diagnostic.first).toContain('writer lease is no longer current');
    expect(large.diagnostic.first?.length).toBeLessThanOrEqual(512);
    expect(JSON.stringify(large).length).toBeLessThan(1_500);
    expect(JSON.stringify(large).length - JSON.stringify(small).length).toBeLessThan(40);
    expect(JSON.stringify(large)).not.toContain('attempt-');
  });

  test('missing diagnostics, pending members, discovery population, stop cause and floor stay explicit nulls', () => {
    const input = failureInput(0);
    const summary = summarizeWorkloadFailure({ ...input, fold: { ...input.fold, discovery: { kind: 'pending' } }, stop: { level: 'none', cause: undefined, deadline: undefined }, waitingUntil: undefined });
    expect(summary).toMatchObject({ firstPending: null, diagnostic: { first: null, count: 0, firstTruncated: false },
      discovery: { kind: 'pending', completion: null, keys: null }, stop: { level: 'none', cause: null, deadline: null }, waitingUntil: null });
  });

  test('the actual worker retains lease fencing and throws the structured bounded failure after its explicit lease expires', async () => {
    const directory = mkdtempSync(join(tmpdir(), 'workload-failure-')); directories.push(directory);
    let current = Date.now(); let advanced = false;
    const clock = jest.spyOn(Date, 'now').mockImplementation(() => current);
    try {
      let failure: unknown;
      try {
        await runWorkloadPhase({ directory, phase: 'cold', requestKey: 'expired-qualification', personCount: 1 }, [{ observe(event) {
          if (!advanced && event.kind === 'step' && event.event.phase === 'publish' && event.event.step.slot === 'search') { advanced = true; current += qualificationWriterLeaseMilliseconds + 1; }
        } }]);
      } catch (error) { failure = error; }
      expect(advanced).toBe(true);
      expect(failure).toBeInstanceOf(WorkloadIncompleteError);
      if (!(failure instanceof WorkloadIncompleteError)) { throw new Error('worker failed without bounded failure evidence'); }
      expect(failure.receipt).toMatchObject({ foldStatus: 'waiting', firstPending: { key: 'employee-001', status: 'pending', reason: 'lease-lost' },
        discovery: { kind: 'keyed', completion: 'complete', keys: 1 }, memberStatuses: { pending: 1 }, stop: { level: 'none', cause: null, deadline: null }, waitingUntil: null });
      expect(failure.receipt.diagnostic.first).toContain('writer lease');
      expect(failure.receipt.diagnostic.count).toBeGreaterThan(0);
      expect(failure.receipt.usage.requestAttempts).toBeGreaterThan(0);
      expect(failure.receipt).toMatchObject({ phase: 'cold', status: 'incomplete', measurementScope: 'partial-through-run-return' });
      expect(failure.receipt.observed.routes['search-page']?.sends).toBeGreaterThan(0);
      expect(failure.receipt.observed.observedAssessmentRequests).toBe(0);
      expect(failure.receipt.memory.sampleCounts.final).toBe(1);
      expect(failure.receipt.memory.maxRssUnit).toBe('kibibytes');
      expect(failure.receipt.memory.maxRssBytes).toBe(failure.receipt.memory.rawMaxRss * 1_024);
      expect(failure.receipt.memory.peakSampledRssBytes).toBeGreaterThan(0);
      expect(JSON.stringify(failure.receipt).length).toBeLessThan(8_000);
    } finally { clock.mockRestore(); }
  }, 15_000);
});
