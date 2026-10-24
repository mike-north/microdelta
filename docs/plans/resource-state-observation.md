# Proposed resource-state observation plan

**Standing:** proposal for owner review, not accepted. This plan does not amend
the normative [operations contract](../spec/operations.md), select an API or
storage format, or claim implementation evidence. Owner decisions remain open.

## Purpose and existing boundaries

“What did this work consume?” and “what balance did a provider report?” are
different questions. Consumption is additive evidence attributed to work. A
remaining balance is a point-in-time report about shared capacity and may
reflect other actors' work. It is not a delta, entitlement, admission permit,
or proof of capacity now.

[ACC-001–008](../spec/operations.md#resource-accounting) remain authoritative.
ACC-004 separates state from consumption and forbids invented balances across
pools/windows. ACC-005 says missing usage is unknown, not zero. ACC-008 says
accounting evidence grants no retry permission and schedules no work. The
[six-context ownership](../spec/architecture.md#arc-001--six-contexts-one-owner-per-invariant)
also remains intact; this plan adds no context or quota authority.

## Proposed concepts and relationships

### Separate consumption from state

Present the two side by side, never derive one from the other. For same-scope
provider balances 93 then 90 and usage deltas 2 then 3, show **5 observed units
consumed** and **90 last reported remaining**. Do not sum balances to 183,
subtract usage from 90 again, or infer total consumption from balance changes.

Usage completeness and state availability are independent:

| Usage reports | State report | Truthful view |
| --- | --- | --- |
| Complete | Ordered/comparable | Consumption complete; show selected reported balance. |
| Incomplete | Present | Show state and usage gap; state does not fill the gap. |
| Complete | Missing/incomparable | Consumption complete; state missing or incomparable. |
| Incomplete | Missing/incomparable | Show both uncertainties separately. |

An empty usage report is the reporter's explicit zero for that attempt. A state
report cannot acknowledge a missing usage report or make another attempt
complete.

### Identify the reported scope

Comparison depends on the **provider namespace** (which provider's semantics
apply), **pool** (provider/account capacity), **resource** (the constrained
quantity), **unit** (what its number measures), and **window** (the
provider-defined interval, if any). Only quantities whose provider namespace,
scope, unit, and applicable window are comparable can support a selected state
view. Adapters should supply stable identities with documented meaning. Do not
expose credentials or use a credential hash as pool identity: credentials
rotate, may share a pool, or may address multiple resources.

Keep three identities/evidence roles distinct: pool identity says which shared
capacity is described; observation replay identity lets Accounting recognize
redelivery of the same report; source-order evidence establishes whether one
report follows another. One value must not silently serve all three roles.
Replay identity must be stable for its deduplication purpose, while source order
must have documented provider meaning; neither is a credential-derived pool
identifier.

Known **no fixed window** differs from **unknown window**. No-window reports
compare only where adapter semantics support that comparison; unknown-window
reports are not a universal bucket or silently joined to a known window.
Missing state, unknown scope, and a reported numeric zero are likewise
different; only an actual report of zero establishes zero remaining.

Environment isolation applies. Two environments may describe the same physical
pool, but their facts do not merge automatically or imply that the provider
partitions that pool by environment.

### Order reports without guessing

Receipt time means when this system learned a report, not necessarily when the
provider observed state. Adapters may provide source ordering with documented
meaning. Arrival order, clock equality/skew, and a lower balance do not by
themselves establish which report is newer.

**Recommended direction:** call a balance “latest reported” only inside an
identified, comparable pool/resource/window when supported source ordering
distinguishes the observations. If identity, window, or ordering is missing or
incomparable, show that limitation and the available facts. An alternative is a
“last received” view, explicitly labeled as such, never as current provider
state. If source evidence orders 90 after 93, late arrival of 93 does not
replace 90. Conflicting reports with only the same apparent timestamp remain
conflicting/incomparable. Minimum balance is not a generic tie-break: balances
can rise and reports can cover different windows.

### Retain evidence and handle windows

**Recommended direction:** retain attributable, durably acknowledged state
observations as facts and derive the selected view. Same identity/content
redelivery is idempotent; same identity with changed content is a visible
conflict, not an overwrite. A distinct late report remains inspectable and
supersedes another only when source ordering supports it.

This is bounded inspectability, not unlimited history, arbitrary analytics, or
indefinite retention. Any retention duration, limit, or pruning rule needs an
owner decision. Query shape and evidence retention are separate choices.

Keep the last balance qualified by its window. When a known window elapses, do
not imply that a successor window exists or synthesize one. The old balance is
historical; applicable state after that window remains unknown until a new
report establishes it. Elapsed local time does not prove reset or replenishment.
Unknown reset time means unknown applicability, not permanent validity. A
reported reset time and provider-confirmed reset are different evidence. Neither
causes refresh, retry, admission, or scheduled work. An alternative is to hide
the old number from the primary view while retaining it for inspection; this
reduces accidental reliance but loses context for the unknown later state.

## Ownership and current seams

- **Resource Accounting** owns state evidence, attribution, and interpretation
  in queries; it keeps state distinct from additive `IUsageReport` quantities
  and usage-summary completeness.
- **Provider adapters** translate pool/resource/window/order/reset evidence;
  missing or unsupported evidence stays explicit.
- **Run Supervision** owns attempts, admission, retries, and deferrals. A state
  report supplies evidence, not permission.
- **CLI inspection** presents recorded evidence without fetching state. [CLI-001](../spec/operations.md#cli-001--read-only-inspection-is-an-explicit-delivery-checkpoint)
  forbids mutation, provider refresh, and starting work while inspecting.
- **History** owns result attempts/references/publication; **Materialization**
  owns selected stored data. Neither owns quota semantics.

`openDurableAccounting` initializes schema during open, so its read-only summary
query does not provide a read-only-open contract for CLI inspection. A separate
read-side boundary needs its own contract; no mechanism is selected here.
[#151](https://github.com/mike-north/microdelta/issues/151) concerns the
existing facade port only if a selected integration needs it; it does not
provide state semantics.

Issue [#167](https://github.com/mike-north/microdelta/issues/167) makes its
complete CLI checkpoint depend on #165 and #166. This plan does not accept those
targets or settle M6 placement. M6 names resource observations and inspection,
but #166 calls the exact placement an interpretation to confirm.

## Alternatives and owner questions

1. **No source order:** prefer explicit incomparability; alternatively expose
   “last received.” What claim serves the first consumer, and what order can an
   adapter substantiate?
2. **Retention:** prefer bounded inspection of acknowledged facts; alternatively
   retain selected state and minimum explanatory provenance. What finite
   retention promise is needed?
3. **Elapsed window:** prefer historical balance beside an unknown applicable
   balance afterward; alternatively hide the old number in the primary view.
   Which best prevents stale capacity from looking available?
4. **Intake:** accept only response-attached state, or also external reports?
   Either needs attribution without inventing a request attempt or usage intent.
5. **Milestone:** require bounded state inspection for M6, or state its absence
   and defer it? This remains a proposal, not a ratified M6 criterion.

These are domain/delivery questions, not proposed method names, fields, tables,
or serialized variants. Accepting one does not settle the others.

## Proposed acceptance scenarios after decisions

These are future test candidates, not tests run here or evidence that behavior
exists. Write behavioral tests first against the selected contract and adapters:

1. Deltas 2 and 3 plus ordered same-scope balances 93 then 90; after restart,
   show consumption 5 and selected balance 90.
2. Identical duplicate is idempotent; changed content for same identity is a
   conflict; late distinct older report does not supersede newer ordered state.
3. Reports without a supported tie-break are incomparable; minimum is not a
   generic ordering rule.
4. Vary pool/resource/environment/window separately. Keep known windows and
   environments distinct; distinguish no-window from unknown; never expose
   credentials or their hashes as pool identity.
5. Elapse a known window without a new report: old state is historical, the
   applicable balance afterward is unknown, with no successor window inferred
   and no refresh, retry, admission, or schedule.
6. State without usage leaves the usage gap unknown; complete usage without
   state leaves state missing. Inspect both after restart.
7. Inspection with failing write/dispatch/refresh hooks reads retained evidence
   without schema creation, mutation, execution, or retry.
8. If owner decisions select durable acknowledgment for state facts, terminate
   immediately after acknowledgment and recover the observation exactly once
   under its replay identity; persistence failure issues no durable
   acknowledgment. This candidate follows ACC-007 and selects no API or
   mechanism.

## Placement in the specification

This proposal is linked from the spec index for review. It does not extend
ACC-004, CLI-001, or the accepted M6 milestone. Owner acceptance and a later
contract edit are required before any recommendation or scenario is normative.
