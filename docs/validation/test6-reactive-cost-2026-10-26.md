# TEST-6 alternate cost and reactive consumers — 2026-10-26

Refs #271. Governing contracts: [TEST-6](../spec/acceptance.md#large-data-and-alternate-cost-acceptance), [TRK-3/5 and VAL-3](../spec/tracking.md), [REUSE-005](../spec/execution.md#reuse-005--nested-validation-preserves-the-consumed-output-boundary). This record qualifies an author-defined synthetic consumer through generated alpha `microdelta` authoring and real durable History. It does not qualify TEST-5, the contribution-report scale workload, M7 or a new runtime policy/API.

## Evidence boundary

The graph has keyed CPU-expensive memoized members, cheap memoized leaves and a CPU-expensive strict fold. A declared sibling parent consumes one selected child-output field. Local process cells hold the filter criterion and an explicit detached value/reference set read through `run.read` during a live run. Local filtering proves no storage-backed observation. Each accepted update explicitly replaces that local set.

A separate already-open public History reader brackets only settled filter-cell changes. A complete declared analysis/environment/subject/version manifest includes roster, aggregate, every expensive/leaf/parent subject and the one possible added member. It enumerates candidates, deduplicates exact references, reads envelopes, counts environment-specific acceptances and resolves root MDS1 materialized-output fingerprints. The two verification passes are outside the local filter timing interval. Counts cover this fixture namespace, not arbitrary database rows.

The fresh OS-process sequence first preserves every eligible exact result, then forces one parent-only input change: parent body 1, child body 0, original child reference. With that parent input frozen, an unread child-output sibling creates a new child result and retains the parent; changing the consumed child field reruns it. The named negative author mutation suppresses the selected-field read while retaining the child call and fails the consumed-child parent-execution assertion. This is a single-child observation oracle, not a corpus-wide observation-cost attribution.

## Test-first chronology

Behavioral tests were written before the fixture. The initial compile failed because the new fixture module did not exist; that was missing scaffolding, not a runtime behavior failure. The first runtime pass ran all three original tests: two failed because the new assertion helper incorrectly compared object property serialization order; one passed. Replacing that comparison with `isDeepStrictEqual` corrected the fixture oracle. Supported facade behaviors were already green when asserted correctly. Four tests then passed, including the named missing-observation mutation. Dedicated generated-alpha `tsd` and frozen-budget tests brought the focused suite to six passing tests. No runtime implementation was changed, and the negative mutation is assertion-sensitivity evidence rather than an original runtime RED.

## Kernel selection and budgets

A 16-key first smoke used 5 million integer-recurrence iterations per expensive member and 100 million for the aggregate. It measured 242.043 ms of kernel CPU versus 119.820 ms of unchanged-restart process CPU, motivating stronger separation from runtime overhead. A second smoke increased the kernels to 50 million/member and 500 million/aggregate; measured CPU was 1,829.602 ms in kernels versus 119.949 ms for unchanged restart. Those iteration counts were frozen before 512 qualification.

The final frozen-harness smoke directly separated 1,060.734 ms member-kernel CPU and 684.881 ms fold-kernel CPU. Cold wall time was 1,848.825 ms and process CPU 1,880.923 ms. The slowest normal request was 1,086.765 ms; unchanged restart took 87.382 ms wall and 117.188 ms CPU. Local filter intervals measured 0.117/0.143 ms wall and 0.104/0.127 ms CPU in cold/restart processes. These observed host costs justify costly CPU work relative to retained retrieval and local filtering; they are not universal ratios or latency promises.

The frozen public writer lease is 300,000 ms. Each complete OS-process phase has a hard 180,000 ms timeout, covering synchronous event-loop starvation as well as waits. The restart OS phase contains its bounded update controls. Disk/memory were checked before the one authorized 512 run. No retry after a resource failure or timeout was authorized.

## Qualification result

The single authorized qualification passed on code freeze `e9fe7b9a02c8f631f05bf39d7671fba1faa8fc8a`. Cold and restart workers had distinct PIDs; all seven phase assertions passed within their budgets. Every unchanged eligible expensive-member reference was preserved. Unchanged restart also preserved the aggregate and parent references. Membership added exactly one new key, giving 513 only in that explicit control.

| Phase | Expensive / leaf / parent / fold bodies | Wall ms | Process CPU ms | Kernel CPU ms | Observed max active author attempts |
| --- | --- | ---: | ---: | ---: | ---: |
| Cold 512 | 512 / 512 / 512 / 1 | 51,825.981 | 51,842.426 | 39,410.110 | 8 |
| Restart unchanged | 0 / 0 / 0 / 0 | 6,198.331 | 6,498.846 | 0 | 0 |
| Parent-only input | 0 / 0 / 1 / 0 | 4,829.407 | 4,915.893 | 0 | 1 |
| Unread child sibling | 1 / 0 / 0 / 0 | 4,653.612 | 4,733.748 | 69.369 | 1 |
| Consumed child field | 1 / 1 / 1 / 1 | 5,562.252 | 5,634.554 | 733.978 | 1 |
| Unread input field | 0 / 0 / 0 / 0 | 4,924.735 | 5,006.500 | 0 | 0 |
| Membership addition | 1 / 1 / 1 / 1 | 5,307.124 | 5,388.413 | 773.360 | 1 |

The cold member kernels consumed 35,883.827 ms CPU; the cold aggregate kernel consumed 3,526.283 ms CPU. Kernel timing varied across phases; causal attribution was not measured: later changed aggregates consumed 666.467 and 704.607 ms CPU. This is host evidence, not a stable CPU ratio.

The slowest public request was the cold expensive-member request, 39,673.920 ms, below the 300,000 ms public lease. The 180,000 ms process timeout was not reached. Cold/restart main-file sizes were 17,080,320 / 22,224,896 bytes; the final file was 48,087,040 bytes. The maximum reported process-lifetime RSS was 475,920 KiB. All timer sample counts were zero, so every heap metric is a boundary-only reading. Process-wide `fsRead` and `fsWrite` deltas were zero in these host observations; they do not establish zero database I/O.

The cold and restart filter intervals measured 0.389 / 0.279 ms wall and 0.316 / 0.249 ms process CPU. Both retained exactly 1,538 fixture results; their independently bracketed acceptance counts remained 514 and 2,566 respectively. Every retained envelope digest and root payload fingerprint remained equal. No normal request began and no source, memo or fold body ran during either interval. The larger acceptance count after restart is legitimate current validation outside the filter interval.

| Issue acceptance | Executable proof and retained evidence |
| --- | --- |
| Cold cost shapes and independent outputs | `reactive-cost.test.ts` first test and `assertReactiveCostQualification`: exact independent key/value maps, strict aggregate total/count, actual body counts and lifecycle in-flight observations |
| Settled local filter without rewriting snapshots | Same test: nonempty, empty, changed membership and equal criterion; exact value/reference views; complete fixture manifest and public History before/after census |
| Changed relevant input, unread input and membership | Seven-phase oracle: exact body cutoffs, explicit local value-set refresh, preserved references for every unchanged eligible expensive member and parent |
| Fresh tags and ordinary cached-child observation | Distinct OS worker PIDs; unchanged restart exact identities; forced parent-only execution and unread/consumed output controls; named suppressed-read mutation fails the consumed-child parent count |
| Generated declaration and author boundary | Dedicated `reactive-cost.test-d.ts` invoked by the ordinary Jest suite, fixture alpha `tsc`, strict type-aware lint and package-entry import gate |

Raw exact references, values, complete manifest tuples, snapshot/envelope digest comparisons, acceptance counts, process metrics and every local view remain in compressed raw receipts. Readable summaries preserve the direct metrics; they do not replace the raw behavior oracle.

## Artifacts, verification and limitations

Artifacts are in [`artifacts/test6-reactive-cost-2026-10-26`](artifacts/test6-reactive-cost-2026-10-26/manifest.json): readable `smoke-16` and `qualification-512` identity/qualification JSON, deterministic gzip raw receipts, and a SHA-256 manifest for both compressed and decoded bytes. The raw SQLite stores remain isolated temporary execution artifacts; the checked-in receipts contain the bounded evidence needed for review.

Reproduce the bounded run from the repository root after `npm run build:fixtures`:

```sh
node fixtures/contribution-report/.test-build/fixtures/contribution-report/reactive-cost-qualification.js /private/tmp/test6-smoke-new 16
node fixtures/contribution-report/.test-build/fixtures/contribution-report/reactive-cost-qualification.js /private/tmp/test6-qualification-new 512
```

Use a fresh, separate directory for each qualification. The ordinary repository fixture tests use 16 keys and tiny correctness kernels; they do not silently launch expensive qualification. Their generated `tsd` test is invoked by Jest without changing shared scripts. The dedicated driver's `qualification.json` says `passed` only after the independent seven-phase oracle completes; a worker error retains a `failure.json` with partial status.

Focused alpha compilation, six Jest tests (including the missing-observation mutation and tsd), strict lint and fixture import enforcement passed on the frozen source. Full same-candidate `npm run check` → `npm test` → `npm run build` and different-agent adversarial review are pending supervisory coordination. No publication is implied by this record. Code freeze: `e9fe7b9a02c8f631f05bf39d7671fba1faa8fc8a`. Frozen smoke ran before this commit was created, but every fixture and generated alpha declaration SHA-256 in its identity was checked equal to the clean committed bytes immediately before qualification. The 512 identity records the code-freeze SHA itself. The later readonly type-test repair changes only `test-d/reactive-cost.test-d.ts`; its original archived hash remains immutable evidence of the measured revision. The worker, qualification driver and runtime Jest test retain the exact measured bytes. The fixture differs only in its metric-scope comment; its executable behavior remains identical to the measured revision. No archived identity or receipt was retroactively changed and no 512 run was repeated.

Process CPU/time, process-wide `fsRead`/`fsWrite`, process-lifetime maxRSS (KiB), sampled heap bytes, main SQLite file size and public normal-request durations are measured directly. No selected-payload-load or fingerprint CPU/I-O attribution is claimed. Heap timers were starved in smoke: zero timer samples means boundary-only readings, not a covered heap peak. maxRSS is the process-lifetime high-water mark, not a phase-local RSS peak. Main SQLite file sizes exclude sidecars. Current validation may add acceptance records; only the settled filter intervals assert no fixture result, acceptance or payload changes. Verification costs stay outside filter timing. No live or paid provider, 150,000-subject run, private SQL, nested workspace run, owner assembly or runtime-policy change occurred.

## Full-gate correction

The first sequential full runner targeted clean `76932541b2824f796e7472695a7b8b65690e2296`. Its `npm run check` phase failed at 2026-10-26T21:37:04.350Z: the negative `tsd` expression `expectError(receipt.members.push({}))` deliberately referenced an absent readonly-array method, and the full fixture lint correctly reported `@typescript-eslint/no-unsafe-call`. The focused initial lint command had omitted `test-d`, while the dedicated `tsd` invocation had passed. This was a type-test syntax/lint mismatch, not a runtime behavior failure. The runner stopped immediately; `npm test` and the final explicit build did not start, and HEAD stayed clean and unchanged.

The scoped correction uses `expectError(receipt.members.length = 0)` to assert the same readonly-array contract without an unresolved call. No lint suppression or runtime source change was needed. The dedicated tsd command and strict lint including `test-d/reactive-cost.test-d.ts` passed after the correction. A fresh full same-candidate runner and independent review of this delta remain required.

## Metric wording clarification and interrupted gate

The next runner targeted clean `727109afb85c359aceb6290be6aa253905300fac`. `npm run check` passed at 2026-10-26T21:40:32.805Z, with that exact clean SHA before and after. The supervisor then requested more precise metric wording while `npm test` was still running. The owned runner and its descendants were stopped with SIGTERM at 2026-10-26T21:46:20.491Z; no owned processes remained and no forced kill was needed. The unfinished `npm test` phase and final explicit build receive no passing credit. Their partial logs and before-stop state remain preserved separately from the earlier failed runner.

The `ICostBodies` comment now identifies the observed interval as active author attempts from public `execute` through terminal lifecycle events, including publication work. It does not claim simultaneous physical body CPU. The record also describes timing variation across phases without attributing it to unmeasured JIT behavior. This comment/record delta changes no executable behavior; original archived hashes remain untouched. Independent delta review and a fresh full same-candidate runner remain required.
