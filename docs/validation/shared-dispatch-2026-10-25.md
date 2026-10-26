# Fixed shared dispatch implementation evidence (#238)

Status: local candidate verification in progress; independent adversarial review, publication and acceptance remain pending. This record qualifies only the owner-selected fixed-policy handoff in [the shared-rate plan](../plans/shared-rate-coordination.md#owner-selected-fixed-dispatch-handoff-238), based on #247 at `e3cc375c49cf739aecdc9aee31e9b1cf94643cfc`. It does not qualify full RUN-019, A-12j/l or advanced #239 policy.

## Selected boundaries

The existing facade composition owns one coordinator across all its `openWorkspace` objects and runs. Opening a workspace is not a new rate owner. Separate Supervision compositions share only with the same explicitly injected coordinator; foreign handles are refused. Construction captures the owner so later mutation of supplied options cannot replace it between runs. This supplies no cross-copy, worker or process guarantee.

`IOperationSharedRate` carries an opaque registered surface, explicit `cooldownGateId` and optional conservative `quantityCost`. Run environment and optional retry-source service/connection must match that registration. Retry-source adapter family and opaque binding never define a surface. The reserved base gate spans the environment/service/access domain; source knowledge must explicitly select that breadth. Narrower cooldowns require named registered gates, and missing attribution never defaults to base. Admission always evaluates the full gate union.

Only normalized `rate-limited.retryAt` with explicit association publishes a shared floor, before classification. Generic `notBefore` remains local. Missing timestamps invent no shared duration. Known cooldown sharing works without numeric configuration.

Final ordering is provisional admission before permit; fresh preview after permit; durable operation and Accounting intent; stop recheck; begin observer; synchronous fenced operation authorization; final stop recheck; coordinator commit; transport. The final commit reads injected timing/coordinator ports and offers no author or observer hook. Definite no-send releases provisional state; possible transport retains the debit and honest unknown usage. A failed unsent restoration remains pending and blocks a catching author's completion. Invalid timing is a redacted `rate-timing-failed` error, with no send or rate debit and no publication authority.

## Acceptance mapping

| Issue criterion | Named executable proof |
| --- | --- |
| 1 — Shared fixed limits and distinct scopes | Supervision `two paths and new runs share a fixed gate while an independent account progresses...`; actual facade `the composed contribution caller shares one configured quantity window across members and a new workspace run`; `independent supervisors share admission only when explicitly composed with the same coordinator owner`; quantity-cost refusal and foreign owner/environment/gate/source-consistency cases; coordinator conflicting-registration suite |
| 2 — Explicit known cooldowns and all applicable gates | `a known normalized cooldown is published before async classification, without numeric configuration or retrySource`; real-owner `normalized cooldown publishes before a slow classifier...`; `an immediate retry cannot bypass a known floor...`; `a narrow refusal floor does not narrow all-gate admission...`; generic notBefore/unassociated-response and missing-retryAt cases; explicit reserved-base breadth case |
| 3 — Wait, allowance and stop boundaries | Real-owner `a shared cooldown wait holds neither a request permit nor Accounting intent...`; `a soft stop cancels a retry waiting on shared admission...`; Supervision admitted first-send soft drain, hard withdrawal and soft deadline cases; early timer wake and backward/forward epoch correction cases |
| 4 — Final authority and possible send | Synchronous Accounting-intent/begin/final-journal stop cases; final observer gate, fence and allowance mutation cases; unconfirmed Accounting-intent and failed unsent-restoration cases; `possible transport failure keeps the fixed debit...`; existing #213/#226 crash/stop/unknown-usage suites retained. Six emitted-code fault plants each fail their direct intended assertion, with a restored baseline |
| 5 — Acceptance-anchored independent floors | Real-owner `retry duration and durable epoch floor are anchored together at delayed decision acceptance and independently rechecked`; `a new engine retains the durable accepted epoch floor...`; epoch moves both ways, monotonic completion and durable restart retain independent conditions |
| 6 — Controlled composed caller | Actual facade contribution fixture uses its roster source, member assessment memo/helper and fold paths over real History/Accounting/Supervision. Controlled real-owner adapters and clocks separately prove timing. This is composed operation-caller evidence; source-hook composition under #254/#240 remains pending and is not claimed here |

Alpha consumer tests in Supervision and microdelta accept explicit association without retrySource, require a cooldown gate and duration clock where applicable, and reject caller-chosen gate subsets or nonnumeric quantity. API reports retain the alpha release boundary.

## Test-first evidence

- Initial outcome assertions preceded runtime changes: 10 failures / 40 passes. Direct assertions exposed cross-run oversend, missing shared cooldown/association checks, final observer gate bypass, stopped waiting sends and lost possible-send debit.
- The facade consumer failed specifically for the absent association/registration exports after sibling declarations were refreshed.
- A new final fenced write introduced a reentrant stop gap: the no-send test observed one transport invocation before ordering was repaired.
- A failed not-sent restoration let a catching body return. The completion assertion failed before returning a pending unknown-outcome block was implemented.
- Negative/decreasing/throwing clocks initially surfaced `invalid-request`, and a post-intent failure became `operation-deferred`. Typed error/no-debit/no-private-detail assertions preceded the repair.
- Mutating assembly options replaced the owner between runs. The stable-owner assertion failed before construction began capturing the owner.

The original full test attempt exposed a missing elapsed-clock pass-through in the acceptance worker's instrumented Machine fixture; the fixture now re-exports the existing host capability. It also ran while a changed API report had emitted but not yet trimmed public declarations, so that attempt is not final-candidate evidence.

## Verification

Current verified results: final `npm run check` passed; owner operation suite 71/71; actual facade workspace operation suite 16/16; controlled real-owner rate suite 8/8; targeted rate plus crash-recovery worker suites 17/17. The six final mutation plants were rejected directly and the restored 71-test owner suite passed. `npm run changeset:status` lists minor changes for only `@microdelta/supervision` and `microdelta`.

The final full `npm test` was interrupted after logged core success (97 suites / 1,225 tests) and completed packages through Resolution, ending at Supervision unit start without an exit receipt. The old exec session is gone and no npm-test/Jest parent remains. It is unproven as a complete pipeline. Missing Supervision/Tracking/Value tests, experiments/examples, separate `npm run build` and saved PR-body validation remain pending and will be resumed without changing runtime code. No push or PR is authorized until the root supervisor accepts the exact independently reviewed payload.

## Limits

No discovery fairness, finite fair rounds, serial recovery cohorts, single-probe recovery, adaptive policy, provider registry, paid/live provider, new host, quota guarantee or cross-process coordination is established. The existing facade owner is the only facade composition boundary exposed here. Source-hook integration remains explicit follow-up evidence with #254/#240.
