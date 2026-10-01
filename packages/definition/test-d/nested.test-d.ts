/**
 * Type contracts for nested composition: memo children may be memos with a
 * settled result view; supplied step slots carry a call signature, so their
 * handles accept exactly the declared arguments (plain data or a `forward`
 * origin of the same type) and supplied implementations must match the slot;
 * the subject function sees only derived values by position; the port must
 * recognize tracked views and report justification; witnesses and requests are
 * discriminated unions.
 *
 * @see ../../../docs/spec/composition.md (CMP-3, CMP-7, EXP-4 argument recipe)
 * @see ../../../docs/plans/m4-composition.md ("Authoring shape")
 */
import { expectAssignable, expectError, expectNotAssignable, expectType } from 'tsd';

import {
  declarations,
  type IApply,
  type IArgumentSupplier,
  type IArgumentViews,
  type IBindingFamily,
  type IChildResult,
  type IDeclaredInvocationRequest,
  type IDerivedArguments,
  type IForwarded,
  type IInvocationArguments,
  type IInvocationPort,
  type IInvocationScope,
  type IInvocationWitness,
  type IPreviousCarrierFamily,
  type IStepSlot,
  type ISuppliedStepDeclaration,
  type ISuppliedStepRegistration,
  type ITypeFamily,
  type IWitnessResolution,
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
interface IOutcomes extends ITypeFamily {
  readonly output: this['input'];
}
interface IFamily extends IBindingFamily {
  readonly views: IViews;
  readonly previous: ICarriers;
  readonly outcomes: IOutcomes;
  readonly source: { readonly repository: string };
  readonly memo: { readonly format: (value: number) => string };
}
/** True only when two types are mutually identical. */
type IExact<A, B> = (<T>() => T extends A ? 1 : 2) extends <T>() => T extends B ? 1 : 2 ? true : false;

const { source, memo, stepSlot, suppliedStep, supply, forward, compose } = declarations<IFamily>();

interface IPullRequest {
  readonly number: number;
  readonly merged: boolean;
}
interface IActivity {
  readonly pullRequests: readonly IPullRequest[];
}
interface IAssessment {
  readonly score: number;
}
type IParameters = readonly [number, IPullRequest];

const activity = source<IActivity>({ subject: 'activity:ada', run: () => ({ pullRequests: [] }) });
const profile = memo({ subject: 'profile:ada', children: { activity }, run: async () => ({ name: 'Ada' }) });
const assessor = stepSlot<IParameters, IAssessment>({ slot: 'assessor' });
expectType<IStepSlot<IFamily, IParameters, IAssessment>>(assessor);
expectType<string>(assessor.slot);

// A supplied implementation reads its argument views; it has no subject or children option.
const rubric = suppliedStep<IParameters, IAssessment>({
  run: ({ args, format }) => {
    const exactArgs: IExact<typeof args, IArgumentViews<IFamily, IParameters>> = true;
    void exactArgs;
    expectType<IView<number>>(args[0]);
    expectType<IView<IPullRequest>>(args[1]);
    expectType<(value: number) => string>(format);
    return { score: args[1].merged ? 2 : 1 };
  },
});
expectType<ISuppliedStepDeclaration<IFamily, IParameters, IAssessment>>(rubric);
expectError(suppliedStep<IParameters, IAssessment>({ subject: 'assessment', run: () => ({ score: 1 }) }));
expectError(suppliedStep<IParameters, IAssessment>({ children: { activity }, run: () => ({ score: 1 }) }));
expectError(suppliedStep<IParameters, IAssessment>({ run: () => ({ score: 'high' }) }));
// Like a memo body, a supplied implementation may be asynchronous: an author isolates one awaited external
// operation per call in it (EXP-8 resolution 3), and its settled value is the call's result.
const asynchronous = suppliedStep<IParameters, IAssessment>({ run: async ({ args }) => ({ score: args[1].merged ? 2 : 1 }) });
expectType<ISuppliedStepDeclaration<IFamily, IParameters, IAssessment>>(asynchronous);
expectError(suppliedStep<IParameters, IAssessment>({ run: async () => ({ score: 'high' }) }));

// A memo child's view is its settled result; a slot handle takes the declared arguments.
memo({
  subject: 'summary:ada',
  children: { activity, profile, assess: assessor },
  run: async ({ calls }) => {
    const activityResult = await calls.activity();
    const { data: profileData } = await calls.profile();
    const exactProfile: IExact<typeof profileData, IView<{ name: string }>> = true;
    void exactProfile;
    const { data: assessment } = await calls.assess(1, forward.child<IPullRequest>(activityResult, ['pullRequests', 0]));
    expectType<IView<IAssessment>>(assessment);
    await calls.assess(forward.input<number>('config', ['minimumAuthored']), { number: 1, merged: true });
    await calls.assess(2, forward.member<IPullRequest>(['pullRequests', 0]));
    expectError(await calls.assess('1', { number: 1, merged: true }));
    expectError(await calls.assess(1));
    expectError(await calls.assess(1, { number: 1, merged: true }, 3));
    // An unannotated forward takes its asserted type from the parameter it fills; a contradicting annotation is rejected.
    await calls.assess(1, forward.input('config'));
    expectError(await calls.assess(1, forward.input<number>('config')));
    expectError(await calls.assess(forward.child<string>(activityResult), { number: 1, merged: true }));
    expectError(await calls.activity(1));
    expectError(await calls.profile(forward.input<number>('config')));
    return assessment.score;
  },
});

// Forward tokens are nominal; look-alikes are not origins.
expectAssignable<IForwarded<number>>(forward.input<number>('config'));
expectNotAssignable<IForwarded<number>>({ origin: { binding: 'input' as const, slot: 'config', path: [] } });
expectNotAssignable<IForwarded<number>>(forward.input<string>('config'));
expectError(forward.child({ data: 1 }, [{}]));

// Supplying: the implementation and subject function must match the slot signature.
const registration = supply({ slot: assessor, declaration: rubric, subject: derived => `assessment:${String(derived[0])}` });
expectType<ISuppliedStepRegistration<IFamily>>(registration);
supply({
  slot: assessor,
  declaration: rubric,
  subject: derived => {
    expectType<IDerivedArguments<IParameters>>(derived);
    expectType<number | undefined>(derived[0]);
    expectType<IPullRequest | undefined>(derived[1]);
    return 'assessment';
  },
});
const mismatched = suppliedStep<readonly [string], IAssessment>({ run: () => ({ score: 1 }) });
expectError(supply({ slot: assessor, declaration: mismatched, subject: () => 'assessment' }));
const wrongResult = suppliedStep<IParameters, string>({ run: () => 'x' });
expectError(supply({ slot: assessor, declaration: wrongResult, subject: () => 'assessment' }));
expectError(supply({ slot: assessor, declaration: rubric, subject: () => 42 }));
expectNotAssignable<IStepSlot<IFamily, IParameters, IAssessment>>({ kind: 'step-slot' as const, slot: 'assessor' });

// Composition accepts composition-level steps, optional members and supplies.
const composition = compose({
  scope: 'report',
  steps: [{ slot: 'activity', declaration: activity }],
  supplied: [registration],
});
expectType<readonly string[]>(composition.topology.slots);
expectError(compose({ scope: 'report', supplied: [{ slot: 'assessor', declaration: rubric }] }));

// The port must recognize tracked views and report justification.
declare const viewOf: <TResult>(reference: string) => IView<TResult>;
const port: IInvocationPort<IFamily> = {
  active: (): IInvocationScope | undefined => undefined,
  dispatch: <TResult>(request: IDeclaredInvocationRequest<IFamily, TResult>): Promise<IChildResult<IApply<IViews, TResult>>> =>
    Promise.resolve({ data: viewOf<TResult>(request.witness.child.slot) }),
  isTrackedView: (value: unknown): boolean => value === undefined,
  argumentsJustified: (): boolean => true,
};
void port;
expectNotAssignable<IInvocationPort<IFamily>>({
  active: (): IInvocationScope | undefined => undefined,
  dispatch: <TResult>(request: IDeclaredInvocationRequest<IFamily, TResult>): Promise<IChildResult<IApply<IViews, TResult>>> =>
    Promise.resolve({ data: viewOf<TResult>(request.witness.child.slot) }),
});

// Requests and witnesses are discriminated.
declare const request: IDeclaredInvocationRequest<IFamily, IActivity>;
if (request.kind === 'supplied') {
  expectType<2>(request.witness.version);
  expectType<string>(request.subject.subject);
} else if (request.kind === 'source') {
  expectType<IInvocationWitness>(request.witness);
}
declare const witness: IInvocationWitness;
if (witness.version === 2) {
  expectType<number>(witness.index);
  expectType<IInvocationArguments>(witness.arguments);
} else {
  expectType<'empty'>(witness.arguments.form);
}
declare const resolution: IWitnessResolution<IFamily>;
if (resolution.status === 'bound' && resolution.child.role === 'callable') {
  expectType<'supplied-step'>(resolution.child.kind);
}

// The argument supplier is generic in the supplied declaration's parameters.
declare const supplier: IArgumentSupplier<IFamily>;
expectType<IArgumentViews<IFamily, IParameters>>(supplier.views(rubric));
