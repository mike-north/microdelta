# Operational contract assertion audit

Implementer: Codex worker (gpt-6.1-sol).
Agent assistance: Codex worker (gpt-6.1-sol) inspected contracts, authored probes, and ran the selected suites; parent review remains separate.

Baseline `c5802daca4a0bb8ea91159854d84eddcfa5215b6`. Scope: execution.md, operations.md, acceptance.md. Current M5 acceptance is bounded; these documents explicitly describe a broader target. Missing M6/M7 capabilities are backlog/consumer gaps, not a claim that M5 acceptance was false.

## Evidence and its limits

Strict test compilation passed. A fresh run of **55 suites / 473 cases** produced **470 passed, 3 failed** in106.392s. The three failures are all `journal/processes.test.ts`: subprocesses expected to exit normally were SIGKILL with empty stderr, matching the earlier component-worker launch problem; a minimal inert-child control now reproduces the argument-transport limitation independently of microdelta/SQLite. The same scripts through files succeed, and the unchanged journal suite passes all4cases with the test-only file-fed transport. See HARNESS-LIMIT.md. The enforcer/cause remains unestablished; no journal product defect is inferred. Track B's file-fed worker avoids this launch shape and preserved its bounded passing durability evidence separately.

`test-execution-index.json` contains actual executed names/statuses; `requirement-evidence.json` maps84 owner IDs to bounded semantic outcomes and test IDs. The mappings were selected from outcomes and actual expectations, not requirement-ID comments. `clause-dispositions.json` preserves344 source paragraphs/table rows from the shared inventory. **This is not complete clause-level proof:** owner mappings do not discharge every paragraph; unverified application, scale, governance/type, arbitrary closure, iterator, external destination, and other residual obligations remain explicit evidence gaps. The upstream inventory sometimes inherits the last owner across section/table boundaries; retain source key/text as authority. Do not count all344 as normative or as tested.

Main directly checked assertion families:

| Contract | Actual bounded assertions |
| --- | --- |
| RES-001–007; REUSE-001–008 | Restart labels/order/exact refs; current finality hooks; fresh equal vs retain; immutable prior values; path rebinding preserves old provenance; consumed-output cutoff; changed helper/body/version rollback and correspondence misses. See acceptance/{restart,source-policy,changes,integrity-io}, resolution/summary-validation, m4-acceptance/nested. |
| REUSE-009 | acceptance/admission-observers: hits precede gate, cold miss leaves no attempt/claim, check starts no source work/writes, post-commit observer failure preserves exact committed success. |
| PUB-001–006 | acceptance/{crash-recovery,stop-publication}, m5-acceptance/writer: reached kills, old/new atomic state, exact recovery, stale fencing and writer deadline; accounting/crash-recovery: durable acknowledged report survives independently. |
| RUN-001–005 | m5-acceptance/lifecycle and workspace/scope isolate concurrent contexts, reject late callbacks; stop/stop guards sends with permits; m4-acceptance/fold distinguishes open, missing and closed empty listing and allows successful siblings. |
| RUN-009–015 | m5-acceptance/{outcome-fold,deferral,replay,stop,publication,privacy}: settled coverage, durable quota passes, stable operation identity/no blind replay, operator resolution/abandon, stop/commit boundaries, correlation and value privacy. |
| RUN-016–017 | m4-acceptance/topology and fold: gate excludes work and preserves coverage; m5-acceptance/environments and journal/environments: scoped history and explicit recorded promotion. |
| ACC-001–003,005–008 | accounting/node-conformance and crash-recovery; m5-acceptance/usage: units/report dedup, request-level unknown usage, estimates with basis separate, durability acknowledgments and late stale-writer reports. |

The large-data target, full HR/remote-pagination/model workflow, supported preview/CLI behavior, all Machine/type declaration negative gates, trial representativeness and complete per-clause traceability were not established by this run. Known disclosed check-retention recovery behavior and parent-filed accounting/settlement issues remain separate; this report creates no duplicate issues.

## Missing target capabilities grouped by consumer need

### Preview and throttled observation — RUN-006–008; target M6

Attempted consumer path: retain a source result, fail a later refresh, then observe the latest prior value together with stale/accepted/unavailable status and that refresh error while leaving source invocation counts unchanged. The available alpha `run.read(reference)` (`core/src/workspace.ts:640`) returns deeply frozen author data for an exact reference. `check` reports verification boundaries and `recover` returns saved execution outcomes. None offers a preview envelope or observer subscription/throttled delivery. `IRun` (`supervision/src/contracts.ts:631`) lists the available operations; no preview callback/status lifetime exists. The actual exact-read isolation tests do not prove the missing refresh-envelope behavior. No proposed method or discriminant spelling is being treated as fixed. Group stale envelope, missing-vs-undefined, disposal and coalescing under this one missing observation capability.

### CLI inspection/explanation — CLI-001–004, A-16; target M6

Attempted consumer path: inspect an existing store's retained values, failed attempts, dependencies/current acceptance, waits and usage without loading analysis callbacks or starting a run. Neither the root nor any package manifest declares a `bin`, and no CLI package/application exists. The run API has exact reads, check/recover and operation views, proving useful isolation pieces, but those do not deliver the required usable standalone CLI/checkpoint. Do not create one issue per output distinction or invent the CLI command syntax.

### Discovery — RUN-003–005; target pagination/streaming work

Current `ICollectionResult` is a member snapshot plus completion status. Existing m4 fold tests prove early work with an open returned snapshot and closure gating. **DX's additional consumer control passed**: first run publishes2members/open and assesses both; later process returns4members/complete, retains first2 exact assessment refs and completes all4. Therefore repeated cumulative snapshots already support early downstream work over successive runs. Single-callback streaming/page commits are not demonstrated, but absence of that convenience is not a confirmed inability to perform early work. Parent/DX own any grouped pagination finding.

### Resource state observations — ACC-004; target gap outside additive M5 port

Attempted consumer path: preserve GitHub quota balances93then90 with reset and pool/window identity as nonadditive state, while retaining actual request consumption separately. `accounting/src/contracts.ts:110` explicitly allows **additive deltas only**, excluding cumulative snapshots/corrections; its alpha export/port has intents, reports, estimates and summaries, with no resource-state observation record/query. `resource-state.mjs` runs the available reporting route and intentionally fails the consumer latest-state assertion: putting both balances in a quantity unit sums183. This is expected for that API and demonstrates why an adapter cannot encode quota state there; it is not an arithmetic bug or permission to pass state as consumption. Required follow-up is a separate typed resource-state path, preserving provider/account pool and reset-window distinction without scheduling retries. Current operation `retryAt` handles eligibility timing but is not accounting state history.

Replay the intentionally red consumer probe from the built checkout:

```sh
node scratch/gap-hunt/contract-operations/resource-state.mjs
```

## V8/identity trace

The sole production `node:v8` import is `machine-node/src/node/index.ts:10`; `snapshot` returns `deserialize(serialize(value))` at23. Its runtime caller is the memory Store copy boundary (`history/src/store/memory/index.ts:38`), whose addresses are JSON tuples at28–34. Tracking's `snapshot(tags)` is unrelated revision tracking. No durable identity input from V8 bytes was located.

Durable History publication calls Value `encodeSnapshot(request.payload)` (`history/src/durable/index.ts:662`); `selected-index.ts:147,192` hashes MDS1 snapshot/selected-fact encodings. Value `value.ts:355,361` uses version prefixes plus canonical `toWire` JSON. Tracking `observer.ts:376,699` hashes source JSON/selected facts; Resolution `intent.ts:58,136,189` hashes JSON request/intent forms. Exact result locators are the `mdh1|` JSON tuple in `history/src/durable/locator.ts`. Thus the inspected durable identity path uses explicit formats and SHA256, while V8 supplies in-process copies. This source trace and equal codec hashes are not a full cross-version durable-run proof: Node24-built binding cannot open under26 due ABI mismatch. Track E preserves that limitation and the successful return-to24 reuse.

## Follow-up consumer evidence

Decision-required grouped drafts: [CLI](ISSUE-CLI.md), [previews](ISSUE-PREVIEWS.md), and [resource state](ISSUE-RESOURCE-STATE.md). Each states target stage, expected/observed/replay, severity/direction and duplicate-scan boundary. `surface.json` enumerates actual generated alpha contracts with the TypeScript checker; `preview-consumer.mjs` preserves the no-execution exact-read control; resource-state includes an additive positive control. No missing API spelling is invented. [Lazy iteration](LIFECYCLE.md) now has4strict-TypeScript/Jest passing controls plus an explicit returned-iterator ownership ambiguity.
