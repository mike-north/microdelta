/**
 * Shared fakes for invocation tests: a Resolution/run-context port whose active
 * scope, tracked views, argument justification and dispatch results are
 * controlled by the test, plus assertion helpers for Definition failures.
 */
import { expect } from '@jest/globals';

import {
  DefinitionError,
  type IAnySourceDeclaration,
  type IApply,
  type IArgumentSupplier,
  type IArgumentViews,
  type IAuthorInvoker,
  type IBindingDescriptor,
  type IChildResult,
  type IDeclaredInvocationRequest,
  type IInvocationPort,
  type IInvocationScope,
  type IMemberOf,
  type IMemberSupplier,
} from '../../src/index.js';
import type { ITestFamily } from './contributors.js';

/** A fake port recording every dispatch it receives. */
export interface IFakePort {
  readonly port: IInvocationPort<ITestFamily>;
  readonly requests: IDeclaredInvocationRequest<ITestFamily, unknown>[];
  /** The scope the fake run context reports as currently executing. */
  active: IInvocationScope | undefined;
  /** What the next dispatch resolves to. */
  result: unknown;
  /** Values the fake run context reports as its tracked views. */
  readonly tracked: Set<unknown>;
  /** What the fake reports as the active frame's argument justification. */
  justified: boolean;
  /** How many times Definition asked for the justification. */
  justifiedQueries: number;
}

/**
 * The fake forwards whatever the test configured, including malformed results,
 * so the handle's own carrier validation is exercised.
 */
function passThrough<TResult>(value: unknown): IChildResult<TResult> {
  // A single documented assertion: the port contract is typed, but this fake
  // must be able to violate it at runtime to exercise the handle's validation.
  return value as IChildResult<TResult>;
}

/** Build a port whose behavior is controlled by the test. */
export function fakePort(): IFakePort {
  const state: IFakePort = {
    requests: [],
    active: undefined,
    result: { data: { kind: 'child' } },
    tracked: new Set(),
    justified: true,
    justifiedQueries: 0,
    port: {
      active: () => state.active,
      dispatch: <TResult>(request: IDeclaredInvocationRequest<ITestFamily, TResult>): Promise<IChildResult<TResult>> => {
        state.requests.push(request);
        return Promise.resolve(state.result).then(result => passThrough<TResult>(result));
      },
      isTrackedView: (value: unknown) => state.tracked.has(value),
      argumentsJustified: () => {
        state.justifiedQueries++;
        return state.justified;
      },
    },
  };
  return state;
}

/** An honest rank-2 invoker that calls the callback with its context. */
export function directInvoker(): IAuthorInvoker<unknown> {
  return <TContext, TResult>(callback: (context: TContext) => TResult, context: TContext): unknown => callback(context);
}

/** An argument supplier that returns fixed views, as Resolution would after reconstruction. */
export function argumentSupplier(values: readonly unknown[]): IArgumentSupplier<ITestFamily> {
  return {
    views: <TParameters extends readonly unknown[]>(): IArgumentViews<ITestFamily, TParameters> =>
      // Test-only: the supplier deliberately returns whatever the test configured.
      values as IArgumentViews<ITestFamily, TParameters>,
  };
}

/** Call a handle with runtime arguments its type may forbid, as untyped author code could. */
export function callUntyped(handle: unknown, ...values: unknown[]): Promise<unknown> {
  if (typeof handle !== 'function') {
    throw new Error('expected a handle');
  }
  const result: unknown = Reflect.apply(handle, undefined, values);
  return Promise.resolve(result);
}

/** Capture the Definition error a promise rejects with. */
export async function rejectionOf(promise: Promise<unknown>): Promise<DefinitionError | undefined> {
  try {
    await promise;
  } catch (error: unknown) {
    return error instanceof DefinitionError ? error : undefined;
  }
  return undefined;
}

/** Assert a promise rejects with a Definition error carrying the expected code. */
export async function expectRejection(promise: Promise<unknown>, code: DefinitionError['code']): Promise<void> {
  const error = await rejectionOf(promise);
  expect(error).toBeInstanceOf(DefinitionError);
  expect(error?.code).toBe(code);
}

/** Assert a synchronous failure carries the expected Definition error code. */
export function expectDefinitionError(action: () => unknown, code: DefinitionError['code']): void {
  let caught: unknown;
  try {
    action();
  } catch (error: unknown) {
    caught = error;
  }
  expect(caught).toBeInstanceOf(DefinitionError);
  expect(caught instanceof DefinitionError ? caught.code : undefined).toBe(code);
}

/** A member supplier that records which collection and instance it was asked for and returns one member view. */
export function supplying(member: unknown, asked: unknown[]): IMemberSupplier<ITestFamily> {
  return {
    view: <TCollection extends IAnySourceDeclaration<ITestFamily>>(collection: TCollection, instance: IBindingDescriptor): IApply<ITestFamily['views'], IMemberOf<ITestFamily, TCollection>> => {
      asked.push(collection, instance);
      // Test-only: the supplier stands in for Resolution's trusted member view and returns the configured record.
      return member as IApply<ITestFamily['views'], IMemberOf<ITestFamily, TCollection>>;
    },
  };
}
