/**
 * Process-termination evidence for Resource Accounting (ACC-005, ACC-007,
 * A-14). Every scenario runs steps in independent Node child processes against
 * one real SQLite file through the production adapter, kills a process with
 * SIGKILL at a selected boundary, and inspects the reopened file from this
 * separate test process and from a successor process.
 *
 * The boundaries follow the owner's write order, intent before send and usage
 * before outcome: after the intent, after the provider applied the call, after
 * the usage acknowledgment, and inside the acknowledgment's commit (a lost
 * acknowledgment whose commit landed, and one whose commit did not). This is
 * single-file process-termination scope, not power loss or a concurrency proof.
 *
 * @see ../../../../docs/spec/operations.md (ACC-005, ACC-007)
 * @see ../../../../docs/spec/acceptance.md (A-14)
 * @see ../../../../experiments/exp-8/decision.md (kill-after-intent, kill-after-send, kill-after-usage, lost acknowledgment)
 */
import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { afterEach, describe, expect, test } from '@jest/globals';
import type { IUsageReport } from '@microdelta/accounting';

import { adaAttribution, cleanup, freshDirectory, freshLocation, intentFor, openAccounting, tokenReport } from './support.js';
import type { IWorkerScript, IWorkerStep } from './worker.js';

afterEach(cleanup);

/** One trace line written by a worker step. */
interface ITraceEntry {
  readonly index: number;
  readonly op: string;
  readonly ok: boolean;
  readonly value: unknown;
}

/** Outcome of one child process. */
interface IWorkerRun {
  readonly signal: NodeJS.Signals | null;
  readonly status: number | null;
  readonly trace: readonly ITraceEntry[];
  readonly stderr: string;
}

/** The emitted worker module beside this test. */
const workerPath = join(dirname(fileURLToPath(import.meta.url)), 'worker.js');

/** Narrow one parsed trace line. */
function traceEntry(line: string): ITraceEntry {
  const parsed: unknown = JSON.parse(line);
  if (typeof parsed !== 'object' || parsed === null) {
    throw new Error(`malformed trace line ${line}`);
  }
  const index: unknown = Reflect.get(parsed, 'index');
  const op: unknown = Reflect.get(parsed, 'op');
  const ok: unknown = Reflect.get(parsed, 'ok');
  if (typeof index !== 'number' || typeof op !== 'string' || typeof ok !== 'boolean') {
    throw new Error(`malformed trace line ${line}`);
  }
  return { index, op, ok, value: ok ? Reflect.get(parsed, 'value') : Reflect.get(parsed, 'error') };
}

/** Run one worker script in a fresh Node process and parse its trace. */
function runWorker(location: string, steps: readonly IWorkerStep[]): IWorkerRun {
  const script: IWorkerScript = { location, steps };
  const result = spawnSync(process.execPath, [workerPath, JSON.stringify(script)], { encoding: 'utf8', timeout: 30_000 });
  const trace = result.stdout.split('\n').filter((line) => line.length > 0).map(traceEntry);
  return { signal: result.signal, status: result.status, trace, stderr: result.stderr };
}

/** Require that a worker finished normally with every step succeeding, and return its trace values. */
function expectClean(run: IWorkerRun): readonly unknown[] {
  expect({ status: run.status, signal: run.signal, stderr: run.stderr }).toEqual({ status: 0, signal: null, stderr: '' });
  expect(run.trace.filter((entry) => !entry.ok)).toEqual([]);
  return run.trace.map((entry) => entry.value);
}

/** Require that a worker died by SIGKILL after tracing exactly `completedSteps` successful steps. */
function expectKilled(run: IWorkerRun, completedSteps: number): void {
  expect(run.signal).toBe('SIGKILL');
  expect(run.trace.map((entry) => ({ op: entry.op, ok: entry.ok }))).toHaveLength(completedSteps);
  expect(run.trace.every((entry) => entry.ok)).toBe(true);
}

/** The calls a fake provider applied, read from its ledger. */
function applied(provider: string): readonly string[] {
  return existsSync(provider) ? readFileSync(provider, 'utf8').split('\n').filter((line) => line.length > 0) : [];
}

/** Ada's single paid assessment: one operation, one request, one report of 100 input tokens. */
const intent = intentFor('op-assess-ada', 'req-1');
const report: IUsageReport = tokenReport('op-assess-ada', 'req-1', 'usage-1', 100);

/** A fresh accounting file and fake provider ledger. */
function fixture(): { readonly location: string; readonly provider: string } {
  return { location: freshLocation(), provider: join(freshDirectory(), 'provider.jsonl') };
}

describe('separate-process kills around a paid call', () => {
  test('kill after open: the provider received nothing, yet usage is unknown, never zero', () => {
    const { location, provider } = fixture();
    const crashed = runWorker(location, [{ op: 'open', intent }, { op: 'kill' }]);
    expectKilled(crashed, 1);
    expect(crashed.trace[0]?.value).toBe('opened');

    // Pessimistic by design (EXP-8 CX-4): without a provider status query, an intent without a report is unknown.
    expect(applied(provider)).toEqual([]);
    const summary = openAccounting({ location }).summarizeUsage({ environment: 'production' });
    expect(summary).toMatchObject({ status: 'incomplete', observed: [], requests: 1, reports: 0 });
    expect(summary.unknown).toEqual([{ operation: 'op-assess-ada', request: 'req-1', attribution: adaAttribution }]);

    // A successor process reads the same gap; nothing it can redeliver fills it.
    const [redelivered, successorView] = expectClean(runWorker(location, [{ op: 'redeliver', provider }, { op: 'summarize', environment: 'production' }]));
    expect(redelivered).toEqual([]);
    expect(successorView).toMatchObject({ status: 'incomplete', unknown: [{ request: 'req-1' }] });
  });

  test('kill after the provider applied the call: usage is unknown until the late report is delivered once', () => {
    const { location, provider } = fixture();
    const crashed = runWorker(location, [{ op: 'open', intent }, { op: 'send', provider, report }, { op: 'kill' }]);
    expectKilled(crashed, 2);

    expect(applied(provider)).toHaveLength(1);
    expect(openAccounting({ location }).summarizeUsage({ environment: 'production' })).toMatchObject({ status: 'incomplete', observed: [], reports: 0 });

    // The successor delivers the provider's late report: counted exactly once, with no replay of the call.
    const [firstDelivery, afterFirst] = expectClean(runWorker(location, [{ op: 'redeliver', provider }, { op: 'summarize', environment: 'production' }]));
    expect(firstDelivery).toEqual(['acknowledged']);
    expect(afterFirst).toMatchObject({ status: 'known', observed: [{ unit: 'tokens.input', amount: 100 }], reports: 1 });
    const [secondDelivery] = expectClean(runWorker(location, [{ op: 'redeliver', provider }]));
    expect(secondDelivery).toEqual(['duplicate']);
    expect(applied(provider)).toHaveLength(1);
    expect(openAccounting({ location }).summarizeUsage({ environment: 'production' })).toMatchObject({ status: 'known', observed: [{ unit: 'tokens.input', amount: 100 }], reports: 1 });
  });

  test('kill after the acknowledgment: the durable report survives and a redelivery is a duplicate', () => {
    const { location, provider } = fixture();
    const crashed = runWorker(location, [{ op: 'open', intent }, { op: 'send', provider, report }, { op: 'acknowledge', report }, { op: 'kill' }]);
    expectKilled(crashed, 3);
    expect(crashed.trace[2]?.value).toEqual({ kind: 'acknowledged', report });

    expect(openAccounting({ location }).summarizeUsage({ environment: 'production' })).toMatchObject({ status: 'known', observed: [{ unit: 'tokens.input', amount: 100 }], reports: 1 });
    const [redelivered] = expectClean(runWorker(location, [{ op: 'redeliver', provider }]));
    expect(redelivered).toEqual(['duplicate']);
    expect(openAccounting({ location }).summarizeUsage({ environment: 'production' })).toMatchObject({ observed: [{ unit: 'tokens.input', amount: 100 }], reports: 1 });
  });
});

describe('a lost acknowledgment (ambiguous commit)', () => {
  test('the commit landed but the process died before acknowledging: usage is retained exactly once', () => {
    const { location, provider } = fixture();
    const crashed = runWorker(location, [
      { op: 'open', intent },
      { op: 'send', provider, report },
      { op: 'arm', role: 'report', timing: 'after-commit' },
      { op: 'acknowledge', report },
    ]);
    // The acknowledge step never traced: its caller received no acknowledgment.
    expectKilled(crashed, 3);

    expect(openAccounting({ location }).summarizeUsage({ environment: 'production' })).toMatchObject({ status: 'known', observed: [{ unit: 'tokens.input', amount: 100 }], reports: 1 });
    // Redelivering the same report resolves the ambiguity without counting it twice.
    const [redelivered, view] = expectClean(runWorker(location, [{ op: 'redeliver', provider }, { op: 'summarize', environment: 'production' }]));
    expect(redelivered).toEqual(['duplicate']);
    expect(view).toMatchObject({ status: 'known', observed: [{ unit: 'tokens.input', amount: 100 }], reports: 1 });
  });

  test('the commit did not land: usage stays unknown until redelivery records it once', () => {
    const { location, provider } = fixture();
    const crashed = runWorker(location, [
      { op: 'open', intent },
      { op: 'send', provider, report },
      { op: 'arm', role: 'report', timing: 'before-commit' },
      { op: 'acknowledge', report },
    ]);
    expectKilled(crashed, 3);

    expect(openAccounting({ location }).summarizeUsage({ environment: 'production' })).toMatchObject({ status: 'incomplete', observed: [], reports: 0 });
    const [redelivered, view] = expectClean(runWorker(location, [{ op: 'redeliver', provider }, { op: 'summarize', environment: 'production' }]));
    expect(redelivered).toEqual(['acknowledged']);
    expect(view).toMatchObject({ status: 'known', observed: [{ unit: 'tokens.input', amount: 100 }], reports: 1 });
  });

  test('an intent whose commit did not land leaves no expected usage; one that landed is already open', () => {
    const { location } = fixture();
    expectKilled(runWorker(location, [{ op: 'arm', role: 'intent', timing: 'before-commit' }, { op: 'open', intent }]), 1);
    expect(openAccounting({ location }).summarizeUsage({ environment: 'production' })).toMatchObject({ status: 'known', requests: 0 });

    expectKilled(runWorker(location, [{ op: 'arm', role: 'intent', timing: 'after-commit' }, { op: 'open', intent }]), 1);
    const [reopened] = expectClean(runWorker(location, [{ op: 'open', intent }]));
    expect(reopened).toBe('already-open');
  });
});
