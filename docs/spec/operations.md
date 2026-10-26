# Run supervision, CLI, and resource accounting

**Status:** normative behavioral contract, consolidated 2026-09-26; acquisition
retry and shared-rate target revised by owner decisions on 2026-10-24. This document
specifies required outcomes, not implemented capabilities. Mechanisms explicitly
marked **Open** are not selected by implication. Requirement identifiers are
stable; wording and validation fixtures can improve without renumbering them.

Long-running analyses must remain understandable while their data is incomplete,
their providers are waiting, and some members have failed. Operators must be able
to inspect progress, try a deliberately small workload, and stop unwanted work
without confusing observation with permission to spend or partial work with a
completed result.

## Scope and ownership

[Architecture](architecture.md) defines the six bounded contexts. This document
governs **Run Supervision**, **Resource Accounting**, and the CLI's observation
boundary. It consumes the public contracts of Definition & Binding, Reuse
Resolution, Tracking & Observation, and Result History & Publication. It does
not create a seventh execution authority.

Run Supervision owns run lifetime, environment, population/discovery completion,
admission, retry/cancellation coordination, and progress. Reuse Resolution decides
current acceptance. Result History & Publication remains the single owner of
claims and publication consistency. Resource Accounting owns reported quantities
and their attribution, independent of whether a completed result is published.
Provider adapters translate provider-specific evidence and operations; the CLI
presents evidence and conveys explicit operator requests.

[Execution](execution.md) governs exact result references, attempts, acceptance,
source policy, and publication. [Acceptance](acceptance.md) supplies cross-context
scenarios. [Experiments](experiments.md) separates bounded design investigations
from implementation claims. An unresolved mechanism below is work for the
owning context; it does not reopen settled product requirements.

In this document, an **evaluation** seeks an accepted result for a particular
scope and current applicable inputs. A **run** supervises participating work.
A **member** is an occurrence in a collection; it is not synonymous with a network
request or a completed memoized result. An **attempt** can consume resources and
fail without producing a completed result. These distinctions do not prescribe
public class names or a new serialized enum.

## Run context and execution boundaries

### RUN-001 — Scoped context and lifetime

The primary authoring path MUST provide scoped analysis-context access without
requiring an extra context argument through ordinary step/helper calls. Nested
asynchronous executions MUST inherit the selected environment while retaining
their own execution attribution. Concurrent runs MUST remain isolated. Deliberate
sharing of applicable rate limits under RUN-019 coordinates admission
without merging run attribution, retry tallies or environment storage.

Environment selection MUST remain stable for the invocation. Volatile metadata
such as a run identifier or cancellation signal MUST NOT invalidate results
merely because a new context object exists. Output-affecting configuration MUST
participate in the applicable tracking/compatibility contract. Scoped access
alone is not a recorded data dependency.

An execution's lifetime includes its actual lazy asynchronous work, not just
creation of an iterator. Closed execution scopes MUST NOT accept newly attributed
work through escaped callbacks or retained context operations. Errors and cleanup
MUST preserve the parent and sibling scopes. An in-memory scope is not, by itself,
a durable recovery mechanism.

**Validation:** interleave two runs across awaits; resume a generator across
yields; terminate it by return and by error; verify environment and attribution
through cleanup. After closure, reject attempts to record new work against the
closed execution. A new run identifier alone leaves eligible results reusable.

**Open:** exact context API and extension types; reconstruction protocol across
processes. Recovery must recover the intended environment or fail clearly,
rather than silently choose the currently active environment.

### RUN-002 — Declared work and bounded active execution

Supervision MUST operate on the declared step graph and its runtime result
instances. Discovering another member or retrying a request does not introduce
a new abstract step or edge. Readiness, source validation, and runtime gates
operate within that declared structure under the execution contract.

Fan-out MUST support a bounded active window. Request permits MUST guard the
actual constrained requests, not entire member subtrees. Waiting for another
owner's result or for a scheduled retry MUST NOT consume a request permit. Nested
fan-out MUST avoid a permit arrangement in which parents hold all capacity while
waiting for children that require it. Work must not assume that one member's
subtree finishes before another starts.

**Validation:** a large synthetic population keeps active work within the chosen
bound; a nested group completes with a small permit pool; a converging waiter
holds no request permit. Growing discovered cardinality does not mutate the
declared graph.

**Open:** pool implementation, process/thread distribution, defaults, and measured
locality policy. These requirements do not select a general scheduler, queue
service, or worker deployment.

**Owner decision (2026-09-30).** One fenced writer per store. Members run
concurrently inside one process under a bounded permit pool, and a permit guards
only real execution. Another process that needs to write waits for the writer
lease, taking over an expired lease only through fencing, until an
operator-supplied deadline. There is no default deadline. At the deadline it
fails with a typed writer-busy outcome that names the current holder. Read-only
check and inspection never need the lease. Multi-process write parallelism is
deferred until measurement justifies it (M7).

**M5 selection ([#120](https://github.com/mike-north/microdelta/issues/120)).** The
run-wide active window serves only fan-out started by the run's own operations. A
run operation that author code starts from inside member or step work, through a
run it kept, is an undeclared call. It is refused under [CMP-9](composition.md)
before any of its work is admitted, so a nested fan-out never waits for a lane its
caller holds.

## Readiness, discovery, and previews

### RUN-003 — Readiness is scoped to the consuming calculation

A calculation requiring complete inputs MUST wait for its own required discovery
to close and its required evidence to be accepted for the intended evaluation.
It MUST NOT wait for unrelated work elsewhere in the run. The application may
compose person, team, and organization scopes; the framework MUST NOT hardcode
that hierarchy or impose an organization-wide barrier.

Eligibility for normal evaluation is not a requirement to execute a body. Once
inputs are ready, ordinary reuse resolution may retain an eligible prior result.
Readiness does not require fetching every field again or eagerly loading the
entire corpus into memory.

**Example and validation:** hold person B's pagination open while person A's
required evidence completes. A's analysis becomes eligible. A team calculation
requiring both remains waiting. For A, unchanged accepted inputs serve the prior
analysis without executing its body.

### RUN-004 — Discovery closure is evidence, not an elapsed-time heuristic

A complete collection MUST distinguish closed discovery from unfinished discovery.
A quiet interval, an empty page with a continuation, all currently discovered
promises resolving, or available historical rows MUST NOT establish closure.
A source failure or author-imposed limit MUST NOT masquerade as successful
exhaustion of a broader source query.

Intermediate arrivals while building a required corpus fulfill that pending
dependency. They MUST NOT each authorize another paid analysis of the purportedly
complete corpus. Previously retained corpus data may be previewed, but its
existence does not prove completion or current acceptance for this evaluation.
A successfully closed empty collection is distinct from an unavailable or
unfinished collection.

**Validation:** resolve all members of page one while holding a later page; the
strict corpus consumer remains unstarted. An empty final page can close a source
only under its actual continuation contract. A closed zero-member population is
recognized as complete without being confused with missing data.

**Open:** source-specific consistency and closure evidence; how genuinely newer
inputs affect an already-running calculation. Neither a fixed historical period
nor a local enumeration identifier proves a remote snapshot is stable.

### RUN-005 — Member readiness and collection readiness are independent

A member calculation MUST be permitted when that member's required evidence is
ready, even if discovery of other members remains open. A collection fold requiring
the full set MUST wait for the corresponding closure and member outcomes.

For the roster workload, discovery is a separate non-memoized paginated step.
Completed per-PR retrieval and assessment results can remain reusable across
rediscovery. Cached pages MUST NOT be assumed valid solely from unchanged cursor
text or query parameters. Any future page reuse requires a source-specific
validity contract; arbitrary JavaScript continuation recovery is not implied.

**Validation:** PR A's complete evidence starts its assessment while page two is
pending. The person's strict summary remains waiting. Page two then fails; the
next authorized evaluation rediscovering the population can reuse A's eligible
completed result. Moving records between pages neither proves completeness nor
forces unaffected per-PR computations to execute again.

### RUN-006 — Preview access does not authorize recomputation

Observation MUST be separate from verified evaluation. Reading a preview MUST
NOT dispatch a memoized body, initiate source refresh, or schedule retries merely
to make the display current. A supported provisional calculation may consume
available previews, but it MUST NOT recursively authorize memoized work.

The working authoring convention is that ordinary non-memoized calculations may
recompute provisional displays, while memoized calculations expose prior previews
and wait for their ready inputs through normal evaluation. This convention is
not a measurement of cost or a guarantee that arbitrary user code is pure.
Missing-input handling MUST be explicit. A provisional result MUST NOT satisfy a
verified read solely because it contains a usable-looking value.

**Validation:** repeatedly inspect or refresh a histogram while source data is
pending. Memoized source and analysis invocation counts remain unchanged. A
provisional sum can update from explicitly available inputs without admitting
upstream paid calls. Absent values do not silently become zero.

**Open:** override syntax and supported provisional-calculation API. Read-only
inspection in CLI-001 does not run arbitrary user-defined preview bodies.

### RUN-007 — Preview reads preserve availability, freshness, and recent activity

Previews MUST expose the latest available value through a library envelope that
keeps framework status separate from author data and requires explicit unwrapping.
Unavailable data is distinct from an available value and its freshness. Legitimate
empty values, zero, or a successful selected `undefined` MUST NOT stand in for
unavailable data or failure; this does not expand the accepted result-root domain.

**Accepted owner clarification (2026-10-24).** An in-progress preview may mix
current incoming snapshots and retained **stale** values. Stale means potentially
stale until successfully verified not stale, not proven incorrect or changed.
Successful verification may clear stale with equal author data; merely finding
a member identity does not replace required freshness verification. Incoming
snapshots are current/newly fetched for this display; no third fetched-but-unverified
display category is required. Formal source acceptance, downstream eligibility
and complete-success coverage remain their owners' separate facts: preview
freshness neither fabricates their evidence nor initiates evaluation.

If a refresh fails, a previous value MUST remain available with stale status and
the refresh error. If no value exists, expose unavailability and the error. A
verified read MUST report the failure instead of silently returning stale preview
as success. A failed attempt does not become a completed result envelope.

The read side MUST also support inspection of what happened recently, including
failure followed by success, separately from the latest value/status. Error and
success information belongs in reads, not notification payloads. Signal order or
coalescing MUST NOT determine the order of recent activity; reads use recorded
evidence. Equal-data recovery does not erase the distinction between an earlier
failure and subsequent success within the supported retention window. No
unbounded history, lossless event replay or specific snapshot/cursor API is
selected; retention, evidence ordering and gap behavior must be specified before
claiming this read capability complete.

**Validation:** [A-16a–c/f](acceptance.md#preview-observation-cases) exercise failure
with/without prior data, equal-data freshness changes and recovery before a
coalesced signal. Current snapshot display never substitutes for verified graph
acceptance. Repeated reads leave execution and mutation ports untouched.

**Open:** discriminants, selected evaluation scope, current error representation,
recent-activity query/ordering/retention and missing-range behavior. The accepted
purpose does not select exact record fields or an unlimited error log.

### RUN-008 — Thin change signals and independent observation remain bounded

**Accepted owner decisions (2026-10-24).** Push notifications MUST contain only a
change signal and **no success/failure information**. They indicate that read-side
information changed; the consumer obtains current information and recent activity
through RUN-007. They are not an ordered result/error history. Notification
coalescing or delivery does not clear read-side evidence or grant execution rights.

Observation MUST be able to remain open after an analysis finishes or stops, so
results and recent activity remain inspectable. Closing preview ends observation;
it does not implicitly cancel execution. Notification attachment/detachment is
separate from client read state. A last-seen cursor, if used by the selected read
protocol, is client-owned ephemeral read position, not a durable server-managed
preview session. Disconnect does not require erasing it, and the server need not
infer frontend restart from a channel closing.

Client caching and persistence are outside MicroDelta's responsibilities.
Consumers may choose to retain or persist compatible read state and own its
synchronization/model migration. There is no required in-memory-only client or
prohibition on consumer persistence; no cache implementation is selected here.
WebSocket is an illustrative channel, not a mandated transport or API.

Optional throttling/coalescing MUST remain live under sustained changes: while
attached, periodic change signals must permit reads without waiting for quiet,
and a final coalesced change signal follows activity settling. This re-expresses
the former latest-state delivery obligation through thin push and explicit pull;
it does not put business state in the signal. Read-side freshness/status changes
remain visible even with equal author data. No reliable replay of every signal
is promised. Timer waits and reads MUST NOT renew claims, establish readiness or
authorize expensive work. Exact pending-delivery behavior at disposal is open;
normal trailing delivery does not mandate flushing a closing subscription or
clearing client state.

Updating an existing member's contribution MUST replace its prior contribution
in a preview aggregate rather than count two result snapshots as two members.
Settled aggregates MUST reflect established removals. Missing rediscovery alone
is not established removal. Observation of selected fields MUST NOT require
materializing every member's unrelated large payload. Stored views retain exact
references; the ownership of lazy views after reader closure remains to specify.

**Validation:** [A-16c–g](acceptance.md#preview-observation-cases) use controlled
clocks, failure/success reads, run completion/stop and channel detach. Assert no
success/failure notification payload; observe periodic/trailing signals and pull
latest/recent information. Refresh one member into another aggregate bucket and
count it once, without unrelated payload loading or execution.

**Open:** read/listen attachment race, throttle defaults and leading/trailing
details, in-flight/pending callback disposal, lazy-view ownership after closure,
retained-member inclusion during unfinished discovery and aggregate optimization.
These choices do not reopen independent observation lifetime or assign consumer
cursor/cache lifecycle to the server. No general query/aggregation engine is
selected. See the [decision and readiness plan](../plans/preview-observation.md).

## Failure, retry, and cancellation

### RUN-009 — Independent siblings continue after isolated failure

An isolated member failure MUST NOT, by default, abort independent siblings,
erase their completed results, or force wholesale paid re-execution. Failed
members, their errors, and their downstream impact MUST remain observable.
Consumers requiring a failed member's accepted result MUST remain blocked or
report failure explicitly. Failure is an expected operating condition at scale.

This continuation rule MUST NOT be interpreted as permission to keep publishing
when shared storage correctness or ownership cannot be established. A group
failure does not roll back independently committed member results or external
resource consumption.

**Validation:** fail one PR assessment while independent assessments complete;
their results remain reusable. The failed member's strict consumer does not
silently omit it. A storage-ownership failure is distinguishable from an isolated
provider failure and cannot fabricate successful publication. Operator rejection
of further required retries is a distinct whole-analysis stop under RUN-014;
independent-sibling continuation does not override that explicit stop.

### RUN-010 — Strict and outcome folds have different contracts

A strict complete-success fold MUST require closed discovery and accepted results
for every required member. Failure, refusal, cancellation, or unfinished work
MUST NOT silently disappear from its required population.

Authors MUST also be able to fold all settled outcomes, including failure
statistics, or explicitly select successful results. That selection MUST remain
distinguishable from complete success of the original population. Coverage,
membership, and consumed outcome status MUST participate in verification so that
repairing a failed member can update affected aggregates. Unchanged independent
member results remain reusable.

A pending retry is not a terminal failure. An outcome fold MUST NOT claim its
set is complete while required discovery or relevant attempts remain unsettled.
Semantic completeness does not require a separate durable dependency row for
each member; representation follows the tracking contract.

**Validation:** one failed member prevents a strict fold; an explicitly tolerant
fold reports the failure. Repair it, then verify the tolerant/success-only fold
reconsiders its input and unaffected member bodies stay unexecuted.

**Open:** operator repair within an active run. Do not conflate skipped,
pending, cancelled, failed, and successful-empty outcomes.
[EXP-4](../../experiments/exp-4/decision.md) selects the strict fold's treatment
of a gated-out member ([CMP-8](composition.md)): the gate declares the required
population, and a skipped member is an explicit data-free entry outside it. The
M5 selection below settles the outcome-fold API and its treatment of skips.

**Owner decision (2026-09-30).** Outcome (tolerant) folds are in M5 scope. They
receive every member's settled status with coverage. They never claim completeness
while discovery or required attempts are unsettled, and repairing a failed member
makes them reconsider their input.

**M5 selection ([#120](https://github.com/mike-north/microdelta/issues/120)).**
- **Declaration.** An outcome fold is its own composition-level step kind, never
  a child, member step or template step. It names the consumed template step as a
  strict fold does.
- **Settled statuses.** Each member settles in the pass as succeeded (an accepted
  result), skipped (its gate), failed (a member-attributable typed failure) or
  cancelled (work withdrawn from this run: refused by admission as cancelled, or
  interrupted by a stop). Denied work leaves a member pending, which is
  unsettled. An operation whose outcome is unknown (RUN-012) is unsettled too;
  [#119](https://github.com/mike-north/microdelta/issues/119) introduces that
  status.
- **Completeness.** While discovery is open or a member is unsettled, the fold
  waits with partial coverage. It runs no body, admits no fold work and publishes
  nothing. A rejected or cancelled discovery fails it, because no population can
  be established in that pass.
- **Entries.** Once every member of a closed population has settled, the body
  receives one entry per member with its status. Only a succeeded entry carries
  data. A gated-out member is an explicit skipped entry, which settles the open
  question about tolerant treatment of skips.
- **Verification.** The fold's evidence is its membership-and-status fact plus
  the member facts its body read. Repairing a failed member changes that fact, so
  the fold reconsiders, while unaffected member results are reused.
- **Coverage.** Framework coverage names every member under exactly one status,
  whether discovery is open, and whether the set is complete. It is never a claim
  of complete success. A cancelled member is settled-not-successful for that run
  only; a later run attempts it again.
- **Separation.** Strict and outcome folds record distinct provenance versions and
  step kinds, so neither contract ever accepts the other's result.

### RUN-011 — Finite acquisition retries belong to each run

The system MUST support finite retries for recoverable acquisition failures,
including lost responses and rate/transient delays lasting hours. It MUST supply
reasonable built-in retry defaults so every remote source need not declare a
custom policy. A matching reusable remote data-source callback takes precedence;
when none matches, built-in defaults apply. Matching/selection is separate from
the callback's decision; no fourth "no opinion" result is selected.

The callback returns one decision object with exactly one of three meanings:
retry immediately, retry after an explicit delay duration, or stop retrying. It
receives prior-attempt information sufficient for backoff (for example, a prior
delay multiplied by a factor). This classification and timing decision MUST NOT
mint allowance, override stop intent or bypass admission. The API spelling,
history view and matching representation remain open. Historical attempts remain
available as evidence; their existence alone MUST NOT carry an exhausted tally
into a new run. Exact prior-delay/history exposure is an implementation decision
to document, not permission to expose secrets in events.

**Allowance.** Retry tallies are scoped to **one analysis run**, not the lifetime
of the analysis or a persisted operation. Every new run starts fresh configured
finite allowance. Continuing the same run, starting another deferral pass,
waiting/reacquiring a lease, or reconstructing that run's bookkeeping MUST NOT
replenish it. Process restart alone does not identify a new run: an explicit new
run starts new allowance, while continuation preserves the existing run's tally.
Read-only recovery of a named execution is neither and authorizes no send.
Historical attempts, observed costs, unknown usage and eligible completed results
persist independently. The default is **three total request attempts per logical
operation per analysis run**: the initial attempt and up to two retries when
classification permits them. An explicit policy may override that allowance but
MUST remain finite and state what it counts. No pooled-budget allocation is
selected. Waiting for rate eligibility consumes no sent-attempt allowance; every
actual request attempt counts under the applicable policy.

**Default backoff.** Built-in retryable-failure handling MUST provide a sensible
initial delay that can ride out brief contention and increasing later delays,
rather than requiring every source to configure timing. This does not make every
409 retryable or override provider/context classification. Matching custom policy
still wins, and a known provider not-before time remains a lower bound even when
an immediate or shorter retry is requested. Exact durations, growth and jitter
are bounded implementation choices to document and test; no numeric timing
schedule is selected here.

**Exhaustion and classification.** No further request may be sent after current
allowance is exhausted. A failed or exhausted request attempt remains diagnostic
evidence; it does not provide the missing required input or complete an analysis.
Where further authorization is being considered, dependent work remains pending
without a fabricated value. A permanent failure can settle an attempt/member as
failed under RUN-010; that still cannot satisfy complete-success coverage.
The operator may choose to authorize further work; the exact within-run
authorization mechanism, including batching/frontier or grant allocation, remains
an unselected proposal in the
[decision record](../plans/data-acquisition-retries.md#evaluation-of-the-approval-proposal).
This does not postpone new-run replenishment. Rejecting further retries for
required input invokes whole-analysis graceful stop under RUN-014, rather than
omitting that input or leaving the rejected analysis running indefinitely.

HTTP status alone need not establish source meaning. Unchanged authentication or
authorization failures (often 401/403) MUST NOT automatically retry. A service may
use 403 for rate limiting, so the adapter must distinguish that rate signal from
an authentication/authorization failure using provider context; status alone is
not the classification. A bad request (400) is not expected to succeed unchanged.
Conflict, rate and server errors (for
example 409/429/500) may justify bounded delay according to adapter context;
404 can mean permanent absence or eventual availability. No universal retry rule
for these ambiguous statuses is selected. HTTP method does not define acquisition.
The callback's "stop retrying" is a classification decision, not itself an
operator's rejection or a new whole-run cancellation policy.

**Timing and passes.** Preserve durable "not before T", including known provider
retry times, across passes and new runs; fresh allowance never bypasses that time.
Waits hold no request permit, lend the waiting member's window lane, and release
the writer lease when only deferred work remains. Sleep mode resumes after the
wait; exit mode reports the waiting time. Any stop ends retry/deferral waits and
prohibits those resumed retries. Soft-stop drain still permits an already admitted
step's remaining first-attempt requests under RUN-014/019; hard stop does not.
A woken pass acquires a valid writer lease under RUN-002. Failed earlier
attempts remain recorded, but neither a same-run pass nor a new run may blindly
replay already completed reusable paid child work. Whole-step reevaluation is not
resumption of an arbitrary JavaScript continuation.

**Validation:** [A-12a–l](acceptance.md#acquisition-retry-and-rate-admission-cases)
exercise lost responses, exhaustion, new-run versus same-run allowance,
classification/default precedence, not-before, cancellation and usage gaps.
Controlled clocks and providers establish the outcomes without live spend.

**Supersession.** The 2026-10-24 owner decisions replace M5's effect-safety gate,
persisted lifetime counters and fixed historical policy defaults as the current
target. [M5's plan](../plans/m5-operations.md) and
[EXP-8](../../experiments/exp-8/decision.md) preserve the former mechanisms and
results. Their intent/deferral/fencing/privacy evidence still matters; it does not
prove these new allowance or classification requirements are implemented.

### RUN-012 — One acquisition, distinct request attempts, truthful evidence

An external operation in current scope obtains analysis data (DOM-7). Multiple
request attempts may belong to one logical acquisition. A lost response or an
unclassifiable response is unknown evidence about that attempt, not proof of no
remote processing, no charge, or a successful acquired result. Within finite
RUN-011 authority, it may retry without `safeToRepeat` or provider-idempotency
permission. Provider idempotency may use the stable operation identity when
supported; it is a deduplication aid, not a retry prerequisite or a billing proof.
External business mutations and their exactly-once reconciliation are not promised.

**Identity and preserved local correctness.** An operation is addressed by the
step subject, a name and the author's request binding. Its stable identity and
request binding are retained across its retries; every network attempt has its
own attributable identity. A changed intended request remains distinct. A new
run's allowance is not a reason to erase or mint replacement history merely to
hide an earlier attempt. Only one call at an address may be in progress in a run,
and an ended step attempt sends nothing. The compatible mapping for legacy settled
addresses must be specified before migrating their representation.

- **Intent before send.** After the permit is held and stop intent rechecked,
  one fenced commit through History's operation journal records the operation
  as pending with the new request attempt, then Accounting records the usage
  intent; only then is the request sent. A failure of either write sends
  nothing and leaves the step pending on a deferral, never failed: the work is
  retried after it, backing off exponentially per operation (1 s, doubling,
  capped at 60 s). When the intent may have landed (its commit was not
  confirmed), the retry reuses the unsent request attempt with its original
  attribution, so the intent is restated idempotently and receives the send's
  usage; when it certainly recorded nothing (a busy store), the retry is a
  fresh request attempt with the current attribution. An operation identity carries 128 random bits from
  the host, so it never repeats across stores, processes or hosts; it is also
  the provider idempotency key and is kept by every retry. Only one call at an
  address may be in progress in a run, and an attempt that ended sends
  nothing.

The intent and usage protocol above is retained from the bounded M5 mechanism;
its local persistence-retry handling is not a source callback's provider policy.
History remains the fencing and atomic-record owner; Accounting remains the
usage-evidence owner. No failure to persist required intent may dispatch a request.

**Unknowns, taint and stop.** The next authorized writer records a dead or
lease-lost run's in-flight request as unknown, retaining correlation and possible
usage gaps. Retrying is then evaluated against the current run's finite allowance,
classification, timing and stop state. It does not require the operator to claim
that the provider did nothing. Deferral or unavailable acquisition must not be
caught to manufacture a completed result: the taint guard prevents later sends
from that ended/tainted step attempt and prevents publication of its apparent
return value. A later properly admitted attempt remains possible under RUN-011.
A later successful request supplies its own result and usage; it does not repair
unknown earlier consumption by inference.

**Manual recovery and compatibility.** Supplying an operation's missing result
manually is deferred, including reusable-validator, staging and submission
idempotency proposals. The former resolve/abandon model and consumed-success
address remain historical runtime behavior, not prerequisites to the acquisition
target. A statement that a remote effect happened is not the missing data. Existing
journal records and APIs require explicit migration/compatibility treatment before
implementation; no documentation change silently reinterprets them. Preserve
existing local writes, audit evidence, result validation, privacy and Accounting
report deduplication independently of that deferred workflow.

**Validation:** lose a paid POST-like acquisition response, then succeed under
finite policy with one logical identity and distinct attempts, no safety flags,
and an unknown first usage record. Kill before/after send and publication; preserve
durable intent, no stale-fence publication, truthful recovery and exact completed
child reuse. Legacy resolved records never become fabricated values. See A-12.

### RUN-013 — Retry history is part of supervision

Observations MUST correlate the logical external operation, its request attempts,
the enclosing step attempt, member, and run where applicable. Distinguish failure,
retry scheduled, waiting for eligibility, retry started, success, policy exhausted,
cancellation, and unresolved remote outcome. A scheduled retry MUST NOT be counted
as another completed request or settled member.

**Validation:** a transient failure followed by success, a long quota wait,
exhaustion with continuing siblings, and a later permitted acquisition all preserve
correlation and ordering. Attaching a trace consumer does not initiate a retry.
ACC-002 and ACC-003 prevent duplicated resource totals across these views.

**Owner decision (2026-09-30).** Every retry is correlated with its operation,
attempt, member and run identities. Inspectable events carry identifiers,
statuses, timings, usage figures and exact result references only. They never
carry input, output or argument values, or provider request or response bodies.
Diagnostics name fields and keys, not their contents.

**Selected mechanism (M5, #119).** Operation events carry the operation, request
attempt, step attempt (History's never-reused attempt identity), member and run
identities, a closed phase, status and reason code, the time, usage quantities
whose units are identifiers (others are dropped from the event and diagnosed by
code; Accounting keeps them), and the remote state. Wait events carry the
earliest deferral time and whether the lease was released. Neither has a field
for a binding, argument, value, provider body or error message, and operation
names and operator identities must be identifiers. Framework failure messages
and diagnostics name the step or position and the failure kind only. What author
or caller code throws (bodies, checks, hooks, gates, custom keys, subject
functions, admission, observers, abort listeners) never enters them. Where a
failure is returned to the caller, that error is kept as its `cause`.
Admission-denial reasons are strings the caller's admission policy chooses, not
author error text, and are repeated as given.

### RUN-014 — Cancellation conveys escalating intent honestly

Cancellation support MUST let an operator request that avoidable work stop even
when the current unfinished step will yield no reusable result. Participating
bodies/adapters must be able to receive cooperative stop intent; capable adapters
may request provider cancellation. The system MUST distinguish requested stop,
local stopping, provider cancellation requested, confirmed remote cancellation,
and unknown remote outcome.

Once a scope's selected stop policy prohibits further admission, participating
requests and scheduled retries MUST NOT revive that work. Cancelling one waiter
MUST NOT silently cancel work still required by another consumer. Arbitrary
synchronous JavaScript and remote services are not made forcibly cancellable by
a local signal.

The CLI MUST convey first-interrupt soft-stop intent and second-interrupt stronger
shutdown intent. This does **not** select whether soft stop drains current requests
or complete steps, a cleanup deadline, or a universal remote billing cutoff.

**Validation:** stop during an active request, while waiting for a quota reset,
and as a result finishes. Distinguish local cancellation from provider-confirmed
cancellation; preserve completed results and received resource observations.
Exercise shared consumers without silently transferring cancellation authority.

**Mechanism status:** M5/EXP-8 selected admitted-step drain, operator deadline
escalation and publication-commit linearization; those rules are preserved.
Remaining CLI final-exit representation and any broader shared-work cancellation
policy must be specified before their separate end-to-end claims. This acquisition
change does not reopen the selected stop mechanics.

**Owner decision (2026-09-30).** A soft stop admits no new work and drains
in-flight work, with **no default deadline**. An operator deadline or a hard stop
escalates it. A hard stop aborts author bodies and marks their attempts
interrupted. Remote state is recorded as cancelled, still running or unknown,
never omitted. [EXP-8](experiments.md) selects the drain unit, the escalation
mechanics and the publication/cancellation race rule.

**Preserved M5 mechanism and revised acquisition consequence.** The remote state
of an external operation's
aborted request attempt is committed through the operation journal by operation
and request attempt, so later runs and the operator see it after a restart. A
provider-confirmed cancellation settles the operation; `running` or `unknown`
leaves that attempt unknown. Hard stop or deadline escalation prohibits further
sends from the affected work. Soft stop instead refuses new admissions and retries
while an already admitted step may finish its remaining first-attempt requests
under permits, rate admission and the current fence, then publish under the
existing commit rule. A later new run applies RUN-011/012 with fresh allowance
and preserved unknown evidence, rather than requiring a statement about an
external business effect.

**Required-retry rejection (owner decision, 2026-10-24).** Rejecting further retries
for an input required by the declared graph gracefully stops the entire analysis.
Use the existing soft-stop admission/drain contract, without a new default deadline
or a claim of provider cancellation. Preserve completed durable work for a later
new run. Do not silently omit the input, publish partial complete-success output,
or leave rejected work running indefinitely. Escalation remains the existing
operator deadline/hard stop. This decision does not ratify a batch-approval queue.

**Validation:** exhaust required input A after admitted sibling B has completed
request 1 of a two-request body, then reject more retries for A. Admit no new work
or retry, but allow B's first attempt of request 2 under permits, rate and fence
checks, and let B publish. A hard stop or operator-deadline escalation before
request 2 prevents that send and partial publication. Retain completed results
for a later new run with fresh allowance and ordinary reuse. No missing input
becomes success; A-12b supplies the concrete positive and negative controls.

### RUN-015 — Partial work is not a completed result

Completing one request inside a multi-request body MUST NOT create an implicit
reusable result for that body. Failure or cancellation preserves attempt evidence
and received resource observations; it does not manufacture a completed output.
Only independently managed completed child results receive their own normal
reuse guarantees. No arbitrary request checkpoint or suspended-JavaScript resume
capability is implied.

The run MUST use Result History & Publication's ownership protocol for success,
abandonment, release, and expiry. Progress reporting must describe actual work;
timer-driven synthetic renewal is forbidden. Normal caught failure must release
ownership promptly through that protocol, rather than waiting for a lease timeout.
Crash expiry remains a recovery backstop, not proof of remote cancellation.

**Validation:** cancel after request one of three. Preserve its observed usage
and any separately completed child result, but expose no completed parent result.
Repeated identical lease-extension progress is rejected; a hung body cannot keep
ownership indefinitely through a timer. Stale-holder publication tests belong
also to the execution contract.

## Trials and environment protection

### RUN-016 — Trial scope is authored and executes the real pipeline

Trial mode MUST support reusable author-defined filters, selections, and limits
in the program. It MUST admit only the selected workload to excluded members'
expensive stages. Limiting concurrency alone does not implement trial scope.
Selected members traverse the real pipeline, including downstream aggregation;
trial execution may incur actual provider charges.

Selecting people MUST NOT silently truncate each selected person's required
history. Any additional limit changes the declared scope and must be visible.
Intentional exclusion, failure, missing data, and complete empty data MUST remain
distinguishable. A result complete for one team MUST NOT satisfy a request for
complete organization coverage merely because its value has the expected shape.

**Validation:** author selects two staff engineers, one designer, and two product
managers. No excluded person's provider work starts; selected people retain their
full declared corpus. An explicit PR cap is labeled as restricted scope, never
as source exhaustion. Normal mode does not apply trial-only filters.

### RUN-017 — Environment protection covers more than result labels

Trial iteration and cleanup MUST protect full-analysis data. The effective
environment boundary must cover results, mutable heads, claims, acceptance and
accounting records, and cleanup authority as applicable. Concurrent environments
MUST NOT be routed through a mutable process-global selection. Environment labels
alone do not establish isolation, and isolated local storage does not establish
isolation of remote access or provider charges.

Within the same compatible environment, repeated trials and widening scope MUST
reuse eligible completed member work while affected aggregates reconsider their
membership. Crossing from trial into production MUST NOT imply automatic cache
sharing or promotion. Cleanup must also preserve the retained-reference and
paid-result guarantees in the execution contract; absent observed spend is not
proof that deleting a result is permitted.

**Validation:** run trial and production concurrently; inspect store/claim routing
and cleanup. Clearing trial data cannot delete production results or break
retained references. Widen trial membership and reuse unaffected eligible member
results. Remote connections and credentials respect their configured scope;
local namespace isolation alone is not a provider-account or spending boundary.

**Open:** separate storage remains the recommended default, but exact backend or
namespace routing, remote connection configuration, and deliberate import/promotion rules
are unresolved. This does not select a promotion feature.

**Owner decision (2026-09-30), superseding the separate-storage recommendation
above.** Environments are **namespaced within one store**. Results, current heads,
claims, acceptances, accounting and cleanup are all isolated per environment.
Trial work satisfies production only through an explicit, recorded promotion. The
environment is selected per run, never process-wide. The concrete remote-service
and credential configuration representation remains open; external business-write
destinations are outside the selected acquisition scope.

### RUN-018 — Trial adequacy is distinct from execution success

The system MUST NOT claim semantic trial coverage or representativeness merely
because every stage ran or every input was nonempty. The author defines meaningful
trial selection. Optional future coverage assistance must preserve unknowns and
must not silently expand paid work to satisfy inferred goals.

**Validation:** a trial with no staff engineers legitimately produces an empty
leadership input; it can succeed without exercising leadership analysis. A
single-point box plot is execution-successful without proving useful variation.
Automatic economical subset selection is not a prerequisite for trial mode.

### RUN-019 — Shared rate admission precedes each send

**Accepted default (owner decision, 2026-10-24).** Proactive rate configuration is
optional. With no configured rate limit, acquisition proceeds under ordinary
execution/concurrency controls; the library MUST NOT impose an implicit proactive
request cap or require source rate configuration. Provider rate-limit signals
still invoke the applicable RUN-011 bounded retry/backoff policy, including known
not-before timing and the shared reactive coordination below. Matching custom
source policy/default precedence remains the same, and contextual classification
is not restricted to HTTP 429. Other failures,
finite retry allowance, stop, intent/fencing and existing execution limits remain
in force. Omission of rate configuration grants neither unlimited retries nor
permission to bypass a previously established not-before time.

**Rationale and boundary.** A user can deliberately configure a lower local limit
to pace work earlier and leave headroom for other activities. This is the user's
chosen bound, not an inferred provider capacity, automatic percentage reserve or
promise that other callers have unused quota. A built-in adaptive quota/reserve
strategy remains deferred. This does not prohibit a pluggable policy from using
observations to refine grouping/pacing under the adapter requirement below.

**Shared scope and overlapping limits.** The default coordination scope is a
**logical API surface**, not automatically a hostname, connection or disjoint
provider bucket. Access/account context can distinguish the applicable scope;
sharing a hostname does not silently merge unrelated accounts or services.
The system MUST support overlapping API-wide and narrower limits. Each request
is subject to **all applicable limits**: passing one cannot bypass another.
For example, catalog and search requests can share an API-wide constraint while
search requests additionally share a search-capacity constraint. A search-only
cooldown need not stop eligible catalog work; an API-wide cooldown holds both.
Exact identity and membership representations remain open; ordinary use must not
require a large upfront configuration model.

A configured units-per-time limit MUST coordinate admission across all concurrent
calls to which that shared limit applies in one Node process,
including retries and calls from different analysis paths or runs. Checking each
caller against an independent copy, or recording usage only after sending, cannot
enforce the shared ceiling. Logical central coordination is required; one physical
network dispatcher is not. A new run's retry allowance does not reset a shared
in-process rate limit used by other work.

**Reactive coordination (owner decision, 2026-10-24; first-build scope).** When a
provider rate signal applies to a known shared limit, affected callers MUST share
its cooldown and fair admission queue within the Node process, even without a
proactive numeric rate configuration. Applicable initial requests and retries
wait together; independent per-request sleeps followed by a race do not meet this
requirement. Unrelated sources/limits can continue. Waiting consumes no sent
attempt and holds no network request permit. Cooldown expiry returns eligible
work through controlled concurrency admission, not an all-waiters release burst.
This coordinates a contextual refusal and retry time; it does not infer remaining
provider balance or reserve quota. A matching callback cannot bypass an applicable
shared cooldown by requesting immediate retry.

Among otherwise eligible ready work, default admission MUST favor
**earlier-discovered work** as a simple progress preference. The goal is greater
intermediate completeness sooner: resolve useful intermediate stages instead of
spreading fractional progress across many stages. Earlier requests may unlock
downstream work that uses other services; discovery order is an approximation,
not a guarantee of optimal intermediate completion. Queue arrival/race-winning
order is not discovery order. Dependency readiness, not-before, finite allowance, stop and fencing remain
prerequisites; an earlier but ineligible item cannot block other eligible
work. This is fair admission with a discovery preference, not a strict global
ordering promise, DAG critical-path scheduler or cost optimizer. Define discovery
sequencing, retry placement and fairness details in the bounded implementation
design; do not invent a globally deterministic order from asynchronous discovery.

**Pluggable coordination policy (owner decision, 2026-10-24).** The rate
coordination boundary MUST accept an adapter spanning simple global/API-surface
policy and sophisticated adaptive grouping/pacing. The extension must provide
relevant rate-limit observations and history and allow updated applicable group
membership and pacing decisions. A consumer strategy may, for example, inspect
successive 429 observations to infer overlapping hidden constraints and revise
which logical API surfaces share queues, potentially using asynchronous ML/LLM
assessment. Supporting that strategy is required; implementing or invoking a
built-in adaptive/ML/LLM strategy is not. The adapter's exact interface, history
scope/retention and policy-state ownership are not selected here.

The adapter supplies policy decisions; Run Supervision retains admission and
dispatch authority. A permissive, delayed, stale or failed adapter decision MUST
NOT bypass any applicable gate, finite run allowance, stop, known not-before,
request binding, durable intent, taint or fence rule. Asynchronous completion is
not itself permission to send: runtime must establish current eligibility before
dispatch. No actual paid execution is authorized by an extension example.
Retries remain classified under RUN-011; rate policy cannot grant extra attempts
or manufacture successful data or observed usage. Grouping/pacing changes cannot
rewrite prior sent-attempt/accounting evidence. The design must explicitly choose
how policy updates affect queued and in-flight requests and how asynchronous
errors/timeouts/stale results are handled; no particular fallback or cancellation
algorithm is selected by this requirement.

Both reactive cooldown and configured proactive eligibility are independent of
request concurrency permits, finite retry allowance and stop intent. A callback's
immediate retry must satisfy all applicable conditions before send. A delayed retry cannot
send before its not-before time even when rate capacity is available. Waiting
holds no network request permit.
Apply RUN-014's selected stop boundary while waiting: soft stop blocks new
admissions and retries, but an already admitted step may finish its remaining
first-attempt requests when otherwise eligible; hard stop or deadline escalation
prevents further sends from affected work. Available rate capacity does not bypass
those rules. Intent persistence/fencing under RUN-012 remains a prerequisite too.

The configured unit may be requests or an application-defined quantity. Retrieved
GraphQL nodes, for example, are not automatically GitHub billed quota units.
Rate admission uses the configured quantity/bound, not invented observed usage
or a guarantee about a provider's remaining capacity. Accounting still records
actual received observations separately and does not own scheduling (ACC-008).

**Scope.** Initial coordination is within one Node process only. No cross-process
or cross-machine limiter, distributed reservation protocol, or shared provider
quota guarantee is selected. Built-in adaptive provider-quota/reserve inference
and advanced priority strategies remain deferred; dynamic grouping/pacing through
the required adapter is in scope. Honoring a retry time remains RUN-011 and does
not guarantee remaining provider capacity. Shared reactive cooldown and the
extension boundary are required independently of a built-in adaptive strategy.
Scope/limit identifiers must not expose raw credentials in inspection/events (RUN-013/017).

**Validation:** a controlled clock and concurrent barriers present requests from
two paths sharing a configured limit; their combined admitted units, including
retries, obey the configured bound. Requests must pass every overlapping limit;
limits without overlapping callers remain independent.
Hard stop or deadline escalation, denied retry allowance and future not-before
each prevent the affected dispatch even if other conditions pass. Soft stop denies
new admissions/retries while preserving the admitted-step first-attempt drain
case in A-12b, still subject to all applicable rate gates. A new run cannot reset
another run's shared limiter. A-12h contrasts omitted configuration with a chosen
proactive limit and checks bounded handling of provider rate-limit signals.
A-12i checks default attempts/backoff; A-12j checks shared cooldown, controlled
resume and discovery preference without proactive configuration. A-12k/l cover
overlapping scope and pluggable synchronous/asynchronous grouping/pacing without
any live adaptive-provider execution.

**Open implementation choices:** units known before dispatch versus a conservative
reservation, window/burst algorithm and boundary behavior, reservation release
on cancellation, lifecycle, logical API-surface/limit identity, overlapping
membership and unknown-scope handling without mandatory numeric configuration.
Select discovery sequencing across branches/runs, retry placement, default
fairness/tie handling and cooldown representation. Select adapter interface,
observation/history exposure and retention, policy-state ownership, queued and
in-flight reclassification, asynchronous decision races, timeout/error/fallback
behavior and revalidation before dispatch. Document these in the bounded
implementation design before claiming conformance. These open representations
do not postpone the required extension capability or permit bypassing runtime
invariants; they select no universal cap, credentials DSL or paid strategy.

## CLI and read-side delivery

### CLI-005 — Bounded exact-execution observation

**Status:** supervisor-selected contract candidate. A scoped adversarial review
found bounded repairs; the same-reviewer recheck is pending. This is not yet an
accepted requirement or implementation-readiness decision.

The first contribution-report CLI slice MUST start one workflow execution and
allow a separately permissionable, read-only reader to inspect that exact
execution. This slice supplies only exact-execution progress and terminal
observation; it does not satisfy the broader CLI-001–004 read-side family or M6.
The selected product scope is recorded by the #167 owner decision; the bounded
engineering contract below is the supervisor-selected candidate for review, not
a claim that the owner selected these mechanisms. The concrete workflow and
report classification belong to the application assembly (#240).

**Identity and storage.** Supervision MUST mint a fresh bounded execution identity for every invocation,
independent of a reusable public `runId`, and return an explicit locator. The record identifies the analysis and environment, may retain
the public `runId` for correlation, and carries a monotonically committed
revision and sample time. Sample time dates the facts sampled; it is not a
heartbeat, liveness proof or report-freshness claim. It owns one bounded latest-observation artifact per execution, using the existing
Machine delete-journal publication and read-only capabilities.
Creation MUST NOT overwrite a different execution. The locator and all stored
identifiers have explicit finite size limits. The artifact has no global catalog,
TTL, automatic cleanup or per-PR/event ledger. History's WAL journal is not an
observation store; the reader MUST NOT open writable History as fallback or
perform hot-journal recovery. Reading accepts only the exact locator and returns
one coherent revision, or an explicit absent, identity-mismatch,
unsupported, corrupt, busy, unavailable or recovery-required result. It has no
write, initialization, recovery, execution, claim, retry, cancellation, callback
or control capability. A read that faithfully reports a recorded failure is a
successful read. Each finite read terminates with one closed, versioned JSON
document for the requested locator, with the bounded observation or explicit
read-state discriminant. It does not wait for execution completion, subscribe to
updates or follow subsequent revisions. It emits no banners or prose framing and
provides no generic author serializer; semantic fields and discriminants are
fixed while field spellings remain an implementation choice. The local reader has only `read` and `close` authority.
`close` is idempotent; later reads reject clearly. The reader may be opened during
or after execution; closing it does not stop or mutate execution and does not
delete the owner-managed artifact. A nonterminal record and its sample time do
not prove that the execution is still alive; process disappearance does not
manufacture terminal state.

**Private producer and lifecycle.** A private Supervision producer mints the
revision and sample time and records only actual `prepared`, `running`,
`draining` and `closed` transitions. It MUST durably publish `prepared` before
analysis starts; failure prevents analysis and makes no promise of a durable
terminal record. After acknowledged preparation, a pre-entry setup failure may
close with body disposition `not-entered` once all actual tracked work and other
execution resources have drained and closed. A body that entered closes only
after it returned or threw and its tracked work/resources have drained. The
terminal body-disposition union is exactly `not-entered`, `returned`, or `threw`;
body return is not strict report success. Terminal records preserve bounded typed
execution failure reasons and diagnostic presence/count, never arbitrary error
messages, stacks, body values or provider payloads. The producer also records
authoritative stop and closure facts on all three paths, including the frozen
closing stop state, earliest deferred `waitingUntil` left behind, and bounded
remote-state interruption counts. A later mutation of shared stop control cannot
rewrite a closed observation. An application statement alone cannot cause early
closure.

The application receives only a bounded completion-submission capability. Its
closed statement is `not-classified`, `incomplete` with finite reason flags, or
`confirmed` with a bounded exact acknowledged deliverable locator. It cannot set
framework identity, revision, timestamp, phase, stop or closure facts, or write
raw records. It submits at most one final statement per execution before closure;
an exact duplicate is idempotent, a conflicting replacement is rejected, and
closure seals the statement. Missing submission, including failure/setup paths,
becomes `not-classified`. Submission cannot finish a run early; post-close writes
are rejected. The application owns strict required-work, coverage and report
publication truth. Generic return values, output filenames, pending promises and
lifecycle events cannot confirm a report. Failed, pending, cancelled or incomplete
terminal executions need no successful report. A confirmed report may coexist
with a later unrelated execution or cleanup error only when strict obligations
were actually established; both facts remain visible.

**Bounded content and sampling.** The record MUST be bounded independently of
corpus size. It may retain fixed counters for the existing lifecycle, step,
operation, send, deferred-wait and promotion event groups; a bounded latest event;
typed finite event and execution failure reasons and diagnostic presence/count;
body disposition; actual stop facts; a bounded latest deferred-wait observation;
terminal execution facts; and the application statement. Event counts describe
sampled events only: they are not unique operations, current in-flight work, PR
counts, completion, or percentages. Counters saturate at `Number.MAX_SAFE_INTEGER`
and expose a saturation/lower-bound flag. Do not retain member/key/label arrays,
raw errors, provider payloads, arbitrary author values, or generic numeric-string
counters. A latest wait event is an observation, not a census of concurrent work.
There is no PR denominator in this slice; full CLI-003 fan-out presentation and
realistic workload qualification remain separate gates.

Ordinary observations MUST be sampled no more often than once per second and
coalesced to at most one newest pending snapshot; initial and terminal records
are forced, and terminal supersedes an ordinary pending sample. The internal
producer runs independently of fallible user observers, contains its own errors,
and MUST NOT block stop/abort propagation on storage. Initial storage failure
prevents analysis. Mid-run observation failure is contained and reported
separately; it cannot alter dispatch, retry, stop or publication policy. Terminal
acknowledgment/uncertainty is distinct from execution/report outcome. Exact
terminal readback or idempotent retry may resolve acknowledgment uncertainty,
but cannot change sealed contents or rerun analysis.

**Examples and acceptance.** If two invocations reuse `runId: "weekly"`, they
receive distinct locators; opening one locator never returns the other's record.
If a run has observed 100 operation events, the record may say 100 observed
operation events, but cannot say 100 PRs completed or that work is 80% done. If
the last recorded deferred-wait event says `sleeping` while another wait is active,
the reader reports that event as the latest observation, not as the full wait
state. Required outcomes are in [A-21](acceptance.md#exact-execution-observation-cases).
The record schema may choose field spellings, but its discriminants and these
semantics are fixed. This contract is a selected candidate pending different
adversarial review; it is not implementation or M6 acceptance evidence.

### CLI-001 — Read-only inspection is an explicit delivery checkpoint

A usable read-only CLI MUST be delivered and validated as its own named checkpoint,
not buried inside the final provider-backed demonstration. It MUST inspect retained
results/attempts, dependency and acceptance evidence, errors, and observed resource
usage using public read-side contracts. It MUST show when evidence is absent or
has not been validated for the current evaluation.

Inspection MUST NOT execute analysis bodies, invoke current source policy hooks,
refresh providers, acquire/renew/release claims, publish acceptance, sweep, reclaim,
or retry work. Read-only inspection is not a request for current verification.
A requested validation/run is a separate operation that follows execution policy.
Framework-controlled inspection must enforce this distinction; it is not a sandbox
for arbitrary side effects in user JavaScript.

**Checkpoint evidence:** inspect a seeded history and a failed attempt with both
the body/source dispatch ports and all mutation ports instrumented to reject calls.
Explain the recorded reason and resource evidence with zero execution or mutation.
Inspect a candidate whose current validity is unknown and report that uncertainty.
The checkpoint does not require a live paid provider or a terminal toolkit choice.

### CLI-002 — Plans distinguish declared structure from known runtime work

Plan inspection MUST expose declared stages/relationships, selected scope and
filters, fan-out boundaries, and known versus unknown cardinality. It MUST
distinguish a recorded candidate from a currently validated reuse decision, and
conditional downstream work from execution known to be necessary. Showing a plan
does not itself authorize paid execution.

Exact simulation of every future result, branch, cardinality, and cost is not
promised. The primary workflow pairs a plan with a deliberately scoped real run.
Any additional planning-time discovery or validation requires an explicit policy
and must not be hidden inside CLI-001's read-only inspection.

**Validation:** inspect the same declared analysis before and after discovery;
show unknown counts honestly. A stored result alone never produces an unconditional
current-cache-hit claim. A selected-team plan does not present full-organization
coverage. Optional cost extrapolation carries its assumptions under ACC-006.

### CLI-003 — Progress and cache explanations retain meaningful distinctions

The CLI MUST distinguish candidate verification, accepted reuse, new execution,
waiting on another owner, waiting for required inputs/discovery, scheduled retry,
failure, refusal, cancellation, and work not yet started. These are semantic
distinctions, not prescribed enum names. A waiter is not another executing body;
verification is not already a cache hit.

Fan-out presentation MUST make nested groups, member failures, coverage, and
blocked dependent work understandable without requiring one terminal line per
member. Before discovery closes, report discovered and settled counts with an
unknown total rather than a fabricated completion percentage. Settled means an
appropriate terminal outcome, not necessarily success.

An explanation MUST identify available evidence for reuse or execution, including
relevant input differences and unchanged-output cutoff. It MUST NOT claim an
unobserved reason. Fresh equal-valued output, explicit retention of a prior result,
and acceptance with no source request remain distinguishable activities.

**Validation:** seeded states show each distinction; two converging consumers
report one actual execution. With 100 discovered and 80 settled but discovery
open, the display does not claim 80% of the final population is complete. A changed
child with unchanged consumed output explains retained downstream work.

### CLI-004 — Inspection supports intervention without concealing errors

The CLI MUST let the operator inspect progressing values, visible errors and
coverage, retry reasons/eligibility, and observed usage sufficiently to decide
whether to stop, adjust the analysis, and start a later run. Prior values MUST
not hide failed refreshes. Stop requests use RUN-014; attaching a display or
resource sink must not change execution or retry policy. Inspection remains
available after execution ends under RUN-008. Thin push prompts read-side
inspection of current/recent information; it carries no success/failure payload.
CLI delivery does not assign consumer cache persistence to the library.

**Validation:** a run with successful, failed, waiting, and stale-preview members
remains inspectable; its resource gaps remain visible. First and second interrupts
produce distinct stop intents without claiming unsupported remote termination.

**Open:** commands, interactive controls beyond the selected escalation intent,
TTY/non-TTY formats, diagnostic/result stream layout, final report format, and
exit-code policy. The CLI must report mixed outcomes honestly regardless of those
presentation choices. A full GUI/React viewer is not a prerequisite for this CLI.

## Resource accounting

### ACC-001 — Record supported observations without hardcoding money

Accounting MUST accept resource quantities supported by observations, including
but not limited to tokens, requests, provider quota units, and currency. Authors
and adapters may supply observations during execution; reporting MUST NOT depend
on a successful result return. Units and applicable resource scope must remain
identifiable so that unrelated quantities are not silently combined.

Provider-specific conversions are not universal equivalences: retrieved GraphQL
nodes are not automatically charged quota units, and tokens are not automatically
dollars. The exact quantity schema, numeric representation, and registration/API
remain open; generic accounting is not contingent on an LLM workflow package.

**Validation:** aggregate several supported resource kinds without a monetary
field; preserve separate units, currencies, and independently limited pools.
No provider pricing lookup is necessary to report observed token counts.

### ACC-002 — Attribution is independent of result publication

Received observations MUST remain attributable to the actual work that produced
them, including failed, cancelled, and retried attempts. Roll-ups through steps,
members, and runs MUST NOT count historical consumption attached to reused results
as new consumption. Sharing one execution across converging consumers MUST NOT
multiply its reported usage.

Acceptance of an old result after a source check can incur new observed usage;
it does not rewrite the old payload's execution provenance. A fresh result equal
in content to a prior result still has its own actual work and observations.

**Validation:** retain a prior result after a validation request reporting one
unit; this run reports one unit, not the old execution's historical usage. Two
waiters share one reported execution charge. A failure after reporting 100 units
keeps those observations available subject to the persistence contract in ACC-007.

### ACC-003 — Summation must not duplicate reports or hierarchy

Accounting MUST distinguish additive deltas from cumulative snapshots and parent
roll-ups from their constituent observations. Repeated presentation or processing
of the same report MUST NOT inflate totals. The selected reporting protocol must
define deduplication/replacement semantics before promising retriable durable
reporting. Idempotency of a remote operation does not establish whether its
requests were billed, or establish accounting-report identity.

**Validation:** replay one report, observe cumulative updates of 10 then 15, and
display both parent and child views. The resulting totals reflect the reporting
semantics rather than 25 or double the child total. Independent attempts with
distinct actual reported consumption still count separately.

**Open:** observation identifiers, correction/replacement rules, ordering, and
concurrent report protocol. No arbitrary user-defined aggregation engine is
required to distinguish deltas, snapshots, and derived totals.

**Owner decision (2026-09-30).** Each reported usage observation is identified
by (operation identity, report identity). Duplicate delivery of the same report is
idempotent and is never summed twice. Correction and ordering rules follow
[EXP-8](experiments.md).

**Selected mechanism (M5, #119).** Run Supervision namespaces report identities
by their source: a provider's report is acknowledged as `provider:<report>` and
legacy operator-reported usage as `operator:<report>`, so the two can never
collide. This historical namespace remains evidence/compatibility data; it does
not require the deferred manual result-recovery workflow.

### ACC-004 — Resource-state reports are time-qualified, not consumption

Reported allowed/remaining limits, reset times and similar resource state MUST be
readable by consumers that want that evidence, separately from consumption
increments. Combining reports across pools or windows MUST NOT invent a shared
remaining balance. A report is not guaranteed current capacity; missing state is
not reported zero. Recording or expiring it does not schedule work or grant
admission/retry authority (ACC-008).

**Accepted owner decisions (2026-10-24).** Persist time-qualified reports across
analysis/process restarts while relevant. Prefer explicit provider/source reset
or validity information. Without it, retain a report for **one hour from its
observation**, with an optional local-retention override; do not require every
adapter/user to configure expiry. The fallback is local retention, not an inferred
provider window, reset, replenishment or permission to send. Preserve observation
time and the retention basis; restarting or redelivering the same report must not
silently extend its age. A retained report still only says what was reported.

Evict reports promptly once irrelevant/expired so state does not accumulate as an
unbounded history. This expiry MUST NOT delete or rewrite durable consumption,
usage-gap, request-attempt or result evidence. Read-only queries do not perform
cleanup writes: the persistence/maintenance owner must supply the eviction path,
including handling expired records after a long absence. Do not expose expired
reports as applicable state while awaiting physical cleanup.

**Smallest read contract.** Qualified reports are sufficient; no authoritative
latest-balance reducer or provider source-order protocol is required. Preserve
available provider/account/pool/resource/unit/window and timing qualifications,
with missing information explicit and without raw credentials. Receipt order or
a lower balance is not proof of provider source order. State is never summed as
consumption, deducted twice, or used to fill missing usage. A dedicated
remaining-limit notification system or complete quota-management product is not required.

Resource Accounting owns recording, durable evidence, queries and state retention;
its adapters implement those ports. Apply ACC-007 acknowledgment guarantees.
Run Supervision retains execution policy. Built-in adaptive quota/reserve management
is outside this report capability; pluggable coordination policies may consume
evidence through their own contracts without transferring admission authority to
Accounting. Consumer caching/persistence and preview transport remain separate.

**Validation:** [A-14a–f](acceptance.md#resource-state-report-cases) cover retained
raw reports versus additive consumption, restart before/after expiry, explicit
reset versus one-hour fallback/override, prompt physical cleanup and read-only
inspection with rejecting execution/write ports. [The decision plan](../plans/resource-state-observation.md)
records rationale and implementation handoff. These are new target requirements,
not claims that the existing additive M5 implementation already supplies them.

**Implementation choices:** record/query representation, observation-time mapping,
exact expiry comparison, identity/duplicate/conflict behavior, malformed validity
handling and cleanup trigger/cadence. Document and test these within the accepted
outcomes before implementation; no additional owner decision is needed for routine
encoding. A future selected-current-balance feature needs its own ordering contract.

### ACC-005 — Unknown usage is not zero and observed totals are not a bill

No observation contributes no numeric increment; it does not prove zero actual
consumption. Known missing/partial reporting MUST remain visible. Monetary totals
derived from received charge observations MUST be described as observed/reported
spend rather than a guaranteed final bill. The same limitation applies to other
resource quantities.

Accounting MUST NOT fabricate usage for a lost response or require external
billing reconciliation to fill a gap. It must preserve observations received from
failed work without promising that every failed or cancelled request supplies
one. Received evidence and acknowledged durable evidence differ under ACC-007.

**Validation:** one request reports 100 units and a second fails without usage
data. Report 100 observed units and the known gap, not an exact total, a guessed
charge, or a blocked run waiting for a billing integration.

### ACC-006 — Estimates retain their basis and remain separate from observations

Estimated future work, historical recorded consumption, this run's observed
consumption, and monetary conversions MUST be distinguishable. A conversion with
incomplete billing inputs MUST be labeled as an estimate with its assumptions;
estimated currency MUST NOT enter an observed-currency total as though reported
by the provider. Missing cached-input usage is unknown, not zero.

Reporting tokens without money is valid. An assumed uncached rate is not a
guaranteed upper bound unless the applicable rates and other charges justify
that assertion. Provider prompt caching and microdelta result reuse are different
mechanisms and MUST remain distinguishable in explanations.

**Example and validation:** a response reports 100,000 input and 1,000 output
tokens, with no cached-input breakdown. Preserve those observed token counts.
Leave currency unavailable or show an explicitly assumed estimate; do not mark
the estimate as observed spend. A trial extrapolation must not claim the selected
team is representative of the whole organization without supporting evidence.

### ACC-007 — Acknowledgment must state its durability guarantee

The reporting contract MUST distinguish accepting/enqueuing an observation from
acknowledging that it is durable. A synchronous enqueue MUST NOT imply survival
of immediate process death. If the API acknowledges durable recording, subsequent
recovery MUST include that observation exactly according to its deduplication
contract, independently of successful result publication.

**Validation:** for any durable acknowledgment, terminate immediately afterward
and recover the observation once; fail persistence and ensure no durable
acknowledgment is issued. For an enqueue-only boundary, expose its weaker guarantee
and do not make a crash-durability claim from a normal-shutdown test.

**Open:** reporting signature, journal/persistence mechanism, failure/backpressure
behavior, and which acknowledgment guarantee is the default. These must be settled
before the corresponding reporting API and operational milestone can be claimed
complete. This rule does not itself select synchronous blocking or await syntax.

**Owner decision (2026-09-30).** **Intent before send.** An "operation started"
record is made durable before each paid call. Usage is recorded afterwards as an
idempotent acknowledgment keyed by operation and report identity. A crash between
the two leaves that operation's usage **unknown**, never zero (ACC-005). The
default acknowledgment guarantee is durable persistence, before the report is
acknowledged to the caller. [EXP-8](experiments.md) selects the concrete record
shapes.

### ACC-008 — Accounting supplies evidence, not execution policy

Recording or displaying usage MUST NOT grant retry permission, enforce a budget
by implication, or schedule work. An author-selected gate may use accounting
evidence through the execution contract. Provider/model selection, schema repair,
and conversation orchestration remain optional adapter/helper concerns; generic
supervision and accounting MUST work without them.

Accounting also MUST NOT decide that unreported/zero currency makes a retained
result safe to delete. Retention and reference integrity remain governed by
Result History & Publication. Exact monetary completeness is not a prerequisite
for preserving result history or for useful resource reporting.

**Validation:** add/remove an observer and keep execution decisions unchanged;
an explicitly installed gate alone supplies any refusal policy. Unknown usage
does not become deletion permission or an invented free-execution category.

## Remaining mechanisms and validation discipline

The following work remains bounded by already-required behavior. It must not be
silently filled by old exploratory signatures or expanded into new products.

| Mechanism to resolve | Owning boundary | Requirements it must preserve |
| --- | --- | --- |
| Scoped lifetime across lazy iteration and recovery | Run Supervision with Definition & Binding | RUN-001, RUN-002 |
| Source-specific discovery closure and subsequent updates | Run Supervision and source adapters, accepted through Reuse Resolution | RUN-003–RUN-005 |
| Preview read/activity shapes, signal coalescing, reader resources and aggregate loading | Observation boundary with Materialization | RUN-006–RUN-008, CLI-004 |
| Per-run allowance, source classification, legacy journal compatibility and acquisition identity | Run Supervision/adapters with Result History & Publication | RUN-011–RUN-013 |
| Shared single-process proactive/reactive rate admission and limit identity | Run Supervision with source adapters and Machine timing | RUN-019; ACC-008 does not schedule |
| Soft-stop boundary, shared cancellation, and publication race | Run Supervision with Result History & Publication | RUN-014, RUN-015 |
| Trial namespaces, external destinations, optional promotion | Run Supervision with storage/history ports | RUN-016–RUN-018 |
| CLI format and exit policy | CLI application | CLI-001–CLI-004 |
| Quantity representation, report identity, durability acknowledgment | Resource Accounting | ACC-001–ACC-008 |

Required validation is test-first when implementation begins. Controlled clocks,
barriers, fake providers, and instrumented context ports should prove the stated
outcomes without paid requests or timing-dependent sleeps. Unit tests alone do
not prove cross-context ownership: the [acceptance scenarios](acceptance.md) must
exercise readiness/reuse, retry/claims, cancellation/publication, environment
routing, and accounting/recovery together.

The read-only CLI checkpoint has independent evidence under CLI-001. Operational
readiness additionally requires the selected policies above and their failure
tests before a broad paid provider run. Documenting these requirements, rendering
a terminal mockup, or passing existing store/tracking tests does not establish
that those capabilities are implemented.
