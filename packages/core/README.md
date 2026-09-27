# microdelta facade

The private `microdelta` entry preserves the scaffold's existing public History
Store API. It explicitly reexports `@microdelta/history` declarations and runtime
values; it does not own the Store or grant other contexts an import shortcut.
See the [package map](../../docs/package-map.md) and [active specification](../../docs/spec/README.md).

```js
import { createMemoryStore } from 'microdelta';
const store = createMemoryStore();
console.log(await store.meta());
await store.close();
```

The existing Jest suite remains available at `microdelta/conformance/store` and
is implemented by History. Memory is process-local and non-durable. Neither this
facade nor its declaration rollups establish restart-safe publication or an
assembled incremental-analysis runtime.
