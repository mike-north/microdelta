/** Explicit keys preserve exact generated-alpha member inference and reject unsupported strategies. */
import { expectError, expectType } from 'tsd';
import { authoring } from '../../../packages/core/dist/api/microdelta.alpha.js';
interface IMember { readonly id: number; readonly score: number }
interface IListing { readonly members: readonly IMember[]; readonly status: 'complete' | 'open' }
const api = authoring<Record<string, never>, Record<string, never>>();
const collection = api.source<IListing>({ subject: 'listing', run: ({ outcome }) => outcome.fresh<IListing>({ members: [], status: 'complete' }) });
api.template({ slot: 'precise', collection,
  key: member => { expectType<IMember>(member); return `id:${member.id}`; },
  gate: ({ member }) => { expectType<number>(member.score); expectError(member.absent); return true; },
  steps: member => ({ score: member.memo({ subject: member.subject('score'), run: ({ member: bound }) => { expectType<number>(bound.id); expectType<number>(bound.score); expectError(bound.absent); return bound.score; } }) }),
});
expectError(api.template({ slot: 'number-key', collection, key: member => member.id, steps: () => ({}) }));
expectError(api.template({ slot: 'undefined-key', collection, key: () => undefined, steps: () => ({}) }));
expectError(api.template({ slot: 'object-key', collection, key: () => ({ id: 'x' }), steps: () => ({}) }));
expectError(api.template({ slot: 'promise-key', collection, key: () => Promise.resolve('x'), steps: () => ({}) }));
const scalar = api.source<number>({ subject: 'scalar', run: ({ outcome }) => outcome.fresh(1) });
expectError(api.template({ slot: 'scalar', collection: scalar, key: () => 'x', steps: () => ({}) }));
expectError(api.template({ slot: 'native-key', collection, key: () => new Date(), steps: () => ({}) }));
