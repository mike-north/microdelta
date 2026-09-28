/**
 * Generated-declaration consumer for Definition's alpha authoring surface.
 * A facade-shaped family composes Tracking's canonical views with Definition's
 * canonical declared-call handles, without Definition importing Tracking. The
 * capture rule treats direct source/memo callbacks as boundaries: context
 * parameters and canonical handles are accepted; raw external influences,
 * forged brands, same-spelled APIs and unsupported callback forms are not.
 *
 * @see ../../../../docs/tooling/tracked-captures.md
 * @see ../../../../docs/plans/m3-contribution-analysis.md (authoring shape)
 */
import {
  declarations,
  type IBindingFamily,
  type IDeclaredCallHandle,
  type IInvocationScope,
  type IPreviousCarrierFamily,
  type ITypeFamily,
} from '@microdelta/definition';
import type { ITracked, ITrackedView } from '@microdelta/tracking';
import { forgedHandle, memo as forgedMemo } from '../../forged/dist/api/forged.alpha.js';

/** Contributor activity as a source result. */
interface IActivity {
  readonly profile: { readonly name: string };
  readonly pulls: readonly { readonly merged: boolean }[];
  readonly reviews: number;
}

interface IViews extends ITypeFamily {
  readonly output: ITrackedView<this['input']>;
}
interface ICarrier<TData> {
  readonly data: ITrackedView<TData>;
}
interface ICarriers extends IPreviousCarrierFamily {
  readonly output: ICarrier<this['input']>;
}
interface IOutcomes extends ITypeFamily {
  readonly output: this['input'];
}
/** Current inputs and helpers supplied by the facade as canonical Tracking views. */
interface IBindings {
  readonly inputs: ITracked<{ readonly config: { readonly repository: string; readonly window: string } }>;
  readonly helpers: ITracked<{ readonly format: (name: string, authored: number, reviews: number) => string }>;
}
interface IFamily extends IBindingFamily {
  readonly views: IViews;
  readonly previous: ICarriers;
  readonly outcomes: IOutcomes;
  readonly source: IBindings;
  readonly memo: IBindings;
}
const { source, memo, compose } = declarations<IFamily>();

declare const fetchActivity: ITracked<(repository: string, key: string) => IActivity>;
declare const trackedLimit: ITracked<{ readonly value: number }>;
declare const externalThreshold: number;
declare const capturedHandle: IDeclaredCallHandle<ITrackedView<IActivity>>;
declare const liveScope: IInvocationScope;
declare function callbackFactory(): () => string;

// Positive: the M3 authoring shape uses only context parameters and tracked captures.
const activity = source<IActivity>({
  subject: 'activity:acme/widget:2026-Q1:person:ada',
  finality: ({ previous }) => previous.data.reviews > 0,
  run: ({ inputs }) => fetchActivity(inputs.config.repository, 'person:ada'),
});
const summary = memo({
  subject: 'summary:acme/widget:2026-Q1:person:ada',
  children: { activity },
  run: async ({ calls, helpers }) => {
    const { data } = await calls.activity();
    let merged = 0;
    for (let index = 0; index < data.pulls.length; index++) {
      merged += data.pulls[index]?.merged === true ? 1 : 0;
    }
    return helpers.format(data.profile.name, merged, Math.min(data.reviews, trackedLimit.value));
  },
});

/** A same-file function declaration is a supported direct callback form. */
function summarizeBen({ helpers }: IBindings): string {
  return helpers.format('Ben', 2, 3);
}
memo({ subject: 'summary:acme/widget:2026-Q1:person:ben', children: { activity }, run: summarizeBen });

// Positive: a canonical declared handle captured from outside is a handle, not raw data.
memo({ subject: 'summary:handle', run: async () => (await capturedHandle()).data.reviews });

// Same-spelled unrelated APIs do not create boundaries.
forgedMemo({ subject: 'summary:forged', run: () => externalThreshold });

memo({
  subject: 'summary:raw',
  // eslint-disable-next-line microdelta/tracked-captures -- An untracked captured scalar is a raw external influence.
  run: ({ helpers }) => helpers.format('Ada', externalThreshold, 0),
});

source<number>({
  subject: 'activity:raw-finality',
  run: () => 1,
  // eslint-disable-next-line microdelta/tracked-captures -- Source finality callbacks are capture boundaries too.
  finality: () => externalThreshold > 0,
});

memo({
  subject: 'summary:forged-handle',
  // eslint-disable-next-line microdelta/tracked-captures -- A look-alike handle brand conveys no Definition authority.
  run: async () => (await forgedHandle()).data,
});

memo({
  subject: 'summary:scope-family',
  // eslint-disable-next-line microdelta/tracked-captures -- Definition receivers are not whitelisted as a family; only canonical handles are.
  run: () => liveScope.open,
});

memo({
  subject: 'summary:factory',
  // eslint-disable-next-line microdelta/tracked-captures -- Callback factories are outside the direct-callback syntax.
  run: callbackFactory(),
});

compose({
  scope: 'contribution-report:acme/widget',
  members: [{ key: 'person:ada', steps: [{ slot: 'activity', declaration: activity }, { slot: 'summary', declaration: summary }] }],
});
