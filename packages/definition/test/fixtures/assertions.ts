/**
 * Shared assertion helpers for Definition tests: typed failure-code checks and
 * a durable round trip that drops every process-local object, as retained
 * evidence would.
 */
import { expect } from '@jest/globals';

import { DefinitionError } from '../../src/index.js';

/** Assert a synchronous failure carries the expected Definition error code, returning it for message checks. */
export function expectDefinitionError(action: () => unknown, code: DefinitionError['code']): DefinitionError | undefined {
  let caught: unknown;
  try {
    action();
  } catch (error: unknown) {
    caught = error;
  }
  expect(caught).toBeInstanceOf(DefinitionError);
  expect(caught instanceof DefinitionError ? caught.code : undefined).toBe(code);
  return caught instanceof DefinitionError ? caught : undefined;
}

/** Round-trip through JSON as durable evidence would, dropping every process-local object. */
export function durable<T>(value: T): unknown {
  return JSON.parse(JSON.stringify(value));
}

/** Call a builder with an untyped argument, as a JavaScript author or forged caller could. */
export function callUntyped(builder: (...arguments_: never[]) => unknown, ...arguments_: unknown[]): unknown {
  return Reflect.apply(builder, undefined, arguments_);
}
