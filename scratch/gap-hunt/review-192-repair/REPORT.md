# PR 192 finite result-root type verification

Production source `10a69df858944b5141c9ef1a9c80d72a6d3dea4c`, issue 156.
Owner decision: current alpha accepts record/array completed-result roots and
requires scalar calculations to use a wrapper. Scalar-root runtime expansion
is outside this repair. The frozen original reproduction is
`9267a44e1a203966e6ccd73db188e5826506326b`; its provisional scalar-success
expectations are historical diagnostic evidence, not the selected acceptance oracle.

Run in a disposable Node 24 checkout:

```sh
python3 scratch/gap-hunt/review-192-repair/reproduce.py
```

The runner installs locked dependencies, builds package runtime and generated
declarations, checks affected packages/declaration fixtures, and writes evidence
to a printed temporary directory (`MICRODELTA_EVIDENCE_OUTPUT` overrides it).
The counterfactual replaces Definition `declarations.ts`, `template.ts`, and
their matching API Extractor report baseline with exact bytes from main
`7677ec4d61fd78efc63da28906175707e1391f12`. It rebuilds all package declarations,
executes the type discriminator, and restores all three files in `finally`, rebuilding
and rechecking afterwards. No product fix is part of this branch.

## Acceptance mapping

1. **Boundary and wrapper documentation.** Active Tracking's bounded M3
   navigation decision explicitly states current-alpha record/array roots,
   nested scalar support, and continued runtime validation. The facade README
   supplies a complete `{ value: 6 * 7 }` memo plus a typed child consumer and
   composition; it explains serialized-string and present-undefined wrappers.
2. **Generated negative types.** The owner's generated-alpha tsd fixture has
   28 negative assertions: all five bare atom roots for source and memo in both
   inferred and explicit forms, promised scalar escapes, mixed unions, and
   member source/memo controls. Supported positive controls retain precise
   output types. The original positive scalar expectation is retained separately:
   it now produces five `object` constraint diagnostics; under the exact old
   Definition source, it passes again. The new negative suite fails against old
   source with precisely 28 missing expected errors and no unrelated diagnostics.
3. **Positive type and runtime controls.** Named interfaces without index
   signatures, readonly arrays, generic record wrappers, noncallable `then`
   data, and synchronous/asynchronous forms remain precisely typed. The full
   core tsd suite includes issue 169's direct/member async fresh and retain
   declarations. Focused runtime suites include the direct/member independent
   process async checks. A supplemental source/memo matrix rejects Date,
   callable roots, and nested callable data with `unsupported-result`, verifying
   zero `history_results` rows; the broad `object` constraint does not expand
   the runtime data domain. This is not a claim that TypeScript completely
   models serialization or rejects every native/class shape statically.
4. **Untyped runtime boundary.** The unchanged worker runs all five bare atoms
   through source and memo from JavaScript. Every case executes its body once,
   returns actionable `unsupported-result`, and publishes zero completed rows.
   The type constraint supplements this existing runtime guard.
5. **Nested atom and skip distinction.** Eight wrapped controls preserve exact
   string/number/boolean/null/present-undefined/-0/NaN/+Infinity values using
   `Object.is` and own-field checks. A separate facade control publishes and
   reads `{ value: undefined }` from one required member; its peer is skipped,
   has no outcome/reference, and runs no body. Exactly one member body executes. An additional nested-array control preserves
   -0, NaN, positive infinity and negative infinity exactly.
6. **Affected checks and explicit adaptation.** Definition strict/type-aware
   checks plus its full 281-test runtime/tsd suite, core strict/type-aware checks and tsd,
   core test compilation, selected root/async/keyed suites, generated declaration
   checks, and declaration fixture compilation/lint execute in the runner.
   The new official runtime suite asserts the selected rejection contract;
   the historical success-expectation matrix remains intact and intentionally red.

## Historical oracle preservation and discrimination

Four frozen files are checked byte-for-byte against the original commit before
any command runs. `prepare-original.mjs` changes only their import locations in
separate derived files and transpiles the historical runtime TypeScript without
claiming current-type acceptance. Both original source bytes and the exact
adaptation are reviewable. The historical runtime remains 10 failures and five
passing wrapped controls. This is the expected original inconsistency diagnosis.

Current selected generated types pass. Exact old Definition source (with its matching API report) makes all
28 selected negative type expectations fail and makes the historical positive
scalar type fixture pass, proving the restriction comes from the repaired
production declarations. Runtime behavior is unchanged by this type-only repair;
no old runtime scalar-success outcome is expected or claimed. Finally current
source and API report bytes and package builds are restored, selected types pass, and the
eight runtime supplements pass again.

The portable runner checks exact Jest test/suite totals and rejects loading
failures; it verifies exact negative-type diagnostics rather than accepting an
arbitrary nonzero exit. Its guard-only mode checks captured logs and rejects
synthetic missing/load-error/forged-count/wrong-count evidence:

```sh
python3 scratch/gap-hunt/review-192-repair/reproduce.py --check-logs PATH_TO_CAPTURE_DIRECTORY
```

Recorded host/platform and command exits are in `captures/receipt.json`.
This is finite source-pinned evidence, not a full-main, Linux, deployment,
paid-provider, release, or serialization-completeness claim. Supervisor owns
formal review, publication and acceptance. No ledger classification is changed
by this report alone.

The first counterfactual attempt restored only the two TypeScript files; API
Extractor correctly rejected the mismatched newer checked-in API report before
the negative type assertions ran. The runner now restores the exact old API
report alongside the exact old source and restores all three afterwards. That
initial harness setup failure is not a product failure or negative-type proof.
