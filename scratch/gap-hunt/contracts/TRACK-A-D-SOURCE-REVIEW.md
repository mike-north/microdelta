# Tracking/Composition source review and Track D reconciliation

Implementer: Codex worker (gpt-6.1-sol), operating for Mike North.

This follow-up corrects the historical finite-outcome audit rather than treating its 64/71 count as completion. The governing sources are `docs/spec/tracking.md`, `composition.md` and ARC-008 in `architecture.md`. `source-review.json` preserves all 71 prior rows, their named assertions and execution logs, adds ten precise assertion routes, and qualifies ten rows. The prior `completion-audit.json` and `TRACK-A-COMPLETION.md` remain historical snapshots; this report supersedes their overbroad claims described below.

## Verification boundary

Production remains `c5802daca4a0bb8ea91159854d84eddcfa5215b6`. Existing evidence includes the verified-load #144 matrix (221 baseline and restored tests) at test branch `54dd948`, and the six fresh-process imported-artifact cases. This follow-up executes two added tests and Tracking/Core strict checks. It does not rerun the old inventory or relabel old execution as merged-main evidence. Hashes of added source, logs and governing files are in `source-review.json`.

The merged spec at `f43c5872987573d9b98a19f41c324b4d9336894c` adds bounded container-kind navigation to TRK-5, including the pass-object row. Baseline no-kind evidence is therefore historical. #155's old nullable-guard failure must not be described as current after #171. The separate Node 24 #172 merged-runtime verification is committed on `gap-hunt-review-172-main` at `265cdef92d13830ca850c78a739c96bcd6ef5352`; it is not a rerun of these 71 rows.

## Corrections to mandatory evidence

| Owning requirement | Source-level judgment and executed evidence |
| --- | --- |
| TRK-1 imported tracked declaration | The old import probe wrapped a raw imported function locally and did not prove this obligation. New `gap-hunt-contracts-imported-declaration.ts` exports an already-tracked helper. Its consumer invokes it without rewrapping. The new test passes. |
| TRK-2 / TRK-4 tracked closure | The same helper implementation observes its module's tracked configuration. Repeated derivation stays at one body; replacing tracked factor 2 with 3 changes result 6 to 9 and body count to two while helper implementation evidence stays equal. A separate current-fact comparison proves unread metadata remains irrelevant. Replacing a local reactive cell dirties its derivation; this test does not claim field-selective local-cell recomputation. |
| TRK-3 frame lifecycle and cache replay | Retain exact existing async/concurrent, post-await failure, detached-after-success/failure and cached-success/failure tests in the per-row map. No arbitrary asynchronous closure soundness is inferred. |
| TRK-4 lint negatives | Retain named branded/untracked capture fixtures and transitive capture lint probe. These implement documented syntax coverage, not a sandbox for arbitrary JS. |
| TRK-5 length and positions | Old operation/address assertions alone were insufficient. `gap-hunt-contracts-invalidation.test.ts` executes same-length replacement/equal, append/changed, insert-before/changed, edit-after/equal and unread-field/equal rows. Map those actual transitions. |
| TRK-5 own/inherited semantics | Value tests and the tracking special-key transition sequence establish own-absent/inherited-present/missing behavior in the supported domain. #162 intrinsic presence overrejection remains baseline divergence evidence; unsupported intrinsic value reads are a different operation. |
| TRK-6/7/8 current paths, identity, branches/output | Keep multi-hop rebinding, later changed current path, unchanged historical provenance, explicit identity and abandoned-branch evidence. Input-bound returned-subtree precision remains #164 baseline evidence. Do not infer those guarantees from local derivation alone. |
| CMP-1/2/3/4 frozen topology, supplied slots, templates/precedence | Existing named tests cover copied/frozen author structures, dynamic evidence, missing/ambiguous slots, child implementation ownership, once-only symbolic factories, reverse registration, member binding and independent sibling precedence. Custom-key alternative rejection remains #168 baseline evidence. |
| CMP-5/6 hierarchical current correspondence | Existing controlled callbacks establish changed child implementation/equal consumed output/new child reference with zero parent bodies and exact parent retention; structural missing/ambiguous/reordered correspondence is distinct from function names/text/identity. |
| CMP-7 argument negatives | Add exact executed `nested/arguments.test.ts` forwarded-unjustified and current-path-unavailable cases, plus `nested/validation.test.ts` unreconstructible argument. Prior derived-unjustified evidence was not a substitute for the forwarded variant. #144's 221-test baseline/restored matrix includes these. |
| CMP-8 gate negatives | Include both promise and thenable rows in `keyed/members.test.ts`, alongside scalar nonboolean, failed read and explicit false skip tests. |
| CMP-8 success undefined | **Spec scope reconciliation required within #156.** `composition.md:131–135` says “Distinguish skipped/no-value from success returning undefined, failure, cancellation and pending work.” Current-alpha owner selection permits record/array roots. Wrapped undefined data is not proof of bare undefined success. No duplicate issue or new result-root decision is proposed. |
| CMP-8 strict infrastructure | Old map covered admission only. Existing malformed version-3 fold evidence and #144 own-implementation removal cover integrity. New `gap-hunt-contracts-fold-observer.test.ts` explicitly throws from a member's pre-execution observer and asserts request rejection `observer-failure`, no fold body and no fold publication; it passes. Post-commit observer diagnostics preserve committed outcomes under separate existing tests. |
| CMP-8 entries, readiness, coverage, outcome facts, correspondence, cancellation and no retraction | Keep each distinct named assertion in the JSON: canonical succeeded/skipped entries; pending/open/failure/cancellation; closed empty; framework coverage despite author omission; flip-free threshold; renamed/moved template; cancellation dominance; unchanged earlier publications after skip/deletion. No blanket claim follows merely from one successful report. |
| CMP-9 enforceable boundary | Keep named construction-time resolution, undeclared operation/target substitution, missing supplied slot and post-freeze builder negatives. No claim that capabilities sandbox external JS I/O. |
| Value/materialization/collection clauses in Tracking | Preserve distinct address, canonical transport, immutable snapshot, unsupported-domain, selected-loading/metadata-only I/O, keyed projection, ordering and early-stop assertions in all retained JSON rows. Historical EXP-2 top-level-only experiments do not supersede M3 selected-loading evidence. Class support, full cache/eviction and scale remain bounded/deferred as specified; this is not an execution of those target features. |

Proposed short #156 comment for the supervisor: “CMP-8 still distinguishes bare undefined success from skip. The selected current-alpha record/array result-root contract permits wrapped undefined data, which does not prove bare undefined success. Please reconcile this full-target wording with that bounded contract; Track A now records this limitation.”

## Track D: every originally requested change

| Change | Exact evidence and observed boundary |
| --- | --- |
| Helper edits | `resolution/summary-validation.test.ts`: “a changed called formatter re-executes both summaries even with unchanged statistics” runs two summary bodies; “a changed uncalled helper alone retains both summaries” runs zero and retains references. Executed in `resolution-gap-controls.log` full matrix. |
| Closures | New imported tracked-closure witness passes with same helper implementation evidence and factor-dependent output change. `experiments/exp-1/test/protocol.test.ts:196` is the historical same-text untracked-scalar counterexample, not current production proof of closure soundness. TRK-4/CMP-3 explicitly exclude unobserved external captures. |
| Transitive imports | `imported-artifact-probe.mjs`: “transitive tracked imported body changes” compares changed and computes 9 instead of 6 in fresh processes. This observes explicitly tracked imported implementation, not arbitrary untracked dependency graphs; no durable body-count assertion is present. |
| Dependency version bumps | “dependency version metadata alone” compares equal and computes 6. Package metadata does not invalidate unchanged consumed emitted implementation. This is observer comparison, not a measured durable reuse count. |
| Comment-only edits | “emitted comment” compares changed with result still 6; conservative implementation evidence includes an emitted comment. It says nothing about source comments stripped during compilation. |
| Formatting-only edits | “emitted formatting” compares changed with result still 6; only emitted function-text variation was tested. |
| Renamed functions | “emitted function rename” compares changed with result still 6. This conservative implementation check must not be mistaken for using display names as structural callable correspondence. |
| Unread fields | `gap-hunt-contracts-invalidation.test.ts`: “unread field edit” compares equal. New imported-closure test independently compares equal for unread tracked configuration metadata. Existing hierarchical durable tests separately count retained bodies/references. |
| Array positional reads | Same matrix: “insert before consumed position” changes; “edit after consumed position” stays equal. Observations select an index/path, not entity identity. |
| `.length` | Same matrix: “same length element replacement” stays equal; “append changes length” changes. Static presence of a length observation alone was not adequate proof. |
| Optional versus undefined | Same matrix: “missing versus present undefined value” stays equal, while own presence and inherited membership change. Existing sparse-hole membership and literal falsey scalar cases remain separate. |

All six artifact cases passed in `imported-artifact-results.log`; all eight invalidation rows passed in `tracking-results.log`. `source-review.json` provides exact source/title/log routes and preserves prior pins. These observations support the listed finite boundaries, not complete invalidation soundness for unrestricted JavaScript.

## ARC-008 and actual #144 fault sites

The DX review at `gap-hunt-dx` commit `9cc808b` identifies real existing ports for History, Tracking, host mechanics, admission, observers and execution. Controlled child callbacks vary known values, counters, chosen failures, and equal-output implementation replacements. A separately replaced recursive child resolver is not exposed and has not been demonstrated by these tests.

The five #144 faults were nevertheless independently expressible through existing seams: omit gate capture, omit concurrent direct-memo sharing, vary supplied invocation intent, remove supplied own implementation, and remove fold own implementation. The verified isolated runner discriminates all five with the matching new assertion. The original 73-test selection missed all five; the prior expanded 216-test selection caught the gate omission in three existing tests and missed the other four. Final baseline/restored are 221 passing. Earlier symlink-copy-invalid mutation evidence is explicitly excluded in `RESOLUTION-144.md`.

No concrete required child outcome has been shown inexpressible. Retain the literal isolation qualification; do not add an API or missing-contract issue solely from the lack of a separately injectable recursive resolver. A future seam request needs a concrete invariant that existing ports/callbacks cannot discriminate.

## Reproduction and remaining boundaries

Installed checkout commands actually executed:

```sh
npm run test:unit -w @microdelta/tracking -- --runTestsByPath .test-build/test/gap-hunt-contracts-imported-closure.test.js --verbose
npm run test:unit -w microdelta -- --runTestsByPath .test-build/test/gap-hunt-contracts-fold-observer.test.js --verbose
npm run check -w @microdelta/tracking
npm run check -w microdelta
node scratch/gap-hunt/contracts/source-review.mjs
```

Each new suite passes 1/1. Tracking type/portable checks and lint, and Core type checks and lint pass. Bootstrap selectors `node scratch/gap-hunt/contracts/reproduce.mjs imported-closure` and `fold-observer` install/build before those same focused suites; a fresh bootstrap was not repeated for these passing audit witnesses. The earlier `resolution-144` selector has its independent clean-checkout verification.

No production files, issue comments, public APIs or runtime contracts were changed. Existing #156/#162/#164/#168 baseline findings remain owned follow-ups, not newly verified current-main failures. The two additional passing witnesses close identified test-routing gaps; the full gap hunt remains broader than this audit.
