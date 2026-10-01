/**
 * Separate-process outcome-fold evidence (issue #120, planned evidence
 * `outcome-fold-coverage`). Process A writes a real SQLite History file
 * through the facade's workspace; each later process is a new Node process
 * that recreates every declaration, callback and input, registers helpers,
 * steps and templates in reverse order, and discovers its members in reverse
 * order. Only durable History and the caller's world file survive between
 * processes. Definition declares the outcome fold; Resolution settles every
 * member and resolves the fold; Supervision reports it. Every expected value
 * is derived by hand from the fixture data (Ada 5, Ben 3, Cy 2) and the
 * owning contract (RUN-010):
 *
 * - One failed, one pending and one successful member with discovery open:
 *   the outcome fold waits with partial coverage, claims no complete set,
 *   runs no body and publishes nothing.
 * - Once discovery closes and every member has settled, the fold runs over
 *   every settled status, failure included, with complete coverage.
 * - Repairing the failed member makes the fold reconsider; unaffected member
 *   bodies stay unexecuted. An unchanged set is reused without any body.
 * - The strict fold over the same members fails while a member fails, and
 *   neither fold's result is the other's.
 *
 * @see ../../../../docs/spec/operations.md (RUN-004, RUN-005, RUN-010)
 * @see ../../../../docs/spec/acceptance.md (A-11, TEST-2)
 * @see ../../../../docs/plans/m5-operations.md (outcome-fold-coverage)
 */
import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { afterEach, describe, expect, test } from '@jest/globals';

import { cleanup } from '../durable-history/support.js';
import { contributors, createWorld } from './fixture.js';
import type { IWorld } from './fixture.js';
import { logged, memberReference, readResult, reportCandidates, tallyCandidates, tallyReference } from './support.js';
import type { ICoverageJson, ITallyRunReport } from './support.js';
import type { ITallyJob } from './worker.js';

afterEach(cleanup);

/** The worker entry point, emitted beside this module. */
const worker = fileURLToPath(new URL('./worker.js', import.meta.url));

/** Scenario directories created by this suite, removed after each test. */
const directories: string[] = [];
afterEach(() => {
  for (const directory of directories.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
  }
});

/** One scenario: a store and a world file in a fresh directory. */
interface IScenario {
  /** The History file. */
  readonly location: string;
  /** Run one independent worker process over the store with `world`. */
  run(options: ITallyJob['options'], world: IWorld): ITallyRunReport;
}

/** Create a scenario. */
function scenario(): IScenario {
  const directory = mkdtempSync(join(tmpdir(), 'microdelta-outcome-fold-'));
  directories.push(directory);
  const location = join(directory, 'history.sqlite');
  const worldFile = join(directory, 'world.json');
  return {
    location,
    run(options, world) {
      writeFileSync(worldFile, `${JSON.stringify(world)}\n`);
      const job: ITallyJob = { location, world: worldFile, options };
      const spawned = spawnSync(process.execPath, [worker, JSON.stringify(job)], { encoding: 'utf8', timeout: 60_000 });
      if (spawned.status !== 0) {
        throw new Error(`worker failed (${String(spawned.status)}/${String(spawned.signal)}): ${spawned.stderr}`);
      }
      const line = spawned.stdout.split('\n').find((text) => text.startsWith('{'));
      if (line === undefined) {
        throw new Error(`worker wrote no result: ${spawned.stdout} ${spawned.stderr}`);
      }
      // The worker writes exactly one ITallyRunReport line.
      return JSON.parse(line) as ITallyRunReport;
    },
  };
}

/** A later process's world: Ada, Ben and Cy discovered in reverse order, discovery checked again. */
function rediscovered(change: (world: IWorld) => void = () => undefined, status: 'complete' | 'open' = 'complete'): IWorld {
  const world = createWorld([...contributors()].reverse(), status);
  world.discoveryFinal = false;
  change(world);
  return world;
}

/** Coverage with every list empty unless given; complete only when stated. */
function coverage(fields: Partial<ICoverageJson>): ICoverageJson {
  return { succeeded: [], skipped: [], failed: [], cancelled: [], pending: [], openDiscovery: false, complete: false, ...fields };
}

describe('outcome-fold-coverage', () => {
  test('A-11 across processes: waits while unsettled, folds the failure once settled, reconsiders on repair, then reuses', () => {
    const s = scenario();

    // Process A: Cy fails, Ben is denied and discovery is open.
    const a = s.run({}, (() => {
      const world = createWorld(contributors(), 'open');
      world.failSummary = ['cy'];
      world.decisions = { 'person:ben': 'denied' };
      return world;
    })());
    expect(a.members).toEqual({
      'person:ada': { status: 'succeeded', kind: 'published', reference: expect.any(String) },
      'person:ben': { status: 'pending' },
      'person:cy': { status: 'failed', code: 'execution-failure' },
    });
    expect(a.tally).toEqual({ status: 'waiting', coverage: coverage({ succeeded: ['person:ada'], failed: ['person:cy'], pending: ['person:ben'], openDiscovery: true }) });
    expect(logged(a, 'tally')).toEqual([]);
    expect(a.admissions.filter((entry) => entry.startsWith('outcome-fold:'))).toEqual([]);
    expect(tallyCandidates(s.location)).toEqual([]);

    // Process B: discovery closes and Ben is admitted; Cy still fails. Every member has settled.
    const b = s.run({ order: 'reversed', strict: true }, rediscovered((world) => {
      world.failSummary = ['cy'];
    }));
    // Cy's failure is retried by each request (the outcome fold's, then the strict fold's); a failure is never a reusable result.
    expect(logged(b, 'summary')).toEqual(['ben', 'cy', 'cy']);
    expect(b.members['person:ada']).toEqual({ status: 'succeeded', kind: 'reused', reference: memberReference(a, 'person:ada') });
    expect(logged(b, 'tally')).toEqual(['person:ada=succeeded,person:ben=succeeded,person:cy=failed']);
    expect(b.tally).toEqual({ status: 'folded', kind: 'published', reference: expect.any(String), misses: [], coverage: coverage({ succeeded: ['person:ada', 'person:ben'], failed: ['person:cy'], complete: true }) });
    expect(readResult(s.location, tallyReference(b))).toEqual({ succeeded: 2, skipped: 0, failed: 1, cancelled: 0, total: 8 });
    // The strict fold over the same members fails and publishes nothing.
    expect(b.report).toEqual({ status: 'failed' });
    expect(reportCandidates(s.location)).toEqual([]);

    // Process C: Cy is repaired. Only Cy's summary and the outcome fold run.
    const c = s.run({ order: 'reversed' }, rediscovered());
    expect(logged(c, 'summary')).toEqual(['cy']);
    expect(logged(c, 'tally')).toEqual(['person:ada=succeeded,person:ben=succeeded,person:cy=succeeded']);
    expect(c.tally).toEqual({
      status: 'folded',
      kind: 'published',
      reference: expect.any(String),
      misses: ['changed-membership'],
      coverage: coverage({ succeeded: ['person:ada', 'person:ben', 'person:cy'], complete: true }),
    });
    expect(readResult(s.location, tallyReference(c))).toEqual({ succeeded: 3, skipped: 0, failed: 0, cancelled: 0, total: 10 });
    expect(tallyCandidates(s.location)).toEqual([tallyReference(c), tallyReference(b)]);

    // Process D: nothing changed. Neither member bodies nor the fold run.
    const d = s.run({ order: 'reversed', strict: true }, rediscovered());
    expect(logged(d, 'summary')).toEqual([]);
    expect(logged(d, 'tally')).toEqual([]);
    expect(d.tally).toMatchObject({ status: 'folded', kind: 'reused', reference: tallyReference(c), misses: [] });
    // Now the strict fold completes too, with a result of its own.
    expect(d.report).toEqual({ status: 'succeeded', reference: expect.any(String) });
    expect(d.report?.reference).not.toBe(tallyReference(c));
  });
});
