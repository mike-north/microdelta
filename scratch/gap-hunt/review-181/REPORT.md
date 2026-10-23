# PR181 exact-head async-source review

Reviewed `4661e7df2eb6c46018c0cb1febb83e20d5dcbab0`, against parent `f43c5872987573d9b98a19f41c324b4d9336894c`. Scoped verdict: **PASS for #169**. **#156 remains open**. No production fixes, PR-branch pushes, comments or merge are part of this evidence.

The three Definition source callback declarations now allow a synchronous trusted outcome or a Promise of that same outcome. The owning outcome family still determines payload precision and trust. The declaration change leaves memo, output and materialization contracts unchanged. Omitted generic result inference remains the pre-existing `unknown` boundary; this review makes no new inference claim.

## Governing obligations

#169 criteria 1–3 require direct and template asynchronous fresh/retain authoring, synchronous compatibility, precise member/previous/payload typing, and rejection of wrong or forged outcomes. Criteria 4–6 require durable fresh/retain distinction, no cold/ineligible retention, failed checks preserving earlier history, template parity and tracking across await. Criterion 7 requires generated declarations and the unchanged original reproduction to become green.

RES-004 distinguishes fresh equal publication from explicit exact-reference retention. RES-005 separates failed attempts from successful acceptance; RES-006 preserves historical locators. REUSE-004 permits a source check to do work before explicitly retaining. TRK-3 and RUN-001/002 keep asynchronous work within capture and invocation lifetimes.

## Executed acceptance evidence

- The original issue169 reproduction and its 11 supporting files were extracted unchanged from `faaa87426c565452d24cb128a1cfb4df3bc86405`. `original-overlay.json` records every SHA-256. The default command installed dependencies, rebuilt packages, accepted all four original direct/template async cases, passed its unchanged strict tsd negatives and type-aware lint, and passed 2/2 original runtime controls.
- Exact parent Definition source signatures **and their matching parent API report** were temporarily restored. Rebuilding Definition and facade succeeded. The unchanged original consumer failed with exactly four TS2322 diagnostics, all asynchronous direct/template callback return mismatches. No missing-import/build errors counted as the negative control.
- A `finally` restored every tracked file's original bytes, including API reports. Rebuilt current Definition/facade output accepted the same consumer. The script asserted all tracked bytes remained unchanged after the restored build. An initial harness attempt omitted the matching parent API report and hit API Extractor's expected signature-report mismatch; the corrected control uses the matching report and counts only the four consumer diagnostics.
- Full core tsd and core test compilation passed. Focused type-aware lint passed for the new async declaration/runtime tests.
- Six affected Jest suites passed **63/63**, with **0 runtime-error suites**: the new direct/template async suite (12 cases), Resolution source-policy tests, workspace scope/admission tests, and acceptance source-policy/admission tests. Suite counts were workspace async 12, Resolution source policy 20, acceptance source policy 7, workspace scope 9, workspace admission 9 and acceptance admission 6. The new cases demonstrate awaited fresh publication, distinct fresh equal references, exact eligible retention after separate process restart, post-await consumed-input invalidation, cold/ineligible retention failure, and post-await throw/forged-outcome failure preserving historical readability. Observer assertions require publish/accept where appropriate and prohibit both on failures.
- Two independent root controls passed: awaited scalar root is still refused with “without a record or array root”; the same scalar wrapped in `{ value: 1 }` publishes. This preserves #156's separate runtime limitation; it does not establish general scalar type/runtime consistency or close #156.

## Reproduction and limits

```sh
python3 scratch/gap-hunt/review-181/reproduce.py
```

Node 24.x. This command verifies reviewed tracked source, validates the twelve committed original fixture/support files by hash, runs its default clean install/build, executes exact parent/generated-declaration negative and restored positive controls, runs tsd/compiler/lint, the six suites, and the scalar/wrapped boundary. Fresh logs are ignored under `local-results/`; retained captures record the reviewed execution. The runner temporarily rebuilds exact parent contracts and restores tracked bytes in `finally`.

This is bounded macOS arm64 / Node 24.22.1 evidence. No full-repository gate, full Track G workflow, Linux execution, provider execution or publication is claimed. Existing lifecycle controls are evidence for their named cases; they do not imply new cancellation mechanisms or arbitrary asynchronous closure soundness. The hunt supervisor owns this scoped assessment and its comment. The repository supervisor owns substantive acceptance and merge decisions.

Attribution: GPT-6.1 Sol independently executed and packaged this scoped review for Mike North. The hunt worker has no merge authority.
