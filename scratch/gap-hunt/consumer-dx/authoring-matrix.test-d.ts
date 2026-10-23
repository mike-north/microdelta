/** Generated alpha positive and negative authoring contracts, without casts or suppressions. */
import { expectError, expectType } from 'tsd';
import { authoring, sourceOutcome } from 'microdelta';
import type { ISourceOutcome } from 'microdelta';
interface IRow { readonly key: string; readonly score: number }
interface IListing { readonly status: 'complete' | 'open'; readonly members: readonly IRow[] }
const api = authoring<Record<string, never>, Record<string, never>>();
expectType<ISourceOutcome<readonly IRow[]>>(sourceOutcome.fresh<readonly IRow[]>([{ key: 'ada', score: 3 }]));
const rows = api.source<readonly IRow[]>({ subject: 'rows', run: ({ previous, outcome }) => {
  if (previous === undefined) { return outcome.fresh<readonly IRow[]>([{ key: 'ada', score: 3 }]); }
  expectType<number>(previous.data.length);
  const selected = previous.data[0];
  if (selected !== undefined) { expectType<number>(selected.score); expectType<string>(selected.key); }
  expectError(previous.data.push({ key: 'ben', score: 1 }));
  expectError(previous.data.map((row: IRow) => row.score));
  return outcome.retain(previous);
} });
const tuple = api.memo({ subject: 'tuple', run: (): readonly [number, string] => [3, 'ada'] });
api.memo({ subject: 'consumer', children: { rows, tuple }, run: async ({ calls }) => {
  const values = (await calls.rows()).data;
  const pair = (await calls.tuple()).data;
  expectType<2>(pair.length);
  expectType<number>(pair[0]);
  expectType<string>(pair[1]);
  expectError(pair.push(4));
  expectError(calls.rows('extra'));
  expectError(calls.absent());
  return { size: values.length };
} });
const listing = api.source<IListing>({ subject: 'listing', collection: { identity: 'key' }, run: ({ outcome }) => outcome.fresh<IListing>({ status: 'complete', members: [] }) });
api.template({ slot: 'person', collection: listing, gate: ({ member }) => {
  expectType<string>(member.key);
  expectType<number>(member.score);
  return member.score > 0;
}, steps: member => ({ summary: member.memo({ subject: member.subject('summary'), run: ({ member: bound }) => ({ value: bound.score }) }) }) });
expectError(api.source<IListing>({ subject: 'bad-id', collection: { identity: 'score' }, run: ({ outcome }) => outcome.fresh<IListing>({ status: 'complete', members: [] }) }));
expectError(api.template({ slot: 'async-gate', collection: listing, gate: async () => true, steps: () => ({}) }));
expectError(api.template({ slot: 'number-gate', collection: listing, gate: () => 1, steps: () => ({}) }));
expectError(api.source<IRow>({ subject: 'raw-envelope', run: () => ({ kind: 'fresh', data: { key: 'ada', score: 3 } }) }));
expectError(api.source<IRow>({ subject: 'wrong-envelope', run: ({ outcome }) => outcome.fresh({ key: 'ada', score: '3' }) }));
expectError(sourceOutcome.retain({ data: { key: 'ada', score: 3 } }));

// COL-1 no-identity records can declare a custom strategy, but cannot mark their source collection.
interface INumericMember { readonly id: number; readonly score: number }
interface INumericListing { readonly status: 'complete'; readonly members: readonly INumericMember[] }
const numeric = api.source<INumericListing>({ subject: 'numeric', run: ({ outcome }) => outcome.fresh<INumericListing>({ status: 'complete', members: [{ id: 7, score: 3 }] }) });
api.template({ slot: 'numeric', collection: numeric, key: member => `id:${member.id}`, steps: () => ({}) });
expectError(api.source<INumericListing>({ subject: 'numeric-marker', collection: {}, run: ({ outcome }) => outcome.fresh<INumericListing>({ status: 'complete', members: [] }) }));
expectError(api.source<INumericListing>({ subject: 'numeric-identity', collection: { identity: 'id' }, run: ({ outcome }) => outcome.fresh<INumericListing>({ status: 'complete', members: [] }) }));
