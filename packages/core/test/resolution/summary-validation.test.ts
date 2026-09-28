/**
 * Direct-child validation beneath cached contributor summaries over real
 * durable History (issue #56 acceptance 3–4; A-02, A-04, A-10). Each summary
 * candidate is validated by its own actually called implementation, consumed
 * inputs and called helpers; then its recorded direct child witness is
 * reconnected to the current declaration, the current child is resolved under
 * current source policy, and only the child output facts the summary consumed
 * are compared. A child's own implementation and reads belong to the child.
 * Expected statistics and sentences are derived by hand from the fixture
 * attribution rules in the M3 plan, never from program output.
 *
 * @see ../../../../docs/spec/execution.md (RES-007, REUSE-005–008, transition table)
 * @see ../../../../docs/spec/composition.md (CMP-5, CMP-6, CMP-7)
 * @see ../../../../docs/plans/m3-contribution-analysis.md (Planned evidence names; concrete fixture decisions)
 */
import { afterEach, beforeEach, describe, expect, test } from '@jest/globals';
import type { ICompletedResultReference, IDurableHistory, IWriterLease } from '@microdelta/history';
import { ResolutionError } from '@microdelta/resolution';

import { cleanup, freshLocation } from '../durable-history/support.js';
import { adaActivity, analysis, benActivity, resetWorld, world } from './fixture.js';
import type { IMemberKey, IVariation } from './fixture.js';
import { environment, openSession, payloadOf, referenceOf, resolveSummaries } from './support.js';
import type { ISession } from './support.js';

beforeEach(() => {
  resetWorld();
});
afterEach(cleanup);

/** Hand-derived expected summaries (M3 plan, concrete fixture decisions). */
const expected: Record<IMemberKey, unknown> = {
  'person:ada': { name: 'Ada', authored: 3, merged: 2, reviews: 5, sentence: 'Ada authored 3 pull requests, 2 of which were merged, and submitted 5 reviews.' },
  'person:ben': { name: 'Ben', authored: 2, merged: 1, reviews: 3, sentence: 'Ben authored 2 pull requests, 1 of which was merged, and submitted 3 reviews.' },
};

/** The scoped subject of a member's summary. */
function summarySubject(key: IMemberKey): { readonly analysis: string; readonly environment: string; readonly subject: string } {
  return { analysis, environment, subject: `summary:acme/widget:2026-Q1:${key}` };
}

/** Run one session around `body`. */
async function withSession<T>(location: string, body: (session: ISession) => Promise<T>, variation: IVariation = {}): Promise<T> {
  const session = openSession(location, variation);
  try {
    return await body(session);
  } finally {
    session.close();
  }
}

/** Counts of all author work, for zero/once assertions. */
function counts(): { readonly checks: number; readonly finalities: number; readonly summaries: number } {
  const sum = (record: Record<IMemberKey, number>): number => record['person:ada'] + record['person:ben'];
  return { checks: sum(world.checks), finalities: sum(world.finalities), summaries: sum(world.summaries) };
}

/** Clear invocation counts between sessions. */
function resetCounts(): void {
  for (const key of ['person:ada', 'person:ben'] as const) {
    world.checks[key] = 0;
    world.finalities[key] = 0;
    world.summaries[key] = 0;
  }
}

/** The cold baseline: both summaries published; returns their exact locators and their child locators. */
async function coldReport(location: string): Promise<{ readonly summaries: Record<IMemberKey, string>; readonly activities: Record<IMemberKey, string> }> {
  return withSession(location, async (session) => {
    const outcomes = await resolveSummaries(session);
    const activities = {
      'person:ada': session.history.readCurrent({ analysis, environment, subject: 'activity:acme/widget:2026-Q1:person:ada' })?.locator ?? '',
      'person:ben': session.history.readCurrent({ analysis, environment, subject: 'activity:acme/widget:2026-Q1:person:ben' })?.locator ?? '',
    };
    return { summaries: { 'person:ada': referenceOf(outcomes['person:ada']), 'person:ben': referenceOf(outcomes['person:ben']) }, activities };
  });
}

describe('cold and restarted report', () => {
  test('cold run executes each source and summary once with exact statistics and sentences', async () => {
    const location = freshLocation();
    await withSession(location, async (session) => {
      const outcomes = await resolveSummaries(session);
      for (const key of ['person:ada', 'person:ben'] as const) {
        expect(outcomes[key].kind).toBe('published');
        expect(payloadOf(session.history, referenceOf(outcomes[key]))).toEqual(expected[key]);
      }
      expect(world.checks).toEqual({ 'person:ada': 1, 'person:ben': 1 });
      expect(world.summaries).toEqual({ 'person:ada': 1, 'person:ben': 1 });
      expect(world.finalities).toEqual({ 'person:ada': 0, 'person:ben': 0 });
    });
  });

  test('unchanged restart runs current finality, zero summary bodies and zero checks, and retains exact references', async () => {
    const location = freshLocation();
    const cold = await coldReport(location);
    resetCounts();
    await withSession(location, async (session) => {
      const start = session.sqlite.mark();
      const outcomes = await resolveSummaries(session);
      const evidence = session.sqlite.evidence(start);
      for (const key of ['person:ada', 'person:ben'] as const) {
        const outcome = outcomes[key];
        expect(outcome.kind).toBe('reused');
        if (outcome.kind !== 'reused') {
          return;
        }
        expect(outcome.basis).toBe('validated');
        expect(outcome.reference.locator).toBe(cold.summaries[key]);
        // Current acceptance names the current child; it is separate from provenance.
        expect(outcome.acceptance.dependencies.map((reference) => reference.locator)).toEqual([cold.activities[key]]);
      }
      expect(counts()).toEqual({ checks: 0, finalities: 2, summaries: 0 });
      // Validation is metadata-only: no root payload of any result was read.
      expect(evidence.rootPayloadCells).toBe(0);
      expect(evidence.roles.allocate).toBeUndefined();
      expect(session.admissions).toHaveLength(0);
    });
  });

  test('reversed member registration after restart preserves each member\'s own references', async () => {
    const location = freshLocation();
    const cold = await coldReport(location);
    await withSession(location, async (session) => {
      const outcomes = await resolveSummaries(session, ['person:ben', 'person:ada']);
      expect(referenceOf(outcomes['person:ada'])).toBe(cold.summaries['person:ada']);
      expect(referenceOf(outcomes['person:ben'])).toBe(cold.summaries['person:ben']);
      expect(payloadOf(session.history, cold.summaries['person:ada'])).toEqual(expected['person:ada']);
    }, { order: 'ben-first' });
  });
});

describe('read and unread facts, called and uncalled helpers', () => {
  test('a fresh source changing only unread fields publishes a new child but retains the summary', async () => {
    const location = freshLocation();
    const cold = await coldReport(location);
    resetCounts();
    world.finality['person:ada'] = 'not-final';
    world.remote['person:ada'] = adaActivity({ avatar: 'https://avatars.example/ada-2.png', label: 'enhancement' });
    await withSession(location, async (session) => {
      const outcome = await session.resolve(session.contributors.steps['person:ada'].summary);
      expect(outcome.kind).toBe('reused');
      expect(referenceOf(outcome)).toBe(cold.summaries['person:ada']);
      expect(world.checks['person:ada']).toBe(1);
      expect(world.summaries['person:ada']).toBe(0);
      const newChild = session.history.readCurrent({ analysis, environment, subject: 'activity:acme/widget:2026-Q1:person:ada' });
      expect(newChild?.locator).not.toBe(cold.activities['person:ada']);
      if (outcome.kind === 'reused') {
        expect(outcome.acceptance.dependencies.map((reference) => reference.locator)).toEqual([newChild?.locator]);
      }
      // Original provenance keeps the historical child.
      const envelope = session.history.readEnvelope({ kind: 'completed-result', locator: cold.summaries['person:ada'] });
      expect(envelope.dependencies.map((reference) => reference.locator)).toEqual([cold.activities['person:ada']]);
    });
  });

  test('a consumed field change re-executes only its own summary; the other member retains its exact result', async () => {
    const location = freshLocation();
    const cold = await coldReport(location);
    resetCounts();
    world.finality['person:ada'] = 'not-final';
    world.remote['person:ada'] = adaActivity({ merged103: true });
    await withSession(location, async (session) => {
      const outcomes = await resolveSummaries(session);
      expect(outcomes['person:ada'].kind).toBe('published');
      expect(referenceOf(outcomes['person:ada'])).not.toBe(cold.summaries['person:ada']);
      expect(payloadOf(session.history, referenceOf(outcomes['person:ada']))).toEqual({
        name: 'Ada', authored: 3, merged: 3, reviews: 5, sentence: 'Ada authored 3 pull requests, 3 of which were merged, and submitted 5 reviews.',
      });
      expect(outcomes['person:ada'].misses.map((miss) => miss.reason)).toEqual(['changed']);
      expect(outcomes['person:ben'].kind).toBe('reused');
      expect(referenceOf(outcomes['person:ben'])).toBe(cold.summaries['person:ben']);
      expect(world.summaries).toEqual({ 'person:ada': 1, 'person:ben': 0 });
      // The re-executed body consumed the child already resolved during validation:
      // one finality evaluation and one check within this request.
      expect(world.finalities['person:ada']).toBe(1);
      expect(world.checks['person:ada']).toBe(1);
    });
  });

  test('a changed called formatter re-executes both summaries even with unchanged statistics', async () => {
    const location = freshLocation();
    const cold = await coldReport(location);
    resetCounts();
    await withSession(location, async (session) => {
      const outcomes = await resolveSummaries(session);
      for (const key of ['person:ada', 'person:ben'] as const) {
        expect(outcomes[key].kind).toBe('published');
        expect(referenceOf(outcomes[key])).not.toBe(cold.summaries[key]);
        expect(payloadOf(session.history, referenceOf(outcomes[key]))).toEqual(expected[key]);
      }
      expect(counts()).toEqual({ checks: 0, finalities: 2, summaries: 2 });
    }, { formatter: 'revised' });
  });

  test('a changed uncalled helper alone retains both summaries', async () => {
    const location = freshLocation();
    const cold = await coldReport(location);
    resetCounts();
    await withSession(location, async (session) => {
      const outcomes = await resolveSummaries(session);
      expect(referenceOf(outcomes['person:ada'])).toBe(cold.summaries['person:ada']);
      expect(referenceOf(outcomes['person:ben'])).toBe(cold.summaries['person:ben']);
      expect(counts()).toEqual({ checks: 0, finalities: 2, summaries: 0 });
    }, { unusedHelper: 'revised' });
  });

  test('a changed child implementation is validated beneath the unchanged summary and cut off at equal consumed output', async () => {
    const location = freshLocation();
    const cold = await coldReport(location);
    resetCounts();
    await withSession(location, async (session) => {
      const outcome = await session.resolve(session.contributors.steps['person:ada'].summary);
      // The child's changed code made its own candidate ineligible (no finality) and it refetched equal data...
      expect(world.finalities['person:ada']).toBe(0);
      expect(world.checks['person:ada']).toBe(1);
      const newChild = session.history.readCurrent({ analysis, environment, subject: 'activity:acme/widget:2026-Q1:person:ada' });
      expect(newChild?.locator).not.toBe(cold.activities['person:ada']);
      // ...while the summary, which never absorbed the child's implementation, is retained.
      expect(outcome.kind).toBe('reused');
      expect(referenceOf(outcome)).toBe(cold.summaries['person:ada']);
      expect(world.summaries['person:ada']).toBe(0);
    }, { adaSource: 'changed' });
  });

  test('summary provenance records its own implementation, helpers, witness and consumed child facts, not the child\'s internals', async () => {
    const location = freshLocation();
    const cold = await coldReport(location);
    await withSession(location, async (session) => {
      const envelope = session.history.readEnvelope({ kind: 'completed-result', locator: cold.summaries['person:ada'] });
      const content = envelope.provenance.content as { readonly observations: readonly { readonly binding: { readonly path: readonly string[] } }[]; readonly children: readonly { readonly witness: unknown; readonly reference: ICompletedResultReference; readonly binding: unknown }[] };
      const paths = new Set(content.observations.map((observation) => JSON.stringify(observation.binding.path)));
      expect([...paths].sort()).toEqual([
        JSON.stringify(['callable', 'format']),
        JSON.stringify(['callable', 'summarize']),
        JSON.stringify(['child', 'activity']),
        JSON.stringify(['self']),
      ].sort());
      expect(content.children).toEqual([{
        slot: 'activity',
        witness: {
          version: 1,
          parent: { scope: analysis, role: 'step', slot: 'summary', memberKey: 'person:ada' },
          child: { scope: analysis, role: 'step', slot: 'activity', memberKey: 'person:ada' },
          arguments: { form: 'empty' },
        },
        reference: { kind: 'completed-result', locator: cold.activities['person:ada'] },
        binding: { path: ['child', 'activity'] },
      }]);
    });
  });
});

describe('child failures inside a body', () => {
  test('a body that swallows a failed child call cannot publish: the child failure fails the summary', async () => {
    const location = freshLocation();
    const cold = await coldReport(location);
    world.finality['person:ada'] = 'throw';
    await withSession(location, async (session) => {
      let caught: unknown;
      try {
        await session.resolve(session.contributors.steps['person:ada'].summary);
      } catch (error: unknown) {
        caught = error;
      }
      expect(caught).toBeInstanceOf(ResolutionError);
      expect((caught as ResolutionError).code).toBe('policy-failure');
      expect(session.history.readCurrent(summarySubject('person:ada'))?.locator).toBe(cold.summaries['person:ada']);
      expect(session.history.findCandidates({ ...summarySubject('person:ada'), version: 1 })).toHaveLength(1);
    }, { adaSummaryCatches: true, formatter: 'revised' });
  });
});

describe('async child delivery', () => {
  /** Whether any recorded observation of a result addresses a `then` member. */
  function readsThen(session: ISession, locator: string): boolean {
    const envelope = session.history.readEnvelope({ kind: 'completed-result', locator });
    const content = envelope.provenance.content as { readonly observations: readonly { readonly address: readonly { readonly key?: string }[] }[] };
    return content.observations.some((item) => item.address.some((segment) => segment.key === 'then'));
  }

  test('delivering a child records no Promise-assimilation read; an unread then field change retains the summary', async () => {
    const location = freshLocation();
    const cold = await coldReport(location);
    await withSession(location, async (session) => {
      expect(readsThen(session, cold.summaries['person:ada'])).toBe(false);
    });
    resetCounts();
    world.finality['person:ada'] = 'not-final';
    world.remote['person:ada'] = adaActivity({ then: 'unread field' });
    await withSession(location, async (session) => {
      const outcome = await session.resolve(session.contributors.steps['person:ada'].summary);
      expect(outcome.kind).toBe('reused');
      expect(referenceOf(outcome)).toBe(cold.summaries['person:ada']);
      expect(world.checks['person:ada']).toBe(1);
      expect(world.summaries['person:ada']).toBe(0);
    });
  });

  test('a deliberate author read of a then data field is ordinary evidence', async () => {
    const location = freshLocation();
    world.remote['person:ada'] = adaActivity({ then: 'first' });
    const first = await withSession(location, async (session) => {
      const outcome = await session.resolve(session.contributors.steps['person:ada'].summary);
      expect(payloadOf(session.history, referenceOf(outcome))).toMatchObject({ marker: 'first' });
      expect(readsThen(session, referenceOf(outcome))).toBe(true);
      return referenceOf(outcome);
    }, { adaSummaryReadsThen: true });
    world.finality['person:ada'] = 'not-final';
    world.remote['person:ada'] = adaActivity({ then: 'second' });
    await withSession(location, async (session) => {
      const outcome = await session.resolve(session.contributors.steps['person:ada'].summary);
      expect(outcome.kind).toBe('published');
      expect(referenceOf(outcome)).not.toBe(first);
      expect(payloadOf(session.history, referenceOf(outcome))).toMatchObject({ marker: 'second' });
    }, { adaSummaryReadsThen: true });
  });

  test('an array-root child is delivered cold and validated after restart', async () => {
    const location = freshLocation();
    const first = await withSession(location, async (session) => {
      const outcome = await session.resolve(session.contributors.numbers.total);
      expect(outcome.kind).toBe('published');
      expect(payloadOf(session.history, referenceOf(outcome))).toEqual({ count: 2, first: 10 });
      return referenceOf(outcome);
    });
    expect(world.totals).toBe(1);
    await withSession(location, async (session) => {
      const outcome = await session.resolve(session.contributors.numbers.total);
      // The numbers source has no finality hook, so its check runs; equal data keeps the total.
      expect(outcome.kind).toBe('reused');
      expect(referenceOf(outcome)).toBe(first);
    });
    expect(world.totals).toBe(1);
    expect(world.numberChecks).toBe(2);
  });
});

describe('compatibility versions and current path rebinding', () => {
  test('version 2 then unchanged version 1 rollback reuses the old exact results without rewinding the current pointer', async () => {
    const location = freshLocation();
    const cold = await coldReport(location);
    resetCounts();
    const version2 = await withSession(location, async (session) => {
      const outcomes = await resolveSummaries(session);
      expect(outcomes['person:ada'].kind).toBe('published');
      expect(outcomes['person:ada'].misses).toEqual([]);
      return { 'person:ada': referenceOf(outcomes['person:ada']), 'person:ben': referenceOf(outcomes['person:ben']) };
    }, { summaryVersion: 2 });
    expect(world.summaries).toEqual({ 'person:ada': 1, 'person:ben': 1 });
    resetCounts();
    await withSession(location, async (session) => {
      const outcomes = await resolveSummaries(session);
      for (const key of ['person:ada', 'person:ben'] as const) {
        expect(outcomes[key].kind).toBe('reused');
        expect(referenceOf(outcomes[key])).toBe(cold.summaries[key]);
        // Accepting the rollback hit leaves the latest publication pointer on version 2.
        expect(session.history.readCurrent(summarySubject(key))?.locator).toBe(version2[key]);
      }
      expect(world.summaries).toEqual({ 'person:ada': 0, 'person:ben': 0 });
    });
  });

  test('version 1 rollback with changed consumed evidence misses and executes', async () => {
    const location = freshLocation();
    const cold = await coldReport(location);
    await withSession(location, async (session) => {
      await resolveSummaries(session);
    }, { summaryVersion: 2 });
    resetCounts();
    world.finality['person:ada'] = 'not-final';
    world.remote['person:ada'] = adaActivity({ merged103: true });
    await withSession(location, async (session) => {
      const outcomes = await resolveSummaries(session);
      expect(outcomes['person:ada'].kind).toBe('published');
      expect(referenceOf(outcomes['person:ada'])).not.toBe(cold.summaries['person:ada']);
      expect(referenceOf(outcomes['person:ben'])).toBe(cold.summaries['person:ben']);
    });
  });

  test('an equal-name replacement profile retains the summary; a later name change invalidates; original provenance stays intact', async () => {
    const location = freshLocation();
    const cold = await coldReport(location);
    world.finality['person:ada'] = 'not-final';
    world.remote['person:ada'] = adaActivity({ profileId: 'gh:9009' });
    const replacement = await withSession(location, async (session) => {
      const outcome = await session.resolve(session.contributors.steps['person:ada'].summary);
      expect(outcome.kind).toBe('reused');
      expect(referenceOf(outcome)).toBe(cold.summaries['person:ada']);
      const child = session.history.readCurrent({ analysis, environment, subject: 'activity:acme/widget:2026-Q1:person:ada' });
      if (child === undefined || outcome.kind !== 'reused') {
        throw new Error('expected a replacement child and a reused summary');
      }
      expect(outcome.acceptance.dependencies).toEqual([child]);
      // The original provenance still resolves the old profile through the old child.
      const envelope = session.history.readEnvelope({ kind: 'completed-result', locator: cold.summaries['person:ada'] });
      const [original] = envelope.dependencies;
      if (original === undefined) {
        throw new Error('expected the historical child dependency');
      }
      expect(session.history.reader.readSelected(original, { operation: 'value', address: [{ kind: 'property', key: 'profile' }, { kind: 'property', key: 'id' }] }).fact).toBe('gh:1001');
      expect(session.history.reader.readSelected(child, { operation: 'value', address: [{ kind: 'property', key: 'profile' }, { kind: 'property', key: 'id' }] }).fact).toBe('gh:9009');
      return child.locator;
    });
    world.remote['person:ada'] = adaActivity({ profileId: 'gh:9009', name: 'Ada L.' });
    await withSession(location, async (session) => {
      const outcome = await session.resolve(session.contributors.steps['person:ada'].summary);
      expect(outcome.kind).toBe('published');
      expect(payloadOf(session.history, referenceOf(outcome))).toMatchObject({ name: 'Ada L.', sentence: 'Ada L. authored 3 pull requests, 2 of which were merged, and submitted 5 reviews.' });
      const envelope = session.history.readEnvelope({ kind: 'completed-result', locator: cold.summaries['person:ada'] });
      expect(envelope.dependencies.map((reference) => reference.locator)).toEqual([cold.activities['person:ada']]);
      expect(replacement).not.toBe(cold.activities['person:ada']);
    });
  });
});

describe('correspondence, witnesses and historical integrity', () => {
  /** Publish a copy of an existing summary result with rewritten provenance content, as the latest candidate. */
  function publishCrafted(history: IDurableHistory, lease: IWriterLease, locator: string, rewrite: (content: Record<string, unknown>) => unknown, key: string): string {
    const original = history.readEnvelope({ kind: 'completed-result', locator });
    const attempt = history.allocateAttempt(lease, { analysis: original.analysis, environment: original.environment, subject: original.subject, version: original.version, attemptKey: key, intentDigest: `crafted:${key}` });
    history.stageAttempt(lease, {
      attemptId: attempt.attemptId,
      payload: payloadOf(history, locator),
      provenance: { format: original.provenance.format, formatVersion: original.provenance.formatVersion, content: rewrite(JSON.parse(JSON.stringify(original.provenance.content)) as Record<string, unknown>) },
      dependencies: original.dependencies,
    });
    return history.publishAttempt(lease, attempt.attemptId).locator;
  }

  /** Rewrite the first child entry of provenance content. */
  function rewriteChild(update: (child: Record<string, unknown>) => Record<string, unknown>): (content: Record<string, unknown>) => unknown {
    return (content) => {
      const children = content.children as Record<string, unknown>[];
      const [first] = children;
      if (first === undefined) {
        throw new Error('expected a recorded child');
      }
      return { ...content, children: [update(first)] };
    };
  }

  test.each([
    ['an unknown witness version', (child: Record<string, unknown>) => ({ ...child, witness: { ...(child.witness as object), version: 2 } })],
    ['an unsupported argument form', (child: Record<string, unknown>) => ({ ...child, witness: { ...(child.witness as object), arguments: { form: 'positional', values: [1] } } })],
    ['a malformed witness', (child: Record<string, unknown>) => ({ ...child, witness: { version: 1 } })],
  ])('%s is an honest miss, never guessed; older valid candidates remain usable', async (_label, update) => {
    const location = freshLocation();
    const cold = await coldReport(location);
    const crafted = await withSession(location, async (session) => publishCrafted(session.history, session.lease, cold.summaries['person:ada'], rewriteChild(update), 'crafted-witness'));
    resetCounts();
    await withSession(location, async (session) => {
      const outcome = await session.resolve(session.contributors.steps['person:ada'].summary);
      expect(outcome.misses.map((miss) => [miss.candidate.locator, miss.reason])).toEqual([[crafted, 'unsupported-evidence']]);
      expect(outcome.kind).toBe('reused');
      expect(referenceOf(outcome)).toBe(cold.summaries['person:ada']);
      expect(world.summaries['person:ada']).toBe(0);
    });
  });

  test('a witness whose child slot has no current declaration is an honest correspondence miss', async () => {
    const location = freshLocation();
    const cold = await coldReport(location);
    const archived = (child: Record<string, unknown>): Record<string, unknown> => ({
      ...child,
      slot: 'archived',
      witness: { ...(child.witness as Record<string, unknown>), child: { scope: analysis, role: 'step', slot: 'archived', memberKey: 'person:ada' } },
      binding: { path: ['child', 'archived'] },
    });
    const crafted = await withSession(location, async (session) => publishCrafted(session.history, session.lease, cold.summaries['person:ada'], rewriteChild(archived), 'crafted-slot'));
    resetCounts();
    await withSession(location, async (session) => {
      const outcome = await session.resolve(session.contributors.steps['person:ada'].summary);
      expect(outcome.misses.map((item) => [item.candidate.locator, item.reason])).toEqual([[crafted, 'correspondence']]);
      expect(referenceOf(outcome)).toBe(cold.summaries['person:ada']);
      expect(world.summaries['person:ada']).toBe(0);
    });
  });

  /*
   * Contract correction (supervisory review). An earlier version of this test
   * required a correspondence miss when a different subject occupies the
   * uniquely reconnected child slot. CMP-6 makes the declared structural slot
   * the correspondence; REUSE-005/006 resolve the current child and compare
   * only the consumed output facts; RES-003/007 and the transition-table row
   * "current path targets a new entity with equal consumed scalar" permit the
   * parent to retain while current evidence names the new child and original
   * provenance keeps the old one. The child subject is the child's own history
   * key, not a second parent correspondence key.
   */
  test('a different subject now occupying the child slot is resolved as the current child; equal consumed facts retain the summary', async () => {
    const location = freshLocation();
    const cold = await coldReport(location);
    resetCounts();
    await withSession(location, async (session) => {
      const outcome = await session.resolve(session.contributors.steps['person:ada'].summary);
      expect(outcome.misses).toEqual([]);
      expect(outcome.kind).toBe('reused');
      expect(referenceOf(outcome)).toBe(cold.summaries['person:ada']);
      expect(world.summaries['person:ada']).toBe(0);
      // The new subject has no history: its source ran cold under its own admission.
      expect(world.checks['person:ada']).toBe(1);
      expect(world.finalities['person:ada']).toBe(0);
      expect(session.admissions.map((request) => [request.step.slot, request.reason])).toEqual([['activity', 'cold']]);
      const relocated = session.history.readCurrent({ analysis, environment, subject: 'activity:acme/widget:2026-Q1:person:ada:relocated' });
      if (outcome.kind === 'reused') {
        expect(outcome.acceptance.dependencies).toEqual([relocated]);
      }
      // Original provenance and exact historical integrity are untouched.
      const envelope = session.history.readEnvelope({ kind: 'completed-result', locator: cold.summaries['person:ada'] });
      expect(envelope.dependencies.map((reference) => reference.locator)).toEqual([cold.activities['person:ada']]);
    }, { adaActivitySubject: 'activity:acme/widget:2026-Q1:person:ada:relocated' });
  });

  test('a different subject in the child slot with a changed consumed fact misses and executes', async () => {
    const location = freshLocation();
    const cold = await coldReport(location);
    world.remote['person:ada'] = adaActivity({ merged103: true });
    resetCounts();
    await withSession(location, async (session) => {
      const outcome = await session.resolve(session.contributors.steps['person:ada'].summary);
      expect(outcome.misses.map((item) => item.reason)).toEqual(['changed']);
      expect(outcome.kind).toBe('published');
      expect(referenceOf(outcome)).not.toBe(cold.summaries['person:ada']);
      expect(world.checks['person:ada']).toBe(1);
      expect(world.summaries['person:ada']).toBe(1);
    }, { adaActivitySubject: 'activity:acme/widget:2026-Q1:person:ada:relocated' });
  });

  test('a supported memo record without its own implementation evidence is an integrity failure before any work', async () => {
    const location = freshLocation();
    const cold = await coldReport(location);
    await withSession(location, async (session) => {
      publishCrafted(session.history, session.lease, cold.summaries['person:ada'], (content) => ({
        ...content,
        observations: (content.observations as { readonly binding: { readonly path: readonly string[] } }[]).filter((item) => item.binding.path[0] !== 'self'),
      }), 'crafted-no-self');
    });
    resetCounts();
    await withSession(location, async (session) => {
      const start = session.sqlite.mark();
      let caught: unknown;
      try {
        await session.resolve(session.contributors.steps['person:ada'].summary);
      } catch (error: unknown) {
        caught = error;
      }
      expect(caught).toBeInstanceOf(ResolutionError);
      expect((caught as ResolutionError).code).toBe('integrity');
      expect(counts()).toEqual({ checks: 0, finalities: 0, summaries: 0 });
      expect(session.admissions).toHaveLength(0);
      expect(session.sqlite.evidence(start).roles.allocate).toBeUndefined();
    });
  });

  test.each([
    ['a recorded child naming a missing result', (_session: ISession, child: Record<string, unknown>) => ({ ...child, reference: { kind: 'completed-result', locator: `mdh1|${JSON.stringify(['store:contributors', analysis, environment, 999_999])}` } })],
    ['a recorded child naming a result in another environment', (session: ISession, child: Record<string, unknown>) => {
      const other = session.history.allocateAttempt(session.lease, { analysis, environment: 'env:other', subject: 'activity:acme/widget:2026-Q1:person:ada', version: 1, attemptKey: 'other-scope', intentDigest: 'other-scope' });
      session.history.stageAttempt(session.lease, { attemptId: other.attemptId, payload: benActivity(), provenance: { format: 'test.other', formatVersion: 1, content: {} }, dependencies: [] });
      return { ...child, reference: session.history.publishAttempt(session.lease, other.attemptId) };
    }],
    ['a recorded child naming another member\'s result', (session: ISession, child: Record<string, unknown>) => {
      const ben = session.history.readCurrent({ analysis, environment, subject: 'activity:acme/widget:2026-Q1:person:ben' });
      return { ...child, reference: ben };
    }],
  ])('%s outside the exact dependencies is an integrity failure: no body, no attempt, no retargeting', async (_label, update) => {
    const location = freshLocation();
    const cold = await coldReport(location);
    await withSession(location, async (session) => {
      publishCrafted(session.history, session.lease, cold.summaries['person:ada'], (content) => rewriteChild((child) => update(session, child))(content), 'crafted-integrity');
    });
    resetCounts();
    await withSession(location, async (session) => {
      const start = session.sqlite.mark();
      let caught: unknown;
      try {
        await session.resolve(session.contributors.steps['person:ada'].summary);
      } catch (error: unknown) {
        caught = error;
      }
      expect(caught).toBeInstanceOf(ResolutionError);
      expect((caught as ResolutionError).code).toBe('integrity');
      expect(world.summaries['person:ada']).toBe(0);
      expect(session.sqlite.evidence(start).roles.allocate).toBeUndefined();
    });
  });
});
