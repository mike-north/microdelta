/**
 * The only production module allowed to bind portable capabilities to Node.
 * V8 serialization is a detached in-process snapshot codec, not a durable
 * canonical value format; it evaluates enumerable getters and does not retain
 * arbitrary user class prototypes.
 * @packageDocumentation
 */
import { AsyncLocalStorage } from 'node:async_hooks';
import { deserialize, serialize } from 'node:v8';

import type { IMachine } from '@microdelta/machine';

/** Bind the two existing host dependencies to contracts consumed by contexts. @internal */
export function _createNodeMachineImplementation(): IMachine {
  return Object.freeze({
    createAsyncContext<T>() {
      return new AsyncLocalStorage<T>();
    },
    snapshot<T>(value: T): T {
      // The generic API promises a round-trip of T within V8's supported
      // structural domain; serialization changes representation, not schema.
      return deserialize(serialize(value)) as T;
    },
  });
}
