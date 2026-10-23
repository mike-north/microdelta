# Finite ACC-002 source-validation accounting probe

Governing contracts: ACC-002/003 (operations), RES-003/004/005 and REUSE-004 (execution). Product pin: `52e3786516a404e3433bef03807a027c8103786c`. This is one finite supplemental outcome outside the historical74 cohort; it changes neither that cohort nor whole-spec conformance claims.

The intended assertions were recorded before the fixture in ASSERTIONS.md. The supported path uses the facade source callback and its declared async helper, currentExecution().operation, injected durable Accounting, real Node SQLite History/Accounting, generated alpha declarations, and independent Node processes. Operations have synthetic in-memory perform callbacks; no live provider is contacted. No product implementation change is made.

Run from the repository root with Node24, npm, Python3 and normal native SQLite install prerequisites:

```sh
python3 scratch/gap-hunt/accounting-validation/replay.py
```

The default replay owns npm ci and package generation, strictly compiles the fixture against generated alpha declarations, applies the repository's type-aware lint rules, then runs one Jest scenario containing four independent processes. It prints an external temporary output directory; source, logs, receipts and real synthetic stores remain independently inspectable. It clears inherited build-reuse, Node override and GitHub token variables. No checked-in receipt is overwritten.

## Outcome and distinctions

Cold processA performs one source operation reporting100units, publishes the stable payload, and reports100units under its own run. ProcessesB/C reopen the same stores; finalityfalse forces actual source checking. Each performs one fresh independent validation operation reporting1unit, explicitly retains A's eligible result and reports1unit under its own run. Environment totals become101/102. Original runA remains100. Each successful retain records a distinct acceptance; it does not publish another result.

The exact reference and entire raw persisted history_results row remain identical across A/B/C, including serialized payload, original execution provenance, publication and producing attempt. The synthetic unit reports live in Accounting and retain their actual execution attribution; they are not inserted into the payload or confused with its provenance. The scenario checks distinct operations/request attempts and acknowledged success for each independent check. Binding strings deliberately identify independent synthetic checks; this does not prescribe a universal provider retry/idempotency policy.

The fourth process returns fresh equal data after reporting1unit. It correctly publishes a distinct exact reference with equal serialized payload; the unchanged retention assertion rejects it. This is a real outcome sensitivity control over the supported source API, not a product mutation, a discovered defect, or an expected failed suite. All test behavior is local and finite. Already-supported behavior was allowed to pass; no fabricated product failure was introduced.

The own-run summary explicitly uses the supported run filter. The unfiltered accessor intentionally summarizes the environment; its101/102 totals are not a current-run accounting defect. The default operation inspection is cumulative too, so the assertions select the actual run's request attempt rather than treating historical operations as new sends.

## Evidence boundary

The final recipe and capture are identified in summary.json. The receipt includes exact commands, source/host, log hashes, synthetic result-row hash and durable-record evidence hash. Logs disclose fresh setup and exact one-suite/one-test result. No full repository suite, crash/failure/cancellation/retry protocol, sharing/deduplication matrix, Linux, capacity, paid provider or deployment claim is established. Existing nonadditive-state and unknown-settlement work remains separate; deferred facade Accounting construction is bypassed only through the already-supported explicit injected port. No issue was filed, no product fix made, and no remote write performed.
