/**
 * The external-operation authoring fixture: a small contribution analysis
 * whose per-PR assessment makes one paid-like external operation through the
 * live run's execution controls, written as an author writes it against
 * Definition's builders bound to the facade's authoring family.
 *
 * - `prs` is a keyed collection source over the world's PR keys.
 * - `pr` is a template over it with one member memo, `assess`, whose body
 *   runs the world's plan for that member (see {@link IPlan}). Each member
 *   isolates its paid call in its own step (EXP-8 resolution 3).
 * - `report` is a strict fold over every member's `assess`, and `tally` an
 *   outcome fold over the same members that notes each settled status.
 * - `parent` is a composition-level memo that waits for its gate and then
 *   demands its child `paid`, a memo whose body makes one `paid` operation:
 *   a well-authored parent isolating its paid call in a child step.
 *
 * Author callbacks capture nothing but their typed context: every effect goes
 * through a declared helper over the module's `world`, which each test
 * installs afresh. Helpers reach the run only through scoped lookup on the
 * session's Supervision, never through a context parameter.
 *
 * @see ../../../../docs/spec/operations.md (RUN-011, RUN-012, RUN-013)
 * @see ../../../../experiments/exp-8/decision.md (mechanisms 3 to 7)
 */
import { declarations } from '@microdelta/definition';
import type { IFoldEntry, IMemberBuilder, IOutcomeEntry } from '@microdelta/definition';
import { SupervisionError } from '@microdelta/supervision';
import type { IOperationRetryPolicy, ISupervision } from '@microdelta/supervision';

import { sourceOutcome } from '../../src/index.js';
import type { IAuthoring, IAuthoringFamily, IComposition, ISourceOutcome, IStepDescriptor, ITrackedView } from '../../src/index.js';
import { gates } from '../stop/support.js';
import type { IGates } from '../stop/support.js';
import { fakeProvider, planted } from './provider.js';
import type { IAssessment, IFakeProvider } from './provider.js';

/** The analysis scope of the fixture composition. */
export const analysis = 'ops:contributors';

/** One discovered PR. */
export interface IPr {
  readonly key: string;
}

/** The discovery result. */
export interface IRoster {
  readonly members: readonly IPr[];
  readonly status: 'complete';
}

/**
 * What one member's `assess` body does:
 *
 * - `single`: one `assess` operation, returning its value;
 * - `catch-retry`: call `assess` up to three times, catching every failure,
 *   as a careless author's hand-written retry loop does (CX-6, CX-7); then
 *   return a fallback;
 * - `two-ops`: call `assess`, catch its failure, then call a second
 *   operation `polish` (a tainted attempt must send nothing more);
 * - `concurrent`: start `assess`, wait for the `<key>:second` gate while it is
 *   in flight, then call `assess` again at the same address; both outcomes
 *   are noted;
 * - `detached`: return at once, leaving an `assess` call that starts only
 *   after the `<key>:late` gate opens (author code that kept the controls);
 * - `twin`: start two `assess` calls at the same address in the same turn
 *   and note both outcomes;
 * - `author-throws`: call `assess`, then throw the author's own error, whose
 *   message carries the planted value (author text that no framework message,
 *   event or diagnostic may repeat).
 */
export type IPlan = 'single' | 'catch-retry' | 'two-ops' | 'concurrent' | 'detached' | 'twin' | 'author-throws';

/** Per-member operation declarations a test chooses. */
export interface IOperationOptions {
  readonly safeToRepeat?: boolean;
  readonly providerIdempotency?: boolean;
  readonly retry?: IOperationRetryPolicy;
}

/** The mutable fixture world one test installs. */
export interface IWorld {
  /** PR keys discovery returns. */
  keys: readonly string[];
  /** Plans by member key; `single` when absent. */
  plans: Record<string, IPlan>;
  /** Operation declarations by member key. */
  options: Record<string, IOperationOptions>;
  /** The provider every operation reaches. */
  provider: IFakeProvider;
  /** Appended to every binding, so a test can change the request deliberately. */
  bindingSuffix: string;
  /** What the provider reports when asked to cancel remote work; no cancellation support when undefined. */
  cancel: 'cancelled' | 'running' | undefined;
  /** Ordered notes: failure codes the bodies caught. */
  log: string[];
  /** Gates the test opens. */
  gates: IGates;
}

/** The Supervision the fixture's helpers look the live run up in. */
let supervision: ISupervision | undefined;

/** Bind the fixture's helpers to one session's Supervision. */
export function useSupervision(next: ISupervision): void {
  supervision = next;
}

/** The world the helpers read; each test installs its own. */
export let world: IWorld = createWorld(() => 0);

/** A fresh world over `keys`. */
export function createWorld(now: () => number, keys: readonly string[] = ['pr-1', 'pr-2', 'pr-3'], ledgerPath?: string): IWorld {
  return { keys, plans: {}, options: {}, provider: fakeProvider(now, ledgerPath), bindingSuffix: '', cancel: undefined, log: [], gates: gates() };
}

/** Install a world. */
export function installWorld(next: IWorld): IWorld {
  world = next;
  return world;
}

/** The declared input record (no inputs are read). */
export type IInputs = Record<never, never>;

/** Fold entries over `assess`. */
export type IAssessmentEntries = readonly IFoldEntry<ITrackedView<IAssessment>>[];

/** The fold's report. */
export interface IReport {
  readonly keys: readonly string[];
}

/** Outcome-fold entries over `assess`. */
export type ITallyEntries = readonly IOutcomeEntry<ITrackedView<IAssessment>>[];

/** The outcome fold's tally: each member's settled status. */
export interface ITally {
  readonly statuses: readonly string[];
}

/** The declared helper record. */
export interface IHelpers {
  readonly roster: () => ISourceOutcome<IRoster>;
  readonly assess: (key: string) => Promise<IAssessment>;
  readonly render: (entries: IAssessmentEntries) => IReport;
  readonly tally: (entries: ITallyEntries) => ITally;
  readonly gate: (label: string) => Promise<void>;
  readonly paid: () => Promise<IAssessment>;
}

/** The live run's execution controls through the session's Supervision. */
function controls(): ReturnType<ISupervision['execution']> {
  if (supervision === undefined) {
    throw new Error('the fixture is not bound to a Supervision');
  }
  return supervision.execution();
}

/** One external operation `name` for member `key`, declared as the world says. */
function operation(name: string, key: string): Promise<IAssessment> {
  const options = world.options[key] ?? {};
  const cancel = world.cancel;
  return controls().operation<IAssessment>({
    name,
    // The binding is a digest-like identifier of the request; it carries a planted value to prove it is never reported.
    binding: `sha256:${name}:${key}:binding-PLANTED-c0ffee-SECRET${world.bindingSuffix}`,
    ...options,
    perform: (send) => world.provider.perform(name, key, send),
    ...(cancel === undefined ? {} : { cancel: () => Promise.resolve(cancel) }),
  });
}

/** The failure code of a caught error, for the world's log. */
function codeOf(error: unknown): string {
  return error instanceof SupervisionError ? error.code : 'other';
}

/** Discovery: the world's PRs. */
function roster(): ISourceOutcome<IRoster> {
  return sourceOutcome.fresh<IRoster>({ members: world.keys.map((key) => ({ key })), status: 'complete' });
}

/** A member's assessment, by the world's plan. */
async function assess(key: string): Promise<IAssessment> {
  const plan = world.plans[key] ?? 'single';
  switch (plan) {
    case 'single':
      return operation('assess', key);
    case 'catch-retry': {
      for (let attempt = 0; attempt < 3; attempt += 1) {
        try {
          return await operation('assess', key);
        } catch (error: unknown) {
          world.log.push(`caught:${key}:${codeOf(error)}`);
        }
      }
      return { key, verdict: 'fallback' };
    }
    case 'two-ops': {
      try {
        await operation('assess', key);
      } catch (error: unknown) {
        world.log.push(`caught:${key}:${codeOf(error)}`);
      }
      try {
        return await operation('polish', key);
      } catch (error: unknown) {
        world.log.push(`caught-polish:${key}:${codeOf(error)}`);
        return { key, verdict: 'fallback' };
      }
    }
    case 'concurrent': {
      const first = operation('assess', key).then(() => 'first:succeeded', (error: unknown) => `first:${codeOf(error)}`);
      await world.gates.wait(`${key}:second`);
      const second = await operation('assess', key).then(() => 'second:succeeded', (error: unknown) => `second:${codeOf(error)}`);
      world.log.push(`${key}:${second}`);
      world.log.push(`${key}:${await first}`);
      return { key, verdict: 'concurrent' };
    }
    case 'twin': {
      const outcomes = await Promise.all([operation('assess', key), operation('assess', key)].map((call) => call.then(() => 'succeeded', (error: unknown) => codeOf(error))));
      world.log.push(`${key}:twin:${outcomes.join(',')}`);
      return { key, verdict: 'twin' };
    }
    case 'detached': {
      void world.gates.wait(`${key}:late`).then(() => operation('assess', key)).then(() => {
        world.log.push(`detached-sent:${key}`);
      }, (error: unknown) => {
        world.log.push(`caught-detached:${key}:${codeOf(error)}`);
      });
      return { key, verdict: 'detached' };
    }
    case 'author-throws': {
      await operation('assess', key);
      throw new Error(`author assessment of ${key} rejected ${planted}`);
    }
    default: {
      const exhaustive: never = plan;
      return exhaustive;
    }
  }
}

/** The fold's report: the keys of succeeded entries. */
function render(entries: IAssessmentEntries): IReport {
  return { keys: entries.flatMap((entry) => entry.status === 'succeeded' ? [entry.key] : []) };
}

/** The outcome fold's tally, noted in the world's log so a test sees whether the body ran. */
function tally(entries: ITallyEntries): ITally {
  const statuses = entries.map((entry) => `${entry.key}=${entry.status}`);
  world.log.push(`tally:${statuses.join(',')}`);
  return { statuses };
}

/** Wait for a gate the test opens, noting that the body waits. */
async function gate(label: string): Promise<void> {
  world.log.push(`waiting:${label}`);
  await world.gates.wait(label);
}

/** The child's one paid operation. */
function paid(): Promise<IAssessment> {
  world.log.push('paid-start');
  return operation('paid', 'parent');
}

/** One fresh composition with its builders and the descriptors tests use. */
export interface IOperationsFixture {
  readonly builders: IAuthoring<IInputs, IHelpers>;
  readonly composition: IComposition<IInputs, IHelpers>;
  /** The strict fold over every member's assessment. */
  readonly report: IStepDescriptor;
  /** The outcome fold over every member's assessment. */
  readonly tally: IStepDescriptor;
  /** The parent whose child makes a paid call. */
  readonly parent: IStepDescriptor;
  /** One member's `assess` instance. */
  instance(memberKey: string): IStepDescriptor;
}

/** The subject of one member's assessment. */
export function assessmentSubject(key: string): string {
  return `assessment:${key}`;
}

/** Compose the fixture with fresh allocations, standing in for a new process. */
export function composeOperations(): IOperationsFixture {
  const builders: IAuthoring<IInputs, IHelpers> = declarations<IAuthoringFamily<IInputs, IHelpers>>();
  const { source, memo, template, fold, outcomeFold, compose } = builders;
  const prs = source<IRoster>({
    subject: 'prs:acme/widget',
    collection: { identity: 'key' },
    finality: () => true,
    run: ({ helpers }) => helpers.roster(),
  });
  const steps = (member: IMemberBuilder<IAuthoringFamily<IInputs, IHelpers>, IPr>) => ({
    assess: member.memo({
      subject: member.subject('assessment'),
      run: ({ member: bound, helpers }) => helpers.assess(bound.key),
    }),
  });
  const pr = template({ slot: 'pr', collection: prs, steps });
  const report = fold({ subject: 'report:acme/widget', over: { template: pr, step: 'assess' }, run: ({ members, helpers }) => helpers.render(members) });
  const paidStep = memo({ subject: 'paid:acme/widget', run: ({ helpers }) => helpers.paid() });
  const parent = memo({
    subject: 'parent:acme/widget',
    children: { paid: paidStep },
    run: async ({ calls, helpers }) => {
      await helpers.gate('parent');
      const child = await calls.paid();
      return { key: 'parent', verdict: child.data.verdict };
    },
  });
  const tallied = outcomeFold({ subject: 'tally:acme/widget', over: { template: pr, step: 'assess' }, run: ({ members, helpers }) => helpers.tally(members) });
  const composition = compose({
    scope: analysis,
    inputs: [],
    helpers: [
      { slot: 'roster', helper: roster },
      { slot: 'assess', helper: assess },
      { slot: 'render', helper: render },
      { slot: 'tally', helper: tally },
      { slot: 'gate', helper: gate },
      { slot: 'paid', helper: paid },
    ],
    steps: [
      { slot: 'prs', declaration: prs },
      { slot: 'report', declaration: report },
      { slot: 'tally', declaration: tallied },
      { slot: 'paid', declaration: paidStep },
      { slot: 'parent', declaration: parent },
    ],
    templates: [pr],
  });
  return {
    builders,
    composition,
    report: Object.freeze({ scope: analysis, role: 'step', slot: 'report' }),
    tally: Object.freeze({ scope: analysis, role: 'step', slot: 'tally' }),
    parent: Object.freeze({ scope: analysis, role: 'step', slot: 'parent' }),
    instance: (memberKey) => Object.freeze({ scope: analysis, role: 'step', slot: 'assess', template: 'pr', collection: 'prs', memberKey }),
  };
}
