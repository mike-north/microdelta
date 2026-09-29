/**
 * Type contracts for Definition's alpha bridge: a facade-chosen binding family
 * types each author callback's context precisely (source bindings plus an
 * optional previous-result carrier; finality with a required carrier; memo
 * bindings plus typed declared calls), declarations and handles are nominal,
 * reconnected steps are invoked only through a rank-2 invoker, and the port is
 * generic in the declared child's result.
 *
 * @see ../../../docs/spec/composition.md (CMP-1, CMP-7, CMP-9)
 * @see ../../../docs/plans/m3-contribution-analysis.md (authoring shape; source policy carrier)
 */
import { expectAssignable, expectError, expectNotAssignable, expectType } from 'tsd';

import {
  DefinitionError,
  declarations,
  type IApply,
  type IAuthorInvoker,
  type IBindingFamily,
  type IChildResult,
  type IDeclaredCallHandle,
  type IDeclaredInvocationRequest,
  type IInvocationPort,
  type IInvocationScope,
  type IMemoDeclaration,
  type IPreviousCarrierFamily,
  type ISourceDeclaration,
  type IStepDeclaration,
  type ITypeFamily,
} from '../dist/src/index.js';

/** Stand-in for a facade-owned view brand; Definition cannot import Tracking. */
interface IFacadeBrand {
  readonly __facadeView: unique symbol;
}
type IView<T> = T & IFacadeBrand;
interface IViews extends ITypeFamily {
  readonly output: IView<this['input']>;
}
interface ICarrier<TData> {
  readonly data: IView<TData>;
}
interface ICarriers extends IPreviousCarrierFamily {
  readonly output: ICarrier<this['input']>;
}
type IOutcome<T> = { readonly kind: 'fresh'; readonly data: T } | { readonly kind: 'retain' };
interface IOutcomes extends ITypeFamily {
  readonly output: IOutcome<this['input']>;
}
interface IFamily extends IBindingFamily {
  readonly views: IViews;
  readonly previous: ICarriers;
  readonly outcomes: IOutcomes;
  readonly source: { readonly repository: string };
  readonly memo: { readonly format: (value: number) => string };
}
/** True only when two types are mutually identical (rejects never/any collapse). */
type IExact<A, B> = (<T>() => T extends A ? 1 : 2) extends <T>() => T extends B ? 1 : 2 ? true : false;

const { source, memo, compose, openInvocation } = declarations<IFamily>();

interface IActivity {
  readonly reviews: number;
}
interface IProfile {
  readonly name: string;
}

// Two distinct source result types in one family.
const activity = source<IActivity>({
  subject: 'activity:ada',
  run: ({ previous, repository }) => {
    expectType<{ readonly data: IView<IActivity> } | undefined>(previous);
    expectType<string>(repository);
    return previous === undefined ? { kind: 'fresh', data: { reviews: 0 } } : { kind: 'retain' };
  },
  finality: ({ previous }) => {
    expectType<{ readonly data: IView<IActivity> }>(previous);
    return previous.data.reviews > 0;
  },
});
const profile = source<IProfile>({ subject: 'profile:ada', run: () => ({ kind: 'fresh', data: { name: 'Ada' } }) });
const summary = memo({
  subject: 'summary:ada',
  children: { activity, profile },
  run: async ({ calls, format }) => {
    const { data: activityData } = await calls.activity();
    const { data: profileData } = await calls.profile();
    const exactActivity: IExact<typeof activityData, IView<IActivity>> = true;
    const exactProfile: IExact<typeof profileData, IView<IProfile>> = true;
    void exactActivity;
    void exactProfile;
    return `${profileData.name}: ${format(activityData.reviews)}`;
  },
});
expectType<ISourceDeclaration<IFamily, IActivity>>(activity);
expectType<readonly string[]>(summary.children);
expectType<number>(summary.version);
expectAssignable<IStepDeclaration<IFamily>>(summary);
expectAssignable<IStepDeclaration<IFamily>>(activity);
expectNotAssignable<IMemoDeclaration<IFamily, Record<never, never>, unknown>>(activity);

// Exactness controls.
const controlDifferent: IExact<IView<IActivity>, IView<IProfile>> = false;
const controlNever: IExact<never, IView<IActivity>> = false;
void controlDifferent;
void controlNever;

// Structural look-alikes cannot satisfy the nominal declaration brand.
expectNotAssignable<IStepDeclaration<IFamily>>({ kind: 'memo' as const, subject: 's', version: 1, label: undefined, children: [] as readonly string[], run: (): number => 1 });

// Declarations of another family cannot enter this composition.
interface IOtherFamily extends IBindingFamily {
  readonly views: IViews;
  readonly previous: ICarriers;
  readonly outcomes: IOutcomes;
  readonly source: { readonly repository: string };
  readonly memo: { readonly other: true };
}
const foreign = declarations<IOtherFamily>().source<IActivity>({ subject: 'activity:foreign', run: () => ({ kind: 'retain' }) });
expectError(compose({ scope: 's', members: [{ key: 'k', steps: [{ slot: 'activity', declaration: foreign }] }] }));

// Author negatives.
// eslint-disable-next-line @typescript-eslint/no-unsafe-return -- This negative tsd case intentionally reads a field absent from the child view.
expectError(memo({ subject: 's', children: { activity }, run: async ({ calls }) => (await calls.activity()).data.name }));
expectError(memo({ subject: 's', children: { summary: 'summary' }, run: () => 1 }));
expectError(source<IActivity>({ subject: 's', run: () => ({ reviews: 1 }) }));
expectError(source<IActivity>({
  subject: 's',
  run: ({ previous }) => {
    const required: ICarrier<IActivity> = previous;
    return { kind: 'fresh', data: { reviews: required.data.reviews } };
  },
}));
// eslint-disable-next-line @typescript-eslint/no-unsafe-assignment -- This negative tsd case intentionally reads the payload field on the carrier itself.
expectError(source<IActivity>({ subject: 's', run: ({ previous }) => ({ kind: 'fresh', data: { reviews: previous?.reviews ?? 0 } }) }));
expectError(memo({ subject: 's', version: '1', run: () => 1 }));
expectError(source<IActivity>({ subject: 's', children: { activity }, run: () => ({ kind: 'retain' }) }));
expectError(memo({ run: () => 1 }));

// Handles take no runtime arguments and return a readonly carrier.
declare const handle: IDeclaredCallHandle<IView<IActivity>>;
expectType<Promise<IChildResult<IView<IActivity>>>>(handle());
expectError(handle('person:ben'));
declare const carrier: IChildResult<IView<IActivity>>;
declare const activityView: IView<IActivity>;
expectError((carrier.data = activityView));
const plain = (): Promise<IChildResult<IView<IActivity>>> => Promise.resolve({ data: activityView });
expectNotAssignable<IDeclaredCallHandle<IView<IActivity>>>(plain);

// Owner path: the port is generic in the declared child result, and reconnected
// steps are invoked only through a rank-2 invoker with family bindings.
declare const viewOf: <TResult>(reference: string) => IView<TResult>;
const port: IInvocationPort<IFamily> = {
  active: (): IInvocationScope | undefined => undefined,
  dispatch: <TResult>(request: IDeclaredInvocationRequest<IFamily, TResult>): Promise<IChildResult<IApply<IViews, TResult>>> =>
    Promise.resolve({ data: viewOf<TResult>(request.witness.child.slot) }),
  isTrackedView: (): boolean => false,
  argumentsJustified: (): boolean => true,
};
expectNotAssignable<IInvocationPort<IFamily>>({
  active: (): IInvocationScope | undefined => undefined,
  dispatch: <TResult>(_request: IDeclaredInvocationRequest<IFamily, TResult>) => Promise.resolve({ data: { reviews: 1 } }),
  isTrackedView: (): boolean => false,
  argumentsJustified: (): boolean => true,
});
const invoke: IAuthorInvoker<string> = <TContext, TResult>(callback: (context: TContext) => TResult, context: TContext): string =>
  String(callback(context));
expectError<IAuthorInvoker<unknown>>(<TContext, TResult>(callback: (context: TContext) => TResult, _context: TContext): unknown => callback({}));

const composition = compose({
  scope: 'report',
  members: [{ key: 'person:ada', steps: [{ slot: 'activity', declaration: activity }, { slot: 'profile', declaration: profile }, { slot: 'summary', declaration: summary }] }],
});
const invocation = openInvocation(composition, { scope: 'report', role: 'step', slot: 'summary', memberKey: 'person:ada' }, port);
if (invocation.kind === 'memo') {
  expectType<string>(invocation.apply({ format: String }, invoke));
  expectError(invocation.apply({ repository: 'acme/widget' }, invoke));
} else if (invocation.kind === 'source') {
  expectType<boolean>(invocation.hasFinality);
  expectType<string>(invocation.apply({ repository: 'acme/widget' }, undefined, invoke));
  expectError(invocation.apply({ format: String }, undefined, invoke));
  expectError(invocation.applyFinality({ repository: 'acme/widget' }, undefined, invoke));
}

// Failures carry a closed set of Definition codes.
declare const failure: DefinitionError;
expectAssignable<string>(failure.code);
expectNotAssignable<DefinitionError['code']>('anything-else');
