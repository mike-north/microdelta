# C scale evidence

Baseline c5802da, Node 24.22.1, Darwin arm64. Synthetic fixtures only; no production edits. Current corrected measurements and deterministic reproductions lead this report. Historical/confounded measurements are explicitly separated below.

## Publication repeats root-array validation

Matched record-array fixtures (512-byte body) publish 1k/2k/4k records in 361/1251/4979ms; matched encoding costs 2.10/2.52/4.00ms. JSON sizes are 558781/1119781/2241781 bytes; closed SQLite sizes are 3190784/6250496/12345344 bytes. CPU samples concentrate in assertArraySurface (3792), isArrayIndex (387), and its regex (348). History buildIndex calls observe at each address, repeatedly validating the root array surface.

The deterministic Jest probe `packages/core/test/gap-hunt-scale/array-validation.test.ts` preserves native Object.getOwnPropertyNames and sums array slots exposed during real stage+publish. Doubling 20 to 40 records yields matched encode work [20,40], publication work [1323,5043]; the proposed linear-growth regression boundary fails (5043 > 2646). This is bounded work evidence for the tested shape, not a general complexity proof or promised latency SLA. Direction: validate immutable payloads at the trusted boundary without repeating full-root validation for each address. Log: `logs/array-test-failure.log`.

20k records complete in 155544ms: 11237781 JSON bytes become 61779968 SQLite bytes. One-result store: 80001 nodes, 80000 edges, 80001 addresses, 15083 pages, 2956 free. VACUUM on an isolated copy reduces it to 49025024 bytes in 382.6ms. Index overhead and retained history are intentional; absence of automatic VACUUM is not asserted as a contract defect.

## Corrected repeated-use and fold coverage

The earlier repeated-use samples reused requestKey `same`, contrary to the normal
request contract, and GC was mistakenly included in reported elapsed time despite
the replay README wording. They remain historical output only. `context.ts` now
uses request:<batch>:<iteration> and captures elapsed before explicit GC.
Corrected fresh-store results: same-source69->394ms per100requests over2000runs;
AsyncResource74->406ms; fresh-subject+GC72->63ms, heap8.30->8.69MB. These preserve
the history-growth finding with the proper request contract. See `context-unique-*`.

Matched record-array encoding control (same records/body size as publication)
1k/2k/4k:2.10/2.52/4.00ms; publication361/1251/4979ms. These corrected output
samples are `benchmark-matched-node24.jsonl`. Numeric-array encoding remains a
separate simpler control and is not presented as matched work. No fixed SLA claim.

Wide/deep strict-fold assertions pass: width1000/depth1 total500500 (1717ms);
width1/depth10 total10 (19.6ms),depth50 total50 (63.0ms),depth100 total100
(124.9ms). Each reads the completed fold result and compares against independent
arithmetic width*(width-1)/2+width*depth. No gap found within these bounded cases.
The initial fixture wrongly aliased child slot prior rather than its declared
sibling slot and was rejected illegal-edge as required; preserved initial logs
are consumer fixture errors, not framework failures. Static chains compile under
strict TS; all generated fold probes pass type-aware lint.


Collection fanout: 1k members all succeed in1492ms (4411392-byte store); 10k all succeed in54866ms (42921984-byte store, ~104MB heap). The100k run is killed at10s during discovery with no settled result; no100k correctness claim. Some timing overlapped light probes.

The consumer's actual AsyncResource wrapper creates its resource before execute, including authoring/composition, and uses runInAsyncScope(work).finally(emitDestroy). Our control wraps workspace.run and does not reproduce that full boundary. The reported native ALS issue remains unconfirmed, not disproved. Fresh-subject explicit-GC heap remains8.30->8.69MB over2000runs; RSS growth alone is not a leak proof.

All scale probes compile under strict TypeScript and pass type-aware lint. Wide/deep independent arithmetic assertions pass. The two new Jest tests are intentionally failing regression targets, not fixes or merge-ready green tests.

## Deterministic acceptance acknowledgement reproduction

Supervisor source review refined the hot path: `recordAcceptance` inserts a new
row, then calls `statements.acceptances.all(resultId,environment).find(id)` inside
the writer transaction to acknowledge that exact insertion. The full-history
`readAcceptances` inspection API is not itself a bug. New assembly Jest test
`packages/core/test/gap-hunt-scale/acceptance-readback.test.ts` instruments real
SQLite and fails expected[1,1,1] vs actual[1,2,3] returned acceptance rows over
three acknowledgements. Full inspection still has all3records. Exact commands
in README; failure log `logs/acceptance-test-failure.log`. Strict TS compile
passes, repository type-aware lint passes after routine curly-brace correction.
Suggested direction: query the exact inserted acceptanceId for readback while
preserving intentional all-history inspection and immutable retained records.

## Historical appendix: superseded initial samples

The following original notes are retained only as historical evidence. Repeated request keys and GC-in-timing confound their reuse numbers; the numeric-array encoding control is not matched to publication. Their statements about missing wide/deep coverage and suggested latest-acceptance lookup are superseded by the current findings above.

## Confirmed: per-array validation repeats quadratically while indexing

`node node_modules/typescript/bin/tsc -p scratch/gap-hunt/scale/tsconfig.json`
`node --cpu-prof --cpu-prof-dir=scratch/gap-hunt/scale/logs scratch/gap-hunt/scale/dist/benchmark.js`

Fresh-store samples (source arrays of records with512B body):

| records | JSON bytes | closed SQLite bytes | publication ms |
|---|---:|---:|---:|
|1000|558781|3190784|388|
|2000|1119781|6250496|1268|
|4000|2241781|12345344|4898|

Encoding-only array control 1k/2k/4k/8k/16k:0.63/0.97/1.01/1.97/3.83ms. CPU profile `CPU.20261022.224219.44587.0.001.cpuprofile`:3792 samples in assertArraySurface,387 in isArrayIndex,348 regex; total ~5k. History buildIndex computes selected evidence at each address; Value observe validates root array surface for each address. Doubling record count roughly quadruples publication time, while bytes grow linearly. DOM-3 and TEST-5 require narrow materialization/scale evidence, not a fixed time SLA. Consumer need:~70k PRs/~90k reviews without quadratic root scans. Direction: validate immutable payload once at trusted boundary and avoid full root-array validation per selected address. Storage amplification measured~5.5x here; no claim this matches consumer's14.6x workload.

20k records completed:11,237,781 JSON bytes ->61,779,968 closed SQLite bytes,155,544ms (155.5s). logfile large-node24.jsonl. Bounded600s lease. This is a synthetic single source publication; no narrow downstream consumer was loaded.

## Confirmed: retained acceptance history makes repeated reuse slower

context.ts,20 batches*100 runs over same source, body100 Promise.resolve ticks. First/last batch65/426ms. Per-run AsyncResource control73/491ms: it does not remove slowdown. CPU profile `CPU.20261022.224330.49751.0.001.cpuprofile`:2310 toRow,433 sqlite all. History acceptances loads every acceptance for result/environment. Fresh-source control (new subject each run, same DB/process) first/last batches remain approximately60ms; logs/context-fresh-source-node24.jsonl. Empty-run control also flat1-4ms. This supports history lookup amplification rather than proving the reported AsyncContextFrame issue. Known ALS gap remains unverified. Direction: query latest acceptable evidence without materializing entire acceptance history; retain historical inspection separately.

Coverage: same-source reuse writes acceptance rows, so growing SQL work is real but workload is not computationally identical at storage level. AsyncResource control creates resource in caller context; no claim of universally isolating inherited ALS. Only2k sequential runs. No100k/wide/deep fold proof. Current TS compiles and type-aware lint passed; focused Jest exercises consumer pipeline, not performance thresholds.

## Further bounded coverage

Collection template fanout1k:1000succeeded,1492ms,4,411,392B closed store;10k:10000succeeded,54,866ms,42,921,984B,heap~104MB at settle.100kSIGKILL at10s during discovery with no settled report (collection-runner.mjs, logs/collection-*.log). No100k correctness/throughput claim. Timing overlap with light other probes is a limitation.

Fresh-source2k-run heap after explicit GC stayed8.23MB at100runs to8.68MB at2000; RSS83.5MB ->141.2MB (allocator/storage/cache retained memory not automatically a leak). Same-source store has1result/1999acceptances. This is not reproduction of caller ALS growth.

For20krecord one-result store:80001nodes,80000edges,80001addresses,15083pages,2956freepages. VACUUM on an isolated copy reduces61,779,968B ->49,025,024B (~12.75MB freed),382.6ms. Compaction still~4.36x JSON size, with valid index overhead. Store retains history intentionally; absence of automatic VACUUM is not asserted as a contract failure. store-layout probe reads local raw artifacts and was excluded from minimal replay because its paths identify this run.

Consumer's actual AsyncResource workaround was read in contribution-reports/.worktrees/integrate/packages/pipeline/src/runtime/index.ts: withStepContext creates one AsyncResource before execute, runInAsyncScope(work).finally(emitDestroy), and wraps both source and memo. Our isolated-workspace control does not cover fresh authoring/composition inside the boundary; original consumer hypothesis remains unconfirmed by this pass.

