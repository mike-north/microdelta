# Fixed shared dispatch implementation evidence (#238)

Status: local runtime verification is complete, and a different adversarial reviewer returned PASS for runtime candidate `bbc8099bdf3dbfa3f995eb8d9522af0f4af29e92`. This documentation-only completion record awaits separate review; publication and final supervisory acceptance remain pending. This record qualifies only the owner-selected fixed-policy handoff in [the shared-rate plan](../plans/shared-rate-coordination.md#owner-selected-fixed-dispatch-handoff-238), based on #247 at `e3cc375c49cf739aecdc9aee31e9b1cf94643cfc`. It does not qualify full RUN-019, A-12j/l or advanced #239 policy.

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

An earlier pre-final full test attempt exposed a missing elapsed-clock pass-through in the acceptance worker's instrumented Machine fixture; the fixture now re-exports the existing host capability. It also ran while a changed API report had emitted but not yet trimmed public declarations, so that attempt is not final-candidate evidence.

## Verification

All runtime verification below applies to frozen candidate `bbc8099bdf3dbfa3f995eb8d9522af0f4af29e92`; this follow-up changes only this evidence document.

- Full `npm run check` passed, including the generated declaration/API reports, strict TypeScript, type-aware lint and package/host boundaries.
- Focused owner operation suite: 71/71. Actual facade workspace operation suite: 16/16. Controlled real-owner rate suite: 8/8. Targeted rate plus crash-recovery worker suites: 17/17.
- Each of six final emitted-code mutation plants failed its named direct assertion; the restored 71-test owner suite passed. The plants cover final stop, fence, allowance, shared gate, confirmed intent and collapsed independent access scopes.
- `npm run changeset:status` lists minor changes for only `@microdelta/supervision` and `microdelta`.

The final `npm test` invocation was interrupted after its successful root build, fanout-dispatch gate, subtree-query gate, 368 tooling assertions and workspace packages through Resolution. The recorded workspace prefix includes Accounting, microdelta (97 suites / 1,225 tests, followed by its type/control phases), Definition, History, Machine, Machine Node, Materialization and Resolution through its public-consumer command. It ends at Supervision unit start without a final-command exit receipt. No surviving npm-test/Jest parent remained when verification resumed.

Only the missing suffix was rerun, without changing runtime code:

```sh
npm run test --workspace @microdelta/supervision &&
npm run test --workspace @microdelta/tracking &&
npm run test --workspace @microdelta/value &&
npm run test:experiments &&
npm run test:examples
```

That suffix completed with exit 0: Supervision's 269 runtime assertions plus tsd/public-consumer/anchor checks; Tracking's 134 assertions plus controls and tsd; Value's 60 assertions plus tsd; every experiment suite; and all 17 example tests. The recorded prefix and successful resumed suffix cover every stage of the checked-in root test script. This is composed interrupted-and-resumed evidence, not a claim that an uninterrupted `npm test` completed.

The separate final `npm run build` completed with exit 0. The saved PR body passed `npm run check:pr-metadata -- --body-file /tmp/issue238-pr-body.md`; `node --test tooling/pr-metadata.test.mjs` passed all 23 checker tests. No push or PR is authorized by these local results.

## Different adversarial review

Reviewer `/root/fixed_dispatch_review238`, distinct from implementer `/root/fixed_dispatch_impl238`, returned PASS for runtime SHA `bbc8099bdf3dbfa3f995eb8d9522af0f4af29e92` against base `e3cc375c49cf739aecdc9aee31e9b1cf94643cfc`. Generalist, tests and TypeScript lenses reported no actionable findings; the merged SARIF contained zero findings. Review ran in a disposable clone and left the original candidate clean and unchanged.

The reviewer independently recompiled and ran the 71 owner assertions, all six fault plants with the restored 71-test baseline, and both core paths (24/24: eight controlled real-owner cases plus 16 actual-facade cases). Supervision tsd/public-consumer and microdelta tsd checks also passed independently. The reviewer verified that the recorded prefix and resumed suffix cover the actual root test script, rather than redundantly rerunning its completed stages.

This PASS covers the bounded runtime payload and does not authorize publication or qualify the source-hook composition still pending below. The supervisor accepted that runtime review and requested this documentation-only reconciliation for a separate review before any push or PR.

## Limits

No discovery fairness, finite fair rounds, serial recovery cohorts, single-probe recovery, adaptive policy, provider registry, paid/live provider, new host, quota guarantee or cross-process coordination is established. The existing facade owner is the only facade composition boundary exposed here. The actual-facade timing case uses a 20 ms configured interval with an 18 ms assertion tolerance; the controlled owner suites separately establish exact clock/floor boundaries. Source-hook integration remains explicit follow-up evidence with #254/#240.
