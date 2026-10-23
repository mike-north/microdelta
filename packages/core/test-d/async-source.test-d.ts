/**
 * Source callbacks may finish their trusted outcome after awaited work while
 * keeping the declared payload, member, and previous-carrier types precise.
 * RES-004 and REUSE-004 require explicit fresh and retain controls.
 */
import { expectError, expectType } from 'tsd';

import { authoring } from '../dist/api/microdelta.alpha.js';
import type { IMemberBuilder, IPreviousResult, ISourceOutcome, ISourceOutcomes } from '../dist/api/microdelta.alpha.js';

/** The supported record-shaped source result used by every positive control. */
interface IValue { readonly value: number }

/** The keyed collection member whose binding must survive an await. */
interface IMember { readonly key: string }

/** A complete one-member listing for the template builder. */
interface IListing { readonly status: 'complete'; readonly members: readonly IMember[] }

const api = authoring<Record<string, never>, Record<string, never>>();

// Existing synchronous callbacks remain source-compatible.
api.source<IValue>({ subject: 'sync', run: ({ outcome, previous }) => previous === undefined
  ? outcome.fresh<IValue>({ value: 1 }) : outcome.retain(previous) });

api.source<IValue>({ subject: 'async-fresh', run: async ({ outcome }) => {
  return outcome.fresh({ value: 1 });
} });
api.source<IValue>({ subject: 'async-retain', run: async ({ outcome, previous }) => {
  return previous === undefined ? outcome.fresh<IValue>({ value: 1 }) : outcome.retain(previous);
} });
declare const constructors: ISourceOutcomes;
expectType<ISourceOutcome<{ value: number }>>(constructors.fresh({ value: 1 }));

const listing = api.source<IListing>({
  subject: 'listing', collection: { identity: 'key' },
  run: ({ outcome }) => outcome.fresh<IListing>({ status: 'complete', members: [{ key: 'one' }] }),
});
const memberTemplate = api.template({ slot: 'member', collection: listing, steps: (member) => ({
  fresh: member.source<IValue>({ subject: member.subject('fresh'), run: async ({ outcome, member: bound }) => {
    return outcome.fresh({ value: bound.key.length });
  } }),
  retain: member.source<IValue>({ subject: member.subject('retain'), run: async ({ outcome, previous, member: bound }) => {
    return previous === undefined ? outcome.fresh<IValue>({ value: bound.key.length }) : outcome.retain(previous);
  } }),
}) });
declare const inferredMemberContext: Parameters<typeof memberTemplate.steps.fresh.run>[0];
expectType<IPreviousResult<IValue> | undefined>(inferredMemberContext.previous);
expectType<string>(inferredMemberContext.member.key);

// A Promise does not relax the result type or grant authority to forge an envelope.
expectError(api.source<IValue>({ subject: 'wrong-promised-payload', run: async ({ outcome }) => outcome.fresh<number>(1) }));
expectError(api.source<IValue>({ subject: 'wrong-promised-envelope', run: async () => ({ kind: 'fresh', data: { value: 1 } }) }));
expectError(api.source<IValue>({ subject: 'wrong-synchronous-envelope', run: () => ({ kind: 'fresh', data: { value: 1 } }) }));
expectError(api.source<IValue>({ subject: 'wrong-synchronous-payload', run: ({ outcome }) => outcome.fresh<IValue>(1) }));
declare const memberBuilder: IMemberBuilder<Record<string, never>, Record<string, never>, IMember>;
expectError(memberBuilder.source<IValue>({ subject: memberBuilder.subject('wrong-promised-payload'), run: async ({ outcome }) => outcome.fresh<number>(1) }));
expectError(memberBuilder.source<IValue>({ subject: memberBuilder.subject('wrong-promised-envelope'), run: async () => ({ kind: 'fresh', data: { value: 1 } }) }));
declare const forged: { readonly kind: 'retain'; readonly previous: IPreviousResult<IValue> };
expectError(((): ISourceOutcome<IValue> => forged)());
