/**
 * The workspace's normal and recovery entry operations over the accepted
 * request-key/intent contract, through Supervision and the real owners. The
 * caller saves each request key before starting work. Recovery recomputes
 * intent without running author code, returns the identified execution's
 * exact committed success, runs no source hook, writes no acceptance and
 * never needs the writer lease; different intent is rejected; absent work is
 * reported, never executed. A normal request cannot reuse a saved key, and a
 * fresh key performs current policy. The independent-process lost-
 * acknowledgment proof belongs to the separate acceptance harness.
 *
 * @see ../../../../docs/plans/m3-contribution-analysis.md (Explicit recovery request)
 * @see ../../../../docs/spec/execution.md
 */
import { afterEach, beforeEach, describe, expect, jest, test } from '@jest/globals';
import type { IWriterLease } from '@microdelta/history';
import { createNodeClock } from '@microdelta/machine-node';

import { ResolutionError, SupervisionError, WriterBusyError, openWorkspace } from '../../src/index.js';
import type { IRecoveryResult, IStepDescriptor } from '../../src/index.js';
import { openHistory } from '../durable-history/support.js';
import { composeContributors, resetWorld } from './fixture.js';
import type { IMemberKey, IVariation, IWorld } from './fixture.js';
import { environment, freshRequestKey, locatorOf, logicalStore, openSession, runReport, tempStore } from './support.js';
import type { ISession, ITempStore } from './support.js';

let store: ITempStore;
let world: IWorld;

beforeEach(() => {
  store = tempStore();
  world = resetWorld();
});

afterEach(() => {
  store.remove();
});

/** Recover one step with a saved key in its own run of a new session. */
async function recoverIn(session: ISession, step: IStepDescriptor, requestKey: string): Promise<IRecoveryResult> {
  const result = await session.workspace.run({ authoring: session.contributors.authoring, composition: session.contributors.composition, environment },
    (run) => run.recover(step, { requestKey }));
  return result.value;
}

/** A cold report whose request keys the caller saved first; returns the keys and published references. */
async function savedColdReport(): Promise<{ readonly keys: Record<IMemberKey, string>; readonly refs: Record<IMemberKey, string> }> {
  const keys = { 'person:ada': freshRequestKey(), 'person:ben': freshRequestKey() };
  const session = openSession(store.location);
  try {
    const { outcomes } = await runReport(session, { requestKeys: keys });
    return { keys, refs: { 'person:ada': locatorOf(outcomes['person:ada']), 'person:ben': locatorOf(outcomes['person:ben']) } };
  } finally {
    session.close();
  }
}

/** Count acceptance records naming a reference, read directly from History after sessions closed. */
function acceptances(locator: string): number {
  const history = openHistory({ location: store.location, store: logicalStore });
  try {
    return history.readAcceptances({ kind: 'completed-result', locator }, environment).length;
  } finally {
    history.close();
  }
}

/** Observe the persisted writer through an independent real History connection without changing its authority. */
function persistedWriter(): IWriterLease {
  const history = openHistory({ location: store.location, store: logicalStore, clock: createNodeClock() });
  try {
    const writer = history.currentWriter();
    expect(writer).toBeDefined();
    if (writer === undefined) {
      throw new Error('Expected a persisted writer lease');
    }
    return writer;
  } finally {
    history.close();
  }
}

/** Open a new session, run `body`, and close it. */
async function inSession<T>(variation: IVariation, body: (session: ISession) => Promise<T>): Promise<T> {
  const session = openSession(store.location, variation);
  try {
    return await body(session);
  } finally {
    session.close();
  }
}

describe('recovery entry operation', () => {
  test('recover returns the exact committed summary without source hooks, bodies or a new acceptance', async () => {
    const { keys, refs } = await savedColdReport();
    const before = acceptances(refs['person:ada']);
    world = resetWorld();
    const recovered = await inSession({}, (session) => recoverIn(session, session.contributors.steps['person:ada'].summary, keys['person:ada']));
    expect(recovered).toMatchObject({ kind: 'recovered', reference: { kind: 'completed-result', locator: refs['person:ada'] } });
    expect(world.finalities).toEqual({ 'person:ada': 0, 'person:ben': 0 });
    expect(world.checks).toEqual({ 'person:ada': 0, 'person:ben': 0 });
    expect(world.summaries).toEqual({ 'person:ada': 0, 'person:ben': 0 });
    expect(acceptances(refs['person:ada'])).toBe(before);
  });

  test('recover rejects a saved key whose current declared intent differs', async () => {
    const { keys } = await savedColdReport();
    world = resetWorld();
    let caught: unknown;
    await inSession({ formatter: 'revised' }, async (session) => {
      try {
        await recoverIn(session, session.contributors.steps['person:ada'].summary, keys['person:ada']);
      } catch (error: unknown) {
        caught = error;
      }
    });
    expect(caught).toBeInstanceOf(ResolutionError);
    expect(caught instanceof ResolutionError ? caught.code : undefined).toBe('wrong-intent');
    expect(world.summaries['person:ada']).toBe(0);
  });

  test('recover reports absent for a key that identifies no admitted execution and executes nothing', async () => {
    await savedColdReport();
    world = resetWorld();
    const recovered = await inSession({}, (session) => recoverIn(session, session.contributors.steps['person:ben'].summary, freshRequestKey()));
    expect(recovered).toEqual({ kind: 'absent' });
    expect(world.summaries).toEqual({ 'person:ada': 0, 'person:ben': 0 });
    expect(world.checks).toEqual({ 'person:ada': 0, 'person:ben': 0 });
  });

  test('recovery does not need the writer lease that another holder still owns', async () => {
    const { keys, refs } = await savedColdReport();
    const holder = openHistory({ location: store.location, store: logicalStore, clock: createNodeClock() });
    try {
      const acquisition = holder.acquireWriter({ holder: 'process:lost-acknowledgment', leaseMilliseconds: 3_600_000 });
      expect(acquisition.kind).toBe('acquired');
      await inSession({}, async (session) => {
        const recovered = await recoverIn(session, session.contributors.steps['person:ben'].summary, keys['person:ben']);
        expect(recovered).toMatchObject({ kind: 'recovered', reference: { locator: refs['person:ben'] } });
        let caught: unknown;
        // The operator's deadline has already passed, so the normal request makes one attempt and reports the holder.
        await session.workspace.run({ authoring: session.contributors.authoring, composition: session.contributors.composition, environment, writerWait: { deadline: Date.now() } }, async (run) => {
          try {
            await run.resolve(session.contributors.steps['person:ben'].summary, { requestKey: freshRequestKey() });
          } catch (error: unknown) {
            caught = error;
          }
        });
        expect(caught).toBeInstanceOf(WriterBusyError);
        expect(caught instanceof SupervisionError ? caught.code : undefined).toBe('writer-busy');
        expect(caught instanceof WriterBusyError ? caught.holder : undefined).toBe('process:lost-acknowledgment');
      });
    } finally {
      holder.close();
    }
  });
});

describe('normal entry operation', () => {
  test('a normal request cannot reuse a saved key, while a fresh key performs current source policy', async () => {
    const { keys, refs } = await savedColdReport();
    world = resetWorld();
    await inSession({}, async (session) => {
      let caught: unknown;
      await session.workspace.run({ authoring: session.contributors.authoring, composition: session.contributors.composition, environment }, async (run) => {
        world.final['person:ada'] = false;
        try {
          await run.resolve(session.contributors.steps['person:ada'].summary, { requestKey: keys['person:ada'] });
        } catch (error: unknown) {
          caught = error;
        }
      });
      expect(caught).toBeInstanceOf(ResolutionError);
      expect(caught instanceof ResolutionError ? caught.code : undefined).toBe('invalid-request');
      expect(world.summaries['person:ada']).toBe(0);

      world = resetWorld();
      const fresh = await runReport(session);
      expect(world.finalities).toEqual({ 'person:ada': 1, 'person:ben': 1 });
      expect(locatorOf(fresh.outcomes['person:ada'])).toBe(refs['person:ada']);
    });
  });

  test('a normal request after the run\'s writer lease expired re-acquires a fresh lease instead of failing', async () => {
    // Only the boundary between requests advances: each real request has its
    // full lease interval, while History still observes an expired held lease.
    let hostNow = Date.now();
    const clock = jest.spyOn(Date, 'now').mockImplementation(() => hostNow);
    try {
      const workspace = openWorkspace({ location: store.location, logicalStore, leaseMilliseconds: 250 });
      try {
        const contributors = composeContributors();
        const result = await workspace.run({ authoring: contributors.authoring, composition: contributors.composition, environment, runId: 'run:lease-reacquisition' }, async (run) => {
          const first = await run.resolve(contributors.steps['person:ada'].summary, { requestKey: freshRequestKey() });
          const firstLease = persistedWriter();
          expect(firstLease.holder).toBe('microdelta-run:run:lease-reacquisition');
          expect(firstLease.fence).toBeGreaterThan(0);
          expect(firstLease.expiresAt).toBe(hostNow + 250);
          hostNow = firstLease.expiresAt + 1;
          expect(hostNow).toBeGreaterThan(firstLease.expiresAt);
          const second = await run.resolve(contributors.steps['person:ben'].summary, { requestKey: freshRequestKey() });
          const secondLease = persistedWriter();
          expect(secondLease.holder).toBe(firstLease.holder);
          expect(secondLease.fence).toBeGreaterThan(firstLease.fence);
          expect(secondLease.expiresAt).toBe(hostNow + 250);
          expect(secondLease.expiresAt).toBeGreaterThan(hostNow);
          return [first.kind, second.kind];
        });
        expect(result.value).toEqual(['published', 'published']);
        expect(result.diagnostics).toEqual([]);
      } finally {
        workspace.close();
      }
    } finally {
      clock.mockRestore();
    }
  });

  test('a lease that expired after the run\'s last normal request is not reported as a release failure', async () => {
    // The run crosses expiry only after its last normal request has published;
    // an expired holder has no writer authority left for closure to release.
    let hostNow = Date.now();
    const clock = jest.spyOn(Date, 'now').mockImplementation(() => hostNow);
    try {
      const workspace = openWorkspace({ location: store.location, logicalStore, leaseMilliseconds: 250 });
      try {
        const contributors = composeContributors();
        const result = await workspace.run({ authoring: contributors.authoring, composition: contributors.composition, environment, runId: 'run:expired-release' }, async (run) => {
          const published = await run.resolve(contributors.steps['person:ada'].summary, { requestKey: freshRequestKey() });
          expect(published.kind).toBe('published');
          const lastLease = persistedWriter();
          expect(lastLease.holder).toBe('microdelta-run:run:expired-release');
          expect(lastLease.fence).toBeGreaterThan(0);
          expect(lastLease.expiresAt).toBe(hostNow + 250);
          await run.ordinary('assembly after lease expiry', () => {
            hostNow = lastLease.expiresAt + 1;
            expect(hostNow).toBeGreaterThan(lastLease.expiresAt);
            expect(persistedWriter()).toEqual(lastLease);
          });
        });
        expect(result.diagnostics).toEqual([]);
      } finally {
        workspace.close();
      }
    } finally {
      clock.mockRestore();
    }
  });

  test('a second concurrent run past its writer deadline cannot write, names the other run as holder, and can still check', async () => {
    const workspace = openWorkspace({ location: store.location, logicalStore });
    const contributors = composeContributors();
    const options = { authoring: contributors.authoring, composition: contributors.composition, environment };
    let holding: () => void = () => undefined;
    const held = new Promise<void>((resolve) => {
      holding = resolve;
    });
    let finish: () => void = () => undefined;
    const finished = new Promise<void>((resolve) => {
      finish = resolve;
    });
    try {
      const first = workspace.run({ ...options, runId: 'run:first' }, async (run) => {
        await run.resolve(contributors.steps['person:ada'].summary, { requestKey: freshRequestKey() });
        holding();
        await finished;
      });
      await held;
      // A concurrent caller, outside the first run; its deadline has passed, so it makes one attempt.
      await workspace.run({ ...options, runId: 'run:second', writerWait: { deadline: Date.now() } }, async (second) => {
        let caught: unknown;
        try {
          await second.resolve(contributors.steps['person:ada'].summary, { requestKey: freshRequestKey() });
        } catch (error: unknown) {
          caught = error;
        }
        expect(caught instanceof SupervisionError ? caught.code : undefined).toBe('writer-busy');
        expect(caught instanceof WriterBusyError ? caught.holder : undefined).toBe('microdelta-run:run:first');
        expect(caught instanceof Error ? caught.message : '').toContain('run:first');
        await expect(second.check(contributors.steps['person:ada'].summary)).resolves.toMatchObject({ kind: 'reusable' });
      });
      finish();
      await first;
    } finally {
      finish();
      workspace.close();
    }
  });

  test('an empty request key is rejected before any work', async () => {
    await inSession({}, async (session) => {
      let caught: unknown;
      await session.workspace.run({ authoring: session.contributors.authoring, composition: session.contributors.composition, environment }, async (run) => {
        try {
          await run.resolve(session.contributors.steps['person:ada'].summary, { requestKey: '' });
        } catch (error: unknown) {
          caught = error;
        }
      });
      expect(caught instanceof ResolutionError ? caught.code : undefined).toBe('invalid-request');
      expect(world.checks['person:ada']).toBe(0);
    });
  });
});
