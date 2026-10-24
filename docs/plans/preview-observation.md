# Preview observation: proposed decisions for issue 165

Status: **Proposal; no new behavior is accepted or implemented by this document.**
[Issue 165](https://github.com/mike-north/microdelta/issues/165) remains dependent
on owner decisions. This plan develops its consumer questions under
[RUN-006–008](../spec/operations.md#run-006--preview-access-does-not-authorize-recomputation),
[CLI-001](../spec/operations.md#cli-001--read-only-inspection-is-an-explicit-delivery-checkpoint)
and [CLI-004](../spec/operations.md#cli-004--inspection-supports-intervention-without-concealing-errors).
Those contracts govern; the alternatives below do not silently amend them.

## Consumer and meaning

An operator needs to answer three separate questions: what value can I inspect,
what does the recorded evidence establish about it, and what happened while
trying to improve it? A previous value, a current acceptance, and a failed
attempt are different facts. A preview presents them together without acquiring
permission to evaluate the analysis.

The following distinctions are already required, not new choices:

- Availability is separate from the author value. Empty data, zero and an
  undefined selected value cannot be absence sentinels.
- An available result may be stale or unverified. Recorded acceptance must name
  its evaluation scope; a reader cannot declare it current by invoking policy.
- A failed refresh preserves prior data with stale status and the error. With
  no prior result, absence and the error remain visible. Verified evaluation
  reports the failure instead of accepting a stale fallback.
- Observation does not dispatch, refresh, retry, acquire or renew claims, or
  publish acceptance. Disposing a display does not cancel execution.
- Throttling periodically delivers the latest state during sustained activity
  and delivers the final coalesced state after activity settles. Equal author
  data cannot suppress a selected status change.

The current alpha result-root decision in
[issue 156](https://github.com/mike-north/microdelta/issues/156#issuecomment-6360538071)
remains in force. A wrapped or selected undefined value tests the distinction
from absence; it does not establish support for publishing bare-root undefined.
The full-target result domain is a separate acceptance boundary.

## Proposed choices for owner review

### Failure visibility through coalescing

Suppose value A is followed by a failed refresh and then a successful equal-valued
result B, all before the next throttled delivery. B is current; marking it stale
would be false. Dropping every indication of the failure may also prevent the
operator from understanding the intervening problem.

**Recommendation:** deliver the latest state with a bounded indication that a
refresh failed since the observer's previous delivery. Clear that indication
after delivery independently of B's successful status. Delivery does not clear an
unresolved current refresh error; that error remains part of the current state.
This is not an unbounded
event log or a promise to replay every exception. Recorded attempt evidence
remains the authority for inspection; notifications need not contain author data
or raw error text.

**Alternative:** deliver current state only, allowing recovery to clear an
undelivered error, with earlier failures available through explicit history
inspection. This avoids delivery-relative state but the live display may never
show the failed refresh. RUN-007 leaves this retention choice open. The owner
must select the intended failure-visibility guarantee before implementation,
including the baseline indication for an observer attaching after recovery.

### Observation lifetime

The [M6 checkpoint](../milestones.md#m6--usable-cli-and-inspection-checkpoint)
already requires a separate inspection process without author callbacks.
Permanent run-only access cannot fulfill that target.

**Recommendation:** give read-side observation an explicitly owned lifetime
independent of an execution run. A run's display can use the same meanings; run
completion does not silently close an independently opened reader. Closing the
reader releases its own resources. Under this recommendation, previously delivered
lazy views are owned by that reader: later loads after closure fail clearly, while
already detached data remains ordinary caller-owned data. Retaining resources
for escaped lazy views is an alternative lifetime choice, not an implicit promise.
A new process opens a new reader and obtains
a truthful baseline from retained evidence; no durable notification replay or
cross-process subscription mechanism is selected here.

**Alternative:** keep live delivery attached to a run and separately open a
retained-state reader with the same preview meanings. This may reuse existing
run signals but needs explicit semantic parity and reattachment rules. Both
options must prevent a baseline/read-to-listen gap from silently losing a change.
Missing currency or attempt evidence remains unknown, not accepted success.

### Disposal and final delivery

**Recommendation:** disposal ends delivery immediately and discards an undelivered
coalesced state. No callback begins after disposal returns. This supports ordinary
consumer teardown without a surprise final callback. Normal quiescence while
still attached must deliver the final state under either choice.

**Alternative:** flush the pending state before closing. This preserves the last
update at explicit teardown, but closing can invoke consumer code and may need
an asynchronous completion boundary. The owner must choose rather than inheriting
an accidental timer behavior. Neither choice changes execution or retry policy.

### Members during incomplete discovery

A member not yet rediscovered is not an established removal.

**Recommendation:** retain its last contribution as explicitly stale, with
incomplete population coverage visible, until evidence establishes replacement
or removal. A newer available contribution replaces the old contribution by member
identity with its own explicit status, even when unverified or equal in data.
Acceptance is not a prerequisite for updating a preview. The display must not claim a
complete population while discovery remains open.

**Alternative:** omit not-yet-rediscovered contributions while visibly reporting
incomplete coverage. This avoids displaying old contributions but can make a
partial total temporarily shrink. Either choice preserves established removal
and forbids interpreting absence so far as proof of absence.

## Owners and implementation boundaries

History supplies recorded result, attempt and acceptance evidence. Materialization
loads selected values at exact references; it does not decide freshness. The
observation boundary composes those facts and owns delivery policy. Machine
supplies host timing capabilities, not throttle or retry policy. A display and
its disposal never become execution authority.

Envelope construction must not load unrelated member payloads or compare whole
result trees merely to detect framework-status changes. A delivered view backed by
a stored result must retain its exact reference so later selected reads cannot mix
publications. Provisional calculations and preview aggregates need not themselves
be completed History results; their input views retain that reference discipline.
Thin lifecycle events can signal a possible change; they do not by themselves
establish durable state or permission to include payloads in events.

[Issue 166](https://github.com/mike-north/microdelta/issues/166) separately owns
nonadditive resource-state identity, windows, ordering and expiry.
[Issue 167](https://github.com/mike-north/microdelta/issues/167) owns CLI commands,
public read-side composition, output and interrupt behavior; its complete
checkpoint depends on both 165 and 166. This proposal selects no method names,
terminal toolkit, storage schema, general aggregation engine or new host.

## Decision and proof boundary

No runtime test has been run for this proposal. Before implementation, record the
owner's selected alternatives and rationale in the owning contract, then derive
behavioral tests from those choices. Preserve the rejected alternatives and the
conditions that would justify revisiting them.

The acceptance matrix must include failed refresh with and without prior data;
equal-data recovery within one throttle interval; late attachment; run completion
and reader disposal; periodic and trailing delivery with a controlled clock;
status-only changes; open discovery with retained members; replacement and
established removal; and selected-field I/O. Rejecting dispatch, source and
mutation ports must remain untouched during observation. A separate process must
inspect recorded evidence without loading analysis callbacks. A passing wrapper
undefined control must not be reported as bare-root result-domain acceptance.
