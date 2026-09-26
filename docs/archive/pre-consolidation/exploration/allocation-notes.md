> Historical artifact. Superseded by the [active specification](../../../spec/README.md). Do not implement from this document.

# Exploratory authoring-surface allocation notes

2026-09-13. This is a bounded experiment and an options assessment, not a production benchmark or an API decision. No core implementation changed.

## Authoring implication

Prefer assessing **addressable field handles plus an explicit bag resolver** first. It expresses a useful operation in one line, leaves the loader free to batch, and keeps routing separate from materialization:

```ts
// Illustrative surface; these are not implemented API names.
const { createdAt, author } = await resolve({
  createdAt: pr.createdAt,
  author: pr.author.name,
});

// One selected field uses the same operation.
const body = await resolve(pr.body);

// Passing an address onward performs no resolution by itself.
return summarize(pr.body);

// Whole-value materialization is an explicit choice.
const completeRecord = await resolve(pr);
```

The bag resolver must inspect handles and submit the union to the shared loader directly. Implementing it as `Promise.all` over independently loading properties preserves the syntax but does not obtain the allocation/batching benefit illustrated below. Two overlapping bags still need loader-level in-flight deduplication.

| Surface | Author experience | Important cost or semantic question |
|---|---|---|
| Native promise-valued properties: `await pr.body` | Familiar async JavaScript; Promise combinators work | Retaining one promise per exposed field costs memory; if getting a property starts loading, routing it can perform unwanted I/O. Nested `pr.author.name` also needs a handle/schema design. |
| Address handles plus `await resolve({ body: pr.body, title: pr.title })` | Explicit resolution boundary; ordinary destructuring afterwards; easy multi-field reads | Requires learning one resolver. The bag does not imply whole-record sensitivity; record only selected fields under the eventual contract. |
| PromiseLike field facade: `await pr.body`; `await resolve({ ... })` | Compact single-field syntax plus a batching escape hatch | A lighter retained handle does not eliminate native promise machinery when awaited. Assimilation can happen through ordinary async return/Promise APIs, and each `.then` invocation must not independently launch work. |

A facade can compose over the same address/loader mechanism; it need not become a second semantic implementation. But consider keeping general value handles **non-thenable**: `return handle` from an async function otherwise assimilates it, potentially resolving data while the author only intended to route its address. An explicit whole-value resolver makes that cost visible. This is an authoring-contract concern, independent of benchmark rankings.

## What the language and runtime establish

ECMAScript's `Await` applies `PromiseResolve`. A same-constructor native promise can be reused; other values require a promise capability. Resolving an object reads its `then` property, and a callable `then` is invoked in a queued job. Thus `await` on a custom thenable is not a promise-free synchronous field access. The specification defines observable behavior, not exact physical heap allocations. [ECMAScript Await](https://tc39.es/ecma262/2025/multipage/control-abstraction-objects.html#await), [PromiseResolve](https://tc39.es/ecma262/2025/multipage/control-abstraction-objects.html#sec-promise-resolve), [Promise resolve functions](https://tc39.es/ecma262/2025/multipage/control-abstraction-objects.html#sec-promise-resolve-functions)

Inference for a lazy proxy: protocol inspection of `then` must not accidentally become a tracked user-field read or fetch. A real data field named `then` needs an explicit addressing story if the handle is also thenable. In a small ordering check, `Promise.resolve(customThenable)` produced `get then`, `after resolve`, `call then`, `after await`, confirming synchronous property inspection followed by deferred assimilation.

V8 documents optimizations that reuse native promises and eliminate unnecessary internal promises; it also explains why custom thenables take a different path. That article is historical (2018), so its older allocation counts are not used as current guarantees. [V8 fast async](https://v8.dev/blog/fast-async)

Node's `heapUsed` measures V8 heap usage, not total allocated bytes or RSS. Async-hook promise instrumentation changes execution overhead, so instrumentation was isolated from the uninstrumented retention/timing runs. [Node memory usage](https://nodejs.org/api/process.html#processmemoryusage), [Node promise execution tracking](https://nodejs.org/api/async_hooks.html#promise-execution-tracking)

## Retained-handle experiment

Script: `/private/tmp/perdure-authoring-probe/probe.mjs`. Raw output: `results-v24.14.0.json` and `results-v20.0.0.json` in the same directory. These are temporary local evidence, not package artifacts.

Each shape represents **100,000 rows × three scalar numeric fields**. Each independent process warms 10,000 rows, releases them, crosses a `setImmediate`, forces GC three times, takes a baseline, builds and strongly retains the 100,000 rows, forces GC three times again, and measures the `heapUsed` difference. Five fresh processes per shape; median shown. Each shape passed checksum assertions before measurement. Runtime baseline: Node 20.0.0 and Node 24.14.0 on this same macOS arm64 host.

| Shape retained, before consumption | Node 20 median bytes | Node 24 median bytes |
|---|---:|---:|
| Plain `{ a, b, c }` objects, synchronous baseline | 5,605,160 | 5,597,856 |
| `{ a: Promise.resolve(a), b: ..., c: ... }` | 20,006,208 | 20,006,024 |
| One `Promise.resolve({ a, b, c })` per row | 10,374,400 | 10,416,488 |
| Three prototype-method await-only thenables per row | 15,180,056 | 15,215,168 |
| Three prototype-method chainable PromiseLike facades per row | 15,204,976 | 15,215,392 |

The last two retain one scalar in each handle and share methods through their prototype. The await-only implementation calls its supplied resolve callback and does not implement `.then` chaining. The chainable facade implements `.then` by delegating to `Promise.resolve(this.value).then(resolve, reject)`. These differ when consumed even though their retained object layouts match. The bag contains exactly the same three scalar values; it is not a promise for a full unselected payload.

For this deliberately eager representation, retained thenable handles used less heap than retained native field promises, and a single promise for the three-field bag used less still. This does **not** establish that a real lazy getter creates or retains all field handles, nor does it price the loader's maps, paths, tags, fingerprints, payloads, or caches.

## Actually awaiting, separately

The uninstrumented consumption run prebuilds and retains 25,000 rows, then consumes all three fields once. Field shapes perform three awaits per row; the bag performs one await and reads its three scalars. Five fresh processes; median elapsed milliseconds:

| Shape | Node 20 | Node 24 |
|---|---:|---:|
| Native field promises | 3.14 | 2.93 |
| One bag promise | 1.10 | 1.08 |
| Await-only thenables | 5.02 | 5.21 |
| Chainable facade in this probe | 6.65 | 6.86 |

After consumption and forced GC, median incremental heap above the prebuilt retained structures was approximately −22.7 to +16.4 KB for those four shapes. Negative deltas are baseline/GC noise. Near-zero retained growth does not imply near-zero allocation churn. These elapsed times are scheduler/representation microbenchmarks over already-resolved numbers, with no I/O; the two runtime batches ran concurrently on the host. They are supplemental observations, not throughput predictions.

A separate **instrumented** run counted Node `PROMISE` init events after construction, over 1,000 rows. Both runtime versions produced the same counts:

| Shape | Read three distinct fields per row | Three overlapping consumers of the same retained handle via `Promise.all` |
|---|---:|---:|
| Native field promises | 3,002 | 5,002 |
| One bag promise | 1,002 | 5,002 |
| Await-only thenable | 6,002 | 8,002 |
| Chainable facade in this probe | 12,002 | 14,002 |

Counts include the async harness's two events. They are instrumentation-visible resources, not asserted engine allocations in an uninstrumented program. The overlap workload awaits the same native field/bag promise or thenable three times concurrently, then sums the same scalar three times; all variants verify identical results. Sharing the underlying native promise does not eliminate the consumers' reaction machinery.

A separate simulated asynchronous loader check returned the same three values in both cases: an uncached thenable launched **three loads**, while caching one pending native promise launched **one load**. Both invoked the facade's `then` **three times**. Therefore work deduplication belongs in the shared loader; a thenable interface alone does not provide it.

## Limits and next useful check

This experiment excludes real store reads, field payload sizes, async tracking contexts, concurrent analysis frames, weak-cache lifetimes, error paths, and the number of fields an author actually touches. The tiny thenable stores a resolved scalar rather than a durable address. It establishes neither a production memory bound nor the desirability of a public API. Its useful result is narrower: distinguish **retained field representation**, **materialization work**, and **await/continuation machinery**, then assess the surface with realistic author-written snippets before measuring a real materializer.
