# Controlled mixed-outcome and trial-adequacy evidence

This record maps #266's bounded fixtures against accepted main
`fc04315fa4b1699c2163198d4479aa3a9044c330`. Five new cases pass. The sixth
exposes a common-runtime deferred-time receipt defect and remains failing;
**#266 is not accepted or ready for publication**. No production source, public
API, common schema, report feature or shared fixture/process harness changed.

The separate common-runtime correction must preserve the failed-fold outcome
and actual pending member while reporting its deferred time. This record does
not authorize that runtime work or silently weaken #266's assertion.

## Requirement and outcome map

| Requirement | Named current fixture / observed result |
| --- | --- |
| RUN-003 / TEST-4.6 current independent person while another search is unfinished | `mixed-evidence.test.ts`, `A is currently complete while B page two is held; seeded reuse = false/true`: **both pass**. A valid second-page continuation is held at a deterministic provider barrier. Current Ada publication or acceptance is captured before release, independently read by its exact reference, and accompanied by exact body/send counts. Grace has no details, assessment or summary before her own search completes. The team request remains unresolved and admits/publishes no report. After release, the actual report completes. |
| Exact current reuse and immutable original evidence | The seeded case captures Ada's baseline exact reference from the typed current member outcome, then requires a new current-run `accept` receipt for that same reference while Grace's page is held. Ada has zero new assessment/summary/detail bodies; fresh search still runs. Saved exact envelope/data remain unchanged before and after completion. No History-head/candidate-order oracle is used. |
| TEST-4.6 / RUN-009/010 combined success, source failure and quota wait | `mixed-evidence.test.ts`, `finite partial evidence names failed C and quota-pending B while current A remains exact`: **blocked by a reproduced reporting defect**. Actual current states are Ada succeeded, Cy failed, Grace pending with an exact quota `blocked.notBefore`. The strict fold correctly reports failed, names Cy failed and Grace pending, and preserves closed roster membership. Eight provider requests and one model assessment occur. Its outer `waitingUntil` is incorrectly undefined; the required exact-time assertion is preserved. Later no-early-retry/resumption assertions remain in the test but are not credited as passed past that failure. |
| RUN-018 no-staff validation example | `trial-adequacy.test.ts`, `a no-staff selection succeeds with empty leadership input and no leadership/model/excluded work`: **passes** through a separate authored public-facade graph. The full fixture roster contains excluded staff, but explicit selection contains only nonstaff Ada. The declared leadership input and required leadership population are empty; the surrounding trial and empty strict fold succeed without leadership instances, model work or selection expansion. |
| RUN-018 one-point validation example | `a one-point plotting input executes exactly once without adding data or claiming representativeness`: **passes**. The authored deterministic consumer receives and returns exactly `[4]`, runs once, makes no model request, and adds no adequacy or representativeness claim. It is not a renderer or statistics implementation. |
| Nonvacuous leadership-path control | `an explicitly selected staff member really exercises the leadership path; exclusion never means disabled code`: **passes**. Explicitly selecting Grace exercises her declared leadership instance and one actual supervised provider-free model operation; Ada remains excluded. This distinguishes an empty filtered input from permanently disabled code. |

The RUN-018 fixture owns its staff classification and sample meaning; it does
not add those concepts to `composeReport`, a framework HR schema or a universal
adequacy mechanism. The report cases still use the actual `composeReport` and
`evaluateReport` path with completed search before each person's details.

## Deferred-time reporting defect

At a held epoch of `1893456000000`, Grace's controlled rate response supplies
`Retry-After: 1`. The typed member and `retry-scheduled` event correctly preserve
`1893456001000`; the run stops neither retries nor independent work. Cy's
isolated source failure correctly makes the strict fold final for the run.

`packages/supervision/src/supervision.ts` returns a final request at lines
855–857 before accumulating its actual deferrals at lines 861–864. Strict folds
select that fast path when failed (lines 971–972), so the run loses its
earliest-left-behind receipt. The intended correction must report the real
time without sleeping, running another pass, repairing Cy or starting an
early retry. Owning contracts are `IRunResult.waitingUntil` at
`packages/supervision/src/contracts.ts:797–805`, RUN-011 timing and passes,
and CLI-005's terminal deferred-time facts.

## Test-first chronology and verification limits

Outcome assertions preceded new fixture scaffolding. The first strict compile
failed because `trial-adequacy-fixture.ts` did not yet exist; those missing-module
and derived type diagnostics are **scaffolding/type failures**, not behavioral
RED. A subsequently corrected fixture generic declaration was likewise a type
error, not a runtime regression.

The first valid six-case runtime run passed four cases and failed two: the
mixed-case missing `waitingUntil` above, and the staff-positive fixture's
missing injected Accounting port. Supplying the existing public durable
Accounting adapter fixed that setup error; it required no library change.
The five unblocked cases now pass. The wait-receipt assertion is a genuine
existing-runtime regression outcome, preserved for the separate owning repair.

Verification performed in the isolated #266 worktree:

- Locked offline installation and fresh `npm run build:packages`: passed.
- `tsc -p fixtures/contribution-report/tsconfig.json`: passed.
- Changed-file public-entry import enforcement and type-aware ESLint: passed.
- Dedicated unblocked Jest run: five passed, with the known failing mixed case
  deliberately excluded from that **partial** run. This is not a full suite pass.
- A separate one-case reproduction retained the actual public typed result and
  original failing assertion. Receipt-only emitted test instrumentation was
  restored byte-for-byte; runtime source/packages were unchanged.
- Retrospective authored-fixture sensitivity controls bypassed the staff filter
  and silently duplicated singleton output. The existing corresponding outcome
  assertions rejected both; exact restoration then passed all three trial cases.
  These controls are not original test-first RED and do not mutate production.

Full same-SHA check/test/build and different-agent adversarial review remain
required after the separate reporting correction is integrated. No push, PR,
merge, provider execution or scale qualification follows from this local record.

## Existing credit and exclusions

#260's accepted report, CR-2/4/5 and 150,000-PR cold/restart evidence remain
credited unchanged. Existing report cooldown/failure/restart/trial tests and
the facade's strict/outcome-fold proofs remain useful supporting evidence.
#263 owns observed report classification; #265 owns consumed diff/review/helper
and current-HR variations. CLI/lifetime/live-provider choices, streaming, full
TEST-3/4/5/6, M6/M7 and all parent closures remain separate gates.

Attribution: a delegated Codex implementer authored these fixture assertions and
separate trial composition under supervisory scope approval. The supervisor
reviewed the reproduced common reporting gap; independent final implementation
review and acceptance remain pending. No human implementation or review is
claimed.
