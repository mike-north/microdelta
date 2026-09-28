/**
 * Family-bound builders. A facade calls `declarations<TFamily>()` once and
 * shares the instance with authors (source, memo, compose) and Resolution
 * (openInvocation). The instance privately owns the records of the steps and
 * compositions it minted; that ownership is also what lets `openInvocation`
 * reach each step's typed closures without recovering them by a cast or a
 * second lookup table maintained by the facade.
 */
import type { IBindingDescriptor } from './descriptor.js';
import {
  declareMemo,
  declareSource,
  type IChildDeclarations,
  type IDeclarationRecords,
  type IMemoDeclaration,
  type IMemoOptions,
  type ISourceDeclaration,
  type ISourceOptions,
} from './declaration.js';
import { composeIn, type IComposition, type ICompositionOptions, type ICompositionState } from './composition.js';
import type { IBindingFamily } from './family.js';
import { openInvocationIn, type IInvocation, type IInvocationPort } from './invocation.js';

/**
 * Builders and the invocation bridge bound to one facade binding family.
 * @alpha
 */
export interface IDeclarations<TFamily extends IBindingFamily> {
  /** Declare a retained source whose result type is `TResult`. */
  source<TResult>(options: ISourceOptions<TFamily, TResult>): ISourceDeclaration<TFamily, TResult>;
  /** Declare a memoized computation with typed sibling children. */
  memo<TChildren extends IChildDeclarations<TFamily> = Record<never, never>, TResult = unknown>(
    options: IMemoOptions<TFamily, TChildren, TResult>,
  ): IMemoDeclaration<TFamily, TChildren, TResult>;
  /** Freeze a composition of declarations this instance minted. */
  compose(options: ICompositionOptions<TFamily>): IComposition<TFamily>;
  /** Open a live invocation of one uniquely bound step of a composition this instance minted. */
  openInvocation(composition: IComposition<TFamily>, parent: IBindingDescriptor, port: IInvocationPort<TFamily>): IInvocation<TFamily>;
}

/**
 * Create builders bound to one facade binding family.
 * @returns A frozen builder instance owning its declaration and composition records.
 * @alpha
 */
export function declarations<TFamily extends IBindingFamily>(): IDeclarations<TFamily> {
  const records: IDeclarationRecords<TFamily> = new WeakMap();
  const compositions = new WeakMap<object, ICompositionState<TFamily>>();
  return Object.freeze({
    source: <TResult>(options: ISourceOptions<TFamily, TResult>) => declareSource(records, options),
    memo: <TChildren extends IChildDeclarations<TFamily> = Record<never, never>, TResult = unknown>(
      options: IMemoOptions<TFamily, TChildren, TResult>,
    ) => declareMemo(records, options),
    compose: (options: ICompositionOptions<TFamily>) => composeIn(records, compositions, options),
    openInvocation: (composition: IComposition<TFamily>, parent: IBindingDescriptor, port: IInvocationPort<TFamily>) =>
      openInvocationIn(records, compositions, composition, parent, port),
  });
}
