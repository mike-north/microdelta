/**
 * Admission, check-only evaluation, lifecycle observers and explicit recovery
 * through Reuse Resolution over real durable History (issue #56 acceptance 5
 * and its recovery ownership). Admission is consulted only after reuse had its
 * chance and before any claim, attempt or body; denial is a typed outcome that
 * leaves no attempt. Check-only evaluation never claims, executes or writes.
 * Recovery recomputes a request's attempt key and complete intent without
 * running author callbacks and reports what durably happened; a different
 * intent is rejected, and nothing incomplete is executed automatically.
 *
 * @see ../../../../docs/spec/execution.md (REUSE-009, PUB-004)
 * @see ../../../../docs/plans/m3-contribution-analysis.md (Explicit recovery request; Supervision and actual consumer path)
 */
import { afterEach, beforeEach, describe, expect, test } from '@jest/globals';
import { ResolutionError } from '@microdelta/resolution';

import { cleanup, freshLocation } from '../durable-history/support.js';
import { adaActivity, defaultConfig, resetWorld, world } from './fixture.js';
import type { IMemberKey, IVariation } from './fixture.js';
import { freshRequestKey, openSession, referenceOf, resolveSummaries } from './support.js';
import type { IAdmissionPlan, IObserverPlan, ISession } from './support.js';

beforeEach(() => {
  resetWorld();
});
afterEach(cleanup);

/** Run one session around `body`. */
async function withSession<T>(location: string, body: (session: ISession) => Promise<T>, variation: IVariation = {}, plans: { readonly admission?: IAdmissionPlan; readonly observer?: IObserverPlan } = {}): Promise<T> {
  const session = openSession(location, variation, plans);
  try {
    return await body(session);
  } finally {
    session.close();
  }
}

/** Expect a ResolutionError of `code`. */
async function expectFailure(promise: Promise<unknown> | (() => unknown), code: ResolutionError['code']): Promise<void> {
  let caught: unknown;
  try {
    await (typeof promise === 'function' ? promise() : promise);
  } catch (error: unknown) {
    caught = error;
  }
  expect(caught).toBeInstanceOf(ResolutionError);
  expect((caught as ResolutionError).code).toBe(code);
}

/** Publish both summaries cold. */
async function coldReport(location: string): Promise<Record<IMemberKey, string>> {
  return withSession(location, async (session) => {
    const outcomes = await resolveSummaries(session);
    return { 'person:ada': referenceOf(outcomes['person:ada']), 'person:ben': referenceOf(outcomes['person:ben']) };
  });
}

describe('admission after reuse and before claims', () => {
  test('valid hits never reach admission', async () => {
    const location = freshLocation();
    await coldReport(location);
    await withSession(location, async (session) => {
      const outcomes = await resolveSummaries(session);
      expect(outcomes['person:ada'].kind).toBe('reused');
      expect(session.admissions).toHaveLength(0);
    }, {}, { admission: { deny: [{ memberKey: 'person:ada', slot: 'summary' }, { memberKey: 'person:ada', slot: 'activity' }] } });
  });

  test('a denied summary miss is refused with no claim, attempt or body; its child work was admitted independently', async () => {
    const location = freshLocation();
    await coldReport(location);
    world.finality['person:ada'] = 'not-final';
    world.remote['person:ada'] = adaActivity({ merged103: true });
    world.summaries['person:ada'] = 0;
    await withSession(location, async (session) => {
      const requestKey = freshRequestKey();
      const outcome = await session.resolve(session.contributors.steps['person:ada'].summary, requestKey);
      expect(outcome.kind).toBe('refused');
      if (outcome.kind !== 'refused') {
        return;
      }
      expect(outcome.refused).toEqual(session.contributors.steps['person:ada'].summary);
      expect(world.summaries['person:ada']).toBe(0);
      // The nested source check was admitted on its own and published.
      expect(session.admissions.map((request) => [request.step.slot, request.reason])).toEqual([['activity', 'source-policy'], ['summary', 'invalid']]);
      expect(outcome.trace.map((event) => event.phase)).toEqual(['verify', 'admit', 'refuse']);
      expect(session.resolution.recover({ step: session.contributors.steps['person:ada'].summary, requestKey })).toEqual({ kind: 'absent' });
      expect(session.resolution.recover({ step: session.contributors.steps['person:ada'].activity, requestKey }).kind).toBe('recovered');
    }, {}, { admission: { deny: [{ memberKey: 'person:ada', slot: 'summary' }] } });
  });

  test('denied source work needed for validation refuses the summary without any attempt', async () => {
    const location = freshLocation();
    await coldReport(location);
    world.finality['person:ada'] = 'not-final';
    await withSession(location, async (session) => {
      const start = session.sqlite.mark();
      const outcome = await session.resolve(session.contributors.steps['person:ada'].summary);
      expect(outcome.kind).toBe('refused');
      if (outcome.kind === 'refused') {
        expect(outcome.refused).toEqual(session.contributors.steps['person:ada'].activity);
      }
      expect(session.sqlite.evidence(start).roles.allocate).toBeUndefined();
      expect(world.checks['person:ada']).toBe(1);
      expect(world.summaries['person:ada']).toBe(1);
    }, {}, { admission: { deny: [{ memberKey: 'person:ada', slot: 'activity' }] } });
  });

  test('a child refused during an admitted body refuses the summary and ends its attempt without a result', async () => {
    const location = freshLocation();
    await withSession(location, async (session) => {
      const requestKey = freshRequestKey();
      const outcome = await session.resolve(session.contributors.steps['person:ada'].summary, requestKey);
      expect(outcome.kind).toBe('refused');
      if (outcome.kind === 'refused') {
        expect(outcome.refused).toEqual(session.contributors.steps['person:ada'].activity);
      }
      expect(session.admissions.map((request) => [request.step.slot, request.reason])).toEqual([['summary', 'cold'], ['activity', 'cold']]);
      expect(world.checks['person:ada']).toBe(0);
      expect(world.summaries['person:ada']).toBe(0);
      expect(session.history.findCandidates({ analysis: session.contributors.composition.scope, environment: 'env:fixture', subject: 'summary:acme/widget:2026-Q1:person:ada', version: 1 })).toHaveLength(0);
      expect(session.resolution.recover({ step: session.contributors.steps['person:ada'].summary, requestKey })).toMatchObject({ kind: 'unsuccessful' });
    }, {}, { admission: { deny: [{ memberKey: 'person:ada', slot: 'activity' }] } });
  });

  test('a throwing admission port fails only the affected call, before any attempt', async () => {
    const location = freshLocation();
    await withSession(location, async (session) => {
      const start = session.sqlite.mark();
      await expectFailure(session.resolve(session.contributors.steps['person:ada'].summary), 'admission-failure');
      expect(session.sqlite.evidence(start).roles.allocate).toBeUndefined();
      expect(world.summaries['person:ada']).toBe(0);
    }, {}, { admission: { fail: true } });
  });
});

describe('check-only evaluation', () => {
  test('an unchanged report is reusable with no admission, attempts, bodies or acceptance writes', async () => {
    const location = freshLocation();
    const cold = await coldReport(location);
    world.finalities['person:ada'] = 0;
    await withSession(location, async (session) => {
      const start = session.sqlite.mark();
      const outcome = await session.resolution.check({ step: session.contributors.steps['person:ada'].summary });
      expect(outcome).toMatchObject({ kind: 'reusable', basis: 'validated', reference: { locator: cold['person:ada'] } });
      const evidence = session.sqlite.evidence(start);
      expect(evidence.roles.accept).toBeUndefined();
      expect(evidence.roles.allocate).toBeUndefined();
      expect(session.admissions).toHaveLength(0);
      // Current policy still runs: the hook is policy evaluation, not source work.
      expect(world.finalities['person:ada']).toBe(1);
    });
  });

  test('needed source work stops at that boundary with downstream uncertainty and no source check', async () => {
    const location = freshLocation();
    await coldReport(location);
    world.finality['person:ada'] = 'not-final';
    world.checks['person:ada'] = 0;
    await withSession(location, async (session) => {
      const outcome = await session.resolution.check({ step: session.contributors.steps['person:ada'].summary });
      expect(outcome).toMatchObject({ kind: 'uncertain', boundary: session.contributors.steps['person:ada'].activity });
      expect(world.checks['person:ada']).toBe(0);
      expect(session.admissions).toHaveLength(0);
    });
  });

  test('a summary whose own evidence changed requires execution, without replaying its body as validation', async () => {
    const location = freshLocation();
    await coldReport(location);
    world.summaries['person:ada'] = 0;
    await withSession(location, async (session) => {
      const start = session.sqlite.mark();
      const outcome = await session.resolution.check({ step: session.contributors.steps['person:ada'].summary });
      expect(outcome.kind).toBe('execution-required');
      expect(world.summaries['person:ada']).toBe(0);
      expect(session.sqlite.evidence(start).roles.allocate).toBeUndefined();
    }, { formatter: 'revised' });
  });
});

describe('explicit recovery by saved request key', () => {
  test('recovery returns the exact committed success without hooks, bodies or new acceptance; a new request still runs current policy', async () => {
    const location = freshLocation();
    const requestKey = 'saved:request:ada';
    const published = await withSession(location, async (session) => referenceOf(await session.resolve(session.contributors.steps['person:ada'].summary, requestKey)));
    const before = { checks: world.checks['person:ada'], finalities: world.finalities['person:ada'], summaries: world.summaries['person:ada'] };
    await withSession(location, async (session) => {
      const start = session.sqlite.mark();
      const recovered = session.resolution.recover({ step: session.contributors.steps['person:ada'].summary, requestKey });
      expect(recovered).toMatchObject({ kind: 'recovered', reference: { locator: published } });
      expect({ checks: world.checks['person:ada'], finalities: world.finalities['person:ada'], summaries: world.summaries['person:ada'] }).toEqual(before);
      const evidence = session.sqlite.evidence(start);
      expect(evidence.roles.accept).toBeUndefined();
      expect(evidence.roles.allocate).toBeUndefined();
      expect(session.history.readAcceptances({ kind: 'completed-result', locator: published })).toHaveLength(0);
      // A subsequent normal request with a fresh key performs current source policy.
      const current = await session.resolve(session.contributors.steps['person:ada'].summary);
      expect(current.kind).toBe('reused');
      expect(world.finalities['person:ada']).toBe(before.finalities + 1);
    });
  });

  test('recovery with a different current intent is rejected rather than served', async () => {
    const location = freshLocation();
    const requestKey = 'saved:request:intent';
    await withSession(location, async (session) => {
      await session.resolve(session.contributors.steps['person:ada'].summary, requestKey);
    });
    await withSession(location, async (session) => {
      await expectFailure(() => session.resolution.recover({ step: session.contributors.steps['person:ada'].summary, requestKey }), 'wrong-intent');
    }, { formatter: 'revised' });
    await withSession(location, async (session) => {
      await expectFailure(() => session.resolution.recover({ step: session.contributors.steps['person:ada'].summary, requestKey }), 'wrong-intent');
    }, { config: { ...defaultConfig, repository: 'acme/widget' }, summaryVersion: 2 });
  });

  test('reusing an allocated request key for a different execution is a conflict, not a silent hit', async () => {
    const location = freshLocation();
    const requestKey = 'saved:request:conflict';
    await withSession(location, async (session) => {
      await session.resolve(session.contributors.steps['person:ada'].summary, requestKey);
    });
    await withSession(location, async (session) => {
      await expectFailure(session.resolve(session.contributors.steps['person:ada'].summary, requestKey), 'wrong-intent');
      expect(world.summaries['person:ada']).toBe(1);
    }, { formatter: 'revised' });
  });

  test('a normal retry with an already committed key is rejected before admission, never served as new work', async () => {
    const location = freshLocation();
    const requestKey = 'saved:request:committed';
    await withSession(location, async (session) => {
      expect((await session.resolve(session.contributors.steps['person:ada'].activity, requestKey)).kind).toBe('published');
    });
    world.finality['person:ada'] = 'not-final';
    await withSession(location, async (session) => {
      await expectFailure(session.resolve(session.contributors.steps['person:ada'].activity, requestKey), 'invalid-request');
      expect(session.admissions).toHaveLength(0);
      expect(world.checks['person:ada']).toBe(1);
      // The committed execution remains recoverable through the separate operation.
      expect(session.resolution.recover({ step: session.contributors.steps['person:ada'].activity, requestKey }).kind).toBe('recovered');
    });
  });

  test('documents the disclosed History gap: a check retention ends its attempt without a result, so recovery reports unsuccessful', async () => {
    const location = freshLocation();
    await withSession(location, async (session) => {
      await session.resolve(session.contributors.steps['person:ada'].activity);
    }, { adaFinality: 'absent' });
    world.check['person:ada'] = 'retain';
    await withSession(location, async (session) => {
      const requestKey = freshRequestKey();
      expect((await session.resolve(session.contributors.steps['person:ada'].activity, requestKey)).kind).toBe('reused');
      expect(session.resolution.recover({ step: session.contributors.steps['person:ada'].activity, requestKey }).kind).toBe('unsuccessful');
    }, { adaFinality: 'absent' });
  });

  test('absent and unsuccessful executions are reported explicitly and never executed by recovery', async () => {
    const location = freshLocation();
    world.summaryThrows['person:ada'] = true;
    await withSession(location, async (session) => {
      const failedKey = 'saved:request:failed';
      await expectFailure(session.resolve(session.contributors.steps['person:ada'].summary, failedKey), 'execution-failure');
      expect(session.resolution.recover({ step: session.contributors.steps['person:ada'].summary, requestKey: failedKey }).kind).toBe('unsuccessful');
      expect(session.resolution.recover({ step: session.contributors.steps['person:ada'].summary, requestKey: 'saved:request:never' })).toEqual({ kind: 'absent' });
      expect(world.summaries['person:ada']).toBe(1);
    });
  });

  test('an empty request key is rejected before any work', async () => {
    const location = freshLocation();
    await withSession(location, async (session) => {
      await expectFailure(session.resolve(session.contributors.steps['person:ada'].summary, ''), 'invalid-request');
      await expectFailure(() => session.resolution.recover({ step: session.contributors.steps['person:ada'].summary, requestKey: '' }), 'invalid-request');
      expect(world.checks['person:ada']).toBe(0);
    });
  });
});

describe('lifecycle observers', () => {
  test('an observer failure after publication commits is a diagnostic beside the committed success', async () => {
    const location = freshLocation();
    await withSession(location, async (session) => {
      const outcome = await session.resolve(session.contributors.steps['person:ada'].activity);
      expect(outcome.kind).toBe('published');
      expect(outcome.diagnostics).toEqual([expect.stringContaining('observer failure at publish')]);
      expect(session.history.readCurrent({ analysis: session.contributors.composition.scope, environment: 'env:fixture', subject: 'activity:acme/widget:2026-Q1:person:ada' })?.locator).toBe(referenceOf(outcome));
    }, {}, { observer: { throwAt: 'publish' } });
  });

  /** Diagnostics naming a step slot and phase. */
  function about(diagnostics: readonly string[], slot: string, phase: string): readonly string[] {
    return diagnostics.filter((line) => line.includes(`"${slot}"`) && line.includes(`at ${phase}`));
  }

  test('a child acceptance observer failure beneath an executing parent is reported on the top-level outcome', async () => {
    const location = freshLocation();
    const cold = await coldReport(location);
    await withSession(location, async (session) => {
      const outcome = await session.resolve(session.contributors.steps['person:ada'].summary);
      expect(outcome.kind).toBe('published');
      expect(referenceOf(outcome)).not.toBe(cold['person:ada']);
      expect(about(outcome.diagnostics, 'activity', 'accept')).toHaveLength(1);
      expect(outcome.diagnostics).toHaveLength(1);
    }, { summaryVersion: 2 }, { observer: { throwAt: 'accept' } });
  });

  test('child and parent publication observer failures beneath an executing parent are each reported once', async () => {
    const location = freshLocation();
    await withSession(location, async (session) => {
      const outcome = await session.resolve(session.contributors.steps['person:ada'].summary);
      expect(outcome.kind).toBe('published');
      expect(about(outcome.diagnostics, 'activity', 'publish')).toHaveLength(1);
      expect(about(outcome.diagnostics, 'summary', 'publish')).toHaveLength(1);
      expect(outcome.diagnostics).toHaveLength(2);
    }, {}, { observer: { throwAt: 'publish' } });
  });

  test('child and parent acceptance observer failures beneath a cached parent are each reported once', async () => {
    const location = freshLocation();
    const cold = await coldReport(location);
    await withSession(location, async (session) => {
      const outcome = await session.resolve(session.contributors.steps['person:ada'].summary);
      expect(outcome.kind).toBe('reused');
      expect(referenceOf(outcome)).toBe(cold['person:ada']);
      expect(about(outcome.diagnostics, 'activity', 'accept')).toHaveLength(1);
      expect(about(outcome.diagnostics, 'summary', 'accept')).toHaveLength(1);
      expect(outcome.diagnostics).toHaveLength(2);
    }, {}, { observer: { throwAt: 'accept' } });
  });

  test('a child publication observer failure beneath a cached parent is reported once, even when the executing body shares the child', async () => {
    const location = freshLocation();
    const cold = await coldReport(location);
    world.finality['person:ada'] = 'not-final';
    world.remote['person:ada'] = adaActivity({ avatar: 'https://avatars.example/ada-3.png' });
    await withSession(location, async (session) => {
      const outcome = await session.resolve(session.contributors.steps['person:ada'].summary);
      expect(outcome.kind).toBe('reused');
      expect(referenceOf(outcome)).toBe(cold['person:ada']);
      expect(outcome.diagnostics).toEqual(about(outcome.diagnostics, 'activity', 'publish'));
      expect(outcome.diagnostics).toHaveLength(1);
    }, {}, { observer: { throwAt: 'publish' } });
    world.remote['person:ada'] = adaActivity({ merged103: true });
    await withSession(location, async (session) => {
      const outcome = await session.resolve(session.contributors.steps['person:ada'].summary);
      // Validation resolved the child once; the executing body shared it.
      expect(outcome.kind).toBe('published');
      expect(about(outcome.diagnostics, 'activity', 'publish')).toHaveLength(1);
      expect(about(outcome.diagnostics, 'summary', 'publish')).toHaveLength(1);
      expect(outcome.diagnostics).toHaveLength(2);
    }, {}, { observer: { throwAt: 'publish' } });
  });

  test('an observer failure before execution stops only that call, with no attempt or body', async () => {
    const location = freshLocation();
    await withSession(location, async (session) => {
      const start = session.sqlite.mark();
      await expectFailure(session.resolve(session.contributors.steps['person:ada'].activity), 'observer-failure');
      expect(world.checks['person:ada']).toBe(0);
      expect(session.sqlite.evidence(start).roles.allocate).toBeUndefined();
    }, {}, { observer: { throwAt: 'verify' } });
  });

  test('an unbound step is rejected before any work', async () => {
    const location = freshLocation();
    await withSession(location, async (session) => {
      await expectFailure(session.resolve({ scope: session.contributors.composition.scope, role: 'step', slot: 'missing', memberKey: 'person:ada' }), 'unbound-step');
    });
  });
});
