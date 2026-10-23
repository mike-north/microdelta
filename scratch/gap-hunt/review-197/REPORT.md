# PR197 bounded Resolution fault sensitivity review

PASS for the five added witnesses and handled-signal cleanup at source `b5bf8275e1f724aa5d5233d5023729d5430d90d0`. No new current-runtime defect was demonstrated. This strengthens finite fault discrimination for issue144; it does not close the separately specified ARC-008 fake-child seam in issue175.

## Governing clauses and outcomes

| Witness | Governing meaning | Exact boundary |
| --- | --- | --- |
| successful gate own implementation | TRK-2 and REUSE-008 observe the actual called implementation; CMP-8 tracks gates | Current result includes required gate self observation. Removing only gate tracking is rejected. No general gate-population proof. |
| concurrent direct memo calls | CMP-5 ordinary child nesting; current request-local direct-invocation sharing decision | Two calls return expected data and one helper/body execution. This tests sharing, not the entire hierarchical cutoff contract. |
| supplied intent | PUB-004 stable attempt recovery and current invocation distinction; CMP-6/7 and REUSE-006 correspondence context | Equal invocation hashes match; changed argument or implementation differs. No crash, arbitrary closure, or universal digest-collision claim. |
| supplied own implementation | RES-003 preserves provenance supporting execution; REUSE-008 requires implementation evidence | Craft only one missing self implementation observation in an otherwise stored supplied candidate; Resolution rejects integrity. |
| fold own implementation | RES-003, REUSE-008 and CMP-8 infrastructure integrity boundary | Remove only fold self implementation observation; fold reports integrity. Real History assembly, not fake child-resolver isolation. |

All five current witnesses pass. Canonical baseline/restored suites pass 78/78 and every one of 34 exact mutation controls is rejected; each added control fails exactly its corresponding new named witness. Original-three-suite adapter selects the unchanged pre-existing three suites and only five added plants: baseline/restored 73/73, every planted fault leaves zero failing tests, so runner reports FAIL5 as intended. Adapter changes selection only; assertions, source anchors, faults, copied-package loading and fail-closed judgment stay unchanged.

## Fresh bounded execution

A new detached checkout had no node_modules. Locked install, package and fixture builds, strict Core test compilation, changed-file type-aware lint, all34 anchors, five-witness Jest, cleanup regression and canonical mutation runner succeeded. The initial nine canonical commands are in receipt.json; there was no redundant full repository test run. Runtime executed the exact PR source; this later evidence commit contains report-only additions and was not separately replayed.

Cleanup regression passes under current handler. Replacing only the runner with exact immediate pre-fix `c2fc173a961f361b9a744c705609664477be1722` produces the named assertion that the interrupted runner must remove its isolated checkout. Restoring current runner makes cleanup and all five witnesses pass again; source bytes and all Resolution emitted artifact hashes remain unchanged through that valid counterfactual.

An earlier whole5e3 runner negative was invalid for this question: that version predates disposable isolation, so it fails before the signal at the isolated-checkout census. Its log is retained as excluded evidence. The runner was restored and emitted packages rebuilt before the valid immediate-pre-fix negative. That invalid failure is not counted as cleanup sensitivity.

## Historical coverage disposition

Historical74 ledger remains immutable, with private overlay 72 mixed-pin passing, one insufficient, one missing. No denominator increase and no all-main rerun claim. The added gate witness strengthens TRK2-called-only; direct memo sharing supplements CMP5-hierarchical's request-local behavior without replacing its hierarchical-output oracle; supplied/fold missing-own witnesses strengthen REUSE008-tracking-generation-current and CMP8-infrastructure. Supplied invocation intent is separate protocol sensitivity evidence. CMP8-gate-kind stays insufficient (its full-target undefined/skip question differs); ARC008-fake-child-isolation stays missing/issue175. These five assembly witnesses do not supply the required fake child-resolution contract seam.

This is synthetic macOS/Node24 evidence with real local SQLite. No Linux, paid provider, package publication, release automation, whole-spec completeness or deployment qualification. Supervisor owns acceptance and publication.

## Reproduction commands and limits

From this evidence checkout with Node24/native SQLite prerequisites, run:

```sh
python3 scratch/gap-hunt/review-197/canonical.py
```

This command performs the initial nine canonical/current checks (locked install, builds, compile/lint, anchors, witness, cleanup and canonical34 controls). It does not replay historical counterfactuals and cannot establish the old-three-suite gap by itself. The captured product execution occurred at b5bf827; these later support scripts make the command recipes concrete but were not executed as new runtime evidence.

After canonical setup, the exact old-three selection adapter construction and invocation are retained in `original-three-adapter.py`:

```sh
python3 scratch/gap-hunt/review-197/original-three-adapter.py
```

The adapter expects its nested runner exit1 because all five plants survive the original three suites; the adapter exits0 only for that expected runner status. The retained log additionally records baseline/restored73 and each plant0fail.

The valid cleanup negative uses the exact immediate pre-fix runner, restores it in finally, and reruns current cleanup:

```sh
python3 scratch/gap-hunt/review-197/cleanup-counterfactual.py
```

The excluded whole5e3 runner experiment is deliberately not a recommended replay recipe.
