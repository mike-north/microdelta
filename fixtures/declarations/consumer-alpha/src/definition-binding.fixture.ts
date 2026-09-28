/**
 * Generated-declaration consumer proving the Definition invocation bridge end
 * to end against the real alpha rollups of Definition and Tracking.
 *
 * FACADE chooses a binding family from Tracking's types: child views, the
 * immutable previous-result carrier, the source outcome envelope, and distinct
 * source and memo bindings. AUTHOR declares two sources with different result
 * types and one summary with a typed child record. RESOLUTION (a stand-in)
 * reconnects a descriptor, opens the invocation, supplies bindings and a
 * previous carrier, and invokes the actual author callback through a rank-2
 * invoker that tracks and captures it; the port serves typed child views.
 *
 * Explicit trusted contract: `selectedView<R>` and `selectedCarrier<R>` stand
 * for Materialization/Resolution's caller-typed view of an exact persisted
 * reference (as `IMaterialization.materialize<T>` is today). TypeScript does
 * not prove stored values have type R; Resolution's current-evidence validation
 * and Definition's pinned child edges are what make that pairing hold.
 *
 * @see ../../../../docs/plans/m3-contribution-analysis.md (authoring shape; source policy carrier)
 * @see ../../../../docs/spec/composition.md (CMP-5, CMP-6, CMP-7)
 */
import {
  declarations,
  type IApply,
  type IAuthorInvoker,
  type IBindingFamily,
  type IChildResult,
  type IDeclaredCallHandle,
  type IDeclaredInvocationRequest,
  type IInvocationPort,
  type IInvocationScope,
  type IPreviousCarrierFamily,
  type IPreviousSupplier,
  type ISourceDeclaration,
  type ITypeFamily,
} from '@microdelta/definition';
import type { IObservationCapture, ITracked, ITrackedView, ITrackingObserver } from '@microdelta/tracking';

// ------------------------------------------------------------------ FACADE --

/** Result type -> the Tracking view authors read. */
interface ITrackedViews extends ITypeFamily {
  readonly output: ITrackedView<this['input']>;
}
/** The facade's immutable eligible previous-result carrier; authors read `previous.data`. */
interface IPreviousCarrier<TResult> {
  readonly data: ITrackedView<TResult>;
}
/** Result type -> the previous-result carrier. */
interface IPreviousCarriers extends IPreviousCarrierFamily {
  readonly output: IPreviousCarrier<this['input']>;
}
/** Placeholder for Resolution's source control envelope; its spelling is not selected here. */
type ISourceOutcome<TResult> = { readonly kind: 'fresh'; readonly data: TResult } | { readonly kind: 'retain' };
interface ISourceOutcomes extends ITypeFamily {
  readonly output: ISourceOutcome<this['input']> | Promise<ISourceOutcome<this['input']>>;
}
interface IConfig {
  readonly repository: string;
  readonly window: string;
}
/** Distinct source and memo bindings keep their different meanings. */
interface IFacadeFamily extends IBindingFamily {
  readonly views: ITrackedViews;
  readonly previous: IPreviousCarriers;
  readonly outcomes: ISourceOutcomes;
  readonly source: {
    readonly inputs: ITracked<{ readonly config: IConfig }>;
    readonly fetch: ITracked<(repository: string, key: string) => IActivity>;
    readonly lookup: ITracked<(key: string) => IProfile>;
  };
  readonly memo: {
    readonly inputs: ITracked<{ readonly config: IConfig }>;
    readonly helpers: ITracked<{ readonly format: (name: string, authored: number, reviews: number) => string }>;
  };
}
const { source, memo, compose, openInvocation } = declarations<IFacadeFamily>();

// ------------------------------------------------------------------ AUTHOR --

interface IActivity {
  readonly pulls: readonly { readonly merged: boolean }[];
  readonly reviews: number;
}
interface IProfile {
  readonly name: string;
  readonly avatar: string;
}

const adaActivity = source<IActivity>({
  subject: 'activity:acme/widget:2026-Q1:person:ada',
  finality: ({ previous }) => previous.data.reviews > 0,
  run: ({ previous, inputs, fetch }) =>
    previous !== undefined && previous.data.reviews > 0
      ? { kind: 'retain' }
      : { kind: 'fresh', data: fetch(inputs.config.repository, 'person:ada') },
});
const adaProfile = source<IProfile>({
  subject: 'profile:acme/widget:person:ada',
  run: ({ lookup }) => ({ kind: 'fresh', data: lookup('person:ada') }),
});
const adaSummary = memo({
  subject: 'summary:acme/widget:2026-Q1:person:ada',
  children: { activity: adaActivity, profile: adaProfile },
  run: async ({ calls, helpers }) => {
    const { data: activity } = await calls.activity();
    const { data: profile } = await calls.profile();
    // Non-vacuous: each child's data is exactly its own selected view.
    const exactActivity: IExact<typeof activity, ITrackedView<IActivity>> = true;
    const exactProfile: IExact<typeof profile, ITrackedView<IProfile>> = true;
    void exactActivity;
    void exactProfile;
    let merged = 0;
    for (let index = 0; index < activity.pulls.length; index++) {
      merged += activity.pulls[index]?.merged === true ? 1 : 0;
    }
    return helpers.format(profile.name, merged, activity.reviews);
  },
});
const composition = compose({
  scope: 'contribution-report:acme/widget',
  members: [{
    key: 'person:ada',
    steps: [
      { slot: 'activity', declaration: adaActivity },
      { slot: 'profile', declaration: adaProfile },
      { slot: 'summary', declaration: adaSummary },
    ],
  }],
});

/** True only when two types are mutually identical (rejects never/any collapse). */
type IExact<A, B> = (<T>() => T extends A ? 1 : 2) extends <T>() => T extends B ? 1 : 2 ? true : false;
const summaryResult: IExact<ReturnType<typeof adaSummary.run>, Promise<string>> = true;
const sourceContext: IExact<Parameters<typeof adaActivity.run>[0], IFacadeFamily['source'] & { readonly previous: { readonly data: ITrackedView<IActivity> } | undefined }> = true;
const finalityContext: IExact<Parameters<NonNullable<typeof adaActivity.finality>>[0], IFacadeFamily['source'] & { readonly previous: { readonly data: ITrackedView<IActivity> } }> = true;
// Controls: the exactness check rejects a different view and the never collapse.
const controlDifferent: IExact<ITrackedView<IActivity>, ITrackedView<IProfile>> = false;
const controlNever: IExact<never, ITrackedView<IActivity>> = false;
void summaryResult;
void sourceContext;
void finalityContext;
void controlDifferent;
void controlNever;

// ------------------------------------------------------ RESOLUTION stand-in --

declare const observer: ITrackingObserver;
declare const memoBindings: IFacadeFamily['memo'];
declare const sourceBindings: IFacadeFamily['source'];
/** Trusted caller-typed view of the exact child result the witness identifies. */
declare function selectedView<TResult>(witness: IDeclaredInvocationRequest<IFacadeFamily, TResult>['witness']): ITrackedView<TResult>;
/** Trusted caller-typed carrier of the exact eligible previous result Resolution selected. */
declare function selectedCarrier<TResult>(declaration: ISourceDeclaration<IFacadeFamily, TResult>): { readonly data: ITrackedView<TResult> };

const port: IInvocationPort<IFacadeFamily> = {
  active: (): IInvocationScope | undefined => undefined,
  dispatch: <TResult>(request: IDeclaredInvocationRequest<IFacadeFamily, TResult>): Promise<IChildResult<IApply<ITrackedViews, TResult>>> =>
    Promise.resolve({ data: selectedView<TResult>(request.witness) }),
};
const previous: IPreviousSupplier<IFacadeFamily> = {
  carrier: <TResult>(declaration: ISourceDeclaration<IFacadeFamily, TResult>): IApply<IPreviousCarriers, TResult> => selectedCarrier(declaration),
};
/** Rank-2 invoker: tracks and captures the ACTUAL author callback with the context Definition assembled. */
const invoke: IAuthorInvoker<Promise<IObservationCapture<unknown>>> = <TContext, TResult>(
  callback: (context: TContext) => TResult,
  context: TContext,
): Promise<IObservationCapture<unknown>> => {
  // Framework code, not an author callback: Resolution receives the actual author
  // callback from Definition as a value and tracks it, so its form is not a direct literal.
  // eslint-disable-next-line microdelta/tracked-captures -- Resolution tracks the Definition-supplied author callback by value.
  const trackedCallback = observer.tracked(callback, { path: ['contribution-report', 'person:ada'] });
  // eslint-disable-next-line microdelta/tracked-captures -- The context is the one Definition assembled for this exact callback.
  return observer.captureAsync(async () => trackedCallback(context));
};

const resolution = composition.resolve({ scope: 'contribution-report:acme/widget', role: 'step', slot: 'summary', memberKey: 'person:ada' });
if (resolution.status === 'bound') {
  const invocation = openInvocation(composition, resolution.descriptor, port);
  if (invocation.kind === 'memo') {
    const outcome: Promise<IObservationCapture<unknown>> = invocation.apply(memoBindings, invoke);
    void outcome;
  } else {
    void invocation.apply(sourceBindings, undefined, invoke);
    void invocation.apply(sourceBindings, previous, invoke);
    if (invocation.hasFinality) {
      void invocation.applyFinality(sourceBindings, previous, invoke);
    }
  }
}

// --------------------------------------------------------------- NEGATIVES --

// Child data exposes only the selected view of that child.
memo({
  subject: 'summary:n1',
  children: { profile: adaProfile },
  run: async ({ calls }) => {
    const { data } = await calls.profile();
    // @ts-expect-error: reviews belong to activity, not the profile child.
    void data.reviews;
    return 0;
  },
});

// An author-annotated context claiming different child data is rejected.
memo({
  subject: 'summary:n2',
  children: { activity: adaActivity },
  // @ts-expect-error: the declared child produces IActivity, not IProfile.
  run: async (context: IFacadeFamily['memo'] & { readonly calls: { readonly activity: IDeclaredCallHandle<ITrackedView<IProfile>> } }) =>
    (await context.calls.activity()).data.name,
});

// A previous carrier is not the raw payload view.
source<IActivity>({
  subject: 'activity:n3',
  // @ts-expect-error: reviews live on previous.data, not on the carrier.
  finality: ({ previous }) => previous.reviews > 0,
  run: () => ({ kind: 'retain' }),
});
source<IActivity>({
  subject: 'activity:n4',
  // @ts-expect-error: run's previous carrier may be absent.
  run: ({ previous }) => ({ kind: 'fresh', data: { pulls: [], reviews: previous.data.reviews } }),
});

// Memo and source bindings are not interchangeable, and finality needs a previous carrier.
declare const summaryInvocation: Extract<ReturnType<typeof openInvocation>, { readonly kind: 'memo' }>;
declare const activityInvocation: Extract<ReturnType<typeof openInvocation>, { readonly kind: 'source' }>;
// @ts-expect-error: source bindings lack memo helpers.
void summaryInvocation.apply(sourceBindings, invoke);
// @ts-expect-error: memo bindings lack the source fetchers.
void activityInvocation.apply(memoBindings, undefined, invoke);
// @ts-expect-error: finality is only evaluated with an eligible previous carrier.
void activityInvocation.applyFinality(sourceBindings, undefined, invoke);

// The invoker cannot call the author callback with a context it invents.
const forgingInvoker: IAuthorInvoker<unknown> = <TContext, TResult>(callback: (context: TContext) => TResult, _context: TContext): unknown =>
  // @ts-expect-error: TContext is opaque to the invoker.
  callback({ calls: {} });
// @ts-expect-error: a contextually typed invoker is equally unable to invent a context.
const contextualForgingInvoker: IAuthorInvoker<unknown> = callback => callback({ calls: {} });
void forgingInvoker;
void contextualForgingInvoker;

// A port cannot serve raw data where the family's view of the child result is required.
const wrongPort: IInvocationPort<IFacadeFamily> = {
  active: () => undefined,
  // @ts-expect-error: raw data is not the family's view of TResult.
  dispatch: <TResult>(_request: IDeclaredInvocationRequest<IFacadeFamily, TResult>) => Promise.resolve({ data: { total: 1 } }),
};
void wrongPort;

// Declarations from another family cannot enter this composition.
interface IOtherFamily extends IBindingFamily {
  readonly views: ITrackedViews;
  readonly previous: IPreviousCarriers;
  readonly outcomes: ISourceOutcomes;
  readonly source: IFacadeFamily['source'];
  readonly memo: { readonly other: true };
}
const foreign = declarations<IOtherFamily>().source<IActivity>({ subject: 'activity:foreign', run: () => ({ kind: 'retain' }) });
// @ts-expect-error: the family marker is invariant.
compose({ scope: 's', members: [{ key: 'k', steps: [{ slot: 'activity', declaration: foreign }] }] });

// A memo cannot be a child, and a source must return the outcome envelope for its result.
// @ts-expect-error: children must be source declarations.
memo({ subject: 'summary:n7', children: { summary: adaSummary }, run: () => 1 });
// @ts-expect-error: a source returns the facade's outcome for its result, not raw data.
source<IProfile>({ subject: 'profile:n8', run: () => ({ name: 'Ada', avatar: 'a.png' }) });
