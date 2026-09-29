/**
 * Type contracts for keyed collections, fanout templates, gates and strict
 * folds: only a keyed collection result may declare a designated identity,
 * and only a string field may be it; a template's custom key and gate see the
 * collection's member type (the gate through the facade's view); member steps
 * take only symbolic member subjects; a fold names a declared template step
 * and sees explicit keyed entries whose data exists only on succeeded ones.
 *
 * @see ../../../docs/spec/composition.md (CMP-4, CMP-8, EXP-4 selections)
 * @see ../../../docs/spec/tracking.md (COL-1)
 * @see ../../../docs/plans/m4-composition.md (Authoring shape)
 */
import { expectAssignable, expectError, expectNotAssignable, expectType } from 'tsd';

import {
  declarations,
  gateOutcome,
  type IBindingDescriptor,
  type IBindingFamily,
  type ICollectionResult,
  type IFoldEntry,
  type IGateInvocation,
  type IGateOutcome,
  type IIdentityField,
  type IInvocation,
  type IKeyedSnapshot,
  type IMemberBinding,
  type IMemberOf,
  type IMemberSupplier,
  type IMemberSubject,
  type IPreviousCarrierFamily,
  type ISourceDeclaration,
  type IResultOf,
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
  readonly memo: { readonly minimumAuthored: number };
}

const { source, template, fold, compose, openInvocation, gateOf, stepSlot } = declarations<IFamily>();

interface IContributor {
  readonly key?: string;
  readonly id: string;
  readonly authored: number;
  readonly aliases: readonly string[];
}
type IContributors = ICollectionResult<IContributor>;

// Designated identity: only string fields of the member record.
declare const contributorIdentity: IIdentityField<IContributor>;
declare const numericIdentity: IIdentityField<{ readonly count: number }>;
declare const emptyIdentity: IIdentityField<Record<never, never>>;
declare const nestedIdentity: IIdentityField<{ readonly nested: { readonly key: string } }>;
declare const intersectionIdentity: IIdentityField<{ readonly a: string } & { readonly b: number }>;
expectType<'key' | 'id'>(contributorIdentity);
expectType<never>(numericIdentity);
expectType<never>(emptyIdentity);
expectType<never>(nestedIdentity);
expectType<'a'>(intersectionIdentity);

const contributors = source<IContributors>({
  subject: 'contributors',
  collection: { identity: 'key' },
  run: () => ({ kind: 'fresh', data: { members: [], status: 'open' } }),
});
declare const collectionMember: IMemberOf<IFamily, typeof contributors>;
expectType<IContributor>(collectionMember);
expectError(source<IContributors>({ subject: 'c', collection: { identity: 'authored' }, run: () => ({ kind: 'retain' }) }));
expectError(source<IContributors>({ subject: 'c', collection: { identity: 'absent' }, run: () => ({ kind: 'retain' }) }));
expectError(source<{ readonly total: number }>({ subject: 'c', collection: { identity: 'total' }, run: () => ({ kind: 'retain' }) }));
expectError(source<IContributors>({ subject: 'c', collection: { identity: 'key' }, run: () => ({ kind: 'fresh', data: { members: [], status: 'closed' } }) }));

const plain = source<{ readonly total: number }>({ subject: 'plain', run: () => ({ kind: 'retain' }) });
declare const plainMember: IMemberOf<IFamily, typeof plain>;
expectType<never>(plainMember);

// Templates: the custom key sees the raw member record; the gate sees memo bindings plus the member view.
const contributor = template({
  slot: 'contributor',
  collection: contributors,
  key: (member) => {
    expectType<IContributor>(member);
    return member.id;
  },
  gate: ({ member, minimumAuthored }) => {
    expectType<IView<IContributor>>(member);
    return member.authored >= minimumAuthored;
  },
  steps: (member) => {
    expectType<IMemberSubject>(member.subject('activity'));
    const activity = member.source<{ readonly authored: number }>({
      subject: member.subject('activity'),
      run: () => ({ kind: 'fresh', data: { authored: 1 } }),
    });
    const summary = member.memo({
      subject: member.subject('summary'),
      children: { activity },
      run: async ({ calls }) => {
        const { data } = await calls.activity();
        expectType<IView<{ readonly authored: number }>>(data);
        return { sentence: `${data.authored}` };
      },
    });
    return { activity, summary };
  },
});
expectType<ISourceDeclaration<IFamily, { readonly authored: number }, IMemberBinding<IFamily, IContributor>>>(contributor.steps.activity);
declare const summaryResult: IResultOf<IFamily, typeof contributor.steps.summary>;
declare const activityResult: IResultOf<IFamily, typeof contributor.steps.activity>;
expectType<{ sentence: string }>(summaryResult);
expectType<{ readonly authored: number }>(activityResult);

// A template needs a keyed collection source; gates are synchronous booleans; member subjects are symbolic.
expectError(template({ slot: 't', collection: plain, steps: (member) => ({ p: member.source<number>({ subject: member.subject('p'), run: () => ({ kind: 'retain' }) }) }) }));
expectError(template({ slot: 't', collection: contributors, gate: () => 'yes', steps: (member) => ({ p: member.source<number>({ subject: member.subject('p'), run: () => ({ kind: 'retain' }) }) }) }));
expectError(template({ slot: 't', collection: contributors, gate: async () => true, steps: (member) => ({ p: member.source<number>({ subject: member.subject('p'), run: () => ({ kind: 'retain' }) }) }) }));
expectError(template({ slot: 't', collection: contributors, key: (member) => member.authored, steps: (member) => ({ p: member.source<number>({ subject: member.subject('p'), run: () => ({ kind: 'retain' }) }) }) }));
expectError(template({ slot: 't', collection: contributors, steps: (member) => ({ p: member.source<number>({ subject: 'plain:subject', run: () => ({ kind: 'retain' }) }) }) }));
expectNotAssignable<IMemberSubject>({ prefix: 'forged' });

// Folds name a declared step and see explicit entries; data exists only on succeeded entries.
const report = fold({
  subject: 'report',
  over: { template: contributor, step: 'summary' },
  run: ({ members, minimumAuthored }) => {
    expectType<number>(minimumAuthored);
    expectType<readonly IFoldEntry<IView<{ sentence: string }>>[]>(members);
    return members.map((entry) => {
      expectType<string>(entry.key);
      return entry.status === 'succeeded' ? entry.data.sentence : `${entry.key} skipped`;
    });
  },
});
expectType<string[]>(report.run({ minimumAuthored: 1, members: [] }));
expectError(fold({ subject: 'r', over: { template: contributor, step: 'assessment' }, run: () => 1 }));
// eslint-disable-next-line @typescript-eslint/no-unsafe-return -- This negative tsd case intentionally reads data before narrowing to a succeeded entry.
expectError(fold({ subject: 'r', over: { template: contributor, step: 'summary' }, run: ({ members }) => members.map((entry) => entry.data) }));

declare const skipped: IFoldEntry<string> & { readonly status: 'skipped' };
expectError(skipped.data);

// Compositions accept composition-level steps and templates; invocations include folds.
const composition = compose({
  scope: 'report',
  steps: [{ slot: 'contributors', declaration: contributors }, { slot: 'report', declaration: report }],
  templates: [contributor],
});
declare const port: Parameters<typeof openInvocation>[2];
const invocation: IInvocation<IFamily> = openInvocation(composition, { scope: 'report', role: 'step', slot: 'report' }, port);
if (invocation.kind === 'fold') {
  expectType<IBindingDescriptor>(invocation.over);
}
expectType<IKeyedSnapshot>(composition.keyMembers('contributor', {}));
expectAssignable<IBindingDescriptor>({ scope: 's', role: 'step', slot: 'summary', template: 'contributor', collection: 'contributors', memberKey: 'person:ada' });
expectError<IBindingDescriptor>({ scope: 's', role: 'step', slot: 'summary', template: 7 });

// Gate outcomes are a closed union.
expectType<IGateOutcome>(gateOutcome({ kind: 'returned', value: false }));
expectError(gateOutcome({ kind: 'resolved', value: false }));

// Gates are opened per instance descriptor, like invocations.
const instance: IBindingDescriptor = { scope: 'report', role: 'step', slot: 'summary', template: 'contributor', collection: 'contributors', memberKey: 'person:ada' };
expectType<IGateInvocation<IFamily> | undefined>(gateOf(composition, instance));
expectError(gateOf(composition, 'contributor'));
declare const supplier: IMemberSupplier<IFamily>;
expectType<IView<IContributor>>(supplier.view(contributors, instance));
expectError(supplier.view(contributors));

// Member memos may name sibling member sources and memos and a supplied step slot.
const assessor = stepSlot<readonly [number], { readonly score: number }>({ slot: 'assessor' });
template({
  slot: 'nested',
  collection: contributors,
  steps: (member) => {
    const activity = member.source<{ readonly authored: number }>({ subject: member.subject('nested-activity'), run: () => ({ kind: 'retain' }) });
    const profile = member.memo({ subject: member.subject('nested-profile'), children: { activity }, run: () => 'profile' });
    const summary = member.memo({
      subject: member.subject('nested-summary'),
      children: { activity, profile, assess: assessor },
      run: async ({ calls }) => {
        const { data: profileView } = await calls.profile();
        expectType<IView<string>>(profileView);
        const { data: assessment } = await calls.assess(1);
        return assessment.score;
      },
    });
    return { activity, profile, summary };
  },
});

// Member steps receive the member binding: the facade's view of the member's
// current keyed record, typed from the collection's member type. Ordinary
// sources and memos (including explicit M3 members) have no member binding.
template({
  slot: 'bound',
  collection: contributors,
  steps: (member) => {
    const activity = member.source<{ readonly owner: string }>({
      subject: member.subject('bound-activity'),
      finality: ({ member: bound, previous }) => {
        expectType<IView<IContributor>>(bound);
        return previous.data.owner === bound.id;
      },
      run: ({ member: bound, repository }) => {
        expectType<IView<IContributor>>(bound);
        expectType<string>(repository);
        return { kind: 'fresh', data: { owner: bound.id } };
      },
    });
    const summary = member.memo({
      subject: member.subject('bound-summary'),
      children: { activity },
      run: async ({ member: bound, calls }) => {
        expectType<number>(bound.authored);
        const { data } = await calls.activity();
        expectType<IView<{ readonly owner: string }>>(data);
        return { owner: data.owner, authored: bound.authored };
      },
    });
    expectError(member.memo({
      subject: member.subject('bound-typo'),
      run: ({ member: bound }) => {
        void bound.missing;
        return 1;
      },
    }));
    return { activity, summary };
  },
});
declare const binding: IMemberBinding<IFamily, IContributor>;
expectType<IView<IContributor>>(binding.member);
source<{ readonly total: number }>({
  subject: 'unbound-source',
  run: (context) => {
    expectError(context.member);
    return { kind: 'retain' };
  },
});
