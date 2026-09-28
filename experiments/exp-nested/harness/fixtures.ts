/**
 * Retained-result fixtures for the nested selected-read gate. The activity
 * record follows the M3 contributor-summary fixture decisions (Ada: PRs 101
 * and 102 merged, 103 open, five submitted reviews) with deliberately unread
 * profile, label and note payload. The domain record exercises the supported
 * Value domain beyond those fields: holes versus present undefined, custom
 * prototypes, Property versus Index segments, key order and numeric edges.
 */

/** Size of the unread note payload; large enough that an accidental root read is conspicuous. */
export const unreadNoteBytes = 1_000_000;

/** One authored pull request as retained by the activity source. */
export interface IPullRequestRecord {
  readonly number: number;
  readonly createdAt: string;
  readonly merged: boolean;
  readonly labels: readonly string[];
}

/** One submitted review as retained by the activity source. */
export interface IReviewRecord {
  readonly id: string;
  readonly pullRequest: number;
  readonly state: string;
}

/** Contributor activity as retained by one source result. */
export interface IActivityRecord {
  readonly contributor: string;
  readonly profile: { readonly id: string; readonly name: string; readonly avatarUrl: string };
  readonly pullRequests: readonly IPullRequestRecord[];
  readonly reviews: readonly IReviewRecord[];
  readonly notes: string;
}

/** Variations of the retained activity used to exercise consumed and unread changes. */
export interface IActivityVariation {
  readonly name?: string;
  readonly avatarUrl?: string;
  readonly labels?: readonly string[];
  readonly notes?: string;
  readonly merged?: readonly boolean[];
}

/** Build Ada's retained activity, optionally varied. */
export function activity(variation: IActivityVariation = {}): IActivityRecord {
  const merged = variation.merged ?? [true, true, false];
  return {
    contributor: 'person:ada',
    profile: {
      id: 'gh:1001',
      name: variation.name ?? 'Ada',
      avatarUrl: variation.avatarUrl ?? 'https://example.invalid/avatars/ada.png',
    },
    pullRequests: merged.map((isMerged, position) => ({
      number: 101 + position,
      createdAt: `2026-01-${String(10 + position)}`,
      merged: isMerged,
      labels: [...(variation.labels ?? ['area:docs', 'size:large'])],
    })),
    reviews: [1, 2, 3, 4, 5].map((position) => ({ id: `review:${String(position)}`, pullRequest: 200 + position, state: 'submitted' })),
    notes: variation.notes ?? 'n'.repeat(unreadNoteBytes),
  };
}

/** The declared author view of the Value-domain edge record. */
export interface IDomainView {
  readonly ordered: { readonly zeta: number; readonly alpha: number; readonly mid: number };
  readonly sparse: readonly unknown[];
  readonly present: readonly unknown[];
  readonly child: { readonly own: string; readonly inherited: string; readonly shadowed: string; readonly depth: string; readonly box: { readonly label: string } };
  readonly bare: { readonly only: string };
  readonly record: { readonly '0': string; readonly 'a.b': string };
  readonly list: readonly string[];
  readonly numbers: { readonly notANumber: number; readonly negativeZero: number; readonly infinity: number };
  readonly nothing: null;
  readonly then: string;
}

/** The supported-domain edge record; built fresh because it contains prototypes and holes. */
export function domainRecord(): IDomainView {
  const grandparent = { depth: 'grandparent', shadowed: 'grandparent value' };
  const parent = Object.create(grandparent) as { inherited: string; shadowed: string; box: { readonly label: string } };
  parent.inherited = 'from prototype';
  parent.shadowed = 'parent value';
  parent.box = { label: 'inherited box' };
  const child = Object.create(parent) as { own: string } & IDomainView['child'];
  child.own = 'own value';
  const bare = Object.create(null) as { only: string };
  bare.only = 'null prototype';
  const sparse: unknown[] = new Array<unknown>(4);
  sparse[0] = 'first';
  sparse[3] = 'last';
  return {
    ordered: { zeta: 1, alpha: 2, mid: 3 },
    sparse,
    present: ['first', undefined, 'third'],
    child,
    bare,
    record: { '0': 'property zero', 'a.b': 'dotted key' },
    list: ['index zero'],
    numbers: { notANumber: Number.NaN, negativeZero: -0, infinity: Number.POSITIVE_INFINITY },
    nothing: null,
    then: 'legitimate author field',
  };
}

/** Result keys published by the `publish` command, with what each variation changes. */
export const publishedResults = {
  /** Ada's baseline activity. */
  base: activity(),
  /** Consumed change: the profile name. */
  renamed: activity({ name: 'Ada Lovelace' }),
  /** Unread-only change: avatar, labels and notes. */
  unreadOnly: activity({ avatarUrl: 'https://example.invalid/avatars/new.png', labels: ['area:api'], notes: 'short notes' }),
  /** Consumed change: one merged status. */
  mergedChanged: activity({ merged: [true, false, false] }),
  /** Container-kind change: the profile becomes an array. */
  profileArray: { ...activity(), profile: ['Ada'] },
  /** Container-kind change: the consumed name becomes a record. */
  nameRecord: { ...activity(), profile: { id: 'gh:1001', name: { given: 'Ada' }, avatarUrl: 'https://example.invalid/avatars/ada.png' } },
  /** The supported Value-domain edge record. */
  domain: domainRecord(),
} as const;

/** The published result names. */
export type IPublishedName = keyof typeof publishedResults;
