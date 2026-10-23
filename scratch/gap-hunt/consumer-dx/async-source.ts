/** Generated-alpha consumer: network-style source checks can finish after an await. */
import { authoring } from 'microdelta';
interface IValue { readonly value: number }
const api = authoring<Record<string, never>, Record<string, never>>();
// Positive controls use the same object payload and trusted retention carrier.
api.source<IValue>({ subject: 'sync-fresh', run: ({ outcome }) => outcome.fresh<IValue>({ value: 1 }) });
api.source<IValue>({ subject: 'sync-retain', run: ({ outcome, previous }) => previous === undefined ? outcome.fresh<IValue>({ value: 1 }) : outcome.retain(previous) });
api.source<IValue>({ subject: 'async-fresh', run: async ({ outcome }) => { await Promise.resolve(); return outcome.fresh<IValue>({ value: 1 }); } });
api.source<IValue>({ subject: 'async-retain', run: async ({ outcome, previous }) => { await Promise.resolve(); return previous === undefined ? outcome.fresh<IValue>({ value: 1 }) : outcome.retain(previous); } });
interface IMember { readonly key: string }
interface IListing { readonly status: 'complete'; readonly members: readonly IMember[] }
const listing = api.source<IListing>({ subject: 'listing', collection: { identity: 'key' }, run: ({ outcome }) => outcome.fresh<IListing>({ status: 'complete', members: [{ key: 'one' }] }) });
api.template({ slot: 'member', collection: listing, steps: member => ({
  fresh: member.source<IValue>({ subject: member.subject('fresh'), run: async ({ outcome }) => { await Promise.resolve(); return outcome.fresh<IValue>({ value: 1 }); } }),
  retain: member.source<IValue>({ subject: member.subject('retain'), run: async ({ outcome, previous }) => { await Promise.resolve(); return previous === undefined ? outcome.fresh<IValue>({ value: 1 }) : outcome.retain(previous); } }),
}) });
