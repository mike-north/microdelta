/**
 * The only production module allowed to bind portable capabilities to Node.
 * V8 serialization is a detached in-process snapshot codec, not a durable
 * canonical value format; it evaluates enumerable getters and does not retain
 * arbitrary user class prototypes.
 * @packageDocumentation
 */
import { AsyncLocalStorage, AsyncResource } from 'node:async_hooks';
import { createHash } from 'node:crypto';
import { deserialize, serialize } from 'node:v8';

import type { IAsyncContext, IMachine } from '@microdelta/machine';

/** Bind the two existing host dependencies to contracts consumed by contexts. @internal */
export function _createNodeMachineImplementation(): IMachine {
  return Object.freeze({
    createAsyncContext<T>() {
      const storage = new AsyncLocalStorage<T>();
      /**
       * An entry owns a short-lived host resource, not the continuing caller's
       * resource. Descendant work keeps its inherited store after this entry
       * resource is destroyed; the consuming context owns when its value closes.
       */
      return {
        getStore(): T | undefined {
          return storage.getStore();
        },
        run<TResult>(value: T, callback: () => TResult): TResult {
          const entry = new AsyncResource('microdelta:async-context-entry');
          try {
            return entry.runInAsyncScope(() => storage.run(value, callback));
          } finally {
            entry.emitDestroy();
          }
        },
      } satisfies IAsyncContext<T>;
    },
    snapshot<T>(value: T): T {
      // The generic API promises a round-trip of T within V8's supported
      // structural domain; serialization changes representation, not schema.
      return deserialize(serialize(value)) as T;
    },
    sha256(input: string): string {
      return createHash('sha256').update(input, 'utf8').digest('hex');
    },
  });
}
