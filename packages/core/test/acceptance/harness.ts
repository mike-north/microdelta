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
  /** Kill the process at a History commit boundary. */
  readonly fault?: { readonly role: string; readonly occurrence: number; readonly when: 'before' | 'after' };
  readonly leaseMilliseconds?: number;
  /** A different store file (wrong-store checks). */
  readonly location?: string;
  readonly logicalStore?: string;
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
        leaseMilliseconds: options.leaseMilliseconds ?? 60_000,
      };
      const env = { ...process.env };
      delete env['MICRODELTA_ACCEPTANCE_FAULT'];
      if (options.fault !== undefined) {
        env['MICRODELTA_ACCEPTANCE_FAULT'] = JSON.stringify(options.fault);
      }
      const spawned = spawnSync(process.execPath, ['--import', preload, worker, JSON.stringify(job)], { encoding: 'utf8', env, timeout: 60_000 });
      const lines = parse(spawned.stdout);
      const traces = lines.filter((line) => line['t'] === 'trace');
      const events = lines.filter((line) => line['t'] === 'event');
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
