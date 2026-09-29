/**
 * The nested-validation authoring fixture: the M4 contributor summary reduced
 * to memo-to-memo nesting through a supplied assessor, written as an author
 * would write it against Definition's generated alpha builders and
 * Resolution's binding family.
 *
 * Two explicit members (`person:ada`, `person:ben`) each declare:
 *
 * - `activity`, a retained source over the fixture world (finality per member);
 * - `initial`, a memo over `activity` that consumes only the profile name and
 *   returns its first letter (an M3-shaped parent, so its evidence keeps the
 *   version-1 witness and provenance);
 * - `summary`, a nested memo that calls `activity`, then `initial`, then the
 *   supplied `assessor` slot once per authored pull request, passing the PR
 *   number (a derived scalar) and the PR record (forwarded from the activity
 *   call's output). It consumes only each assessment's `score`.
 *
 * The composition supplies rubric A or B to the `assessor` slot. Both score a
 * merged PR with the rubric's `mergedWeight` and an open PR with its
 * `openWeight`; they differ only in code and explanation text. Each call's
 * history subject is `assessment:acme/widget:<number>`, computed by the slot's
 * subject function from the derived PR number only.
 *
 * Ada's summary has three variants that are identical except for one
 * deliberate influence: `untracked` makes an observed untracked read of the
 * rubric prompt before deriving any argument; `unreconstructible` passes a
 * function as a third argument. Every `composeNested` call allocates fresh
 * declarations, callbacks and inputs, standing in for a new process; `order:
 * 'reversed'` registers members, their steps, helpers and supplies in reverse.
 *
 * Invocation counts are kept by the declared helpers each callback calls
 * exactly once, so author callbacks capture nothing but their typed context
 * and Definition's canonical `forward`.
 *
 * Hand-derived expectations (docs/plans/m4-composition.md, fixture decisions):
 * Ada authored 101 (merged), 102 (merged), 103 (open); Ben authored 201
 * (merged), 202 (open). Under rubric weights merged 2 / open 1, Ada's total is
 * 2 + 2 + 1 = 5 over 3 assessments and Ben's is 2 + 1 = 3 over 2.
 *
 * @see ../../../../docs/plans/m4-composition.md
 * @see ../../../../docs/spec/composition.md (CMP-3, CMP-5, CMP-6, CMP-7)
 * @see ../../../../docs/spec/execution.md (REUSE-005, REUSE-006, REUSE-007)
 */
import { declarations } from '@microdelta/definition';
import type { IBindingDescriptor, IComposition, IDeclarations, IMemberRegistration, ISlotSubject, IStepSlot, ISuppliedStepRegistration } from '@microdelta/definition';
import { sourceOutcome } from '@microdelta/resolution';
import type { IPreviousResult, IResolutionFamily, IResultView, ISourceOutcome } from '@microdelta/resolution';
import type { ITrackedView } from '@microdelta/tracking';

/** The analysis scope of the fixture composition. */
export const analysis = 'contribution-report:acme/widget';

/** The two explicit member keys. */
export type IMemberKey = 'person:ada' | 'person:ben';

/** Every member key, in forward registration order. */
export const memberKeys: readonly IMemberKey[] = ['person:ada', 'person:ben'];

/** One authored pull request. `title` is read only by the assessor, for its explanation. */
export interface IPullRequest {
  readonly number: number;
  readonly merged: boolean;
  readonly title: string;
}

/** One member's activity: profile name and authored pull requests. */
export interface IActivity {
  readonly profile: { readonly name: string };
  readonly pullRequests: readonly IPullRequest[];
}

/** The `initial` memo's result. */
export interface IInitial {
  readonly initial: string;
}

/** One assessment. The summary consumes only `score`. */
export interface IAssessment {
  readonly score: number;
  readonly explanation: string;
}

/** A member summary. */
export interface ISummary {
  readonly initial: string;
  readonly total: number;
  readonly assessed: number;
}

/** The declared rubric input. */
export interface IRubric {
  readonly prompt: string;
  readonly mergedWeight: number;
  readonly openWeight: number;
}

/** The declared input record. */
export interface IInputs {
  readonly rubric: IRubric;
}

/** The assessor slot's call signature: a derived PR number, the forwarded PR and an optional extra argument. */
export type IAssessorParameters = readonly [number, IPullRequest, unknown?];

/** The declared helper record. */
export interface IHelpers {
  readonly fetchActivity: (key: IMemberKey) => ISourceOutcome<IActivity>;
  readonly acceptActivity: (previous: IPreviousResult<IActivity>, key: IMemberKey) => boolean;
  readonly initialOf: (activity: IResultView<IActivity>, key: IMemberKey) => IInitial;
  readonly assess: (rubric: 'A' | 'B', number: number, pullRequest: ITrackedView<IPullRequest>, weights: ITrackedView<IRubric>) => IAssessment;
  readonly summarize: (initial: string, scores: readonly number[], key: IMemberKey) => ISummary;
}

/** Resolution's binding family for this fixture. */
export type IFamily = IResolutionFamily<IInputs, IHelpers>;

/** The declared input and helper slots every callback receives. */
export const bindingSlots = { inputs: ['rubric'], helpers: ['fetchActivity', 'acceptActivity', 'initialOf', 'assess', 'summarize'] } as const;

/** The fixture world: remote data, finality answers and invocation counts. Plain JSON, so a worker process can load it. */
export interface IWorld {
  remote: Record<IMemberKey, IActivity>;
  /** Whether each member's activity finality hook accepts its eligible previous result. */
  final: Record<IMemberKey, boolean>;
  /** Source check/retrieval runs per member. */
  checks: Record<IMemberKey, number>;
  /** `initial` body runs per member. */
  initials: Record<IMemberKey, number>;
  /** `summary` body runs per member. */
  summaries: Record<IMemberKey, number>;
  /** Assessor body runs per PR number. */
  assessments: Record<string, number>;
  /** A PR number whose assessment body throws, standing in for a failing child; null for none. */
  failAssessment: number | null;
}

/** Ada's activity (authored 101 merged, 102 merged, 103 open). */
export function adaActivity(overrides: { readonly name?: string; readonly merged103?: boolean; readonly title103?: string } = {}): IActivity {
  return {
    profile: { name: overrides.name ?? 'Ada' },
    pullRequests: [
      { number: 101, merged: true, title: 'Parser fix' },
      { number: 102, merged: true, title: 'Docs' },
      { number: 103, merged: overrides.merged103 ?? false, title: overrides.title103 ?? 'Refactor' },
    ],
  };
}

/** Ben's activity (authored 201 merged, 202 open). */
export function benActivity(): IActivity {
  return {
    profile: { name: 'Ben' },
    pullRequests: [
      { number: 201, merged: true, title: 'Bug fix' },
      { number: 202, merged: false, title: 'Draft' },
    ],
  };
}

/** A fresh world: both members' activity retained by finality, zero counts. */
export function createWorld(): IWorld {
  return {
    remote: { 'person:ada': adaActivity(), 'person:ben': benActivity() },
    final: { 'person:ada': true, 'person:ben': true },
    checks: { 'person:ada': 0, 'person:ben': 0 },
    initials: { 'person:ada': 0, 'person:ben': 0 },
    summaries: { 'person:ada': 0, 'person:ben': 0 },
    assessments: {},
    failAssessment: null,
  };
}

/** The world the fixture helpers read; each test (or worker process) installs its own. */
export let world: IWorld = createWorld();

/** Install a world, fresh by default. */
export function resetWorld(next: IWorld = createWorld()): IWorld {
  world = next;
  return world;
}

/** The default rubric: merged work weighs 2, open work 1. */
export const defaultRubric: IRubric = { prompt: 'v1', mergedWeight: 2, openWeight: 1 };

/** JSON copy of remote data, so no stored result shares a container with the world. */
function copy<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

/** The fixture source adapter: always fresh remote data. */
function fetchActivity(key: IMemberKey): ISourceOutcome<IActivity> {
  world.checks[key] += 1;
  return sourceOutcome.fresh(copy(world.remote[key]));
}

/** The fixture finality policy: the world's per-member answer, after a read of the previous result. */
function acceptActivity(previous: IPreviousResult<IActivity>, key: IMemberKey): boolean {
  return previous.data.pullRequests.length >= 0 && world.final[key];
}

/** The first letter of the profile name; consumes only the name. */
function initialOf(activity: IResultView<IActivity>, key: IMemberKey): IInitial {
  world.initials[key] += 1;
  return { initial: activity.profile.name.slice(0, 1) };
}

/**
 * Score one PR under the rubric: merged work weighs `mergedWeight`, open work
 * `openWeight`. The explanation names the rubric, its prompt and the PR title.
 */
function assess(rubric: 'A' | 'B', number: number, pullRequest: ITrackedView<IPullRequest>, weights: ITrackedView<IRubric>): IAssessment {
  const counted = String(number);
  world.assessments[counted] = (world.assessments[counted] ?? 0) + 1;
  if (world.failAssessment === number) {
    throw new Error(`fixture assessment failure for ${counted}`);
  }
  const score = pullRequest.merged ? weights.mergedWeight : weights.openWeight;
  return { score, explanation: `${rubric}:${weights.prompt}:${pullRequest.title}` };
}

/** The member summary. */
function summarize(initial: string, scores: readonly number[], key: IMemberKey): ISummary {
  world.summaries[key] += 1;
  return { initial, total: scores.reduce((sum, score) => sum + score, 0), assessed: scores.length };
}

/** A changed summary helper implementation with identical output. */
function summarizeRevised(initial: string, scores: readonly number[], key: IMemberKey): ISummary {
  world.summaries[key] += 1;
  let total = 0;
  for (const score of scores) {
    total += score;
  }
  return { initial, total, assessed: scores.length };
}

/** Author-visible variations of one fixture build. */
export interface IVariation {
  /** Registration order of members, their steps, helpers and supplies. */
  readonly order?: 'forward' | 'reversed';
  /** Which implementation the assessor slot is supplied with. */
  readonly rubric?: 'A' | 'B';
  /** How many implementations are supplied to the assessor slot. */
  readonly supplied?: 'once' | 'none' | 'twice';
  /** Ada's summary variant. */
  readonly adaSummary?: 'standard' | 'untracked' | 'unreconstructible';
  /** The declared rubric input. */
  readonly rubricInput?: IRubric;
  /** Which summary helper implementation is registered. */
  readonly summarizer?: 'original' | 'revised';
}

/** One fresh composition with its builders and descriptors. */
export interface INested {
  readonly builders: IDeclarations<IFamily>;
  readonly composition: IComposition<IFamily>;
  readonly steps: Readonly<Record<IMemberKey, { readonly activity: IBindingDescriptor; readonly initial: IBindingDescriptor; readonly summary: IBindingDescriptor }>>;
  readonly assessor: IBindingDescriptor;
}

/** The assessor slot descriptor. */
export const assessorSlot: IBindingDescriptor = Object.freeze({ scope: analysis, role: 'callable', slot: 'assessor' });

/** The scoped subject text of one PR's assessment. */
export function assessmentSubject(number: number): string {
  return `assessment:acme/widget:${String(number)}`;
}

/** A member step descriptor. */
function memberStep(key: IMemberKey, slot: string): IBindingDescriptor {
  return Object.freeze({ scope: analysis, role: 'step', slot, memberKey: key });
}

/** Order a registration list by the variation. */
function ordered<T>(items: readonly T[], variation: IVariation): readonly T[] {
  return variation.order === 'reversed' ? [...items].reverse() : items;
}

/** Compose both members with fresh allocations. */
export function composeNested(variation: IVariation = {}): INested {
  const builders = declarations<IFamily>();
  const { source, memo, stepSlot, suppliedStep, supply, forward, compose } = builders;
  const assessor: IStepSlot<IFamily, IAssessorParameters, IAssessment> = stepSlot<IAssessorParameters, IAssessment>({ slot: 'assessor' });

  const adaActivitySource = source<IActivity>({
    subject: 'activity:acme/widget:2026-Q1:person:ada',
    finality: ({ previous, helpers }) => helpers.acceptActivity(previous, 'person:ada'),
    run: ({ helpers }) => helpers.fetchActivity('person:ada'),
  });
  const benActivitySource = source<IActivity>({
    subject: 'activity:acme/widget:2026-Q1:person:ben',
    finality: ({ previous, helpers }) => helpers.acceptActivity(previous, 'person:ben'),
    run: ({ helpers }) => helpers.fetchActivity('person:ben'),
  });
  const adaInitial = memo({
    subject: 'initial:acme/widget:person:ada',
    children: { activity: adaActivitySource },
    run: async ({ calls, helpers }) => helpers.initialOf((await calls.activity()).data, 'person:ada'),
  });
  const benInitial = memo({
    subject: 'initial:acme/widget:person:ben',
    children: { activity: benActivitySource },
    run: async ({ calls, helpers }) => helpers.initialOf((await calls.activity()).data, 'person:ben'),
  });

  const adaVariant = variation.adaSummary ?? 'standard';
  const adaSummary = adaVariant === 'untracked'
    ? memo({
        subject: 'summary:acme/widget:2026-Q1:person:ada',
        children: { activity: adaActivitySource, initial: adaInitial, assess: assessor },
        run: async ({ calls, helpers, inputs, untracked }) => {
          const activity = await calls.activity();
          const initial = await calls.initial();
          // An observed untracked read before any derived argument: the recorded
          // evidence can no longer justify the PR numbers derived below.
          const prompted = untracked(inputs.rubric, 'prompt').length > 0;
          const scores: number[] = [];
          const count = activity.data.pullRequests.length;
          for (let index = 0; index < count; index += 1) {
            const pullRequest = activity.data.pullRequests[index];
            if (pullRequest === undefined) {
              continue;
            }
            const assessed = await calls.assess(pullRequest.number, forward.child<IPullRequest>(activity, ['pullRequests', index]));
            scores.push(assessed.data.score);
          }
          return helpers.summarize(prompted ? initial.data.initial : '', scores, 'person:ada');
        },
      })
    : adaVariant === 'unreconstructible'
      ? memo({
          subject: 'summary:acme/widget:2026-Q1:person:ada',
          children: { activity: adaActivitySource, initial: adaInitial, assess: assessor },
          run: async ({ calls, helpers }) => {
            const activity = await calls.activity();
            const initial = await calls.initial();
            const scores: number[] = [];
            const count = activity.data.pullRequests.length;
            for (let index = 0; index < count; index += 1) {
              const pullRequest = activity.data.pullRequests[index];
              if (pullRequest === undefined) {
                continue;
              }
              // A function argument keeps no value: recorded unreconstructible.
              const assessed = await calls.assess(pullRequest.number, forward.child<IPullRequest>(activity, ['pullRequests', index]), () => index);
              scores.push(assessed.data.score);
            }
            return helpers.summarize(initial.data.initial, scores, 'person:ada');
          },
        })
      : memo({
          subject: 'summary:acme/widget:2026-Q1:person:ada',
          children: { activity: adaActivitySource, initial: adaInitial, assess: assessor },
          run: async ({ calls, helpers }) => {
            const activity = await calls.activity();
            const initial = await calls.initial();
            const scores: number[] = [];
            const count = activity.data.pullRequests.length;
            for (let index = 0; index < count; index += 1) {
              const pullRequest = activity.data.pullRequests[index];
              if (pullRequest === undefined) {
                continue;
              }
              const assessed = await calls.assess(pullRequest.number, forward.child<IPullRequest>(activity, ['pullRequests', index]));
              scores.push(assessed.data.score);
            }
            return helpers.summarize(initial.data.initial, scores, 'person:ada');
          },
        });
  const benSummary = memo({
    subject: 'summary:acme/widget:2026-Q1:person:ben',
    children: { activity: benActivitySource, initial: benInitial, assess: assessor },
    run: async ({ calls, helpers }) => {
      const activity = await calls.activity();
      const initial = await calls.initial();
      const scores: number[] = [];
      const count = activity.data.pullRequests.length;
      for (let index = 0; index < count; index += 1) {
        const pullRequest = activity.data.pullRequests[index];
        if (pullRequest === undefined) {
          continue;
        }
        const assessed = await calls.assess(pullRequest.number, forward.child<IPullRequest>(activity, ['pullRequests', index]));
        scores.push(assessed.data.score);
      }
      return helpers.summarize(initial.data.initial, scores, 'person:ben');
    },
  });

  const rubricA = suppliedStep<IAssessorParameters, IAssessment>({
    label: 'rubric A',
    run: ({ args, inputs, helpers }) => helpers.assess('A', args[0], args[1], inputs.rubric),
  });
  const rubricB = suppliedStep<IAssessorParameters, IAssessment>({
    label: 'rubric B',
    run: ({ args, inputs, helpers }) => helpers.assess('B', args[0], args[1], inputs.rubric),
  });
  const subject: ISlotSubject<IAssessorParameters> = (derived) => `assessment:acme/widget:${String(derived[0])}`;
  const supplyA: ISuppliedStepRegistration<IFamily> = supply({ slot: assessor, declaration: rubricA, subject });
  const supplyB: ISuppliedStepRegistration<IFamily> = supply({ slot: assessor, declaration: rubricB, subject });
  const chosen = variation.rubric === 'B' ? supplyB : supplyA;
  const supplied = variation.supplied === 'none' ? [] : variation.supplied === 'twice' ? [supplyA, supplyB] : [chosen];

  const members: readonly IMemberRegistration<IFamily>[] = [
    {
      key: 'person:ada',
      steps: ordered([
        { slot: 'activity', declaration: adaActivitySource },
        { slot: 'initial', declaration: adaInitial },
        { slot: 'summary', declaration: adaSummary },
      ], variation),
    },
    {
      key: 'person:ben',
      steps: ordered([
        { slot: 'activity', declaration: benActivitySource },
        { slot: 'initial', declaration: benInitial },
        { slot: 'summary', declaration: benSummary },
      ], variation),
    },
  ];
  const helpers = [
    { slot: 'fetchActivity', helper: fetchActivity },
    { slot: 'acceptActivity', helper: acceptActivity },
    { slot: 'initialOf', helper: initialOf },
    { slot: 'assess', helper: assess },
    { slot: 'summarize', helper: variation.summarizer === 'revised' ? summarizeRevised : summarize },
  ];
  const composition = compose({
    scope: analysis,
    inputs: [{ slot: 'rubric', value: variation.rubricInput ?? defaultRubric }],
    helpers: ordered(helpers, variation),
    members: ordered(members, variation),
    supplied: ordered(supplied, variation),
  });
  const stepsOf = (key: IMemberKey): { readonly activity: IBindingDescriptor; readonly initial: IBindingDescriptor; readonly summary: IBindingDescriptor } =>
    ({ activity: memberStep(key, 'activity'), initial: memberStep(key, 'initial'), summary: memberStep(key, 'summary') });
  return {
    builders,
    composition,
    steps: { 'person:ada': stepsOf('person:ada'), 'person:ben': stepsOf('person:ben') },
    assessor: assessorSlot,
  };
}
