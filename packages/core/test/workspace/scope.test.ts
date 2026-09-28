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

import { SupervisionError, authoring, currentRun, openWorkspace } from '../../src/index.js';
import type { IRunContext } from '../../src/index.js';
import { composeContributors, resetWorld } from './fixture.js';
import type { IWorld } from './fixture.js';
import { caughtCode, environment, locatorOf, logicalStore, openSession, runReport, tempStore } from './support.js';
import type { ITempStore } from './support.js';

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
    let escaped: Promise<IRunContext> | undefined;
    try {
      await session.workspace.run({ authoring: session.contributors.authoring, composition: session.contributors.composition, environment }, () => {
        escaped = gate.then(() => currentRun());
      });
      openGate();
      expect(escaped).toBeDefined();
      if (escaped !== undefined) {
        const code = await caughtCode(escaped);
        expect(code).toBe('run-closed');
      }
    } finally {
      session.close();
    }
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
