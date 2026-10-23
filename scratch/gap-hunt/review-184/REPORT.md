# PR184 candidate access-path review

Reviewed exact `8b5c7d82185fa17ac3a6cf96e5fe5c3b3cc11ea7` for #177. PASS within the issue's finite candidate-work discriminator and generated-declaration History/facade correctness boundary. No complete consumer timing causality, capacity guarantee or Linux execution is claimed.

## Governing contract and unchanged historical proof

Issue #177 AC 1–7 require bounded unrelated-subject work with one eligible result; same/other-environment and other-analysis controls; exact promotion/analysis/subject/version/order and rollback semantics; read-only discovery; real History/facade integrity coverage; and a production-derived gate sensitive to the old query. DOM-3/TEST-5 govern bounded large-workload qualification; RES-001/002/006, REUSE-001/008, PUB-001/004 and RUN-017 preserve scoped identity, immutable rollback history and explicit recorded promotion.

`original/repro.py` and `original/captured-sql.json` are byte-identical copies from `8cdb4d95d9d37987e98976b7ca8da1d18d727684`, verified by `original-manifest.json` and Git blobs. Relocation keeps their adjacent-file relationship intact. The unchanged historical reproduction still exits1 with 5,100 VM steps > 1,200 allowance, after all 18 measurements and semantic controls. That frozen capture cannot target the new query and is not relabeled green. The new bridge is separate.

## Production source and deterministic work

`production-vm.py` extracts the candidate statement and 6 table/index DDL objects from actual checked-out History source and uses the production VM helper without changing its SQL. Source/query/schema hashes are retained. It separately extracts the exact old broad query from parent `471c1d47ef3dc0700e36d8da2adca7e02534570b`. Synthetic rows bypass publication/integrity, deliberately separating access-path work from real API correctness.

| Filler population | Repaired100/1000/10000 VM instructions | Exact-parent old query |
| --- | --- | --- |
| same analysis/environment, unrelated subjects |179/179/179|600/5100/50100|
| same analysis, other environment, unrelated subjects |179/179/179|600/5100/50100|
| other analysis |179/179/179|106/106/106|

Every query returns exactly the one eligible result; absent-subject controls return none. The finite threshold is later populations<=2x100-row work, not a universal constant-time SLA. Python SQLite 3.54.1 counts every VM instruction. The unchanged official production-source query test additionally checks Node SQLite 3.53.0's complete local-subject index and target-promotion access paths, rejecting an analysis-only result scan; it passes1/1. This is counter evidence plus native access-path corroboration, not a plan-string-only or wall-time proof. Different SQLite patches can yield different absolute counts.

The source-derived semantic cases require all eligible candidates newest-first, explicit promotions, duplicate promotion deduplication, exact version and other-analysis isolation. Additional tiny controls require: a stage-target promotion does not transitively admit a trial result into production; a result eligible locally and by explicit promotion appears once; direct promotion admits the exact named result; another version stays absent. No recursive environment graph was introduced.

## Real History/facade coverage

Generated declarations are built before tests. Four unchanged checked-in suites pass 56 tests, 0 failures, 0 runtime-error suites:

- journal/environments: candidate read-only row snapshots, exact subject/version/order/all candidates, older-version rollback with current pointer unchanged; duplicate/unrelated promotion filtering; cross-analysis promotion refusal; environment and exact-reference admission.
- durable-history/durable-history: candidate rollback/current/acceptance separation and corrupt, malformed provenance/unsupported encoding integrity refusal through real History.
- workspace-operations/operations: generated microdelta facade trial/production behavior and explicit promotion under writer authority.
- m5-acceptance/environments: environment isolation and real trial-to-production behavior.

Strict compiler and type-aware lint checks pass for History and microdelta, including test source. Source reviewer independently checked algebraic eligibility equivalence, argument binding, unique-publication ordering, envelope integrity path and unchanged schema/API. Those semantic source checks complement, rather than replace, this runtime evidence.

## Sensitivity and restoration

The wrapper temporarily replaces only the actual production candidate SQL literal with the exact parent's old broad query and runs the official source-derived query test. It does not execute that temporarily mismatched API binder or rebuild runtime code. The gate must fail with 0 pass / 1 fail for same-environment VM growth. A finally restores the source bytes, verifies exact hash, and requires the production gate1/1 again. Historical oracle and test assertions remain unchanged. This establishes source-derived work-gate sensitivity, not a claim that the old algorithm violates eligibility semantics.

## One-command pickup and evidence boundary

```sh
python3 scratch/gap-hunt/review-184/reproduce.py
```

Prerequisites: Node 24.22.1/npm, Python 3 sqlite3, npm registry/native install prerequisites. The runner independently installs dependencies, builds package declarations, runs the frozen historical red proof, new source-derived counters, native gate, 4 runtime suites, strict checks, exact-parent SQL negative and restoration. Its source-change guard accepts only this review's evidence prefix relative to the reviewed pin. Local raw outputs remain ignored under local-results; captures are sanitized public evidence. The wrapper's exit 0 means the repaired gate and semantic controls pass while the historical and deliberate-old-source negatives retain their intended exit 1.

The promotion arm may still scale with recorded promotions into the target environment; this does not certify arbitrary promotion populations. No schema/API/migration change, provider invocation, publication, PR edit, approval or merge is part of this review. This is macOS arm64 evidence only.

Implementer: GPT-6.1 Sol durability review worker for Mike North prepared and executed this independent evidence; it did not implement the product fix.
Agent assistance: consumer_dx independently reviewed source against AC 1–7; the hunt supervisor owns public posting and evidence assessment; the repository supervisor owns acceptance and merge.
