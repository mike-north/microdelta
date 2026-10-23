# DOM-3: corpus-sized lane waits before admission

Production baseline: c5802daca4a0bb8ea91159854d84eddcfa5215b6; diagnostic parent9cc808b. Synthetic offline Node24.22.1 only. No provider calls or production changes.

## Governing outcome and boundary

`docs/spec/domain.md:21–29` DOM-3 says “Fanout memory is bounded by admitted work, not full corpus cardinality.” `docs/spec/architecture.md:99–110` ARC-005 distinguishes the fixed abstract graph from runtime member instances; expanding a runtime roster cannot require adding abstract operations. `docs/spec/operations.md:74–111` RUN-002 requires the bounded active window without selecting a general scheduler. These are different claims: a bound on active bodies alone does not prove a bound on queued per-member execution state.

This probe targets only outstanding per-member lane waits before admission. It makes no constant-space assertion about source publication, roster decoding, duplicate-key checking/index maps, composition instance storage, already-settled member evidence or the member report that necessarily lists the population. It does not retest100k publication, candidate acceptance scans or source-array validation. No10k run was needed:100→1000 already separates fixed-window state from linear queued execution.

## Fixture and observations

`fanout-admission.test.mjs` was authored before the worker and states the bounded-work outcome plus independent gate/report controls. `fanout-admission.ts` uses the generated alpha facade, real durable workspace, keyed source/template and run window. It publishes the tiny roster once before enabling allocation instrumentation. The held members request reuses that roster (`sourceBodies` remains1).

A deterministic gate holds either the first window's admission callbacks (no member admitted/body started) or, in the second control, the first window's member bodies. A separate readiness Promise signals exactly when the chosen population reaches the gate. The harness yields, collects and yields before sampling; the gate stays shut throughout. There are no timing thresholds. A hard stop then ends all queued lane waits and the held work; the harness releases its own gate and awaits the complete report before closing/removing the synthetic store.

Node async_hooks records only PROMISE initializations at the source-verified `new Promise` path in emitted Supervision `permits.js`; numeric async IDs leave the pending set on `promiseResolve`. It retains no Promise resources. Positive `permitPromiseInits` counts confirm the real acquire path was observed; the population==window negative control allocates no waiting Promise. Allocation sites are included in raw rows. This is a source-specific Node diagnostic, not a new public introspection API or host-independent promise-count requirement. A repair that changes that mechanism must review the diagnostic match alongside the source; it cannot claim green solely because the site moved.

| Population | Window | Held phase | Admission callbacks reached | Member bodies started | Pending lane-wait Promises | Pending after stop |
| --- | --- | --- | --- | --- | --- | --- |
|100|1|admission|1|0|99|0|
|1000|1|admission|1|0|999|0|
|100|8|admission|8|0|92|0|
|1000|8|admission|8|0|992|0|
|8|8|admission|8|0|0|0|
|100|8|body|8|8|92|0|

Every row reports exactly the roster cardinality and zero member successes/publications. In admission-held rows, no member has been admitted yet: `admissionCalls` means callbacks reached and held, not admitted work. In body-held control, eight bodies are admitted and held; all are interrupted without publication. The report is built only after the held census and is not counted as queued work. The source publication/storage work completes before instrumentation. Roster revalidation and indexing may occur during the request, but cannot create an allocation at the counted lane-wait path.

The Jest control test passes. The normative bounded-queue test fails: increasing100→1000 at window8 adds900 pending lane-wait Promises while both have exactly8 held admission callbacks and0 bodies. Its finite allowance of one window of additional waits distinguishes this concrete linear queue from bounded scheduling slack; it does not prescribe a future scheduler's exact buffer size or prove arbitrary population bounds. No peak-heap byte claim is made: the source-retained waiting callbacks/Promises establish concrete per-member queued execution state without attributing roster/report memory to it.

## Smallest source explanation and classification

- `packages/resolution/src/resolution.ts:2771`: `Promise.all(keys.map(... supervision.member(...)))` immediately presents every discovered key, allocating closures/Promise work for every member.
- `packages/supervision/src/execution.ts:325–348`: each member awaits `run.lanes.acquire(run.hard.signal)` before running the member callback.
- `packages/supervision/src/permits.ts:49,81–95`: once lanes are full, a pending Promise and grant/cancellation callbacks are retained in the ordinary waiter queue, one per remaining member. They are not roster indexing or final report storage.

Classification: **divergent for DOM-3's queued execution-state bound**, while **aligned for the measured RUN-002 active window and ARC-005 fixed graph**. Queues drain on cancellation; this is pre-admission corpus-proportional live state, not a post-run leak. `settleMembers`'s comment that an unstarted member “holds nothing” does not describe these actual waiting callbacks/Promises.

Pickup recommendation: bounded member dispatch must avoid enqueuing one pending execution/lane wait per undispatched corpus member, while preserving canonical start/report order, the active window, admission refusal/stop behavior, lane lending/priority reclaim, and failure drain semantics. Leave the batching/iterator/dispatcher mechanism and accounting boundary to the owner. No new public API is demonstrated necessary. This is a concrete internal lifecycle/scheduling gap, not merely a missing whole-heap benchmark; total materialization/fanout memory bounds remain separately unproved.

## Replay and verification boundary

```sh
node scratch/gap-hunt/scale/repro-fanout-admission.mjs
```

Default clean npmci/generated builds, then strict generated-alpha TypeScript, type-aware lint, six finite matrix rows, and Jest. Expected baseline exit1:1 control pass/1 bounded-queue failure (900). `GAP_HUNT_REUSE_BUILD=1` skips only installation/build. The captured run used existing generated builds; default clean bootstrap is not independently verified for this new runner yet. Full replay log: `logs/fanout-admission-matrix.log`. No paid execution, issues, publication or production changes.

`experiments/nested/` is an empty directory (Python scandir and ls-la verified), with timestamps predating this task; no identifiable content/origin was found. It was not created, changed or removed by this task. Git sometimes reports the path in default short status, while explicit all-untracked porcelain returns empty; no unknown data was deleted.
