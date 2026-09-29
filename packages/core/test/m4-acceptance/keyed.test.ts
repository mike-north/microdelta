/**
 * M4 acceptance, keyed collections through the assembled path (TEST-1/2,
 * A-07, TEST-4 item 3). Every step is an independent Node process over one
 * SQLite History file; later processes register helpers, steps, templates and
 * supplies in reverse and see the upstream listing in reverse profile order.
 * Expected statistics, scores, sentences, keys and body counts are written by
 * hand from the plan's fixture rules (`expected.ts`).
 *
 * @see ../../../../docs/spec/acceptance.md (TEST-1, TEST-2, A-07, TEST-4)
 * @see ../../../../docs/spec/tracking.md (COL-1, COL-3)
 * @see ../../../../docs/plans/m4-composition.md (Outcomes to prove; Planned evidence names)
 */
import { describe, expect, test } from '@jest/globals';

import type { IWorld, IWorldProfile } from './analysis.js';
import { ada, adaWithPr100, allAssessed, assessmentSubject, ben, customKeys, cy, designatedKeys, dot, entry, reportAt1, scope, summarySubject } from './expected.js';
import { basePullRequests, baseReviews, baseWorld, reversedWorld } from './harness.js';
import { assessed, expectNoMemberBodies, expectNoMemberOrReportBodies, expectRetained, freshScenario, removeScenarios, sortedBodies } from './support.js';

removeScenarios();

/** The full cold coverage of Ada, Ben and Cy at threshold 1. */
const fullCoverage = { required: [...designatedKeys], skipped: [], closed: true };

describe('keyed-cold-and-restarted-report', () => {
  test('a cold process discovers Ada, Ben and Cy and runs every body once; an unchanged restart in reversed registration runs zero member, assessment and report bodies and keeps every exact reference', () => {
    const s = freshScenario();
    const a = s.run({}, baseWorld());
    expect(a.result.discovery).toEqual({ kind: 'keyed', completion: 'complete', keys: [...designatedKeys], reference: expect.any(String) });
    expect(a.bodies('discover')).toHaveLength(1);
    expect(sortedBodies(a, 'activity')).toEqual([...designatedKeys]);
    expect(sortedBodies(a, 'assess')).toEqual(assessed('A', allAssessed));
    expect(sortedBodies(a, 'summary')).toEqual(['Ada', 'Ben', 'Cy']);
    expect(a.bodies('report')).toEqual(['person:ada=succeeded,person:ben=succeeded,person:cy=succeeded']);
    for (const key of designatedKeys) {
      expect(a.member(key)).toEqual({ status: 'succeeded', kind: 'published', reference: expect.any(String), misses: [] });
    }
    expect(a.result.summaries).toEqual({ 'person:ada': ada, 'person:ben': ben, 'person:cy': cy });
    expect(a.result.fold).toEqual({ status: 'succeeded', kind: 'published', reference: expect.any(String), misses: [], coverage: fullCoverage });
    expect(a.result.report).toEqual(reportAt1);
    expect(a.result.factoryCalls).toBe(1);
    // Each assessment published once under its argument-derived subject.
    const coldAssessments = allAssessed.map((number) => s.candidates(assessmentSubject(number)));
    for (const candidates of coldAssessments) {
      expect(candidates).toHaveLength(1);
    }

    const b = s.run({ reverse: true }, reversedWorld(baseWorld()));
    expect(b.result.topology).toBe(a.result.topology);
    // Discovery and every activity ran their current finality policy, which accepted; no check ran.
    expect(b.phases('contributors', null)).toContain('finality');
    for (const key of designatedKeys) {
      expect(b.phases('activity', key)).toContain('finality');
    }
    expect(b.bodies('discover')).toEqual([]);
    expectNoMemberOrReportBodies(b);
    expect(b.admissions).toEqual([]);
    expectRetained(b, a, designatedKeys);
    expect(b.result.fold).toEqual({
      status: 'succeeded',
      kind: 'reused',
      reference: a.foldReference,
      misses: [],
      coverage: fullCoverage,
      accepted: designatedKeys.map((key) => a.reference(key)),
    });
    expect(b.result.summaries).toEqual(a.result.summaries);
    expect(b.result.report).toEqual(reportAt1);
    expect(allAssessed.map((number) => s.candidates(assessmentSubject(number)))).toEqual(coldAssessments);

    // TEST-2: every display label renamed in a later process changes no correspondence and runs nothing.
    const relabelled = s.run({ reverse: true, labels: 'renamed' }, reversedWorld(baseWorld()));
    expect(relabelled.bodies('discover')).toEqual([]);
    expectNoMemberOrReportBodies(relabelled);
    expect(relabelled.admissions).toEqual([]);
    expectRetained(relabelled, a, designatedKeys);
    expect(relabelled.result.fold).toMatchObject({ status: 'succeeded', kind: 'reused', reference: a.foldReference, misses: [] });
    expect(relabelled.result.report).toEqual(reportAt1);
    expect(allAssessed.map((number) => s.candidates(assessmentSubject(number)))).toEqual(coldAssessments);
  });
});

describe('discovery-insert-delete-reorder', () => {
  test('an inserted contributor runs once and reruns the report; a deleted one is no longer required and never retracted; a reorder alone runs no member or report body', () => {
    const s = freshScenario();
    const a = s.run({}, baseWorld());

    // Dot's PR 401 (open, in the window) makes Dot a discovered contributor; the listing revision changes.
    const withDot: IWorld = baseWorld({ revision: 2, pullRequests: [...basePullRequests(), { number: 401, author: 'gh:4004', createdAt: '2026-02-20T12:00:00Z', merged: false, labels: [] }] });
    const inserted = s.run({ reverse: true }, reversedWorld(withDot));
    expect(inserted.result.discovery).toMatchObject({ kind: 'keyed', completion: 'complete', keys: [...designatedKeys, 'person:dot'] });
    expect(inserted.bodies('discover')).toHaveLength(1);
    expect(inserted.bodies('activity')).toEqual(['person:dot']);
    expect(inserted.bodies('assess')).toEqual(assessed('A', ['401']));
    expect(inserted.bodies('summary')).toEqual(['Dot']);
    expect(inserted.bodies('report')).toEqual(['person:ada=succeeded,person:ben=succeeded,person:cy=succeeded,person:dot=succeeded']);
    expectRetained(inserted, a, designatedKeys);
    expect(inserted.member('person:dot')).toEqual({ status: 'succeeded', kind: 'published', reference: expect.any(String), misses: [] });
    expect(inserted.result.summaries['person:dot']).toEqual(dot);
    // Member work admitted in this process is Dot's alone.
    expect(inserted.admissions.filter((admission) => !admission.includes('contributors:') && !admission.includes('report:'))).toEqual([
      'memo:summary:acme/widget:2026-Q1:person:dot',
      'source:activity:acme/widget:2026-Q1:person:dot',
      'supplied:assessment:acme/widget:401',
    ]);
    expect(inserted.result.fold).toMatchObject({ status: 'succeeded', kind: 'published', misses: ['changed-membership'], coverage: { required: [...designatedKeys, 'person:dot'], skipped: [], closed: true } });
    expect(inserted.result.report).toEqual({ ...reportAt1, required: [...reportAt1.required, entry('person:dot', dot)] });

    // Cy's only in-window records (PR 301, review rv-cy-1) disappear upstream, so Cy is not discovered.
    const withoutCy: IWorld = {
      ...withDot,
      revision: 3,
      pullRequests: withDot.pullRequests.filter((pull) => pull.number !== 301),
      reviews: baseReviews().filter((review) => review.id !== 'rv-cy-1'),
    };
    const deleted = s.run({ reverse: true }, reversedWorld(withoutCy));
    expect(deleted.result.discovery).toMatchObject({ kind: 'keyed', keys: ['person:ada', 'person:ben', 'person:dot'] });
    expect(Object.keys(deleted.result.members)).toEqual(['person:ada', 'person:ben', 'person:dot']);
    expectNoMemberBodies(deleted);
    expectRetained(deleted, a, ['person:ada', 'person:ben']);
    expectRetained(deleted, inserted, ['person:dot']);
    expect(deleted.bodies('report')).toEqual(['person:ada=succeeded,person:ben=succeeded,person:dot=succeeded']);
    // Both earlier report results were folded over another membership.
    expect(deleted.result.fold).toMatchObject({ status: 'succeeded', kind: 'published', misses: ['changed-membership', 'changed-membership'] });
    expect(deleted.result.report).toEqual({ ...reportAt1, required: [entry('person:ada', ada), entry('person:ben', ben), entry('person:dot', dot)] });
    // Cy's publication is neither retracted nor superseded.
    expect(s.candidates(summarySubject('person:cy'))).toEqual([a.reference('person:cy')]);
    expect(s.read(a.reference('person:cy'))).toEqual(cy);

    // The same content listed in another order: discovery lists again, nothing else runs.
    const reordered = s.run({ reverse: true }, { ...withoutCy, revision: 4 });
    expect(reordered.bodies('discover')).toHaveLength(1);
    expectNoMemberOrReportBodies(reordered);
    expectRetained(reordered, deleted, ['person:ada', 'person:ben', 'person:dot']);
    expect(reordered.result.fold).toMatchObject({ status: 'succeeded', kind: 'reused', reference: deleted.foldReference, misses: [] });
  });

  test('a refreshed member source hook with equal data rechecks activities only; a new PR for Ada reruns her activity, summary and the report, assessing only the new PR across the shifted forwarded indices', () => {
    const s = freshScenario();
    const a = s.run({}, baseWorld());

    // The member source policy no longer accepts previous activity; upstream data is unchanged.
    const refreshed = s.run({ reverse: true }, reversedWorld(baseWorld({ activityFinal: false })));
    expect(refreshed.bodies('discover')).toEqual([]);
    expect(sortedBodies(refreshed, 'activity')).toEqual([...designatedKeys]);
    expect(refreshed.bodies('assess')).toEqual([]);
    expect(refreshed.bodies('summary')).toEqual([]);
    expect(refreshed.bodies('report')).toEqual([]);
    expectRetained(refreshed, a, designatedKeys);
    expect(refreshed.result.fold).toMatchObject({ status: 'succeeded', kind: 'reused', reference: a.foldReference, misses: [] });

    // Ada's new merged PR 100 sorts before 101, so each of her earlier PRs moves one forwarded index later.
    const withPr100: IWorld = baseWorld({
      revision: 2,
      activityFinal: false,
      pullRequests: [...basePullRequests(), { number: 100, author: 'gh:1001', createdAt: '2026-01-05T09:00:00Z', merged: true, labels: [] }],
    });
    const grown = s.run({ reverse: true }, reversedWorld(withPr100));
    expect(grown.bodies('discover')).toHaveLength(1);
    expect(sortedBodies(grown, 'activity')).toEqual([...designatedKeys]);
    // Only the new PR is assessed: 101, 102 and 103 reconnect by their derived numbers and forwarded origins.
    expect(grown.bodies('assess')).toEqual(assessed('A', ['100']));
    expect(grown.bodies('summary')).toEqual(['Ada']);
    expect(grown.bodies('report')).toHaveLength(1);
    expect(grown.member('person:ada')).toEqual({ status: 'succeeded', kind: 'published', reference: expect.any(String), misses: ['changed-child-output'] });
    expect(grown.result.summaries['person:ada']).toEqual(adaWithPr100);
    expectRetained(grown, a, ['person:ben', 'person:cy']);
    expect(grown.result.fold).toMatchObject({ status: 'succeeded', kind: 'published', misses: ['changed-member-output'], coverage: { required: [...designatedKeys], skipped: [], closed: true } });
    expect(grown.result.report).toEqual({ ...reportAt1, required: [entry('person:ada', adaWithPr100), entry('person:ben', ben), entry('person:cy', cy)] });
    for (const number of ['101', '102', '103']) {
      expect(s.candidates(assessmentSubject(number))).toHaveLength(1);
    }
    expect(s.candidates(assessmentSubject('100'))).toHaveLength(1);
  });
});

describe('duplicate-and-missing-identity', () => {
  /** A second upstream account whose profile claims Ben's designated identity, with one in-window review. */
  const duplicateBen: Pick<IWorld, 'profiles' | 'reviews'> = {
    profiles: [...baseWorld().profiles, { key: 'person:ben', id: 'gh:2020', name: 'Ben Two', avatarUrl: 'https://avatars.example/ben2.png' }],
    reviews: [...baseReviews(), { id: 'rv-ben2-1', author: 'gh:2020', submittedAt: '2026-02-10T10:00:00Z', state: 'submitted' }],
  };
  /** Ada's upstream profile without designated identity. */
  const keylessAda: Pick<IWorld, 'profiles'> = {
    profiles: baseWorld().profiles.map((profile): IWorldProfile => (profile.id === 'gh:1001' ? { id: profile.id, name: profile.name, avatarUrl: profile.avatarUrl } : profile)),
  };

  test.each([
    ['a duplicate designated key', duplicateBen, { reason: 'duplicate-key', key: 'person:ben' }, /person:ben/u],
    ['a record without designated identity', keylessAda, { reason: 'missing-key', key: null }, /designated identity field "key"/u],
  ] as const)('%s rejects discovery with a diagnostic naming the collection and key and pointing to the custom key; no member work is admitted, and a corrected listing reconnects every member', (_label, change, diagnostic, names) => {
    const s = freshScenario();
    const a = s.run({}, baseWorld());

    const rejected = s.run({ reverse: true }, reversedWorld(baseWorld({ revision: 2, ...change })));
    expect(rejected.result.discovery).toEqual({ kind: 'rejected', collection: 'contributors', template: 'contributor', identity: 'key', customKey: false, message: expect.stringMatching(names), ...diagnostic });
    expect(rejected.result.discovery).toMatchObject({ message: expect.stringMatching(/custom key/u) });
    expect(rejected.result.members).toEqual({});
    expectNoMemberOrReportBodies(rejected);
    // Only discovery's own listing check was admitted.
    expect(rejected.admissions).toEqual(['source:contributors:acme/widget:2026-Q1']);
    expect(rejected.result.fold).toEqual({ status: 'failed', failed: [], cancelled: [], pending: [], openDiscovery: false, diagnostic: expect.stringMatching(/rejected/u) });
    expect(rejected.result.report).toBeNull();

    const corrected = s.run({ reverse: true }, reversedWorld(baseWorld({ revision: 3 })));
    expectNoMemberOrReportBodies(corrected);
    expectRetained(corrected, a, designatedKeys);
    expect(corrected.result.fold).toMatchObject({ status: 'succeeded', kind: 'reused', reference: a.foldReference });
  });
});

describe('custom-key-correspondence', () => {
  test('members keyed by upstream profile id reconnect after a reordered, reverse-registered restart in which every designated key was renamed', () => {
    const s = freshScenario();
    const a = s.run({ key: 'id' }, baseWorld());
    expect(a.result.discovery).toMatchObject({ kind: 'keyed', completion: 'complete', keys: [...customKeys] });
    expect(a.result.summaries).toEqual({ 'gh:1001': ada, 'gh:2002': ben, 'gh:3003': cy });
    expect(a.result.fold).toMatchObject({ status: 'succeeded', kind: 'published', coverage: { required: [...customKeys], skipped: [], closed: true } });
    expect(a.result.report).toEqual({ ...scope, minimumAuthored: 1, required: [entry('gh:1001', ada), entry('gh:2002', ben), entry('gh:3003', cy)], excluded: [] });
    // Instances are addressed by the custom key, never by designated identity.
    expect(s.candidates(summarySubject('gh:1001'))).toEqual([a.reference('gh:1001')]);
    expect(s.candidates(summarySubject('person:ada'))).toEqual([]);

    const renamed: IWorld = baseWorld({
      revision: 2,
      profiles: baseWorld().profiles.map((profile) => (profile.key === undefined ? profile : { ...profile, key: `${profile.key}-renamed` })),
    });
    const b = s.run({ key: 'id', reverse: true }, reversedWorld(renamed));
    expect(b.result.discovery).toMatchObject({ kind: 'keyed', keys: [...customKeys] });
    expect(b.bodies('discover')).toHaveLength(1);
    // Same instances: each activity consumed its member's designated key, which changed, so it checks again...
    expect(sortedBodies(b, 'activity')).toEqual(['person:ada-renamed', 'person:ben-renamed', 'person:cy-renamed']);
    // ...and selects equal activity, so no assessment, summary or report body runs.
    expect(b.bodies('assess')).toEqual([]);
    expect(b.bodies('summary')).toEqual([]);
    expect(b.bodies('report')).toEqual([]);
    expectRetained(b, a, customKeys);
    expect(b.result.fold).toMatchObject({ status: 'succeeded', kind: 'reused', reference: a.foldReference, misses: [] });
  });
});
