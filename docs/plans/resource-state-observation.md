# Resource-state reports: accepted scope and implementation handoff

Status: accepted owner decisions from 2026-10-24 for
[issue 166](https://github.com/mike-north/microdelta/issues/166), superseding the
initial proposal's unresolved retention and mandatory selected-balance questions.
This records target behavior, not runtime delivery. [ACC-004/007/008](../spec/operations.md#resource-accounting)
own the contract; [A-14a–f](../spec/acceptance.md#resource-state-report-cases) define
future proof obligations. Exact APIs and storage formats remain implementation choices.

## Purpose and accepted decisions

Consumers need to read what a provider reported about allowed or remaining limits.
A report is time-qualified evidence about shared capacity, not a consumption delta,
a guaranteed current balance or permission to send. Provider activity and windows
continue when the analysis or process restarts, so a still-relevant report must
survive that restart. An old report that no longer matters should not accumulate
indefinitely beside immutable usage history.

| Owner decision | Consequence and limit |
| --- | --- |
| Expose reported remaining-limit information to consumers that want it | Provide recording and read-side access; no dedicated remaining-limit notification system or complete quota-management product is required |
| Retain reports across analysis/process restart while relevant | Durable acknowledged reports remain queryable within their retention period; reopening does not restart their age |
| Prefer an explicit provider reset/validity boundary | Qualify the report by that evidence; expiry does not prove that the provider reset or has capacity |
| Without that information, default to one hour from observation, with an optional override | This is a local retention fallback, not an inferred provider window or balance-validity guarantee; ordinary adapters/users need not supply expiry configuration |
| Evict promptly when irrelevant/expired | Retention is bounded state maintenance, not an indefinite resource-state history; do not evict durable usage, request-attempt or result evidence with it |

The one-hour default resolves the earlier proposal's request for an owner-selected
retention duration. Provider/source validity information takes precedence over the
fallback. A chosen fallback override changes local retention, not provider facts.
Record the observation time and the retention basis so a consumer can distinguish
provider information from a local default/override. Neither a new analysis nor
redelivery of the same recorded observation makes it new evidence.

## Reports before derived balances

For usage deltas 2 and 3 and same-scope reports of remaining 93 and 90, consumption
is 5. The read side may expose both time-qualified reports while retained; it must
not sum them to 183, subtract usage from 90 again or infer usage from their change.
A consumer can inspect the reported numbers without the library first selecting
an authoritative latest balance. Receipt order, a lower number or equal timestamps
do not establish provider source order. Missing report, reported zero, missing
scope/window and known scope/window must remain distinguishable.

Keep available provider/service, account/pool, resource/unit and time/window
qualifications with their reports; do not combine unrelated scopes or expose raw
credentials. Unknown qualifications remain unknown, not a universal pool. A
provider may omit a window and still produce a useful inspectable report: the
local retention fallback does not manufacture that missing window.

No source-order protocol, latest-state reducer, minimum-balance tie-break, complete
provider taxonomy or multi-provider aggregation engine is a prerequisite to this
slice. If a later feature promises a selected latest balance, it must separately
specify the comparison/ordering evidence and ambiguity behavior. The initial
proposal's latest-balance and source-order recommendations are not accepted
requirements merely because the owner accepted report visibility.

State availability and usage completeness are independent. A state report cannot
acknowledge missing usage, and complete usage does not prove a state report exists.
Neither a report nor its expiration authorizes admission, retry, refresh or deletion
of immutable analysis history.

## Retention, reads and ownership

Resource Accounting owns typed state-report evidence, its persistence/read ports,
retention qualification and cleanup. Provider adapters translate actually received
reports; they need not invent a reset or require every caller to configure expiry.
Machine supplies injected clock/storage capabilities. Run Supervision retains
scheduling, retry and admission authority. History retains its result/reference
and publication invariants; expiring resource state does not grant deletion there.

Reads are read-only. They must not refresh the provider, dispatch analysis work,
renew claims, initialize schemas or perform eviction as a hidden query side effect.
A read must not present an expired report as retained applicable information.
Physical eviction belongs to an explicit Accounting maintenance/write path with
prompt, bounded cleanup, including on reopening after a long absence. Specify that
mechanism and exact expiry-boundary behavior in the implementation issue. Query
filtering alone is not proof that stored expired records stop accumulating.

Apply [ACC-007](../spec/operations.md#acc-007--acknowledgment-must-state-its-durability-guarantee):
only a durable acknowledgment promises restart survival. Persistence failure must
not issue that acknowledgment. Document report identity, duplicate/conflicting
redelivery and failure behavior before implementation; retain the existing additive
usage deduplication contract independently. No changed state record may rewrite
already recorded usage or invent request-attempt attribution.

Built-in adaptive quota/reserve management is outside this report slice. That does
not prohibit a pluggable rate-coordination adapter from consuming observations
under its own execution contract; report recording itself grants no such authority.
Client cache/persistence policy and preview notification semantics are separate
consumer/preview concerns. No dedicated notification transport is required here.

## Examples and required proof

These are expected outcomes, not tests already passed:

1. Record a provider report with a reset at 11:00; acknowledge durably. Restart at
   10:45: the report remains readable with its original time and reset qualification.
   After expiry, no report establishes a renewed balance, and maintenance removes
   the expired state without touching consumption or attempts.
2. Observe a report at 10:00 with no reset and no configuration. Its local retention
   ends at 11:00; label the one-hour basis as local. A documented optional fallback
   override changes that deadline. Reopening at 10:30 does not move it to 11:30;
   reopening three days later does not resurrect it or manufacture new capacity.
3. Record remaining 93 then 90 alongside deltas 2 then 3, including out-of-order
   arrivals. Read retained reports with their qualifications and observed consumption
   5. No latest-balance reducer or invented source order is needed to inspect them.
4. Report remaining zero in one pool and omit a report in another. Zero and missing
   stay distinct. Expire state while an attempt's usage is unknown; the usage gap
   remains unknown, and previously recorded usage remains durable.
5. Use rejecting execution/claim/write ports during reads, plus a controlled clock
   and instrumented maintenance path. Reads have no side effects; cleanup really
   removes expired state and preserves all durable usage/result/attempt evidence.

## Smallest implementation handoff

One bounded issue can deliver typed report intake, durable qualified-report reads
and retention/eviction under ACC-004/007/008 and A-14a–f. Start with fake providers,
controlled clocks, a separate-process restart control and tests that fail before
implementation. Preserve strict type/lint checks, release tiers, context boundaries
and durable intent comments. No live provider calls are needed.

Choose and document the record/query representation, observation-time interpretation,
expiry comparison, identity/redelivery behavior and cleanup trigger/cadence in that
issue before code. These are routine engineering choices within the settled
outcomes, not another blanket owner-approval gate. Raise a concrete conflict if a
choice changes an accepted behavior or public responsibility. Raw qualified reports
are sufficient: do not block this work on source ordering, current-balance synthesis,
a scheduling product or a complete provider adapter catalog.

The consumer may be a library caller before full CLI assembly. [Issue 151](https://github.com/mike-north/microdelta/issues/151)
is relevant only if its facade port is needed for the chosen integration; it does
not supply state semantics. [Issue 167](https://github.com/mike-north/microdelta/issues/167)
can consume this capability for its resource display, but its complete CLI checkpoint
and [issue 165](https://github.com/mike-north/microdelta/issues/165)'s preview work are
not prerequisites to the narrow report store/query slice. This decision does not
change the accepted bounded M5 additive evidence or claim the full M6/M7 delivered.
