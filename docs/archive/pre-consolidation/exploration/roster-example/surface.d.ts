/** Candidate authoring declarations only. There is no runtime behind these exports. @internal */
declare const referenceBrand: unique symbol;
declare const collectionBrand: unique symbol;
declare const reuseBrand: unique symbol;

/** Addressing a field is lazy; awaiting it records the consumed value. @internal */
export type IRef<T> = PromiseLike<T> & { readonly [referenceBrand]: T } & (
  T extends readonly (infer Item)[]
    ? { readonly [index: number]: IRef<Item>; readonly length: IRef<number> }
    : T extends object ? { readonly [Key in keyof T]-?: IRef<T[Key]> } : unknown
);
/** Streaming keyed membership, with successful closure separate from temporary silence. @internal */
export interface ICollection<T> extends AsyncIterable<T> { readonly [collectionBrand]: T }
/** One input bag; collections retain streaming behavior, other inputs become field references. @internal */
export type IInputs<T> = { readonly [Key in keyof T]: T[Key] extends ICollection<unknown> ? T[Key] : IRef<T[Key]> };
/** Bindings accept literals or existing references; composition never resolves them. @internal */
export type IBindings<T> = { readonly [Key in keyof T]: T[Key] extends ICollection<unknown> ? T[Key] : T[Key] | IRef<T[Key]> };
/** An opaque framework control result, not a payload field or public output union. @internal */
export interface IReuse<T> { readonly [reuseBrand]: T }
/** Recursive readonly view of structural cached data, including nested arrays. @internal */
export type IReadonlyValue<T> = T extends object ? { readonly [Key in keyof T]: IReadonlyValue<T[Key]> } : T;
/** Current eligible snapshot. The bound reuse function identifies this exact prior result. @internal */
export interface IPrevious<T> {
  readonly value: IRef<IReadonlyValue<T>>;
  readonly reuse: (reason: string) => IReuse<T>;
}
/** Plain work needs no identity callback. @internal */
export interface IStep<Input, Output> {
  readonly run: (input: IInputs<Input>) => Output | Promise<Output>;
}
/** Same object shape for dependency memoization and explicitly validated external retrieval. @internal */
export interface IMemoStep<Input, Output> {
  readonly identity: (input: IInputs<Input>) => string | Promise<string>;
  /** Evaluated from the current step; never persisted or skipped due to a prior true. */
  readonly isFinal?: (input: IInputs<Input>, previous: IPrevious<Output>) => boolean | Promise<boolean>;
  readonly run: (input: IInputs<Input>, previous: IPrevious<Output> | undefined) => Output | IReuse<Output> | Promise<Output | IReuse<Output>>;
}
/** Library-owned envelope; the author's object is nested intact, never spread into it. @internal */
export interface StepEnvelope<Step> {
  readonly name: string;
  readonly step: Step;
}
/** Persistence configuration belongs to the envelope, not the author instance. @internal */
export interface IMemoEnvelope<Step> extends StepEnvelope<Step> {
  readonly revision: number;
}
/** Observed increments are not price estimates or a guarantee of durable acknowledgement. @internal */
export interface IObservation { readonly metric: string; readonly unit: string; readonly amount: number; readonly resource: string }
/** Scoped runtime facilities; observation persistence semantics remain outside this sketch. @internal */
export interface IAnalysisContext { readonly environment: string; readonly signal: AbortSignal; record(observation: IObservation): void }
/** Environment storage and clients are supplied together before execution. @internal */
export interface IEnvironment<Services> { readonly name: string; readonly storage: string; readonly services: Services }
/** Minimal run handle sufficient to show launch and cancellation. @internal */
export interface IExecution<T> { readonly result: Promise<T>; cancel(): void }
/** Planning describes composition without calling any step or source body. @internal */
export interface IAnalysis<Input, Output> { plan(input: Input): string; run(input: Input): IExecution<Output> }
/** Ordinary named operation. @internal */
export declare function step<Input, Output>(envelope: StepEnvelope<IStep<Input, Output>>): (input: IBindings<Input>) => IRef<Output>;
/** Automatic dependency verification gates body execution. @internal */
export declare function memo<Input, Output>(envelope: IMemoEnvelope<IMemoStep<Input, Output>>): (input: IBindings<Input>) => IRef<Output>;
/** On each needed resolution: consult isFinal, otherwise run author retrieval, even on a cached URL. @internal */
export declare function retrieval<Input, Output>(envelope: IMemoEnvelope<IMemoStep<Input, Output>>): (input: IBindings<Input>) => IRef<Output>;
/** Non-memoized discovery; the key describes output membership, not a cached page identity. @internal */
export declare function source<Input, Item>(envelope: StepEnvelope<{
  readonly key: (item: Item) => string;
  readonly run: (input: IInputs<Input>) => AsyncIterable<Item>;
}>): (input: IBindings<Input>) => ICollection<Item>;
/** Array fan-out uses stable employee keys; stream fan-out inherits discovery membership keys. @internal */
export declare function fanOut<Input, Output>(input: IRef<readonly Input[]>, build: (item: IRef<Input>) => IRef<Output>, options: { readonly key: (item: Input) => string; readonly concurrency: number }): ICollection<Output>;
/** New items can execute before discovery closes, under bounded admission. @internal */
export declare function fanOut<Input, Output>(input: ICollection<Input>, build: (item: IRef<Input>) => IRef<Output>, options: { readonly concurrency: number }): ICollection<Output>;
/** Access belongs inside executing bodies, never composition callbacks. @internal */
export declare function analysisContext(): IAnalysisContext;
/** Build callbacks are synchronous wiring only, with no I/O or data-dependent traversal. @internal */
export declare function analysis<Input, Output, Services>(name: string, environment: IEnvironment<Services>, build: (input: IRef<Input>) => IRef<Output>): IAnalysis<Input, Output>;
