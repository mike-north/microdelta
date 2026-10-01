/**
 * Environment isolation of external operations, and Resolution's reuse of a
 * promoted candidate, on the real packages (RUN-016, RUN-017; supervisor
 * rulings on #119).
 *
 * Expected values come from the owner decision of 2026-09-30 (environments
 * are namespaced within one store and selected per run; trial work satisfies
 * production only through an explicit, recorded promotion) and the ruling
 * that Resolution accepts a promoted result's trial provenance as historical
 * evidence while never treating that provenance as a production candidate:
 *
 * - operations, deferrals and accounting are scoped by environment: a trial
 *   deferral never holds production work back, and summaries never mix;
 * - an unpromoted trial fold is never a production candidate;
 * - a promoted trial fold is reused in production: its recorded trial
 *   members are read as historical evidence only, while production's current
 *   members are resolved, and paid for, in production.
 *
 * @see ../../../../docs/spec/operations.md (RUN-016, RUN-017 owner decision)
 * @see ../../../../docs/spec/execution.md (RES-005, RES-007)
 * @see ../../../../docs/plans/m5-operations.md (planned evidence `trial-production-isolation`)
 */
import { afterEach, beforeEach, describe, expect, test } from '@jest/globals';
import type { ICompletedResultReference } from '@microdelta/history';

import { analysis, createWorld, installWorld } from './fixture.js';
import type { IWorld } from './fixture.js';
import { fakeTimer, openSession, production, statuses, tempStores, trial } from './harness.js';
import type { IFakeTimer, IOperationStores } from './harness.js';
import { fold, inspect, journalContents, members, received } from './support.js';

let stores: IOperationStores;
let timer: IFakeTimer;
let world: IWorld;

beforeEach(() => {
  stores = tempStores();
  timer = fakeTimer();
  world = installWorld(createWorld(() => timer.currentEpochMilliseconds()));
});

afterEach(() => {
  stores.remove();
});

describe('environment isolation of operations (RUN-017)', () => {
  test('a trial deferral and unknown outcome never hold production work back, and records and usage never mix', async () => {
    world.provider.script('assess', 'pr-1', ['rate-limit:10800000', 'ok']);
    world.provider.script('assess', 'pr-2', ['lost', 'ok']);
    const session = openSession(stores, timer);
    try {
      const inTrial = await members(session, { environment: trial, deferral: 'exit' }).done;
      expect(statuses(inTrial.value.members)).toEqual({ 'pr-1': 'pending', 'pr-2': 'pending', 'pr-3': 'succeeded' });
      const inProduction = await members(session, { environment: production, deferral: 'exit' }).done;
      expect(statuses(inProduction.value.members)).toEqual({ 'pr-1': 'succeeded', 'pr-2': 'succeeded', 'pr-3': 'succeeded' });
      expect(inProduction.waitingUntil).toBeUndefined();
      // Production made its own operations; the trial ones are untouched.
      const [trialPr1, productionPr1] = received('pr-1');
      expect(productionPr1?.operation).not.toBe(trialPr1?.operation);
      expect(journalContents(session, trial)).toContainEqual(expect.objectContaining({ operation: trialPr1?.operation, status: 'deferred' }));
      expect(journalContents(session, production).map((content): unknown => typeof content === 'object' && content !== null ? Reflect.get(content, 'status') : undefined)).toEqual(['succeeded', 'succeeded', 'succeeded']);
      expect((await inspect(session, { environment: production })).map((view) => view.subject.environment)).toEqual([production, production, production]);
      // Accounting is per environment: production is complete, the trial keeps its unknown.
      expect(session.usage(production)).toEqual(expect.objectContaining({ status: 'complete', observed: [{ unit: 'tokens', amount: 300 }] }));
      expect(session.usage(trial).status).toBe('incomplete');
    } finally {
      session.close();
    }
  });
});

describe('Resolution reuses a promoted candidate (supervisor ruling on #119)', () => {
  test('an unpromoted trial fold is not a production candidate; a promoted one is reused, with production members resolved in production', async () => {
    const session = openSession(stores, timer);
    try {
      const inTrial = await fold(session, { environment: trial }).done;
      expect(inTrial.value.outcome.status).toBe('succeeded');
      const trialReport: ICompletedResultReference | undefined = inTrial.value.outcome.status === 'succeeded' ? inTrial.value.outcome.outcome.reference : undefined;
      if (trialReport === undefined) {
        throw new Error('the trial fold did not succeed');
      }
      expect(received('pr-1')).toHaveLength(1);

      // Promote only the fold: its trial members are its provenance, never production candidates.
      const writer = session.history.acquireWriter({ holder: 'operator', leaseMilliseconds: 10_000 });
      if (writer.kind !== 'acquired') {
        throw new Error('the promotion writer was not acquired');
      }
      session.history.promoteResults(writer.lease, {
        target: { analysis, environment: production },
        references: [trialReport],
        evidence: { format: 'test.promotion', formatVersion: 1, content: { reason: 'trial reviewed' } },
      });
      session.history.releaseWriter(writer.lease);

      const inProduction = await fold(session, { environment: production }).done;
      expect(statuses(inProduction.value.members)).toEqual({ 'pr-1': 'succeeded', 'pr-2': 'succeeded', 'pr-3': 'succeeded' });
      // Production's members were resolved, and paid for, in production.
      expect(received('pr-1')).toHaveLength(2);
      expect(inProduction.value.members.map((member) => member.status === 'succeeded' ? session.history.readEnvelope(member.outcome.reference).environment : undefined)).toEqual([production, production, production]);
      // The promoted fold is reused, keeping its exact trial reference.
      expect(inProduction.value.outcome).toEqual({ status: 'succeeded', outcome: expect.objectContaining({ kind: 'reused', reference: trialReport }) });
      expect(session.history.readAcceptances(trialReport, production).length).toBe(1);
    } finally {
      session.close();
    }
  });

  test('without a promotion a production run publishes its own fold', async () => {
    const session = openSession(stores, timer);
    try {
      const inTrial = await fold(session, { environment: trial }).done;
      const inProduction = await fold(session, { environment: production }).done;
      expect(inProduction.value.outcome).toEqual({ status: 'succeeded', outcome: expect.objectContaining({ kind: 'published' }) });
      const trialReport = inTrial.value.outcome.status === 'succeeded' ? inTrial.value.outcome.outcome.reference : undefined;
      const productionReport = inProduction.value.outcome.status === 'succeeded' ? inProduction.value.outcome.outcome.reference : undefined;
      expect(productionReport === undefined ? undefined : session.history.readEnvelope(productionReport).environment).toBe(production);
      expect(productionReport).not.toEqual(trialReport);
    } finally {
      session.close();
    }
  });
});
