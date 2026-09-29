/**
 * Separate-process strict-fold evidence (issue #86). Process A writes a real
 * SQLite History file through the facade's workspace; each later process is
 * a new Node process that recreates every declaration, callback and input,
 * registers helpers, steps and templates in reverse order, and discovers its
 * members in reverse order. Only durable History and the caller's world file
 * survive between processes. Every expected value is derived by hand from the
 * fixture data (Ada 5, Ben 3, Cy 2, Dee 4; Cy skipped at threshold 2) and the
 * owning contracts:
 *
 * - A failed or cancelled required member fails the fold at once, naming
 *   pending keys and open discovery; otherwise open discovery or a pending
 *   member leaves it waiting; neither runs the fold body, admits fold work or
 *   publishes (CMP-8, RUN-005, RUN-010, A-11).
 * - A successful fold, reused or published, carries framework coverage.
 * - Fold verification follows the membership-and-status fact and the member
 *   facts it consumed: a gate flip reruns the fold and the newly required
 *   member only, a threshold edit that flips nothing reruns nothing,
 *   insertion or deletion reruns the fold, and a member change reruns the fold
 *   only when a fact it consumed changed.
 * - A closed empty population is a successful fold; a later open empty
 *   population waits without rewinding it (RUN-004).
 *
 * @see ../../../../docs/spec/composition.md (CMP-8 and its EXP-4 strict-fold selection)
 * @see ../../../../docs/spec/operations.md (RUN-004, RUN-005, RUN-010)
 * @see ../../../../docs/spec/acceptance.md (A-11, TEST-2)
 * @see ../../../../docs/plans/m4-composition.md (planned evidence: strict-fold-readiness, strict-fold-coverage, closed-empty-population)
 */
import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { afterEach, describe, expect, test } from '@jest/globals';

import { cleanup } from '../durable-history/support.js';
import { contributors, createWorld, dee } from './fixture.js';
import type { IContributor, IVariation, IWorld } from './fixture.js';
import { candidates, foldCandidates, foldReference, logged, memberReference, readResult, summarySubject } from './support.js';
import type { IFoldRunReport } from './support.js';
import type { IFoldJob } from './worker.js';

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

/** Ada, Ben and Cy's designated keys, in canonical order. */
const baseKeys = ['person:ada', 'person:ben', 'person:cy'] as const;

/** One scenario: a store and a world file in a fresh directory. */
interface IScenario {
  /** The History file. */
  readonly location: string;
  /** Run one independent worker process over the store with `world`. */
  run(variation: IVariation, world: IWorld): IFoldRunReport;
}

/** Create a scenario. */
function scenario(): IScenario {
  const directory = mkdtempSync(join(tmpdir(), 'microdelta-fold-'));
  directories.push(directory);
  const location = join(directory, 'history.sqlite');
  const worldFile = join(directory, 'world.json');
  return {
    location,
    run(variation, world) {
      writeFileSync(worldFile, `${JSON.stringify(world)}\n`);
      const job: IFoldJob = { location, world: worldFile, variation };
      const spawned = spawnSync(process.execPath, [worker, JSON.stringify(job)], { encoding: 'utf8', timeout: 60_000 });
      if (spawned.status !== 0) {
        throw new Error(`worker failed (${String(spawned.status)}/${String(spawned.signal)}): ${spawned.stderr}`);
      }
      const line = spawned.stdout.split('\n').find((text) => text.startsWith('{'));
      if (line === undefined) {
        throw new Error(`worker wrote no result: ${spawned.stdout} ${spawned.stderr}`);
      }
      // The worker writes exactly one IFoldRunReport line.
      return JSON.parse(line) as IFoldRunReport;
    },
  };
}

/** A later process's world: the given members discovered in reverse order; discovery must check again. */
function reversedWorld(members: readonly IContributor[], status: 'complete' | 'open' = 'complete'): IWorld {
  const world = createWorld([...members].reverse(), status);
  world.discoveryFinal = false;
  return world;
}

/** A later process's registration order. */
const reversed: IVariation = { order: 'reversed' };

/** No member or fold body ran in a process. */
function expectNoBodies(report: IFoldRunReport): void {
  expect(logged(report, 'summary')).toEqual([]);
  expect(logged(report, 'report')).toEqual([]);
}

/** The fold body never ran, no fold work was admitted and the fold has no lifecycle at all. */
function expectNoFoldWork(report: IFoldRunReport): void {
  expect(logged(report, 'report')).toEqual([]);
  expect(report.admissions.filter((entry) => entry.startsWith('fold:'))).toEqual([]);
  expect(report.events.filter((entry) => entry.startsWith('report/'))).toEqual([]);
}

describe('strict-fold-coverage', () => {
  test('cold, then an unchanged restart: zero member and report bodies, the exact fold reference and its coverage', () => {
    const store = scenario();
    const a = store.run({ minimumAuthored: 2 }, createWorld());
    const coverage = { required: ['person:ada', 'person:ben'], skipped: ['person:cy'], closed: true };
    expect(a.fold).toEqual({ status: 'succeeded', kind: 'published', reference: expect.any(String), misses: [], coverage });
    expect(logged(a, 'summary')).toEqual(['ada', 'ben']);
    expect(logged(a, 'report')).toEqual(['person:ada=succeeded,person:ben=succeeded,person:cy=skipped']);

    const b = store.run({ ...reversed, minimumAuthored: 2 }, reversedWorld(contributors()));
    expectNoBodies(b);
    expect(b.fold).toEqual({
      status: 'succeeded',
      kind: 'reused',
      reference: foldReference(a),
      misses: [],
      coverage,
      accepted: [memberReference(a, 'person:ada'), memberReference(a, 'person:ben')],
    });
    expect(readResult(store.location, foldReference(b))).toEqual({ lines: ['person:ada 5', 'person:ben 3', 'person:cy excluded by the gate'], total: 8 });
  });
});

describe('strict-fold-readiness', () => {
  test('A-11 mix: the ready sibling publishes while the fold fails with its keys; the repair reruns the fold and only unfinished members', () => {
    const store = scenario();
    const mixed = createWorld([...contributors(), dee()], 'open');
    mixed.failSummary = ['cy'];
    mixed.decisions = { 'person:ben': 'denied', 'person:dee': 'cancelled' };
    const a = store.run({}, mixed);
    expect(a.fold).toEqual({ status: 'failed', failed: ['person:cy'], cancelled: ['person:dee'], pending: ['person:ben'], openDiscovery: true, diagnostic: expect.any(String) });
    expect(a.members['person:ada']).toMatchObject({ status: 'succeeded', kind: 'published' });
    expect(logged(a, 'summary')).toEqual(['ada', 'cy']);
    expectNoFoldWork(a);
    expect(foldCandidates(store.location)).toEqual([]);

    const b = store.run(reversed, reversedWorld([...contributors(), dee()]));
    expect(b.members['person:ada']).toEqual({ status: 'succeeded', kind: 'reused', reference: memberReference(a, 'person:ada') });
    expect([...logged(b, 'summary')].sort()).toEqual(['ben', 'cy', 'dee']);
    expect(logged(b, 'report')).toEqual(['person:ada=succeeded,person:ben=succeeded,person:cy=succeeded,person:dee=succeeded']);
    expect(b.fold).toMatchObject({ status: 'succeeded', kind: 'published', coverage: { required: [...baseKeys, 'person:dee'], skipped: [], closed: true } });
    expect(readResult(store.location, foldReference(b))).toEqual({ lines: ['person:ada 5', 'person:ben 3', 'person:cy 2', 'person:dee 4'], total: 14 });

    const c = store.run({}, reversedWorld([...contributors(), dee()]));
    expectNoBodies(c);
    expect(c.fold).toMatchObject({ status: 'succeeded', kind: 'reused', reference: foldReference(b) });
  });

  test('a pending member leaves the fold waiting; once admitted in a later process only that member and the fold run', () => {
    const store = scenario();
    const waiting = createWorld();
    waiting.decisions = { 'person:ben': 'denied' };
    const a = store.run({}, waiting);
    expect(a.fold).toEqual({ status: 'waiting', pending: ['person:ben'], openDiscovery: false });
    expectNoFoldWork(a);

    const b = store.run(reversed, reversedWorld(contributors()));
    expect(logged(b, 'summary')).toEqual(['ben']);
    expect(logged(b, 'report')).toHaveLength(1);
    expect(b.fold).toMatchObject({ status: 'succeeded', kind: 'published', coverage: { required: [...baseKeys], skipped: [], closed: true } });
    for (const key of ['person:ada', 'person:cy']) {
      expect(b.members[key]).toEqual({ status: 'succeeded', kind: 'reused', reference: memberReference(a, key) });
    }
  });

  test('open discovery waits in process A; closing it in process B runs only the fold', () => {
    const store = scenario();
    const a = store.run({}, createWorld(contributors(), 'open'));
    expect(a.fold).toEqual({ status: 'waiting', pending: [], openDiscovery: true });
    expect(logged(a, 'summary')).toEqual(['ada', 'ben', 'cy']);
    expectNoFoldWork(a);

    const b = store.run(reversed, reversedWorld(contributors()));
    expect(logged(b, 'summary')).toEqual([]);
    expect(logged(b, 'report')).toHaveLength(1);
    expect(b.fold).toMatchObject({ status: 'succeeded', kind: 'published' });
  });
});

describe('fold verification across processes', () => {
  test('a gate flip reruns the fold and only the newly required member; a flip-free threshold reruns nothing; a flip off never retracts', () => {
    const store = scenario();
    const a = store.run({ minimumAuthored: 2 }, createWorld());

    const on = store.run({ ...reversed, minimumAuthored: 1 }, reversedWorld(contributors()));
    expect(logged(on, 'summary')).toEqual(['cy']);
    expect(logged(on, 'report')).toHaveLength(1);
    expect(on.fold).toMatchObject({ status: 'succeeded', kind: 'published', misses: ['changed-membership'], coverage: { required: [...baseKeys], skipped: [] } });
    const cy = memberReference(on, 'person:cy');

    const flipFree = store.run({ ...reversed, minimumAuthored: 0 }, reversedWorld(contributors()));
    expectNoBodies(flipFree);
    expect(flipFree.fold).toMatchObject({ status: 'succeeded', kind: 'reused', reference: foldReference(on) });

    // Flipping Cy off again restores process A's membership fact: the latest
    // fold candidate misses on membership and A's exact fold result validates.
    const off = store.run({ ...reversed, minimumAuthored: 2 }, reversedWorld(contributors()));
    expectNoBodies(off);
    expect(off.fold).toMatchObject({
      status: 'succeeded',
      kind: 'reused',
      reference: foldReference(a),
      misses: ['changed-membership'],
      coverage: { required: ['person:ada', 'person:ben'], skipped: ['person:cy'], closed: true },
    });
    expect(readResult(store.location, cy)).toEqual({ label: '@cy', score: 2 });
    expect(candidates(store.location, summarySubject('person:cy'))).toEqual([cy]);
  });

  test('insertion and deletion rerun the fold; reordering reruns nothing; a deleted member is never retracted', () => {
    const store = scenario();
    const a = store.run({}, createWorld());
    const cy = memberReference(a, 'person:cy');

    const inserted = store.run(reversed, reversedWorld([...contributors(), dee()]));
    expect(logged(inserted, 'summary')).toEqual(['dee']);
    expect(logged(inserted, 'report')).toHaveLength(1);
    expect(inserted.fold).toMatchObject({ status: 'succeeded', kind: 'published', misses: ['changed-membership'] });

    const survivors = [...contributors(), dee()].filter((member) => member.key !== 'person:cy');
    const deleted = store.run(reversed, reversedWorld(survivors));
    expect(logged(deleted, 'summary')).toEqual([]);
    expect(logged(deleted, 'report')).toEqual(['person:ada=succeeded,person:ben=succeeded,person:dee=succeeded']);
    // Both earlier fold results (the inserted and the cold population) miss on membership.
    expect(deleted.fold).toMatchObject({ status: 'succeeded', kind: 'published', misses: ['changed-membership', 'changed-membership'] });
    expect(readResult(store.location, cy)).toEqual({ label: '@cy', score: 2 });
    expect(candidates(store.location, summarySubject('person:cy'))).toEqual([cy]);

    const reordered = store.run({}, reversedWorld([...survivors].reverse()));
    expectNoBodies(reordered);
    expect(reordered.fold).toMatchObject({ status: 'succeeded', kind: 'reused', reference: foldReference(deleted) });
  });

  test('a consumed member field reruns that member, and the fold only when a fact it consumed changed', () => {
    const store = scenario();
    const a = store.run({}, createWorld());
    const change = (patch: Partial<IContributor>): IContributor[] => contributors().map((member) => member.key === 'person:ben' ? { ...member, ...patch } : member);

    const relabelled = store.run(reversed, reversedWorld(change({ login: 'benjamin' })));
    expect(logged(relabelled, 'summary')).toEqual(['benjamin']);
    expect(logged(relabelled, 'report')).toEqual([]);
    expect(relabelled.fold).toMatchObject({ status: 'succeeded', kind: 'reused', reference: foldReference(a) });

    const rescored = store.run(reversed, reversedWorld(change({ login: 'benjamin', score: 7 })));
    expect(logged(rescored, 'summary')).toEqual(['benjamin']);
    expect(logged(rescored, 'report')).toHaveLength(1);
    expect(rescored.fold).toMatchObject({ status: 'succeeded', kind: 'published', misses: ['changed-member-output'] });
    expect(readResult(store.location, foldReference(rescored))).toEqual({ lines: ['person:ada 5', 'person:ben 7', 'person:cy 2'], total: 14 });
  });
});

describe('closed-empty-population', () => {
  test('a closed empty population is a complete fold distinct from open discovery, and open discovery never rewinds it', () => {
    const store = scenario();
    const a = store.run({}, createWorld([], 'complete'));
    expect(a.fold).toEqual({ status: 'succeeded', kind: 'published', reference: expect.any(String), misses: [], coverage: { required: [], skipped: [], closed: true } });
    expect(readResult(store.location, foldReference(a))).toEqual({ lines: [], total: 0 });

    const b = store.run(reversed, reversedWorld([], 'open'));
    expect(b.discovery).toEqual({ kind: 'keyed', completion: 'open', keys: [] });
    expect(b.fold).toEqual({ status: 'waiting', pending: [], openDiscovery: true });
    expectNoFoldWork(b);
    expect(foldCandidates(store.location)).toEqual([foldReference(a)]);

    const c = store.run({}, reversedWorld([], 'complete'));
    expect(c.fold).toMatchObject({ status: 'succeeded', kind: 'reused', reference: foldReference(a), coverage: { required: [], skipped: [], closed: true } });
    expect(logged(c, 'report')).toEqual([]);
  });
});
