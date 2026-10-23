# PR 189 finite custom-key repair verification

Production source: `fc1ccdae7284490066c45d3bcab322b554546a1f` (issue 168).
Frozen consumer: `b1b42c304db15fe0c3c306a0fb4f71660970040f`.
Counterfactual: exactly Definition's `collection.ts` and `template.ts` from
`2a640aca75d5728484a2cb06af88c77690616ba9`, rebuilt through all package declarations.
No product changes are part of this evidence branch.

Run in a disposable checkout with Node 24:

```sh
python3 scratch/gap-hunt/review-189-repair/reproduce.py
```

The runner installs locked dependencies and runs the original bootstrap without
build reuse. It writes logs and its receipt into a printed temporary directory
(or `MICRODELTA_EVIDENCE_OUTPUT`), restores both source files in `finally`, rebuilds,
and reruns the consumer assertions. Published captures are an observed run on
macOS 27.0.1 arm64, Node 24.22.1, npm 11.12.1; they are not a Linux or deployment claim.

## Results and acceptance mapping

1. **Supported identity-less custom keys: PASS.** The seven original fixture and
   support files are byte-identical to the frozen commit, checked before execution.
   Original Jest: 3/3. The optional-identity workaround remains an independent
   control, and an additional pure `{ id, score }` runtime payload executes its gate and
   member body with the expected custom key, without any identity field.
2. **Generated alpha types: PASS.** `generated.test-d.ts` uses the built alpha
   declaration and tsd to prove exact member type and number-valued gate/body
   access; rejects absent fields, number/undefined/object/Promise/Date key returns,
   and a scalar collection. Definition's existing tsd suite also passes. No
   casts, phantom identity fields, or projection repair are introduced.
3. **Default strategy and prework rejection: PASS under the supervisor
   interpretation below.** Missing both strategies throws
   before the template factory; the error names the distinct template and both
   designated-identity/custom-key alternatives. It does not name the distinct
   collection source subject. This declaration happens before composition binds
   its collection step slot, so this report does not assert that a bound slot is
   available or that arbitrary source subject text should be disclosed. The
   supervisor resolved AC3 as identifying the known template position plus its
   collection-source/key-strategy problem at eager prework rejection. A future
   composition slot does not exist yet, and the opaque source subject is not that
   slot. Snapshot-time key diagnostics must still name the bound collection, as
   the five runtime checks below establish. This is an explicit scope
   interpretation, not a failed assertion hidden by a changed expected outcome;
   no subject dump, invented field, or delayed rejection is required. No product
   defect is claimed.
4. **Whole-snapshot prework rejection: PASS.** Five new generated-facade Jest
   cases put a valid member before a duplicate, undefined, empty, numeric, or
   throwing key. Each checks exact diagnostic reason, collection slot and custom
   strategy, excludes thrown private text, and observes zero gate/body executions
   and no admitted member results. Invalid return values are intentionally supplied
   from JavaScript without weakening the generated TypeScript contract.
5. **Separate-process correspondence: PASS.** The existing keyed restart suite
   runs 19/19, including identity-less custom keys, reordered discovery and
   declaration registration, exact eligible reference reuse, a changed key
   producing a new publication, unaffected keys retaining exact references,
   duplicate rejection before admission, and correction reconnecting prior refs.
   No closure determinism guarantee is claimed.
6. **Scoping/default/gate/topology controls: PASS.** Definition's 283 runtime
   tests plus its tsd contracts pass, covering independently scoped strategies,
   designated defaults, gates and frozen topology. All 19 keyed restart tests
   preserve existing default/custom controls. The 23 M4 control anchors match;
   the expensive full mutation suite is not rerun or claimed.
7. **Original reproduction and affected checks: PASS.** Fresh npm ci/default
   build, frozen consumer compilation, actual type-aware consumer lint,
   Definition strict/type-aware checks and tests, core test compilation and
   focused keyed assembly restart suite pass. The original runner's ESLint
   invocation reports an ignored-file warning; this report explicitly compensates
   with the supplement's real type-aware config and `--max-warnings 0`.

## Discrimination and restoration

With only the exact old two Definition source files restored and all package
runtime/declarations rebuilt, the unchanged original Jest proof fails 1 of 3
(the supported identity-less custom declaration); its other two controls pass.
The supplemental runtime suite fails all 7 cases: old code refuses each custom
identity-less template, and the missing-strategy message lacks the custom-key
remedy. Finally both current source files are restored byte-for-byte, package
build succeeds, and original 3/3 plus supplement 7/7 pass again.

The seven supplemental green tests include a preserved diagnostic observation.
The supervisor accepted the declaration-time naming interpretation above; with
that explicit boundary, this report concludes bounded PASS for the seven criteria. No paid provider execution,
publication, formal review, author-branch change, merge, or ledger-count change
was performed. Evidence is finite and tied to the source pin above.

An exploratory version of the new positive runtime control returned a bare
number; the selected execution contract requires a record/array root, so it was
corrected to `{ score }`. That harness failure is not a custom-key product gap.
Captured checkout and Node executable paths are normalized to placeholders.

The final evidence-only delta adds exact Jest summary guards: 3/3 original,
7/7 supplement, 1-fail/2-pass old original, 7-fail old supplement, restored 3/3
and 7/7, Definition 283 across 15 suites, restart 19, and 23 anchors. A missing
summary, suite load error, or mismatched count cannot count as a semantic negative.
The guard is validated against every captured outcome and synthetic missing,
load-error, forged-count-with-load-error, and wrong-count logs. The full fresh
execution at commit `367fb02` remains the runtime evidence; this final delta only
strengthens its portable acceptance assertions and documents that qualification.
