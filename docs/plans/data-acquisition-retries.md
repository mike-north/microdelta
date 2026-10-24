# Data-acquisition retries and shared rate admission

Status: accepted owner decisions from 2026-10-24, recorded for
[issue #212](https://github.com/mike-north/microdelta/issues/212); implementation
handoff, not a claim of delivered behavior. The owner's later corrections govern
this record. [Operations](../spec/operations.md) owns the behavioral requirements;
[acceptance](../spec/acceptance.md#acquisition-retry-and-rate-admission-cases) owns
the required examples. Exact API and persistence representations are not selected
by this document.

## Why the target changed

The analysis acquires data, including generated model output for which a provider
may charge. Repeating a request after losing its response may acquire the missing
data and may incur another charge. That cost risk does not turn the acquisition
into an external business write which requires proof of no duplicate effect.
HTTP method is not the distinction: a paid POST can acquire data. Local journal,
usage, claim and publication writes still need their existing consistency rules.

The owner explicitly selected this scope and bounded retry, then clarified that
retry tallies reset at the start of **each new analysis run**. Historical failed
attempts must not force a repaired or deliberately restarted analysis to request
compensating allowance. Costs and prior attempts persist, as do reusable completed
results. A deferral pass or continuation of the same run is not a new run.
This is a changed target, not a claim that the former implementation violated its
former contract. No live provider execution is authorized by the decision.

## Accepted decisions and supersession

| Decision | Owning requirement | Supersedes or preserves |
| --- | --- | --- |
| External operations in current scope acquire analysis data; a lost response may retry within finite authority without an effect-safety declaration or provider deduplication prerequisite | DOM-7, RUN-011/012 | Supersedes the external-business-write/no-blind-replay gate for this scope; provider idempotency can still aid deduplication but proves no billing total |
| Three total attempts per operation per run are the default, with finite overrides and sensible increasing default backoff; every new analysis run starts fresh retry tallies; same-run continuation does not replenish them | RUN-011 | Supersedes the earlier audit's lifetime operation ceiling and its suggestion that a new run always needs additional authorization after prior exhaustion |
| Exhausted acquisition supplies no result; rejecting further retries for required input gracefully stops the entire analysis | RUN-010/011/014 | Preserves attempt diagnostics, incomplete coverage, soft-stop drain and completed reusable work; does not omit required input or manufacture partial success |
| A matching reusable source callback overrides built-in retry defaults and returns immediate retry, delayed retry with duration, or stop retrying; it receives prior-attempt information | RUN-011 | Classification/delay is separate from finite allowance; no fourth callback result or per-call policy boilerplate is selected |
| Optional proactive rate configuration: when absent, ordinary execution/concurrency and bounded provider-response retry policies apply without an implicit proactive cap | RUN-019 | No mandatory rate configuration, unlimited retries, automatic headroom reservation or dynamic quota inference |
| When configured, static units-per-time limits coordinate before sending for all concurrent users of the same configured connection and limit, including retries, in one Node process | RUN-019 | Preserves independent request permits and Accounting evidence; no cross-process coordinator or provider-remaining-quota guarantee |
| Shared reactive cooldown and fair admission for a known common limit apply even without proactive numeric configuration; eligible earlier-discovered work is favored | RUN-019 | Extends earlier configured-only coordination scope for the first build; no arrival-order equivalence, all-waiter burst, global deterministic ordering or advanced priority optimizer |
| Manual operator-supplied result recovery is deferred | RUN-012 | Earlier validator-at-definition, pending-evidence validation and duplicate-submission discussions are not current implementation requirements |

The owner's later rate-default clarification makes proactive pacing optional.
Without rate configuration, work continues under normal execution/concurrency
controls and reacts to contextual provider rate signals through bounded source
retry policy. A user may choose a lower configured limit to leave headroom for
other activities; this selects local pacing, not automatic reserve management or
a guarantee of remaining provider capacity. A later owner decision selects three
total attempts by default, a sensible
initial backoff and increasing later waits, with finite allowance overrides and
exact timing still open. Another later decision extends first-build coordination
to a known shared reactive cooldown even without numeric configuration. It favors
earlier-discovered eligible work because it may unlock downstream progress;
queue arrival does not express that preference. Neither decision changes known
not-before times or stop/fencing rules.
Provider-limit report visibility/retention is separate #166 work and is not
selected here.

The earlier batching/frontier/fixed-additional-budget account was explicitly a
**proposal for evaluation**, not an accepted instruction. Its initial accepted
label was corrected by the owner. It does not establish a queue, prompt frontier,
fixed grant size, allocation across requests, or approval of future requests.
The separately accepted rate-admission queue is not this approval proposal.
Rejecting further required retries and new-run replenishment were accepted later
and stand independently of that proposal.

## Responsibilities without a new service DSL

A **source step** produces data under its source acceptance/finality policy;
Reuse Resolution owns whether its existing result is acceptable now. A **remote
service** is an external system called to obtain some of that data. A reusable
**remote data-source policy** interprets failures across applicable calls to that
service. It need not be a new source step, a one-to-one mapping to a service, or a
new bounded context. A memoized assessment and an ordinary source can use the same
remote service and connection without sharing their result identities.

A configured **connection** identifies the applicable remote access configuration;
a **limit** identifies the common rate scope of applicable callers, whether
known from source/provider context for a reactive cooldown or explicitly configured
for proactive units/time pacing. Numeric configuration is not required to know
that concurrent calls share a limit. This identity is not a raw credential or
provider body. Environment
selection and credential/service isolation remain RUN-017 responsibilities.
Matching retry policy and sharing a rate limit are related configuration decisions,
not the same operation: a policy match does not silently merge distinct accounts,
connections or quota pools.

Definition & Binding still owns declarations and call correspondence. Source
adapters interpret service status/error/context and retry delay; Supervision owns
run allowance, timing, stop and coordinated admission. Accounting owns observed
usage and gaps; History persists fenced opaque records. Machine supplies host
clock/timer/context capabilities. The facade composes these owners. No new global
registry, credential DSL, secret store or physical single network dispatcher is
required by these meanings. Their concrete reusable definition, matching and
configuration API remains to be chosen in a bounded implementation design.

## Preserved boundaries and compatibility

- Preserve stable logical-operation correlation and distinct request-attempt
  identities, request binding, one in-progress call at an address, and no sends
  from an ended step attempt. A run allowance reset does not rewrite identity or
  billing history.
- Preserve durable intent before actual send, Accounting acknowledgment semantics,
  atomic journal/block-index updates, current lease/fence checks, and conservative
  recovery of in-flight attempts. A possible landed intent is not silently
  rewritten as definitely unsent. Local busy/unknown-commit recovery is distinct
  from provider retry classification.
- Preserve durable not-before timing across new runs, release of permits/window
  lanes during waits, lease release/reacquisition, and no stale publication. New
  allowance does not override a wait, the selected stop boundary or ownership
  failure. Soft stop refuses new admissions/retries but preserves an already
  admitted step's remaining first-attempt requests under permits/rate/fence; hard
  stop or deadline escalation prevents further affected sends (A-12b).
- Preserve taint/no-fabricated-result protection, privacy-safe identifier events,
  strict/outcome-fold coverage and readonly inspection. A provider success on a
  later attempt does not fill earlier missing usage; each distinct reported
  attempt is counted separately and each report delivery only once.
- Existing version-1 journal records and alpha consumers contain `safeToRepeat`,
  `providerIdempotency`, unknown/failed/resolved/abandoned states and consumed
  addresses. The implementation must choose and test explicit compatibility
  handling before changing these representations. Do not reinterpret an old
  operator assertion as an acquired value, delete its audit evidence, silently
  refill a continuing run, or claim a legacy record already conforms to the new
  target. Format/version migration and API deprecation/removal remain design
  work, not selections in this documentation change.

## Bounded implementation handoffs

These are proposed issue boundaries grounded in accepted semantics, not new issue
numbers or permission to implement them in this documentation change. The
supervisor owns queue readiness and creates/updates the actual issue contracts.
Every implementation starts with the named outcome tests and observes their
expected failure before code. Strict package/type/lint checks, intent comments,
negative controls and independent review remain required.

| Slice and owner | Test-first outcomes | Dependencies and readiness boundary |
| --- | --- | --- |
| Acquisition allowance and journal compatibility — Supervision with History/Accounting conformance, Core assembly | A-12a/b/c/f/g: lost response then success without safety flags; current-run cap; same-run pass cannot reset; new run can try with fresh cap while prior usage stays unknown; old records reopen truthfully; crash/lease/intent controls survive | Accepted behavioral scope is ready for a contained implementation issue. That issue must first document explicit run identity/continuation and version-1 compatibility handling, and preserve generated alpha contracts. Do not wait on manual recovery or approval batching |
| Reusable retry classification — source adapters with Supervision | A-12d/i: default three total attempts and increasing backoff with finite override; immediate/delayed/stop, prior-attempt backoff, custom match wins, no-match default, exhausted allowance and stop still prohibit send | Semantics ready for a bounded issue. Select callback encoding, safe context/history scope, matching ambiguity rules and concrete default classification/delays there before tests freeze them; do not select the whole data-source/credential DSL |
| Shared proactive and reactive rate admission — Supervision with injected Machine timing | A-12e/h/j: known shared cooldown without numeric configuration, no sent-attempt/permit consumption while waiting, controlled resume, earlier-discovered eligible work preference; omitted configuration admits ordinary work without an implicit cap; contextual provider rate signals still obey finite retry/not-before; configured concurrent paths and retries share one configured connection+limit; controlled clock denies premature/oversized aggregate work; separate limits stay independent; hard stop/deadline escalation during wait sends nothing while soft drain retains first-attempt eligibility | Accepted single-process scope is ready for a bounded implementation design. Specify unit-cost availability, time-window/burst algorithm, cancellation reservation handling, known/unknown shared-scope identity, discovery sequencing across branches/runs, retry placement, fairness and cooldown timing representation before implementation; do not infer dynamic provider capacity or cross-process state |
| Graceful rejection and controlled acquisition example — Supervision/Core and example | A-12b/c: no sends past allowance, declined required retry triggers existing soft stop/drain, completed siblings reusable in new run; status distinguishes attempt failure from missing input | Reuse existing stop control. Depends on acquisition allowance and the minimum operator boundary chosen for rejection; no general batch-approval UI or supplied-result workflow is required. Command/exit representation is still to be specified, not fabricated here |
| Within-run additional authorization / approval batching | Evaluate explicit finite authority without treating old attempts as absent; inspection never grants it | **Not pickup-ready as an API feature.** Approval frontier, batching, grant size/allocation and repeated-decision behavior remain proposed. New-run allowance is already settled and must not wait for this proposal |

The unit/window algorithm may be an engineering choice if it preserves an
explicitly documented bound; a material burst/latency or author-visible tradeoff
must be brought back for decision. Do not invent a universal proactive rate cap,
default rate time window or a fictitious provider quota unit to make a slice look ready.

## Evaluation of the approval proposal

No exhausted request executes an unapproved retry, so unapproved retries do not
by themselves create a snowball of additional requests or spend. Independent
work can still consume authority it already has; that is not approval of exhausted
work. Batching might reduce interruption, but waiting for a frontier can delay
useful recovery, and a fixed attempt count is not a dollar cap. Those are the
tradeoffs to evaluate, not a directive to implement a batch queue. A rejected
required input cannot be omitted to call the analysis complete: RUN-014 specifies
whole-analysis graceful stop. A later **new run** starts fresh allowance under
RUN-011 without erasing the old evidence.

## Queue and delivery limits

- [#152](https://github.com/mike-north/microdelta/issues/152) and its existing
  result-bearing settlement proposal are **deferred**, including the earlier
  validator/staging/idempotent-submission discussions. They are not a prerequisite
  for [#170](https://github.com/mike-north/microdelta/issues/170)'s controlled roster.
  This does not remove ordinary validation of actual provider results.
- The controlled roster must instead consume the bounded acquisition, missing-data,
  usage, timing and stop behavior above. CLI/inspection
  [#167](https://github.com/mike-north/microdelta/issues/167), preview
  [#165](https://github.com/mike-north/microdelta/issues/165), and nonadditive resource
  observation [#166](https://github.com/mike-north/microdelta/issues/166) retain their
  own scope and unresolved decisions. Neither their proposals nor full roster
  delivery become accepted or implementation-ready wholesale through this change.
- Dynamic header/quota/reset/reserve inference, cross-process or cross-machine
  rate coordination, advanced DAG/cost priority scheduling, result injection,
  business-write replay and credential DSL construction are outside this implementation sequence. Honoring an already
  supplied retry-not-before time remains required; it is not a new provider-quota
  admission system.
- The currently shipped M5 API still implements the former effect-settlement
  policy. Its guides, tests and generated declarations are current implementation
  evidence, not proof of this changed target. Runtime remediation must update them
  together and add new evidence. Historical EXP-8/M5 results remain dated evidence.
