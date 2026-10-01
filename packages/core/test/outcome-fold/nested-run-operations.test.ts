/**
 * Run operations started inside member or step work are refused as
 * undeclared calls (CMP-9), so the run-wide lane pool is never awaited from
 * inside a lane holder (RUN-002's nested rule; supervisor ruling on #120).
 *
 * An outcome fold is never a declared child or member step, so member work
 * can reach another fold's fan-out only through author code that kept the
 * live run handle and calls a run operation from inside a body. Its result
 * would enter no evidence of the calling body, so reuse would be unsound.
 * With a window of one lane the outer member holds the run's only lane while
 * its body waits, so on `main` (c62047a) such a call deadlocked. Now every
 * run operation (resolving, reading or ordinary) is refused at once with the
 * typed `undeclared-call` failure, before any admission or lane, the outer
 * run completes normally, and each refusal is a run diagnostic that names
 * the operation and where it was called by identifiers only.
 *
 * @see ../../../../docs/spec/composition.md (CMP-9)
 * @see ../../../../docs/spec/operations.md (RUN-002, RUN-010)
 */
import { afterEach, describe, expect, test } from '@jest/globals';
import { declarations } from '@microdelta/definition';
import type { IOutcomeEntry } from '@microdelta/definition';

import { SupervisionError, openWorkspace, sourceOutcome } from '../../src/index.js';
import type { IAuthoringFamily, IOutcomeFoldReport, IResolutionOutcome, ISourceOutcome, IStepDescriptor, ITrackedView, IWorkspaceRun } from '../../src/index.js';
import { cleanup, freshLocation } from '../durable-history/support.js';

afterEach(cleanup);

/** The analysis scope of this composition. */
const scope = 'nested-run-operations';

/** A marker planted in every member record; it must never reach a diagnostic. */
const planted = 'PLANTED-nested-0451';

/** One discovered person. */
interface IPerson {
  readonly key: string;
  readonly note: string;
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

/** What one body observed when it called every run operation: each one's failure code. */
interface IAttempted {
  readonly where: string;
  readonly codes: readonly string[];
}

/** An outcome fold's result. */
interface ICount {
  readonly succeeded: number;
}

/** The outer outcome fold's result: its count and what its own body observed. */
interface IOuterTally extends ICount {
  readonly attempted: IAttempted;
}

/** The declared helper record. */
interface IHelpers {
  readonly roster: () => ISourceOutcome<IRoster>;
  /** Call every run operation through the kept run handle and report how each settled. */
  readonly callEach: (where: string) => Promise<IAttempted>;
  readonly count: (entries: readonly IOutcomeEntry<ITrackedView<unknown>>[]) => ICount;
  /** The outer gate's probe: pure member work, outside any step attempt. */
  readonly gateProbe: () => boolean;
}

/** The live run, kept by the author as module state: the only path to a nested run operation. */
let kept: IWorkspaceRun | undefined;

/** How each outer gate's nested `check` settled, in gate order. */
const gateCodes: Promise<string>[] = [];

/** Released by the test once the run has closed. */
let releaseLate: () => void = () => undefined;

/** How the run operation member `a` scheduled for after the run closed settled. */
let lateCode: Promise<string> | undefined;

/** A composition-level step descriptor of this scope. */
function step(slot: string): IStepDescriptor {
  return Object.freeze({ scope, role: 'step', slot });
}

/** Settle one call to its failure code, `settled` when it did not fail, or a description of a foreign failure. */
async function codeOf(call: () => Promise<unknown>): Promise<string> {
  try {
    await call();
    return 'settled';
  } catch (error: unknown) {
    return error instanceof SupervisionError ? error.code : `not a SupervisionError: ${String(error)}`;
  }
}

/** Every run operation, each called once through the kept run. */
async function callEach(where: string): Promise<IAttempted> {
  const run = kept;
  if (run === undefined) {
    throw new Error('the run was not kept');
  }
  // A fresh request key per operation, as a caller saves one per top-level request.
  const request = (operation: string): { readonly requestKey: string } => ({ requestKey: `nested:${where}:${operation}` });
  const codes = await Promise.all([
    codeOf(() => run.resolve(step('people'), request('resolve'))),
    codeOf(() => run.resolveMembers({ template: 'inner', step: 'echo' }, request('members'))),
    codeOf(() => run.resolveFold(step('innerReport'), request('fold'))),
    codeOf(() => run.resolveOutcomeFold(step('innerTally'), request('outcome-fold'))),
    codeOf(() => run.check(step('people'))),
    codeOf(() => run.recover(step('people'), request('resolve'))),
    codeOf(() => run.ordinary('note', () => 'noted')),
    codeOf(() => Promise.resolve().then(() => run.read({ kind: 'completed-result', locator: 'mdh1:any' }))),
  ]);
  if (where === 'member a') {
    // A timer the member schedules now, firing only after the run closed, keeps the member's context.
    const closed = new Promise<void>((resolve) => {
      releaseLate = resolve;
    });
    lateCode = closed.then(() => new Promise((resolve) => {
      setTimeout(resolve, 0);
    })).then(() => codeOf(() => run.resolveMembers({ template: 'inner', step: 'echo' }, { requestKey: 'late' })));
  }
  return { where, codes };
}

/** The gate calls a run operation from member work that is not a step attempt, then requires the member. */
function gateProbe(): boolean {
  const run = kept;
  if (run === undefined) {
    throw new Error('the run was not kept');
  }
  gateCodes.push(codeOf(() => run.check(step('people'))));
  return true;
}

/**
 * Two templates over one roster. Each `outer` member's body, and the
 * composition-level `top` memo's body, call every run operation; the inner
 * template and its strict and outcome folds are what those calls target.
 */
function compose() {
  const builders = declarations<IAuthoringFamily<object, IHelpers>>();
  const { source, memo, template, fold, outcomeFold } = builders;
  const people = source<IRoster>({ subject: 'people', collection: { identity: 'key' }, run: ({ helpers }) => helpers.roster() });
  const outer = template({
    slot: 'outer',
    collection: people,
    gate: ({ helpers }) => helpers.gateProbe(),
    steps: (member) => ({ visit: member.memo({ subject: member.subject('outer'), run: ({ member: bound, helpers }) => helpers.callEach(`member ${bound.key}`) }) }),
  });
  const inner = template({ slot: 'inner', collection: people, steps: (member) => ({ echo: member.memo({ subject: member.subject('inner'), run: ({ member: bound }): IEcho => ({ key: bound.key }) }) }) });
  const top = memo({ subject: 'top', run: ({ helpers }) => helpers.callEach('top') });
  const outerTally = outcomeFold({
    subject: 'outer-tally',
    over: { template: outer, step: 'visit' },
    // A fold's own body attempt is step work too.
    run: async ({ members, helpers }): Promise<IOuterTally> => ({ ...helpers.count(members), attempted: await helpers.callEach('outerTally') }),
  });
  const innerTally = outcomeFold({ subject: 'inner-tally', over: { template: inner, step: 'echo' }, run: ({ members, helpers }) => helpers.count(members) });
  const innerReport = fold({ subject: 'inner-report', over: { template: inner, step: 'echo' }, run: ({ members }): ICount => ({ succeeded: members.length }) });
  const composition = builders.compose({
    scope,
    inputs: [],
    helpers: [
      {
        slot: 'roster',
        helper: (): ISourceOutcome<IRoster> => {
          const roster: IRoster = { members: ['a', 'b', 'c'].map((key) => ({ key, note: planted })), status: 'complete' };
          return sourceOutcome.fresh(roster);
        },
      },
      { slot: 'callEach', helper: callEach },
      { slot: 'gateProbe', helper: gateProbe },
      { slot: 'count', helper: (entries: readonly IOutcomeEntry<ITrackedView<unknown>>[]): ICount => ({ succeeded: entries.filter((entry) => entry.status === 'succeeded').length }) },
    ],
    steps: [
      { slot: 'people', declaration: people },
      { slot: 'top', declaration: top },
      { slot: 'outerTally', declaration: outerTally },
      { slot: 'innerTally', declaration: innerTally },
      { slot: 'innerReport', declaration: innerReport },
    ],
    templates: [outer, inner],
  });
  return { builders, composition };
}

/** The refusal codes one body observes, one per run operation. */
const refused = Array.from({ length: 8 }, () => 'undeclared-call');

/** The operations, as each refusal diagnostic names them. */
const operations = ['resolve', 'resolveMembers', 'resolveFold', 'resolveOutcomeFold', 'check', 'recover', 'ordinary', 'read'];

describe('nested run operations are undeclared calls (CMP-9, RUN-002)', () => {
  test('called inside a member body and a step attempt with a window of one lane, each is refused at once and the outer run completes', async () => {
    const { builders, composition } = compose();
    const workspace = openWorkspace({ location: freshLocation(), logicalStore: 'store:nested-run-operations' });
    gateCodes.length = 0;
    lateCode = undefined;
    try {
      const running = workspace.run({ authoring: builders, composition, environment: 'env:nested', window: 1 }, async (run) => {
        kept = run;
        const tally: IOutcomeFoldReport = await run.resolveOutcomeFold(step('outerTally'), { requestKey: 'outer' });
        const top: IResolutionOutcome = await run.resolve(step('top'), { requestKey: 'top' });
        // What each body observed, read back from its exact published result while the run is live.
        const observed = [
          ...tally.members.flatMap((member) => member.status === 'succeeded' ? [run.read<IAttempted>(member.outcome.reference)] : []),
          ...(tally.outcome.status === 'folded' ? [run.read<IOuterTally>(tally.outcome.outcome.reference).attempted] : []),
          ...(top.kind === 'published' ? [run.read<IAttempted>(top.reference)] : []),
        ];
        return { tally, top, observed };
      });
      // Bounded: on main this deadlocked, which must show up as this test's own failure rather than a hung suite.
      const settled = await Promise.race([
        running,
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
      const { tally, top, observed } = settled.value;
      // The outer run completes normally: every member published and the outcome fold folded them.
      expect(tally.members.map((member) => [member.key, member.status])).toEqual([['a', 'succeeded'], ['b', 'succeeded'], ['c', 'succeeded']]);
      expect(tally.outcome).toMatchObject({ status: 'folded', outcome: { kind: 'published', coverage: { succeeded: ['a', 'b', 'c'], complete: true } } });
      expect(top.kind).toBe('published');
      // Every nested call, from each member body and from the composition-level step attempt, was refused.
      expect(observed).toEqual([
        { where: 'member a', codes: refused },
        { where: 'member b', codes: refused },
        { where: 'member c', codes: refused },
        { where: 'outerTally', codes: refused },
        { where: 'top', codes: refused },
      ]);
      // A gate is member work outside any step attempt: its nested call is refused too.
      expect(await Promise.all(gateCodes)).toEqual(['undeclared-call', 'undeclared-call', 'undeclared-call']);
      // Each refusal is a run diagnostic naming the operation and where it was called, by identifiers only.
      const refusals = settled.diagnostics.filter((diagnostic) => diagnostic.includes('undeclared call'));
      expect(refusals).toHaveLength(5 * operations.length + 3);
      expect(refusals.filter((refusal) => refusal === `Run ${settled.context.runId} refused check from inside member work: an undeclared call (CMP-9)`)).toHaveLength(3);
      for (const where of ['visit/a', 'visit/b', 'visit/c', 'outerTally', 'top']) {
        for (const operation of operations) {
          expect(refusals).toContain(`Run ${settled.context.runId} refused ${operation} from inside the step attempt of ${where}: an undeclared call (CMP-9)`);
        }
      }
      for (const diagnostic of settled.diagnostics) {
        expect(diagnostic).not.toContain(planted);
      }
      // After the run closed, the operation member a scheduled reports run-closed, never undeclared-call.
      expect(settled.value.tally.members[0]?.key).toBe('a');
      releaseLate();
      expect(await lateCode).toBe('run-closed');
    } finally {
      kept = undefined;
      workspace.close();
    }
  });
});
