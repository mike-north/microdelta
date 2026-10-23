# Consumer async-context accumulation: installed reproduction, current bounded non-reproduction

Codex (gpt-6.1-sol), evidence worker for Mike North. Production source baseline **c5802da**. Contribution Reports was inspected **read-only**, using its integrate checkout **d172f5f**. No providers, personal data, large payloads, production edits, issues or publications were involved.

**Finding:** the consumer's installed npm `microdelta@0.2.0` accumulates retained AsyncLocalStorage instances and increasing context overhead under its fresh-per-execution shape. Its AsyncResource workaround prevents this in the same generated probe. The equivalent current-source workspace path remains bounded in this 3,000-execution test. This is not evidence of a current-main workspace runtime defect. Independent current Tracking/raw-host controls still expose the underlying Node frame behavior when entered synchronously from the caller.

## Actual consumer shape and faithful limits

`contribution-reports/.worktrees/integrate/packages/pipeline/src/runtime/index.ts:27–34` creates a fresh `AsyncResource('facts-runtime-step')` for each source/memo execution, returns `boundary.runInAsyncScope(work).finally(() => boundary.emitDestroy())`, and inherits caller context. `execute` creates fresh authoring and composition, invokes `workspace.run`, resolves one step and reads its exact result; one workspace/store spans executions. Its README:63–66 documents undefined ALS keys accumulating in the caller continuation. Its runtime test:581 onward checks caller data across awaits and boundary destruction on success/failure.

The strict synthetic worker preserves fresh authoring/composition, one long-lived workspace, an async run callback, one resolve and exact read, new source identity per execution, small object output, caller ALS, and the identical finally-cleaned AsyncResource toggle. It returns only scalar counts; no observer, capture, composition, callback or prior result is retained by the fixture. The source callback is synchronous because current generated source types reject async callbacks (#169); pure Tracking explicitly crosses an await inside capture. Therefore this is a faithful **context/batch** mirror, not a complete clone of the consumer's async source/provider adapter.

Installed-runtime comparison changes only resolution of the `microdelta` import through `context-runtime-loader.mjs`. The generated worker code is identical; other direct Tracking controls continue using the local generated packages. Installed workspace internals resolve their own pinned dependency tree. Version/file checksums are preserved in `logs/context-installed-identity.json`; workspace SHA-256 is `cbdc9ff72d773c686cd6b5a0fffb97b2b1c30f2639c900ebeed20ec0c662f550`.

## Measurement and stable counts

Each process runs 30 sequential batches of 100 executions. Timed windows contain execution only. After each batch, it crosses `setImmediate`, forces GC, crosses another immediate, then uses experimental `v8.queryObjects(AsyncLocalStorage, { format: 'count' })`. This diagnostic is never domain identity or a timing assertion. Caller values, captured values/observation count and source outputs are checked inside the worker. Additional double-GC confirmation gives identical counts: plain Tracking202/202,402/402,602/602; isolated2/2 at each sample.

| Offline mode | First→final live ALS | First-five→last-five median ms/100 | Exact semantic work |
| --- | --- | --- | --- |
| Installed0.2.0 fresh sources, plain | 103→3003 | 106.47→309.84 | 3000 source bodies; all values correct |
| Same installed sources, AsyncResource | 3→3 | 100.26→78.86 | Same3000 bodies/values |
| Installed plain repeat, CPU sampled | 103→3003 | 89.24→268.87 | Same3000 bodies/values |
| Current c5802da fresh sources, plain | 3→3 | 109.70→96.48 | Same3000 bodies/values |
| Current sources, AsyncResource | 3→3 | 84.24→99.47 | Same3000 bodies/values |
| Current Tracking+active context, Node24.22.1 plain | 202→6002 | 9.00→90.95 | 3000 exact values;3000 one-fact captures |
| Same Tracking, AsyncResource | 2→2 | 2.05→1.54 | Same3000 captures |
| Tracking, Node26.12.0 plain | 202→6002 | 8.18→91.29 | Same3000 captures; no native store opened |
| Tracking, Node26 AsyncResource | 2→2 | 1.64→1.53 | Same3000 captures |
| Fresh observers allocated, never captured/entered | 2→2 | 0.23→0.22 | 3000 allocations; no capture |
| Raw two ALS contexts, no Tracking/storage | 202→6002 | 7.08→108.06 |3000 correct after-await context checks |
| Thirty fresh processes ×100 Tracking captures |202 in every process |4.40→4.35 |3000 captures overall; process startup excluded |

These are finite local macOS measurements, not the original consumer's absolute1.6→3.9-second batch reproduction, a portable latency guarantee, a peak-memory bound, or proof about arbitrary workloads. Node26 reproduces pure retention, so this must not be labelled Node24-only. GC/queryObjects costs and process startup are excluded from the timed windows, but CPU profiles cover the whole process and include diagnostic work.

### Separate mechanisms

- **Acceptance history:** fresh source subjects ensure no previous same-subject result, hence no retained-result acceptance scan. This does not exercise #159's repeatedly acknowledged one-result history. Pure Tracking/raw ALS performs no History call at all.
- **Publication:** current and installed durable runs each execute3000 small new-result bodies. They share publication cost with each other; this is not a zero-SQL benchmark. The current path's bounded ALS count shows publication itself does not force accumulation in this fixture.
- **Context:** pure Tracking/raw ALS has no storage, and the unentered-observer control stays bounded. Tracking plain allocates two entered, fresh ALS keys per execution; the other observer/context objects become collectible. With async-hook instrumentation, plain has24214 resources initialized/24207 destroyed at the final sample (difference7), while isolated39214/39207 (difference7). Thus retained ALS instances grow while outstanding counted async resources stay bounded; do not call it a growing pending-promise queue.

## Profile evidence and smallest visible source explanation

Node24 CPU sample aggregates are in `logs/context-consumer-summary.json`. In installed plain execution, `AsyncContextFrame` at `node:internal/async_context_frame:43` accounts for **1856/4277** self samples; SQLite transactions825, queryObjects406, GC375. Pure Tracking plain has835 AsyncContextFrame samples versus2 isolated; current durable profiles are dominated by SQLite transactions and queryObjects, not a growing AsyncContextFrame hot path. Profiles corroborate the count/control result; they are sampled evidence, not exact CPU accounting.

Node24's own loaded `AsyncLocalStorage.run` implementation calls `enterWith(data)`, then `enterWith(prior)` in finally. A new key can consequently survive in the caller frame with an undefined value. An await **before entering fresh contexts** moves their mutations to the callee continuation: adding only `--yield-first` to the identical worker keeps pure Tracking at2 after3000 and installed fresh sources at3, without AsyncResource. All captured/source values still pass.

The smallest visible existing main-source change explaining this divergence is an awaited writer-lease boundary before entering Resolution. Installed Supervision directly invokes `resolution.resolve(... lease: writer.lease())` in the synchronous prefix of `within`. Current `inPasses` awaits `leaseForPass()` at `packages/supervision/src/supervision.ts:807`, then invokes Resolution inside a request scope at:823. Commit **9791c35** introduced `const lease = await writerLease()` before `resolution.resolve/resolveMembers/resolveFold`; later M5 passes preserve that boundary. This matches the minimal yield-first counterfactual. It is a mechanism-supported explanation, **not a bisected assertion that9791c35 was the first complete fix**; several subsequent request/execution changes also differ from npm0.2.0.

The existing Node Machine tests (`node-machine.test.ts:25,44,65`) verify await propagation, nested restoration, concurrency and failures. Scope tests similarly check value/lifetime semantics. No checked-in production suite was found that measures retained ALS/frame growth over fresh executions; this audit adds diagnostic evidence and four correctness controls, not a platform-specific resource-budget assertion. No current-main defect or new public cleanup API is inferred from that test gap. Standalone Tracking's synchronous-entry retention remains an explicit component/host boundary for the owner to assess separately.

## Portable replay and evidence boundary

```sh
node scratch/gap-hunt/scale/repro-context-consumer.mjs --fresh-process-control
```

Default clean install/build, strict generated-declaration compilation, type-aware lint,4 Jest correctness controls, then sequential unentered/Tracking/plain/isolated/current-durable controls. `GAP_HUNT_REUSE_BUILD=1` explicitly skips bootstrap. `CONTEXT_RUNS`/`CONTEXT_BATCH` can reduce the bounded workload; defaults3000/100. No timing threshold or expected-leak assertion makes the command red. Pure Node26 replay:

```sh
/Users/mnorth/.nodenv/versions/26.12.0/bin/node --expose-gc scratch/gap-hunt/scale/dist/context-consumer.js tracking
```

Installed comparison is optional, read-only and machine-local. Set `CONTEXT_MICRODELTA` to the verified installed `dist/src/index.js`, then invoke Node24 with `--experimental-loader ./scratch/gap-hunt/scale/context-runtime-loader.mjs`, the worker, mode`fresh`, and optional`--isolated` or`--yield-first`. All stores are synthetic under the owned scratch path. Never substitute real consumer stores/data. CPU profiles can be regenerated with Node's `--cpu-prof`; only compact sample summaries are committed, not raw generated profiles or SQLite stores.

Strict compile and lint passed; Jest4/4 passes (`logs/context-consumer-jest.log`). Per-batch logs, double-GC confirmations, async-hook controls, installed checksums and summary are preserved. The diagnostic matrix used fresh generated packages; default bootstrap of this new runner itself has not been rerun, while its shared clean bootstrap helper was already verified by the M7 runner. No provider execution or issue was filed.
