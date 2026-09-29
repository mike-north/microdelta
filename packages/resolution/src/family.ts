/**
 * The binding family Resolution supplies to Definition. It fixes what an
 * author's callbacks receive when Resolution invokes them:
 *
 * - declared current inputs as one immutable tracked record, so every consumed
 *   configuration field becomes evidence;
 * - declared helpers as tracked functions, so an actually called helper's
 *   implementation becomes evidence and an uncalled one does not;
 * - a child call's result as a lazy view over its exact retained data, and a
 *   supplied step's arguments as views observed under `argument` bindings;
 * - an explicit observed untracked read, the only way a callback reads a
 *   tracked member without consuming it;
 * - a source's eligible previous result as an immutable `{ data }` carrier;
 * - a source's outcome as a Resolution-minted control envelope, built with the
 *   `outcome` constructors its context supplies.
 *
 * These are types only; the values are assembled by Resolution per invocation.
 */
import type { IBindingFamily, IPreviousCarrierFamily, ITypeFamily } from '@microdelta/definition';
import type { ITracked, ITrackedView, IUntrackedKey } from '@microdelta/tracking';

import type { ISourceOutcome, ISourceOutcomes } from './outcome.js';

/**
 * The view of one retained result an author reads. Completed results always
 * have a record or array root, so the view is Tracking's canonical lazy view.
 * @alpha
 */
export type IResultView<T> = T extends object ? ITrackedView<T> : never;

/**
 * The immutable carrier of a source's eligible previous result. Authors read
 * the prior data through `data`; which exact result it stands for stays with
 * Resolution, so retention can name only this carrier, never a payload.
 * @alpha
 */
export interface IPreviousResult<T> {
  /** A lazy view over the eligible previous result's retained data. */
  readonly data: IResultView<T>;
}

/**
 * How an author reads one value a declared call delivers or a supplied step
 * receives: a record or array through Tracking's lazy view, a scalar as itself.
 * Completed results always have a record or array root (publication rejects
 * anything else), so a scalar here is only ever a supplied step's argument,
 * read through its observed `argument` binding.
 * @alpha
 */
export type ICallView<T> = T extends object ? IResultView<T> : T;

/** Result or argument type to the view a declared call delivers or a supplied step reads. @alpha */
export interface IResolutionViews extends ITypeFamily {
  readonly output: ICallView<this['input']>;
}

/** Result type to the previous-result carrier a source receives. @alpha */
export interface IResolutionPrevious extends IPreviousCarrierFamily {
  readonly output: IPreviousResult<this['input']>;
}

/** Result type to the control envelope a source returns. @alpha */
export interface IResolutionOutcomes extends ITypeFamily {
  readonly output: ISourceOutcome<this['input']>;
}

/**
 * Declared helpers as authors receive them: each helper is a tracked function
 * whose implementation is observed only when it is actually called. The record
 * itself is framework structure, not observed data.
 * @alpha
 */
export type ITrackedHelpers<THelpers extends object> = {
  readonly [K in keyof THelpers]: ITrackedView<THelpers[K]>;
};

/**
 * The explicit, observed untracked read authors receive: return one scalar
 * member of a tracked view without consuming it as evidence. The capture
 * records that the read happened (Tracking's `untracked-read` observation), and
 * any derived argument a memo passes to a nested call after it is recorded as
 * unjustified, so revalidating that memo is an honest `unjustified-argument`
 * miss rather than reuse justified by content it did not track (CMP-7).
 * @alpha
 */
export type IUntrackedRead = <V extends ITracked<object>, K extends IUntrackedKey<V>>(value: V, key: K) => V[K];

/**
 * The current bindings every source, memo and supplied step callback receives
 * beside the context names Definition supplies (`previous`, `calls` or `args`).
 * @alpha
 */
export interface IStepBindings<TInputs extends object, THelpers extends object> {
  /** Declared current inputs, one tracked record keyed by input slot. */
  readonly inputs: ITrackedView<TInputs>;
  /** Declared helpers keyed by callable slot. */
  readonly helpers: ITrackedHelpers<THelpers>;
  /** The explicit observed untracked read. */
  readonly untracked: IUntrackedRead;
}

/**
 * A source's current bindings: the shared step bindings plus the constructors
 * of the only outcomes it may return. Supplying them in the context keeps
 * source callbacks free of captured module state.
 * @alpha
 */
export interface ISourceBindings<TInputs extends object, THelpers extends object> extends IStepBindings<TInputs, THelpers> {
  /** Fresh-data and explicit-retention envelope constructors. */
  readonly outcome: ISourceOutcomes;
}

/**
 * Resolution's binding family for Definition's builders, parameterized by the
 * author's declared input record and helper record.
 * @alpha
 */
export interface IResolutionFamily<TInputs extends object, THelpers extends object> extends IBindingFamily {
  readonly views: IResolutionViews;
  readonly previous: IResolutionPrevious;
  readonly outcomes: IResolutionOutcomes;
  readonly source: ISourceBindings<TInputs, THelpers>;
  readonly memo: IStepBindings<TInputs, THelpers>;
}
