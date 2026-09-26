/** Candidate declarations only. No runtime or public microdelta exports. @internal */
declare const reference: unique symbol;
declare const collection: unique symbol;

/** A lazy value; addressing a child does not read its parent's content. @internal */
export type Ref<T> = PromiseLike<T> & { readonly [reference]: T } & (
  T extends readonly (infer Item)[]
    ? { readonly [index: number]: Ref<Item>; readonly length: Ref<number> }
    : T extends object ? { readonly [Key in keyof T]-?: Ref<T[Key]> } : unknown
);
/** A durable collection; iteration consumes complete row values with bounded loading. @internal */
export interface Collection<T> extends AsyncIterable<T> {
  readonly [collection]: T;
  /** Observe terminal outcomes explicitly; scheduled retries remain pending. */
  settled(): Collection<Outcome<T>>;
}
/** Failure handling is explicit in a tolerant fold. @internal */
export type Outcome<T> =
  | { readonly status: 'fulfilled'; readonly value: T }
  | { readonly status: 'rejected'; readonly key: string; readonly error: unknown };
/** One observed increment, not a cumulative snapshot or a currency estimate. @internal */
export interface Observation {
  readonly metric: string;
  readonly unit: string;
  readonly amount: number;
  readonly resource: string;
}
/** Fixed run configuration plus attempt-bound runtime facilities. @internal */
export interface AnalysisContext {
  readonly environment: string;
  readonly signal: AbortSignal;
  record(observation: Observation): void;
}
/** Literal inputs are wrapped; collection references keep their collection identity. @internal */
type Bound<Args extends readonly unknown[]> = {
  [Key in keyof Args]: Args[Key] extends Ref<infer T> ? T | Ref<T> : Args[Key]
};
/** Calls describe work without executing the body. @internal */
export interface Factory {
  <Args extends readonly (Ref<unknown> | Collection<unknown>)[], Result>(
    body: (...args: Args) => Result,
    options?: { readonly name: string },
  ): (...args: Bound<Args>) => Ref<Awaited<Result>>;
}
/** Explicit context is an opt-in body argument, never a binding argument. @internal */
export interface ContextualFactory extends Factory {
  withContext<Args extends readonly (Ref<unknown> | Collection<unknown>)[], Result>(
    body: (context: AnalysisContext, ...args: Args) => Result,
    options?: { readonly name: string },
  ): (...args: Bound<Args>) => Ref<Awaited<Result>>;
}
/** Memoized bodies must declare their behavior revision. @internal */
export interface MemoFactory {
  <Args extends readonly (Ref<unknown> | Collection<unknown>)[], Result>(
    body: (...args: Args) => Result,
    options: { readonly revision: number; readonly name?: string },
  ): (...args: Bound<Args>) => Ref<Awaited<Result>>;
}
/** Same required revision, with explicit context as an opt-in first body argument. @internal */
export interface ContextualMemoFactory extends MemoFactory {
  withContext<Args extends readonly (Ref<unknown> | Collection<unknown>)[], Result>(
    body: (context: AnalysisContext, ...args: Args) => Result,
    options: { readonly revision: number; readonly name?: string },
  ): (...args: Bound<Args>) => Ref<Awaited<Result>>;
}
/** Discovery closure is the iterator's successful completion, not temporary silence. @internal */
export interface SourceFactory {
  <Args extends readonly (Ref<unknown> | Collection<unknown>)[], Item>(
    body: (...args: Args) => AsyncIterable<Item>,
    options: { readonly key: (item: Item) => string; readonly revision: number; readonly name?: string },
  ): (...args: Bound<Args>) => Collection<Item>;
}
/** Opt-in context for streaming discovery. @internal */
export interface ContextualSourceFactory extends SourceFactory {
  withContext<Args extends readonly (Ref<unknown> | Collection<unknown>)[], Item>(
    body: (context: AnalysisContext, ...args: Args) => AsyncIterable<Item>,
    options: { readonly key: (item: Item) => string; readonly revision: number; readonly name?: string },
  ): (...args: Bound<Args>) => Collection<Item>;
}
/** Availability is separate from validity and execution coverage. @internal */
export type Preview<T> = {
  readonly complete: boolean;
  readonly failed: number;
  readonly pending: number;
  readonly errors: readonly unknown[];
} & (
  | { readonly available: false }
  | { readonly available: true; readonly value: T; readonly freshness: 'provisional' | 'stale' | 'verified' }
);
/** Environment routing must be resolved consistently before execution. @internal */
export interface Environment<Services> {
  readonly name: string;
  readonly storage: string;
  readonly services: Services;
}
/** The generic plan representation is intentionally not frozen by this comparison. @internal */
export interface Plan { readonly text: string }
/** Bound observation is not demand for paid work; run provides that demand. @internal */
export interface Execution<T> {
  readonly result: Promise<T>;
  cancel(): void;
  observe<Args extends readonly unknown[], Value>(
    step: (...args: Args) => Ref<Value>,
    listener: (state: Preview<Value>, instance: { readonly key: string }) => void,
    options: { readonly throttleMs: number },
  ): () => void;
}
/** Planning constructs symbolic bindings; it never executes source or step bodies. @internal */
export interface Analysis<Input, Output> {
  plan(input: Input): Plan;
  run(input: Input): Execution<Output>;
}
/** Shared construction operations; names are proposals, not implemented API. @internal */
export namespace scoped {
  const step: Factory;
  const memo: MemoFactory;
  const source: SourceFactory;
  function analysisContext(): AnalysisContext;
  function analysis<Input, Output, Services>(name: string, environment: Environment<Services>, build: (input: Ref<Input>) => Ref<Output>): Analysis<Input, Output>;
  function fanOut<Input, Output>(
    input: Collection<Input>,
    build: (item: Ref<NoInfer<Input>>) => Ref<Output>,
    options?: { readonly concurrency: number },
  ): Collection<Output>;
  /** Arrays need explicit stable member keys; derived collections inherit their keys. */
  function fanOut<Input, Output>(
    input: Ref<readonly Input[]>,
    build: (item: Ref<NoInfer<Input>>) => Ref<Output>,
    options: { readonly key: (item: NoInfer<Input>) => string; readonly concurrency?: number },
  ): Collection<Output>;
  namespace refs {
    function all<const Bag extends Record<string, Ref<unknown>>>(bag: Bag): Promise<{
      -readonly [Key in keyof Bag]: Bag[Key] extends Ref<infer T> ? T : never
    }>;
  }
}
/** Only context entry differs from the scoped option. @internal */
export namespace explicit {
  const step: ContextualFactory;
  const memo: ContextualMemoFactory;
  const source: ContextualSourceFactory;
  const analysis: typeof scoped.analysis;
  const fanOut: typeof scoped.fanOut;
  const refs: typeof scoped.refs;
}
