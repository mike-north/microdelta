/**
 * Scoped run context through the workspace run path (DOM-2, RUN-001, A-18):
 * author helpers reached through a memo body find the run's context across
 * awaits without any context parameter; lookup fails outside a run, from a
 * callback that escaped a closed run, and while a composition is being
 * constructed inside a live run; two concurrent runs stay isolated; a new run
 * identifier alone leaves eligible results reusable.
 *
 * @see ../../../../docs/spec/operations.md (RUN-001)
 * @see ../../../../docs/spec/domain.md (DOM-2)
 * @see ../../../../docs/spec/acceptance.md (A-18)
 */
import { afterEach, beforeEach, describe, expect, test } from '@jest/globals';
import { createNodeClock } from '@microdelta/machine-node';

import { SupervisionError, authoring, currentRun, openWorkspace } from '../../src/index.js';
import type { IWorkspaceRun } from '../../src/index.js';
import { composeContributors, resetWorld } from './fixture.js';
import type { IWorld } from './fixture.js';
import { caughtCode, environment, freshRequestKey, locatorOf, logicalStore, openSession, runReport, tempStore } from './support.js';
import type { ITempStore } from './support.js';
import { openHistory } from '../durable-history/support.js';

let store: ITempStore;
let world: IWorld;

beforeEach(() => {
  store = tempStore();
  world = resetWorld();
});

afterEach(() => {
  store.remove();
});

describe('scoped run context (RUN-001, DOM-2)', () => {
  test('author helpers reached through a memo body see the run context across awaits', async () => {
    const session = openSession(store.location);
    try {
      const { run } = await runReport(session);
      expect(world.contexts).toEqual([run.context, run.context]);
      expect(run.context).toMatchObject({ analysis: 'contribution-report:acme/widget', environment });
    } finally {
      session.close();
    }
  });

  test('lookup outside any run fails, and a callback that escaped a closed run fails too', async () => {
    expect(await caughtCode(() => currentRun())).toBe('outside-run');
    const session = openSession(store.location);
    let openGate: () => void = () => undefined;
    const gate = new Promise<void>((resolve) => {
      openGate = resolve;
    });
    let escaped: Promise<string | undefined> | undefined;
    try {
      await session.workspace.run({ authoring: session.contributors.authoring, composition: session.contributors.composition, environment }, () => {
        // Scheduled inside the run and settled into its error code at once, so it can never reject unhandled.
        escaped = caughtCode(gate.then(() => currentRun()));
      });
      openGate();
      expect(escaped).toBeDefined();
      if (escaped !== undefined) {
        expect(await escaped).toBe('run-closed');
      }
    } finally {
      session.close();
    }
  });

  test('an exact read through a run that has closed fails instead of reading', async () => {
    const session = openSession(store.location);
    try {
      const { outcomes } = await runReport(session);
      const ada = outcomes['person:ada'];
      if (ada.kind === 'refused') {
        throw new Error('expected a result for Ada');
      }
      const reference = ada.reference;
      let kept: IWorkspaceRun | undefined;
      await session.workspace.run({ authoring: session.contributors.authoring, composition: session.contributors.composition, environment }, (run) => {
        kept = run;
        expect(run.read<{ readonly name: string }>(reference).name).toBe('Ada');
      });
      const late = kept;
      expect(late).toBeDefined();
      if (late !== undefined) {
        expect(await caughtCode(() => late.read(reference))).toBe('run-closed');
      }
    } finally {
      session.close();
    }
  });

  test('a run whose awaited Promise.all rejects early stays live, with context, reads and writer, until its started work settles', async () => {
    // Regression (supervisory review P1, reproduced through the real facade):
    // the run closed when only its body settled, so a started ordinary
    // operation resumed with context and exact reads failing run-closed and
    // its end event arrived after the run returned.
    const session = openSession(store.location);
    let openGate: () => void = () => undefined;
    const held = new Promise<void>((resolve) => {
      openGate = resolve;
    });
    const events: string[] = [];
    let slowSaw: { readonly environment: string; readonly name: string } | undefined;
    let settled = false;
    try {
      const running = session.workspace.run({
        authoring: session.contributors.authoring,
        composition: session.contributors.composition,
        environment,
        observers: [{ observe: (event) => { if (event.kind === 'ordinary') { events.push(`${event.label}:${event.phase}`); } } }],
      }, async (run) => {
        const published = await run.resolve(session.contributors.steps['person:ada'].summary, { requestKey: freshRequestKey() });
        if (published.kind === 'refused') {
          throw new Error('unexpected refusal');
        }
        const slow = run.ordinary('slow', async () => {
          await held;
          slowSaw = { environment: currentRun().environment, name: run.read<{ readonly name: string }>(published.reference).name };
        });
        return Promise.all([slow, run.ordinary('failing', () => { throw new Error('sibling failed'); })]);
      }).then(() => 'resolved', (error: unknown) => (error instanceof Error ? error.message : String(error))).finally(() => {
        settled = true;
        events.push('run settled');
      });
      for (let index = 0; index < 5; index += 1) {
        await new Promise((resolve) => setTimeout(resolve, 2));
      }
      expect(settled).toBe(false);
      // The run still holds History's writer while its started work is active.
      const probe = openHistory({ location: store.location, store: logicalStore, clock: createNodeClock() });
      try {
        expect(probe.currentWriter()).toBeDefined();
      } finally {
        probe.close();
      }
      openGate();
      expect(await running).toBe('sibling failed');
      expect(slowSaw).toEqual({ environment, name: 'Ada' });
      expect(events).toEqual(['slow:begin', 'failing:begin', 'failing:fail', 'slow:end', 'run settled']);
      const after = openHistory({ location: store.location, store: logicalStore, clock: createNodeClock() });
      try {
        expect(after.currentWriter()).toBeUndefined();
      } finally {
        after.close();
      }
    } finally {
      openGate();
      session.close();
    }
  });

  test('ordinary work queued in any microtask around the run\'s closure is rejected before starting or fully participates', async () => {
    // Regression (supervisory review of 9637739, real facade): an ordinary call
    // queued between the final empty check and closure was accepted, began,
    // and then lost its context and exact read after the run released its
    // writer and settled.
    const session = openSession(store.location);
    const classes: string[] = [];
    try {
      const cold = await runReport(session);
      const ada = cold.outcomes['person:ada'];
      if (ada.kind === 'refused') {
        throw new Error('expected a result for Ada');
      }
      const reference = ada.reference;
      for (let depth = 0; depth <= 8; depth += 1) {
        const events: string[] = [];
        let openGate: () => void = () => undefined;
        const held = new Promise<void>((resolve) => {
          openGate = resolve;
        });
        let late: Promise<string | undefined> | undefined;
        let saw: string | undefined;
        const running = session.workspace.run({
          authoring: session.contributors.authoring,
          composition: session.contributors.composition,
          environment,
          observers: [{ observe: (event) => { if (event.kind === 'ordinary') { events.push(`late:${event.phase}`); } } }],
        }, (run) => {
          let chain = Promise.resolve();
          for (let index = 0; index < depth; index += 1) {
            chain = chain.then(() => undefined);
          }
          void chain.then(() => {
            // Settled into its error code at once, so it can never reject unhandled.
            late = caughtCode(run.ordinary('late', async () => {
              await held;
              saw = `${currentRun().environment}/${run.read<{ readonly name: string }>(reference).name}`;
            }));
          });
          return 'body';
        }).finally(() => {
          events.push('run settled');
        });
        await new Promise((resolve) => setTimeout(resolve, 5));
        openGate();
        await running;
        const code = late === undefined ? 'never called' : await late;
        const began = events.includes('late:begin');
        const participated = began && code === undefined && saw === `${environment}/Ada` && events.indexOf('late:end') < events.indexOf('run settled');
        const rejected = !began && code === 'run-closed';
        classes.push(`${String(depth)}:${participated ? 'participated' : rejected ? 'rejected' : `accepted-but-unaccounted (${String(code)})`}`);
      }
    } finally {
      session.close();
    }
    expect(classes.filter((entry) => entry.includes('accepted-but-unaccounted'))).toEqual([]);
  });

  test('a composition constructed inside a live run cannot look up the run context', async () => {
    const session = openSession(store.location);
    const lookups: unknown[] = [];
    try {
      await session.workspace.run({ authoring: session.contributors.authoring, composition: session.contributors.composition, environment }, () => {
        const { source, compose } = authoring<{ readonly config: string }, Record<never, never>>();
        const activity = source<{ readonly n: number }>({ subject: 'activity:probe', run: ({ outcome }) => outcome.fresh({ n: 1 }) });
        const members = new Proxy([{ key: 'person:probe', steps: [{ slot: 'activity', declaration: activity }] }], {
          get(target, key, receiver): unknown {
            if (key === '0') {
              try {
                lookups.push(currentRun());
              } catch (error: unknown) {
                lookups.push(error);
              }
            }
            return Reflect.get(target, key, receiver);
          },
        });
        compose({ scope: 'analysis:probe', members });
        lookups.push(currentRun());
      });
    } finally {
      session.close();
    }
    expect(lookups.length).toBeGreaterThan(1);
    expect(lookups.slice(0, -1).every((entry) => entry instanceof SupervisionError && entry.code === 'composition-phase')).toBe(true);
    expect(lookups.at(-1)).toMatchObject({ environment });
  });

  test('two concurrent runs over separate workspaces keep their own environments across awaits', async () => {
    const other = tempStore();
    const first = openWorkspace({ location: store.location, logicalStore });
    const second = openWorkspace({ location: other.location, logicalStore });
    const seen: string[] = [];
    let releaseFirst: () => void = () => undefined;
    const firstGate = new Promise<void>((resolve) => {
      releaseFirst = resolve;
    });
    try {
      const { authoring: builders, composition } = composeContributors();
      await Promise.all([
        first.run({ authoring: builders, composition, environment: 'env:first' }, async () => {
          seen.push(`first:${currentRun().environment}`);
          await firstGate;
          seen.push(`first:${currentRun().environment}`);
        }),
        second.run({ authoring: builders, composition, environment: 'env:second' }, async () => {
          seen.push(`second:${currentRun().environment}`);
          releaseFirst();
          await Promise.resolve();
          seen.push(`second:${currentRun().environment}`);
        }),
      ]);
    } finally {
      first.close();
      second.close();
      other.remove();
    }
    expect(seen.filter((entry) => entry.startsWith('first:'))).toEqual(['first:env:first', 'first:env:first']);
    expect(seen.filter((entry) => entry.startsWith('second:'))).toEqual(['second:env:second', 'second:env:second']);
  });

  test('the selected environment scopes history: a run in another environment cannot reuse its results', async () => {
    const cold = openSession(store.location);
    try {
      await runReport(cold);
    } finally {
      cold.close();
    }
    world = resetWorld();
    const session = openSession(store.location);
    try {
      const other = await session.workspace.run({ authoring: session.contributors.authoring, composition: session.contributors.composition, environment: 'env:other' },
        (run) => run.resolve(session.contributors.steps['person:ada'].summary, { requestKey: 'request:other-environment' }));
      expect(other.value).toMatchObject({ kind: 'published' });
      expect(world.summaries['person:ada']).toBe(1);
      expect(world.contexts.map((context) => context.environment)).toEqual(['env:other']);
    } finally {
      session.close();
    }
  });

  test('a new run identifier alone leaves eligible results reusable', async () => {
    const cold = openSession(store.location);
    let refs: string[];
    try {
      const { outcomes } = await runReport(cold);
      refs = [locatorOf(outcomes['person:ada']), locatorOf(outcomes['person:ben'])];
    } finally {
      cold.close();
    }
    world = resetWorld();
    const session = openSession(store.location);
    try {
      const { outcomes, run } = await runReport(session);
      expect([locatorOf(outcomes['person:ada']), locatorOf(outcomes['person:ben'])]).toEqual(refs);
      expect(world.summaries).toEqual({ 'person:ada': 0, 'person:ben': 0 });
      expect(run.context.runId.length).toBeGreaterThan(0);
    } finally {
      session.close();
    }
  });
});
