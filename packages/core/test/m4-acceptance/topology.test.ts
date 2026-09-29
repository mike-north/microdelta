/**
 * M4 acceptance, fixed topology and tracked gates through the assembled path
 * (A-08, CMP-1, CMP-8, CMP-9). Every step is an independent Node process over
 * one SQLite History file; later processes register in reverse and see the
 * upstream listing reversed.
 *
 * - The template's step factory runs once per composition; mutating every
 *   author-owned array, record and input object after composing changes
 *   nothing; an operation created from a result is rejected before any work
 *   is admitted for it.
 * - The gate threshold changes which instances are required, never the
 *   topology; only newly required work runs, and a skip never retracts.
 *
 * Expected keys, scores and counts are derived by hand in `expected.ts`.
 *
 * @see ../../../../docs/spec/acceptance.md (A-08)
 * @see ../../../../docs/spec/composition.md (CMP-1, CMP-8, CMP-9)
 * @see ../../../../docs/plans/m4-composition.md (Templates, keys and gates; Planned evidence names)
 */
import { describe, expect, test } from '@jest/globals';

import { allAssessed, assessedBy, designatedKeys, reportAt1, reportAt2, reportSubject, summarySubject } from './expected.js';
import { baseWorld, reversedWorld } from './harness.js';
import { assessed, expectNoMemberOrReportBodies, expectRetained, freshScenario, removeScenarios, sortedBodies } from './support.js';

removeScenarios();

describe('frozen-template-topology', () => {
  test('the step factory runs once per process, and mutating every author array, record and input after composing changes nothing in a later process', () => {
    const s = freshScenario();
    const a = s.run({}, baseWorld());
    expect(a.result.factoryCalls).toBe(1);

    const b = s.run({ reverse: true, mutateAfterCompose: true }, reversedWorld(baseWorld()));
    expect(b.result.factoryCalls).toBe(1);
    expect(b.result.topology).toBe(a.result.topology);
    // The threshold, window and rubric inputs were mutated after composing; the frozen copies still select and score as before.
    expectNoMemberOrReportBodies(b);
    expectRetained(b, a, designatedKeys);
    expect(b.result.fold).toMatchObject({ status: 'succeeded', kind: 'reused', reference: a.foldReference, misses: [] });
    expect(b.result.report).toEqual(reportAt1);
  });

  test('an operation created from a result is rejected before any work is admitted for it; nothing is published for it or for the summaries that tried it', () => {
    const s = freshScenario();
    const a = s.run({ summary: 'result-created' }, baseWorld());
    for (const key of designatedKeys) {
      expect(a.member(key)).toEqual({ status: 'failed', code: 'execution-failure', message: expect.any(String), cause: expect.stringMatching(/^DefinitionError: .*is frozen/u) });
      expect(s.candidates(summarySubject(key))).toEqual([]);
    }
    // The created operation never reached admission; each summary's own work and its activity did.
    expect(a.admissions.filter((admission) => admission.includes('created:'))).toEqual([]);
    expect(a.admissions.filter((admission) => admission.startsWith('memo:')).sort()).toEqual(designatedKeys.map((key) => `memo:${summarySubject(key)}`));
    expect(a.bodies('summary')).toEqual([]);
    expect(a.bodies('assess')).toEqual([]);
    expect(a.result.fold).toEqual({ status: 'failed', failed: [...designatedKeys], cancelled: [], pending: [], openDiscovery: false, diagnostic: expect.any(String) });
    expect(s.candidates(reportSubject)).toEqual([]);

    // The standard composition has the same frozen topology and publishes each summary once, as its only candidate.
    const b = s.run({ reverse: true }, reversedWorld(baseWorld()));
    expect(b.result.topology).toBe(a.result.topology);
    expect(b.bodies('activity')).toEqual([]);
    expect(sortedBodies(b, 'assess')).toEqual(assessed('A', allAssessed));
    expect(sortedBodies(b, 'summary')).toEqual(['Ada', 'Ben', 'Cy']);
    for (const key of designatedKeys) {
      expect(s.candidates(summarySubject(key))).toEqual([b.reference(key)]);
    }
    expect(b.result.report).toEqual(reportAt1);
  });
});

describe('tracked-gate-instances', () => {
  test('with a report that does not read the threshold, a gate flip reaches the fold only through membership, and a flip-free edit runs nothing at all', () => {
    const s = freshScenario();
    const unstated = { report: 'omits-threshold' } as const;
    const a = s.run({ ...unstated, minimumAuthored: 2 }, baseWorld());
    expect(a.result.report).toEqual({ ...reportAt2, minimumAuthored: null });

    const lowered = s.run({ ...unstated, reverse: true, minimumAuthored: 1 }, reversedWorld(baseWorld()));
    expect(lowered.bodies('summary')).toEqual(['Cy']);
    expect(lowered.bodies('report')).toHaveLength(1);
    expect(lowered.result.fold).toMatchObject({ status: 'succeeded', kind: 'published', misses: ['changed-membership'], coverage: { required: [...designatedKeys], skipped: [], closed: true } });
    expect(lowered.result.report).toEqual({ ...reportAt1, minimumAuthored: null });

    const flipFree = s.run({ ...unstated, reverse: true, minimumAuthored: 0 }, reversedWorld(baseWorld()));
    expectNoMemberOrReportBodies(flipFree);
    expect(flipFree.admissions).toEqual([]);
    expect(flipFree.result.fold).toMatchObject({ status: 'succeeded', kind: 'reused', reference: lowered.foldReference, misses: [] });

    const raised = s.run({ ...unstated, reverse: true, minimumAuthored: 2 }, reversedWorld(baseWorld()));
    expectNoMemberOrReportBodies(raised);
    expect(raised.result.fold).toMatchObject({ status: 'succeeded', kind: 'reused', reference: a.foldReference, misses: ['changed-membership'] });
  });

  test('lowering the threshold requires never-run Cy without changing topology and runs only Cy\'s work and the report; a flip-free threshold runs no member work; raising it again skips Cy without retracting it', () => {
    const s = freshScenario();
    const a = s.run({ minimumAuthored: 2 }, baseWorld());
    expect(a.member('person:cy')).toEqual({ status: 'skipped' });
    expect(sortedBodies(a, 'activity')).toEqual(['person:ada', 'person:ben']);
    expect(sortedBodies(a, 'assess')).toEqual(assessed('A', [...assessedBy['person:ada'], ...assessedBy['person:ben']]));
    expect(sortedBodies(a, 'summary')).toEqual(['Ada', 'Ben']);
    // The body received an explicit skipped entry for Cy.
    expect(a.bodies('report')).toEqual(['person:ada=succeeded,person:ben=succeeded,person:cy=skipped']);
    expect(a.admissions.filter((admission) => admission.includes('person:cy') || admission.endsWith(':301'))).toEqual([]);
    expect(a.result.fold).toMatchObject({ status: 'succeeded', kind: 'published', coverage: { required: ['person:ada', 'person:ben'], skipped: ['person:cy'], closed: true } });
    expect(a.result.report).toEqual(reportAt2);

    const lowered = s.run({ reverse: true, minimumAuthored: 1 }, reversedWorld(baseWorld()));
    expect(lowered.result.topology).toBe(a.result.topology);
    expect(lowered.bodies('activity')).toEqual(['person:cy']);
    expect(lowered.bodies('assess')).toEqual(assessed('A', assessedBy['person:cy']));
    expect(lowered.bodies('summary')).toEqual(['Cy']);
    expect(lowered.bodies('report')).toEqual(['person:ada=succeeded,person:ben=succeeded,person:cy=succeeded']);
    expectRetained(lowered, a, ['person:ada', 'person:ben']);
    expect(lowered.member('person:cy')).toEqual({ status: 'succeeded', kind: 'published', reference: expect.any(String), misses: [] });
    // The report states the threshold it consumed, so its own evidence misses first; the new membership is in its coverage.
    expect(lowered.result.fold).toMatchObject({ status: 'succeeded', kind: 'published', misses: ['changed'], coverage: { required: [...designatedKeys], skipped: [], closed: true } });
    expect(lowered.result.report).toEqual(reportAt1);

    // Threshold 0 flips no gate: no member work runs. The report states its threshold, so it alone reruns.
    const flipFree = s.run({ reverse: true, minimumAuthored: 0 }, reversedWorld(baseWorld()));
    expect(flipFree.result.topology).toBe(a.result.topology);
    expect(flipFree.bodies('activity')).toEqual([]);
    expect(flipFree.bodies('assess')).toEqual([]);
    expect(flipFree.bodies('summary')).toEqual([]);
    expectRetained(flipFree, lowered, designatedKeys);
    expect(flipFree.bodies('report')).toHaveLength(1);
    expect(flipFree.result.report).toEqual({ ...reportAt1, minimumAuthored: 0 });

    const raised = s.run({ reverse: true, minimumAuthored: 2 }, reversedWorld(baseWorld()));
    expect(raised.result.topology).toBe(a.result.topology);
    expect(raised.member('person:cy')).toEqual({ status: 'skipped' });
    expectNoMemberOrReportBodies(raised);
    expect(raised.admissions).toEqual([]);
    expectRetained(raised, a, ['person:ada', 'person:ben']);
    // The skipped membership and threshold equal process A's: its exact report validates.
    expect(raised.result.fold).toMatchObject({ status: 'succeeded', kind: 'reused', reference: a.foldReference, coverage: { required: ['person:ada', 'person:ben'], skipped: ['person:cy'], closed: true } });
    // A skip never retracts Cy's publication.
    expect(s.candidates(summarySubject('person:cy'))).toEqual([lowered.reference('person:cy')]);
  });
});
