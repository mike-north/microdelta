/**
 * `trial-production-isolation` (RUN-016, RUN-017): environments namespaced
 * within one store, in separate processes over the assembled facade path.
 *
 * Expectations, written by hand from the owner decision (RUN-017):
 *
 * - Results, heads, attempts, acceptances, operations and accounting are
 *   isolated per environment. A trial's complete results never satisfy
 *   production by accident: a production check finds nothing reusable, and a
 *   production run without a promotion executes and pays for its own work,
 *   leaving the trial's results and usage untouched.
 * - Trial work satisfies production only through an explicit, recorded
 *   promotion of exact references, made under the writer lease. Afterwards a
 *   production run reuses every promoted result with its exact trial
 *   reference (provenance preserved), executes nothing and pays nothing; the
 *   promotion is listed for production.
 *
 * @see ../../../../docs/spec/operations.md (RUN-016, RUN-017)
 * @see ../../../../docs/plans/m5-operations.md (Outcomes: trial run then production run)
 */
import { describe, expect, test } from '@jest/globals';

import { analysisScope } from './analysis.js';
import { production, trial } from './harness.js';
import { clean, freshScenario, removeScenarios, statuses, usageOf } from './support.js';

removeScenarios();

/** The full report: merged PRs score 2, the unmerged pr-2 scores 1. */
const fullReport = { scores: [['pr-1', 2], ['pr-2', 1], ['pr-3', 2]] };

/** Three answered assessments, each report counted once. */
const threeAnswers = { status: 'complete', observed: [{ unit: 'tokens', amount: 300 }], unknown: 0, operations: 3, reports: 3, requestAttempts: 3 };

/** An environment that paid for nothing. */
const nothing = { status: 'complete', observed: [], unknown: 0, operations: 0, reports: 0, requestAttempts: 0 };

describe('trial-production-isolation (RUN-016, RUN-017)', () => {
  test('a trial never satisfies production by accident; after a recorded promotion production reuses every promoted result and pays nothing', () => {
    const s = freshScenario();
    const trialRun = clean(s.run({ kind: 'fold' }, { environment: trial }));
    expect(trialRun.result.report).toEqual(fullReport);
    expect(s.keys('received')).toEqual(['pr-1', 'pr-2', 'pr-3']);

    // Before a promotion a production check of a trial-assessed member finds nothing reusable; checking sends and writes nothing.
    const rowsBefore = s.rows();
    const unpromoted = clean(s.run({ kind: 'check', key: 'pr-1' }, { environment: production }));
    expect(unpromoted.result.check?.kind).not.toBe('reusable');
    expect(s.keys('received')).toHaveLength(3);
    expect(s.rows().results).toEqual(rowsBefore.results);

    // The promotion names every result the trial report rests on: discovery, three assessments and the report.
    const promoted = clean(s.run({ kind: 'promote', into: production }, { environment: trial }));
    const promotion = promoted.result.promotion;
    expect(promotion?.target).toEqual({ analysis: analysisScope, environment: production });
    const trialReferences = [trialRun.result.fold?.reference, ...['pr-1', 'pr-2', 'pr-3'].map((key) => trialRun.result.members[key]?.reference)];
    expect(promotion?.references).toHaveLength(5);
    for (const reference of trialReferences) {
      expect(promotion?.references.map((candidate) => candidate.locator)).toContain(reference);
    }
    expect(promotion?.fence).toBe(s.writer().lastFence);
    expect(promoted.events.filter((event) => event['kind'] === 'promotion').map((event) => event['into'])).toEqual([production]);

    const productionRun = clean(s.run({ kind: 'fold' }, { environment: production }));
    expect(productionRun.assessed).toEqual([]);
    expect(productionRun.result.fold).toEqual({ status: 'succeeded', kind: 'reused', reference: trialRun.result.fold?.reference });
    for (const key of ['pr-1', 'pr-2', 'pr-3']) {
      expect(productionRun.result.members[key]).toEqual({ status: 'succeeded', kind: 'reused', reference: trialRun.result.members[key]?.reference });
    }
    expect(productionRun.result.report).toEqual(fullReport);
    expect(s.keys('received')).toHaveLength(3);
    // Accounting is namespaced too: production paid for nothing, and the trial's usage is its own.
    expect(usageOf(productionRun.result.usage)).toEqual(nothing);
    expect(usageOf(s.usage(trial))).toEqual(threeAnswers);
    const listed = clean(s.run({ kind: 'inspect' }, { environment: production }));
    expect(listed.result.promotions.map((record) => record.promotionId)).toEqual([promotion?.promotionId]);
    expect(clean(s.run({ kind: 'inspect' }, { environment: trial })).result.promotions).toEqual([]);
  });

  test('without a promotion production executes and pays for its own work, and the trial\'s results and usage stay untouched', () => {
    const s = freshScenario();
    const trialRun = clean(s.run({ kind: 'fold' }, { environment: trial }));
    const productionRun = clean(s.run({ kind: 'fold' }, { environment: production }));
    expect(productionRun.assessed).toEqual(['pr-1', 'pr-2', 'pr-3']);
    expect(s.keys('received')).toEqual(['pr-1', 'pr-2', 'pr-3', 'pr-1', 'pr-2', 'pr-3']);
    expect(productionRun.result.fold).toMatchObject({ status: 'succeeded', kind: 'published' });
    expect(productionRun.result.fold?.reference).not.toBe(trialRun.result.fold?.reference);
    // Production's operations are its own: each trial operation identity appears only in the trial's journal namespace.
    const trialOperations = new Set(trialRun.result.operations.map((view) => view.operation));
    expect(productionRun.result.operations.filter((view) => trialOperations.has(view.operation))).toEqual([]);
    expect(usageOf(productionRun.result.usage)).toEqual(threeAnswers);
    // The trial still reuses exactly its own results, and its usage is unchanged.
    const trialAgain = clean(s.run({ kind: 'fold' }, { environment: trial }));
    expect(trialAgain.result.fold).toEqual({ status: 'succeeded', kind: 'reused', reference: trialRun.result.fold?.reference });
    expect(statuses(trialAgain)).toEqual({ 'pr-1': 'succeeded', 'pr-2': 'succeeded', 'pr-3': 'succeeded' });
    expect(usageOf(trialAgain.result.usage)).toEqual(threeAnswers);
  });
});
