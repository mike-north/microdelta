# Pickup-ready issue addenda

Codex worker (gpt-6.1-sol), operating for Mike North. Findings and acceptance criteria only; no production fixes.
Evidence branch: `gap-hunt-dx`; base `c5802daca4a0bb8ea91159854d84eddcfa5215b6`.
Self-contained runners and initial addenda are committed at abb9bab on that branch; later evidence-only commits update logs and ledger without changing the production baseline.

The commands below start from a clean checkout of that evidence branch with Node24 and npm on PATH. They install locked dependencies and build owner declarations themselves; no undocumented local tools, caches, prebuilt declarations, stores, macOS paths or paid credentials are needed. Linux execution has not been performed on this laptop; Docker is unavailable. They use portable Node/npm entrypoints and real SQLite. Package installation requires its usual network/native-toolchain availability. Bootstrap default was verified once with repro-154: npm ci and build:packages both completed, then its compiler negative/positive controls passed (logs/repro-154-clean-bootstrap.log). The other three runner paths were verified with the documented optional GAP_HUNT_REUSE_BUILD=1 environment variable against the same installed/built checkout; each reached its intended failing assertion. Default behavior always bootstraps.

## #159 — Acceptance acknowledgement readback amplifies with history

Governing need: DOM-3 and TEST-5 bounded materialization/scale; ARC-007 and RES-005 distinguish immutable history from current acceptance. One-row acknowledgement is a proposed regression boundary for the measured hot path, not an invented latency SLA. Actual insert readback is `packages/history/src/durable/index.ts:796` (all acceptances for result/environment, then find inserted id).

One-command clean-checkout repro:

```sh
node scratch/gap-hunt/contract-surface/repro-159.mjs
```

Expected baseline exit1 at the final Jest assertion: SQL rows returned to acknowledge successive inserts are `[1,2,3]`, expected `[1,1,1]`. The full-history control already passes with3records. Source test: `packages/core/test/gap-hunt-scale/acceptance-readback.test.ts`; log `logs/repro-159.log`.

1. Each successful recordAcceptance acknowledges the exact acceptanceId just inserted while reading a bounded number of acceptance rows, independent of previous acceptance count for that result/environment.
2. Explicit full-history inspection retains and returns all immutable records. Do not optimize the inspection API away or delete old rows.
3. Different results/environments cannot satisfy the inserted acceptance readback; wrong-id or stale evidence is not an acknowledgement. Keep dependency and writer-fence validation.
4. A failed insert/readback must preserve the existing transaction/failure contract; no new completed acceptance is returned speculatively.
5. Extend the counter regression with multiple results/environments and enough history to distinguish exact-id lookup from an accidentally newest-row lookup; preserve full-history positive controls.

Scope: History acknowledgement query/materialization plus regressions. No resolver policy, history deletion, schema migration, worker concurrency or public API redesign. Depends on real SQLite/History assembly test setup, already present. Preserve lease/transaction authority; no timing threshold needed.

## #160 — Publication repeatedly validates the root array

Governing need: DOM-3 and TEST-5. History selected indexing repeatedly calls Value observe at each address; the root array's full supported surface is scanned each time. One bounded regression at20/40records measures array-slot validation work, avoiding scheduler/latency assumptions.

One-command clean-checkout repro:

```sh
node scratch/gap-hunt/contract-surface/repro-160.mjs
```

Expected baseline exit1 at final Jest cost assertion: matched encoding work `[20,40]`, real stage+publish work `[1323,5043]`; doubling records exceeds `2*1323`. Source test: `packages/core/test/gap-hunt-scale/array-validation.test.ts`; log `logs/repro-160.log`.

1. Supported flat record-array publication avoids a whole-root scan for each selected address; doubled fixture work stays within the proposed linear bound while matched encoding control remains linear.
2. Exact root and selected nested values/fingerprints after publication match independently encoded observations, including sparse slots, undefined, -0/NaN and explicit array length where supported.
3. Unsupported accessors, cycles/shared references, symbols and malformed array surfaces still reject before completed publication. A validation cache must not admit mutation or unsupported values by accident.
4. Selected fingerprint comparisons still avoid loading root/unrelated payload; exact retained references and atomic publication remain unchanged.
5. Broaden the work counter to flat/nested records and multiple independent payloads so a per-process stale-validation cache cannot falsely pass.

Scope: validated immutable payload/index construction and owner contract tests. Do not remove selected indexes, weaken supported-value checks, introduce fake progress/lease renewals or promise fixed throughput. Keep Machine/Value/History ownership and injected ports. Storage amplification and100k capacity are measured separately; a VACUUM/compaction policy is not required by this finding.

## #161 — Current implementation documentation denies existing assembly

Governing claim: docs/package-map.md explicitly describes the current checkout; SPEC-1/2/4 require authoritative status/evidence distinctions. Root README's current-checkout no-persistence/reuse statements conflict with bounded built-facade behavior. Its0.1.0 first-release record is historical and is not itself a false npm-latest claim.

One-command clean-checkout repro:

```sh
node scratch/gap-hunt/contract-surface/repro-161.mjs
```

Runtime controls pass first:15facade operation tests and8example matrix tests. Final documentation assertion fails on `facade does not yet wire the accounting port`. Source: `scratch/gap-hunt/contract-surface/package-map.test.mjs`; log `logs/repro-161.log`.

1. Current package map describes caller-supplied structural Accounting assembly, including operation journal/usage integration; remove both unwired/until-assembly claims and incorrect development-only description.
2. Preserve Accounting's independent owned persistence/schema and History writer fencing; do not imply Accounting shares History's SQLite file.
3. Root README acknowledges bounded retained-analysis lifecycle available in project-private alpha and links the owning example/acceptance evidence.
4. Continue to state public external durable-analysis API is unsupported; current private alpha behavior must not become a published support promise.
5. Preserve dated historical validation/first-release facts with explicit historical framing; do not rewrite them to claim fresh CI/npm/release evidence.
6. Check current docs links and exact runtime/example matrix already proving the revised claims. Do not add tests that merely enforce arbitrary prose spelling.

Scope: root README/current package map and nearby status links. No runtime/API/release/version change. Existing runtime controls establish what may be documented; documentation consistency suffices for the fix.

## #154 — Private alpha onboarding lacks the transitive declaration recipe

Governing need: consumer onboarding, DOM-2 ordinary TS and PKG-004 generated sibling paths. PKG-003 intentionally makes alpha project-private; absence of ./alpha public exports is not a bug. Import-only fixture needs facade plus Definition/History/Resolution/Supervision/Tracking on this baseline; all11mapping is convenient but not minimal, and the old “all nine mandatory” statement is disproved.

One-command clean-checkout repro:

```sh
node scratch/gap-hunt/contract-surface/repro-154.mjs
```

Runner expects facade-only TS2305 then verifies the six-owner mapping compiles with strict checking and skipLibCheckfalse. Successful runner exit0 means the negative/positive pair was observed; it does not mean the documentation gap is fixed. No author-body inference error is mixed in. Source: `consumer-dx/alpha-import-only.ts`, `tsconfig.alpha-facade.json`, `tsconfig.alpha-six.json`; log `logs/repro-154.log`.

1. Document a checkout-relative strict private-workspace recipe including the transitive alpha declaration closure, with build prerequisite and legitimate runtime package resolution.
2. Use an import-only negative/positive fixture to isolate closure diagnostics; do not conflate explicit source envelope generics or unsupported root data with missing imports.
3. Keep external default public and beta boundaries unchanged; no public alpha export or skipLibCheck escape.
4. State mapping closure varies with consumer/API/baseline. Avoid unsupported all-nine/all-eleven minimum claims; recipe may use all approved producers for convenience.
5. Verify the recipe from a clean checkout and a sibling directory; no absolute home/worktree path may be required.

Scope: private developer recipe/compiler fixture or deterministic generator using existing approved declaration registry; public packaging support is out of scope. Depends on generated declarations before consumer checking. Respect allowed package edges even if all alpha types are visible.
