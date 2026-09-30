/**
 * Parent-side support for the M3 independent-process acceptance suites. A
 * scenario owns one temporary directory holding the shared SQLite store, the
 * external world file and the caller's saved request keys. Each step spawns a
 * fresh worker process (`worker.ts`) that rebuilds declarations, helpers and
 * inputs from scratch; the only thing that survives between steps is durable
 * History and the files the caller wrote. The parent inspects durable state
 * through History's real authority on the same file, never through a cache.
 *
 * @see ../../../../docs/plans/m3-contribution-analysis.md
 */
import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import type { IDurableHistory } from '@microdelta/history';
import { createNodeClock } from '@microdelta/machine-node';

import { openHistory } from '../durable-history/support.js';
import { analysisScope } from './analysis.js';
import type { IMemberKey, IVariation, IWorld } from './analysis.js';
import type { ICommand, IJob } from './worker.js';

/** The logical store every acceptance scenario uses. */
export const logicalStore = 'store:m3-acceptance';

/** The environment every acceptance run selects. */
export const environment = 'env:acceptance';

/** The worker and preload entry points, as emitted beside this module. */
const worker = fileURLToPath(new URL('./worker.js', import.meta.url));
const preload = fileURLToPath(new URL('./register.js', import.meta.url));

/**
 * The raw acme/widget Q1 activity of the contribution example, including
 * records the attribution rules must exclude (out of window, pending,
 * unselected contributor). Expected statistics are derived by hand in the
 * suites, not from this function.
 */
export function baseWorld(): IWorld {
  return {
    repository: 'acme/widget',
    profiles: [
      { key: 'person:ada', id: 'gh:1001', name: 'Ada', avatarUrl: 'https://avatars.example/ada.png' },
      { key: 'person:ben', id: 'gh:2002', name: 'Ben', avatarUrl: 'https://avatars.example/ben.png' },
      { key: 'person:cy', id: 'gh:3003', name: 'Cy', avatarUrl: 'https://avatars.example/cy.png' },
    ],
    pullRequests: [
      { number: 98, author: 'person:ada', createdAt: '2025-12-18T09:00:00Z', merged: true, labels: ['chore'] },
      { number: 101, author: 'person:ada', createdAt: '2026-01-12T10:30:00Z', merged: true, labels: ['feature'] },
      { number: 102, author: 'person:ada', createdAt: '2026-02-03T16:05:00Z', merged: true, labels: ['docs'] },
      { number: 103, author: 'person:ada', createdAt: '2026-03-20T08:45:00Z', merged: false, labels: [] },
      { number: 201, author: 'person:ben', createdAt: '2026-01-25T13:00:00Z', merged: true, labels: ['bug'] },
      { number: 202, author: 'person:ben', createdAt: '2026-03-02T11:20:00Z', merged: false, labels: [] },
      { number: 204, author: 'person:ben', createdAt: '2026-04-01T00:00:00Z', merged: true, labels: ['bug'] },
      { number: 301, author: 'person:cy', createdAt: '2026-02-14T12:00:00Z', merged: true, labels: [] },
    ],
    reviews: [
      { id: 'rv-ada-0', author: 'person:ada', submittedAt: '2025-12-30T10:00:00Z', state: 'submitted' },
      { id: 'rv-ada-1', author: 'person:ada', submittedAt: '2026-01-26T09:00:00Z', state: 'submitted' },
      { id: 'rv-ada-2', author: 'person:ada', submittedAt: '2026-03-03T15:00:00Z', state: 'submitted' },
      { id: 'rv-ada-3', author: 'person:ada', submittedAt: '2026-02-15T10:10:00Z', state: 'submitted' },
      { id: 'rv-ada-4', author: 'person:ada', submittedAt: '2026-03-05T17:30:00Z', state: 'submitted' },
      { id: 'rv-ada-5', author: 'person:ada', submittedAt: '2026-01-27T08:00:00Z', state: 'submitted' },
      { id: 'rv-ada-6', author: 'person:ada', submittedAt: '2026-03-31T23:00:00Z', state: 'pending' },
      { id: 'rv-ben-1', author: 'person:ben', submittedAt: '2026-01-13T11:00:00Z', state: 'submitted' },
      { id: 'rv-ben-2', author: 'person:ben', submittedAt: '2026-02-04T09:30:00Z', state: 'submitted' },
      { id: 'rv-ben-3', author: 'person:ben', submittedAt: '2026-03-21T14:00:00Z', state: 'submitted' },
      { id: 'rv-ben-4', author: 'person:ben', submittedAt: '2026-04-02T10:00:00Z', state: 'submitted' },
      { id: 'rv-cy-1', author: 'person:cy', submittedAt: '2026-01-14T10:00:00Z', state: 'submitted' },
    ],
    check: { 'person:ada': 'fresh', 'person:ben': 'fresh' },
    final: { 'person:ada': true, 'person:ben': true },
  };
}

/** One parsed worker process. */
export interface IProcessRun {
  /** Exit status, or null when killed. */
  readonly status: number | null;
  /** Terminating signal, when killed. */
  readonly signal: NodeJS.Signals | null;
  /** Every parsed line, in order. */
  readonly lines: readonly Readonly<Record<string, unknown>>[];
  /** The final result line's fields, when the command completed. */
  readonly result: Readonly<Record<string, unknown>> | undefined;
  /** The final error line's fields, when the command failed. */
  readonly error: Readonly<Record<string, unknown>> | undefined;
  /** Author helper calls of one kind for one member. */
  count(helper: string, member?: IMemberKey): number;
  /** Step lifecycle phases observed for one member slot, in order. */
  phases(member: IMemberKey, slot: string): string[];
  /** Admission requests presented, in order. */
  readonly admissions: readonly Readonly<Record<string, unknown>>[];
  /** Ordinary work phases observed for a label. */
  ordinary(label: string): string[];
}

/** One scenario: a store, a world file and a caller key file in a fresh directory. */
export interface IScenario {
  readonly directory: string;
  readonly location: string;
  readonly world: string;
  /** Write the current external world. */
  writeWorld(world: IWorld): void;
  /**
   * Save fresh opaque request keys, as a caller does before starting work,
   * and return the file and keys.
   */
  saveKeys(label: string): { readonly file: string; readonly keys: Readonly<Record<IMemberKey, string>> };
  /** Spawn one independent worker process. */
  run(command: ICommand, options?: IRunOptions): IProcessRun;
  /** Open History's real authority on the store (read-only use), and close it after `inspect`. */
  inspect<T>(inspect: (history: IDurableHistory) => T): T;
  /** Remove the scenario directory. */
  remove(): void;
}

/** Options for one worker process. */
export interface IRunOptions {
  readonly variation?: IVariation;
  /** The caller key file for normal and recovery commands. */
  readonly keys?: string;
  readonly deny?: IJob['deny'];
  readonly throwAt?: IJob['throwAt'];
  /**
   * Kill the process at a History commit boundary. The run then returns only
   * if that kill was reached (see {@link judgePlannedKill}); otherwise it
   * throws {@link MissedPlannedKillError}.
   */
  readonly fault?: { readonly role: string; readonly occurrence: number; readonly when: 'before' | 'after' };
  readonly leaseMilliseconds?: number;
  /** Make this member's summary body throw in this process. */
  readonly failSummary?: IMemberKey;
  /** Request an operator stop when the run's observer sees this step position. */
  readonly stopAt?: IJob['stopAt'];
  /** Make the report command's presenter fail after every summary resolved. */
  readonly failPresenter?: boolean;
  /** A different store file (wrong-store checks). */
  readonly location?: string;
  readonly logicalStore?: string;
}

/** A planned kill at one History commit boundary, as a run requests it. */
export type IPlannedFault = NonNullable<IRunOptions['fault']>;

/** What the parent observed of one finished worker process. */
export interface IWorkerExit {
  /** Exit status, or null when terminated by a signal. */
  readonly status: number | null;
  /** Terminating signal, if any. */
  readonly signal: NodeJS.Signals | null;
  /** Every parsed stdout line, in order. */
  readonly lines: readonly Readonly<Record<string, unknown>>[];
  /** The worker's standard error. */
  readonly stderr: string;
}

/** Whether a worker process reached the kill its run planned. */
export type IPlannedKillJudgement =
  | { readonly kind: 'reached' }
  | { readonly kind: 'missed'; readonly diagnostic: string };

/** A planned fault in the words the instrumented host's trace uses, e.g. `after commit of publish #2`. */
function describeFault(fault: IPlannedFault): string {
  return `${fault.when} commit of ${fault.role} #${String(fault.occurrence)}`;
}

/** Whether a parsed line is the instrumented host's trace of exactly `plan`. */
function tracesFault(line: Readonly<Record<string, unknown>>, plan: IPlannedFault): boolean {
  return line['t'] === 'fault' && line['role'] === plan.role && line['occurrence'] === plan.occurrence && line['when'] === plan.when;
}

/** The worker's own error line, rendered as `name (code c): message`, or `none`. */
function describeWorkerError(lines: IWorkerExit['lines']): string {
  const error = lines.find((line) => line['t'] === 'error');
  if (error === undefined) {
    return 'none';
  }
  return `${String(error['name'])} (code ${String(error['code'])}): ${String(error['message'])}`;
}

/** At most this many trailing characters of a worker's stderr are quoted in a diagnostic. */
const stderrExcerptLength = 4_000;

/**
 * Judge whether a worker reached the kill its run planned. A planned kill is
 * reached only when the process was terminated by SIGKILL and its last
 * output line is the instrumented host's single fault trace for exactly the
 * requested role, occurrence and before/after boundary: the host writes that
 * line synchronously immediately before signalling itself, so nothing may
 * follow it. A SIGKILL without the trace (an external kill), with another
 * boundary's trace, or any ordinary exit is a miss. A miss carries a
 * diagnostic naming the requested fault, the exit status and signal, the
 * actual fault trace or its absence, the worker's genuine error and its
 * stderr, so a missed kill always names its observable cause.
 * @param plan - The fault the run requested.
 * @param exit - What the parent observed of the finished worker.
 * @returns Whether the planned kill was reached, with a diagnostic when it was not.
 */
export function judgePlannedKill(plan: IPlannedFault, exit: IWorkerExit): IPlannedKillJudgement {
  const faults = exit.lines.filter((line) => line['t'] === 'fault');
  const last = exit.lines.at(-1);
  if (exit.signal === 'SIGKILL' && faults.length === 1 && last !== undefined && tracesFault(last, plan)) {
    return { kind: 'reached' };
  }
  const stderr = exit.stderr.trim();
  const diagnostic = [
    `planned kill not reached: requested SIGKILL ${describeFault(plan)}`,
    `exit: status ${String(exit.status)}, signal ${String(exit.signal)}`,
    `fault trace: ${faults.length === 0 ? 'none' : faults.map((line) => JSON.stringify(line)).join(' ')}`,
    `worker error: ${describeWorkerError(exit.lines)}`,
    `stderr: ${stderr.length === 0 ? '(empty)' : stderr.slice(-stderrExcerptLength)}`,
  ].join('\n');
  return { kind: 'missed', diagnostic };
}

/**
 * A run that planned a kill whose worker did not die at that boundary. It is
 * a harness failure, never a process result: the process-level evidence the
 * run was meant to produce does not exist.
 */
export class MissedPlannedKillError extends Error {
  public override readonly name = 'MissedPlannedKillError';
}

/** Counter for opaque request keys. */
let keyCounter = 0;

/** Parse a worker's stdout into JSON lines. */
function parse(stdout: string): Readonly<Record<string, unknown>>[] {
  return stdout.split('\n').filter((line) => line.startsWith('{')).map((line) => {
    // Lines are written by the worker as JSON objects.
    return JSON.parse(line) as Readonly<Record<string, unknown>>;
  });
}

/** Create a scenario directory. */
export function scenario(): IScenario {
  const directory = mkdtempSync(join(tmpdir(), 'microdelta-m3-acceptance-'));
  const location = join(directory, 'history.sqlite');
  const world = join(directory, 'world.json');
  return {
    directory,
    location,
    world,
    writeWorld(next: IWorld): void {
      writeFileSync(world, `${JSON.stringify(next, null, 2)}\n`);
    },
    saveKeys(label: string) {
      keyCounter += 1;
      const keys = {
        'person:ada': `acceptance:${label}:${String(keyCounter)}:person:ada`,
        'person:ben': `acceptance:${label}:${String(keyCounter)}:person:ben`,
      };
      const file = join(directory, `keys-${label}-${String(keyCounter)}.json`);
      writeFileSync(file, `${JSON.stringify(keys)}\n`);
      return { file, keys };
    },
    run(command: ICommand, options: IRunOptions = {}): IProcessRun {
      const job: IJob = {
        location: options.location ?? location,
        logicalStore: options.logicalStore ?? logicalStore,
        environment,
        world,
        variation: options.variation ?? {},
        command,
        ...(options.keys === undefined ? {} : { requestKeys: options.keys }),
        ...(options.deny === undefined ? {} : { deny: options.deny }),
        ...(options.throwAt === undefined ? {} : { throwAt: options.throwAt }),
        ...(options.stopAt === undefined ? {} : { stopAt: options.stopAt }),
        ...(options.failPresenter === undefined ? {} : { failPresenter: options.failPresenter }),
        leaseMilliseconds: options.leaseMilliseconds ?? 60_000,
      };
      const env = { ...process.env };
      delete env['MICRODELTA_ACCEPTANCE_FAULT'];
      delete env['MICRODELTA_ACCEPTANCE_FAIL_SUMMARY'];
      if (options.failSummary !== undefined) {
        env['MICRODELTA_ACCEPTANCE_FAIL_SUMMARY'] = options.failSummary;
      }
      if (options.fault !== undefined) {
        env['MICRODELTA_ACCEPTANCE_FAULT'] = JSON.stringify(options.fault);
      }
      const spawned = spawnSync(process.execPath, ['--import', preload, worker, JSON.stringify(job)], { encoding: 'utf8', env, timeout: 60_000 });
      const lines = parse(spawned.stdout);
      const traces = lines.filter((line) => line['t'] === 'trace');
      const events = lines.filter((line) => line['t'] === 'event');
      if (options.fault !== undefined) {
        // A planned kill is evidence only when reached; otherwise fail here, with the worker's own account.
        const judgement = judgePlannedKill(options.fault, { status: spawned.status, signal: spawned.signal, lines, stderr: spawned.stderr });
        if (judgement.kind === 'missed') {
          throw new MissedPlannedKillError(judgement.diagnostic);
        }
      }
      if (spawned.status !== 0 && spawned.status !== 3 && spawned.signal !== 'SIGKILL') {
        throw new Error(`worker failed unexpectedly (${String(spawned.status)}/${String(spawned.signal)}): ${spawned.stderr}`);
      }
      return {
        status: spawned.status,
        signal: spawned.signal,
        lines,
        result: lines.find((line) => line['t'] === 'result'),
        error: lines.find((line) => line['t'] === 'error'),
        count: (helper, member) => traces.filter((line) => line['helper'] === helper && (member === undefined || line['key'] === member)).length,
        phases: (member, slot) => events.filter((line) => line['member'] === member && line['slot'] === slot).map((line) => String(line['phase'])),
        admissions: lines.filter((line) => line['t'] === 'admission'),
        ordinary: (label) => events.filter((line) => line['label'] === label).map((line) => String(line['phase'])),
      };
    },
    inspect<T>(inspect: (history: IDurableHistory) => T): T {
      const history = openHistory({ location, store: logicalStore, clock: createNodeClock() });
      try {
        return inspect(history);
      } finally {
        history.close();
      }
    },
    remove(): void {
      rmSync(directory, { recursive: true, force: true });
    },
  };
}

/** The scoped subject of a member's summary or activity, for History inspection. */
export function subjectOf(member: IMemberKey, slot: 'summary' | 'activity', version = 1): { readonly analysis: string; readonly environment: string; readonly subject: string; readonly version: number } {
  return { analysis: analysisScope, environment, subject: `${slot}:acme/widget:2026-Q1:${member}`, version };
}

/** The outcome description of one member from a report or resolve result. */
export function outcomeOf(run: IProcessRun, member?: IMemberKey): Readonly<Record<string, unknown>> {
  const result = run.result;
  if (result === undefined) {
    throw new Error(`the process produced no result: ${JSON.stringify(run.error ?? run.lines.at(-1))}`);
  }
  const outcome = member === undefined ? result['outcome'] : (result['outcomes'] as Readonly<Record<string, unknown>> | undefined)?.[member];
  if (typeof outcome !== 'object' || outcome === null) {
    throw new Error(`no outcome for ${String(member)}`);
  }
  return outcome as Readonly<Record<string, unknown>>;
}

/** The exact reference locator of an outcome. */
export function referenceOf(run: IProcessRun, member?: IMemberKey): string {
  const reference = outcomeOf(run, member)['reference'];
  if (typeof reference !== 'string') {
    throw new Error(`no exact reference for ${String(member)}: ${JSON.stringify(outcomeOf(run, member))}`);
  }
  return reference;
}
