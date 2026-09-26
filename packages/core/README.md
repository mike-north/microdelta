# microdelta

For target behavior and new work, start at the [active specification](../../docs/spec/README.md).
This page describes the current scaffold only.

Persisted incremental analysis. This package is an incomplete, private development
build containing the memory Store and shared storage types. The memoization
runtime and SQLite backend are not implemented yet.

```js
import { createMemoryStore } from 'microdelta';

const store = createMemoryStore();
console.log(await store.meta());
await store.close();
```

The normal ESM entry point currently exposes storage. An internal tracking façade
uses the package's pinned Signals Core dependency; the unified authoring direction is specified, but its public signatures and runtime
are not implemented yet. Memory is process-local and non-durable.

Backend authors can register the reusable qualification suite in Jest 30:

```js
import { storeConformance } from 'microdelta/conformance/store';
```

Supply a fresh backend factory, the runtime fingerprint algorithm, and a value-read
probe to qualify fingerprint-only reads. The test entry point requires the optional
`@jest/globals` peer. This suite establishes single-row CAS and snapshot behavior;
it does not establish cross-row publication, crash recovery, or lifecycle semantics.
