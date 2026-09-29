/**
 * Parent-side support for the M4 independent-process acceptance suite. A
 * scenario owns one temporary directory holding the shared SQLite History
 * file and the external world file. Each step writes the world and spawns a
 * fresh worker process (`worker.ts`) that imports the *built* `microdelta`
 * facade and rebuilds declarations, helpers and inputs from scratch; nothing
 * survives between steps except durable History and the world file. The
 * parent inspects durable state through History's real authority on the same
 * file, never through a cache.
 *
 * This follows the M3 acceptance harness (`../acceptance/harness.ts`) without
 * its instrumented host: M4's obligations are about composition, reuse and
 * readiness, not commit-boundary kills, so the worker runs over the
 * unmodified Node Machine.
 *
 * @see ../../../../docs/plans/m4-composition.md (Planned evidence names)
 * @see ../../../../docs/spec/acceptance.md (TEST-2)
 */
import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { openHistory } from '../durable-history/support.js';
import { analysisScope } from './analysis.js';
import type { IVariation, IWorld, IWorldProfile, IWorldPullRequest, IWorldReview } from './analysis.js';
import type { IJob, IMemberJson, IResultJson } from './worker.js';

/** The logical store every M4 acceptance scenario uses. */
export const logicalStore = 'store:m4-acceptance';

/** The environment every M4 acceptance run selects. */
export const environment = 'env:m4-acceptance';

/** The worker entry point, as emitted beside this module. */
const worker = fileURLToPath(new URL('./worker.js', import.meta.url));

/** Upstream profiles of acme/widget: Ada, Ben, Cy and Dot (Dot is never active in the window). */
export function baseProfiles(): IWorldProfile[] {
  return [
    { key: 'person:ada', id: 'gh:1001', name: 'Ada', avatarUrl: 'https://avatars.example/ada.png' },
    { key: 'person:ben', id: 'gh:2002', name: 'Ben', avatarUrl: 'https://avatars.example/ben.png' },
    { key: 'person:cy', id: 'gh:3003', name: 'Cy', avatarUrl: 'https://avatars.example/cy.png' },
    { key: 'person:dot', id: 'gh:4004', name: 'Dot', avatarUrl: 'https://avatars.example/dot.png' },
  ];
}

/** The contribution example's pull requests, authored by upstream account id, including records the window excludes. */
export function basePullRequests(): IWorldPullRequest[] {
  return [
    { number: 99, author: 'gh:4004', createdAt: '2025-11-20T15:00:00Z', merged: true, labels: ['docs'] },
    { number: 98, author: 'gh:1001', createdAt: '2025-12-18T09:00:00Z', merged: true, labels: ['chore'] },
    { number: 101, author: 'gh:1001', createdAt: '2026-01-12T10:30:00Z', merged: true, labels: ['feature'] },
    { number: 102, author: 'gh:1001', createdAt: '2026-02-03T16:05:00Z', merged: true, labels: ['docs'] },
    { number: 103, author: 'gh:1001', createdAt: '2026-03-20T08:45:00Z', merged: false, labels: [] },
    { number: 201, author: 'gh:2002', createdAt: '2026-01-25T13:00:00Z', merged: true, labels: ['bug'] },
    { number: 202, author: 'gh:2002', createdAt: '2026-03-02T11:20:00Z', merged: false, labels: [] },
    { number: 204, author: 'gh:2002', createdAt: '2026-04-01T00:00:00Z', merged: true, labels: ['bug'] },
    { number: 301, author: 'gh:3003', createdAt: '2026-02-14T12:00:00Z', merged: true, labels: [] },
  ];
}

/** The contribution example's reviews, by upstream account id, including out-of-window and pending ones. */
export function baseReviews(): IWorldReview[] {
  return [
    { id: 'rv-ada-0', author: 'gh:1001', submittedAt: '2025-12-30T10:00:00Z', state: 'submitted' },
    { id: 'rv-ada-1', author: 'gh:1001', submittedAt: '2026-01-26T09:00:00Z', state: 'submitted' },
    { id: 'rv-ada-2', author: 'gh:1001', submittedAt: '2026-03-03T15:00:00Z', state: 'submitted' },
    { id: 'rv-ada-3', author: 'gh:1001', submittedAt: '2026-02-15T10:10:00Z', state: 'submitted' },
    { id: 'rv-ada-4', author: 'gh:1001', submittedAt: '2026-03-05T17:30:00Z', state: 'submitted' },
    { id: 'rv-ada-5', author: 'gh:1001', submittedAt: '2026-01-27T08:00:00Z', state: 'submitted' },
    { id: 'rv-ada-6', author: 'gh:1001', submittedAt: '2026-03-31T23:00:00Z', state: 'pending' },
    { id: 'rv-ben-1', author: 'gh:2002', submittedAt: '2026-01-13T11:00:00Z', state: 'submitted' },
    { id: 'rv-ben-2', author: 'gh:2002', submittedAt: '2026-02-04T09:30:00Z', state: 'submitted' },
    { id: 'rv-ben-3', author: 'gh:2002', submittedAt: '2026-03-21T14:00:00Z', state: 'submitted' },
    { id: 'rv-ben-4', author: 'gh:2002', submittedAt: '2026-04-02T10:00:00Z', state: 'submitted' },
    { id: 'rv-cy-1', author: 'gh:3003', submittedAt: '2026-01-14T10:00:00Z', state: 'submitted' },
    { id: 'rv-dot-1', author: 'gh:4004', submittedAt: '2026-02-04T12:00:00Z', state: 'pending' },
    { id: 'rv-dot-2', author: 'gh:4004', submittedAt: '2026-04-05T09:00:00Z', state: 'submitted' },
  ];
}

/**
 * The base acme/widget Q1 world: a complete listing at revision 1, every
 * previous activity final, no injected failure and every request admitted.
 * Expected values are derived by hand in `expected.ts`, not from this function.
 */
export function baseWorld(changes: Partial<IWorld> = {}): IWorld {
  return {
    repository: 'acme/widget',
    revision: 1,
    listing: 'complete',
    activityFinal: true,
    profiles: baseProfiles(),
    pullRequests: basePullRequests(),
    reviews: baseReviews(),
    failSummary: [],
    decisions: {},
    ...changes,
  };
}

/**
 * A later process's world: the same upstream content listed in reverse
 * profile order. The listing order reaches a run only when discovery's policy
 * lists again (a changed revision or status); the unchanged revision here
 * keeps the previous listing final.
 */
export function reversedWorld(world: IWorld): IWorld {
  return { ...world, profiles: [...world.profiles].reverse() };
}

/** One parsed worker process. */
export interface IProcessRun {
  /** The final result line; a process that failed outright throws when this is read. */
  readonly result: IResultJson;
  /** Author helper traces of one kind, in order: activity keys, assessed `<PR number>/<rubric>`, summary names, report entry lists, or one entry per discovery. */
  bodies(helper: 'discover' | 'activity' | 'assess' | 'summary' | 'report'): string[];
  /** Framework lifecycle phases of one step (`member` null for composition-level and supplied steps), in order. */
  phases(slot: string, member: string | null): string[];
  /** Every admission request, in order, as `<kind>:<subject>`. */
  readonly admissions: readonly string[];
  /** One member's typed outcome, failing clearly when absent. */
  member(key: string): IMemberJson;
  /** A succeeded member's exact summary reference. */
  reference(key: string): string;
  /** The succeeded fold's exact reference. */
  readonly foldReference: string;
}

/** One scenario: a store and a world file in a fresh directory. */
export interface IScenario {
  readonly location: string;
  /** Write `world` and run one independent worker process under `variation`. */
  run(variation: IVariation, world: IWorld, options?: { readonly check?: readonly string[] }): IProcessRun;
  /** Exact candidate locators of one scoped subject, latest publication first, read through History's real authority. */
  candidates(subject: string): readonly string[];
  /** The stored data of one exact reference, read through History's exact reader. */
  read(locator: string): unknown;
  /** The exact dependencies one completed result recorded when it was published: its original provenance. */
  dependencies(locator: string): readonly string[];
  /** Remove the scenario directory. */
  remove(): void;
}

/** Parse a worker's stdout into JSON lines. */
function parse(stdout: string): Readonly<Record<string, unknown>>[] {
  return stdout.split('\n').filter((line) => line.startsWith('{')).map((line) => {
    // Lines are written by the worker as JSON objects.
    return JSON.parse(line) as Readonly<Record<string, unknown>>;
  });
}

/** The detail a trace line contributes for its helper. */
function traceDetail(line: Readonly<Record<string, unknown>>): string {
  switch (line['helper']) {
    case 'activity':
      return String(line['key']);
    case 'assess':
      return `${String(line['number'])}/${String(line['rubric'])}`;
    case 'summary':
      return String(line['name']);
    case 'report':
      return Array.isArray(line['entries']) ? line['entries'].map(String).join(',') : '';
    default:
      return String(line['helper']);
  }
}

/** The worker's final result line, parsed as the IResultJson it was written from. */
function parseResult(stdout: string): IResultJson | undefined {
  const text = stdout.split('\n').find((line) => line.startsWith('{"t":"result"'));
  // The worker writes its result line from an IResultJson value.
  return text === undefined ? undefined : JSON.parse(text) as IResultJson;
}

/** Build the parsed view of one finished worker. */
function processRun(stdout: string, stderr: string): IProcessRun {
  const lines = parse(stdout);
  const resultLine = parseResult(stdout);
  const errorLine = lines.find((line) => line['t'] === 'error');
  const result = (): IResultJson => {
    if (resultLine === undefined) {
      throw new Error(`the process produced no result: ${JSON.stringify(errorLine)} ${stderr}`);
    }
    return resultLine;
  };
  const member = (key: string): IMemberJson => {
    const found = result().members[key];
    if (found === undefined) {
      throw new Error(`no outcome for member ${key}: ${JSON.stringify(result().members)}`);
    }
    return found;
  };
  return {
    get result() {
      return result();
    },
    bodies: (helper) => lines.filter((line) => line['t'] === 'trace' && line['helper'] === helper).map(traceDetail),
    phases: (slot, key) => lines.filter((line) => line['t'] === 'event' && line['slot'] === slot && line['member'] === key).map((line) => String(line['phase'])),
    admissions: lines.filter((line) => line['t'] === 'admission').map((line) => `${String(line['kind'])}:${String(line['subject'])}`),
    member,
    reference(key) {
      const reference = member(key).reference;
      if (reference === undefined) {
        throw new Error(`expected ${key} to have succeeded, observed ${JSON.stringify(member(key))}`);
      }
      return reference;
    },
    get foldReference() {
      const fold = result().fold;
      if (fold.status !== 'succeeded') {
        throw new Error(`expected a succeeded fold, observed ${JSON.stringify(fold)}`);
      }
      return fold.reference;
    },
  };
}

/** Create a scenario directory. */
export function scenario(): IScenario {
  const directory = mkdtempSync(join(tmpdir(), 'microdelta-m4-acceptance-'));
  const location = join(directory, 'history.sqlite');
  const worldFile = join(directory, 'world.json');
  return {
    location,
    run(variation, world, options = {}) {
      writeFileSync(worldFile, `${JSON.stringify(world, null, 2)}\n`);
      const job: IJob = { location, logicalStore, environment, world: worldFile, variation, ...(options.check === undefined ? {} : { check: options.check }) };
      const spawned = spawnSync(process.execPath, [worker, JSON.stringify(job)], { encoding: 'utf8', timeout: 60_000 });
      if (spawned.status !== 0) {
        throw new Error(`worker failed (${String(spawned.status)}/${String(spawned.signal)}): ${spawned.stdout.split('\n').filter((line) => line.includes('"t":"error"')).join(' ')} ${spawned.stderr}`);
      }
      return processRun(spawned.stdout, spawned.stderr);
    },
    candidates(subject) {
      const history = openHistory({ location, store: logicalStore });
      try {
        return history.findCandidates({ analysis: analysisScope, environment, subject, version: 1 }).map((candidate) => candidate.reference.locator);
      } finally {
        history.close();
      }
    },
    read(locator) {
      const history = openHistory({ location, store: logicalStore });
      try {
        return history.reader.readSubtree({ kind: 'completed-result', locator }, []);
      } finally {
        history.close();
      }
    },
    dependencies(locator) {
      const history = openHistory({ location, store: logicalStore });
      try {
        return history.readEnvelope({ kind: 'completed-result', locator }).dependencies.map((dependency) => dependency.locator);
      } finally {
        history.close();
      }
    },
    remove(): void {
      rmSync(directory, { recursive: true, force: true });
    },
  };
}
