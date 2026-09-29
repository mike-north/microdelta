/**
 * The nested composition fixture: the M4 contribution-report shape reduced to
 * what Definition declares. A composition-level discovery source and report
 * memo sit outside any member. Each explicit member has an activity source, a
 * profile memo that calls the activity (a memo child), and a summary memo that
 * calls the activity, the profile and the supplied `assessor` step slot.
 * Composition supplies one assessor implementation (rubric A or B, which differ
 * only in code) with the fixture's subject function. Every build allocates
 * fresh declarations and callbacks, standing in for a new process.
 *
 * @see ../../../../docs/spec/composition.md (CMP-1, CMP-3, CMP-6, CMP-7, EXP-4 selections)
 * @see ../../../../docs/plans/m4-composition.md ("Authoring shape", "Nested invocation evidence")
 */
import type {
  IAnyMemoDeclaration,
  IAnySourceDeclaration,
  ICalls,
  ICompositionOptions,
  IComposition,
  IDerivedArguments,
  IMemberRegistration,
  IStepSlot,
  ISuppliedStepDeclaration,
  ISuppliedStepRegistration,
} from '../../src/index.js';
import { builders, compose, memo, source, type ITestFamily } from './contributors.js';

export const { stepSlot, suppliedStep, supply, forward } = builders;

/** The analysis scope of the nested fixture. */
export const nestedScope = 'contribution-report:acme/widget';

/** One pull request as the activity source reports it. */
export interface IPullRequest {
  readonly number: number;
  readonly merged: boolean;
}

/** One member's activity in the window. */
export interface IActivity {
  readonly pullRequests: readonly IPullRequest[];
}

/** One assessor result. */
export interface IAssessment {
  readonly score: number;
  readonly explanation: string;
}

/** The assessor slot's call signature: a derived PR number and the PR data. */
export type IAssessorParameters = readonly [number, IPullRequest];

/** The fixture's assessor subject: complete author text built from the derived PR number only. */
export function assessmentSubject(derived: IDerivedArguments<IAssessorParameters>): string {
  return `assessment:acme/widget:${String(derived[0])}`;
}

/** The fixture's explicit member keys. */
export const nestedMembers = ['person:ada', 'person:ben'] as const;

/** One explicit nested member key. */
export type INestedMemberKey = (typeof nestedMembers)[number];

/** The children every summary declares. */
export interface ISummaryChildren {
  readonly [call: string]: IAnySourceDeclaration<ITestFamily> | IAnyMemoDeclaration<ITestFamily> | IStepSlot<ITestFamily, IAssessorParameters, IAssessment>;
  readonly activity: IAnySourceDeclaration<ITestFamily>;
  readonly profile: IAnyMemoDeclaration<ITestFamily>;
  readonly assess: IStepSlot<ITestFamily, IAssessorParameters, IAssessment>;
}

/** What a summary body receives, captured so tests can drive its calls. */
export interface ISummaryCapture {
  calls?: ICalls<ITestFamily, ISummaryChildren>;
}

/** Declarations built for one member. */
export interface INestedMember {
  readonly key: INestedMemberKey;
  readonly activity: IAnySourceDeclaration<ITestFamily>;
  readonly profile: IAnyMemoDeclaration<ITestFamily>;
  readonly summary: IAnyMemoDeclaration<ITestFamily>;
  readonly captured: ISummaryCapture;
  readonly registration: IMemberRegistration<ITestFamily>;
}

/** Variation of one nested build that keeps its structure. */
export interface INestedVariation {
  /** Registration order of members, composition-level steps and supplies. */
  readonly order?: 'forward' | 'reversed';
  /** Which implementation the assessor slot is supplied with. */
  readonly rubric?: 'A' | 'B';
  /** How many times the assessor slot is supplied. */
  readonly supplied?: 'once' | 'none' | 'twice';
  /** The subject function bound with the assessor. */
  readonly subject?: (derived: IDerivedArguments<IAssessorParameters>) => string;
}

/** One nested build with the declarations tests need to compare against. */
export interface INestedBuild {
  readonly options: ICompositionOptions<ITestFamily>;
  readonly composition: IComposition<ITestFamily>;
  readonly assessor: IStepSlot<ITestFamily, IAssessorParameters, IAssessment>;
  readonly rubric: ISuppliedStepDeclaration<ITestFamily, IAssessorParameters, IAssessment>;
  readonly discovery: IAnySourceDeclaration<ITestFamily>;
  readonly report: IAnyMemoDeclaration<ITestFamily>;
  readonly members: Readonly<Record<INestedMemberKey, INestedMember>>;
}

/** Declare one rubric; A and B differ only in their code and label, never in their scores. */
export function rubric(which: 'A' | 'B'): ISuppliedStepDeclaration<ITestFamily, IAssessorParameters, IAssessment> {
  return which === 'A'
    ? suppliedStep<IAssessorParameters, IAssessment>({ label: 'rubric A', run: ({ args }) => ({ score: args[1].merged ? 2 : 1, explanation: 'A: merged work counts double' }) })
    : suppliedStep<IAssessorParameters, IAssessment>({ label: 'rubric B', run: ({ args }) => ({ score: args[1].merged ? 2 : 1, explanation: `B: ${String(args[0])}` }) });
}

/** Build one member with fresh declarations whose summary captures its calls. */
export function nestedMember(
  key: INestedMemberKey,
  assessor: IStepSlot<ITestFamily, IAssessorParameters, IAssessment>,
): INestedMember {
  const captured: ISummaryCapture = {};
  const activity = source<IActivity>({ subject: `activity:acme/widget:2026-Q1:${key}`, run: () => ({ pullRequests: [] }) });
  const profile = memo({ subject: `profile:acme/widget:${key}`, children: { activity }, run: () => key });
  const children: ISummaryChildren = { activity, profile, assess: assessor };
  const summary = memo({
    subject: `summary:acme/widget:2026-Q1:${key}`,
    children,
    run: context => {
      captured.calls = context.calls;
      return key;
    },
  });
  return {
    key,
    activity,
    profile,
    summary,
    captured,
    registration: {
      key,
      steps: [
        { slot: 'activity', declaration: activity },
        { slot: 'profile', declaration: profile },
        { slot: 'summary', declaration: summary },
      ],
    },
  };
}

/** Compose the nested fixture with fresh allocations. */
export function buildNested(variation: INestedVariation = {}): INestedBuild {
  const assessor = stepSlot<IAssessorParameters, IAssessment>({ slot: 'assessor' });
  const implementation = rubric(variation.rubric ?? 'A');
  const subject = variation.subject ?? assessmentSubject;
  const discovery = source<readonly string[]>({ subject: 'contributors:acme/widget:2026-Q1', run: () => [...nestedMembers] });
  const report = memo({ subject: 'report:acme/widget:2026-Q1', children: { discovery }, run: () => 'report' });
  const ada = nestedMember('person:ada', assessor);
  const ben = nestedMember('person:ben', assessor);
  const reversed = variation.order === 'reversed';
  const supplies: ISuppliedStepRegistration<ITestFamily>[] = [];
  const count = variation.supplied === 'none' ? 0 : variation.supplied === 'twice' ? 2 : 1;
  for (let index = 0; index < count; index++) {
    supplies.push(supply({ slot: assessor, declaration: index === 0 ? implementation : rubric('B'), subject }));
  }
  const steps = [{ slot: 'discovery', declaration: discovery }, { slot: 'report', declaration: report }];
  const options: ICompositionOptions<ITestFamily> = {
    scope: nestedScope,
    inputs: [{ slot: 'config', value: { minimumAuthored: 1 } }],
    steps: reversed ? [...steps].reverse() : steps,
    members: reversed ? [ben.registration, ada.registration] : [ada.registration, ben.registration],
    supplied: supplies,
  };
  return { options, composition: compose(options), assessor, rubric: implementation, discovery, report, members: { 'person:ada': ada, 'person:ben': ben } };
}
