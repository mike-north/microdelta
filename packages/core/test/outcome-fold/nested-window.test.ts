/**
 * The run-wide lane pool is never re-entered by a nested fan-out (RUN-002's
 * nested rule; supervisor note on #120). An outcome fold is never a declared
 * child or member step, so the only way member work can start another fold's
 * fan-out is author code that kept the live run handle and calls a run
 * operation from inside a member body. With a window of one lane, the outer
 * member holds the run's only lane while its body waits for the nested
 * fan-out; that fan-out must therefore draw its members from a pool of its
 * own rather than wait for the run-wide lane, or the run deadlocks.
 *
 * @see ../../../../docs/spec/operations.md (RUN-002, RUN-010)
 * @see ../../../../docs/plans/m5-operations.md (Selected execution contract: Waiting)
 */
import { afterEach, describe, expect, test } from '@jest/globals';
import { declarations } from '@microdelta/definition';
import type { IOutcomeEntry } from '@microdelta/definition';

import { openWorkspace, sourceOutcome } from '../../src/index.js';
import type { IAuthoringFamily, IOutcomeFoldReport, ISourceOutcome, IStepDescriptor, ITrackedView, IWorkspaceRun } from '../../src/index.js';
import { cleanup, freshLocation } from '../durable-history/support.js';

afterEach(cleanup);

/** The analysis scope of this composition. */
const scope = 'nested-window';

/** One discovered person. */
interface IPerson {
  readonly key: string;
}

/** The discovery result. */
interface IRoster {
  readonly members: readonly IPerson[];
  readonly status: 'complete';
}

/** An inner member's result. */
interface IEcho {
  readonly key: string;
}

/** An outer member's result: the inner outcome fold's status it observed. */
interface IVisit {
  readonly key: string;
  readonly inner: string;
}

/** An outcome fold's result. */
interface ICount {
  readonly succeeded: number;
}

/** The declared helper record. */
interface IHelpers {
  readonly roster: () => ISourceOutcome<IRoster>;
  /** Resolve the inner outcome fold from inside an outer member, through the kept run handle. */
  readonly nested: (key: string) => Promise<IVisit>;
  readonly count: (entries: readonly IOutcomeEntry<ITrackedView<IEcho>>[]) => ICount;
}

/** The live run, kept by the author as module state: the only path to a nested fan-out. */
let kept: IWorkspaceRun | undefined;

/** The inner outcome fold's step. */
const innerTally: IStepDescriptor = Object.freeze({ scope, role: 'step', slot: 'innerTally' });

/** The outer outcome fold's step. */
const outerTally: IStepDescriptor = Object.freeze({ scope, role: 'step', slot: 'outerTally' });

/** Every nested inner outcome fold status the outer members observed, in order. */
const observed: string[] = [];

/** Compose two templates over one roster, each with an outcome fold; outer member bodies resolve the inner fold. */
function compose() {
  const builders = declarations<IAuthoringFamily<object, IHelpers>>();
  const { source, template, outcomeFold } = builders;
  const people = source<IRoster>({ subject: 'people', collection: { identity: 'key' }, run: ({ helpers }) => helpers.roster() });
  const outer = template({ slot: 'outer', collection: people, steps: (member) => ({ visit: member.memo({ subject: member.subject('outer'), run: ({ member: bound, helpers }) => helpers.nested(bound.key) }) }) });
  const inner = template({ slot: 'inner', collection: people, steps: (member) => ({ echo: member.memo({ subject: member.subject('inner'), run: ({ member: bound }): IEcho => ({ key: bound.key }) }) }) });
  const outerFold = outcomeFold({ subject: 'outer-tally', over: { template: outer, step: 'visit' }, run: ({ members, helpers }) => helpers.count(members) });
  const innerFold = outcomeFold({ subject: 'inner-tally', over: { template: inner, step: 'echo' }, run: ({ members, helpers }) => helpers.count(members) });
  const composition = builders.compose({
    scope,
    inputs: [],
    helpers: [
      {
        slot: 'roster',
        helper: (): ISourceOutcome<IRoster> => {
          const roster: IRoster = { members: [{ key: 'a' }, { key: 'b' }, { key: 'c' }], status: 'complete' };
          return sourceOutcome.fresh(roster);
        },
      },
      {
        slot: 'nested',
        helper: async (key: string): Promise<IVisit> => {
          if (kept === undefined) {
            throw new Error('the run was not kept');
          }
          const report: IOutcomeFoldReport = await kept.resolveOutcomeFold(innerTally, { requestKey: `nested:${key}` });
          observed.push(report.outcome.status);
          return { key, inner: report.outcome.status };
        },
      },
      { slot: 'count', helper: (entries: readonly IOutcomeEntry<ITrackedView<IEcho>>[]): ICount => ({ succeeded: entries.filter((entry) => entry.status === 'succeeded').length }) },
    ],
    steps: [{ slot: 'people', declaration: people }, { slot: 'outerTally', declaration: outerFold }, { slot: 'innerTally', declaration: innerFold }],
    templates: [outer, inner],
  });
  return { builders, composition };
}

describe('nested fan-out under the run-wide window (RUN-002)', () => {
  test('a nested outcome fold resolved from inside a member completes with a window of one lane', async () => {
    const { builders, composition } = compose();
    const workspace = openWorkspace({ location: freshLocation(), logicalStore: 'store:nested-window' });
    observed.length = 0;
    try {
      const running = workspace.run({ authoring: builders, composition, environment: 'env:nested', window: 1 }, (run) => {
        kept = run;
        return run.resolveOutcomeFold(outerTally, { requestKey: 'outer' });
      });
      // Bounded: a deadlock shows up as this test's own failure rather than a hung suite.
      const settled = await Promise.race([
        running.then((result) => result.value),
        new Promise<'deadlocked'>((resolve) => {
          setTimeout(() => {
            resolve('deadlocked');
          }, 3_000).unref();
        }),
      ]);
      expect(settled).not.toBe('deadlocked');
      if (settled === 'deadlocked') {
        return;
      }
      expect(settled.members.map((member) => [member.key, member.status])).toEqual([['a', 'succeeded'], ['b', 'succeeded'], ['c', 'succeeded']]);
      expect(settled.outcome).toMatchObject({ status: 'folded', outcome: { kind: 'published', coverage: { succeeded: ['a', 'b', 'c'], complete: true } } });
      // Each outer member resolved the inner fold: the first folded it, the rest reused it.
      expect(observed).toEqual(['folded', 'folded', 'folded']);
    } finally {
      kept = undefined;
      workspace.close();
    }
  });
});
