/**
 * Separate-process evidence for external operations on the real packages:
 * crashes on either side of a send and of the usage acknowledgment, the
 * quota deferral across three processes with correlated identities, durable
 * remote state after a hard stop, and privacy of every process's output
 * (RUN-011 to RUN-014, ACC-005, ACC-007; EXP-8 process stages).
 *
 * Each stage is a fresh Node process over the same store files, killed with
 * SIGKILL at a named boundary where the case needs it. Expected outcomes are
 * hand-derived from the owner decisions and EXP-8's stage table:
 *
 * - a kill between intent and usage leaves that attempt's usage unknown,
 *   never zero; a later run records the operation unknown and does not replay
 *   it (CX-4 when the provider received nothing);
 * - a kill after the usage acknowledgment keeps exactly one usage record;
 * - a repeat-safe operation is retried by the next process under the same
 *   identity; with provider idempotency keys the effect is applied once;
 * - a quota deferral is honored by a process before T and retried by one
 *   after T under the same operation identity, with new request attempt,
 *   step attempt and run identities;
 * - a hard stop's remote state is durable for the next process;
 * - no process writes a planted value to stdout or stderr.
 *
 * This proves the single-host process-termination scope only, not power loss.
 *
 * @see ../../../../docs/spec/operations.md (RUN-011 to RUN-014, ACC-005, ACC-007)
 * @see ../../../../docs/spec/acceptance.md (A-12, A-13, A-14)
 * @see ../../../../experiments/exp-8/decision.md (process-stage results)
 */
import { spawnSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { afterEach, beforeEach, describe, expect, test } from '@jest/globals';

import { T0, hour, tempStores } from './harness.js';
import type { IOperationStores } from './harness.js';
import { planted } from './provider.js';
import type { ILedgerEntry } from './provider.js';
import type { IWorkerReport, IWorkerScript } from './worker.js';
import { fakeProvider } from './provider.js';

/** The emitted worker module beside this suite. */
const workerPath = join(dirname(fileURLToPath(import.meta.url)), 'worker.js');

let stores: IOperationStores;

beforeEach(() => {
  stores = tempStores();
});

afterEach(() => {
  stores.remove();
});

/** One finished worker process. */
interface IStage {
  readonly signal: NodeJS.Signals | null;
  readonly status: number | null;
  readonly stdout: string;
  readonly stderr: string;
  readonly report: IWorkerReport | undefined;
}

/** Every stage's output, for the privacy scan. */
const outputs: string[] = [];

/** Run one worker stage. */
function stage(script: Omit<IWorkerScript, 'history' | 'accounting' | 'ledger'>): IStage {
  const full: IWorkerScript = { ...script, history: stores.history, accounting: stores.accounting, ledger: stores.ledger };
  const result = spawnSync(process.execPath, [workerPath, JSON.stringify(full)], { encoding: 'utf8', timeout: 60_000 });
  outputs.push(result.stdout, result.stderr);
  const line = result.stdout.split('\n').find((text) => text.length > 0);
  // The worker wrote exactly this shape with JSON.stringify.
  const report = line === undefined ? undefined : JSON.parse(line) as IWorkerReport;
  return { signal: result.signal, status: result.status, stdout: result.stdout, stderr: result.stderr, report };
}

/** A stage that must finish cleanly; returns its report. */
function clean(script: Omit<IWorkerScript, 'history' | 'accounting' | 'ledger'>): IWorkerReport {
  const run = stage(script);
  expect({ status: run.status, signal: run.signal, stderr: run.stderr }).toEqual({ status: 0, signal: null, stderr: '' });
  if (run.report === undefined) {
    throw new Error('the worker reported nothing');
  }
  return run.report;
}

/** The provider's persisted ledger for pr-1's assessment. */
function ledger(kind: ILedgerEntry['kind']): readonly ILedgerEntry[] {
  return fakeProvider(() => 0, stores.ledger).ledger().filter((entry) => entry.kind === kind && entry.key === 'pr-1');
}

/** The operation views of pr-1 a worker reported. */
function pr1Operations(report: IWorkerReport): readonly Record<string, unknown>[] {
  return report.operations.flatMap((view) => typeof view === 'object' && view !== null && Reflect.get(view, 'member') === 'pr-1' ? [{ ...view }] : []);
}

/** The usage summary fields a worker reported. */
function usageOf(report: IWorkerReport): { readonly status: unknown; readonly observed: unknown; readonly unknown: unknown } {
  const usage = report.usage;
  return {
    status: typeof usage === 'object' && usage !== null ? Reflect.get(usage, 'status') : undefined,
    observed: typeof usage === 'object' && usage !== null ? Reflect.get(usage, 'observed') : undefined,
    unknown: typeof usage === 'object' && usage !== null ? Reflect.get(usage, 'unknown') : undefined,
  };
}

/** The operation events of a report, as `name@member:phase:status:reason` strings. */
function trace(report: IWorkerReport): readonly string[] {
  return report.events.flatMap((event) => event.kind === 'operation'
    ? [`${event.name}@${event.member ?? '-'}:${event.phase}${event.status === undefined ? '' : `:${event.status}`}${event.reason === undefined ? '' : `:${event.reason}`}`]
    : []);
}

describe('process death around the send and the usage acknowledgment (ACC-005, ACC-007, A-14)', () => {
  test('a kill after the intent but before the send leaves usage unknown and the operation unknown, and nothing is replayed (CX-4)', () => {
    const killed = stage({ now: T0, runId: 'run:A', action: 'members', kill: 'before-send' });
    expect(killed.signal).toBe('SIGKILL');
    expect(ledger('received')).toHaveLength(0);
    const before = clean({ now: T0 + 5_000, runId: 'run:read', action: 'inspect' });
    // The crashed run's intent is already unknown usage, before any writer recovers it.
    expect(usageOf(before).status).toBe('incomplete');
    expect(pr1Operations(before).map((view) => view['status'])).toEqual(['pending']);
    const after = clean({ now: T0 + 10_000, runId: 'run:B', action: 'members' });
    expect(after.statuses).toEqual({ 'pr-1': 'pending', 'pr-2': 'succeeded', 'pr-3': 'succeeded' });
    expect(trace(after)).toContain('assess@pr-1:recovered:unknown:recovered-after-crash');
    expect(pr1Operations(after).map((view) => view['status'])).toEqual(['unknown']);
    expect(ledger('received')).toHaveLength(0);
  });

  test('a kill after the provider applied the effect leaves usage and outcome unknown, applied once, never replayed', () => {
    expect(stage({ now: T0, runId: 'run:A', action: 'members', kill: 'after-send' }).signal).toBe('SIGKILL');
    const after = clean({ now: T0 + 10_000, runId: 'run:B', action: 'members' });
    expect(after.statuses).toEqual({ 'pr-1': 'pending', 'pr-2': 'succeeded', 'pr-3': 'succeeded' });
    expect(usageOf(after).status).toBe('incomplete');
    const again = clean({ now: T0 + 20_000, runId: 'run:C', action: 'members' });
    expect(again.statuses?.['pr-1']).toBe('pending');
    expect(ledger('received')).toHaveLength(1);
    expect(ledger('applied')).toHaveLength(1);
  });

  test('a kill after the usage acknowledgment keeps exactly one usage record while the outcome stays unknown', () => {
    expect(stage({ now: T0, runId: 'run:A', action: 'members', kill: 'after-usage' }).signal).toBe('SIGKILL');
    const after = clean({ now: T0 + 10_000, runId: 'run:B', action: 'members' });
    expect(after.statuses?.['pr-1']).toBe('pending');
    expect(usageOf(after)).toEqual({ status: 'complete', observed: [{ unit: 'tokens', amount: 300 }], unknown: [] });
    expect(ledger('applied')).toHaveLength(1);
  });

  test('a repeat-safe operation is retried by the next process under the same identity (the author accepted two effects)', () => {
    const options = { 'pr-1': { safeToRepeat: true, retry: { maxAttempts: 2 } } };
    expect(stage({ now: T0, runId: 'run:A', action: 'members', kill: 'after-send', options }).signal).toBe('SIGKILL');
    const after = clean({ now: T0 + 10_000, runId: 'run:B', action: 'members', options });
    expect(after.statuses?.['pr-1']).toBe('succeeded');
    const requests = ledger('received');
    expect(requests).toHaveLength(2);
    expect(requests[1]?.operation).toBe(requests[0]?.operation);
    expect(ledger('applied')).toHaveLength(2);
  });

  test('with provider idempotency keys the next process retries under the same key and the effect is applied once', () => {
    const options = { 'pr-1': { providerIdempotency: true, retry: { maxAttempts: 2 } } };
    expect(stage({ now: T0, runId: 'run:A', action: 'members', kill: 'after-send', options }).signal).toBe('SIGKILL');
    const after = clean({ now: T0 + 10_000, runId: 'run:B', action: 'members', options });
    expect(after.statuses?.['pr-1']).toBe('succeeded');
    expect(ledger('received').map((entry) => entry.idempotencyKey)).toEqual([ledger('received')[0]?.operation, ledger('received')[0]?.operation]);
    expect(ledger('applied')).toHaveLength(1);
  });
});

describe('the quota deferral across processes, with correlated identities (RUN-011, RUN-013)', () => {
  test('process B before T admits nothing; process C after T retries under the same operation with new attempt and run identities', () => {
    const T = T0 + 3 * hour;
    const a = clean({ now: T0, runId: 'run:A', action: 'members', scripts: [{ name: 'assess', key: 'pr-1', entries: ['rate-limit:10800000'] }] });
    expect(a.statuses).toEqual({ 'pr-1': 'pending', 'pr-2': 'succeeded', 'pr-3': 'succeeded' });
    expect(a.waitingUntil).toBe(T);
    const b = clean({ now: T0 + hour, runId: 'run:B', action: 'members' });
    expect(b.statuses).toEqual({ 'pr-1': 'pending', 'pr-2': 'succeeded', 'pr-3': 'succeeded' });
    expect(b.waitingUntil).toBe(T);
    expect(trace(b)).toEqual(['assess@pr-1:blocked:deferred:not-before']);
    const c = clean({ now: T + 60_000, runId: 'run:C', action: 'members' });
    expect(c.statuses).toEqual({ 'pr-1': 'succeeded', 'pr-2': 'succeeded', 'pr-3': 'succeeded' });
    const started = (report: IWorkerReport) => report.events.flatMap((event) => event.kind === 'operation' && event.phase === 'request-started' && event.member === 'pr-1' ? [event] : []);
    const [first] = started(a);
    const [retry] = started(c);
    expect(retry?.operation).toBe(first?.operation);
    expect(retry?.requestAttempt).not.toBe(first?.requestAttempt);
    expect(retry?.stepAttempt).not.toBe(first?.stepAttempt);
    expect([first?.runId, retry?.runId]).toEqual(['run:A', 'run:C']);
    // Three successes reported 100 tokens each, and the quota refusal one request.
    expect(usageOf(c)).toEqual({ status: 'complete', observed: [{ unit: 'requests', amount: 1 }, { unit: 'tokens', amount: 300 }], unknown: [] });
    expect(ledger('received')).toHaveLength(2);
  });
});

describe('durable remote state after a hard stop (RUN-014)', () => {
  test('the next process reads the aborted attempt as running, and the operation unknown', () => {
    const a = clean({ now: T0, runId: 'run:A', action: 'members', hardStop: true, cancel: 'running', scripts: [{ name: 'assess', key: 'pr-1', entries: ['hang'] }] });
    expect(a.statuses?.['pr-1']).toBe('cancelled');
    const b = clean({ now: T0 + 5_000, runId: 'run:read', action: 'inspect' });
    expect(pr1Operations(b)).toEqual([expect.objectContaining({
      status: 'unknown',
      attempts: [expect.objectContaining({ status: 'unknown', remote: 'running' })],
    })]);
  });
});

describe('privacy of process output (RUN-013)', () => {
  test('no stage of a mixed workload writes the planted value to stdout or stderr', () => {
    outputs.length = 0;
    const scripts = [
      { name: 'assess', key: 'pr-1', entries: ['lost'] as const },
      { name: 'assess', key: 'pr-2', entries: ['permanent'] as const },
      { name: 'assess', key: 'pr-3', entries: ['rate-limit:60000'] as const },
    ];
    clean({ now: T0, runId: 'run:A', action: 'members', scripts });
    clean({ now: T0 + 10_000, runId: 'run:B', environment: 'env:trial', action: 'members', hardStop: true, cancel: 'running', scripts: [{ name: 'assess', key: 'pr-1', entries: ['hang'] }] });
    expect(stage({ now: T0 + 20_000, runId: 'run:C', environment: 'env:trial', action: 'members', kill: 'after-send', target: 'pr-2', scripts: [{ name: 'assess', key: 'pr-2', entries: ['ok'] }] }).signal).toBe('SIGKILL');
    clean({ now: T0 + hour, runId: 'run:D', action: 'inspect' });
    clean({ now: T0 + hour, runId: 'run:E', environment: 'env:trial', action: 'inspect' });
    expect(outputs.join('').length).toBeGreaterThan(0);
    expect(planted).toContain('c0ffee');
    for (const output of outputs) {
      expect(output).not.toContain('c0ffee');
    }
  });
});
