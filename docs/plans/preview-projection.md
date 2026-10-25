# Read-only preview projection

Implementation design for #216 under RUN-006/007 and A-16a/b/f. This is the
bounded projection slice of the accepted preview plan, not subscription or
recent-activity delivery.

## Meaning and responsibility

The facade's observation composition combines already-produced evaluation
outcomes with Materialization's exact selected reads. It has no execution,
source-policy, claim, acceptance-write or publication capability. Materialization
continues to load immutable values and does not acquire freshness policy.

A preview request addresses one optional completed-result reference plus an
explicit evaluation scope: the existing Run Supervision context (run ID,
analysis and environment), request key, and Definition structural step descriptor.
All fields participate in scope correspondence; the request key distinguishes
successive evaluations of one step during the same run. Run IDs are only local
projection correspondence, never durable reuse authority.

## API and evidence mapping

The alpha `createPreviewProjection(materialization)` receives only
`materializeView` and returns a stateless `project<T extends object>(request)`
operation. It owns no reader lifetime. The request supplies `scope`, optional
`reference` and optional `evaluation`. No reference means unavailable; an explicit
bad/unreadable reference retains the reader's existing integrity failure, with
no retargeting or recomputation.

`evaluation` contains its addressed scope and one of:

- `kind: 'returned'`, carrying the existing `IResolutionOutcome` from
  `run.resolve(step, { requestKey })`;
- `kind: 'threw'`, carrying that request's caught error, including undefined.

These are supplied owner evidence, not `isCurrent` flags. A consumer saves the
run context, step and request key alongside the returned outcome or caught
failure. It later selects the same scope and exact result for projection. The
component does not call `run.resolve`, check-only source hooks or recovery to
make the evidence current. Existing History acceptance records are not parsed
as a private format or mistaken for a current run solely because they exist.

| Evidence | Display consequence |
| --- | --- |
| No evaluation, a different run/analysis/environment/request/step, or a different outcome step | Available result stays stale; no current error is invented |
| Matching returned `published`, exact reference matches | Available result is current from the owner's completed incoming snapshot |
| Matching returned `reused`, exact reference and acceptance reference/environment match | Available result is current from the owner's successful verification, including equal-data retention |
| Matching returned `refused` or `skipped` | No new verification; a supplied prior result stays stale, absent result stays unavailable; these outcomes are not a thrown refresh error |
| Matching thrown failure | Prior result stays stale with current error, or unavailable with error when no result exists |

The available envelope has `availability: 'available'`, `freshness: 'current' |
'stale'`, exact `reference`, `scope` and explicitly unwrapped lazy `value`.
The unavailable envelope has `availability: 'unavailable'` and no value/reference/
freshness. Both carry `refresh: { kind: 'none' } | { kind: 'failed', error: unknown }`
so a thrown undefined does not disappear. Availability never depends on author
truthiness. Present scalar fields (zero/undefined), empty records and array roots
retain existing Materialization semantics; no bare scalar-root publication is
added. There is no third fetched-but-unverified display status.

The projection snapshots structural scope/reference metadata and freezes its
framework envelope. It does not freeze or interpret an arbitrary error payload.
Stored values keep the injected reader/Tracking observer's existing exact-view
lifetime. Evidence is trusted from the named owners, not a security credential;
its projection grants no acceptance, readiness or dispatch authority.

## Required proof and boundaries

Jest and generated-alpha tsd tests precede behavior. Test all scope components,
exact-reference mismatch, success/refusal/skip/failure and missing evidence,
equal-data verification, selected undefined/zero/empty values and immutable
metadata. Instrument real Materialization selected reads to reject unrelated
payload loads; missing exact references fail without falling back to a head.
A real workspace/History fixture first produces published/reused/failed outcomes,
then uses the projection with read-only ports after author work is disabled.
Repeated observation must leave body/source-hook counts and durable rows unchanged.

No notification, cursor, recent-history query/retention, aggregate inclusion,
new reader lifetime, source verification or client persistence policy is added.
The broader feature and its unresolved query/lifetime designs remain in #165.
