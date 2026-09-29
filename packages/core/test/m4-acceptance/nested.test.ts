/**
 * M4 acceptance, nested memoized calls through a supplied assessor in the
 * assembled path (A-05, A-06, TEST-4 item 5, CMP-3/6, REUSE-007). Every step
 * is an independent Node process over one SQLite History file; later
 * processes register in reverse and see the upstream listing reversed.
 *
 * - A child *input* change with equal consumed scores (the rubric wording)
 *   reruns assessments only; summaries and the report keep their exact
 *   references. A child input change that alters one consumed score (the
 *   merged-bug score, read only for Ben's PR 201) reruns that assessment,
 *   Ben's summary and the report only.
 * - Binding another implementation to the `assessor` slot is a child
 *   implementation change, not a parent graph change: the same cutoff rules
 *   apply (rubric B scores equal; rubric C changes Ada's and Ben's scores).
 * - A missing or ambiguous slot, an unreconstructible argument and an argument
 *   derived after an observed untracked read are honest parent misses with
 *   distinct reasons and diagnostics; there is no validation-only replay, and
 *   children reuse where the parent can run.
 *
 * Expected scores are derived by hand in `expected.ts`.
 *
 * @see ../../../../docs/spec/acceptance.md (A-05, A-06, TEST-4)
 * @see ../../../../docs/spec/composition.md (CMP-3, CMP-6)
 * @see ../../../../docs/spec/execution.md (REUSE-007)
 * @see ../../../../docs/plans/m4-composition.md (Nested invocation evidence; Planned evidence names)
 */
import { describe, expect, test } from '@jest/globals';

import type { IVariation } from './analysis.js';
import { ada, allAssessed, assessmentSubject, ben, cy, designatedKeys, entry, reportAt1 } from './expected.js';
import { baseWorld, reversedWorld } from './harness.js';
import { assessed, expectNoMemberOrReportBodies, expectRetained, freshScenario, removeScenarios, sortedBodies } from './support.js';

removeScenarios();

describe('nested-equal-output-cutoff', () => {
  test('a rubric wording change reruns every assessment once; summaries and the report keep their exact references with zero bodies', () => {
    const s = freshScenario();
    const a = s.run({}, baseWorld());
    const b = s.run({ reverse: true, rubric: { wording: 'revised', mergedBugScore: 2 } }, reversedWorld(baseWorld()));
    expect(sortedBodies(b, 'assess')).toEqual(assessed('A', allAssessed));
    expect(b.bodies('activity')).toEqual([]);
    expect(b.bodies('summary')).toEqual([]);
    expect(b.bodies('report')).toEqual([]);
    expectRetained(b, a, designatedKeys);
    expect(b.result.fold).toMatchObject({ status: 'succeeded', kind: 'reused', reference: a.foldReference, misses: [] });
    // TEST-4.5: provenance and current acceptance stay distinguishable. Ada's summary keeps its
    // original exact reference, whose recorded dependencies still name the cold assessments, while
    // this run's acceptance of it names the new assessment results.
    const adaActivity = s.candidates('activity:acme/widget:2026-Q1:person:ada');
    expect(adaActivity).toHaveLength(1);
    const latest = (number: string): string => s.candidates(assessmentSubject(number))[0] ?? '';
    const earliest = (number: string): string => s.candidates(assessmentSubject(number))[1] ?? '';
    const adaCalls = ['101', '102', '103'];
    expect([...(b.member('person:ada').accepted ?? [])].sort()).toEqual([...adaActivity, ...adaCalls.map(latest)].sort());
    expect([...s.dependencies(a.reference('person:ada'))].sort()).toEqual([...adaActivity, ...adaCalls.map(earliest)].sort());
    // Each assessment has a new exact result beside the retained one; only its explanation changed.
    for (const number of allAssessed) {
      const [latest, earlier] = s.candidates(assessmentSubject(number));
      expect(s.candidates(assessmentSubject(number))).toHaveLength(2);
      expect(s.read(latest ?? '')).toMatchObject({ explanation: expect.stringMatching(/^revised: rubric A scores PR/u) });
      expect(s.read(earlier ?? '')).toMatchObject({ explanation: expect.stringMatching(/^standard: rubric A scores PR/u) });
    }
  });
});

describe('nested-changed-output', () => {
  test('a changed merged-bug score reruns only PR 201\'s assessment, Ben\'s summary and the report; Ada and Cy keep their exact references', () => {
    const s = freshScenario();
    const a = s.run({}, baseWorld());
    const b = s.run({ reverse: true, rubric: { wording: 'standard', mergedBugScore: 3 } }, reversedWorld(baseWorld()));
    expect(b.bodies('assess')).toEqual(assessed('A', ['201']));
    expect(b.bodies('activity')).toEqual([]);
    expect(b.bodies('summary')).toEqual(['Ben']);
    expect(b.bodies('report')).toHaveLength(1);
    expectRetained(b, a, ['person:ada', 'person:cy']);
    expect(b.member('person:ben')).toEqual({ status: 'succeeded', kind: 'published', reference: expect.any(String), misses: ['changed-child-output'] });
    expect(b.reference('person:ben')).not.toBe(a.reference('person:ben'));
    expect(b.result.summaries['person:ben']).toEqual({ ...ben, score: 4 });
    expect(b.result.fold).toMatchObject({ status: 'succeeded', kind: 'published', misses: ['changed-member-output'] });
    expect(b.result.report).toEqual({ ...reportAt1, required: [entry('person:ada', ada), entry('person:ben', ben, 4), entry('person:cy', cy)] });
    expect(s.candidates(assessmentSubject('201'))).toHaveLength(2);
    expect(s.candidates(assessmentSubject('202'))).toHaveLength(1);
  });
});

describe('supplied-assessor-swap', () => {
  test('binding rubric B is a child implementation change with equal scores (parents retained); binding rubric C changes Ada\'s and Ben\'s consumed scores (only they and the report rerun)', () => {
    const s = freshScenario();
    const a = s.run({}, baseWorld());

    const swappedB = s.run({ reverse: true, assessor: 'B' }, reversedWorld(baseWorld()));
    expect(sortedBodies(swappedB, 'assess')).toEqual(assessed('B', allAssessed));
    expect(swappedB.bodies('activity')).toEqual([]);
    expect(swappedB.bodies('summary')).toEqual([]);
    expect(swappedB.bodies('report')).toEqual([]);
    // Not a parent graph change: every summary keeps its exact reference with no correspondence miss.
    expectRetained(swappedB, a, designatedKeys);
    expect(swappedB.result.fold).toMatchObject({ status: 'succeeded', kind: 'reused', reference: a.foldReference, misses: [] });

    const swappedC = s.run({ reverse: true, assessor: 'C' }, reversedWorld(baseWorld()));
    expect(sortedBodies(swappedC, 'assess')).toEqual(assessed('C', allAssessed));
    expect(swappedC.bodies('activity')).toEqual([]);
    expect(sortedBodies(swappedC, 'summary')).toEqual(['Ada', 'Ben']);
    expect(swappedC.bodies('report')).toHaveLength(1);
    expectRetained(swappedC, a, ['person:cy']);
    for (const key of ['person:ada', 'person:ben']) {
      expect(swappedC.member(key)).toEqual({ status: 'succeeded', kind: 'published', reference: expect.any(String), misses: ['changed-child-output'] });
    }
    expect(swappedC.result.summaries).toEqual({ 'person:ada': { ...ada, score: 4 }, 'person:ben': { ...ben, score: 2 }, 'person:cy': cy });
    expect(swappedC.result.fold).toMatchObject({ status: 'succeeded', kind: 'published', misses: ['changed-member-output'] });
    expect(swappedC.result.report).toEqual({ ...reportAt1, required: [entry('person:ada', ada, 4), entry('person:ben', ben, 2), entry('person:cy', cy)] });
  });
});

describe('binding-and-argument-misses', () => {
  test.each([
    ['a missing assessor slot', { assessor: 'none' }, 'missing-binding', /callable slot assessor has no current binding/u, /assessor has no current implementation/u],
    ['an ambiguous assessor slot', { assessor: 'A+B' }, 'ambiguous-binding', /callable slot assessor has 2 current bindings/u, /assessor has 2 current implementations/u],
  ] as const)('%s on restart is a distinct honest miss and a typed member failure: no summary body, no child work and no admission at all', (_label, change, reason, detail, diagnostic) => {
    const s = freshScenario();
    const a = s.run({}, baseWorld());
    const b = s.run({ reverse: true, ...change }, reversedWorld(baseWorld()), { check: [...designatedKeys] });
    for (const key of designatedKeys) {
      expect(b.result.checks[key]).toEqual({ kind: 'execution-required', misses: [{ reason, detail: expect.stringMatching(detail) }] });
      expect(b.member(key)).toEqual({ status: 'failed', code: 'unbound-step', message: expect.stringMatching(diagnostic), cause: expect.any(String) });
      expect(b.phases('summary', key)).not.toContain('execute');
    }
    expectNoMemberOrReportBodies(b);
    expect(b.bodies('discover')).toEqual([]);
    expect(b.admissions).toEqual([]);
    expect(b.result.fold).toEqual({ status: 'failed', failed: [...designatedKeys], cancelled: [], pending: [], openDiscovery: false, diagnostic: expect.any(String) });
    // Nothing was retracted: each summary still has exactly its cold result.
    for (const key of designatedKeys) {
      expect(s.candidates(`summary:acme/widget:2026-Q1:${key}`)).toEqual([a.reference(key)]);
    }
  });

  test.each([
    ['an unreconstructible argument', 'unreconstructible', 'unreconstructible-argument', /kept no value \(function\)/u],
    ['an argument derived after an observed untracked read', 'untracked', 'unjustified-argument', /derived after an observed untracked read/u],
  ] as const)('%s makes each parent an honest miss that runs its body once, while its activity and assessments reuse and the report keeps its exact reference', (_label, summary, reason, diagnostic) => {
    const s = freshScenario();
    const variation: IVariation = { summary };
    const a = s.run(variation, baseWorld());
    expect(a.result.summaries).toEqual({ 'person:ada': ada, 'person:ben': ben, 'person:cy': cy });

    const b = s.run({ ...variation, reverse: true }, reversedWorld(baseWorld()), { check: [...designatedKeys] });
    for (const key of designatedKeys) {
      expect(b.result.checks[key]).toEqual({ kind: 'execution-required', misses: [{ reason, detail: expect.stringMatching(diagnostic) }] });
      expect(b.member(key)).toEqual({ status: 'succeeded', kind: 'published', reference: expect.any(String), misses: [reason] });
      // One ordinary execution per parent: no separate validation replay of the body.
      expect(b.phases('summary', key).filter((phase) => phase === 'execute')).toEqual(['execute']);
    }
    expect(sortedBodies(b, 'summary')).toEqual(['Ada', 'Ben', 'Cy']);
    expect(b.bodies('activity')).toEqual([]);
    expect(b.bodies('assess')).toEqual([]);
    expect(b.bodies('discover')).toEqual([]);
    expect(b.result.summaries).toEqual(a.result.summaries);
    // Equal parent outputs: the report is retained.
    expect(b.bodies('report')).toEqual([]);
    expect(b.result.fold).toMatchObject({ status: 'succeeded', kind: 'reused', reference: a.foldReference, misses: [] });
    for (const number of allAssessed) {
      expect(s.candidates(assessmentSubject(number))).toHaveLength(1);
    }
  });

  test('with no change at all, the standard summary is retained: the misses above are caused by their variants, not by restart', () => {
    const s = freshScenario();
    const a = s.run({}, baseWorld());
    const b = s.run({ reverse: true }, reversedWorld(baseWorld()), { check: [...designatedKeys] });
    for (const key of designatedKeys) {
      expect(b.result.checks[key]).toEqual({ kind: 'reusable', misses: [] });
    }
    expectNoMemberOrReportBodies(b);
    expectRetained(b, a, designatedKeys);
  });
});
