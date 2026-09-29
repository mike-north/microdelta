/**
 * Generated-declaration consumer for the facade's alpha keyed-composition
 * surface: a discovered keyed collection, a gated fanout template whose member
 * steps read their member binding, a supplied step slot called with a derived
 * scalar and a forwarded child origin, the observed untracked read, and a
 * strict fold over the template's member summaries. Every name comes from
 * `microdelta`'s generated alpha rollup, exactly as the checked-in example
 * compiles, and the typed capture rule treats every builder callback here as
 * a capture boundary.
 *
 * @see ../../../../docs/plans/m4-composition.md (Authoring shape and worked walkthrough)
 * @see ../../../../docs/tooling/tracked-captures.md
 */
import { authoring } from 'microdelta';
import type {
  IAnyTemplateDeclaration,
  ICandidateMiss,
  ICollectionResult,
  ICollectionStatus,
  IComposition,
  IDerivedArguments,
  IFoldCoverage,
  IFoldDeclaration,
  IFoldEntry,
  IFoldOutcome,
  IFoldReport,
  IForward,
  IForwarded,
  IKeyedMember,
  IKeyedSnapshot,
  IKeyingDiagnostic,
  IKeyingFailure,
  IMemberBinding,
  IMemberBuilder,
  IPathInput,
  IResultView,
  ISkippedEntry,
  ISlotSubject,
  ISourceOutcome,
  IStepDescriptor,
  IStepSlot,
  IStrictFoldOutcome,
  ISucceededEntry,
  ISuppliedStepDeclaration,
  ISuppliedStepRegistration,
  ITrackedView,
  IUntrackedRead,
  IWorkspaceRun,
} from 'microdelta';

/** One discovered contributor record; `key` is its designated identity. */
interface IContributor {
  readonly key: string;
  readonly id: string;
  readonly authored: number;
}
/** One authored pull request. */
interface IPullRequest {
  readonly number: number;
  readonly merged: boolean;
}
interface IActivity {
  readonly pullRequests: readonly IPullRequest[];
}
interface IAssessment {
  readonly score: number;
  readonly explanation: string;
}
interface ISummary {
  readonly score: number;
}
interface IInputs {
  readonly config: { readonly minimumAuthored: number; readonly prompt: string };
}
interface IHelpers {
  readonly discover: () => ISourceOutcome<ICollectionResult<IContributor>>;
  readonly activityOf: (key: string) => ISourceOutcome<IActivity>;
  readonly assess: (number: number, pullRequest: ITrackedView<IPullRequest>) => IAssessment;
  readonly total: (scores: readonly number[]) => ISummary;
  readonly render: (members: readonly IFoldEntry<IResultView<ISummary>>[]) => { readonly lines: readonly string[] };
}
type IAssessorParameters = readonly [number, IPullRequest];

const builders = authoring<IInputs, IHelpers>();
const { source, template, fold, stepSlot, suppliedStep, supply, forward, compose } = builders;

const status: ICollectionStatus = 'complete';
void status;
const canonicalForward: IForward = forward;
void canonicalForward;

const assessor: IStepSlot<IInputs, IHelpers, IAssessorParameters, IAssessment> = stepSlot<IAssessorParameters, IAssessment>({ slot: 'assessor' });

const contributors = source<ICollectionResult<IContributor>>({
  subject: 'contributors:acme/widget:2026-Q1',
  collection: { identity: 'key' },
  run: ({ helpers }) => helpers.discover(),
});

/** Member steps built once against the symbolic member. */
function steps(member: IMemberBuilder<IInputs, IHelpers, IContributor>) {
  const activity = member.source<IActivity>({
    subject: member.subject('activity:acme/widget:2026-Q1'),
    run: ({ member: bound, helpers }) => helpers.activityOf(bound.key),
  });
  const summary = member.memo({
    subject: member.subject('summary:acme/widget:2026-Q1'),
    children: { activity, assess: assessor },
    run: async ({ calls, helpers, inputs, untracked }) => {
      const read: IUntrackedRead = untracked;
      // An observed untracked read is a capability of the context, not a capture.
      void read(inputs.config, 'prompt');
      const result = await calls.activity();
      const scores: number[] = [];
      const count = result.data.pullRequests.length;
      for (let index = 0; index < count; index += 1) {
        const pullRequest = result.data.pullRequests[index];
        if (pullRequest === undefined) {
          continue;
        }
        const path: IPathInput = ['pullRequests', index];
        const origin: IForwarded<IPullRequest> = forward.child<IPullRequest>(result, path);
        const assessed = await calls.assess(pullRequest.number, origin);
        scores.push(assessed.data.score);
      }
      return helpers.total(scores);
    },
  });
  return { activity, summary };
}

const contributor = template({
  slot: 'contributor',
  collection: contributors,
  key: (member) => member.id,
  gate: ({ member, inputs }) => member.authored >= inputs.config.minimumAuthored,
  steps,
});
const anyTemplate: IAnyTemplateDeclaration<IInputs, IHelpers> = contributor;
void anyTemplate;

/** A member binding names the member view every member step and gate receives. */
export function authoredOf(binding: IMemberBinding<IInputs, IHelpers, IContributor>): number {
  return binding.member.authored;
}

const report: IFoldDeclaration<IInputs, IHelpers, ISummary, { readonly lines: readonly string[] }> = fold({
  subject: 'report:acme/widget:2026-Q1',
  over: { template: contributor, step: 'summary' },
  run: ({ members, helpers }) => helpers.render(members),
});

const rubric: ISuppliedStepDeclaration<IInputs, IHelpers, IAssessorParameters, IAssessment> = suppliedStep<IAssessorParameters, IAssessment>({
  label: 'rubric',
  run: ({ args, helpers }) => helpers.assess(args[0], args[1]),
});
const subject: ISlotSubject<IAssessorParameters> = (derived: IDerivedArguments<IAssessorParameters>) => `assessment:acme/widget:${String(derived[0])}`;
const supplied: ISuppliedStepRegistration<IInputs, IHelpers> = supply({ slot: assessor, declaration: rubric, subject });

const composition: IComposition<IInputs, IHelpers> = compose({
  scope: 'contribution-report:acme/widget:keyed-consumer',
  inputs: [{ slot: 'config', value: { minimumAuthored: 1, prompt: 'v1' } }],
  steps: [{ slot: 'contributors', declaration: contributors }, { slot: 'report', declaration: report }],
  templates: [contributor],
  supplied: [supplied],
});

/** Keying a snapshot names its diagnostic types from the facade. */
export function keysOf(snapshot: unknown): readonly string[] | IKeyingFailure {
  const keyed: IKeyedSnapshot = composition.keyMembers('contributor', snapshot);
  if (keyed.status === 'rejected') {
    const diagnostic: IKeyingDiagnostic = keyed.diagnostic;
    return diagnostic.reason;
  }
  const members: readonly IKeyedMember[] = keyed.members;
  return members.map((member) => member.key);
}

/** A strict fold entry is either a succeeded view or a skipped key with no data. */
export function describeEntry(entry: IFoldEntry<IResultView<ISummary>>): string {
  if (entry.status === 'skipped') {
    const skipped: ISkippedEntry = entry;
    // @ts-expect-error: A skipped strict fold entry carries no data.
    void skipped.data;
    return `${skipped.key} skipped`;
  }
  const succeeded: ISucceededEntry<IResultView<ISummary>> = entry;
  return `${succeeded.key} ${String(succeeded.data.score)}`;
}

/** A strict fold request and its typed outcomes name every fold report type from the facade. */
export async function reportOnce(run: IWorkspaceRun, requestKey: string): Promise<string> {
  const step: IStepDescriptor = { scope: composition.scope, role: 'step', slot: 'report' };
  const folded: IFoldReport = await run.resolveFold(step, { requestKey });
  const outcome: IStrictFoldOutcome = folded.outcome;
  if (outcome.status !== 'succeeded') {
    return outcome.status;
  }
  // A succeeded strict fold carries Resolution's reused or published fold outcome.
  const settled = outcome.outcome;
  const general: IFoldOutcome = settled;
  const misses: readonly ICandidateMiss[] = general.misses;
  const coverage: IFoldCoverage = settled.coverage;
  return `${settled.kind}:${coverage.required.join(',')}|${coverage.skipped.join(',')}|${String(misses.length)}`;
}
