/**
 * The facade's external-operation fixture: a small analysis authored only
 * against the `microdelta` facade, whose per-PR assessment makes one
 * paid-like external operation through `currentExecution()`, exactly as an
 * application author writes it. A workspace opened with an Accounting port
 * offers the operation; the deterministic fake provider of the owner suites
 * answers it and never costs anything.
 *
 * - `prs` is a keyed collection source over the world's PR keys.
 * - `pr` is a template with one member memo, `assess`, whose body makes one
 *   `assess` operation for its member (each paid call isolated in its own
 *   step, EXP-8 resolution 3).
 * - `report` is a strict fold over every member's `assess`, and `tally` an
 *   outcome fold over the same members.
 *
 * Callbacks capture nothing but their typed context; every effect goes
 * through a declared helper over the module's `world`, which each test
 * installs afresh.
 *
 * @see ../../../../docs/spec/operations.md (RUN-011, RUN-012, RUN-013, RUN-017)
 */
import { authoring, currentExecution, sourceOutcome } from '../../src/index.js';
import type { IAuthoring, IComposition, IFoldEntry, IMemberBuilder, IOutcomeEntry, ISourceOutcome, IStepDescriptor, ITrackedView } from '../../src/index.js';
import { fakeProvider } from '../operations/provider.js';
import type { IAssessment, IFakeProvider } from '../operations/provider.js';

/** The analysis scope of the fixture composition. */
export const analysis = 'facade-ops:contributors';

/** One discovered PR. */
export interface IPr {
  readonly key: string;
}

/** The discovery result. */
export interface IRoster {
  readonly members: readonly IPr[];
  readonly status: 'complete';
}

/** The mutable world one test installs. */
export interface IWorld {
  /** PR keys discovery returns. */
  readonly keys: readonly string[];
  /** The provider every operation reaches. */
  readonly provider: IFakeProvider;
}

/** The world the helpers read; each test installs its own. */
let world: IWorld = createWorld(() => 0);

/** A fresh world over `keys`, whose provider reads `now` for rate-limit retry times. */
export function createWorld(now: () => number, keys: readonly string[] = ['pr-1', 'pr-2', 'pr-3']): IWorld {
  return { keys, provider: fakeProvider(now) };
}

/** Install a world for the next runs. */
export function installWorld(next: IWorld): IWorld {
  world = next;
  return world;
}

/** The declared input record (no inputs are read). */
export type IInputs = Record<never, never>;

/** The strict fold's report: the keys of succeeded members. */
export interface IReport {
  readonly keys: readonly string[];
}

/** The outcome fold's tally: each member's settled status. */
export interface ITally {
  readonly statuses: readonly string[];
}

/** The declared helper record. */
export interface IHelpers {
  readonly roster: () => ISourceOutcome<IRoster>;
  readonly assess: (key: string) => Promise<IAssessment>;
  readonly render: (entries: readonly IFoldEntry<ITrackedView<IAssessment>>[]) => IReport;
  readonly tally: (entries: readonly IOutcomeEntry<ITrackedView<IAssessment>>[]) => ITally;
}

/** Discovery: the world's PRs. */
function roster(): ISourceOutcome<IRoster> {
  return sourceOutcome.fresh<IRoster>({ members: world.keys.map((key) => ({ key })), status: 'complete' });
}

/** One member's assessment: a single external operation through the live run's execution controls. */
function assess(key: string): Promise<IAssessment> {
  return currentExecution().operation<IAssessment>({
    name: 'assess',
    binding: `sha256:assess:${key}`,
    perform: (send) => world.provider.perform('assess', key, send),
  });
}

/** The strict fold's report. */
function render(entries: readonly IFoldEntry<ITrackedView<IAssessment>>[]): IReport {
  return { keys: entries.flatMap((entry) => entry.status === 'succeeded' ? [entry.key] : []) };
}

/** The outcome fold's tally. */
function tally(entries: readonly IOutcomeEntry<ITrackedView<IAssessment>>[]): ITally {
  return { statuses: entries.map((entry) => `${entry.key}=${entry.status}`) };
}

/** One fresh composition and the descriptors tests use. */
export interface IFixture {
  readonly authoring: IAuthoring<IInputs, IHelpers>;
  readonly composition: IComposition<IInputs, IHelpers>;
  /** The strict fold over every member's assessment. */
  readonly report: IStepDescriptor;
  /** The outcome fold over every member's assessment. */
  readonly tally: IStepDescriptor;
}

/** Compose the fixture with fresh allocations, as each process does. */
export function composeFixture(): IFixture {
  const builders = authoring<IInputs, IHelpers>();
  const { source, template, fold, outcomeFold, compose } = builders;
  const prs = source<IRoster>({
    subject: 'prs:acme/widget',
    collection: { identity: 'key' },
    finality: () => true,
    run: ({ helpers }) => helpers.roster(),
  });
  const steps = (member: IMemberBuilder<IInputs, IHelpers, IPr>) => ({
    assess: member.memo({
      subject: member.subject('assessment'),
      run: ({ member: bound, helpers }) => helpers.assess(bound.key),
    }),
  });
  const pr = template({ slot: 'pr', collection: prs, steps });
  const report = fold({ subject: 'report:acme/widget', over: { template: pr, step: 'assess' }, run: ({ members, helpers }) => helpers.render(members) });
  const tallied = outcomeFold({ subject: 'tally:acme/widget', over: { template: pr, step: 'assess' }, run: ({ members, helpers }) => helpers.tally(members) });
  const composition = compose({
    scope: analysis,
    inputs: [],
    helpers: [
      { slot: 'roster', helper: roster },
      { slot: 'assess', helper: assess },
      { slot: 'render', helper: render },
      { slot: 'tally', helper: tally },
    ],
    steps: [
      { slot: 'prs', declaration: prs },
      { slot: 'report', declaration: report },
      { slot: 'tally', declaration: tallied },
    ],
    templates: [pr],
  });
  return {
    authoring: builders,
    composition,
    report: Object.freeze({ scope: analysis, role: 'step', slot: 'report' }),
    tally: Object.freeze({ scope: analysis, role: 'step', slot: 'tally' }),
  };
}
