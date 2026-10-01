/**
 * Basic A-19 through the workspace run path over the real owners: reusable
 * hits are served before admission is consulted; a refused miss leaves no
 * claim, attempt, body or reference; source work needed by validation obeys
 * its own admission; check-only never runs missing work; a pre-execution
 * observer failure is contained to its call; a post-commit observer failure
 * preserves committed success and its exact reference; every step's trace
 * follows the fixed lifecycle positions; ordinary report assembly is observed
 * on every run without completed-result identity or hidden memoization.
 *
 * @see ../../../../docs/spec/acceptance.md (A-19)
 * @see ../../../../docs/spec/execution.md (REUSE-009)
 * @see ../../../../docs/plans/m3-contribution-analysis.md (Selected execution contract, item 7; Supervision and actual consumer path)
 */
import { afterEach, beforeEach, describe, expect, test } from '@jest/globals';

import { ResolutionError, stepLifecycle } from '../../src/index.js';
import type { IAdmissionDecision, IAdmissionRequest, IAdmissionPolicy, IResolutionOutcome, IRunEvent, IStepDescriptor } from '../../src/index.js';
import { adaActivity, resetWorld } from './fixture.js';
import type { IHelpers, IInputs, IMemberKey, IWorld } from './fixture.js';
import { assemblies, caughtCode, environment, freshRequestKey, locatorOf, openSession, recorder, runReport, tempStore } from './support.js';
import type { ISession, ITempStore } from './support.js';

let store: ITempStore;
let world: IWorld;

beforeEach(() => {
  store = tempStore();
  world = resetWorld();
  assemblies.count = 0;
});

afterEach(() => {
  store.remove();
});

/** An admission policy that records requests and denies the matching ones. */
function policy(deny: (request: IAdmissionRequest) => boolean): IAdmissionPolicy & { readonly requests: IAdmissionRequest[] } {
  const requests: IAdmissionRequest[] = [];
  return {
    requests,
    admit(request: IAdmissionRequest): IAdmissionDecision {
      requests.push(request);
      return deny(request) ? { kind: 'denied', reason: 'fixture budget exhausted' } : { kind: 'admitted' };
    },
  };
}

/** Run one cold report to completion and close its session. */
async function coldReport(): Promise<Record<IMemberKey, string>> {
  const session = openSession(store.location);
  try {
    const { outcomes } = await runReport(session);
    return { 'person:ada': locatorOf(outcomes['person:ada']), 'person:ben': locatorOf(outcomes['person:ben']) };
  } finally {
    session.close();
  }
}

/** Resolve one step in its own run with the given options, returning the run value and its recorder. */
async function resolveOne(session: ISession, step: IStepDescriptor, options: { readonly requestKey?: string; readonly admission?: IAdmissionPolicy; readonly throwAt?: (event: IRunEvent) => boolean } = {}): Promise<{
  readonly outcome: IResolutionOutcome | undefined;
  readonly error: unknown;
  readonly diagnostics: readonly string[];
  readonly events: ReturnType<typeof recorder>;
}> {
  const events = recorder();
  const throwing = { observe: (event: IRunEvent): void => { if (options.throwAt?.(event) === true) { throw new Error(`observer failure at ${event.kind === 'step' ? event.event.phase : event.kind === 'stop' ? event.level : event.kind === 'promotion' ? event.kind : event.phase}`); } } };
  let error: unknown;
  const result = await session.workspace.run<IInputs, IHelpers, IResolutionOutcome | undefined>({
    authoring: session.contributors.authoring,
    composition: session.contributors.composition,
    environment,
    ...(options.admission === undefined ? {} : { admission: options.admission }),
    observers: [events, throwing],
  }, async (run) => {
    try {
      return await run.resolve(step, { requestKey: options.requestKey ?? freshRequestKey() });
    } catch (caught: unknown) {
      error = caught;
      return undefined;
    }
  });
  return { outcome: result.value, error, diagnostics: result.diagnostics, events };
}

describe('admission (A-19, REUSE-009)', () => {
  test('reusable hits are served before a denying admission policy is ever consulted', async () => {
    const cold = await coldReport();
    world = resetWorld();
    const denyAll = policy(() => true);
    const session = openSession(store.location);
    try {
      const { outcomes } = await runReport(session, { admission: denyAll });
      expect(outcomes['person:ada']).toMatchObject({ kind: 'reused' });
      expect(outcomes['person:ben']).toMatchObject({ kind: 'reused' });
      expect(locatorOf(outcomes['person:ada'])).toBe(cold['person:ada']);
      expect(locatorOf(outcomes['person:ben'])).toBe(cold['person:ben']);
      expect(denyAll.requests).toEqual([]);
    } finally {
      session.close();
    }
  });

  test('a refused cold miss leaves no claim, attempt, body or reference, and strands no writer', async () => {
    const denyAdaSummary = policy((request) => request.step.memberKey === 'person:ada' && request.step.slot === 'summary');
    const session = openSession(store.location);
    const requestKey = freshRequestKey();
    try {
      const refused = await resolveOne(session, session.contributors.steps['person:ada'].summary, { requestKey, admission: denyAdaSummary });
      expect(refused.error).toBeUndefined();
      expect(refused.outcome).toMatchObject({ kind: 'refused', reason: 'fixture budget exhausted', refused: session.contributors.steps['person:ada'].summary });
      expect(refused.outcome).not.toHaveProperty('reference');
      expect(refused.events.phases('person:ada', 'summary')).toEqual(['verify', 'admit', 'refuse']);
      expect(refused.events.phases('person:ada', 'activity')).toEqual([]);
      expect(world.summaries['person:ada']).toBe(0);
      expect(world.checks['person:ada']).toBe(0);
      // Nothing was allocated under that request key and nothing became reusable.
      const probe = await session.workspace.run({ authoring: session.contributors.authoring, composition: session.contributors.composition, environment }, async (run) => ({
        recovered: await run.recover(session.contributors.steps['person:ada'].summary, { requestKey }),
        checked: await run.check(session.contributors.steps['person:ada'].summary),
      }));
      expect(probe.value.recovered).toEqual({ kind: 'absent' });
      expect(probe.value.checked).toMatchObject({ kind: 'execution-required' });
      // The writer was released: a later admitted run publishes normally.
      const admitted = await resolveOne(session, session.contributors.steps['person:ada'].summary);
      expect(admitted.outcome).toMatchObject({ kind: 'published' });
    } finally {
      session.close();
    }
  });

  test('source work needed to validate a cached summary obeys its own admission', async () => {
    await coldReport();
    world = resetWorld();
    world.final['person:ada'] = false;
    const denySources = policy((request) => request.kind === 'source');
    const session = openSession(store.location);
    try {
      const refused = await resolveOne(session, session.contributors.steps['person:ada'].summary, { admission: denySources });
      expect(refused.outcome).toMatchObject({ kind: 'refused', refused: session.contributors.steps['person:ada'].activity });
      expect(denySources.requests.map((request) => [request.kind, request.reason, request.step.slot])).toEqual([['source', 'source-policy', 'activity']]);
      expect(world.checks['person:ada']).toBe(0);
      expect(world.summaries['person:ada']).toBe(0);

      // Admitting the source but denying every memo: fresh equal data validates the summary without memo admission.
      const denyMemos = policy((request) => request.kind === 'memo');
      const validated = await resolveOne(session, session.contributors.steps['person:ada'].summary, { admission: denyMemos });
      expect(validated.outcome).toMatchObject({ kind: 'reused', basis: 'validated' });
      expect(denyMemos.requests.map((request) => request.kind)).toEqual(['source']);
      expect(world.checks['person:ada']).toBe(1);
      expect(world.summaries['person:ada']).toBe(0);
    } finally {
      session.close();
    }
  });

  test('check-only reports the source boundary and never runs missing work, admission or writes', async () => {
    const coldSession = openSession(store.location);
    const events = recorder();
    try {
      const cold = await coldSession.workspace.run({ authoring: coldSession.contributors.authoring, composition: coldSession.contributors.composition, environment, observers: [events] },
        (run) => run.check(coldSession.contributors.steps['person:ada'].summary));
      expect(cold.value).toMatchObject({ kind: 'execution-required' });
    } finally {
      coldSession.close();
    }
    await coldReport();
    world = resetWorld();
    world.final['person:ada'] = false;
    world.remote['person:ada'] = adaActivity({ merged103: true });
    const denyAll = policy(() => true);
    const session = openSession(store.location);
    try {
      const checked = await session.workspace.run({ authoring: session.contributors.authoring, composition: session.contributors.composition, environment, admission: denyAll, observers: [events] },
        (run) => run.check(session.contributors.steps['person:ada'].summary));
      expect(checked.value).toMatchObject({ kind: 'uncertain', boundary: session.contributors.steps['person:ada'].activity });
      expect(world.checks['person:ada']).toBe(0);
      expect(world.summaries['person:ada']).toBe(0);
      expect(denyAll.requests).toEqual([]);
      expect(events.events.filter((event) => event.kind === 'step')).toEqual([]);
    } finally {
      session.close();
    }
  });
});

describe('observer positions (A-19, REUSE-009)', () => {
  test('a pre-execution observer failure at admission stops only the affected call, which leaves no attempt', async () => {
    const session = openSession(store.location);
    const requestKey = freshRequestKey();
    try {
      const failed = await resolveOne(session, session.contributors.steps['person:ada'].summary, {
        requestKey,
        // Ada's cold summary reaches admission first; the throw stops that call before any claim.
        throwAt: (event) => event.kind === 'step' && event.event.phase === 'admit' && event.event.step.memberKey === 'person:ada' && event.event.step.slot === 'summary',
      });
      expect(failed.error).toBeInstanceOf(ResolutionError);
      expect(await caughtCode(Promise.reject(failed.error))).toBe('observer-failure');
      expect(world.summaries['person:ada']).toBe(0);
      const other = await resolveOne(session, session.contributors.steps['person:ben'].summary);
      expect(other.outcome).toMatchObject({ kind: 'published' });
      const probe = await session.workspace.run({ authoring: session.contributors.authoring, composition: session.contributors.composition, environment },
        (run) => run.recover(session.contributors.steps['person:ada'].summary, { requestKey }));
      expect(probe.value).toEqual({ kind: 'absent' });
    } finally {
      session.close();
    }
  });

  test('a post-commit observer failure preserves committed success and its exact reference', async () => {
    const session = openSession(store.location);
    let published: string;
    try {
      const committed = await resolveOne(session, session.contributors.steps['person:ada'].summary, {
        throwAt: (event) => event.kind === 'step' && event.event.phase === 'publish' && event.event.step.slot === 'summary',
      });
      expect(committed.error).toBeUndefined();
      expect(committed.outcome).toMatchObject({ kind: 'published' });
      published = committed.outcome === undefined ? '' : locatorOf(committed.outcome);
      expect(committed.diagnostics).toEqual([expect.stringContaining('observer failure at publish')]);
      expect(world.summaries['person:ada']).toBe(1);
    } finally {
      session.close();
    }
    world = resetWorld();
    const restarted = openSession(store.location);
    try {
      const reused = await resolveOne(restarted, restarted.contributors.steps['person:ada'].summary);
      expect(reused.outcome).toMatchObject({ kind: 'reused' });
      expect(reused.outcome === undefined ? '' : locatorOf(reused.outcome)).toBe(published);
      expect(world.summaries['person:ada']).toBe(0);
    } finally {
      restarted.close();
    }
  });

  test('every resolved step reports events only at the fixed lifecycle positions, in their order', async () => {
    const session = openSession(store.location);
    const events = recorder();
    try {
      await runReport(session, { observers: [events] });
      for (const key of ['person:ada', 'person:ben'] as const) {
        for (const slot of ['activity', 'summary']) {
          const positions = events.phases(key, slot).map((phase) => stepLifecycle.indexOf(phase as (typeof stepLifecycle)[number]));
          expect(positions.length).toBeGreaterThan(0);
          expect(positions.every((position, index) => position >= 0 && (index === 0 || position > (positions[index - 1] ?? -1)))).toBe(true);
        }
      }
      expect(events.phases('person:ada', 'summary')).toEqual(['verify', 'admit', 'claim', 'execute', 'publish']);
    } finally {
      session.close();
    }
  });

  test('ordinary report assembly is observed on every run with no reference and no hidden memoization', async () => {
    const first = recorder();
    const second = recorder();
    const cold = openSession(store.location);
    try {
      await runReport(cold, { observers: [first] });
    } finally {
      cold.close();
    }
    const restarted = openSession(store.location);
    try {
      await runReport(restarted, { observers: [second] });
    } finally {
      restarted.close();
    }
    expect(assemblies.count).toBe(2);
    for (const events of [first, second]) {
      const ordinary = events.events.filter((event) => event.kind === 'ordinary');
      expect(ordinary.map((event) => event.kind === 'ordinary' ? [event.label, event.phase] : [])).toEqual([['report', 'begin'], ['report', 'end']]);
      expect(ordinary.every((event) => !('reference' in event) && !('event' in event))).toBe(true);
      expect(events.events.filter((event) => event.kind === 'step' && event.event.step.slot !== 'activity' && event.event.step.slot !== 'summary')).toEqual([]);
    }
  });
});
