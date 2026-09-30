/**
 * Environment namespacing and recorded promotion in History's durable
 * authority over Node's real SQLite capability (RUN-016/017). Environments are
 * namespaces within one store: attempts, current heads, candidates,
 * acceptances and journal records of one environment never satisfy a lookup
 * in another. A trial result satisfies production only through an explicit,
 * fenced promotion record, which keeps its own provenance and never moves or
 * rewrites trial history. Expected values are written by hand from those
 * contracts and from RES-002/005/007.
 *
 * @see ../../../../docs/spec/operations.md (RUN-016, RUN-017 owner decision of 2026-09-30)
 * @see ../../../../docs/spec/execution.md (RES-002, RES-005, RES-007, PUB-002)
 * @see ../../../../docs/spec/architecture.md (ARC-007)
 */
import { afterEach, describe, expect, test } from '@jest/globals';
import { HistoryIntegrityError, StaleWriterError } from '@microdelta/history';
import type { ICompletedResultReference, IDurableHistory } from '@microdelta/history';

import { cleanup, controlledClock, freshLocation, openHistory, openRaw } from '../durable-history/support.js';
import { acceptanceEvidence, acquire, analysis, attempt, operation, operationFormat, production, promotionEvidence, publish, trial, versionOne } from './support.js';

afterEach(cleanup);

/** Ada's summary subject, identical text in every environment. */
const summary = 'summary:acme/widget:2026-Q1:person:ada';

/** Bo's summary subject. */
const boSummary = 'summary:acme/widget:2026-Q1:person:bo';

/** A deterministic, order-preserving dump of rows, for before/after comparison of trial history. */
function rows(location: string, statement: string): readonly unknown[] {
  const raw = openRaw(location);
  const result = raw.prepare(statement).all();
  raw.close();
  return result;
}

/** Everything the trial environment has recorded, read directly from storage. */
function trialHistory(location: string): readonly unknown[] {
  return [
    rows(location, "SELECT * FROM history_attempts WHERE environment = 'env:trial' ORDER BY attempt_id"),
    rows(location, "SELECT result_id, analysis, environment, subject, version, publication, published_fence, payload, provenance FROM history_results WHERE environment = 'env:trial' ORDER BY result_id"),
    rows(location, "SELECT * FROM history_current WHERE environment = 'env:trial' ORDER BY subject"),
    rows(location, "SELECT * FROM history_acceptances WHERE environment = 'env:trial' ORDER BY acceptance_id"),
    rows(location, "SELECT * FROM history_journal WHERE environment = 'env:trial' ORDER BY sequence"),
  ];
}

describe('environment namespaces', () => {
  test('a trial run’s attempts, heads, candidates, acceptances and journal records never satisfy a production lookup', () => {
    const history = openHistory({ location: freshLocation() });
    const lease = acquire(history);
    const trialAda = publish(history, lease, trial, summary, { key: 'ada' });
    history.recordAcceptance(lease, { reference: trialAda, evidence: acceptanceEvidence('trial check'), dependencies: [] });
    const journal = history.openJournal({ formats: versionOne });
    journal.commit(lease, { ...trial, writes: [{ key: 'op-1', expectedRevision: 0, record: operation({ state: 'succeeded' }) }] });

    // Heads and candidates.
    expect(history.findCandidates({ ...production, subject: summary, version: 1 })).toEqual([]);
    expect(history.readCurrent({ ...production, subject: summary })).toBeUndefined();
    expect(history.readCurrent({ ...trial, subject: summary })).toEqual(trialAda);

    // Attempts: the trial key is absent in production, and production may bind it to a different intent.
    expect(history.recoverAttempt(attempt(production, summary, 'ada'))).toEqual({ kind: 'absent' });
    const productionAttempt = history.allocateAttempt(lease, attempt(production, summary, 'ada', { intentDigest: 'intent:production' }));
    expect(productionAttempt).toMatchObject({ environment: production.environment, attemptKey: 'ada', intentDigest: 'intent:production', state: 'allocated' });

    // Acceptances and dependencies: a trial result is not admissible in production.
    expect(() => history.recordAcceptance(lease, { reference: trialAda, evidence: acceptanceEvidence('production check'), dependencies: [], environment: production.environment })).toThrow(HistoryIntegrityError);
    expect(() => history.readAcceptances(trialAda, production.environment)).toThrow(HistoryIntegrityError);
    expect(() => history.stageAttempt(lease, { attemptId: productionAttempt.attemptId, payload: { total: 1 }, provenance: { format: 'test.resolution.provenance', formatVersion: 1, content: {} }, dependencies: [trialAda] })).toThrow(HistoryIntegrityError);
    expect(history.readAcceptances(trialAda).map((record) => [record.environment, record.evidence.content])).toEqual([[trial.environment, { check: 'trial check' }]]);

    // Journal records.
    expect(journal.read({ ...production, format: operationFormat, key: 'op-1' })).toBeUndefined();
    expect(journal.list({ ...production, format: operationFormat })).toEqual([]);
  });
});

describe('recorded promotion', () => {
  /** A store with production and trial history for Ada and a trial result for Bo. */
  function seeded(location: string, clock = controlledClock(1_000)): {
    readonly history: IDurableHistory;
    readonly productionAda: ICompletedResultReference;
    readonly trialAda: ICompletedResultReference;
    readonly trialBo: ICompletedResultReference;
  } {
    const history = openHistory({ location, clock });
    const lease = acquire(history, 'seed');
    const productionAda = publish(history, lease, production, summary, { key: 'production-ada' });
    const trialAda = publish(history, lease, trial, summary, { key: 'trial-ada' });
    const trialBo = publish(history, lease, trial, boSummary, { key: 'trial-bo' });
    history.recordAcceptance(lease, { reference: trialAda, evidence: acceptanceEvidence('trial check'), dependencies: [] });
    history.openJournal({ formats: versionOne }).commit(lease, { ...trial, writes: [{ key: 'op-1', expectedRevision: 0, record: operation({ state: 'succeeded' }) }] });
    history.releaseWriter(lease);
    return { history, productionAda, trialAda, trialBo };
  }

  test('a promotion admits exactly the named trial results into production, with recorded provenance, and never moves or rewrites trial history', () => {
    const location = freshLocation();
    const { history, productionAda, trialAda, trialBo } = seeded(location);
    const trialEnvelope = history.readEnvelope(trialAda);
    const trialAcceptances = history.readAcceptances(trialAda);
    const trialBefore = trialHistory(location);

    const lease = acquire(history, 'operator');
    const promotion = history.promoteResults(lease, { ...production, references: [trialAda], evidence: promotionEvidence('trial reviewed') });
    expect(promotion).toEqual({
      promotionId: 1,
      analysis,
      environment: production.environment,
      fence: lease.fence,
      evidence: promotionEvidence('trial reviewed'),
      references: [trialAda],
    });

    // The named result now satisfies the production candidate lookup, beside production's own result,
    // latest publication first; it keeps its own exact reference and publishing scope.
    const candidates = history.findCandidates({ ...production, subject: summary, version: 1 });
    expect(candidates.map((candidate) => candidate.reference)).toEqual([trialAda, productionAda]);
    expect(candidates[0]).toEqual(trialEnvelope);
    // A result the promotion does not name still does not.
    expect(history.findCandidates({ ...production, subject: boSummary, version: 1 })).toEqual([]);

    // A promotion is not a publication: no head moves in either environment.
    expect(history.readCurrent({ ...production, subject: summary })).toEqual(productionAda);
    expect(history.readCurrent({ ...trial, subject: summary })).toEqual(trialAda);

    // Provenance of the promotion is queryable per target environment and per result.
    expect(history.readPromotions(production)).toEqual([promotion]);
    expect(history.readPromotions({ ...production, reference: trialAda })).toEqual([promotion]);
    expect(history.readPromotions({ ...production, reference: trialBo })).toEqual([]);
    expect(history.readPromotions(trial)).toEqual([]);

    // Trial history is untouched: same envelope, acceptances and stored rows.
    expect(history.readEnvelope(trialAda)).toEqual(trialEnvelope);
    expect(history.readAcceptances(trialAda)).toEqual(trialAcceptances);
    expect(trialHistory(location)).toEqual(trialBefore);

    // Production verifies and consumes the promoted result in its own namespace.
    const accepted = history.recordAcceptance(lease, { reference: trialAda, evidence: acceptanceEvidence('production check'), dependencies: [productionAda], environment: production.environment });
    expect(accepted).toMatchObject({ reference: trialAda, environment: production.environment, fence: lease.fence, dependencies: [productionAda] });
    expect(history.readAcceptances(trialAda, production.environment)).toEqual([accepted]);
    expect(history.readAcceptances(trialAda)).toEqual(trialAcceptances);
    const report = publish(history, lease, production, 'report:acme/widget:2026-Q1', { key: 'report', dependencies: [trialAda, productionAda] });
    expect(history.readEnvelope(report).dependencies).toEqual([trialAda, productionAda]);
    expect(trialHistory(location)).toEqual(trialBefore);
    history.close();

    // Everything survives reopening through a fresh handle.
    const reopened = openHistory({ location, clock: controlledClock(2_000) });
    expect(reopened.findCandidates({ ...production, subject: summary, version: 1 }).map((candidate) => candidate.reference)).toEqual([trialAda, productionAda]);
    expect(reopened.readPromotions(production)).toEqual([promotion]);
    expect(reopened.readEnvelope(report).dependencies).toEqual([trialAda, productionAda]);
    expect(reopened.readAcceptances(trialAda, production.environment)).toEqual([accepted]);
  });

  test('a promotion into one environment admits nothing into any other environment', () => {
    const { history, trialAda } = seeded(freshLocation());
    const lease = acquire(history, 'operator');
    const staging = { analysis, environment: 'env:staging' };
    history.promoteResults(lease, { ...staging, references: [trialAda], evidence: promotionEvidence('to staging') });
    expect(history.findCandidates({ ...staging, subject: summary, version: 1 }).map((candidate) => candidate.reference)).toEqual([trialAda]);
    expect(history.findCandidates({ ...production, subject: summary, version: 1 }).map((candidate) => candidate.reference)).not.toContainEqual(trialAda);
    expect(() => history.recordAcceptance(lease, { reference: trialAda, evidence: acceptanceEvidence('production check'), dependencies: [], environment: production.environment })).toThrow(HistoryIntegrityError);
  });

  test('promotion requires the current writer and distinct exact results of other environments of the same analysis; a refused promotion records nothing', () => {
    const clock = controlledClock(1_000);
    const location = freshLocation();
    const { history, productionAda, trialAda, trialBo } = seeded(location, clock);
    const stale = acquire(history, 'stale', 100);
    clock.set(1_200);
    const current = acquire(history, 'current', 10_000);
    const evidence = promotionEvidence('attempt');

    expect(() => history.promoteResults(stale, { ...production, references: [trialAda], evidence })).toThrow(StaleWriterError);
    const otherAnalysis = publish(history, current, { analysis: 'analysis:other', environment: trial.environment }, summary, { key: 'other-analysis' });
    expect(() => history.promoteResults(current, { ...production, references: [otherAnalysis], evidence })).toThrow(HistoryIntegrityError);
    expect(() => history.promoteResults(current, { ...production, references: [{ kind: 'completed-result', locator: 'bogus' }], evidence })).toThrow(HistoryIntegrityError);
    for (const references of [[], [trialAda, trialAda], [productionAda], [trialBo, productionAda]]) {
      expect(() => history.promoteResults(current, { ...production, references, evidence })).toThrow(TypeError);
    }
    expect(() => history.promoteResults(current, { ...production, environment: '', references: [trialAda], evidence })).toThrow(TypeError);
    expect(() => history.promoteResults(current, { ...production, references: [trialAda], evidence: { format: '', formatVersion: 1, content: {} } })).toThrow(TypeError);
    expect(history.readPromotions(production)).toEqual([]);
    expect(history.findCandidates({ ...production, subject: summary, version: 1 }).map((candidate) => candidate.reference)).toEqual([productionAda]);

    // A successful promotion issues identity 1: refused attempts consumed none. Records are immutable.
    const recorded = history.promoteResults(current, { ...production, references: [trialBo, trialAda], evidence });
    expect(recorded).toMatchObject({ promotionId: 1, fence: current.fence, references: [trialBo, trialAda] });
    const raw = openRaw(location);
    for (const statement of ["UPDATE history_promotions SET environment = 'env:trial'", 'DELETE FROM history_promotions', 'DELETE FROM history_promotion_results']) {
      expect(() => raw.exec(statement)).toThrow(/immutable/u);
    }
    raw.close();
  });
});
