> Historical implementation evidence, not current design authority. Start at
> [the active specification](spec/README.md). Dates and passing-test counts below
> describe prior runs; they were not rerun by the specification consolidation.

# Track adoption decision

2026-09-13. **Adopted `@preact/signals-core@1.14.4` behind the internal `track` façade.** The user confirmed Node ≥20 and AsyncLocalStorage. The façade is implemented and the dependency is pinned. No author-facing root tracking exports were added; the broader authoring surface is under exploration.

The contract is [core spec §4.4](archive/pre-consolidation/source/core-package-spec.md#44-track): opaque process-local tags, revision snapshots, collected read sets, isolated asynchronous frames, cells, and memoized derivations. [Rev 9 §2.7](archive/pre-consolidation/source/incremental-analysis-deep-design-rev9.md#27-autotracking-across-processes--what-persists-and-why-the-tag-half-stays) requires both entanglement and revision-based consumer reactivity; tags and dependency sets must never enter stored rows.

## Adapter boundary

Preact supplies dependency tracking and lazy computed caching. The façade owns its public tokens, monotonically increasing revision numbers, and explicit dependency sets. `AsyncLocalStorage.run()` carries a fresh set through each execution; Preact's synchronous evaluation context is not used as an asynchronous frame.

| Façade operation | Proposed mapping |
| --- | --- |
| `createTag()` | Opaque token privately associated with a `Signal<number>`. |
| `consume(tag)` | Read the revision signal's `.value` and record the token in the current ALS set. |
| `dirty(tag)` | Write `++revision` to that tag's signal. |
| `snapshot(tags)` | Maximum revision, read with `.peek()` to avoid entanglement; zero for an empty set. |
| `isValid(tags, at)` | Compare the current maximum revision with `at`. |
| `withFrame()` / `withFrameAsync()` | Run the callback in a fresh ALS collector, isolated from Preact's surrounding synchronous subscriptions; return its result and a completion snapshot of consumed tags. |
| `cell()` | Getter consumes its tag; setter stores the value and dirties the tag. |
| `derived(fn)` | Cache a framed success/error outcome and its concrete tags. Subscribe the computed node to exactly those private revision signals after collection. |
| `derived.get()` | Replay the selected cached result's concrete tags into the caller's frame, then return the value or rethrow the original error. |

Replaying dependencies on a cached read is necessary: a new execution must collect the derivation's dependencies even when its body does not run. Every explicit cell `set()` bumps its revision, including an equal-value set, following TK-3's stated validation. Public signatures and stored row schemas expose no Preact types.

## Evidence

The official package metadata and the installed research package both report **1.14.4**, **MIT**, and no runtime dependencies. It exports ESM, CommonJS, browser, and TypeScript entry points; neither Preact nor React is required. The public `signal`, `computed`, and `.peek()` APIs suffice for the probe. See the [official API](https://github.com/preactjs/signals/blob/main/packages/core/README.md), [package metadata](https://github.com/preactjs/signals/blob/main/packages/core/package.json), [implementation](https://github.com/preactjs/signals/blob/main/packages/core/src/index.ts), and [license](https://github.com/preactjs/signals/blob/main/LICENSE).

The disposable probe ran outside the repository at `/tmp/perdure-track-probe/probe.mjs`, using **Node v24.14.0** and **`@preact/signals-core@1.14.4`**. It asserted the intended behavior before defining the experimental adapter. Its SHA-256 was `2a4ccc5b487e3d77d0e902053021435075c18d582f459969004425d18817a251`. Running `node /tmp/perdure-track-probe/probe.mjs` exited successfully with this exact output:

```text
PASS: dynamic branches, memoization, equal-value set, cached dependency replay, snapshot validation, interleaved awaits, thrown-frame restoration
```

The checks covered lazy repeated reads, unused-branch mutations, replacement of branch dependencies, invalidation after a consumed cell changes, equal-value explicit sets, a fresh frame reading an already-cached derivation, and two interleaved executions consuming disjoint tags after `await`. A nested throwing frame restored its caller's dependency set.

This original probe is adoption evidence, distinct from the implemented façade's 23 tests. The temporary probe may be removed by the host. Those tests cover TK-1–TK-3, nested cached derivations, empty sets, failures, interleaved awaits, and frame isolation. Basic ALS is documented as stable since Node 16.4; its `run()` API supports asynchronous context propagation and restoration. See [Node's ALS documentation](https://nodejs.org/api/async_context.html#asynclocalstoragerunstore-callback-args).

The implementation deliberately improves on the probe: a nested collector must not add hidden subscriptions to an enclosing Preact computed node. Three regressions first demonstrated that mismatch, then passed after frame callbacks were isolated with `untracked` and computed subscriptions were established only from the collected tag set. Cached failures preserve their dependencies so a catching consumer can recover when a read changes. Tokens reject JSON, structured cloning, and V8 serialization; this does not prove that arbitrary `unknown` store payloads contain no process-local state.

## Alternative and remaining limits

`@glimmer/validator@0.95.0` has a closer native vocabulary (`createTag`, `dirtyTag`, `valueForTag`, `validateTag`, `consumeTag`, `createCache`). A research probe successfully dirtied a tag and invalidated its previous snapshot. Its tracking stack is nevertheless synchronous/global and would still need façade-owned ALS collection. More decisively, the [official upstream notice](https://github.com/glimmerjs/glimmer-vm) says the repository was archived on January 6, 2026 and standalone `@glimmer/*` publication stopped after its merger into `ember-source`. This makes it a weaker dependency choice for a new standalone library.

ALS makes the proposed frame carrier Node-specific. Browser execution remains a future adapter concern; the viewer sketch does not authorize building it now. The adoption probe supplies no performance or memory measurements and does not close OQ8. Cache-hit overhead and the value of derivation memoization remain to be measured with the façade and representative workloads in place.
