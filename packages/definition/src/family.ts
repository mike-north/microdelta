/**
 * Facade-supplied type families. Definition types author callback contexts
 * without knowing Tracking, Materialization or Resolution: the facade supplies
 * type-level mappings from a declared result type to the view authors read, the
 * immutable previous-result carrier a source's policy receives, and the outcome
 * a source returns, plus its distinct source and memo binding records. These
 * are type parameters only; they carry no runtime policy.
 */

/**
 * A type-level mapping from `input` to `output`, supplied by the facade, e.g.
 * `interface IViews extends ITypeFamily { readonly output: ITrackedView<this['input']> }`.
 * @alpha
 */
export interface ITypeFamily {
  readonly input: unknown;
  readonly output: unknown;
}

/**
 * Apply a type family to one input type.
 * @alpha
 */
export type IApply<TFamily extends ITypeFamily, TInput> = (TFamily & { readonly input: TInput })['output'];

/**
 * A previous-result mapping whose output is an immutable carrier: authors read
 * the prior result through `data`, and whatever else identifies the exact
 * eligible result stays with Resolution rather than the author payload.
 * @alpha
 */
export interface IPreviousCarrierFamily extends ITypeFamily {
  readonly output: { readonly data: unknown };
}

/**
 * One facade's binding family. Source and memo bindings are distinct records
 * because a source's current policy and a memoized computation receive
 * different current bindings.
 * @alpha
 */
export interface IBindingFamily {
  /** Maps a declared result type to the view an author reads from a child call. */
  readonly views: ITypeFamily;
  /** Maps a declared result type to the eligible previous-result carrier a source receives. */
  readonly previous: IPreviousCarrierFamily;
  /** Maps a declared result type to what a source `run` returns (Resolution's control envelope). */
  readonly outcomes: ITypeFamily;
  /** Current bindings for a source's `run` and `finality`: a plain record (ordinary or null prototype, enumerable own data fields only). */
  readonly source: object;
  /** Current bindings for a memo's `run`: a plain record (ordinary or null prototype, enumerable own data fields only). */
  readonly memo: object;
}
