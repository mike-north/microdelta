# Issue 254: current source calls within completed-search person summaries

Local implementation candidate on `codex/issue-254-source-call-currentness`.
Governing issue: <https://github.com/mike-north/microdelta/issues/254>.
Selected contract: [scoped-source-calls](../plans/scoped-source-calls.md), reviewed
at `615e0bfa9085dbca07df03c22a3635767fc2950e` in PR #253. Implementation and
acceptance are separate: this record requests a different adversarial review;
no push, PR, merge, release or paid/provider execution is claimed.

## Ownership and change

Definition owns distinct `sourceSlot`, `suppliedSource` and `supplySource` alpha
declarations, matching current kinds and typed argument/previous contexts.
Resolution composes the existing source-policy/outcome/admission/publication
path with callable subject, consumed argument facts and call-specific sharing
and intent. History remains opaque persistence; supervised operations retain
existing intent, retry, stop, usage and writer-fence authority. The facade adds
alpha aliases and no domain policy.

Parent call records, v2 witnesses and argument recipes are unchanged. Source
provenance v1 alone accepts a callable descriptor. Older records remain readable
by the new reader; older binaries may classify new callable-source records as
malformed. No older-binary forward-read/downgrade guarantee, journal/SQLite
schema change or Tracking semantics-generation change is introduced.

The fixture completes each person's count/ID search before detail, forwards the
exact detail carrier and prompt origin to an assessor with a separately derived
ID subject argument, and tracks independent strict person summaries. Equal or
unconsumed refreshed detail preserves eligible downstream references. Authors
retain their complete subject text and compatible sharing across people.

## Test-first evidence

- Declaration RED: `npm run test:unit --workspace @microdelta/definition` failed
  TS2339 for missing source builders. The current suite passes 287 assertions.
- Codec RED: the callable source-v1 round-trip failed at `malformed: step
  descriptor`; its ordinary memo/malformed negatives passed. Current evidence
  suite passes 41 assertions, including every supported older provenance form.
- Generated-alpha consumer RED: the four initial completed-search assertions
  failed against the prior runtime (failed cold report, no detail execution).
  Source-call runtime suites now pass 48 assertions.
- Facade type RED: `npm run test:types --workspace microdelta` failed for missing
  source aliases and widened registration kind. Current core and Definition tsd
  suites pass, with source/memo kinds and previous/outcomes kept precise.
- Additional declaration REDs caught source tokens being recognized as executable
  declarations and re-reading proxy options. Both were corrected and pass.
- The wrong-slot restart assertion failed with zero expected refreshes: ordinary
  M3 source correspondence is subject-based. Callable sources now additionally
  require exact stored slot correspondence before any finality hook; ordinary
  source semantics remain unchanged. The assertion now passes.

The generated-alpha fixture check is durable in
`fixtures/declarations/source-call/tsconfig.json`, run by core `check:types`.
Its first placement under the owning core package was correctly refused by the
unchanged declaration-tier preflight; moving the consumer configuration into the
ownerless declaration-fixture area satisfies the existing alpha rule. No check
was weakened or exception added.

## Acceptance map

| Issue criterion | Executable evidence |
| --- | --- |
| 1. Source/memo declarations, occupancy, arguments, alpha contracts | `definition/test/source-slot.test.ts`; core `test-d/source-call.test-d.ts`; `source-call/policy.test.ts` raw-view rejection; `kind-correspondence.test.ts` both mixed-kind orderings and matching aliases; generated-alpha fixture gate |
| 2. Cold completed searches before independent detail/assessment/summary | `currentness.test.ts`: cold ordering; `restart.test.ts`: hand-computed Ada=2/Grace=1 report |
| 3. Current hooks after fresh-process restart, exact accepted references | `restart.test.ts`: unchanged restart and prior true/current false policy; reverse registration |
| 4. Same-ID change, equal refresh, unconsumed refresh and retention | `currentness.test.ts` and `restart.test.ts`: changed totals/references; new source reference with exact assessment/person retention; `policy.test.ts` explicit retention |
| 5. Added/removed membership, surviving reuse, no removed replay | `currentness.test.ts` and `restart.test.ts`: replacement 102→103, survivor assessment reference, Grace reference; certified empty |
| 6. Cross-person sharing, consumed arguments/policy, distinct IDs/intents | `currentness.test.ts` and `restart.test.ts`: same-ID sharing, A/B arguments, unconsumed C/D arguments; `supervised.test.ts`: distinct source subjects, operation and step-attempt identities |
| 7. Empty/failed/truncated/pending search and detail wait/failure/stop | `currentness.test.ts`: empty/failed/truncated/duplicate/missing IDs/detail failure; `supervised.test.ts`: genuine unfinished search, required detail wait, retry and stop, independent Grace, strict outer status |
| 8. Eligibility before finality and immutable history | `currentness.test.ts`: implementation, consumed argument/policy and prompt changes; `restart.test.ts`: historical source envelope/payload immutable; `policy.test.ts`: consumed input after await rejects previous before finality |
| 9. Codec/witness compatibility, mismatches, honest recipe misses, exact reads | Resolution `evidence.test.ts`; `restart.test.ts`: source v1/parent v2 wire, wrong source/memo kind, wrong slot, untracked/opaque recipe parent misses, immutable exact History reads; full existing recovery suite remains required |
| 10. Real supervised acquisition authority | `supervised.test.ts`: confirmed intent before send, unconfirmed intent no-send/pending, unknown usage, finite retry on controlled clock, dispatch/in-flight stop, successor fencing, completed-child preservation |
| 11. Discriminating negative controls | `source-call/controls/source-call-mutation-controls.mjs`: baseline/restored 14/14 pass; skip-current-policy fails Ada total expected 3/actual 2; flattened forwarded detail fails unconsumed exact person-reference retention. Isolated copied packages, load-path and artifact-hash checks, exact title inventory and targeted assertion diffs |
| 12. Required checks and build | `npm run check` passed including the final generated-alpha fixture gate; `check:declarations`, `check:imports`, core/Definition tsd and all 48 affected runtime assertions pass. The baseline full `npm test` and separate `npm run build` subsequently passed with explicit exit receipts. Fresh full check/test/build for the kind-correspondence repair are pending at the repair source freeze; see review and validation below. |

## Independent review and scoped repair

Different reviewer `/root/source_call_review254` reviewed frozen baseline
`1827d0f1c861d4bab388cf7ca4b3d3658b6f65fc` and returned **FAIL** for one
blocking SCD-1 defect: when two differently named child handles used the same
slot text, only the first edge checked its expected source/memo kind. A later
opposite-kind handle could dispatch the cached implementation and publish.
The reviewer independently reproduced both directions with a strict generated-alpha
consumer; passing existing tests did not establish this missing invariant.

The repair keeps one occupancy lookup per slot and validates **each** edge's
expected kind against that target. Matching same-kind aliases retain their
existing meaning; no global slot-name uniqueness restriction is introduced.
A durable comment records the separation between slot occupancy and edge meaning.

Test-first repair evidence: strict facade Jest
`source-call/kind-correspondence.test.ts` initially failed both mixed-kind
orderings because the promise resolved to a published parent instead of rejecting;
both matching-kind alias controls already passed (2 RED, 2 GREEN). After the
repair all four pass. Each negative asserts no subject callback, source/finality,
memo or parent body execution, no publish phase, and no parent/child candidates
in real History. Positive aliases publish the expected value 146 with one child
execution. The facade assertion uses Resolution's existing `unbound-step` error
wrapper; Definition continues to reject with its existing `missing-slot` code.
The strict generated-alpha fixture gate includes this new typed consumer. The first repair full check caught a closed-over kind selector in the test callback; the fixture now selects its two declarations outside author callbacks. Existing tracked-capture enforcement remains unchanged and the check is rerun.

The baseline required gates completed after its initial source freeze:
full `npm test` and separate `npm run build` both exited 0, confirmed by
`/tmp/issue254-test-recovery.exit` and `/tmp/issue254-build-final.exit`.
These validate the baseline only. Fresh repair check/test/build run with separate
exit receipts is pending at this repair freeze. Re-review by the same different
reviewer and successful fresh required gates remain prerequisites to publication.

## Validation state and limits

The initial full `npm test` attempt passed 367/368 tooling assertions and stopped
on the temporary own-package alpha fixture placement described above. That
placement is corrected and the final full `npm run check` passed, including that fixture. The subsequent full `npm test` passed all 368 tooling assertions and Accounting (54 unit assertions, tsd, public consumer), then reached core Jest. Its process/session ended without a captured exit result; the last core PID no longer exists. This is an interrupted/unproven full test run, never a PASS. The separately chained final build was not reached. That interrupted attempt remains unproven; the later complete baseline recovery passed as recorded above. It is not evidence for the subsequent kind-correspondence repair.
Existing mutation-control anchors were mechanically updated for the additive
source argument/finality expressions, preserving their original planted behavior;
all affected anchors match exactly once. The two new required controls pass after the final artifact build (`node packages/core/test/source-call/controls/source-call-mutation-controls.mjs`): baseline/restored 14 tests, no failures; both mutants fail their targeted assertions.

No provider transport, pagination, live request, CLI, performance/scale, fairness,
nested collection framework, full M7 completion or stable API promise is included.
The runtime tests use the real owner graph, SQLite and controlled fake adapters;
they do not prove a production provider's pagination/exhaustion contract. A
separate adversarial review must pass before the supervisor authorizes publication. Shared-rate dispatch composition with #238 is not yet proved here. Its assembly seam is `supervised-support.session`: inject one coordinator through `createSupervision` and annotate the existing `supervision.execution().operation` requests with the selected surface/gate. No new source acquisition API is needed or claimed.

Implementer: Codex subagent `/root/source_call_impl254`.
Agent assistance: root supervised scope and acceptance; no implementation subagent
or Claude session was spawned. The baseline different review found the kind-correspondence defect above; scoped repair re-review is pending.
