# Controlled mixed-outcome and trial-adequacy evidence

This record maps #266's bounded fixtures from original baseline
`fc04315fa4b1699c2163198d4479aa3a9044c330` through the actually merged #268
dependency, PR #270 merge `8d9e61cc4be3b2a415f996b04204f127819ef4c8`.
All six new dedicated cases now pass with every original waiting-time assertion
enabled. This is bounded implementation evidence; independent final review and
supervisory acceptance remain pending. #266 adds no production source, public
API, common schema, report feature or shared fixture/process harness change.

The separately accepted common-runtime correction supplies the genuine earliest
deferred-time receipt; this fixture does not calculate or inject runtime state.

## Requirement and outcome map

| Requirement | Named current fixture / observed result |
| --- | --- |
| RUN-003 / TEST-4.6 current independent person while another search is unfinished | `mixed-evidence.test.ts`, `A is currently complete while B page two is held; seeded reuse = false/true`: **both pass**. A valid second-page continuation is held at a deterministic provider barrier. Current Ada publication or acceptance is captured before release, independently read by its exact reference, and accompanied by exact body/send counts. Grace has no details, assessment or summary before her own search completes. The team request remains unresolved and admits/publishes no report. After release, the actual report completes. |
| Exact current reuse and immutable original evidence | The seeded case captures Ada's baseline exact reference from the typed current member outcome, then requires a new current-run `accept` receipt for that same reference while Grace's page is held. Ada has zero new assessment/summary/detail bodies; fresh search still runs. Saved exact envelope/data remain unchanged before and after completion. No History-head/candidate-order oracle is used. |
| TEST-4.6 / RUN-009/010 combined success, source failure and quota wait | `mixed-evidence.test.ts`, `finite partial evidence names failed C and quota-pending B while current A remains exact`: **passes against the integrated dependency**. Initial current states are Ada succeeded, Cy failed, Grace pending with the exact quota operation/not-before time and outer waitingUntil. The strict fold correctly fails without a report; eight provider requests and one model assessment occur. Two separately labelled Grace-only checks before the floor preserve that same operation/T without provider, child/helper or completed-summary work and without Ada/Cy work. At the floor the full roster runs again: Grace resumes the same operation, Ada's exact current summary is reused, and Cy legitimately reattempts and fails. First-partial and old exact Ada facts remain immutable. |
| RUN-018 no-staff validation example | `trial-adequacy.test.ts`, `a no-staff selection succeeds with empty leadership input and no leadership/model/excluded work`: **passes** through a separate authored public-facade graph. The full fixture roster contains excluded staff, but explicit selection contains only nonstaff Ada. The declared leadership input and required leadership population are empty; the surrounding trial and empty strict fold succeed without leadership instances, model work or selection expansion. |
| RUN-018 one-point validation example | `a one-point plotting input executes exactly once without adding data or claiming representativeness`: **passes**. The authored deterministic consumer receives and returns exactly `[4]`, runs once, makes no model request, and adds no adequacy or representativeness claim. It is not a renderer or statistics implementation. |
| Nonvacuous leadership-path control | `an explicitly selected staff member really exercises the leadership path; exclusion never means disabled code`: **passes**. Explicitly selecting Grace exercises her declared leadership instance and one actual supervised provider-free model operation; Ada remains excluded. This distinguishes an empty filtered input from permanently disabled code. |

The RUN-018 fixture owns its staff classification and sample meaning; it does
not add those concepts to `composeReport`, a framework HR schema or a universal
adequacy mechanism. The report cases still use the actual `composeReport` and
`evaluateReport` path with completed search before each person's details.

## Original reporting defect and dependency integration

At a held epoch of `1893456000000`, Grace's controlled rate response supplies
`Retry-After: 1`. The typed member and `retry-scheduled` event correctly preserve
`1893456001000`; the run stops neither retries nor independent work. Cy's
isolated source failure correctly makes the strict fold final for the run.

At the original baseline, `packages/supervision/src/supervision.ts` returned a
final request at lines 855–857 before accumulating its actual deferrals at
lines 861–864. Strict folds
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
The five unblocked cases then passed. The wait-receipt assertion was a genuine
existing-runtime regression outcome, preserved for the separate owning repair.
All six pass after integrating its actual merge, without bypassing any original
waiting-time assertion.

Independent preliminary review also found a distinct fixture expectation error:
before-floor full-roster reruns started fresh Ada/Cy searches behind Grace's
shared search cooldown while Jest time stayed frozen. That private-copy hang
probe is not another runtime RED. The supervisor selected Grace-only selection
for those two checks, preserving the original three-person result and full-roster
at-floor resumption. The same connection/store/environment and exact blocked
operation are required throughout.

The first resumed six-case run passed five and rejected a newly added overly
broad assertion that Grace could have no callback entry at all. The real outer
summary callback must enter to await its declared blocked search. This is not
summary-helper computation or completed summary work. The supervisor read that
failure and selected a precise guard: exactly the `summary` execution slot,
no child execution, no summary publication/acceptance, and unchanged helper,
provider and model evidence. This fixture expectation correction is separate from
the original missing-floor behavioral RED and does not weaken its contract.

Verification performed in the isolated #266 worktree:

- Locked offline installation and fresh `npm run build:packages`: passed.
- `tsc -p fixtures/contribution-report/tsconfig.json`: passed.
- Changed-file public-entry import enforcement and type-aware ESLint: passed.
- Original dedicated partial Jest run: five passed, with the then-blocked mixed
  case deliberately excluded. That historical partial run is not full acceptance.
- After actual dependency integration and selected fixture repair: dedicated
  mixed/trial Jest run passed all six cases in two suites, all assertions enabled.
- `npm run test:controlled-report`: 18 suites, 192 tests passed, followed by the
  controlled generated-declaration tsd contract gate, also passed.
- Resumed changed-file context import enforcement and type-aware ESLint passed.
- A separate one-case reproduction retained the actual public typed result and
  original failing assertion. Receipt-only emitted test instrumentation was
  restored byte-for-byte; runtime source/packages were unchanged.
- Retrospective authored-fixture sensitivity controls bypassed the staff filter
  and silently duplicated singleton output. The existing corresponding outcome
  assertions rejected both; exact restoration then passed all three trial cases.
  These controls are not original test-first RED and do not mutate production.

Full same-SHA check/test/build and different-agent adversarial re-review remain
required for the final candidate; the dependency has now been integrated. No push, PR,
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
