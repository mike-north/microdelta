# Exact-head PR178 false-reuse reproduction

From a checkout of this evidence branch, run:

```sh
python3 scratch/gap-hunt/review-178/repro-occurrence.py
```

The command installs locked dependencies, builds packages in this checkout, checks product files against PR head577644f188a80bf7b081804fd63fe23ba263f88f, verifies the six-file test overlay, compiles strictly, runs type-aware lint, and runs Jest against the real workspace runtime. Evidence-only commits after that PR head are allowed. All new output goes to ignored `local-results/`; committed captured logs are not rewritten.

Expected baseline: four controls pass and the current-subject/current-origin regression fails (expected2,actual1 reused). The wrapper exits0 only when Jest records exactly1failure,4passes,0skips and0runtime-error suites, with the expected failing test identity. This means the counterexample reproduced, not that the product passed. Installation/build/type/lint problems fail the wrapper separately.

A fresh detached checkout of exact577644f with byte-identical overlay completed this command on Node24.22.1/npm11.12.1/macOS arm64. `clean-evidence/` retains its commands, logs, Jest JSON and all eight process receipts. `overlay-hashes.json` records exact fixture bytes. No shared native module/build directory was used. Supplemental original156/164/173 diagnostic evidence remains in REPORT.md and the captured files; those are separate original-fixture executions on the same PR head.
