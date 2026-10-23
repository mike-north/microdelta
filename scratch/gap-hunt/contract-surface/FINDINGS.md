# A contract-surface audit (bounded)

Baseline c5802da. Codex worker (gpt-6.1-sol), operating for Mike North.
Governing sources: docs/spec/README.md, domain.md, architecture.md,
package-boundaries.md, experiments.md, reconciliation.md, validation.md;
root/core/example READMEs and docs/package-map.md. Applied spec-audit classification.
No production changes, provider execution or externally supported alpha API claim.

## Divergent: current package map denies implemented Accounting assembly

`docs/package-map.md` calls itself an implementation map of the current checkout.
Its Supervision row says the facade does not yet wire the accounting port; its
Accounting row says composition occurs only in tests until facade assembly. Its
later paragraph calls Accounting a development dependency consumed there only.
The facade actually accepts the caller's structural Accounting port:
`packages/core/src/workspace.ts:575,800–812,895–899`; core README documents it.
`workspace-operations/operations.test.ts` independently passes15tests including
external sends journaled through facade, environment-specific durable usage,
no-port failure behavior and invalid-port validation. This is documentation drift,
not missing Accounting functionality. Severity: low (misleads private consumers).
Smallest follow-up: update the map to describe caller-supplied Accounting assembly
and preserve the separate owner/schema boundary.

Minimal failing documentation assertion:
`node --test scratch/gap-hunt/contract-surface/package-map.test.mjs`.
It asserts that the current map does not deny the independently verified wiring;
`logs/package-map-failure.log` fails on the exact stale phrase. Runtime proof:
`logs/workspace-operations.log` (15/15).

Root README also says current-checkout assessment persistence/reuse are not
implemented; built-facade example8/8tests prove bounded durable assessment reuse.
Its0.1.0 first-release statement is historical, not a verified incorrect npm latest
assertion. Group current-status corrections with the stale implementation map.

## Aligned within executable coverage

| Contract / consumer claim | Executable evidence | Result / boundary |
|---|---|---|
| PKG-001,004,005; ARC-003,009 | build:packages (earlier), build:fixtures, check:declarations, check:imports | Pass; generated producer declarations and approved import edges; no arbitrary closure soundness claim |
| PKG-002,003,004,007,008; SPEC-4 | declaration-boundaries, foundation-wiring, trim-declaration-imports tooling tests |34/34pass; public/beta/alpha/untrimmed fixtures, missing producers, hidden leaks, wrong sibling tiers, skipped checkers and source bypass negative cases |
| ARC-010; PKG-008 | check:wiring, check:imports, foundation-wiring tests |Pass; mechanical host/import boundary evidence, not proof of every injected capability outcome |
| Example restart row | examples/contribution-report/test/example.test.mjs |Pass; cold and unchanged independent-process restart, exact references and zero bodies |
| Example rubric B/C rows | same, nested-equal-output-cutoff / changed-output case |Pass;6assessments rerun for B, parent references retained; C changes Ben/report only |
| Example minimum-authored rows | same, tracked-gate-instances cases |Pass;2skips Cy/report rerun;1again retains old results;starting2then1runs newly required Cy |
| Example open-discovery row | same, strict-fold-open-discovery case |Pass; report waits; closing again retains exact cold report |
| DOM-3, TEST-5 | sibling scale/FINDINGS.md |Two confirmed bounded work regressions;100k collection completion unproven |
| DOM-2 clear failure | sibling consumer-dx reflection probe |Actionable native-reflection rejection; initial dropped Error.message was consumer JSON serialization |
| RUN-003–005 partial discovery need | sibling consumer-dx/runtime.test.mjs |Three tests pass; successive open snapshots allow early assessments; single-live-run native streaming remains future scope |

Exact example check: `npm run build:examples`, then
`node --test examples/contribution-report/test/example.test.mjs` (8/8pass).
Initial direct invocation before building failed MODULE_NOT_FOUND; corrected
prerequisite is recorded here and is not a library defect.

## Evidence limits / remaining work

This is not exhaustive clause-by-clause conformance. We did not convert every
normative sentence in these documents into a new assertion. Existing tooling
covers structural contracts; independently rerun example and facade suites cover
the named consumer behavior. Parent/other workers own Tracking/Composition,
Execution/Operations faults, invalidation and portability. Require their evidence
before a global A-complete claim. The clause-block inventory in the contracts
worktree is discovery metadata, not executable evidence by itself.

Historical scaffold statements in architecture/package-boundaries, dated M0
validation.md, and superseded CML/Lean policies are historical context, not
present-runtime nonconformance. EXP-0 and EXP-1–8 adoption/proof obligations need
per-experiment acceptance records; these were read for status but not all rerun
here. Six ownership contexts remain authoritative; Machine's presence does not
create a seventh context or transfer persistence ownership.
