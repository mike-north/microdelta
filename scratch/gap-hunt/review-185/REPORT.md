# PR185 completed-context lifecycle review

Reviewed exact `aad9b93f23fb38b1cf1387e2f865c5490fc2b434` for #172. **Runtime PASS within the finite Node 24/26 diagnostic; regression gate PARTIAL.** A diagnostic environment flag can make the new focused gate accept the known old implementation by selecting the external workaround. This is not a claim that the repaired runtime fails retention or that whole CI can be bypassed.

## Governing requirements and source boundary

#172 AC 1–7 require bounded completed-capture retention without an author wrapper, preserved caller/nested/concurrent/throw/async semantics and detached closed-frame rejection, a bounded current workspace positive control, Node Machine ownership of host mechanics, and strict generated-declaration/type-aware checks. TRK-3, ARC-004/010 and A-18/A-20 govern capture lifecycle and host ownership. The PR adds the bounded retention expectation to these active contracts and IAsyncContext's alpha documentation; its changeset covers Machine and Node Machine.

Assignment head `5010548c9066711f312929b01aea0c7ec555b452` advanced to `aad9b93` by merging main. The eight changed files between them concern the CI matrix and supervisory review tooling/documentation; Node context runtime, its tests, lifecycle gate and fixture are unchanged. Evidence below executes the newer exact head, not an inferred carry-forward result.

The Node adapter now creates a short-lived AsyncResource at each entry, calls storage.run within its async scope, returns TResult directly and destroys the entry resource in finally. This adds no promise wrapper or author-visible await. Descendants retain their inherited store; destruction does not disable the storage or close a Tracking frame. Tracking still owns close/late-use policy. No public disposal API, author-owned wrapper, new host, persistence policy or provider call is added.

## Original fixture and observed repair

All nine original fixture/support files already present at this head match `04ff7ee680f48e6436abb92153601cec7ec1a828` byte-for-byte. `original-manifest.json` preserves their original paths/hashes and the `265cdef92d13830ca850c78a739c96bcd6ef5352` merged-main replay provenance. No fixture assertion, census, continuing caller, row, GC boundary or semantic control is altered.

The original default command independently installs locked dependencies, builds generated packages, strictly compiles its consumer and runs type-aware lint before Jest:

```sh
node scratch/gap-hunt/scale/repro-context-component.mjs
```

On Node 24.22.1 it passes 2/2. With that completed independent build, the same original fixture passes 2/2 on the existing Node 26.12.0 binary. Separate unchanged-worker processes confirm the raw census:

| Host/workload | Completed work | Post-GC live ALS samples | Confirmation |
| --- | --- | --- | --- |
| Node 24.22.1 standalone component | 100/200/300 observations | 2/2/2 | every second census matches |
| Node 26.12.0 standalone component | 100/200/300 observations | 2/2/2 | every second census matches |
| Node 24.22.1 fresh-source workspace | 3,000 bodies and checked outputs | 30 samples, all 3 | every second census matches |

The requirement compares finite batch growth <=4; the absolute counts are observations, not cross-platform promises. Tests retain the continuing caller while observers/captures/results become unreachable. The unchanged semantic control verifies caller context through await and rejection, nested parent restoration, concurrent isolation and a real detached read's closed-frame failure. The external wrapper remains a separately named positive control and is never enabled in the repair executions.

Node Machine's affected runtime suite passes 85 tests in 8 suites, including caller-store preservation, exact promise identity, rejected promise behavior, nested/concurrent contexts and inherited detached work. Tracking's 112 tests in 7 suites pass. Machine, Node Machine and Tracking strict TypeScript/type-aware lint plus tsd type contracts pass. The fixture uses generated public/alpha package declarations and built package runtime. Owner suites use their existing own-package test boundaries. macOS arm64 only; no Linux claim.

## Exact old-host sensitivity and restoration

The portable wrapper snapshots actual Node Machine source and verifies its exact reviewed Git blob, then temporarily installs the exact `471c1d47ef3dc0700e36d8da2adca7e02534570b` Node host source from the committed control. Only Node Machine is rebuilt; Tracking, the original fixture and its assertions stay unchanged. This is a host-source counterfactual, not a full checkout of the old runtime.

On that old host, the unchanged Node24 and Node26 component fixture each returns exit1: semantic control passes and retention fails with observed growth200 against allowance4. With the explicit external-wrapper flag each returns exit0, 2/2. Thus the repair diagnostic still rejects the old per-entry growth. A finally restores actual source byte-for-byte and rebuilds the host; original Node24/26 tests and the official gate return green after restoration.

The previously published frozen red evidence at `04ff7ee` and the merged-main replay at `265cdef` remain historical evidence. They are not rewritten or relabeled green; the original assertions now passing at the repaired head and the deliberately restored old-host red outcomes establish the before/after discriminator.

## Remaining focused-gate weakness

`tooling/context-lifecycle.test.mjs` spreads process.env into its child and sets only GAP_HUNT_REUSE_BUILD. The pinned fixture enables its external workaround when CONTEXT_COMPONENT_ISOLATED is 1. With the same exact old host still installed and rebuilt:

| Official gate environment | Exit | TAP result |
| --- | --- | --- |
| isolation flag removed | 1 | 0 pass / 1 fail |
| only CONTEXT_COMPONENT_ISOLATED=1 enabled | 0 | 1 pass / 0 fail |

The gate therefore does not deterministically enforce #172 AC2 under that inherited diagnostic flag. The smallest follow-up is to clear that flag in the ordinary tooling gate's child environment while keeping all nine original fixtures byte-identical, and test that inherited isolation cannot select the workaround. No product fix is included in this review. The wrapper removes the flag from every default/ordinary command; named external controls and the deliberate contamination case are the only exceptions. Runtime repair evidence remains valid in those clean environments. This is only the new focused gate; no whole-CI pass or bypass is established.

## Portable pickup and evidence boundary

With active Node24, npm and normal native build prerequisites:

```sh
python3 scratch/gap-hunt/review-185/reproduce.py
```

Default execution qualifies active Node24 only. To also reproduce the independent Node26 component/census/negative/restoration checks, explicitly set NODE26_BIN to an existing Node26 executable; the wrapper installs no second Node and contains no machine-specific binary path:

```sh
NODE26_BIN=/path/to/node26 python3 scratch/gap-hunt/review-185/reproduce.py
```

The local two-version receipt records Node24.22.1 and Node26.12.0. Node26 runs the standalone component without opening native SQLite; the real workspace and owner suites run on Node24. The wrapper verifies original hashes, independently bootstraps the original command, requires expected current/old/control exits, source-restores in finally and checks an evidence-only source allowlist. Exit0 means the documented runtimePASS/gatePARTIAL evidence matches; it does not turn the old-host negatives green or accept the weak official gate as sufficient.

Raw local outputs, synthetic workspace SQLite and Jest metadata stay ignored under local-results. Public captures replace checkout/home paths with placeholders and normalize ANSI/trailing whitespace; runtime summaries retain assertion names/statuses without local file paths. Initial source-head captures and a later fresh committed-checkout receipt are distinguished by their recorded head values.

Installed npm0.2.0 behavior is historical, separately recorded in #172; this source repair does not update a published package and no installed-package replay is claimed here. Node22's diagnostic remains unresolved and is explicitly skipped by the new numeric gate; semantic tests still apply there. No universal heap/latency bound, consumer timing attribution, provider execution, package publication, approval, PR edit or merge is claimed.

Implementer: GPT-6.1 Sol consumer_dx worker independently executed and packaged this bounded repair review for Mike North; it did not implement the product change.
Agent assistance: durability independently reviewed runtime/contract ownership and identified the inherited-flag gate concern; the supervising agent owns the final acceptance and public comment.
