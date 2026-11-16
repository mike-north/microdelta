/** SCD-1/2 source-call declarations preserve strict source outcomes and typed argument/previous views. */
import { expectError, expectType } from 'tsd';
import { authoring } from '../dist/api/microdelta.alpha.js';
import type { IPreviousResult, ISourceSlot, ISuppliedSourceDeclaration, ISuppliedSourceRegistration, ITrackedView } from '../dist/api/microdelta.alpha.js';

/** A separately addressed detail returned only through a source outcome. */
interface IDetail { readonly merged: boolean }
/** Current policy is a tracked application input. */
interface IInputs { readonly policy: { readonly refresh: boolean } }
type IHelpers = Record<never, never>;
type IParameters = readonly [string, { readonly policy: string }];
const api = authoring<IInputs, IHelpers>();
const detail = api.sourceSlot<IParameters, IDetail>({ slot: 'detail' });
expectType<ISourceSlot<IInputs, IHelpers, IParameters, IDetail>>(detail);
const implementation = api.suppliedSource<IParameters, IDetail>({
  finality: ({ args, previous, inputs }) => {
    expectType<string>(args[0]);
    expectType<ITrackedView<{ readonly policy: string }>>(args[1]);
    expectType<IPreviousResult<IDetail>>(previous);
    return previous.data.merged && !inputs.policy.refresh;
  },
  run: async ({ args, previous, outcome }) => {
    expectType<string>(args[0]);
    expectType<IPreviousResult<IDetail> | undefined>(previous);
    return previous === undefined ? outcome.fresh<IDetail>({ merged: false }) : outcome.retain(previous);
  },
});
expectType<ISuppliedSourceDeclaration<IInputs, IHelpers, IParameters, IDetail>>(implementation);
const registration = api.supplySource({ slot: detail, declaration: implementation, subject: ([id, argument]) => {
  expectType<string | undefined>(id);
  expectType<{ readonly policy: string } | undefined>(argument);
  return `detail:${String(id)}`;
} });
expectType<ISuppliedSourceRegistration<IInputs, IHelpers>>(registration);
expectType<'supplied-source'>(registration.declaration.kind);
const memoSlot = api.stepSlot<IParameters, IDetail>({ slot: 'memo' });
const memo = api.suppliedStep<IParameters, IDetail>({ run: () => ({ merged: false }) });
expectType<'supplied-step'>(api.supply({ slot: memoSlot, declaration: memo, subject: () => 'memo' }).declaration.kind);
expectError(api.supplySource({ slot: detail, declaration: memo, subject: () => 'wrong-kind' }));
expectError(api.supplySource({ slot: memoSlot, declaration: implementation, subject: () => 'wrong-kind' }));
expectError(api.supply({ slot: memoSlot, declaration: implementation, subject: () => 'wrong-kind' }));
expectError(api.suppliedSource<IParameters, IDetail>({ subject: 'not-owned', run: ({ outcome }) => outcome.fresh<IDetail>({ merged: false }) }));
expectError(api.suppliedSource<IParameters, IDetail>({ children: {}, run: ({ outcome }) => outcome.fresh<IDetail>({ merged: false }) }));
expectError(api.suppliedSource<IParameters, IDetail>({ run: async () => ({ merged: false }) }));
expectError(api.suppliedSource<IParameters, IDetail>({ run: ({ outcome }) => outcome.fresh<number>(1) }));
expectError(api.sourceSlot<readonly [string], number>({ slot: 'scalar-source' }));
const summary = api.memo({ subject: 'summary', children: { detail }, run: async ({ calls }) => {
  const value = await calls.detail('repo#101', { policy: 'derived' });
  return { merged: value.data.merged };
} });
declare const calls: Parameters<typeof summary.run>[0]['calls'];
expectError(calls.detail(101, { policy: 'wrong-id-type' }));
expectError(calls.detail('repo#101'));
expectError(calls.detail('repo#101', { policy: 1 }));
void calls.detail('repo#101', api.forward.input<{ readonly policy: string }>('policy'));
