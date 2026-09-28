/**
 * The M3 contributor fixture composition: two explicitly selected members, each
 * with a retained activity source and a memoized summary whose typed child
 * record names only its own member's activity. Every call allocates fresh
 * declarations, callbacks and input objects, standing in for a new process after
 * a complete restart. The test family maps result types to themselves and wraps
 * a previous result in a readonly `{ data }` carrier, as a facade would.
 *
 * @see ../../../../docs/plans/m3-contribution-analysis.md
 * @see ../../../../docs/spec/composition.md
 */
import {
  declarations,
  type IAnyMemoDeclaration,
  type IAnySourceDeclaration,
  type IBindingFamily,
  type ICompositionOptions,
  type IComposition,
  type IMemberRegistration,
  type IPreviousCarrierFamily,
  type ITypeFamily,
} from '../../src/index.js';

/** Test views are the result types themselves. */
export interface ITestViews extends ITypeFamily {
  readonly output: this['input'];
}

/** The test facade's immutable previous-result carrier shape. */
export interface ITestCarrier<TData> {
  readonly data: TData;
}

/** Result type -> the test facade's previous-result carrier. */
export interface ITestCarriers extends IPreviousCarrierFamily {
  readonly output: ITestCarrier<this['input']>;
}

/** A binding family whose source and memo bindings are distinct plain records. */
export interface ITestFamily extends IBindingFamily {
  readonly views: ITestViews;
  readonly previous: ITestCarriers;
  readonly outcomes: ITestViews;
  readonly source: { readonly [binding: string]: unknown };
  readonly memo: { readonly [binding: string]: unknown };
}

/** Builders bound to the test family, as a facade would pre-apply its own family. */
export const builders = declarations<ITestFamily>();
export const { source, memo, compose, openInvocation } = builders;

/** The analysis scope the fixture composition declares. */
export const fixtureScope = 'contribution-report:acme/widget';

/** The two explicit contributor member keys selected by the M3 plan. */
export const memberKeys = ['person:ada', 'person:ben'] as const;

/** One explicit fixture member key. */
export type IFixtureMemberKey = (typeof memberKeys)[number];

/** Registration order used to prove order independence. */
export type IRegistrationOrder = 'ada-first' | 'ben-first';

/** Author-visible options that vary one fixture build without changing its structure. */
export interface IFixtureVariation {
  /** Order of member, input and helper registration. */
  readonly order?: IRegistrationOrder;
  /** Display labels that must never influence correspondence. */
  readonly labelPrefix?: string;
  /** Compatibility version for both summaries. */
  readonly summaryVersion?: number;
}

/** The complete opaque subject the author chooses for one member's activity. */
export function activitySubject(key: IFixtureMemberKey): string {
  return `activity:acme/widget:2026-Q1:${key}`;
}

/** The complete opaque subject the author chooses for one member's summary. */
export function summarySubject(key: IFixtureMemberKey): string {
  return `summary:acme/widget:2026-Q1:${key}`;
}

/** Fresh callbacks per build so no process-local function identity survives. */
export interface IMemberCallbacks {
  readonly activityRun: () => string;
  readonly activityFinality: () => boolean;
  readonly summaryRun: () => string;
}

/** Declarations and callbacks built for one member, retained so tests can check identity. */
export interface IBuiltMember {
  readonly key: IFixtureMemberKey;
  readonly callbacks: IMemberCallbacks;
  readonly activity: IAnySourceDeclaration<ITestFamily>;
  readonly summary: IAnyMemoDeclaration<ITestFamily>;
  readonly registration: IMemberRegistration<ITestFamily>;
}

/** Build one member with freshly allocated callbacks and declarations. */
export function buildMember(key: IFixtureMemberKey, variation: IFixtureVariation = {}): IBuiltMember {
  const callbacks: IMemberCallbacks = {
    activityRun: () => `fetch ${key}`,
    activityFinality: () => true,
    summaryRun: () => `summarize ${key}`,
  };
  const labelPrefix = variation.labelPrefix ?? 'Read';
  const activity = source<string>({
    subject: activitySubject(key),
    label: `${labelPrefix} activity for ${key}`,
    run: callbacks.activityRun,
    finality: callbacks.activityFinality,
  });
  const summary = memo({
    subject: summarySubject(key),
    label: `${labelPrefix} summary for ${key}`,
    version: variation.summaryVersion ?? 1,
    children: { activity },
    run: callbacks.summaryRun,
  });
  return {
    key,
    callbacks,
    activity,
    summary,
    registration: {
      key,
      steps: [
        { slot: 'activity', declaration: activity },
        { slot: 'summary', declaration: summary },
      ],
    },
  };
}

/** The fixture's author-owned builder arrays, retained to prove later mutation is inert. */
export interface IFixtureBuild {
  readonly options: ICompositionOptions<ITestFamily>;
  readonly composition: IComposition<ITestFamily>;
  readonly members: Readonly<Record<IFixtureMemberKey, IBuiltMember>>;
  readonly config: { window: string; repository: string };
  readonly format: (count: number) => string;
}

/** Compose both contributors with fresh allocations in the requested order. */
export function buildFixture(variation: IFixtureVariation = {}): IFixtureBuild {
  const ada = buildMember('person:ada', variation);
  const ben = buildMember('person:ben', variation);
  const config = { window: '[2026-01-01, 2026-04-01)', repository: 'acme/widget' };
  const format = (count: number): string => `${count}`;
  const summarize = (): string => 'summary';
  const benFirst = variation.order === 'ben-first';
  const options: ICompositionOptions<ITestFamily> = {
    scope: fixtureScope,
    inputs: [{ slot: 'config', value: config }],
    helpers: benFirst
      ? [{ slot: 'summarize', helper: summarize }, { slot: 'format', helper: format }]
      : [{ slot: 'format', helper: format }, { slot: 'summarize', helper: summarize }],
    members: benFirst ? [ben.registration, ada.registration] : [ada.registration, ben.registration],
  };
  return { options, composition: compose(options), members: { 'person:ada': ada, 'person:ben': ben }, config, format };
}
