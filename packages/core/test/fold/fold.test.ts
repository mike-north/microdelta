/**
 * Strict folds through the facade's real workspace path (issue #86): Reuse
 * Resolution resolves the consumed template step for every current member,
 * each independently, then decides the fold's readiness (failed or cancelled
 * required members fail it at once, otherwise open discovery or a pending
 * member leaves it waiting) and only then validates or executes it; Run
 * Supervision reports the fold's typed outcome. Each session is a fresh
 * composition over the same SQLite file, so only durable History survives
 * between sessions. Expected values are derived by hand from the fixture data
 * (Ada 5, Ben 3, Cy 2, Dee 4; Cy skipped at threshold 2) and the owning
 * contracts; the separate-process evidence is `restart.test.ts`.
 *
 * @see ../../../../docs/spec/composition.md (CMP-8 and its EXP-4 strict-fold selection)
 * @see ../../../../docs/spec/operations.md (RUN-004, RUN-005, RUN-010)
 * @see ../../../../docs/spec/acceptance.md (A-11)
 * @see ../../../../docs/plans/m4-composition.md ("Strict fold"; strict-fold-readiness, strict-fold-coverage, closed-empty-population)
 * @see ../../../../experiments/exp-4/decision.md (supervisor resolution)
 */
import { afterEach, beforeEach, describe, expect, test } from '@jest/globals';

import { ResolutionError, openWorkspace } from '../../src/index.js';
import type { IWorkspaceRun } from '../../src/index.js';
import { cleanup, freshLocation } from '../durable-history/support.js';
import { analysis, composeFold, contributors, createWorld, dee, foldSecret, resetWorld, world } from './fixture.js';
import type { IContributor, IFoldFixture, IVariation } from './fixture.js';
import {
  candidates,
  environment,
  foldCandidates,
  foldReference,
  logged,
  logicalStore,
  memberReference,
  publishCrafted,
  readProvenanceRecord,
  readResult,
  requestKey,
  runFold,
  summarySubject,
} from './support.js';
import type { IFoldRunReport, IStoredRecord } from './support.js';

beforeEach(() => {
  resetWorld();
});
afterEach(cleanup);

/** Ada, Ben and Cy's designated keys, in canonical order. */
const baseKeys = ['person:ada', 'person:ben', 'person:cy'];

/** Start a fresh helper log, keeping the world's data and policy answers. */
function clearLog(): void {
  world.log = [];
}

/** A later session's world: the given members discovered in reverse order, discovery checked again. */
function rediscover(members: readonly IContributor[], status: 'complete' | 'open' = 'complete'): void {
  const next = createWorld([...members].reverse(), status);
  next.discoveryFinal = false;
  resetWorld(next);
}

/** Ada, Ben and Cy with one member replaced. */
function withMember(key: string, change: (member: IContributor) => IContributor): IContributor[] {
  return contributors().map((member) => member.key === key ? change(member) : member);
}

/** The fold body never ran, no fold work was admitted and the fold has no lifecycle at all. */
function expectNoFoldWork(report: IFoldRunReport): void {
  expect(logged(report, 'report')).toEqual([]);
  expect(report.admissions.filter((entry) => entry.startsWith('fold:'))).toEqual([]);
  expect(report.events.filter((entry) => entry.startsWith('report/'))).toEqual([]);
}

/** Run `body` in one workspace run over a freshly composed fixture at `location`. */
async function withRun<T>(location: string, variation: IVariation, body: (run: IWorkspaceRun, fixture: IFoldFixture) => Promise<T>): Promise<T> {
  const workspace = openWorkspace({ location, logicalStore });
  const fixture = composeFold(variation);
  try {
    const result = await workspace.run({ authoring: fixture.builders, composition: fixture.composition, environment }, (run) => body(run, fixture));
    return result.value;
  } finally {
    workspace.close();
  }
}

/** Expect a promise to reject with a ResolutionError of `code`, returning it. */
async function expectResolutionError(action: Promise<unknown>, code: ResolutionError['code']): Promise<ResolutionError> {
  let caught: unknown;
  try {
    await action;
  } catch (error: unknown) {
    caught = error;
  }
  expect(caught).toBeInstanceOf(ResolutionError);
  if (!(caught instanceof ResolutionError)) {
    throw new Error('expected a ResolutionError');
  }
  expect(caught.code).toBe(code);
  return caught;
}

describe('readiness order (acceptance 1)', () => {
  test('a failed and a cancelled member fail the fold at once, naming failed, cancelled and pending keys and open discovery; the ready sibling publishes', async () => {
    const location = freshLocation();
    resetWorld(createWorld([...contributors(), dee()], 'open'));
    world.failSummary = ['cy'];
    world.decisions = { 'person:ben': 'denied', 'person:dee': 'cancelled' };
    const report = await runFold(location);
    expect(report.discovery).toEqual({ kind: 'keyed', completion: 'open', keys: ['person:ada', 'person:ben', 'person:cy', 'person:dee'] });
    expect(report.members).toEqual({
      'person:ada': { status: 'succeeded', kind: 'published', reference: expect.any(String) },
      'person:ben': { status: 'pending', reason: 'denied by the fixture policy for person:ben' },
      'person:cy': { status: 'failed', code: 'execution-failure' },
      'person:dee': { status: 'cancelled', reason: 'cancelled by the fixture policy for person:dee' },
    });
    expect(report.fold).toEqual({
      status: 'failed',
      failed: ['person:cy'],
      cancelled: ['person:dee'],
      pending: ['person:ben'],
      openDiscovery: true,
      diagnostic: expect.stringMatching(/failed \[person:cy\].*cancelled \[person:dee\]/u),
    });
    expectNoFoldWork(report);
    expect(foldCandidates(location)).toEqual([]);
    // The ready sibling's publication is exact and readable although the fold failed.
    expect(readResult(location, memberReference(report, 'person:ada'))).toEqual({ label: '@ada', score: 5 });
  });

  test.each([
    ['a failed member with discovery closed', { failSummary: ['ben'] }, 'complete', { failed: ['person:ben'], cancelled: [], pending: [], openDiscovery: false }],
    ['a cancelled member with discovery closed', { decisions: { 'person:ben': 'cancelled' } }, 'complete', { failed: [], cancelled: ['person:ben'], pending: [], openDiscovery: false }],
    ['a failed member while another is pending and discovery is open', { failSummary: ['cy'], decisions: { 'person:ben': 'denied' } }, 'open', { failed: ['person:cy'], cancelled: [], pending: ['person:ben'], openDiscovery: true }],
  ] as const)('%s fails the fold rather than leaving it waiting', async (_name, policy, status, expected) => {
    resetWorld(createWorld(contributors(), status));
    world.failSummary = 'failSummary' in policy ? [...policy.failSummary] : [];
    world.decisions = 'decisions' in policy ? { ...policy.decisions } : {};
    const report = await runFold(freshLocation());
    expect(report.fold).toEqual({ status: 'failed', ...expected, diagnostic: expect.any(String) });
    expectNoFoldWork(report);
  });

  test('with nothing failed, a pending member leaves the fold waiting while its siblings publish', async () => {
    const location = freshLocation();
    world.decisions = { 'person:ben': 'denied' };
    const report = await runFold(location);
    expect(report.fold).toEqual({ status: 'waiting', pending: ['person:ben'], openDiscovery: false });
    expect(report.members['person:ada']).toMatchObject({ status: 'succeeded', kind: 'published' });
    expect(report.members['person:cy']).toMatchObject({ status: 'succeeded', kind: 'published' });
    expectNoFoldWork(report);
    expect(foldCandidates(location)).toEqual([]);
  });

  test('open discovery alone leaves the fold waiting although every current member succeeded', async () => {
    const location = freshLocation();
    resetWorld(createWorld(contributors(), 'open'));
    const report = await runFold(location);
    expect(report.fold).toEqual({ status: 'waiting', pending: [], openDiscovery: true });
    for (const key of baseKeys) {
      expect(report.members[key]).toMatchObject({ status: 'succeeded', kind: 'published' });
    }
    expectNoFoldWork(report);
    expect(foldCandidates(location)).toEqual([]);
  });

  test.each([
    ['denied discovery work waits, with discovery open', 'denied', { kind: 'pending', reason: 'denied by the fixture policy for @contributors' }, { status: 'waiting', pending: [], openDiscovery: true }],
    ['cancelled discovery work fails, with discovery open', 'cancelled', { kind: 'cancelled', reason: 'cancelled by the fixture policy for @contributors' }, {
      status: 'failed', failed: [], cancelled: [], pending: [], openDiscovery: true, diagnostic: expect.stringMatching(/discovery/u),
    }],
  ] as const)('%s', async (_name, decision, discovery, fold) => {
    world.decisions = { '@contributors': decision };
    const report = await runFold(freshLocation());
    expect(report.discovery).toEqual(discovery);
    expect(report.members).toEqual({});
    expect(report.fold).toEqual(fold);
    expect(report.log).toEqual([]);
    expectNoFoldWork(report);
  });

  test('a run-level failure while members settle rejects the fold request itself: an outage is never a failed member', async () => {
    const location = freshLocation();
    world.admissionFaults = ['person:ben'];
    const report = await runFold(location);
    expect(report.fold).toEqual({ status: 'error', code: 'admission-failure', message: expect.stringMatching(/^Admission failed for .*person:ben/u), cause: 'Error: admission service unavailable for person:ben' });
    expect(logged(report, 'report')).toEqual([]);
    expect(report.admissions.filter((entry) => entry.startsWith('fold:'))).toEqual([]);
    expect(foldCandidates(location)).toEqual([]);
  });

  test('a rejected snapshot fails the fold with the keying diagnostic and admits no gate, member or fold work', async () => {
    resetWorld(createWorld([...contributors(), { ...dee(), key: 'person:ben' }]));
    const report = await runFold(freshLocation());
    expect(report.discovery).toMatchObject({ kind: 'rejected', reason: 'duplicate-key', key: 'person:ben' });
    expect(report.fold).toEqual({ status: 'failed', failed: [], cancelled: [], pending: [], openDiscovery: false, diagnostic: expect.stringMatching(/duplicate member key "person:ben"/u) });
    expect(report.log).toEqual(['discover']);
    expect(report.admissions).toEqual(['source:contributors:acme/widget:2026-Q1']);
    expectNoFoldWork(report);
  });

  test.each([['denied', 'pending'], ['cancelled', 'cancelled']] as const)('only once ready does the fold present its own work to admission: %s fold work is %s', async (decision, status) => {
    const location = freshLocation();
    world.decisions = { '@report': decision };
    const report = await runFold(location);
    expect(report.fold).toEqual({ status, reason: `${decision} by the fixture policy for @report`, refused: 'report' });
    for (const key of baseKeys) {
      expect(report.members[key]).toMatchObject({ status: 'succeeded', kind: 'published' });
    }
    // The fold's admission comes after every member's work was settled.
    const foldAdmission = report.admissions.indexOf('fold:report:acme/widget:2026-Q1');
    expect(foldAdmission).toBe(report.admissions.length - 1);
    expect(report.admissions.filter((entry) => entry.startsWith('memo:'))).toHaveLength(3);
    expect(logged(report, 'report')).toEqual([]);
    expect(foldCandidates(location)).toEqual([]);
  });
});

describe('explicit keyed entries (acceptance 2)', () => {
  test('the body receives one entry per current member in canonical key order: succeeded with a view, or skipped with no data', async () => {
    const location = freshLocation();
    // Discovery lists the members in reverse; entries are in canonical key order regardless.
    resetWorld(createWorld([...contributors()].reverse()));
    const report = await runFold(location, { minimumAuthored: 2 });
    expect(logged(report, 'report')).toEqual(['person:ada=succeeded,person:ben=succeeded,person:cy=skipped']);
    expect(readResult(location, foldReference(report))).toEqual({ lines: ['person:ada 5', 'person:ben 3', 'person:cy excluded by the gate'], total: 8 });
    expect(report.members['person:cy']).toEqual({ status: 'skipped' });
  });

  test('reading a skipped entry\'s data throws: the fold fails and publishes nothing', async () => {
    const location = freshLocation();
    const report = await runFold(location, { minimumAuthored: 2, report: 'reads-skipped' });
    expect(report.fold).toEqual({
      status: 'error',
      code: 'execution-failure',
      message: expect.any(String),
      cause: expect.stringMatching(/^DefinitionError: Member person:cy was skipped by its gate and carries no data/u),
    });
    expect(logged(report, 'report')).toEqual(['person:ada=succeeded,person:ben=succeeded,person:cy=skipped']);
    expect(foldCandidates(location)).toEqual([]);
  });

  test('a fold body that throws its own error fails with execution-failure naming the fold; the error is the cause, never the message or a diagnostic (RUN-013)', async () => {
    const location = freshLocation();
    const report = await runFold(location, { report: 'throws' });
    expect(report.fold).toEqual({
      status: 'error',
      code: 'execution-failure',
      message: expect.stringContaining('report'),
      cause: `Error: report service failed ${foldSecret}`,
    });
    expect(report.fold).toMatchObject({ message: expect.not.stringContaining(foldSecret) });
    expect(JSON.stringify(report.diagnostics)).not.toContain(foldSecret);
    expect(JSON.stringify(report.events)).not.toContain(foldSecret);
    expect(foldCandidates(location)).toEqual([]);
  });
});

describe('framework coverage (acceptance 3)', () => {
  test('published and reused outcomes carry coverage { required, skipped, closed: true }', async () => {
    const location = freshLocation();
    const cold = await runFold(location, { minimumAuthored: 2 });
    const coverage = { required: ['person:ada', 'person:ben'], skipped: ['person:cy'], closed: true };
    expect(cold.fold).toEqual({ status: 'succeeded', kind: 'published', reference: expect.any(String), misses: [], coverage });
    clearLog();
    const restarted = await runFold(location, { minimumAuthored: 2, order: 'reversed' });
    expect(restarted.fold).toMatchObject({ status: 'succeeded', kind: 'reused', reference: foldReference(cold), misses: [], coverage });
    expect(logged(restarted, 'summary')).toEqual([]);
    expect(logged(restarted, 'report')).toEqual([]);
  });

  test('coverage is independent of the body: a body that drops exclusions still yields coverage naming them', async () => {
    const location = freshLocation();
    const report = await runFold(location, { minimumAuthored: 2, report: 'omits-skipped' });
    expect(readResult(location, foldReference(report))).toEqual({ lines: ['person:ada', 'person:ben'], total: 8 });
    expect(report.fold).toMatchObject({ status: 'succeeded', coverage: { required: ['person:ada', 'person:ben'], skipped: ['person:cy'], closed: true } });
  });
});

/** Stored fold provenance as these tests read it. */
interface IStoredFold {
  readonly kind: string;
  readonly over?: unknown;
  readonly membership: readonly { readonly key: string; readonly status: string; readonly reference?: { readonly locator: string } }[];
  readonly observations: readonly { readonly binding: { readonly path: readonly string[] }; readonly address: readonly { readonly key?: string }[] }[];
}

describe('fold evidence and verification (acceptance 4)', () => {
  test('provenance records the membership-and-status fact and each included member\'s consumed facts, never gate facts', async () => {
    const location = freshLocation();
    const report = await runFold(location, { minimumAuthored: 2 });
    const stored = readProvenanceRecord(location, foldReference(report));
    expect(stored.formatVersion).toBe(3);
    // Resolution's version-3 provenance stores a fold's record as plain data of this shape.
    const content = stored.content as IStoredFold;
    expect(content.kind).toBe('fold');
    // The consumed template step: its structural address, never a member key.
    expect(content.over).toEqual({ scope: analysis, role: 'step', slot: 'summary', template: 'contributor', collection: 'contributors' });
    expect(content.membership).toEqual([
      { key: 'person:ada', status: 'included', reference: { kind: 'completed-result', locator: memberReference(report, 'person:ada') } },
      { key: 'person:ben', status: 'included', reference: { kind: 'completed-result', locator: memberReference(report, 'person:ben') } },
      { key: 'person:cy', status: 'skipped' },
    ]);
    const bindings = [...new Set(content.observations.map((item) => JSON.stringify(item.binding.path)))].sort();
    expect(bindings).toEqual(['["callable","render"]', '["entry","person:ada"]', '["entry","person:ben"]', '["self"]']);
    // The fold consumed each included member's score and nothing else of it.
    const consumed = content.observations.filter((item) => item.binding.path[0] === 'entry').map((item) => item.address.map((segment) => segment.key));
    expect(consumed).toEqual([['score'], ['score']]);
  });

  test('a gate flip reruns the fold and only the newly required member', async () => {
    const location = freshLocation();
    const cold = await runFold(location, { minimumAuthored: 2 });
    clearLog();
    const flipped = await runFold(location, { minimumAuthored: 1, order: 'reversed' });
    expect(logged(flipped, 'summary')).toEqual(['cy']);
    expect(logged(flipped, 'report')).toEqual(['person:ada=succeeded,person:ben=succeeded,person:cy=succeeded']);
    expect(flipped.fold).toMatchObject({ status: 'succeeded', kind: 'published', misses: ['changed-membership'], coverage: { required: baseKeys, skipped: [] } });
    for (const key of ['person:ada', 'person:ben']) {
      expect(flipped.members[key]).toEqual({ status: 'succeeded', kind: 'reused', reference: memberReference(cold, key) });
    }
    expect(readResult(location, foldReference(flipped))).toEqual({ lines: ['person:ada 5', 'person:ben 3', 'person:cy 2'], total: 10 });
  });

  test('a threshold change that flips no gate reruns nothing', async () => {
    const location = freshLocation();
    const cold = await runFold(location, { minimumAuthored: 1 });
    clearLog();
    const unflipped = await runFold(location, { minimumAuthored: 0, order: 'reversed' });
    // The gates ran again over the changed threshold; no outcome flipped.
    expect(logged(unflipped, 'gate')).toEqual(['ada', 'ben', 'cy']);
    expect(logged(unflipped, 'summary')).toEqual([]);
    expect(logged(unflipped, 'report')).toEqual([]);
    expect(unflipped.fold).toMatchObject({
      status: 'succeeded',
      kind: 'reused',
      reference: foldReference(cold),
      misses: [],
      accepted: baseKeys.map((key) => memberReference(cold, key)),
    });
  });

  test('insertion or deletion reruns the fold; reordering discovery reruns nothing', async () => {
    const location = freshLocation();
    const cold = await runFold(location);

    rediscover([...contributors(), dee()]);
    const inserted = await runFold(location, { order: 'reversed' });
    expect(logged(inserted, 'summary')).toEqual(['dee']);
    expect(logged(inserted, 'report')).toHaveLength(1);
    expect(inserted.fold).toMatchObject({ status: 'succeeded', kind: 'published', misses: ['changed-membership'], coverage: { required: [...baseKeys, 'person:dee'], skipped: [] } });

    rediscover([...contributors(), dee()].filter((member) => member.key !== 'person:cy'));
    const deleted = await runFold(location);
    expect(logged(deleted, 'summary')).toEqual([]);
    expect(logged(deleted, 'report')).toEqual(['person:ada=succeeded,person:ben=succeeded,person:dee=succeeded']);
    // Both earlier fold results (the inserted and the cold population) miss on membership.
    expect(deleted.fold).toMatchObject({ status: 'succeeded', kind: 'published', misses: ['changed-membership', 'changed-membership'] });

    rediscover([...contributors(), dee()].filter((member) => member.key !== 'person:cy').reverse());
    const reordered = await runFold(location, { order: 'reversed' });
    expect(reordered.log.filter((entry) => entry === 'discover')).toHaveLength(1);
    expect(logged(reordered, 'summary')).toEqual([]);
    expect(logged(reordered, 'report')).toEqual([]);
    expect(reordered.fold).toMatchObject({ status: 'succeeded', kind: 'reused', reference: foldReference(deleted) });
    expect(foldCandidates(location)).toEqual([foldReference(deleted), foldReference(inserted), foldReference(cold)]);
  });

  test.each([
    ['renaming the consumed member step', 'renamed-step'],
    ['renaming the template slot', 'renamed-template'],
    ['moving the collection to another slot', 'moved-collection'],
  ] as const)('%s is a correspondence miss for the fold, never a reuse (no remap)', async (_name, structure) => {
    const location = freshLocation();
    const cold = await runFold(location);
    clearLog();
    const changed = await runFold(location, { structure, order: 'reversed' });
    // Every subject is kept, but the fold now consumes a different template step:
    // its earlier result is a correspondence miss, as each member's is.
    expect(logged(changed, 'summary')).toEqual(['ada', 'ben', 'cy']);
    expect(logged(changed, 'report')).toHaveLength(1);
    expect(changed.fold).toMatchObject({ status: 'succeeded', kind: 'published', misses: ['correspondence'], coverage: { required: baseKeys, skipped: [], closed: true } });
    expect(foldReference(changed)).not.toBe(foldReference(cold));
    expect(foldCandidates(location)).toEqual([foldReference(changed), foldReference(cold)]);
  });

  test('a consumed member field change reruns that member, and the fold only when a fact it consumed changed', async () => {
    const location = freshLocation();
    const cold = await runFold(location);

    // The login feeds the summary's label, which the fold never reads.
    rediscover(withMember('person:ben', (member) => ({ ...member, login: 'benjamin' })));
    const relabelled = await runFold(location, { order: 'reversed' });
    expect(logged(relabelled, 'summary')).toEqual(['benjamin']);
    expect(logged(relabelled, 'report')).toEqual([]);
    const ben = memberReference(relabelled, 'person:ben');
    expect(ben).not.toBe(memberReference(cold, 'person:ben'));
    expect(relabelled.fold).toMatchObject({
      status: 'succeeded',
      kind: 'reused',
      reference: foldReference(cold),
      accepted: [memberReference(cold, 'person:ada'), ben, memberReference(cold, 'person:cy')],
    });

    // The score feeds the summary's score, which the fold consumes.
    rediscover(withMember('person:ben', (member) => ({ ...member, login: 'benjamin', score: 7 })));
    const rescored = await runFold(location);
    expect(logged(rescored, 'summary')).toEqual(['benjamin']);
    expect(logged(rescored, 'report')).toHaveLength(1);
    expect(rescored.fold).toMatchObject({ status: 'succeeded', kind: 'published', misses: ['changed-member-output'] });
    expect(readResult(location, foldReference(rescored))).toEqual({ lines: ['person:ada 5', 'person:ben 7', 'person:cy 2'], total: 14 });

    // A field no member work reads changes nothing.
    rediscover(withMember('person:ben', (member) => ({ ...member, login: 'benjamin', score: 7, bio: 'Rewritten' })));
    const unread = await runFold(location, { order: 'reversed' });
    expect(logged(unread, 'summary')).toEqual([]);
    expect(logged(unread, 'report')).toEqual([]);
    expect(unread.fold).toMatchObject({ status: 'succeeded', kind: 'reused', reference: foldReference(rescored) });
  });
});

/** A deep, mutable JSON copy of stored fold provenance content. */
function foldContent(record: IStoredRecord): IStoredFold & Record<string, unknown> {
  // Resolution's version-3 provenance stores a fold's record as plain data of this shape.
  return JSON.parse(JSON.stringify(record.content)) as IStoredFold & Record<string, unknown>;
}

describe('stored fold evidence', () => {
  test('an unknown provenance version or a record of another step kind is unsupported evidence; the older valid fold result is reused', async () => {
    const location = freshLocation();
    const cold = await runFold(location);
    const original = readProvenanceRecord(location, foldReference(cold));
    const unknownVersion = publishCrafted(location, foldReference(cold), { ...original, formatVersion: 9 });
    const content = foldContent(original);
    const sourceKind = publishCrafted(location, foldReference(cold), { format: original.format, formatVersion: 1, content: { kind: 'source', step: content['step'], observations: content.observations, children: [] } });
    clearLog();
    const report = await runFold(location, { order: 'reversed' });
    expect(report.fold).toMatchObject({ status: 'succeeded', kind: 'reused', reference: foldReference(cold), misses: ['unsupported-evidence', 'unsupported-evidence'] });
    expect(logged(report, 'report')).toEqual([]);
    expect(foldCandidates(location)).toEqual([sourceKind, unknownVersion, foldReference(cold)]);
  });

  test.each([
    ['membership keys out of canonical order', (content: IStoredFold & Record<string, unknown>) => ({ ...content, membership: [...content.membership].reverse() }), undefined],
    ['a consumed member fact of a skipped member', (content: IStoredFold & Record<string, unknown>) => ({
      ...content,
      observations: content.observations.map((item) => item.binding.path[1] === 'person:ada' ? { ...item, binding: { path: ['entry', 'person:cy'] } } : item),
    }), undefined],
    ['an included member result outside the exact dependencies', (content: IStoredFold & Record<string, unknown>) => content, [] as readonly string[]],
    ['no consumed template step', (content: IStoredFold & Record<string, unknown>) => Object.fromEntries(Object.entries(content).filter(([key]) => key !== 'over')), undefined],
    ['a consumed template step without template fields', (content: IStoredFold & Record<string, unknown>) => ({ ...content, over: { scope: analysis, role: 'step', slot: 'summary' } }), undefined],
    ['a consumed template step with a member key', (content: IStoredFold & Record<string, unknown>) => ({
      ...content,
      over: { scope: analysis, role: 'step', slot: 'summary', template: 'contributor', collection: 'contributors', memberKey: 'person:ada' },
    }), undefined],
  ] as const)('malformed version-3 fold evidence is integrity damage, never a miss: %s', async (_name, tamper, dependencies) => {
    const location = freshLocation();
    const cold = await runFold(location, { minimumAuthored: 2 });
    const original = readProvenanceRecord(location, foldReference(cold));
    publishCrafted(location, foldReference(cold), { ...original, content: tamper(foldContent(original)) }, dependencies);
    clearLog();
    const report = await runFold(location, { minimumAuthored: 2 });
    expect(report.fold).toMatchObject({ status: 'error', code: 'integrity' });
    expect(logged(report, 'report')).toEqual([]);
    expect(report.admissions.filter((entry) => entry.startsWith('fold:'))).toEqual([]);
  });
});

describe('repair and empty populations (acceptance 5)', () => {
  test('repairing a failed member reruns the fold while unaffected member bodies stay at zero', async () => {
    const location = freshLocation();
    world.failSummary = ['cy'];
    const failed = await runFold(location);
    expect(failed.fold).toMatchObject({ status: 'failed', failed: ['person:cy'] });
    expect(foldCandidates(location)).toEqual([]);

    rediscover(contributors());
    const repaired = await runFold(location, { order: 'reversed' });
    expect(logged(repaired, 'summary')).toEqual(['cy']);
    expect(logged(repaired, 'report')).toEqual(['person:ada=succeeded,person:ben=succeeded,person:cy=succeeded']);
    expect(repaired.fold).toMatchObject({ status: 'succeeded', kind: 'published', coverage: { required: baseKeys, skipped: [], closed: true } });
    for (const key of ['person:ada', 'person:ben']) {
      expect(repaired.members[key]).toEqual({ status: 'succeeded', kind: 'reused', reference: memberReference(failed, key) });
    }
  });

  test('after an earlier success, a failing member fails the fold without touching its retained result; repair reruns the fold only for the changed member', async () => {
    const location = freshLocation();
    const cold = await runFold(location);

    rediscover(withMember('person:cy', (member) => ({ ...member, score: 6 })));
    world.failSummary = ['cy'];
    const failing = await runFold(location);
    expect(failing.fold).toMatchObject({ status: 'failed', failed: ['person:cy'], pending: [], openDiscovery: false });
    expect(foldCandidates(location)).toEqual([foldReference(cold)]);

    rediscover(withMember('person:cy', (member) => ({ ...member, score: 6 })));
    const repaired = await runFold(location, { order: 'reversed' });
    expect(logged(repaired, 'summary')).toEqual(['cy']);
    expect(repaired.fold).toMatchObject({ status: 'succeeded', kind: 'published', misses: ['changed-member-output'] });
    expect(readResult(location, foldReference(repaired))).toEqual({ lines: ['person:ada 5', 'person:ben 3', 'person:cy 6'], total: 14 });
  });

  test('a closed empty population is a successful fold; a later open empty population waits and does not rewind it', async () => {
    const location = freshLocation();
    resetWorld(createWorld([], 'complete'));
    const closed = await runFold(location);
    expect(closed.discovery).toEqual({ kind: 'keyed', completion: 'complete', keys: [] });
    expect(closed.fold).toEqual({ status: 'succeeded', kind: 'published', reference: expect.any(String), misses: [], coverage: { required: [], skipped: [], closed: true } });
    expect(logged(closed, 'report')).toEqual(['']);
    expect(readResult(location, foldReference(closed))).toEqual({ lines: [], total: 0 });

    rediscover([], 'open');
    const open = await runFold(location);
    expect(open.discovery).toEqual({ kind: 'keyed', completion: 'open', keys: [] });
    expect(open.fold).toEqual({ status: 'waiting', pending: [], openDiscovery: true });
    expectNoFoldWork(open);
    expect(foldCandidates(location)).toEqual([foldReference(closed)]);

    rediscover([], 'complete');
    const reclosed = await runFold(location, { order: 'reversed' });
    expect(reclosed.fold).toMatchObject({ status: 'succeeded', kind: 'reused', reference: foldReference(closed), coverage: { required: [], skipped: [], closed: true } });
    expect(logged(reclosed, 'report')).toEqual([]);
  });
});

describe('no retraction (acceptance 6)', () => {
  test('a skip or a deletion never retracts an earlier member publication: the old reference resolves exactly and stays latest', async () => {
    const location = freshLocation();
    const cold = await runFold(location);
    const cy = memberReference(cold, 'person:cy');

    const skipped = await runFold(location, { minimumAuthored: 2 });
    expect(skipped.members['person:cy']).toEqual({ status: 'skipped' });
    expect(skipped.fold).toMatchObject({ status: 'succeeded', kind: 'published', misses: ['changed-membership'], coverage: { skipped: ['person:cy'] } });
    expect(readResult(location, cy)).toEqual({ label: '@cy', score: 2 });
    expect(candidates(location, summarySubject('person:cy'))).toEqual([cy]);

    rediscover(contributors().filter((member) => member.key !== 'person:cy'));
    const deleted = await runFold(location);
    expect(deleted.members).not.toHaveProperty(['person:cy']);
    expect(deleted.fold).toMatchObject({ status: 'succeeded', coverage: { required: ['person:ada', 'person:ben'], skipped: [] } });
    expect(readResult(location, cy)).toEqual({ label: '@cy', score: 2 });
    expect(candidates(location, summarySubject('person:cy'))).toEqual([cy]);
  });
});

describe('direct fold requests', () => {
  test('resolve and check of a fold step are refused toward resolveFold; recover reports the fold\'s admitted execution', async () => {
    const location = freshLocation();
    const outcome = await withRun(location, {}, async (run, fixture) => {
      const saved = requestKey();
      const report = await run.resolveFold(fixture.report, saved);
      const resolved = await expectResolutionError(run.resolve(fixture.report, requestKey()), 'invalid-request');
      const checked = await expectResolutionError(run.check(fixture.report), 'invalid-request');
      const recovered = await run.recover(fixture.report, saved);
      return { report, resolved, checked, recovered };
    });
    expect(outcome.resolved.message).toMatch(/strict fold.*resolveFold/u);
    expect(outcome.checked.message).toMatch(/strict fold/u);
    expect(outcome.report.outcome.status).toBe('succeeded');
    const reference = outcome.report.outcome.status === 'succeeded' ? outcome.report.outcome.outcome.reference : undefined;
    expect(outcome.recovered).toEqual({ kind: 'recovered', reference, attemptId: expect.any(Number) });
  });
});
