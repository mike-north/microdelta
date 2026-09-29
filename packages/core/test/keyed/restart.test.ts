/**
 * Separate-process keyed member reuse (issue #85). Process A writes a real
 * SQLite History file through the facade's workspace; each later process is a
 * new Node process that recreates every declaration, callback and input,
 * registers helpers, steps, templates and supplies in reverse order, and
 * discovers its members in reverse order. Only durable History and the
 * caller's world file survive between processes. Every expected value is
 * derived by hand from the fixture data and the owning contracts:
 *
 * - Insert runs only the new member; delete and reorder run no remaining
 *   member body; a changed unread discovery field runs nothing; a changed
 *   member field reruns only the member steps that consumed it, whether read
 *   through the member binding or forwarded to a supplied step (A-07, COL-3,
 *   COL-4).
 * - A custom key keeps correspondence across renumbered designated ids; the
 *   designated key makes renumbered members new instances (COL-1).
 * - A duplicate or missing key rejects the snapshot with a diagnostic naming
 *   the collection, key and custom-key option, and admits no gate or member
 *   work (COL-1, EXP-4 template selection).
 * - A builder array mutated after composition changes nothing; a
 *   result-created operation is rejected before any admission; a gate
 *   threshold change changes instances only (A-08, CMP-1, CMP-8, CMP-9).
 *
 * @see ../../../../docs/spec/tracking.md (COL-1, COL-3, COL-4)
 * @see ../../../../docs/spec/composition.md (CMP-1, CMP-4, CMP-8, CMP-9)
 * @see ../../../../docs/spec/acceptance.md (A-07, A-08, TEST-2)
 * @see ../../../../docs/plans/m4-composition.md (planned evidence: keyed-cold-and-restarted-report, discovery-insert-delete-reorder, duplicate-and-missing-identity, custom-key-correspondence, frozen-template-topology, tracked-gate-instances)
 */
import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { afterEach, describe, expect, test } from '@jest/globals';

import { cleanup, openHistory } from '../durable-history/support.js';
import { analysis, contributors, createWorld, dee } from './fixture.js';
import type { IContributor, IVariation, IWorld } from './fixture.js';
import { environment, logged, logicalStore, referenceOf } from './support.js';
import type { IKeyedReport } from './support.js';
import type { IKeyedJob } from './worker.js';

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

/** The designated member keys of Ada, Ben and Cy, in canonical order. */
const baseKeys = ['person:ada', 'person:ben', 'person:cy'] as const;

/** The summary instance subject of one member key. */
function summarySubject(key: string): string {
  return `summary:acme/widget:2026-Q1:${key}`;
}

/** One scenario: a store and a world file in a fresh directory. */
interface IScenario {
  /** Run one independent worker process over the store with `world`. */
  run(variation: IVariation, world: IWorld): IKeyedReport;
  /** Exact candidate locators of one scoped subject, latest publication first, read through History's real authority. */
  candidates(subject: string): readonly string[];
}

/** Create a scenario. */
function scenario(): IScenario {
  const directory = mkdtempSync(join(tmpdir(), 'microdelta-keyed-'));
  directories.push(directory);
  const location = join(directory, 'history.sqlite');
  const worldFile = join(directory, 'world.json');
  return {
    run(variation, world) {
      writeFileSync(worldFile, `${JSON.stringify(world)}\n`);
      const job: IKeyedJob = { location, world: worldFile, variation };
      const spawned = spawnSync(process.execPath, [worker, JSON.stringify(job)], { encoding: 'utf8', timeout: 60_000 });
      if (spawned.status !== 0) {
        throw new Error(`worker failed (${String(spawned.status)}/${String(spawned.signal)}): ${spawned.stderr}`);
      }
      const line = spawned.stdout.split('\n').find((text) => text.startsWith('{'));
      if (line === undefined) {
        throw new Error(`worker wrote no result: ${spawned.stdout} ${spawned.stderr}`);
      }
      // The worker writes exactly one IKeyedReport line.
      return JSON.parse(line) as IKeyedReport;
    },
    candidates(subject) {
      const history = openHistory({ location, store: logicalStore });
      try {
        return history.findCandidates({ analysis, environment, subject, version: 1 }).map((candidate) => candidate.reference.locator);
      } finally {
        history.close();
      }
    },
  };
}

/** A later process's world: the given members discovered in reverse order; discovery must check again unless told otherwise. */
function reversedWorld(members: readonly IContributor[], options: { readonly discoveryFinal?: boolean; readonly status?: 'complete' | 'open' } = {}): IWorld {
  const world = createWorld([...members].reverse(), options.status ?? 'complete');
  world.discoveryFinal = options.discoveryFinal ?? false;
  return world;
}

/** Ada, Ben and Cy with one member replaced. */
function withMember(key: string, change: (member: IContributor) => IContributor): IContributor[] {
  return contributors().map((member) => member.key === key ? change(member) : member);
}

/** No member body ran in a process: no activity check, description or summary. */
function expectNoMemberBodies(report: IKeyedReport): void {
  expect(logged(report, 'activity')).toEqual([]);
  expect(logged(report, 'describe')).toEqual([]);
  expect(logged(report, 'summary')).toEqual([]);
}

/** Every listed member was reused with the exact reference process A published and no candidate miss. */
function expectRetained(report: IKeyedReport, cold: Readonly<Record<string, string>>, keys: readonly string[]): void {
  for (const key of keys) {
    expect(report.members[key]).toMatchObject({ status: 'succeeded', kind: 'reused', misses: [] });
    expect(referenceOf(report, key)).toBe(cold[key]);
  }
}

/** Process A: a cold run in forward order. Returns each member's exact summary reference. */
function cold(scene: IScenario, variation: IVariation = {}, world: IWorld = createWorld()): { readonly references: Readonly<Record<string, string>>; readonly report: IKeyedReport } {
  const report = scene.run({ ...variation, order: 'forward' }, world);
  expect(report.factoryCalls).toBe(1);
  expect(report.discovery).toMatchObject({ kind: 'keyed', completion: 'complete' });
  const keys = report.discovery.kind === 'keyed' ? report.discovery.keys : [];
  const references: Record<string, string> = {};
  for (const key of keys) {
    if (report.members[key]?.status === 'succeeded') {
      expect(report.members[key]).toMatchObject({ kind: 'published' });
      references[key] = referenceOf(report, key);
    }
  }
  return { references, report };
}

describe('keyed-cold-and-restarted-report', () => {
  test('a cold process runs every member once; an unchanged restart in reversed registration and member order runs zero member bodies', () => {
    const scene = scenario();
    const a = cold(scene);
    expect(a.report.discovery).toEqual({ kind: 'keyed', completion: 'complete', keys: [...baseKeys], reference: expect.any(String) });
    expect(Object.keys(a.references).sort()).toEqual([...baseKeys]);
    expect(a.report.log.filter((entry) => entry === 'discover')).toHaveLength(1);
    // Each member source read its member's key to select that member's activity.
    expect([...logged(a.report, 'activity')].sort()).toEqual([...baseKeys]);
    expect([...logged(a.report, 'describe')].sort()).toEqual(['ada', 'ben', 'cy']);
    expect([...logged(a.report, 'summary')].sort()).toEqual(['@ada', '@ben', '@cy']);

    const b = scene.run({ order: 'reversed' }, reversedWorld(contributors(), { discoveryFinal: true }));
    expect(b.factoryCalls).toBe(1);
    expect(b.discovery).toMatchObject({ kind: 'keyed', keys: [...baseKeys] });
    // Discovery was accepted by its current finality; every gate still ran in its own frame.
    expect(b.log.filter((entry) => entry === 'discover')).toEqual([]);
    expect([...logged(b, 'gate')].sort()).toEqual(['ada', 'ben', 'cy']);
    expectNoMemberBodies(b);
    expectRetained(b, a.references, baseKeys);
    expect(b.topology).toBe(a.report.topology);
  });
});

describe('discovery-insert-delete-reorder', () => {
  test('insertion runs only the new member; its admissions are its own work', () => {
    const scene = scenario();
    const a = cold(scene);
    const b = scene.run({ order: 'reversed' }, reversedWorld([...contributors(), dee()]));
    expect(b.discovery).toMatchObject({ kind: 'keyed', keys: [...baseKeys, 'person:dee'] });
    expectRetained(b, a.references, baseKeys);
    expect(b.members['person:dee']).toMatchObject({ status: 'succeeded', kind: 'published' });
    expect(logged(b, 'activity')).toEqual(['person:dee']);
    expect(logged(b, 'describe')).toEqual(['dee']);
    expect(logged(b, 'summary')).toEqual(['@dee']);
    expect(b.admissions).toEqual([
      'source:contributors:acme/widget:2026-Q1',
      'memo:summary:acme/widget:2026-Q1:person:dee',
      'source:activity:acme/widget:2026-Q1:person:dee',
      'supplied:description:acme/widget',
    ]);
  });

  test('deletion runs no remaining member body and never retracts the removed member\'s publication', () => {
    const scene = scenario();
    const a = cold(scene);
    const b = scene.run({ order: 'reversed' }, reversedWorld(contributors().filter((member) => member.key !== 'person:cy')));
    expect(b.discovery).toMatchObject({ kind: 'keyed', keys: ['person:ada', 'person:ben'] });
    expect(b.members['person:cy']).toBeUndefined();
    expectNoMemberBodies(b);
    expectRetained(b, a.references, ['person:ada', 'person:ben']);
    expect(b.admissions).toEqual(['source:contributors:acme/widget:2026-Q1']);
    expect(scene.candidates(summarySubject('person:cy'))).toEqual([a.references['person:cy']]);
  });

  test('reordering discovery runs discovery again but no member body', () => {
    const scene = scenario();
    const a = cold(scene);
    const b = scene.run({ order: 'reversed' }, reversedWorld(contributors()));
    expect(b.log.filter((entry) => entry === 'discover')).toHaveLength(1);
    expect(b.discovery).toMatchObject({ kind: 'keyed', keys: [...baseKeys] });
    expect(b.discovery.kind === 'keyed' && a.report.discovery.kind === 'keyed' ? b.discovery.reference : undefined).not.toBe(a.report.discovery.kind === 'keyed' ? a.report.discovery.reference : undefined);
    expectNoMemberBodies(b);
    expectRetained(b, a.references, baseKeys);
  });

  test('a changed unread discovery field runs nothing; a changed consumed member field reruns only that member', () => {
    const scene = scenario();
    const a = cold(scene);
    const unread = scene.run({ order: 'reversed' }, reversedWorld(withMember('person:ada', (member) => ({ ...member, bio: 'Compiler work', id: 'gh:9001' }))));
    expect(unread.log.filter((entry) => entry === 'discover')).toHaveLength(1);
    expectNoMemberBodies(unread);
    expectRetained(unread, a.references, baseKeys);

    const consumed = scene.run({ order: 'reversed' }, reversedWorld(withMember('person:ada', (member) => ({ ...member, login: 'lovelace' }))));
    expect(consumed.members['person:ada']).toMatchObject({ status: 'succeeded', kind: 'published', misses: ['changed-child-output'] });
    expect(referenceOf(consumed, 'person:ada')).not.toBe(a.references['person:ada']);
    expectRetained(consumed, a.references, ['person:ben', 'person:cy']);
    expect(logged(consumed, 'activity')).toEqual([]);
    expect(logged(consumed, 'describe')).toEqual(['lovelace']);
    expect(logged(consumed, 'summary')).toEqual(['@lovelace']);
  });

  test('a member memo\'s own read of a consumed member field reruns only that member\'s memo; its unread fields change nothing', () => {
    const scene = scenario();
    const a = cold(scene);
    const unread = scene.run({ order: 'reversed' }, reversedWorld(withMember('person:ada', (member) => ({ ...member, bio: 'Language design' }))));
    expectNoMemberBodies(unread);
    expectRetained(unread, a.references, baseKeys);

    const consumed = scene.run({ order: 'reversed' }, reversedWorld(withMember('person:ada', (member) => ({ ...member, authored: 5 }))));
    // The summary's own member observation is validated against the current keyed record.
    expect(consumed.members['person:ada']).toMatchObject({ status: 'succeeded', kind: 'published', misses: ['changed'] });
    expect(referenceOf(consumed, 'person:ada')).not.toBe(a.references['person:ada']);
    expectRetained(consumed, a.references, ['person:ben', 'person:cy']);
    expect(logged(consumed, 'activity')).toEqual([]);
    expect(logged(consumed, 'describe')).toEqual([]);
    expect(logged(consumed, 'summary')).toEqual(['@ada']);
  });
});

describe('custom-key-correspondence', () => {
  /** Ada, Ben and Cy with their designated ids renumbered and nothing else changed. */
  function renumbered(): IContributor[] {
    return contributors().map((member, index) => ({ ...member, key: `person:${String(index + 1)}` }));
  }

  test('a custom key keeps each member\'s instance across renumbered designated ids; only the activity checks that read the renumbered field run', () => {
    const scene = scenario();
    const a = cold(scene, { key: 'custom' });
    expect(a.report.discovery).toMatchObject({ keys: ['gh:1001', 'gh:1002', 'gh:1003'] });
    const b = scene.run({ order: 'reversed', key: 'custom' }, reversedWorld(renumbered()));
    expect(b.discovery).toMatchObject({ kind: 'keyed', keys: ['gh:1001', 'gh:1002', 'gh:1003'] });
    // Same instances: each activity source consumed its member's `key`, so it checks again and selects the renumbered activity...
    expect([...logged(b, 'activity')].sort()).toEqual(['person:1', 'person:2', 'person:3']);
    // ...while each summary, which consumed only the activity window, keeps its exact reference.
    expect(logged(b, 'describe')).toEqual([]);
    expect(logged(b, 'summary')).toEqual([]);
    expectRetained(b, a.references, ['gh:1001', 'gh:1002', 'gh:1003']);
  });

  test('under the designated key, renumbered ids are new instances whose unchanged children still reuse', () => {
    const scene = scenario();
    const a = cold(scene);
    const b = scene.run({ order: 'reversed' }, reversedWorld(renumbered()));
    expect(b.discovery).toMatchObject({ kind: 'keyed', keys: ['person:1', 'person:2', 'person:3'] });
    for (const key of ['person:1', 'person:2', 'person:3']) {
      expect(b.members[key]).toMatchObject({ status: 'succeeded', kind: 'published' });
    }
    // New instance subjects: every summary and activity runs; each description call reuses its forwarded-argument result.
    expect([...logged(b, 'summary')].sort()).toEqual(['@ada', '@ben', '@cy']);
    expect([...logged(b, 'activity')].sort()).toEqual(['person:1', 'person:2', 'person:3']);
    expect(logged(b, 'describe')).toEqual([]);
    // The old instances are neither remapped nor retracted.
    for (const key of baseKeys) {
      expect(scene.candidates(summarySubject(key))).toEqual([a.references[key]]);
    }
  });
});

describe('changed correspondence is never remapped (CMP-4, COL-1)', () => {
  test.each([
    ['a renamed template', { templateSlot: 'profile' }],
    ['a collection moved to another slot', { collectionSlot: 'roster' }],
  ] as const)('%s: every instance executes as a correspondence miss; no prior instance is reused or retracted', (_label, variation) => {
    const scene = scenario();
    const a = cold(scene);
    const b = scene.run({ ...variation, order: 'reversed' }, reversedWorld(contributors(), { discoveryFinal: true }));
    expect(b.topology).not.toBe(a.report.topology);
    for (const key of baseKeys) {
      expect(b.members[key]).toMatchObject({ status: 'succeeded', kind: 'published', misses: ['correspondence'] });
      expect(referenceOf(b, key)).not.toBe(a.references[key]);
      expect(scene.candidates(summarySubject(key))).toEqual([referenceOf(b, key), a.references[key]]);
    }
    expect([...logged(b, 'activity')].sort()).toEqual([...baseKeys]);
    expect([...logged(b, 'summary')].sort()).toEqual(['@ada', '@ben', '@cy']);
    // The composition-wide supplied describer keeps its correspondence and reuses.
    expect(logged(b, 'describe')).toEqual([]);
  });
});

describe('duplicate-and-missing-identity', () => {
  test.each([
    ['a duplicate designated key', {}, withMember('person:ben', (member) => ({ ...member, key: 'person:ada' })), { reason: 'duplicate-key', key: 'person:ada', identity: 'key', customKey: false }, /Declare a custom key with the template's `key` option/u],
    ['a missing designated key', {}, withMember('person:cy', ({ key, ...member }) => { void key; return member; }), { reason: 'missing-key', key: null, identity: 'key', customKey: false }, /without designated identity field "key".*Declare a custom key with the template's `key` option/u],
    ['a duplicate custom key', { key: 'custom' }, withMember('person:ben', (member) => ({ ...member, id: 'gh:1001' })), { reason: 'duplicate-key', key: 'gh:1001', identity: null, customKey: true }, /Revise the template's `key` option/u],
  ] as const)('%s rejects the snapshot with its diagnostic and admits no gate or member work', (_label, variation, members, diagnostic, message) => {
    const scene = scenario();
    const a = cold(scene, variation);
    const b = scene.run({ ...variation, order: 'reversed' }, reversedWorld(members));
    expect(b.discovery).toEqual({ kind: 'rejected', reference: expect.any(String), collection: 'contributors', template: 'contributor', message: expect.stringMatching(message), ...diagnostic });
    expect(b.members).toEqual({});
    expect(logged(b, 'gate')).toEqual([]);
    expectNoMemberBodies(b);
    expect(b.admissions).toEqual(['source:contributors:acme/widget:2026-Q1']);
    // Nothing was retracted: a corrected snapshot reconnects every member with zero bodies.
    const c = scene.run({ ...variation, order: 'reversed' }, reversedWorld(contributors()));
    expectNoMemberBodies(c);
    expectRetained(c, a.references, Object.keys(a.references));
  });
});

describe('frozen-template-topology', () => {
  test('mutating every author array, record and input after composition changes nothing in a later process', () => {
    const scene = scenario();
    const a = cold(scene);
    const b = scene.run({ order: 'reversed', mutateAfterCompose: true }, reversedWorld(contributors(), { discoveryFinal: true }));
    expect(b.factoryCalls).toBe(1);
    expect(b.topology).toBe(a.report.topology);
    // The threshold input was mutated to 99 after composing; the frozen copy still requires everyone.
    expect(Object.values(b.members).map((member) => member.status)).toEqual(['succeeded', 'succeeded', 'succeeded']);
    expectNoMemberBodies(b);
    expectRetained(b, a.references, baseKeys);
  });

  test('an operation created from a result is rejected before any admission, and nothing is published for it', () => {
    const scene = scenario();
    const a = scene.run({ order: 'forward', resultCreated: true }, createWorld());
    const reference = scene.run({ order: 'reversed' }, reversedWorld(contributors(), { discoveryFinal: true }));
    expect(a.topology).toBe(reference.topology);
    for (const key of baseKeys) {
      expect(a.members[key]).toMatchObject({ status: 'failed', code: 'execution-failure', cause: expect.stringMatching(/DefinitionError: .*frozen/u) });
    }
    // The created operation never reached admission; the summaries that tried it published nothing.
    expect(a.admissions.filter((entry) => entry.includes('@'))).toEqual([]);
    expect(a.admissions.filter((entry) => entry.startsWith('memo:')).sort()).toEqual(baseKeys.map((key) => `memo:${summarySubject(key)}`));
    expect(logged(a, 'summary')).toEqual([]);
    // The later ordinary process published each summary exactly once, as the only candidate.
    for (const key of baseKeys) {
      expect(scene.candidates(summarySubject(key))).toEqual([referenceOf(reference, key)]);
    }
  });
});

describe('tracked-gate-instances', () => {
  test('raising the threshold skips Cy without changing topology or retracting its publication; lowering it reconnects Cy with zero bodies', () => {
    const scene = scenario();
    const a = cold(scene);
    const raised = scene.run({ order: 'reversed', minimumAuthored: 2 }, reversedWorld(contributors(), { discoveryFinal: true }));
    expect(raised.topology).toBe(a.report.topology);
    expect(raised.members['person:cy']).toEqual({ status: 'skipped', gate: { selected: 'skipped', bindings: ['callable', 'inputs', 'member', 'self'] } });
    expectRetained(raised, a.references, ['person:ada', 'person:ben']);
    expectNoMemberBodies(raised);
    expect(raised.admissions).toEqual([]);
    expect(scene.candidates(summarySubject('person:cy'))).toEqual([a.references['person:cy']]);

    const lowered = scene.run({ order: 'reversed', minimumAuthored: 1 }, reversedWorld(contributors(), { discoveryFinal: true }));
    expectNoMemberBodies(lowered);
    expectRetained(lowered, a.references, baseKeys);

    // A threshold change that flips no gate reruns nothing.
    const unflipped = scene.run({ order: 'reversed', minimumAuthored: 0 }, reversedWorld(contributors(), { discoveryFinal: true }));
    expectNoMemberBodies(unflipped);
    expectRetained(unflipped, a.references, baseKeys);
  });

  test('lowering the threshold requires a never-run member: only its work runs', () => {
    const scene = scenario();
    const a = scene.run({ order: 'forward', minimumAuthored: 2 }, createWorld());
    expect(a.members['person:cy']).toMatchObject({ status: 'skipped' });
    expect([...logged(a, 'summary')].sort()).toEqual(['@ada', '@ben']);
    const b = scene.run({ order: 'reversed', minimumAuthored: 1 }, reversedWorld(contributors(), { discoveryFinal: true }));
    expect(b.topology).toBe(a.topology);
    expect(b.members['person:cy']).toMatchObject({ status: 'succeeded', kind: 'published' });
    expect(logged(b, 'summary')).toEqual(['@cy']);
    expect(logged(b, 'describe')).toEqual(['cy']);
    expect(logged(b, 'activity')).toEqual(['person:cy']);
    for (const key of ['person:ada', 'person:ben']) {
      expect(b.members[key]).toMatchObject({ status: 'succeeded', kind: 'reused', reference: a.members[key]?.reference });
    }
  });
});
