# Issue 165: proposed observation protocol and implementation plan

**Status: proposed and unselected engineering plan.** This
document proposes concrete contracts and bounded implementation work under the
accepted semantics in [the preview-observation plan](preview-observation.md) and
[RUN-006, RUN-007, RUN-008 and CLI-004](../spec/operations.md#run-006--preview-access-does-not-authorize-recomputation).
It does not accept new owner decisions, change normative requirements, establish
runtime behavior, or declare issue 165 ready to close. The proposal is based on
the project baseline at `5353ff3112379d48edfa5f9cdcdb0bbc6a978fb2`, which
predates PR222 and does not contain its projection. Since then, the narrow
caller-fed alpha projection from issue 216 was merged to main by PR222 at
`e77c9ced52300b6debfcbce37ea392711c4d0b32`. It combines supplied evaluation
scope/outcome evidence with an optional exact result reference for a read-only
selected projection. This delivered slice does not provide durable evaluation
enumeration, cross-process observation, or the broader protocol proposed below.
The source originated at `b711adb6a912d332ecf4f2640c9ccb2208775545`; its merge is
implementation evidence for that narrow slice, not proof or adoption of the
capabilities below.

This plan separates owner-authored facts from their coordination and indexing,
and lays out a proposed sequence of bounded child work. The accepted
RUN-007/008 and A-16a–g outcomes remain the authority; its mechanism choices
remain proposals until the owner records acceptance.

## Consumer questions and scope

An operator needs to answer five related questions without causing execution:

1. For one analysis, environment, structural step/member and selected
   evaluation, what value is available, why is it current or stale, and did the
   refresh fail?
2. Did a failure precede recovery when values were equal and only one change
   signal arrived? What recorded interval can the read actually cover?
3. Can another process answer without loading analysis callbacks, initializing
   or mutating storage, acquiring a writer, or refreshing sources?
4. Can observation remain open after run completion or stop, and what exactly
   happens to a pending callback or retained lazy value when either lifetime
   closes?
5. During unfinished discovery, which prior members remain visible, which new
   values replace them, and what remains unknown about the population?

This proposal adds read-side evidence and a thin invalidation mechanism. It does
not add execution authority, source refresh, retries, claims, acceptance writes,
registered preview bodies, a progressive page-feed API, a generic event journal,
or a general incremental-query engine. The current Resolution path resolves one
collection snapshot and then keys it; it is not a progressive discovery feed.
CLI-001–004 and public composition remain issue 167's scope.

## Meaning and owner boundaries

The accepted meanings in RUN-007/008 remain unchanged: availability is distinct
from author data; stale means potentially stale until successfully verified not
stale; equal-data verification can clear stale; an incoming published snapshot
can be current for display without proving downstream acceptance or whole-graph
success; and a failed refresh keeps prior data stale with its current error, or
reports unavailable with that error. A thin signal says only that information
changed. Reads, not signal order, carry activity evidence.

The following responsibilities should stay with their existing owners:

| Owner | Owns in this proposal | Does not acquire |
| --- | --- | --- |
| Definition & Binding | Declared collection structure, structural correspondence, supported keying rules, canonical member-key validation, duplicate rejection, and validation of source completion shape | Runtime discovery closure, storage or preview freshness |
| Reuse Resolution | Current-policy collection resolution, the selected scoped keyed population and its validated evidence, successful verification and resolution outcomes | Durable row ownership, observation ordering or subscription lifecycle |
| Run Supervision | Run/evaluation orchestration, admission, cancellation, retries, progress and the operational discovery-closure/readiness invariant; it consumes Definition/Resolution population evidence and correlates run/request identity with its own records | Manufacturing population evidence, provider completeness, member removal, or Resolution outcomes |
| Result History & Publication | Durable commits, exact references, immutable result/acceptance/attempt evidence, shared commit order, bounded disposable activity index and read-only query ownership | Deciding freshness, closure, current source policy or semantic outcomes |
| Materialization | Exact selected value loading and explicitly owned value handles | Freshness policy, member identity or observation-session closure |
| Tracking & Observation | Capture/read semantics for selected fields and structural observations | Storage, source freshness, claims, retries or execution |
| Resource Accounting | Usage intents/reports and unknown-usage summaries | Preview status or scheduling authority |
| Machine | Injected read-only SQLite/snapshot, timer, clock and identity capabilities | Domain policy, storage schema or retry policy |
| Observation composition | Combine owner-authored read facts, freshness metadata, recent activity and thin change signals | Running author callbacks, deriving unowned facts or writing acceptance |

Definition validates the declared structure, keying rules and source completion
shape. Resolution resolves the collection under current policy, applies
Definition keying, and supplies the selected population evidence. Run
Supervision owns the operational discovery-closure/readiness/progress invariant
under ARC-001 and consumes that validated evidence; it must never infer provider
completeness or removal from absence-so-far, or manufacture a Resolution result.
The existing implementation seams are consistent with that division:
Resolution resolves and invokes collection keying
([resolution.ts](../../packages/resolution/src/resolution.ts)), Definition
validates and keys the snapshot ([collection.ts](../../packages/definition/src/collection.ts)),
and Supervision maps refused discovery into operational pending/cancelled
reporting ([supervision.ts](../../packages/supervision/src/supervision.ts)).
Implementation evidence does not supersede ARC-001; the new contract must
preserve the accepted ownership split.

## Proposed evidence model

### Owner facts and evaluation identity

Keep lossless native identities and population metadata in their owning durable
records. Add a versioned durable mapping for each selected evaluation, scoped by
analysis/environment and carrying structural step/member identity plus the
Supervision run ID and request key. The evaluation-start transaction assigns and
persists the stable ID, exact structural scope, and exact predecessor reference
available at that start; it must commit before the evaluation's work can be
admitted. Never reconstruct the predecessor later from a global current pointer.
Record the terminal owner outcome when known. Failure information is required
even when no History attempt was allocated. Supervision owns its start/terminal
operational facts; Resolution owns its semantic result and keyed-population
facts. History stores typed references and order; it must not interpret these
payloads.

For every publication, successful acceptance/reuse, or owner-authorized adoption
that can make a value selectable for evaluation E, the native owner supplies an
immutable scoped association from E and its structural identity to that exact
result reference. Any correspondence/adoption is validated by its semantic
owner before commit. History validates structural identity and exact-reference
integrity, then persists the association with the native fact; it does not
decide freshness or authorize reuse.

Do not serialize arbitrary thrown JavaScript values or executable state. Store a
bounded owner-defined diagnostic summary, an explicit truncation/completeness
marker, and references to native attempt/evidence records. Preserve the native
attempt evidence for failed/interrupted work. A successful publication,
successful verification/acceptance, and terminal evaluation success remain
distinct facts; none implies the others. If a reusable stored value has no
applicable freshness evidence, display it stale. Freshness must be supported by
owner-supplied published/reused evidence tied to the exact reference and
evaluation scope.

The starting fact is recorded before admission so a second process can see that
an evaluation began even if it later died. The start operation assigns a stable
opaque `evaluationId`, persists it with the owner metadata, and returns it to the
writer before work is admitted; callers can carry that ID into a fresh reader.
A fresh reader that lacks the ID discovers it with the read-only, exact-scope
`listEvaluations` query below. A failed start-record commit stops admission of
that observation-capable evaluation; otherwise a new refresh could happen
invisibly while old data appears current.

### Discovering evaluations from a fresh reader

Add a bounded, read-only `listEvaluations(scope, {limit, after?})` query over
the durable Supervision owner metadata, filtered by exact analysis and
environment and optionally by structural step/member identity. It returns
stable `evaluationId` values, each evaluation's immutable start revision and
exact scope, explicit coverage, a per-call `asOfRevision`, and a continuation
token when more matches remain. Evaluation identity and start facts remain
durable independently of the disposable 1,024-entry activity index, so
activity eviction cannot make a retained evaluation undiscoverable. Terminal
state is mutable owner evidence and is read separately through the exact
`readCurrent` query at that query's own `asOfRevision`; enumeration does not
promise a cross-page snapshot of terminal state. The owner metadata remains
unreclaimed under this proposal; the page bounds entry count, not stored history
or arbitrary identity bytes.

Order pages by recorded start revision descending; where one commit group
contains multiple starts, use stable `evaluationId` order as deterministic
tie-break presentation, not causal precedence. Require an explicit positive
page limit, enforce a proposed maximum of 100 evaluation entries per page, and
bind the opaque continuation token to store incarnation, exact filter scope, a
high-water start revision fixed by the first page, and the last
`(startRevision, evaluationId)` pair. Later pages apply that high-water filter
to immutable owner start records; new starts are excluded without holding a
SQLite snapshot or creating a server session. A token from another store/scope
or a malformed/unsupported token returns an explicit invalid-continuation
result and a fresh-first-page path; normal activity eviction does not expire it.
This is page continuation for owner metadata discovery, not an incremental
activity cursor or a durable preview session.

Multiple matches are returned as multiple candidates. Neither enumeration nor
an exact-current read chooses one by callback return order. A caller needing one
must supply its stable ID; an optional future “latest evaluation” convenience
selector would mean latest recorded start and must surface ambiguity within a
commit group rather than claiming a causal winner. If legacy owner facts lack a
stable evaluation identity or exact scope mapping, return them as
`identity-unavailable`/prior-coverage evidence; do not mint a guessed ID,
collapse them into a current evaluation, or treat their absence as proof that no
older evaluation exists.

### Shared commit order, not inferred causality

History assigns one never-reused observation revision to every committed
observation-relevant transition. Entries committed in one transaction share a
commit group. If a group has multiple presentation entries, their ordinal is a
deterministic display order only. Revision order is **recording/commit order**;
it is not provider time, finish order for independent operations, or proof of a
business happens-before relation. Timestamps may appear as diagnostic metadata
but never drive ordering or retention. Attempt IDs, publication IDs, acceptance
IDs and operation-journal sequence values remain their own existing domains;
the observation revision composes their newly indexed commits without
reinterpreting those identities.

Concurrent evaluations retain separate identities. A read requiring evaluation
truth names the selected evaluation; it must not silently promote the last
arriving callback. Reads report when a terminal fact is unavailable. Process
death, expired lease, or a later event does not let the reader invent failed,
cancelled, succeeded, closed, or removed.

### Atomicity and crash behavior

Publication, successful acceptance/reuse/adoption, and durable attempt-ending
facts append their typed activity references in the **same fenced History
transaction** as the native state transition. Any evaluation-to-reference
association required by `readCurrent(E)` is immutable native evidence in that
same transaction: the semantic owner supplies the validated scoped correlation,
and History persists it while validating structural identity and exact-reference
integrity. It is never a separate post-commit association write. An activity
entry cannot name a missing native fact or association. A later journal write is
insufficient because a crash between commits could lose observation of an
already committed transition. Evaluation-start metadata and its exact
predecessor reference commit together before work admission; terminal
Supervision outcome and Resolution keyed-population records retain their
separate typed owner ports under fenced writer authority. This coordination does
not transfer semantic ownership to History or Supervision.

| Boundary | Required read-side outcome |
| --- | --- |
| Native publication/acceptance/reuse/adoption, E-to-reference association, and its index commit | The native fact, owner-authored scoped association, and activity entry commit together or none do, under the existing transition's storage-failure policy. Never report a successful transition solely from an activity entry. |
| Start-record and predecessor capture before work admission | The stable evaluation ID, exact scope, and predecessor reference commit together before work. If recording fails, do not admit that evaluation; surface the storage failure. |
| Association insertion or integrity validation fails | Roll back the native publication/acceptance/reuse/adoption and activity entry under the existing storage-failure policy. Never leave a committed native value that exact-E reads conceal behind the old predecessor. |
| Failure/terminal-evidence recording fails | Preserve the original execution error and report persistence failure separately. Durable evaluation remains unresolved; do not synthesize a terminal status. |
| Source snapshot publishes before Definition keying and Resolution population recording | Snapshot remains available, but member population/closure is unknown. No member dispatch or closure is inferred from snapshot presence. |
| Native publication/acceptance commits before overall evaluation-return record | `readCurrent(E)` shows the exact associated snapshot/verification; it must not fall back to E's predecessor. Show unresolved evaluation completion separately; the reader must not fabricate a terminal run outcome. |
| Observation-index eviction | Only disposable activity is evicted. Current error, exact result, native attempts, acceptances, owner metadata and population facts remain governed by their own retention rules. |

Abandonment may fail while preserving an original author error. It is not
acceptable to make observation the mechanism that delivers the failure to
listeners or to depend on observer callbacks for durable recording; current
lifecycle observer failures can affect execution. Record facts at the native
owner transition and let subscribers request reads afterward.

### Current, recent and coverage reads

Propose three separate reads: `listEvaluations(scope, {limit, after?})`,
`readCurrent(addressedScope, evaluationId)`, and `readRecent(scope, limit?)`.
Enumeration discovers stable exact IDs without analysis callbacks; the initial
current-read contract requires one of those IDs (or the stable ID returned to
the writer) and never chooses an evaluation by callback return order. All reads
return their own `asOfRevision` and explicit coverage.

For a selected evaluation E, current metadata returns the exact result
reference from E's highest-revision native publication or owner-verified
reuse/adoption/correspondence fact. If E has no such associated reference, it
returns the exact predecessor reference recorded for E at its start, if one
exists. It never follows a global current pointer merely because another
evaluation published a later value. Errors are selected only from E; terminal
completion remains a separate fact. A failure in E marks E's selected reference
stale while retaining
it, or reports unavailable plus E's error if no reference exists. A later
successful equal-data verification by an owner can make that exact reference
current for E without a new publication. Another evaluation's failure does not
stale E, and another evaluation's publication cannot replace E's reference
unless a native owner explicitly records adoption/correspondence for E.

Recent activity returns compact owner references in observation commit order,
plus retained lower/upper revision boundaries, the start of recording support,
whether filters narrowed the scope, and whether the response was truncated.
The independent reads do not promise one common snapshot. If a consumer later
needs a combined baseline, compose it from one bounded read-snapshot transaction
rather than assuming unrelated calls were atomic together.

Do not add an incremental client cursor for the first contract. A bounded recent
baseline with stable record identities satisfies the recovery case while
keeping client cache synchronization outside MicroDelta. No durable server-side
preview session follows. If later evidence requires a cursor, bind it to store
incarnation, protocol version and filter scope; an evicted, foreign, future or
incompatible position must produce an explicit invalid/gap result and a
fresh-baseline path, never a silent empty success. Channel detach does not
delete client-owned state.

Legacy exact snapshots and known facts remain readable, but expose
`prior activity coverage unavailable` plus the recording-support boundary.
Never timestamp/order legacy rows retroactively. An older unknown error remains
unknown, not evidence that no error occurred. Migration, if authorized later,
runs on a writer path; inspection must not initialize or migrate storage.
Unsupported schemas return a typed capability limitation, not silent migration.

### Bounded retention and compact indexing

Propose a count-bounded disposable activity index of the latest **1,024**
entries per logical store, with a **100-entry** recent-query default and hard
maximum of 1,024. Propose at most **8 KiB** per diagnostic summary; oversized
diagnostics retain the failure fact, exact evidence reference and an explicit
truncation marker. Writers prune the disposable index only inside fenced
transactions; readers do not clean up. Keep last applicable current error and
evaluation metadata outside this rolling index so eviction cannot clear an
error, upgrade stale data, remove a result, or erase native evidence.

An index row contains fixed-shape kind/revision/commit-group identifiers and
compact references to owner-authored History, Resolution or Supervision facts.
Store run/request/structural identity once in owner metadata, then reference it
with compact store-local IDs. Do not duplicate descriptors, full member arrays,
or payloads into every index entry. A digest may accelerate identity lookup but
must not replace canonical equality or collision handling.

This bounds index row count and diagnostic-summary bytes only. It does **not**
bound the logical History store, owner metadata, query response bytes, SQLite
file size, transaction overhead or cleanup time. Impose no new identity-length,
definition-size or population-size limits and never reject previously supported
execution to fit an activity row. Variable-length identities and large keyed
populations remain lossless in their owner records and may grow under existing
semantics. Selected/bounded pages and explicit truncation/coverage handle large
reads; a silently accepted prefix must never look like a complete population.
Busy-scope eviction of another scope's records is a disclosed tradeoff of this
simple global count cap; per-scope quotas/time retention are future tuning, not
an implied one-hour promise.

The existing History operation journal is not a substitute: its list API
returns current revisions, and its immutable revision store is not a disposable
rolling activity index. Existing accepted M5 evidence and journal facts retain
their current meaning.

## Read-only process boundary and value lifetime

### Opening and snapshot ownership

Inspection in a fresh process must use a narrowly scoped Machine capability for
read-only SQLite access and consistent read snapshots. History owns schema
validation, query SQL and result decoding. Opening or reading must not create a
file, initialize a schema, run migrations, take a write transaction, perform
maintenance, acquire/renew/release a lease, or dispatch author/source work.
If the file is missing or the schema unsupported, return a typed read
limitation without creating it. Do not treat “the caller ignored writer
methods” as read-only support: current `openDurableHistory` initializes/validates
and returns a read/write alpha authority; Machine does not currently declare a
read-only opener or snapshot transaction. Read-only WAL behavior with an active
writer requires separate-process filesystem proof; immutable-file mode is not
a substitute.

One current query and one recent query each see a consistent snapshot and
return their own `asOfRevision`. Selected value reads use exact references from
the chosen current metadata; they cannot retarget a later publication. The
preview plan does not promise one snapshot across unrelated calls or a cursor.
Inspection open/read uses no analysis code and owns no execution authority.

### Independently releasable selected values

Observation closure and value-view closure should be separate explicit
lifetimes. Propose that current metadata reads return exact references; opening
a selected value creates a releasable exact-view handle with its own Tracking
and read-resource lifetime. Closing observation detaches signals and prevents
new metadata/recent queries, but does not revoke already-open value handles.
Closing a value handle releases backing resources and makes later lazy access
fail deterministically, including access through escaped child views. Explicitly
detached selected output remains ordinary immutable data. Backing read-only
connections may be shared/refcounted, but release must not depend on garbage
collection.

Today Materialization uses exact selected reads but lazy views depend on an
active Tracking frame; their creation and later access are tied to that capture
lifetime. This does not implement independently owned handles or settle behavior
after reader close. The proposed handle seam must be built and tested; do not
claim current support or silently choose “all escaped views fail when preview
closes” or indefinite resource retention.

## Thin signals, sampling and disposal

Signals are transport-neutral no-argument callbacks (or equivalent unit
messages). They carry no success/failure status, revision/cursor, member
identity, or changed-key list. Listener failure is caught and isolated so it
cannot affect execution or block other subscribers; this subscription boundary
is separate from existing lifecycle observers.

Proposed attach protocol: activate subscription first, then read the baseline.
A change during that read sets a local dirty bit; once baseline reading ends,
read again if dirty. Schedule an initial invalidation/baseline-needed signal so
empty local state cannot be mistaken for an empty store. Callback code schedules
reads rather than reentering writer commits. The activity index—not signal
count—preserves multiple changes between reads.

For other processes, propose sampling the History observation revision through
the injected Machine timer, with a configurable **250 ms** interval while
attached. Same-process commit hints may reduce latency but are only an
optimization. Stop sampling on detach; an attached observation may remain
active after the run ends. Liveness depends on host scheduling and successful
reads; it is not a real-time SLA. Sampling/read failures become queryable local
observation-health state. A unit signal may report that read-side state changed,
but the signal itself does not carry the error or mean “no change.” There is no
extra default throttle interval.

If an optional positive minimum signal interval is selected, use immediate
scheduled leading delivery, periodic dirty delivery while changes continue,
and trailing dirty delivery after activity settles. Keep at most one pending
timer and one dirty bit per subscription. Clear dirty before callback so a
reentrant change is not lost. A change just after leading delivery must cause a
trailing invalidation even if author data compares equal. Timer policy belongs
to Observation; Machine supplies timers only. Neither timer nor read renews a
claim, establishes readiness, or authorizes work.

Propose synchronous idempotent detach that cancels timers and discards pending
delivery; it does not flush. Once detached, the library starts no new callback.
A callback already running may finish; asynchronous work application code
starts is application-owned. Use synchronous callbacks, never await arbitrary
consumer promises, and make reentrant detach safe. Queued callbacks recheck the
subscription generation before starting. This is an explicit proposed choice;
the accepted plan leaves pending-callback disposal unresolved. Closing the
observation never cancels execution or clears consumer cursors/caches.

## Keyed populations and finite aggregate projection

The checked-in runtime has a keyed snapshot result with `open` or `complete`
status; it does not expose progressive page arrivals. Preserve that model. For
each Resolution-produced population, persist exact collection snapshot
reference, canonical member keys and key-to-record relationship, plus the
source completion status validated by Definition. Persist the Resolution-owned
keyed-population fact and its observation-index entry together **after**
Definition keying and before Supervision admits member dispatch. Supervision
then records or reports its own operational closure/readiness only from that
validated evidence. The population fact cannot be part of source publication's
transaction because publication precedes keying today. A crash between those
steps leaves the result snapshot available but population and closure unknown;
Supervision must not infer either. No old contribution is removed from that
absence. Persist sufficient key-to-record metadata for inspection to read the
selected population without invoking custom key callbacks again; a new run
still performs its own current discovery and keying under the existing rules.

Propose retained union until an established removal. Select an explicit
predecessor keyed-population reference in the same analysis/environment and
structural collection binding under Definition/Resolution correspondence.
Membership observed in an earlier accepted **open** keyed snapshot is real
positive membership evidence too; “open” limits completeness, not the truth of
the keys already present. Carry those keys forward even if a later run fails,
is cancelled, is rejected before keying, or is otherwise incomplete. Such a
run cannot replace the predecessor population or remove members. A fresh run
still rediscovers the collection root; this retained display does not assert
the fresh run's current population or completeness.

Overlay current observed member keys/results and keep predecessor members not
yet rediscovered with `membership: retained-unconfirmed`. Current observed
members carry `membership: observed-in-selected-discovery`. Membership basis
is separate from value freshness: finding the key does not clear stale. Only a
corresponding Resolution-established **closed** population that is explicitly
compared with the selected predecessor (or a future separately contracted
native removal fact) establishes removal. Rejected, open, cancelled or
incomplete discovery cannot remove by absence. Binding/version correspondence
must pass existing Definition/Resolution identity rules; do not heuristically
merge uncertain instances or compare unrelated runs. An unavailable member
with no prior value stays an explicit coverage entry and adds no invented zero.

A current contribution replaces the same structural member key exactly once;
do not deduplicate by value, label or array position. Keep distinct coverage for
observed membership, retained-unconfirmed membership, unavailable values, stale
values and settled operational outcomes. An open discovery cannot claim a
complete population even when displayed members all have values.

Limit aggregation to an explicitly selected finite set of fields/paths and
exact references. A caller or explicitly invoked ordinary non-memoized
calculation may fold detached selected contributions into a histogram. Generic
inspection must not load arbitrary author modules or execute registered preview
bodies. A small replacement map and finite fold is enough; no generic
incremental-query graph, inferred purity or stored aggregate publication is
proposed. If configured member/selection budget is exceeded, return explicit
truncation/incomplete coverage, never a “complete” aggregate over a silent
prefix. Choose membership and exact references from one metadata snapshot,
then selected reads; later publications cannot change references mid-fold.
Strict evaluation continues to reject stale fallback; provisional aggregates
never create acceptance.

## Alternatives and sacrifices

| Choice | Smaller/rival option and sacrifice | Proposed direction |
| --- | --- | --- |
| Recent evidence | Process-local observer ring: cheap but loses restart/late-process evidence and existing observers can affect execution | Durable owner facts plus atomic History activity index |
| Ordering | Separate unordered lists: honest but cannot express recorded failure then recovery across kinds | Shared commit revision; explicitly gives up business-causality claims |
| Retention | Unlimited journal replay: simpler retention story but makes an unselected growth/replay commitment and retains opaque history | 1,024-entry disposable index; current/native facts live independently |
| Query | Incremental cursor and cross-query snapshot: efficient continuation but adds cursor validity, gap and session contract | Bounded recent baseline, stable IDs, per-read revision and explicit coverage |
| Cross-process changes | Same-process hints only: simpler but remote process must manually refresh | Small read-only counter sampling via Machine timer, with optional local hints |
| Value lifetime | Reader close revokes every view: fewer resources but surprises consumers retaining a selected value | Explicit, separately releasable value handles |
| Unfinished membership | Show only rediscovered members: smaller display but drops old contributions before removal is established | Retained union with explicit membership uncertainty and incomplete coverage |
| Aggregation | General incremental query engine: more expressive, larger product and correctness scope | Finite selected-field projection with explicit provisional fold |

The 1,024/100/8 KiB/250 ms values, exact error shapes, handle representation,
sampling implementation and cleanup policy are engineering defaults proposed
for supervisor selection, not previously accepted product requirements.
Externally observable retained-member inclusion, retention window and escaped
view behavior must be recorded as proposed-to-selected choices; none is smuggled
in as an old acceptance. Revisit only with a demonstrated conflict or consumer
need (for example, a guaranteed time window or indefinite view survival).

## A-16a–g trace and proof plan

These are validation obligations derived from acceptance, not passing tests or
claims that source commits currently exist. Component tests first assert expected
failure before implementation; no tests are introduced by this documentation
change.

| Case | Proposed read or lifecycle assertion | Bounded proof |
| --- | --- | --- |
| A-16a — Value and failure | Zero, empty and selected undefined are available values; absence is separate. Failure keeps stale prior value plus current error, or unavailable plus error. Verified reads do not accept stale fallback. | Read-only exact selected-read tests, with and without a prior reference; wrapped/selected undefined remains within existing result-root boundary. |
| A-16b — Mixed freshness | Current A and stale B coexist. Equal-data successful verification clears B's stale status; key rediscovery alone does not. Display freshness does not fabricate source/downstream acceptance or graph success. Overlapping evaluations remain isolated: another evaluation's failure cannot stale the selected one or its publication replace that selection without explicit owner adoption. | Distinct owner evidence fixtures for publish/reuse/identity-only discovery and equal data; A/B overlap race (A starts from P, B publishes Q, A fails); verify equal-value reuse creates the exact E association atomically; reject foreign adoption; rejecting mutation/dispatch ports. |
| A-16c — Thin push and recent recovery | A→failure→equal-valued B remains queryable in commit order despite one coalesced unit signal; current read returns B and recent read retains failure then success under stated coverage. | Different processes, attachment after changes, bounded retention boundary and truncation/gap metadata; signals contain no business state. |
| A-16d — Independent observation and client state | Observation reads after run finish/stop; closing it never cancels execution. Channel detach leaves client state alone. Selected-value handle close is separate and deterministic. | Stop/completion, detach/reconnect, observation close with retained handle, handle close with escaped child view, no durable server session. |
| A-16e — Sustained and trailing signal | Controlled sustained changes yield periodic thin invalidations and a trailing invalidation after settling, including equal data with changed freshness metadata. | Controlled timers/barriers; sampling failure is visible health state, not a signal payload; no claim renewal or execution. |
| A-16f — Read-only exact projection | Separate inspection process has no analysis callbacks or write/claim/source/dispatch ports. It can enumerate stable IDs from exact scope and read an exact selected evaluation; concurrent evaluations never merge through a global pointer. Reads use exact references, selected fields and no synthetic acceptance/activity. | Missing-store open creates nothing; unsupported schema does not migrate; fresh-process enumeration after diagnostic eviction; ambiguous/multiple matches, page continuation and legacy identity-unavailable cases; association insertion failure rolls back native fact and index; after a successful native commit but before terminal evaluation return, exact E read exposes its associated value; equal reuse association and foreign adoption cases; concurrent writer snapshot checks; selected-load counters reject unrelated payload loads. |
| A-16g — Aggregate membership | Replacement at same key counts once; established removal disappears; unfinished discovery retains old members as unconfirmed and incomplete, including members seen in a prior accepted open snapshot. Failed/cancelled discovery cannot remove them; a fresh run's retained display is not its current-population proof. | Open/closed/empty populations, explicit predecessor correspondence, binding mismatch, failed/cancelled discovery, unavailable member, selection budget/truncation and no unrelated loads. |

Guarded read tests must prove the selected-evaluation race explicitly: A starts
from predecessor P, B publishes Q, then A fails. Reading A returns P marked
stale with A's error; reading B returns Q current without A's error. If A first
publishes R and then fails, A returns R stale with A's error. Equal-valued
successful owner verification can clear stale only for the exact associated
reference. B cannot replace A's selected value without an explicit native owner
adoption/correspondence fact. Enumeration discovers B as a separate evaluation;
there is no implicit global merge or callback-order selection.

Fault injection must reject the evaluation-to-reference association insert and
prove the native transition and activity-index row roll back together. A
successful native publication or reuse followed by process death before the
separate overall terminal-return fact must still let a fresh reader select the
newly associated exact value while reporting terminal completion as unknown.
Test a same-value reuse association and a foreign-evaluation adoption attempt.
Also cover every other native transition/index atomicity boundary, terminal
evidence write failure, and the publication-to-overall-evaluation completion
window. Source publication-to-keyed-population recording still has the distinct
expected crash result: snapshot present with population unknown. Controlled
clocks confirm commit order does not derive from wall time. Include supported
long keys and large populations to prove observation does not impose new
identity/population limits or duplicate them in index rows.

## Ordered child handoffs (proposed)

These bounded children are a proposed delivery sequence. A later child must not
be presented as ready before its dependency is accepted.

1. **Read-only History foundation and activity transaction seam.** Define the
   typed commit group/revision, bounded compact index, consistent `asOfRevision`
   reads, retention/truncation coverage, and a separate no-write/no-init
   inspection open. Add Machine read-only SQLite and snapshot capability. Prove
   native publication/acceptance/attempt-ending atomicity and process open under
   active writer. No owner event API, signal or new projection yet.
2. **Owner facts and population handoff.** Add Supervision's durable
   evaluation-start/terminal metadata and Resolution's durable keyed-population
   metadata through narrow typed ports. Preserve the split: Definition validates
   source completion shape; Resolution owns selected keyed-population/completion
   evidence; Supervision owns operational closure/readiness from that evidence.
   Test all crash boundaries, unsupported old evidence, pre-allocation failures
   and explicit unresolved outcomes. No progressive feed or inferred closure.
3. **Current/recent observation reads and freshness composition.** Implement
   explicit scope/evaluation reads, exact references, current error retention,
   recent coverage and legacy-history limitation. Exercise A-16a/b/c/f in a
   fresh inspection process. No subscriptions or aggregate.
4. **Observation subscription and independent value handles.** Add
   attach-before-baseline race behavior, revision sampling, optional coalescing,
   listener isolation, discard-on-detach, and separately releasable exact value
   handles. Prove A-16d/e with controlled timers and real separate processes.
5. **Bounded member projection and assembled acceptance.** Add retained-union
   display basis and selected finite aggregation on the previous owner facts.
   Prove A-16g and the complete A-16a–g scenario; adversarially review all
   owner/lifecycle boundaries. CLI and public composition remain separate.

## Current runtime gaps and readiness

At historical baseline `5353ff3112379d48edfa5f9cdcdb0bbc6a978fb2`, the
issue-216 projection was absent. Current main at PR222 merge
`e77c9ced52300b6debfcbce37ea392711c4d0b32` contains a narrow, stateless alpha
projection fed by caller-supplied evaluation scope/outcome and an optional exact
result reference. It supports read-only selected display for that supplied
context; it does not discover evaluations or establish durable associations.
The broader issue-165 requirements remain undelivered and proposed: no separate
read-only History opener/snapshot capability; no attempt/evaluation enumeration
or common observation commit index; no durable run/request/structural failure
scope mapping; no cross-process change feed; no durable rolling activity with
coverage/gap metadata; no independently owned observation reader; no explicit
value-handle lifetime beyond Tracking capture; no durable Resolution population
projection for read-side membership; and no retained-union finite aggregate
read. Existing journal revisions cannot stand in for the rolling index, and
existing observers cannot stand in for durable or cross-process notification.

The repository's operating constraints remain in force: no write caused by
inspection; no test without a first stated failing outcome; no runtime
implementation or full acceptance claim in this documentation change. Before
code starts, the supervisor should record which proposed selections are
accepted, split/refine the ordered work as needed, and assign isolated child
issues. Component gates do not close #165; closure requires the cross-cutting
scenarios above.
