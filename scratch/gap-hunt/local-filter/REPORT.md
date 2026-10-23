# TEST-6 retained-result local filtering: bounded PASS

Runtime source `52e3786516a404e3433bef03807a027c8103786c`. This is one finite witness for TEST-6's mutable local filter over retained results and fresh process-local tags after restart. It does not close the entire TEST-6 CPU-cost/aggregate scenario or claim a universal reactive integration surface.

```sh
python3 scratch/gap-hunt/local-filter/reproduce.py
```

The runner performs locked installation, package build, strict generated-alpha consumer compilation, type-aware consumer lint, one Jest witness, one precise local invalidation fault/rebuild/witness, and exact restoration/rebuild/witness. All nine commands returned expected exits. The final source is restored byte-exact. Generated alpha declarations are the only cross-context type mappings; runtime imports resolve built legitimate package exports. No source alias, new facade, product fix, provider call or new host implementation is used.

Process A publishes one SQLite-backed exact result containing two names/scores and a 20,000-character unread field, then exits. Independent processes B and C reopen that same store/reference, instantiate fresh local Tracking cells and derivations, and materialize selected scalars through the exact History reader. Each starts with threshold 5 selecting Ada; a cached read evaluates nothing new; threshold 1 selects Ada and Ben; threshold 10 selects nobody. Each derivation evaluates exactly three times. A separate observer/materialized reader is created and read before filter changes, and the same view still reads Ada afterward. Each materialization capture records only its consumed score/name fields. The unread field receives no selected read. Explicit full-payload integrity verification occurs separately after the selected-read observation window.

Exact reference, envelope and original provenance remain equal to process A. Full payload equals the independent expected record. Database-file SHA remains unchanged after both complete view processes: filtering neither publishes results nor rewrites retained History. No claim is made about arbitrary application code or simultaneous writers.

Sensitivity: replace exactly the single `dirty(tag)` call in `cell.set` with a comment, rebuild only Tracking, and run the unchanged witness. It fails exactly its named assertion at the widened filter: cached Ada survives the new threshold instead of Ada+Ben. There are no suite-loading errors. Restore exact Tracking source and rebuild; the witness passes again. This is an injected control, not a current implementation defect. No fault is committed.

The direct observation fixture needs one documented line suppression of `microdelta/tracked-captures`: it deliberately invokes a process-local cell derivation inside a lower-level materialization capture, rather than declaring a durable tracked function. This follows existing observer-test treatment of lower-level capability tests; type-aware lint otherwise passes unchanged. It does not promise durable semantic dependency replay through an arbitrary cached local derivation; the fixture asserts local filter updates, selected reads when evaluated, and immutable durable inputs only.

Committed captures contain the exact successful and fault logs/JSON plus command receipt, normalized for filesystem privacy. Installation and build use the recorded macOS/Node host, not Linux. No paid-provider, deployment, scale, timing or whole-spec-conformance claim.

Outside-cohort traceability is private under `control/outside74-clause-reconciliation.{json,md}`: all 58 historical DX normative paragraph rows and all 16 operational not-reviewed rows retain separate dispositions. 294 exact source-test anchors are source evidence, not new runtime passes. Historical inventories and the 74 ledger are untouched. ACC-002's real validation usage probe is owned separately; fake child seam #175, scale #159/#160/#173, CLI #167 and preview #165 remain distinct.
