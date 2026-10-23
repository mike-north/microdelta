/**
 * Current-alpha completed results have a record or array root. Scalar atoms
 * remain supported inside those roots, including present undefined; the
 * generated facade must reject unsupported roots before author work runs.
 *
 * @see ../../../docs/spec/tracking.md (VAL-2 and M3 nested selected-read decision)
 * @see ../../../docs/spec/composition.md (CMP-8)
 * @see https://github.com/mike-north/microdelta/issues/156
 */
import { expectError, expectType } from 'tsd';

import { authoring, sourceOutcome, type ICollectionResult, type ISourceOutcomes, type ISourceOutcome } from '../dist/api/microdelta.alpha.js';

/** A named record result has no index signature and must remain authorable. */
interface IWrapped<T> { readonly value: T }
/** Outcome capability annotation breaks the preexisting context/result inference cycle. */
interface IOutcomeContext { readonly outcome: ISourceOutcomes }
/** A result may choose either supported container shape. */
type IContainerChoice = IWrapped<number> | readonly number[];
/** The keyed source itself is a supported record-root result. */
interface IMember { readonly key: string }
/** A noncallable then field is ordinary author data, not a reserved key. */
interface IThenMetadata { readonly then: string; readonly value: number }

const builders = authoring<Record<string, never>, Record<string, never>>();

// Explicit generic and inferred source results reject every bare Value atom.
expectError(builders.source<string>({ subject: 'string-source', run: ({ outcome }: IOutcomeContext) => outcome.fresh('ready') }));
expectError(builders.source<number>({ subject: 'number-source', run: ({ outcome }: IOutcomeContext) => outcome.fresh(1) }));
expectError(builders.source<boolean>({ subject: 'boolean-source', run: ({ outcome }: IOutcomeContext) => outcome.fresh(true) }));
expectError(builders.source<null>({ subject: 'null-source', run: ({ outcome }: IOutcomeContext) => outcome.fresh(null) }));
expectError(builders.source<undefined>({ subject: 'undefined-source', run: ({ outcome }: IOutcomeContext) => outcome.fresh(undefined) }));
expectError(builders.source({ subject: 'inferred-string-source', run: ({ outcome }: IOutcomeContext) => outcome.fresh('ready') }));
expectError(builders.source({ subject: 'inferred-number-source', run: ({ outcome }: IOutcomeContext) => outcome.fresh(1) }));
expectError(builders.source({ subject: 'inferred-boolean-source', run: ({ outcome }: IOutcomeContext) => outcome.fresh(true) }));
expectError(builders.source({ subject: 'inferred-null-source', run: ({ outcome }: IOutcomeContext) => outcome.fresh(null) }));
expectError(builders.source({ subject: 'inferred-undefined-source', run: ({ outcome }: IOutcomeContext) => outcome.fresh(undefined) }));
expectError(builders.source<string>({ subject: 'promised-string-source', run: async ({ outcome }: IOutcomeContext) => outcome.fresh('ready') }));

// Memos validate their settled result, so a Promise is not a scalar-root escape.
expectError(builders.memo<Record<never, never>, string>({ subject: 'string-memo', run: () => 'ready' }));
expectError(builders.memo<Record<never, never>, number>({ subject: 'number-memo', run: () => 1 }));
expectError(builders.memo<Record<never, never>, boolean>({ subject: 'boolean-memo', run: () => true }));
expectError(builders.memo<Record<never, never>, null>({ subject: 'null-memo', run: () => null }));
expectError(builders.memo<Record<never, never>, undefined>({ subject: 'undefined-memo', run: () => undefined }));
expectError(builders.memo({ subject: 'inferred-string-memo', run: () => 'ready' }));
expectError(builders.memo({ subject: 'inferred-number-memo', run: () => 1 }));
expectError(builders.memo({ subject: 'inferred-boolean-memo', run: () => true }));
expectError(builders.memo({ subject: 'inferred-null-memo', run: () => null }));
expectError(builders.memo({ subject: 'inferred-undefined-memo', run: () => undefined }));
expectError(builders.memo({ subject: 'promised-string-memo', run: async () => 'ready' }));
expectError(builders.memo({ subject: 'promised-null-memo', run: async () => null }));

// A union containing an unsupported success root cannot promise a valid result.
expectError(builders.source<IWrapped<number> | string>({ subject: 'mixed-source', run: ({ outcome }: IOutcomeContext) => outcome.fresh<IWrapped<number> | string>({ value: 1 }) }));
expectError(builders.memo({ subject: 'mixed-memo', run: (): IWrapped<number> | string => 'ready' }));
expectError(builders.memo({ subject: 'promised-mixed-memo', run: async (): Promise<IWrapped<number> | string> => 'ready' }));

const collection = builders.source<ICollectionResult<IMember>>({
  subject: 'members', collection: { identity: 'key' },
  run: ({ outcome }: IOutcomeContext) => outcome.fresh<ICollectionResult<IMember>>({ status: 'complete', members: [{ key: 'a' }] }),
});
builders.template({ slot: 'members', collection, steps: member => {
  expectError(member.source<string>({ subject: member.subject('scalar-source'), run: ({ outcome }: IOutcomeContext) => outcome.fresh('ready') }));
  expectError(member.memo({ subject: member.subject('scalar-memo'), run: () => 'ready' }));
  return { wrapped: member.memo({ subject: member.subject('wrapped-memo'), run: () => ({ value: 'ready' }) }) };
} });

// These positive controls keep exact inferred data and legal Promise signatures.
const namedSource = builders.source<IWrapped<number>>({ subject: 'named-source', run: ({ outcome }: IOutcomeContext) => outcome.fresh({ value: 1 }) });
// The imported constructor isolates TResult inference; actual author callbacks use context.outcome.
// eslint-disable-next-line microdelta/tracked-captures -- This type-only control intentionally uses the imported constructor to check inference independently of the context/result cycle.
const constructorSource = builders.source({ subject: 'constructor-source', run: () => sourceOutcome.fresh({ value: undefined }) });
const inferredSource = builders.source({ subject: 'inferred-source', run: ({ outcome }: IOutcomeContext) => outcome.fresh({ value: undefined }) });
const asyncSource = builders.source<IWrapped<number>>({ subject: 'async-source', run: async ({ outcome }: IOutcomeContext) => outcome.fresh({ value: 1 }) });
const arraySource = builders.source<readonly number[]>({ subject: 'array-source', run: ({ outcome }: IOutcomeContext) => outcome.fresh<readonly number[]>([1, 2]) });
const namedMemo = builders.memo({ subject: 'named-memo', run: (): IWrapped<number> => ({ value: 1 }) });
const inferredMemo = builders.memo({ subject: 'inferred-memo', run: () => ({ value: undefined }) });
const asyncMemo = builders.memo({ subject: 'async-memo', run: async () => ({ value: 1 }) });
const arrayMemo = builders.memo({ subject: 'array-memo', run: (): readonly number[] => [1, 2] });
const unionMemo = builders.memo({ subject: 'union-memo', run: (): IContainerChoice => ({ value: 1 }) });
const thenSource = builders.source<IThenMetadata>({ subject: 'then-source', run: ({ outcome }: IOutcomeContext) => outcome.fresh({ then: 'metadata', value: 1 }) });
const thenMemo = builders.memo({ subject: 'then-memo', run: (): IThenMetadata => ({ then: 'metadata', value: 1 }) });
const numericThenMemo = builders.memo({ subject: 'numeric-then-memo', run: () => ({ then: 1, value: true }) });
const mixedSyncAsyncMemo = builders.memo({ subject: 'mixed-sync-async-memo', run: (): IWrapped<number> | Promise<IWrapped<number>> => ({ value: 1 }) });
const explicitPromiseMemo = builders.memo<Record<never, never>, Promise<IWrapped<number>>>({ subject: 'explicit-promise-memo', run: async () => ({ value: 1 }) });

/** A generic adapter may lift any supported scalar atom into a record root. */
function wrapMemo<T>() {
  const genericBuilders = authoring<{ readonly value: T }, Record<string, never>>();
  return genericBuilders.memo({ subject: 'generic-wrapper', run: ({ inputs }) => ({ value: inputs.value }) });
}
const genericWrapper = wrapMemo<string>();

declare const constructorSourceResult: Awaited<ReturnType<typeof constructorSource.run>>;
declare const namedSourceResult: Awaited<ReturnType<typeof namedSource.run>>;
declare const inferredSourceResult: Awaited<ReturnType<typeof inferredSource.run>>;
declare const asyncSourceResult: Awaited<ReturnType<typeof asyncSource.run>>;
declare const arraySourceResult: Awaited<ReturnType<typeof arraySource.run>>;
declare const namedMemoResult: Awaited<ReturnType<typeof namedMemo.run>>;
declare const inferredMemoResult: Awaited<ReturnType<typeof inferredMemo.run>>;
declare const asyncMemoResult: Awaited<ReturnType<typeof asyncMemo.run>>;
declare const arrayMemoResult: Awaited<ReturnType<typeof arrayMemo.run>>;
declare const unionMemoResult: Awaited<ReturnType<typeof unionMemo.run>>;
declare const thenSourceResult: Awaited<ReturnType<typeof thenSource.run>>;
declare const thenMemoResult: Awaited<ReturnType<typeof thenMemo.run>>;
declare const numericThenMemoResult: Awaited<ReturnType<typeof numericThenMemo.run>>;
declare const mixedSyncAsyncMemoResult: Awaited<ReturnType<typeof mixedSyncAsyncMemo.run>>;
declare const explicitPromiseMemoResult: Awaited<ReturnType<typeof explicitPromiseMemo.run>>;
declare const genericWrapperResult: Awaited<ReturnType<typeof genericWrapper.run>>;
expectType<ISourceOutcome<{ value: undefined }>>(constructorSourceResult);
expectType<ISourceOutcome<IWrapped<number>>>(namedSourceResult);
expectType<ISourceOutcome<{ value: undefined }>>(inferredSourceResult);
expectType<ISourceOutcome<IWrapped<number>>>(asyncSourceResult);
expectType<ISourceOutcome<readonly number[]>>(arraySourceResult);
expectType<IWrapped<number>>(namedMemoResult);
expectType<{ value: undefined }>(inferredMemoResult);
expectType<{ value: number }>(asyncMemoResult);
expectType<readonly number[]>(arrayMemoResult);
expectType<IContainerChoice>(unionMemoResult);
expectType<ISourceOutcome<IThenMetadata>>(thenSourceResult);
expectType<IThenMetadata>(thenMemoResult);
expectType<{ then: number; value: boolean }>(numericThenMemoResult);
expectType<IWrapped<number>>(mixedSyncAsyncMemoResult);
expectType<IWrapped<number>>(explicitPromiseMemoResult);
expectType<{ value: string }>(genericWrapperResult);
