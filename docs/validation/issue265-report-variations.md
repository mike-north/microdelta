# Issue #265 controlled report variation evidence

Issue #265 supplements the accepted controlled report evidence in
[issue #260](issue260-controlled-report.md). It adds independent-process proof
for consumed diff and review text changes, an actual tracked helper implementation
change, and current HR input changes. It does not reopen #260's accepted
qualification or close the broader #170, TEST-3/4, TEST-5/6 or M7 gates.

The cases use the existing two-person/four-PR synthetic fixture, the production
report facade, generated public declarations, shared durable History/Accounting
stores and fresh worker processes. The current roster and report population come
from the declared CSV and selected stable keys. Provider responses remain
controlled; this evidence establishes neither live GitHub snapshot consistency
nor a guarantee about editable historical content.

## Acceptance map

| Issue #265 outcome | Named evidence and bounded result |
| --- | --- |
| Unchanged independent-process control and exact current receipts | `fixtures/contribution-report/variations.test.ts`, `unchanged independent-process control exposes exact current step references`: cold and second-process runs assert current strict-fold membership and report reference, current source hooks, exact retained assessment/person references, no assessment/summary bodies or model sends, and independently expected completed-search sends. |
| One consumed diff changes | `one consumed PR diff refreshes one assessment and Ada summary only`: only PR 101's diff changes; its current request and assessment result change, the other three assessments stay exact, Ada's summary refreshes, Grace's summary is accepted unchanged, and the saved prior source/assessment/person/report envelopes and data remain readable and unchanged. |
| One submitted review body changes | `one submitted review body refreshes one assessment while equal scores retain both summaries`: only PR 101's submitted review body changes; it reaches the assessment request, only that assessment republishes, equal-score person summaries and the report retain exact references, and saved baseline envelopes/data remain unchanged. |
| Actual tracked helper implementation changes between copied deployments | `actual called helper code changes between isolated ESM graphs and invalidates all shared assessments`: an unchanged same-byte copy runs at the eventual helper-B path before mutation; manifests, emitted method text, runtime path/hash and public package entries establish the single intended artifact change; all four assessments republish with the helper-B explanation, while source references and equal-score summaries remain accepted. An unchanged helper-B repeat retains all four assessments. Both graphs resolve generated alpha declarations. |
| Current HR data and membership | `current HR name changes refresh one person and deactivation removes Grace from current membership`: renamed CSV data republishes the roster and Ada summary while retaining assessments and Grace; selecting deactivated Grace refuses with the specific preflight error before sends; an Ada-only run reports exactly Ada with the declared scope and current succeeded membership, makes no Grace work, and leaves the exact older Grace summary readable. |

All successful cases compare provider URLs and counts, cheap source hook/body
counts, assessment and summary bodies, model/provider sends, and fixture-derived
usage. Search expectations come from the authored two-PR-per-person fixture;
source requests account for the five separately controlled representations.
Per-run request/model counts are checked against the independent wire-ledger
delta, while returned accounting usage is cumulative and is checked against the
fixture-derived cumulative expected totals and whole ledger. Current exact source,
assessment, person and report references are read through the public History API;
old references are snapshotted before each variation and reread by those same
locators afterward. The tests do not infer acceptance from candidate ordering or
latest-publication pointers.

## Evidence boundary

These cases add missing TEST-4.4 consumed-text and tracked-helper variations and
current HR/data-membership evidence relevant to TEST-3 and TEST-4.1. Existing
#260 prompt/model/unread-label, membership, restart, source-policy and workload
evidence remains attributed to its own validation record. The helper test proves
the selected emitted-function-text tracking contract for this fixed application
shape; it does not establish arbitrary closure soundness. The HR case proves
current CSV selection behavior in this report fixture, not full organizational
roster onboarding. This record makes no new workload, scale, latency or resource
claim and does not alter the historical approximately 150,000-PR qualification.

The parent CLI/progress criterion, full TEST-3/4, mixed partial/failure/wait
TEST-4.6, TEST-5/6, live-provider consistency, and M7 acceptance remain separate
gates.

## Verification provenance

The fixture changes are based on `fc04315fa4b1699c2163198d4479aa3a9044c330`.
The ordinary controlled-report command passed after the new oracles and repairs:
16 suites, 174 tests, and the generated-declaration `tsd` contract suite.
Repository-wide check, test and explicit build results for the final reviewed
candidate are recorded with its implementation delivery; they are not inferred
from this focused run. No live or paid provider was used, and no scale rerun was
performed for #265.
