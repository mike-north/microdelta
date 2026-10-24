# Shared rate coordination design proposal

**Status:** Proposed engineering design for [issue #221](https://github.com/mike-north/microdelta/issues/221). The supervisory agent must accept or revise the material choices below before implementation. This document does not change the accepted contract, select a public API, or claim runtime behavior is delivered.

**Governing sources:** [RUN-019](../spec/operations.md#run-019--shared-rate-admission-precedes-each-send), [A-12e/h/j/k/l](../spec/acceptance.md#acquisition-retry-and-rate-admission-cases), [Run Supervision ownership](../spec/architecture.md#arc-001--six-contexts-one-owner-per-invariant), and the accepted [acquisition handoff](data-acquisition-retries.md). These sources establish the required outcomes and boundaries. This proposal fills in candidate engineering choices; it does not restate or supersede those requirements.

## Purpose and scope

A single analysis run can share a remote service with other branches and runs. Each request must satisfy every applicable shared limit before dispatch, while retry allowance, request permits, persistence, usage evidence, and stop authority retain their existing owners. A shared rate coordinator gives Supervision one place to enforce those admission conditions and gives a consumer policy a narrow way to refine grouping and pacing.

This design is process-local to one Node event loop and one explicitly composed coordinator owner. It adds no provider registry, source or credential DSL, policy language, built-in adaptive strategy, cross-process coordination, quota guarantee, or paid-provider call. Machine remains the source of clock/timer capabilities; Accounting records observed usage; History retains fenced records; retry classification interprets failures; Supervision owns admission and dispatch.

The choices are intentionally reviewable candidates. In particular, the rolling-window algorithm, serial recovery cohort, finite fair rounds, bounded observation envelope, and failure behavior below are not owner-approved numbers or settled API details.

## Concrete caller situations

These cases establish what the candidate model is meant to explain; they do not promise a globally optimal schedule.

1. Two branches and a second run use one catalog surface without numeric pacing. A contextual response associates a cooldown with its known API-wide gate. Matching initial requests and retries wait, while an unrelated account continues.
2. Catalog and search share an API-wide gate; search also uses a narrower gate. A search-only cooldown leaves catalog work eligible. A request cannot pass by satisfying just one of its gates.
3. Work discovered earlier may reach the queue later. If discovery 12 and discovery 20 are both ready at the same selection point, 12 gets preference. If 12 becomes ready only after a finite round was already snapshotted, it joins the next applicable round; the scheduler does not reopen a closed round or undo a send.
4. A consumer configures a ten-unit, 60-second window; catalog costs one unit and search costs four. Two searches and two catalog calls consume ten units; another search waits for enough old debits to expire. A new run cannot refill this coordinator-owned ledger.
5. A fake async strategy observes repeated search refusals and temporarily groups catalog with search. Queued calls use the new plan after it commits. Already dispatched calls retain the memberships and evidence captured when they were sent.
6. A soft stop arrives while an admitted step's first request is waiting. That first attempt can drain if all other conditions still pass; retries and newly admitted work cannot. A hard stop, deadline, tainted step, or lost fence prevents its eventual dispatch even if an adapter later returns a permissive plan.

## Ownership and proposed state model

One coordinator is created by the production assembly/service-domain owner and shared by that owner's composed supervisors and runs. A run start, pass continuation, lease reacquisition, or retry does not create fresh rate state. Independently composed owners must receive the same coordinator explicitly to share it. A module singleton is not a cross-package-copy or worker guarantee.

Within the coordinator, an interned surface handle identifies a non-secret `(environment, service, access context, logical API surface)` tuple. Repeated declarations for the same tuple in that owner resolve to the same live state; conflicting declarations fail before sending. Do not derive identity from hostname, credential material, display names, or callers constructing equal-looking limiter objects. Ordinary source wrappers attach their known surface once. A request with no proactive numeric configuration remains ordinary eligible work.

A surface has a base logical gate so a known contextual limit can coordinate without numeric configuration. Named request classes such as `catalog` and `search` are optional descriptors under that surface. A gate may cover one surface, multiple explicitly registered surfaces in the same service/access domain, or a narrower class. Each request snapshots its applicable gates and must pass them atomically. An unassociated generic request stays ordinary; a rate signal without a known association retains its operation's own retry/not-before handling but cannot justify guessed cross-request sharing.

Keep two origins of constraints distinct:

- **Mandatory facts:** source-associated known-limit memberships and cooldowns, user-configured windows, and durable per-operation not-before floors. Policy updates cannot remove or shorten them.
- **Policy hypotheses:** inferred memberships and extra pacing supplied by the consumer strategy. A new valid plan may revise these for queued work. Such revisions never rewrite dispatched evidence or mandatory facts.

Stable gate IDs are scoped to the coordinator domain and contain no secrets. Numeric bounds and units are immutable for a configured gate. Policy output can add constraints, but cannot remove mandatory gates, replace request identity, grant retry allowance, select credentials, declare usage, write a journal, or dispatch transport.

## Proposed numeric admission rule

For a configured `(U units, T milliseconds)` gate, use an exact rolling weighted window. At time `now`, the sum of dispatched declared costs in `(now - T, now]`, plus a proposed request's cost, must be at most `U`. A debit exactly `T` old has expired. Apply the same rule to all overlapping configured gates in one atomic admission decision.

Costs are positive safe integers. Reject a missing cost when a configured gate requires one, fractions, zero/negative values, non-finite values, overflow, and any single cost greater than `U`. Do not interpret an unknown cost as zero, split one external operation into multiple sends, or infer billed provider units. A fixed request-count gate naturally assigns cost one. A quantity gate needs an exact pre-send amount or a documented conservative upper bound.

For example, with `U=10` and `T=60s`, debits of 4, 4, 1, and 1 at `t=0` exhaust the window. A further cost-4 request waits until enough debits have expired. This is not a token bucket: a token bucket could send ten at `t=0` and nine at `t=54s`, exceeding ten in the rolling minute. It is also not a fixed clock-minute window, which can burst across a boundary. The rolling choice avoids boundary bursts at the cost of retaining dispatch debits for the lookback and sometimes delaying work a more compact algorithm could admit.

A debit is made only when dispatch becomes possible. Rate and policy waits consume no sent attempt and hold no execution permit. If Supervision obtains a permit at dispatch opportunity but a current check, cancellation, or durable-intent step prevents transport invocation, return the permit and release provisional rate state. Once transport invocation is possible, retain the rate debit even if the call throws or its outcome becomes unknown; do not refund possible remote work or usage. A successful usage report does not retroactively alter the declared rate cost.

An operation's effective earliest time is the maximum of its durable not-before, selected retry delay, mandatory shared cooldowns, committed policy pacing floors, and configured-window eligibility. No layer shortens another. New-run retry allowance cannot erase any such floor.

## Known cooldown and controlled recovery

When a contextual rate signal is associated with a known shared gate, publish its cooldown before awaiting classifier or strategy work. Merge repeated known floors by maximum. If no provider timestamp is available, the applicable bounded retry delay may supply a floor when one exists; immediate retry or stop classification adds no invented duration. Classification does not cancel a separately known cooldown.

After that cooldown, keep the affected gate in a recovery episode while its finite waiting cohort drains. At expiry, snapshot the tickets that pass non-rate prerequisites; each may dispatch at most one request through that recovering gate before its response settles. Do not release every waiter at once. Late arrivals obey the same serial admission but do not extend the captured cohort. A cohort ticket that still passes non-rate prerequisites remains a cohort member while waiting for rolling-window capacity. Tickets withdrawn by cancellation, stop, deadline, lost fence, or other lost eligibility leave the cohort without reserving a permit or attempt. Leave recovery after all cohort tickets have dispatched or withdrawn and the last recovery send has settled; a new contextual rate refusal starts a new episode. If the cohort is empty, admit one eligible probe before returning the gate to ordinary concurrency.

The tradeoff is explicit: a cohort of `n` requests can take about `n` response latencies to drain even when the provider would accept a burst. This avoids guessing provider capacity or opening a large burst after one probe. Unrelated gates keep progressing. Existing in-flight calls cannot be recalled; their occupancy counts when deciding whether recovery may start another call.

## Discovery preference and finite fair rounds

Assign a process-monotonic discovery ordinal when Supervision discovers a concrete invocation/member, before network queue arrival. Preserve it through waits, retries, and passes of that live run. Pair it with a private run instance and within-invocation operation ordinal for identity and ties; public run IDs, arrival order, persisted result identity, and speculative DAG expansion do not define priority. Work first discovered inside an executing body inherits its invocation's ordinal and receives an operation ordinal when its descriptor becomes concrete. New runs receive later ordinals without resetting shared state.

Use finite rounds. A round snapshots a finite cohort of ready invocation/member lineages; each lineage can dispatch at most one pending request attempt in that round. Among ready and unserved lineages, select the oldest discovery ordinal, then its oldest operation ordinal. Newly ready/discovered work and a served lineage's next request or retry join the next applicable round. If both of the requests in caller case 3 are ready in one snapshot, discovery 12 wins despite later queue arrival. If 12 becomes ready only after the snapshot, it waits for the next round; discovery preference does not undo already dispatched work or reach backward across a closed eligibility snapshot. An ineligible older request never blocks ready work and does not hold a round open.

A request that passes dependency, timing, stop, allowance, taint, and fence prerequisites may protect its turn while configured capacity is insufficient. It reserves no future timestamp, numeric capacity, attempt, intent, or permit. Younger work sharing its constraining gates waits behind it; disjoint gates continue. Protection is released immediately if a non-rate prerequisite fails or policy membership changes.

Protection covers the whole current set of constraining gates. Acquire all turn rights together: do not hold a partial gate set while waiting on a second gate. A later cohort can make progress whenever no earlier protected turn directly overlaps its gates. There is no global round barrier: while an API A search waits for capacity, API B can complete independent rounds. Where contenders bridge gate sets, use cohort order followed by discovery order as one consistent precedence to avoid cycles; do not require unrelated gates to drain.

This deliberately favors bounded fairness over work conservation. If a ten-unit window has eight units at `t=0`, a four-unit search waits until `t=60`; a protected turn can also delay younger one-unit catalog work at `t=50`, though one such call might fit without delaying the search. This protects a large-cost request from an endless stream of small requests without computing future multi-gate reservations. The guarantee is conditional on finite costs and competitors, eventual availability of gates and permits, and a strategy that eventually settles. If a permit is continuously unavailable, release gate protection while preserving the unserved turn so other runs can proceed. No scheduler can guarantee service under perpetual provider refusal, exhausted authority, or a strategy that continually defers.

## Policy boundary and bounded observations

Use one optional policy instance per coordinator service/access domain. Ordinary behavior needs no policy registration. A constant global policy and an async adaptive policy use the same conceptual seam:

```ts
assess(readonlySnapshot, decisionSignal): PolicyPlan | Promise<PolicyPlan>
```

This is an explanatory sketch, not an exported type. The snapshot can include non-secret surface/class handles, current revisions, mandatory gate summaries, bounded observation summaries, and readonly queued/in-flight counts. It has no send, permit, allowance, journal, Accounting mutation, credential selection, or mutable coordinator capability. A plan names exact class-to-additional-gate memberships, optional additional numeric gates, and per-class/gate pacing floors. It is data, not a predicate or executable matcher; this avoids introducing a policy DSL.

A candidate initial envelope is at most 64 declared surfaces/classes, 32 active or retained policy gates, 256 retained observation summaries per domain, eight condition identifiers per observation, and 128 characters per identifier. These are tentative validation/storage limits, not provider limits or owner-approved constants. Overflow fails closed without silently evicting an active constraint; supervisory review must confirm or revise every bound before implementation.

Each bounded observation can carry coordinator sequence/time, request class, outcome category, contextual rate facts, known not-before, and membership revision at dispatch. Include success and unknown/cancelled outcomes as well as rate refusals so the adapter can distinguish missing history. Expose no result, body, raw header, credential, URL, or raw error payload. When history is truncated, report omitted count and first/last retained sequence. Runtime retains only the bounded recent summaries; consumer-owned derived state is not persisted or sandboxed by TypeScript.

A simple policy can return a constant global grouping and pacing plan synchronously. A fake adaptive policy must read two retained search-rate observations, await a controllable promise, add catalog to a search gate, then change an additional pacing floor after a later observation. This verifies that the seam supports history-driven regrouping and async decisions rather than merely static configuration plus a delay callback. Neither example runs a model or provider.

## Async updates, correction, and failure

Serialize policy evaluations per instance and coalesce relevant descriptor/observation changes while one is active. During an unresolved update, affected queued work waits without holding permits or attempts; unrelated domains continue. Known cooldowns remain effective immediately. Track coordinator lifetime, accepted-policy revision, descriptor-catalog revision, and decision generation separately.

New observations alone do not stale an answer: validate and atomically apply it against current mandatory facts, then let the strategy assess accumulated observations. A changed descriptor catalog or replaced policy invalidates an answer; discard and reassess. Cancelling one ticket does not invalidate a class-level answer. Ignore late completions from disposed or failed generations and consume late promise rejections. A committed plan applies to queued work on its next selection. In-flight requests retain their dispatch-time memberships and debits; they are never reassigned or re-debited.

If a strategy corrects an inferred catalog/search group, queued catalog work can proceed under its mandatory API gate after the revised plan commits. Its own operation not-before still applies; an authoritative API-wide cooldown still applies to both. A strategy-only inferred cooldown may be revised with that hypothesis; a source-associated known cooldown may not. For a newly introduced numeric gate, require complete retained dispatch evidence for its lookback or treat it as fully occupied for `T`; truncated history must never create free capacity. Reusing a gate ID reuses retained debits until expiry. Renaming/removing a policy gate can revise only hypothetical pacing, never mandatory constraints.

A throw, rejection, invalid plan, or configured assessment timeout quarantines that strategy generation and returns a typed local policy failure for affected work. Preserve all mandatory constraints and evidence; never fall back to unconstrained dispatch or reinterpret the failure as provider retry evidence. No hidden default timeout is proposed: an optional finite timeout may be configured; otherwise stop, coordinator disposal, or caller deadline defines cancellation. A never-settling policy with no configured timeout, stop, deadline, or disposal remains visibly waiting in only its affected domain and holds no network permit or attempt; unaffected domains continue. A configured timeout or caller cancellation boundary must promptly settle the affected ticket with a typed local outcome. This distinction is necessary because an implicit timeout would conflict with the proposed no-hidden-timeout default; acceptance should test both a cancellable never-settling callback and the intentionally pending uncancelled case. Cancellation is cooperative: stop waiting on that generation and ignore its late result or rejection, but do not claim arbitrary consumer code has been forcibly terminated. Recovery is explicit strategy replacement on the same coordinator, preserving queue identities, ledgers, cooldowns, and observations; it neither revives failed operations nor grants attempts.

A hard stop/deadline removes its own tickets immediately without waiting for adapter cooperation. Soft stop removes retries and new admissions while preserving eligible admitted-step first attempts; its draining wait must not be aborted by reusing a blanket classifier-stop signal. Abort a shared assessment only when the coordinator is disposed or no client needs it.

## Atomic dispatch seam and dependencies

The coordinator is the sole issuer of rate admission. Timers and wakeups schedule a pump; they do not hand out reusable permits to every waiter. At the final pre-send boundary, Supervision must recheck current policy/memberships, all windows and cooldowns, operation not-before, allowance, soft/hard stop and deadline, active untainted request binding, durable intent, and current fence. This protects the accepted runtime invariants; policy permission alone never authorizes a send.

The proposed integration with #213 keeps its synchronous intent-before-perform rule. A request may obtain a run permit only at dispatch opportunity; if any current check fails, return it immediately. No `await` or policy callback may split final gate validation from dispatch. After durable intent succeeds, recheck state observable through synchronous callbacks, debit every applicable gate and mark the attempt sent immediately before invoking transport. Intent failure releases provisional resources according to #213's truthful not-sent/unknown-intent result. Once transport may have been invoked, keep debit and unknown-usage evidence. Synchronous observer callbacks must not create a gap in which stop, policy, or fence changes are ignored.

Issue [#226](https://github.com/mike-north/microdelta/issues/226), which rechecks hard stop after send observers, is a prerequisite for integrating this seam into provider dispatch. Reconcile the merged #213 contract/API and #220 classifier before wiring retry timing. The coordinator itself must not absorb retry classification, Accounting, History, or Machine responsibilities.

## Proposed implementation handoff

These are reviewable sequencing cuts, not new issue contracts or authorization to implement. Each software cut follows repository test-first, strict TypeScript/lint/declaration/import checks, intent comments, and bounded negative controls. A cut is not complete until its named acceptance behavior is evidenced.

| Cut | Scope and proof | Dependency / boundary |
| --- | --- | --- |
| A — Coordinator core | Interned assembly sharing; exact rolling weighted ledger; overlapping all-gate admission; unit validation; cooldown floor; cancellation before dispatch; constant policy on the shared seam. Test omissions, exact expiry, overflow, oversized cost, no refund after possible send. | Reconcile accepted RUN-019 and current #213 contracts. No retry classifier or async inference implementation. |
| B — Queue, recovery, dispatch | Discovery tokens, finite rounds, protected turns, serial cooldown recovery, no global barrier, permit lending, atomic all-gate dispatch and stop/fence/taint controls. | #226 must be fixed and merged before provider-dispatch integration; reconcile actual #213 API. |
| C — Adapter conformance | Bounded observations, async lifecycle/revisions, queued regrouping, stale/error/invalid-output behavior, privacy and correction. | Use controlled fakes. #220 may provide classification timing through a narrow port; its policy and allowance stay separate. |
| D — Assembly and migration | Production assembly shares coordinator state; wrappers register non-secret surfaces; docs and API reports match the selected alpha shape; legacy journal compatibility stays truthful. | No #218 prerequisite, provider catalog, persistence of volatile coordinator state, cross-process guarantee, or paid execution. |

Before implementation, supervisory review should explicitly accept or revise: rolling window versus other burst semantics; the serial finite recovery cohort; finite rounds and protected turns including the late-readiness exception; observation/gate bounds; the timeout/cancellation distinction for never-settling assessments; quarantine behavior; and exact assembly ownership. Callback spelling and package placement can remain implementation choices if they preserve these boundaries.

## Controlled validation catalog

These twelve outcomes trace the proposal to A-12 and include negative controls. They are design acceptance criteria, not results already demonstrated by tests.

| Case | Required controlled outcome |
| --- | --- |
| 1 — Omitted configuration (A-12h) | Ordinary ready work proceeds under normal permits with no synthetic cap or delay; a known surface alone does not activate proactive pacing. |
| 2 — Shared rolling ledger (A-12e) | Two runs share the ten-unit/60-second example, mixed one/four costs, exact expiry, and a fresh retry allowance cannot reset debits. Reject per-run copies, a token-bucket schedule that exceeds ten in a rolling minute, and a fixed-window boundary burst. |
| 3 — Overlap and cost validation (A-12e/k) | Search requires API plus narrow gate atomically. Insufficient capacity in either gate consumes neither. Cover unknown, oversized, fractional, negative, overflow cost, cancellation before intent, and no refund after transport may have started. |
| 4 — Cooldown scope and floors (A-12j/k) | Search-only cooldown leaves catalog eligible; API-wide cooldown holds both; independent accounts on one hostname remain separate. Repeated floors combine by maximum; an immediate retry cannot bypass them; new-run allowance changes nothing. |
| 5 — Finite serial recovery (A-12j) | With hundreds of waiters and normal permit capacity at expiry, one recovery call per gate is in flight; the finite cohort drains, late arrivals do not prolong it, ordinary admission resumes, and unrelated gates continue. Reject sleeping each caller then racing for permits. |
| 6 — Rounds and starvation (A-12j) | Reverse queue arrival versus discovery; include late readiness, concurrent branches/runs, retries, dependency/not-before ineligibility, and a stream of one-unit jobs. An eligible protected four-unit request eventually proceeds. While protected API A waits, API B completes successive rounds. Reject a global-round barrier and partial-turn deadlock on an overlapping bridge request. |
| 7 — Common sync/async policy seam (A-12l) | A constant global policy and fake async strategy use the same boundary. Two retained refusals drive queued regrouping; a later observation changes pacing. Reject a static-only adapter with an identical delay hook. |
| 8 — Revision and lifecycle races (A-12l) | Complete assessments after new observations, descriptor registration, ticket cancellation, replacement, and disposal. New observations do not cause endless invalidation; stale generations never mint admission; no double evaluation or unhandled late rejection. |
| 9 — Policy failures (A-12l) | Throw, reject, malformed/oversized output, throwing getters, and configured timeout preserve known constraints and produce typed local failure. A never-settling callback returns promptly when timeout/stop/deadline/disposal supplies the cancellation boundary; without one, it remains visibly pending in that domain. No fallback send, leaked permit, charged attempt, or provider retry evidence. |
| 10 — Inference correction (A-12l) | Remove an inferred group during cooldown; regroup around in-flight requests; add a gate with incomplete lookback; exhaust retention and churn revisions. Queued catalog resumes under remaining mandatory constraints while its own not-before and authoritative cooldown remain. |
| 11 — Stop and fence interleavings (A-12b/e/l) | Stop between wakeup, permit handoff, intent, and transport; include synchronous observer stop, allowance exhaustion, taint/end, and lost fence. Eligible soft-stop first-attempt drain can send; retries/new work and hard-stopped work cannot. |
| 12 — Wait resource and privacy evidence (A-12e/h/l) | Rate/policy waits hold zero execution permits and charge zero sent attempts; permit lanes can be lent/reclaimed; cancel each reservation stage; failed/uncertain intent preserves #213 accounting and restart semantics. Callback/history fixtures exclude credentials and request/result payloads. |

The design makes no claim beyond the controlled cases: no globally optimal DAG schedule, provider quota knowledge, cross-process sharing, or proof that consumer strategy side effects are sandboxed. Runtime conformance requires new test-first evidence after the proposal is accepted.
