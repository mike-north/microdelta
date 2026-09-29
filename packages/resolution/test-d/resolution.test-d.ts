/**
 * Type contracts for Resolution's alpha surface: its binding family types
 * author callbacks through Definition's builders (tracked inputs and helpers,
 * outcome constructors and previous carrier for sources, lazy child views for
 * memos), sources must return a minted outcome envelope, and retention
 * accepts only a previous-result carrier.
 *
 * @see ../../../docs/plans/m3-contribution-analysis.md (Authoring shape and worked walkthrough)
 * @see ../../../docs/spec/execution.md (RES-004)
 */
import { expectAssignable, expectError, expectNotAssignable, expectType } from 'tsd';
import { declarations } from '@microdelta/definition';
import type { IChildResult } from '@microdelta/definition';
import type { ITrackedView } from '@microdelta/tracking';

import { ResolutionError, sourceOutcome } from '../dist/src/index.js';
import type { ICallView, ICandidateMiss, IPreviousResult, IResolutionFamily, IResolutionOutcome, IResultView, ISourceOutcome, ISourceOutcomes, IUntrackedRead } from '../dist/src/index.js';

interface IActivity {
  readonly profile: { readonly name: string };
  readonly count: number;
}
interface IInputs {
  readonly config: { readonly repository: string };
}
interface IHelpers {
  readonly fetch: (repository: string) => IActivity;
  readonly render: (name: string) => string;
}
type IFamily = IResolutionFamily<IInputs, IHelpers>;

const { source, memo } = declarations<IFamily>();

const activity = source<IActivity>({
  subject: 'activity:ada',
  finality: ({ previous }) => previous.data.profile.name.length > 0,
  run: ({ previous, inputs, helpers, outcome }) =>
    previous === undefined ? outcome.fresh(helpers.fetch(inputs.config.repository)) : outcome.retain(previous),
});

type IRunContext = Parameters<typeof activity.run>[0];
declare const runContext: IRunContext;
expectType<IPreviousResult<IActivity> | undefined>(runContext.previous);
expectType<ISourceOutcomes>(runContext.outcome);
expectType<string>(runContext.inputs.config.repository);
expectType<ITrackedView<IActivity>>(runContext.previous?.data ?? ({} as ITrackedView<IActivity>));

const summary = memo({
  subject: 'summary:ada',
  children: { activity },
  run: async ({ calls, helpers }) => {
    const { data } = await calls.activity();
    return { line: helpers.render(data.profile.name) };
  },
});

type IMemoContext = Parameters<typeof summary.run>[0];
declare const memoContext: IMemoContext;
expectType<Promise<IChildResult<IResultView<IActivity>>>>(memoContext.calls.activity());
// Memo callbacks receive no source outcome constructors or previous carrier.
expectError(memoContext.outcome);

// A source must return a minted envelope, not raw data.
expectError(source<IActivity>({ subject: 'raw', run: () => ({ profile: { name: 'Ada' }, count: 1 }) }));
// Retention names a previous carrier, not a payload.
expectError(sourceOutcome.retain({ profile: { name: 'Ada' }, count: 1 }));
expectAssignable<ISourceOutcome<IActivity>>(sourceOutcome.fresh<IActivity>({ profile: { name: 'Ada' }, count: 1 }));
expectNotAssignable<ISourceOutcome<IActivity>>({ kind: 'fresh', data: { profile: { name: 'Ada' }, count: 1 } });

// Outcomes are a discriminated union.
declare const outcome: IResolutionOutcome;
if (outcome.kind === 'refused') {
  expectType<string>(outcome.reason);
} else {
  expectType<string>(outcome.reference.locator);
}
expectType<ResolutionError['code']>(new ResolutionError('integrity', 'x').code);

// Every callback receives the explicit observed untracked read: scalar members only.
expectType<IUntrackedRead>(memoContext.untracked);
expectType<string>(memoContext.untracked(memoContext.inputs.config, 'repository'));
expectError(memoContext.untracked(memoContext.inputs, 'config'));
expectType<IUntrackedRead>(runContext.untracked);

// A supplied step reads a scalar argument as itself and a record argument through a tracked view.
const { suppliedStep } = declarations<IFamily>();
const assessor = suppliedStep<readonly [number, IActivity], { readonly score: number }>({
  run: ({ args }) => ({ score: args[0] + args[1].count }),
});
type ISuppliedContext = Parameters<typeof assessor.run>[0];
declare const suppliedContext: ISuppliedContext;
expectType<number>(suppliedContext.args[0]);
expectType<ITrackedView<IActivity>>(suppliedContext.args[1]);
expectType<string>(suppliedContext.untracked(suppliedContext.args[1].profile, 'name'));
declare const scalarView: ICallView<number>;
expectType<number>(scalarView);
declare const recordView: ICallView<IActivity>;
expectType<ITrackedView<IActivity>>(recordView);
void assessor;

// Candidate misses keep nested reasons distinct from changed evidence and correspondence.
declare const missed: ICandidateMiss;
expectAssignable<ICandidateMiss['reason']>('changed-child-output');
expectAssignable<ICandidateMiss['reason']>('missing-binding');
expectAssignable<ICandidateMiss['reason']>('ambiguous-binding');
expectAssignable<ICandidateMiss['reason']>('unreconstructible-argument');
expectAssignable<ICandidateMiss['reason']>('unjustified-argument');
expectNotAssignable<ICandidateMiss['reason']>('unjustified');
expectType<string>(missed.detail);
