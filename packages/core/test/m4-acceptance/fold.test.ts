/**
 * M4 acceptance, strict fold readiness and coverage through the assembled
 * path (A-11 M4 portion, RUN-004, RUN-005, RUN-010, TEST-4 item 6). Every step
 * is an independent Node process over one SQLite History file; later
 * processes register in reverse and see the upstream listing reversed.
 *
 * "Pending" here is a member whose required work admission refused in this
 * run: never a terminal failure and never an empty success. A member failure
 * is an author error injected through the world. Retry, quota waits,
 * cancellation mechanics and concurrency are M5 and not exercised.
 *
 * Expected keys, scores and counts are derived by hand in `expected.ts`.
 *
 * @see ../../../../docs/spec/acceptance.md (A-11, TEST-4)
 * @see ../../../../docs/spec/operations.md (RUN-004, RUN-005, RUN-010)
 * @see ../../../../docs/plans/m4-composition.md (Strict fold; Planned evidence names)
 */
import { describe, expect, test } from '@jest/globals';

import type { IWorld } from './analysis.js';
import { assessedBy, designatedKeys, reportAt1, reportAt2, reportSubject, scope, summarySubject } from './expected.js';
import { basePullRequests, baseReviews, baseWorld, reversedWorld } from './harness.js';
import { assessed, expectNoFoldWork, expectNoMemberOrReportBodies, expectRetained, freshScenario, removeScenarios, sortedBodies } from './support.js';

removeScenarios();

/** Coverage of a complete report over Ada, Ben and Cy. */
const fullCoverage = { required: [...designatedKeys], skipped: [], closed: true };

describe('strict-fold-readiness', () => {
  test('A-11: with Cy failing, Ben pending and discovery open, Ada publishes and the report fails naming each state; the repair runs only the unfinished members and the report', () => {
    const s = freshScenario();
    const mixed: IWorld = baseWorld({ listing: 'open', failSummary: ['Cy'], decisions: { 'summary/person:ben': 'denied' } });
    const a = s.run({}, mixed);
    expect(a.result.discovery).toMatchObject({ kind: 'keyed', completion: 'open', keys: [...designatedKeys] });
    // The independent sibling completes.
    expect(a.member('person:ada')).toEqual({ status: 'succeeded', kind: 'published', reference: expect.any(String), misses: [] });
    // Pending, never failed: its required work was refused before its body.
    expect(a.member('person:ben')).toEqual({ status: 'pending', refused: 'summary/person:ben', reason: expect.stringMatching(/denied/u) });
    expect(a.member('person:cy')).toEqual({ status: 'failed', code: 'execution-failure', message: expect.any(String), cause: expect.stringMatching(/injected summary failure for Cy/u) });
    expect(sortedBodies(a, 'summary')).toEqual(['Ada', 'Cy']);
    expect(sortedBodies(a, 'activity')).toEqual(['person:ada', 'person:cy']);
    expect(sortedBodies(a, 'assess')).toEqual(assessed('A', [...assessedBy['person:ada'], ...assessedBy['person:cy']]));
    expect(a.result.fold).toEqual({ status: 'failed', failed: ['person:cy'], cancelled: [], pending: ['person:ben'], openDiscovery: true, diagnostic: expect.stringMatching(/person:cy/u) });
    expect(a.result.fold).toMatchObject({ diagnostic: expect.stringMatching(/person:ben/u) });
    expectNoFoldWork(a);
    expect(s.candidates(reportSubject)).toEqual([]);
    expect(s.candidates(summarySubject('person:ben'))).toEqual([]);
    expect(s.candidates(summarySubject('person:cy'))).toEqual([]);

    // Repair: Cy's author error is gone, Ben is admitted and discovery closes.
    const b = s.run({ reverse: true }, reversedWorld(baseWorld()));
    expect(b.bodies('discover')).toHaveLength(1);
    expectRetained(b, a, ['person:ada']);
    expect(sortedBodies(b, 'summary')).toEqual(['Ben', 'Cy']);
    // Cy's activity and assessment completed before its summary failed; they are reused, not rerun.
    expect(b.bodies('activity')).toEqual(['person:ben']);
    expect(sortedBodies(b, 'assess')).toEqual(assessed('A', assessedBy['person:ben']));
    expect(b.bodies('report')).toEqual(['person:ada=succeeded,person:ben=succeeded,person:cy=succeeded']);
    expect(b.result.fold).toEqual({ status: 'succeeded', kind: 'published', reference: expect.any(String), misses: [], coverage: fullCoverage });
    expect(b.result.report).toEqual(reportAt1);

    const c = s.run({ reverse: true }, reversedWorld(baseWorld()));
    expectNoMemberOrReportBodies(c);
    expect(c.result.fold).toMatchObject({ status: 'succeeded', kind: 'reused', reference: b.foldReference });
  });

  test('with nothing failed, a pending member leaves the report waiting, then open discovery alone does; closing discovery runs only the report', () => {
    const s = freshScenario();
    const a = s.run({}, baseWorld({ decisions: { 'summary/person:ben': 'denied' } }));
    expect(a.member('person:ben')).toEqual({ status: 'pending', refused: 'summary/person:ben', reason: expect.stringMatching(/denied/u) });
    expect(a.result.fold).toEqual({ status: 'waiting', pending: ['person:ben'], openDiscovery: false });
    expect(sortedBodies(a, 'summary')).toEqual(['Ada', 'Cy']);
    expectNoFoldWork(a);

    const b = s.run({ reverse: true }, reversedWorld(baseWorld({ listing: 'open' })));
    expect(b.result.discovery).toMatchObject({ kind: 'keyed', completion: 'open', keys: [...designatedKeys] });
    expect(b.bodies('summary')).toEqual(['Ben']);
    expectRetained(b, a, ['person:ada', 'person:cy']);
    expect(b.result.fold).toEqual({ status: 'waiting', pending: [], openDiscovery: true });
    expectNoFoldWork(b);
    expect(s.candidates(reportSubject)).toEqual([]);

    const c = s.run({ reverse: true }, reversedWorld(baseWorld()));
    expect(c.bodies('discover')).toHaveLength(1);
    expect(c.bodies('activity')).toEqual([]);
    expect(c.bodies('assess')).toEqual([]);
    expect(c.bodies('summary')).toEqual([]);
    expect(c.bodies('report')).toHaveLength(1);
    expectRetained(c, a, ['person:ada', 'person:cy']);
    expectRetained(c, b, ['person:ben']);
    expect(c.result.fold).toEqual({ status: 'succeeded', kind: 'published', reference: expect.any(String), misses: [], coverage: fullCoverage });
    expect(c.result.report).toEqual(reportAt1);
  });
});

describe('strict-fold-coverage', () => {
  test('a report body that drops exclusions still carries framework coverage naming required and skipped keys and closure, cold and reused', () => {
    const s = freshScenario();
    const coverage = { required: ['person:ada', 'person:ben'], skipped: ['person:cy'], closed: true };
    const a = s.run({ minimumAuthored: 2, report: 'omits-skipped' }, baseWorld());
    // The body saw Cy's explicit skipped entry but reported no exclusion.
    expect(a.bodies('report')).toEqual(['person:ada=succeeded,person:ben=succeeded,person:cy=skipped']);
    expect(a.result.report).toEqual({ ...reportAt2, excluded: [] });
    expect(a.result.fold).toEqual({ status: 'succeeded', kind: 'published', reference: expect.any(String), misses: [], coverage });

    const b = s.run({ reverse: true, minimumAuthored: 2, report: 'omits-skipped' }, reversedWorld(baseWorld()));
    expectNoMemberOrReportBodies(b);
    expect(b.result.fold).toEqual({
      status: 'succeeded',
      kind: 'reused',
      reference: a.foldReference,
      misses: [],
      coverage,
      accepted: [a.reference('person:ada'), a.reference('person:ben')],
    });
  });
});

describe('closed-empty-population', () => {
  test('a closed zero-member listing is a complete report, distinct from an open empty listing and from discovery that did not settle; neither rewinds it', () => {
    const s = freshScenario();
    // Only out-of-window and pending activity: nobody is discovered.
    const quiet: IWorld = baseWorld({
      pullRequests: basePullRequests().filter((pull) => [98, 99, 204].includes(pull.number)),
      reviews: baseReviews().filter((review) => ['rv-ada-0', 'rv-ada-6', 'rv-ben-4', 'rv-dot-1', 'rv-dot-2'].includes(review.id)),
    });
    const closed = s.run({}, quiet);
    expect(closed.result.discovery).toMatchObject({ kind: 'keyed', completion: 'complete', keys: [] });
    expect(closed.result.members).toEqual({});
    expect(closed.bodies('report')).toEqual(['']);
    expect(closed.result.fold).toEqual({ status: 'succeeded', kind: 'published', reference: expect.any(String), misses: [], coverage: { required: [], skipped: [], closed: true } });
    expect(closed.result.report).toEqual({ ...scope, minimumAuthored: 1, required: [], excluded: [] });

    const open = s.run({ reverse: true }, reversedWorld({ ...quiet, listing: 'open' }));
    expect(open.result.discovery).toMatchObject({ kind: 'keyed', completion: 'open', keys: [] });
    expect(open.result.fold).toEqual({ status: 'waiting', pending: [], openDiscovery: true });
    expectNoFoldWork(open);

    // Discovery must list again (a new revision) but admission refuses it: discovery is missing, not empty.
    const missing = s.run({ reverse: true }, reversedWorld({ ...quiet, revision: 2, decisions: { contributors: 'denied' } }));
    expect(missing.result.discovery).toEqual({ kind: 'pending', reason: expect.stringMatching(/denied/u) });
    expect(missing.bodies('discover')).toEqual([]);
    expect(missing.result.fold).toEqual({ status: 'waiting', pending: [], openDiscovery: true });
    expectNoFoldWork(missing);
    expect(s.candidates(reportSubject)).toEqual([closed.foldReference]);

    const reclosed = s.run({ reverse: true }, reversedWorld({ ...quiet, revision: 2 }));
    expect(reclosed.bodies('report')).toEqual([]);
    expect(reclosed.result.fold).toMatchObject({ status: 'succeeded', kind: 'reused', reference: closed.foldReference, coverage: { required: [], skipped: [], closed: true } });
  });
});
