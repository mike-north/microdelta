# Deferred work left beside a failed strict fold

This record maps #268's bounded Supervision correction against accepted base
`fc04315fa4b1699c2163198d4479aa3a9044c330`. A terminal failed request now
preserves the earliest actual deferred-work time it leaves behind, combined
with any smaller floor already retained by its run. The failed request still
returns immediately. It does not sleep, retry, start another pass, publish a
strict result, or change failed and pending member statuses.

The normal sleep path records no run-level floor merely because it encountered
a deferral; successful resumption therefore leaves no stale waiting receipt.
The existing observation closure receives the corrected run-level value through
its unchanged carrier. No field, schema, result variant, event or host policy
was added. The public result comment now includes terminal failed requests among
its return reasons. API extraction succeeds with no tracked signature-report
change; generated alpha declarations carry the clarified comment. A patch
changeset records the Supervision behavior correction.

## Acceptance map

All named cases below are in
`packages/core/test/operations/wait-receipt.test.ts`.

| Criterion | Executable outcome |
| --- | --- |
| 1. Genuine mixed failed/pending outcome | `mixed failure returns its deferred floor immediately under ... deferral` runs for explicit exit and omitted/default sleep. Actual typed members are pr-1 succeeded, pr-2 pending, pr-3 failed; the strict outcome names failed pr-3 and pending pr-2 with closed discovery. The pending member names its actual operation and exact not-before time. No strict fold claim/execution/publication occurs and History has no current report. Exactly three provider sends and request attempts occur, without retry-started or wait events, clock advancement, or a timer scheduled for the deferred floor. |
| 2. Normal and observed receipts | Both mixed normal cases return T. `an observed mixed failure closes with the same floor while body disposition and incomplete application remain separate` independently reopens the terminal artifact: phase closed, body returned, application incomplete, stop none, zero wait events, and waitingUntil T. The returned value remains the failed fold; no confirmed report is inferred from body return. |
| 3. Default sleep, minimum and prior floor | Both mixed modes return without sleeping. `several deferred siblings retain their earliest actual floor despite a failed member` preserves two pending member floors and reports the earlier one. `a final failed request cannot replace a smaller floor already left by a different request` first leaves a separate parent/paid request deferred to an earlier T, then resolves the failed strict fold with a later floor; the run keeps the earlier value and emits only the actual first exit wait event. |
| 4. Negative controls | `a terminal failed fold without deferred work has no waiting floor` returns undefined. `a purely pending exit request still reports its real floor without publishing` preserves its actual exit event and T. `successful default sleep resumes the deferred work and leaves no stale waiting floor` cannot send before T, resumes the same operation at T, succeeds, and returns undefined rather than retaining the encountered floor. |
| 5. Fresh invocation before T | `a fresh run before the retained floor sends and claims no deferred member work` closes the first session, reopens the same durable stores before T, and preserves pr-2's exact operation/floor with no additional send, claim, execution or publication for that member. The independent failed sibling has a separately scripted refusal for its legitimate new-run reattempt; that extra request is explicitly counted. |

The tests live in the core assembly suite because the primary oracle needs a
real strict fold, real member outcomes and actual publication gating. The
existing operations harness supplies the real Supervision, Resolution, History,
Tracking and Accounting owners through their generated package entries, with a
controlled provider and timer. The observed case assembles those same ports
with Supervision's actual observation host. It decorates no fold outcome and
edits no shared fixture or harness. Supervision's existing owner suites remain
the direct stop, lease, acquisition and observation controls.

## Test-first chronology

The new outcome assertions were written and compiled successfully before any
runtime or contract-comment edit. The first unchanged-runtime run had five
failures and four passes: four failures were the missing deferred receipt
(normal exit, normal default sleep, observed terminal artifact, and multiple
floors). The fifth was a test-fixture assumption that a failed sibling would
never be attempted in a fresh run. That assumption was corrected by explicitly
scripting its new-run refusal and counting the independent extra request; the
deferred member's no-early-send/claim assertions were unchanged.

The corrected unchanged-runtime run then had five missing-floor failures and
four passing controls. The fresh-run case now reached the same intended
`waitingUntil` assertion: expected `1767225610000`, received undefined. The
observed terminal record likewise omitted that field. These are behavioral RED
results, not missing-module or compilation failures. The supervisor read both
the corrected RED output and the focused GREEN output.

Only afterward was the common `inPasses` terminal-return boundary corrected.
The focused suite then passed all nine cases.

## Validation and remaining gates

Completed locally for this candidate:

- Locked offline installation and fresh `npm run build:packages`: passed.
- `npm run build --workspace @microdelta/supervision`, including API extraction:
  passed; no tracked API signature report changed.
- `tsc -p packages/core/tsconfig.test.json`: passed.
- Dedicated emitted Jest `wait-receipt.test.js`: nine cases passed.
- `npm run test --workspace @microdelta/supervision`: seven owner suites,
  317 tests passed, followed by tsd, public-consumer compilation and mutation
  anchor checks, all passed.
- Core emitted Jest selection
  `operations/|workspace/observation|m5-acceptance/deferral|m5-acceptance/outcome-fold`:
  16 suites, 246 tests passed, including the new nine, operation acquisition,
  workspace operations, exact observation, and existing deferral/outcome cases.
- `npm run check --workspace @microdelta/supervision` and
  `npm run check --workspace microdelta`: strict types and type-aware lint passed.
- Changed-file context import enforcement and `git diff --check`: passed.

Different-agent adversarial review and final same-SHA repository
`npm run check`, `npm test`, and `npm run build` remain required before
publication. #266's separately saved, unweakened assembled report regression
must pass after this dependency is integrated; it was not edited or run here.
This record does not accept #266, close either issue, or qualify a live provider,
CLI, scale run or parent gate. No push, PR, merge or paid execution occurred.

Attribution: a delegated Codex implementer authored the tests and correction
under the supervisor's issue scope. The supervisor assessed the reproduced gap
and read the test-first evidence; independent final review and acceptance remain
pending. No human implementation or review is claimed.
