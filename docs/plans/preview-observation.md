# Preview observation: accepted direction and remaining design

Status: accepted owner decisions from 2026-10-24 for
[issue 165](https://github.com/mike-north/microdelta/issues/165), with explicit
remaining choices. This is a contract/readiness revision, not delivered behavior
or a runtime implementation claim. [RUN-006–008](../spec/operations.md#run-006--preview-access-does-not-authorize-recomputation)
and [CLI-004](../spec/operations.md#cli-004--inspection-supports-intervention-without-concealing-errors)
own behavior; [A-16a–g](../spec/acceptance.md#preview-observation-cases) own required
outcomes. API spellings, storage schemas and transport are not selected here.

## Consumer and meaning

An operator needs to inspect available results and recent activity while deciding
whether to continue, and after execution finishes or stops. The preview can mix
current snapshots with values retained from a prior analysis. It must identify
which retained values are **stale**: potentially stale until successfully verified
not stale, not proven wrong or different. Successful verification can clear stale
without changing author data. Mere member-identity rediscovery is insufficient
where the governing reuse policy requires verification.

The owner treats incoming snapshots as current/newly fetched for this display;
no third “newly fetched but unverified” display category was accepted. Formal
source acceptance, downstream validation and complete-success coverage remain
separate: a current snapshot in a preview does not prove the whole graph accepted
or authorize evaluation. Absence also remains separate from the author value;
zero, empty data and a successful selected undefined are not absence sentinels.
The current alpha result-root boundary remains unchanged: wrapped/selected
undefined controls do not establish bare-root undefined publication support.

## Accepted decisions and supersession

| Question | Accepted direction and rationale | Boundary still open |
| --- | --- | --- |
| Failure followed by success before a notification | Push says only that information changed, with **no success/failure information**. Pull supplies latest information and recent activity, so signal order is not the order of business events | Query shape, ordering evidence, recent-activity retention and gap behavior; no lossless notification/event-log promise |
| Run completion or stop | Observation has an independently owned lifetime; execution ending does not close inspection of results/recent activity. Closing preview ends observation | Reader API, attachment/read race, lazy-view ownership and resources after reader closure |
| Mixed current and prior values | Current snapshots and stale retained values coexist with clear freshness indication; stale means potentially stale until verified | Public discriminants, evaluation-scope representation and member policy during incomplete discovery |
| Notification disconnect and cursor | Subscription/channel lifetime is distinct from client read position. A cursor is client-owned read state, not a durable server-managed preview session | Optional cursor/query representation, validity/gap rules and callback-disposal race; disconnect does not mandate erasing client state |
| Client caching/persistence | Outside MicroDelta responsibility; consumers may choose storage and own synchronization/model migration | No in-memory-only requirement, persistence prohibition, cache implementation or migration system follows |
| Transport | WebSocket was an illustrative notification channel | No WebSocket API, transport implementation or terminal/GUI toolkit selected |

The earlier proposal recommended an observer-delivery-relative “failure since
last delivery” indication. Thin change signals supersede that push-side design;
recent failure/success information belongs in read-side evidence. A latest-value-only
read would omit the accepted recent-activity need. Notifications may be coalesced
or debounced; their delivery neither establishes event order nor clears retained
error/activity evidence. No reliable replay of every signal is promised.

The earlier independently owned reader recommendation is accepted at the
user-facing lifetime level. Its proposed rule that lazy loads fail after reader
closure was **not** accepted; neither indefinite resource retention for escaped
views nor that failure rule is selected by implication.

The earlier disposal alternatives—discard pending delivery or flush before
closing—remain unresolved for concrete callback/timer behavior. Closing a channel
does not decide whether the consumer clears its cursor or cached values. The
initial discussion of keeping preview client state in memory only was explicitly
superseded: MicroDelta does not own the consumer's storage policy. The ephemeral
cursor direction rejects a library-owned durable client session; it is not a
ban on a consumer persisting its own compatible read state.

## Concrete examples and proof boundaries

1. A value A is followed by a refresh failure and a successful equal-valued B
   before a coalesced change signal. That signal contains no result/error status.
   Reading current information shows B, while querying the retained recent
   activity can reveal failure then success using read-side evidence. Neither
   signal order nor equal author data erases that distinction. Exact retention,
   ordering and completeness/gap semantics must be specified before implementation.
2. A preview displays current member A and retained stale member B. Later
   successful verification of B returns equal data: B can stop being stale without
   a value change. The reader performs no source refresh or acceptance write.
   Not-yet-rediscovered membership is not an established removal; default inclusion
   of old contributions during incomplete discovery remains a bounded choice.
3. Execution stops; the preview still reads available values and recent activity.
   Detaching the notification channel ends that subscription but does not cancel
   execution or command a client cursor reset. On reconnection the consumer can
   request a fresh baseline or use compatible retained read state under the
   eventual query contract; no durable server-side preview session is required.
   The server need not infer frontend restart from a transport disconnect.

These examples are intended outcomes, not passing runtime evidence. Consumers
remain responsible for their cache contents and reconnection/migration choices;
MicroDelta must provide honest read-side freshness and explicit query limits,
not reconcile consumer storage. Exact historical references keep their meaning.

## Owners and implementation boundaries

History supplies recorded result, attempt and acceptance evidence. Materialization
loads selected values at exact references and does not decide freshness. The
observation boundary composes those facts into read-side information and thin
change signals. Machine supplies host timing capabilities, not throttle or retry
policy. A display and its disposal never become execution authority.

Observation must not dispatch, refresh, retry, acquire/renew claims or publish
acceptance. Constructing preview information must not load unrelated large payloads
or compare entire result trees merely to notice framework-status changes. Stored
value views retain exact references so selected reads cannot mix publications.
Provisional displays and aggregates need not themselves be completed History
results, and their usability is not complete-success evidence.

[Issue 166](https://github.com/mike-north/microdelta/issues/166) separately owns
resource-state reporting/retention; its newer owner decisions are not selected or
rejected here. [Issue 167](https://github.com/mike-north/microdelta/issues/167) owns
CLI commands, public composition, formats and interrupts. Its complete checkpoint
consumes these observation semantics and resource reporting; documenting this
plan does not make the full CLI ready wholesale.

## Remaining design and implementation readiness

The companion [proposed observation protocol](preview-observation-protocol.md)
offers an engineering decomposition and concrete defaults for review. It has
been revised to address four findings from its first adversarial review; the
same independent reviewer's re-review is pending. Its activity index,
evaluation enumeration and overlap semantics, read-only opener, sampling,
disposal, value-handle, and retained-member choices remain proposals only; this
accepted plan's status and owner decisions remain unchanged until those choices
are explicitly selected.

| Slice | Accepted outcomes and test-first basis | Readiness recommendation |
| --- | --- | --- |
| Read-side availability/freshness and current error | A-16a/b/f: absent vs successful values; current/stale provenance; equal-data verification; failed refresh retains stale prior value/error; read-only exact selected reads | The protocol proposes exact evaluation IDs, stable scope discovery, per-evaluation error/reference isolation, and predecessor fallback. Owner selection and discriminant/type design remain before behavioral/type tests; do not add a third fetched-unverified display category |
| Current information plus recent activity | A-16c/f: failure then success remains inspectable through retained read evidence, independent of signal order; read-only inspection | The proposed protocol now specifies stable exact-scope evaluation discovery, exact-ID current selection, per-evaluation reference/error isolation, bounded page continuation and activity coverage. These remain proposed pending same-reviewer re-review and owner selection; no activity cursor is selected |
| Thin live change signals and independent observation | A-16c/d/e: no success/failure payload, coalescing liveness, reading after execution ends, detach does not own cursor/cache/cancellation | Ready for bounded lifetime/delivery design. Select attachment/read race handling, throttle interval/defaults and pending callback disposal behavior, and separately settle lazy-view ownership; no transport selection required by this record |
| Aggregate member projection | A-16g: replacement counts once, established removal disappears, selected fields avoid unrelated loads, incomplete coverage stays explicit | Existing invariant owners remain. Decide retained-member inclusion during unfinished discovery and aggregate implementation scope before pickup; a general incremental-query engine is not selected |
| Consumer persistence, WebSocket transport and full GUI | Client-owned storage and a transport-neutral library contract | Not requirements of this issue; do not claim that acceptance mandates implementation or prohibits a consumer choosing these |

The supervisor should split or refine readiness only for these contained slices;
issue 165 as a whole still has unresolved author-visible and lifecycle choices.
No runtime claim/label, paid-provider request, issue mutation or publication is
part of this local documentation revision. When implementing, use rejecting
execution/mutation ports, controlled clocks and read-load counters, observe the
expected test failures first, then run package/type/lint checks and independent
review. Documentation link/consistency checks establish only this record's
internal coherence.
