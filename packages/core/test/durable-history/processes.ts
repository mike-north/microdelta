/**
 * Separate-process harness for durable History evidence. It runs the
 * lifecycle worker in a fresh Node process against one real SQLite file,
 * parses the trace the worker writes synchronously to file descriptor 1, and
 * offers the narrow assertions every process suite shares. It adds no
 * storage behavior: the worker drives the production authority directly.
 * @packageDocumentation
 */
import { spawnSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { expect } from '@jest/globals';

import { logicalStore } from './support.js';
import type { IWorkerScript, IWorkerStep } from './worker.js';

/** One trace line written by a worker step. */
export interface ITraceEntry {
  readonly index: number;
  readonly op: string;
  readonly ok: boolean;
  readonly value?: unknown;
  readonly error?: string;
  readonly message?: string;
}

/** Outcome of one child process. */
export interface IWorkerRun {
  readonly signal: NodeJS.Signals | null;
  readonly status: number | null;
  readonly trace: readonly ITraceEntry[];
  readonly stderr: string;
}

/** The emitted worker module beside this harness. */
const workerPath = join(dirname(fileURLToPath(import.meta.url)), 'worker.js');

/** Run one worker script in a fresh Node process and parse its trace. */
export function runWorker(location: string, steps: readonly IWorkerStep[]): IWorkerRun {
  const script: IWorkerScript = { location, store: logicalStore, steps };
  const result = spawnSync(process.execPath, [workerPath, JSON.stringify(script)], { encoding: 'utf8', timeout: 30_000 });
  const trace = result.stdout
    .split('\n')
    .filter((line) => line.length > 0)
    .map((line) => JSON.parse(line) as ITraceEntry);
  return { signal: result.signal, status: result.status, trace, stderr: result.stderr };
}

/** Require that a worker finished normally with every step succeeding. */
export function expectClean(run: IWorkerRun): readonly ITraceEntry[] {
  expect({ status: run.status, signal: run.signal, stderr: run.stderr }).toEqual({ status: 0, signal: null, stderr: '' });
  expect(run.trace.filter((entry) => !entry.ok)).toEqual([]);
  return run.trace;
}

/** Require that a worker died by SIGKILL after tracing exactly `completedSteps` successful steps. */
export function expectKilled(run: IWorkerRun, completedSteps: number): void {
  expect(run.signal).toBe('SIGKILL');
  expect(run.trace).toHaveLength(completedSteps);
  expect(run.trace.every((entry) => entry.ok)).toBe(true);
}

/** Read a traced step's value with a narrow shape the test expects. */
export function valueOf<T>(entry: ITraceEntry | undefined): T {
  if (entry === undefined || !entry.ok) {
    throw new Error(`expected a successful step, got ${JSON.stringify(entry)}`);
  }
  return entry.value as T;
}
