/**
 * Current source policy through Reuse Resolution over real durable History
 * (issue #56 acceptance 1–2; A-03, A-10). Expected outcomes come from the
 * owning contracts: candidates are filtered by scoped subject and version,
 * then the candidate's own actually called implementation and consumed inputs
 * are validated, and only then is the *current* finality hook evaluated. True
 * retains the exact reference; false or absent enters the source check, which
 * may explicitly retain only its eligible previous carrier or supply fresh
 * data that becomes a distinct publication. Hook failure is never success.
 *
 * @see ../../../../docs/spec/execution.md (RES-004, RES-005, REUSE-002, REUSE-004, transition table)
 * @see ../../../../docs/plans/m3-contribution-analysis.md (Candidate eligibility and current source policy)
 */
import { afterEach, beforeEach, describe, expect, test } from '@jest/globals';
import { ResolutionError } from '@microdelta/resolution';

import { cleanup, freshLocation } from '../durable-history/support.js';
import { adaActivity, resetWorld, world } from './fixture.js';
import { environment, openSession, payloadOf, referenceOf } from './support.js';
import type { ISession } from './support.js';

beforeEach(() => {
  resetWorld();
});
afterEach(cleanup);

/** The scoped subject of Ada's activity source. */
const adaActivitySubject = { analysis: 'contribution-report:acme/widget', environment, subject: 'activity:acme/widget:2026-Q1:person:ada' };

/** Run one session to completion around `body`. */
async function withSession<T>(location: string, body: (session: ISession) => Promise<T>, variation: Parameters<typeof openSession>[1] = {}): Promise<T> {
  const session = openSession(location, variation);
  try {
    return await body(session);
  } finally {
    session.close();
  }
}

/** Publish Ada's activity cold and return its exact locator. */
async function coldAda(location: string): Promise<string> {
  return withSession(location, async (session) => {
    const outcome = await session.resolve(session.contributors.steps['person:ada'].activity);
    expect(outcome.kind).toBe('published');
    return referenceOf(outcome);
  });
}

/** Expect a promise to reject with a ResolutionError of `code`. */
async function expectFailure(promise: Promise<unknown>, code: ResolutionError['code']): Promise<ResolutionError> {
  let caught: unknown;
  try {
    await promise;
  } catch (error: unknown) {
    caught = error;
  }
  expect(caught).toBeInstanceOf(ResolutionError);
  const failure = caught as ResolutionError;
  expect(failure.code).toBe(code);
  return failure;
}

describe('cold sources', () => {
  test('a cold source has no eligible previous result: no finality, check receives absence, fresh data publishes', async () => {
    const location = freshLocation();
    await withSession(location, async (session) => {
      const outcome = await session.resolve(session.contributors.steps['person:ada'].activity);
      expect(outcome.kind).toBe('published');
      expect(world.finalities['person:ada']).toBe(0);
      expect(world.checks['person:ada']).toBe(1);
      expect(world.sawPrevious['person:ada']).toEqual([false]);
      // Framework lifecycle: verification precedes admission, which precedes the claim and the body.
      expect(outcome.trace.map((event) => event.phase)).toEqual(['verify', 'admit', 'claim', 'execute', 'publish']);
      expect(payloadOf(session.history, referenceOf(outcome))).toEqual(adaActivity());
      expect(session.history.readCurrent(adaActivitySubject)?.locator).toBe(referenceOf(outcome));
    });
  });

  test('a cold check cannot retain: retaining without an eligible carrier fails and publishes nothing', async () => {
    const location = freshLocation();
    world.check['person:ada'] = 'retain';
    await withSession(location, async (session) => {
      await expectFailure(session.resolve(session.contributors.steps['person:ada'].activity), 'invalid-retention');
      expect(session.history.readCurrent(adaActivitySubject)).toBeUndefined();
      expect(session.history.findCandidates({ ...adaActivitySubject, version: 1 })).toHaveLength(0);
    });
  });
});

describe('current finality after restart', () => {
  test('an accepting current hook retains the exact reference with zero checks, again in every later session', async () => {
    const location = freshLocation();
    const first = await coldAda(location);
    world.checks['person:ada'] = 0;
    for (const session of [1, 2]) {
      await withSession(location, async (current) => {
        const outcome = await current.resolve(current.contributors.steps['person:ada'].activity);
        expect(outcome.kind).toBe('reused');
        if (outcome.kind !== 'reused') {
          return;
        }
        expect(outcome.basis).toBe('finality');
        expect(outcome.reference.locator).toBe(first);
        // Acceptance is a separate record naming the unchanged exact result.
        expect(outcome.acceptance.reference.locator).toBe(first);
        expect(current.history.readAcceptances(outcome.reference)).toHaveLength(session);
        expect(outcome.trace.map((event) => event.phase)).toEqual(['verify', 'finality', 'accept']);
        expect(current.admissions).toHaveLength(0);
      });
      // No stored finality answer: the current hook ran once in each session.
      expect(world.finalities['person:ada']).toBe(session);
      expect(world.checks['person:ada']).toBe(0);
    }
  });

  test('a false hook enters the check with the eligible carrier; fresh equal data is a distinct publication', async () => {
    const location = freshLocation();
    const first = await coldAda(location);
    world.finality['person:ada'] = 'not-final';
    await withSession(location, async (session) => {
      const outcome = await session.resolve(session.contributors.steps['person:ada'].activity);
      expect(world.finalities['person:ada']).toBe(1);
      expect(world.checks['person:ada']).toBe(2);
      expect(world.sawPrevious['person:ada']).toEqual([false, true]);
      expect(outcome.kind).toBe('published');
      const second = referenceOf(outcome);
      expect(second).not.toBe(first);
      // Both exact results remain readable with equal content; the old one is not replaced.
      expect(payloadOf(session.history, second)).toEqual(payloadOf(session.history, first));
      expect(session.history.readCurrent(adaActivitySubject)?.locator).toBe(second);
      expect(outcome.trace.map((event) => event.phase)).toEqual(['verify', 'finality', 'admit', 'claim', 'execute', 'publish']);
    });
  });

  test('a check that read its previous result stays eligible later: previous reads are history, not current inputs', async () => {
    const location = freshLocation();
    await coldAda(location);
    world.finality['person:ada'] = 'not-final';
    const second = await withSession(location, async (session) => referenceOf(await session.resolve(session.contributors.steps['person:ada'].activity)));
    world.finality['person:ada'] = 'final';
    await withSession(location, async (session) => {
      const envelope = session.history.readEnvelope({ kind: 'completed-result', locator: second });
      const paths = (envelope.provenance.content as { readonly observations: readonly { readonly binding: { readonly path: readonly string[] } }[] }).observations.map((item) => item.binding.path.join('/'));
      expect(paths).toContain('previous');
      const outcome = await session.resolve(session.contributors.steps['person:ada'].activity);
      expect(outcome.kind).toBe('reused');
      expect(referenceOf(outcome)).toBe(second);
      expect(outcome.misses).toEqual([]);
    });
  });

  test('an absent hook supplies no shortcut; an explicit check retention keeps the exact reference with separate acceptance', async () => {
    const location = freshLocation();
    const first = await withSession(location, async (session) => referenceOf(await session.resolve(session.contributors.steps['person:ada'].activity)), { adaFinality: 'absent' });
    world.check['person:ada'] = 'retain';
    await withSession(location, async (session) => {
      const outcome = await session.resolve(session.contributors.steps['person:ada'].activity);
      expect(world.finalities['person:ada']).toBe(0);
      expect(world.checks['person:ada']).toBe(2);
      expect(outcome.kind).toBe('reused');
      if (outcome.kind !== 'reused') {
        return;
      }
      expect(outcome.basis).toBe('check');
      expect(outcome.reference.locator).toBe(first);
      expect(session.history.readCurrent(adaActivitySubject)?.locator).toBe(first);
      // The check's work is recorded as acceptance evidence, never folded into the original provenance.
      const envelope = session.history.readEnvelope(outcome.reference);
      expect(session.history.readAcceptances(outcome.reference).map((record) => record.acceptanceId)).toEqual([outcome.acceptance.acceptanceId]);
      expect(outcome.acceptance.evidence.content).not.toEqual(envelope.provenance.content);
      // The admitted claim ends without a new result once the check retained.
      expect(outcome.trace.map((event) => event.phase)).toEqual(['verify', 'admit', 'claim', 'execute', 'accept', 'release']);
    }, { adaFinality: 'absent' });
  });

  test('a changed retrieval implementation is ineligible even though the current hook would accept: hook runs zero times', async () => {
    const location = freshLocation();
    const first = await coldAda(location);
    await withSession(location, async (session) => {
      const outcome = await session.resolve(session.contributors.steps['person:ada'].activity);
      expect(world.finalities['person:ada']).toBe(0);
      expect(world.sawPrevious['person:ada']).toEqual([false, false]);
      expect(outcome.kind).toBe('published');
      expect(referenceOf(outcome)).not.toBe(first);
      expect(outcome.misses.map((miss) => miss.reason)).toEqual(['changed']);
      expect(outcome.misses[0]?.candidate.locator).toBe(first);
    }, { adaSource: 'changed' });
  });

  test('an incompatible version has no eligible previous result: no finality, absence to the check, old history kept', async () => {
    const location = freshLocation();
    const first = await coldAda(location);
    await withSession(location, async (session) => {
      const outcome = await session.resolve(session.contributors.steps['person:ada'].activity);
      expect(world.finalities['person:ada']).toBe(0);
      expect(world.sawPrevious['person:ada']).toEqual([false, false]);
      expect(outcome.kind).toBe('published');
      // The version-1 candidate is outside the version-2 group, so it is not even a miss.
      expect(outcome.misses).toEqual([]);
      expect(session.history.findCandidates({ ...adaActivitySubject, version: 1 }).map((envelope) => envelope.reference.locator)).toEqual([first]);
    }, { adaActivityVersion: 2 });
  });

  test('a changed consumed input makes the candidate ineligible before finality', async () => {
    const location = freshLocation();
    await coldAda(location);
    await withSession(location, async (session) => {
      const outcome = await session.resolve(session.contributors.steps['person:ada'].activity);
      expect(world.finalities['person:ada']).toBe(0);
      expect(outcome.kind).toBe('published');
      expect(outcome.misses.map((miss) => miss.reason)).toEqual(['changed']);
    }, { config: { repository: 'acme/widget', window: { start: '2026-01-15', end: '2026-04-01' } } });
  });
});

describe('policy and control failures are never success', () => {
  test('a throwing hook fails current validation without checks, acceptance or publication', async () => {
    const location = freshLocation();
    const first = await coldAda(location);
    world.finality['person:ada'] = 'throw';
    await withSession(location, async (session) => {
      const failure = await expectFailure(session.resolve(session.contributors.steps['person:ada'].activity), 'policy-failure');
      expect(failure.cause).toBeInstanceOf(Error);
      expect(world.checks['person:ada']).toBe(1);
      const reference = { kind: 'completed-result' as const, locator: first };
      expect(session.history.readAcceptances(reference)).toHaveLength(0);
      expect(session.history.readCurrent(adaActivitySubject)?.locator).toBe(first);
    });
  });

  test('a non-boolean hook answer is a policy failure, not acceptance', async () => {
    const location = freshLocation();
    await coldAda(location);
    world.finality['person:ada'] = 'non-boolean';
    await withSession(location, async (session) => {
      await expectFailure(session.resolve(session.contributors.steps['person:ada'].activity), 'policy-failure');
      expect(world.checks['person:ada']).toBe(1);
    });
  });

  test.each([
    ['retaining a carrier look-alike', 'retain-forged-carrier', 'invalid-retention'],
    ['returning an envelope-shaped payload', 'return-forged-envelope', 'invalid-outcome'],
    ['returning raw data', 'return-raw-data', 'invalid-outcome'],
    ['a throwing check', 'throw', 'execution-failure'],
  ] as const)('%s fails, abandons its attempt and leaves the eligible result current', async (_label, policy, code) => {
    const location = freshLocation();
    const first = await coldAda(location);
    world.finality['person:ada'] = 'not-final';
    world.check['person:ada'] = policy;
    await withSession(location, async (session) => {
      const before = session.sqlite.mark();
      await expectFailure(session.resolve(session.contributors.steps['person:ada'].activity), code);
      expect(session.history.readCurrent(adaActivitySubject)?.locator).toBe(first);
      expect(session.history.findCandidates({ ...adaActivitySubject, version: 1 })).toHaveLength(1);
      expect(session.history.readAcceptances({ kind: 'completed-result', locator: first })).toHaveLength(0);
      const roles = session.sqlite.evidence(before).roles;
      expect(roles.allocate).toBeGreaterThan(0);
      expect(roles.abandon).toBeGreaterThan(0);
      expect(roles.publish).toBeUndefined();
    });
  });

  test('a carrier from an earlier invocation cannot be retained by a later one', async () => {
    const location = freshLocation();
    await coldAda(location);
    world.finality['person:ada'] = 'not-final';
    // The second session's check stashes its eligible carrier and publishes fresh data.
    await withSession(location, async (session) => {
      expect((await session.resolve(session.contributors.steps['person:ada'].activity)).kind).toBe('published');
    });
    expect(world.carriers['person:ada']).toBeDefined();
    world.check['person:ada'] = 'retain-stashed';
    await withSession(location, async (session) => {
      await expectFailure(session.resolve(session.contributors.steps['person:ada'].activity), 'invalid-retention');
    });
  });
});
