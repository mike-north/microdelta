# DOM-3: current lazy-view lifetime and cache boundary

Production fixture baselinec5802da; diagnostic work parent3a63e6c. This is a finite public-owner-port lifecycle probe, not a giant-payload or whole-storage memory benchmark. No production or issue changes.

## Governing contract

DOM-3 (`docs/spec/domain.md:21–29`) requires selected loading, bounded caching and reclaimable materializations. VAL-3 (`docs/spec/tracking.md:175–180`) permits eviction/reloading without losing durable identity or observation semantics; it does not require keeping loaded fields strongly forever. The M3 nested-read decision (`tracking.md:195–221` and `docs/plans/m3-contribution-analysis.md:250–280`) proves independently addressable synchronous selected content and observation semantics, explicitly excluding a general M7 memory/eviction proof. Those scope limits are not evidence of an implemented cache leak.

The exported `IMaterialization` contract (`packages/materialization/src/index.ts:74–78`) explicitly states that each unexpected read is independent and implies no cache/eviction policy. No cache budget or public eviction API is specified. A consumer retaining selected values, output data or a capture's required evidence is not automatically cache retention.

## Source ownership

- Materialization `createNodeSource` and `materializeView` (`index.ts:260–285,333–341`) adapt the exact reference to the supplied reader. They do not retain returned selected payloads or a child-view cache. Scalar views likewise issue an independent read each access.
- Tracking `ownership` (`observer.ts:684`) is a WeakMap keyed by each proxy. `wrapLazy` (`:908–944`) requests a node each navigation, returns an ordinary scalar or a new child proxy, and stores its own container shape/address only in that proxy's weak ownership record. The root does not keep a strong list of child proxies.
- `ILazyRoot` (`:302–309`) holds the source plus `identities:Map<string,object>`. `lazyIdentity` (`:961–970`) populates it only when explicit output traversal asks for alias identity. Entries are copied address strings and empty frozen identity tokens, **not loaded payloads, output copies or child views**. It has root lifetime (including a surviving child sharing that root), no numerical entry bound or eviction policy. This is intentional alias-check metadata; a general metadata-space policy remains unproved. Do not relabel it a payload cache or assert an arbitrary required budget.
- Output traversal obtains the selected subtree, validates/copies it and retains evidence only in the active capture; it does not add the returned detached output to a persistent payload cache (`observer.ts:800–825,950–969`; `output-observation.ts`). Reader source data remains owned by History/the supplied reader.
- The durable History selected-index reader (`packages/history/src/durable/selected-index.ts:581–615`) returns fresh shape/scalar answers from indexed queries; no JS selected-payload cache was found there. SQL prepared statements/native page caches and general backend memory policy are separate and were not measured by this probe.

Classification for current supported selected reads: **payload caching absent**, **child wrappers weakly reclaimed**, with **per-root identity metadata scoped to the live root**. No demonstrated caching defect. Future production payload-cache/eviction policy and general M7 memory qualification remain target scope; a mechanism decision would be needed before inventing a cache budget or eviction interface, not before maintaining the existing uncached path.

## Executable lifecycle controls

The test was written before the synthetic worker. The strict worker composes generated alpha `createMaterialization`, `createTrackingObserver` and Node Machine APIs with a counter-instrumented injected reader over100/1000 tiny records. This is the actual Materialization/Tracking implementation; the reader is a synthetic stand-in, **not real SQLite**. Its immutable source snapshot necessarily stays alive as reader-owned source data and is excluded from cache claims.

The root view remains strongly retained throughout. Each sequential capture navigates to one child, reads one scalar, verifies its exact address/value/evidence, then drops the child and capture, retaining only a WeakRef and numeric counters. After completed consumers, immediate/GC/immediate/GC/immediate runs outside those captures. All100/1000 weak child refs become empty, while an intentionally retained child survives. That positive control prevents mistaking collection of a live consumer value for success. No heap-byte/asymptotic/native-memory claim is made; WeakRef lists are diagnostic state, not library cache.

Ordinary reads perform0 subtree requests,0 requests for the unread sibling, and one exact scalar observation per child. Repeating the same leaf again performs3 node requests (children array, indexed child, scalar), with the same fingerprint: there is no selected-payload memoization in this path. Detached explicit output becomes collectible after the consumer drops it, while root and retained child remain live. Two wrappers of the same node in one explicit output are still rejected as repeated references. Local tag snapshot/dirty validity semantics remain intact.

Baselinec5802da records only the scalar fact for this path. Mergedf43c587 adds two narrow container-kind facts (#155) per traversal. The fixture accepts and reports those known versioned forms while requiring exactly one scalar fact at the expected full address; it does not weaken kind facts into a payload observation. The output/control suite is separate from the retained consumer facts of a large single live capture: such a capture legitimately needs its consumed evidence.

```sh
node scratch/gap-hunt/scale/repro-materialization-lifetime.mjs
```

Default npmci/generated builds, strict alpha compile, type-aware lint,100/1000 worker controls and Jest2. `GAP_HUNT_REUSE_BUILD=1` reuses generated builds. Node24.22.1 captured baseline replay: both100/1000 rows pass, Jest2/2. `logs/materialization-lifetime-replay.log` preserves the full output. No production repair was made or manufactured red failure claimed.

This scope is independent of #173 (queued execution continuations before admission) and #160 (repeated root-array validation). Neither issue covers caching/reclaimability. The observed lifecycle behavior needs no new correctness issue. Keep general cache/eviction qualification explicitly unproved rather than treating these small passing controls as full DOM-3 closure.

## Fresh merged replay

A new owned detached worktree `.worktrees/gap-hunt-materialization-merged` was created at merged production source `f43c5872987573d9b98a19f41c324b4d9336894c`. The exact diagnostic files plus their local replay support were copied into ignored scratch paths (manifest `logs/materialization-lifetime-fixture.sha256`). No production files were copied or changed. The unmodified default command above independently ran npmci, generated package builds, strict alpha compile, type-aware lint, both worker sizes and Jest. Node24.22.1/npm11.12.1, exit0; Jest2/2. Tracked/all-untracked status was empty afterward; the ignored fixture artifacts/builds and worktree remain for review.

Both merged rows have100/1000 scalar observations plus200/2000 narrow container-kind observations, all dropped children collected, one intentionally retained child live, reread3nodecalls with equal fingerprint, no ordinary subtree/unread requests, alias rejection/output collection/tag controls passing. Source changes since baseline add container-kind observation/metadata support; WeakMap ownership, per-root identity map and uncached navigation mechanism remain unchanged. Full output `logs/materialization-lifetime-merged-clean.log`; SHA256 `55edfed658cb56d33d82e5ea1d9a6b103b77a5638d0a703d87bc52aee8801ed8`.
