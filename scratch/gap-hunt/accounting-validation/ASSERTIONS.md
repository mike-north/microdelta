# ACC-002 finite source validation accounting assertions

Frozen source52e3786516a404e3433bef03807a027c8103786c. Governing ACC-002/003, RES-003/004/005 and REUSE-004. A/B/C are independent Node processes reopening the same real SQLite History and injected durable Accounting stores. Operations have synthetic in-memory perform callbacks only.

1. ProcessA cold source executes once, reports100units, publishes payload{value:stable}; its own run summary is100,1operation/attempt/report.
2. B finality false invokes the source check, performs exactlyone current validation operation reporting1unit, then explicitly retains its eligible previous result. Its exact result reference and persisted original payload/provenance remain byte-identical toA. Its own run summary is1 (not100/101); cumulative environment summary101. No new completed result is invented.
3. C independently revalidates with a fresh documented operation binding/request scope, executes exactlyonce, reports1newunit, retains A exact reference/provenance; own summary1, cumulative102. Distinct run/operation/request/report identities prevent accidental request reuse.
4. Current successful acceptance/check records are separate from original payload provenance. Inspect real durable records without rewriting source/result provenance.
5. Negative sensitivity: if meaningful at actual owning boundary, demonstrate the same assertions reject fresh-equal payload substitution or wrong current charge; disclose fixture sensitivity vs product defect. Do not fabricate an expected product failure if the supported behavior passes.

Queue dedupe: live open issues/PRs2026-10-23 include no matching ACC-002 source-retain charge repair.151 is deferred facade Accounting construction; this fixture uses its supported explicit port.166 concerns nonadditive state,152unknown result settlement; neither is this additive observed usage case. No posts/claims/fixes/pushes.
