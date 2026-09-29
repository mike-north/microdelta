/**
 * Generated-declaration consumer for the facade's alpha workspace authoring
 * surface. It compiles against `microdelta`'s generated alpha rollup (and the
 * sibling alpha rollups it names), exactly as the checked-in example does.
 * The typed capture rule treats the facade's builder callbacks as capture
 * boundaries because they are Definition's canonical builder signatures:
 * context parameters, tracked inputs/helpers and canonical declared handles
 * are accepted; raw captured values, runtime-context lookups inside a
 * callback and unsupported callback forms are diagnosed.
 *
 * @see ../../../../docs/tooling/tracked-captures.md
 * @see ../../../../docs/plans/m3-contribution-analysis.md (Authoring shape and worked walkthrough)
 */
import { authoring, currentRun, openWorkspace, sourceOutcome } from 'microdelta';
import type {
  IDiscoveryReport,
  IGateEvidence,
  IMemberOutcome,
  IMembersReport,
  IMembersTarget,
  IPreviousResult,
  IResolutionOutcome,
  IResultView,
  ISourceOutcome,
  IStepDescriptor,
  ITrackedView,
  IWorkspaceRun,
} from 'microdelta';

/** Contributor activity as a source result. */
interface IActivity {
  readonly profile: { readonly name: string };
  readonly pulls: readonly { readonly merged: boolean }[];
}
interface IInputs {
  readonly config: { readonly repository: string };
}
interface IHelpers {
  readonly fetch: (previous: IPreviousResult<IActivity> | undefined, config: ITrackedView<IInputs['config']>) => ISourceOutcome<IActivity>;
  readonly summarize: (activity: IResultView<IActivity>) => string;
}

const builders = authoring<IInputs, IHelpers>();
const { source, memo, compose } = builders;

declare const externalThreshold: number;

// Positive: the M3 authoring shape uses only context parameters.
const activity = source<IActivity>({
  subject: 'activity:acme/widget:2026-Q1:person:ada',
  finality: ({ previous }) => previous.data.pulls.length > 0,
  run: ({ previous, inputs, helpers }) => helpers.fetch(previous, inputs.config),
});
const summary = memo({
  subject: 'summary:acme/widget:2026-Q1:person:ada',
  children: { activity },
  run: async ({ calls, helpers }) => {
    const { data } = await calls.activity();
    return { sentence: helpers.summarize(data) };
  },
});

// Positive: a source may mint its outcome from its own context.
source<IActivity>({
  subject: 'activity:context-outcome',
  run: ({ outcome }) => outcome.fresh<IActivity>({ profile: { name: 'Ada' }, pulls: [] }),
});

memo({
  subject: 'summary:raw',
  // eslint-disable-next-line microdelta/tracked-captures -- An untracked captured scalar is a raw external influence.
  run: () => externalThreshold,
});

memo({
  subject: 'summary:context-in-callback',
  // eslint-disable-next-line microdelta/tracked-captures -- Runtime context is scoped access, not tracked evidence; callbacks may not read it directly.
  run: () => currentRun().environment,
});

source<IActivity>({
  subject: 'activity:captured-constructor',
  // eslint-disable-next-line microdelta/tracked-captures -- A module-level outcome constructor is a captured value; use the context's `outcome`.
  run: () => sourceOutcome.fresh<IActivity>({ profile: { name: 'Ada' }, pulls: [] }),
});

const composition = compose({
  scope: 'contribution-report:acme/widget',
  inputs: [{ slot: 'config', value: { repository: 'acme/widget' } }],
  members: [{ key: 'person:ada', steps: [{ slot: 'activity', declaration: activity }, { slot: 'summary', declaration: summary }] }],
});

/** The workspace entry operations and top-level outcomes type-check through the alpha rollup. */
export async function reportOnce(location: string, requestKey: string): Promise<IResolutionOutcome> {
  const workspace = openWorkspace({ location, logicalStore: 'store:fixture' });
  const step: IStepDescriptor = { scope: composition.scope, role: 'step', slot: 'summary', memberKey: 'person:ada' };
  try {
    const result = await workspace.run({ authoring: builders, composition, environment: 'env:fixture' },
      async (run: IWorkspaceRun) => run.resolve(step, { requestKey }));
    return result.value;
  } finally {
    workspace.close();
  }
}

/** Template member outcomes type-check through the facade's alpha rollup, named from `microdelta` itself. */
export async function membersOnce(run: IWorkspaceRun, target: IMembersTarget, requestKey: string): Promise<readonly string[]> {
  const report: IMembersReport = await run.resolveMembers(target, { requestKey });
  const discovery: IDiscoveryReport = report.discovery;
  const statuses = report.members.map((member: IMemberOutcome): string => {
    const gate: IGateEvidence | undefined = member.gate;
    return `${member.key}:${member.status}:${gate?.selected ?? 'ungated'}`;
  });
  return [discovery.kind, ...statuses];
}
