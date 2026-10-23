# Focused delivered-clause review

Baseline52ba984 plus the test changes in this commit. No production implementation changes. These are audit assertions written from intended outcomes before inspecting the selected implementation branches; the implementation already existed and the new behavior tests passed on their first executable run. The temporary wrong test-helper import failed strict compilation and was corrected; it is not claimed as a test-first behavioral failure.

Selection denominator is **14 review items**, not14 complete normative clauses or the full344-block inventory:8 bounded delivered sub-obligations,3 missing target capabilities,2 owner/interface questions and1 still-unproved broader normative prohibition. No Proposal/Experiment or archived historical passage was selected into this denominator (0 each). The full normative clause denominator remains unestablished because the inventory includes headings, validation/examples and inherited-owner errors. Do not convert8/8 passing selected delivered items into overall spec coverage.

## Delivered items and exact observable assertions

| Item / owning source | Named assertion and boundary | Result |
| --- | --- | --- |
| D1 RUN-001 operations.md:58,64 awaited lazy lifetime | gap-hunt-durability-lazy: normal/return/throw iteration maintains context across yield/resume and awaited cleanup; ordinary lifecycle ends/fails after cleanup | Pass,3 parameter cases |
| D2 RUN-001 operations.md:58 errors preserve parent/siblings | gap-hunt-durability-lazy: failing lazy scope restores parent while concurrent suspended sibling resumes/cleans up; exact run/environment checked at7 ordered boundaries | Pass,new case |
| D3 RUN-001 operations.md:58 closed scope rejects work | normal/return/throw cases retain run then ordinary rejects run-closed; existing stop/lifecycle escaped callback additionally rejects send/sleep and records no provider request | Pass |
| D4 ACC-008 operations.md:856,867 usage observer add/remove | gap-hunt-durability-observer: two independent identical scenarios with optional usage-display callback absent/present preserve3sends,3successes,200tokens and1unknown report | Pass,new case; read-only display only |
| D5 ACC-008 operations.md:856 explicit gate supplies policy | workspace/admission-observers: refused cold miss leaves no claim/attempt/body/reference or stranded writer; reusable hits precede denying admission; source admission independently gates validation | Pass,existing assertions reused |
| D6 PUB-002 execution.md:359 and selected protocol:387 unexpired ownership | gap-hunt-durability-expiry: atT-1 allocation/stage/publish/renew/release work; atT all five refuse, new holder acquires fence+1, old release cannot affect it and prior current pointer stays | Pass,new2cases |
| D7 PUB-002 stale token cannot regain authority | durable-history/durable-history: same holder reacquiring invalidates previous fence; even copying new expiresAt into stale token cannot publish/renew/release | Pass,existing |
| D8 PUB-002 persisted temporal authority | durable-history/durable-history: backward host clock cannot shorten/resurrect lease; rejected expiry renewal records high-water; new handle with older clock still advances fence | Pass,existing |

D6 is real SQLite at controlled-clock equality. D7/D8 exercise existing exact expectations rather than adding duplicate tests. These cases do not establish cross-process claims; Track B and original crash suites retain that separate evidence. D4 observes Accounting while work progresses but is not a promise that arbitrary mutating/throwing observer callbacks cannot affect execution. Lifecycle observer errors have their own explicit contract.

## Target and unresolved items excluded from delivered success

1. CLI M6 target: no executable/public standalone read side in complete baseline surface. Diagnostic runner exits0; raw npm discovery fails legitimately. Command/output/exit/read-side choices require owner decisions.
2. Preview target RUN006–008: safe exact reads preserve payload after failed refresh; no specified latest-envelope/subscription/throttle surface. Envelope/lifetime/coalescing choices require owner decisions.
3. Resource-state target ACC004: valid additive report control remains5; complete Accounting port lacks state/pool/window/reset records/query. Ordering/window/expiry choices require owner decisions. No summed-state misuse is used as product evidence.
4. RUN001 returned-iterator ownership question: current generic ordinary accepts an iterator then closes; first next outside run refuses. Awaited consumption passes. No detached owning-wrapper contract was selected, so refusal alone is not a delivered-behavior defect.
5. RUN014 operations.md:516,531 shared-consumer cancellation question: existing separate-run/store stop isolation is not two waiters sharing one logical work owner. No exact propagation/ownership mechanism or assertion discharges that shared case. Keep it unresolved; do not claim complete cancellation acceptance.
6. ACC008 operations.md:862 unproved prohibition: current tests do not exercise a cleanup/deletion decision driven by unreported/zero currency. Unknown-report evidence is preserved in D4, but that is not deletion-authority evidence. No such product defect is inferred without a callable deletion/cleanup path.

## Replay and result

Strict test compilation and type-aware ESLint passed. Six targeted suites passed55/55cases; log in focused-delivered.log. Replay from built checkout:

```sh
npx tsc -p packages/core/tsconfig.test.json
npx eslint packages/core/test/gap-hunt-durability-{lazy,observer,expiry}.test.ts
node --experimental-vm-modules node_modules/jest/bin/jest.js --config packages/core/jest.config.mjs --runInBand --runTestsByPath packages/core/.test-build/test/gap-hunt-durability-lazy.test.js packages/core/.test-build/test/gap-hunt-durability-observer.test.js packages/core/.test-build/test/gap-hunt-durability-expiry.test.js packages/core/.test-build/test/durable-history/durable-history.test.js packages/core/.test-build/test/stop/lifecycle.test.js packages/core/.test-build/test/workspace/admission-observers.test.js
```

requirement-evidence.json now replaces generic residuals for RUN001, RUN014, ACC008 and PUB002 with these concrete remaining boundaries and supplementary named assertions. Its original473-case index remains the original broad run, not a fabricated merged rerun. No GitHub issue edits or production fixes.

Implementer: Codex worker (gpt-6.1-sol).
