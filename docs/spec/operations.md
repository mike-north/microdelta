# Run supervision, CLI, and resource accounting

**Status:** normative behavioral contract, consolidated 2026-09-26. This document
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
their own execution attribution. Concurrent runs MUST remain isolated.

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

### RUN-007 — Preview envelopes preserve availability, freshness, and errors

Previews MUST expose the latest available value through a library envelope that
keeps framework status separate from author data and requires explicit unwrapping.
Unavailable, available-but-unverified/stale, and accepted data MUST be
distinguishable. Legitimate empty values, zero, or a successful `undefined` MUST
NOT stand in for unavailable data or failure.

If a refresh fails, a previous value MUST remain available with its stale status
and the refresh error. If no value exists, expose unavailability and the error.
A verified read MUST report the failure instead of silently returning the stale
preview as success. A failed attempt does not become a completed result envelope.

**Validation:** refresh with and without a prior value; assert visible error and
status in both cases. Change freshness while preserving equal author data and
ensure observers can see the status change. A verified consumer never receives
the stale fallback as an accepted result.

**Open:** discriminants, error retention across later coalesced updates, and
observer attachment/disposal lifetime. Disposing an observer must not silently
select an otherwise unspecified execution-cancellation policy.

### RUN-008 — Throttled observation remains live and bounded

Preview delivery MUST support optional throttling: continued arrivals permit
periodic latest-state delivery without requiring a quiet interval, and the final
coalesced state MUST be delivered after activity settles. Throttling MUST NOT
renew a claim, establish readiness, or authorize expensive work.

Updating an existing member's contribution MUST replace its prior contribution
in a preview aggregate rather than count two result snapshots as two members.
Settled aggregates MUST reflect established removals. Observation of selected
fields MUST NOT require materializing every member's unrelated large payload.

**Validation:** use a controlled clock to sustain arrivals across several throttle
intervals, then stop. Observe periodic delivery and the final state; inspect
actual payload reads and refresh work. Refresh one PR into another histogram
bucket and verify it contributes once.

**Open:** interval defaults, leading/trailing details, treatment of retained old
members during an unfinished refresh, and storage-specific aggregate optimization.
No general SQL query engine or incremental aggregate engine is selected.

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
provider failure and cannot fabricate successful publication.

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

### RUN-011 — Retry support includes unattended quota waits

The system MUST support retries for recognized recoverable failures and rate
limits, including policies that resume after waits lasting hours. The operator
must not need to restart or repair every recognized quota deferral manually.
Applicable retry policy determines eligibility, limits, and resumption; retries
are not implicit behavior of storage, observation, or accounting.

Deferred work MUST show why it is waiting and any known next eligible time.
Independent work outside the affected resource scope can continue. A run with
no currently admissible work may be honestly idle awaiting a reset. Unknown
reset times, permanent failures, and exhausted policy MUST NOT become fabricated
progress or an unconditional promise of eventual success.

Retry policy MUST distinguish another request attempt within a body from a new
durable step attempt. It MUST NOT indiscriminately replay earlier successful paid
work in an enclosing body. Waiting MUST NOT retain request permits or invent
changing progress values to keep a claim alive. The claim/deferral protocol must
preserve publication ownership and prevent unintended duplicate execution.

**Validation:** a controlled provider reports a future reset; no premature or
busy-loop requests occur; unrelated work proceeds; permitted work resumes when
eligible. Trace both request and step attempt boundaries. Test cancellation
during the wait and claim ownership through the selected deferral protocol.

**Open:** policies/defaults, coordinated cooldown representation, claim transitions
during long deferral, deadlines, and durable deferred-work recovery after process
restart. Durable deferral is not promised merely because results are durable.

**Owner decision (2026-09-30).**
- **Retries by default.** Rate-limit and quota responses that carry a retry time
  are retried by default.
- **Deferral.** The retry goes through a **durable deferral** that records "not
  before T". The deferral releases the writer lease and holds no execution permit.
- **Waiting mode.** By default the process sleeps and resumes. A run may instead
  exit and report "waiting until T".
- **Restarts.** Later runs admit the deferred work no earlier than T and reuse
  completed work.
- **Other failures.** Other transient failures retry only under an author-declared
  policy with limits and backoff.
- **Mutations** never retry blindly.

[EXP-8](experiments.md) selects the concrete deferral record and resume mechanics.

**Selected mechanism (M5, #119).**
- **Policy.** A rate or quota response with a retry time defers its operation
  durably ("not before T") and is retried by default, at most 5 times unless
  the author's policy sets another cap; the next refusal fails it as
  exhausted. A transient failure (including a rate limit without a retry time)
  retries only within the author's `maxAttempts`, after a backoff that is
  itself a short durable deferral holding no permit and lending its member's
  window lane. A permanent refusal is final.
- **Pending, not failed.** A deferral ends the step attempt without a result;
  the step stays pending (never failed or cancelled) and its member reports
  the deferral and its time.
- **Passes.** A normal request runs in passes. Once only deferred work
  remains, the run releases the writer lease. In sleep mode it waits for the
  earliest time (any stop ends the wait) and runs another pass, under the
  derived request key `<key>#pass:<n>` (a caller's normal request key may not
  contain `#pass:`), in which the deferred work resumes
  under the same operation identities and work that settled in an earlier
  pass, such as a failed member, is not executed again. A woken pass obtains
  the writer lease as any normal request does (RUN-002 owner decision): it
  waits while another process holds it, until an operator deadline, with no
  default deadline. In exit mode it returns and reports the time. A strict fold that has failed is returned
  without waiting.
- **Restarts.** Admission reads each step's unsettled operations before the
  caller's policy: before T it denies the work and the run waits or exits
  until T; after T it admits it, and the operation is retried under its
  identity. A stop refuses resumed deferrals.

### RUN-012 — External idempotency belongs to the logical operation

Supported retry facilities MUST accommodate provider idempotency for ambiguous
external mutations. An uncertain response is not evidence that no side effect
occurred. Retrying the same intended operation requires the corresponding stable
operation identity and equivalent request binding under that provider's contract;
a deliberately new operation must remain distinct.

One step can perform several external operations, and several network attempts
can belong to one operation. A result subject, a fresh attempt identifier, or an
accidental call index MUST NOT silently substitute for that distinction. Recovery
must not claim safe replay when it cannot reconstruct the required operation
identity/binding. A provider without suitable idempotency support requires an
explicit policy for ambiguous writes, not an automatic safety guarantee.

**Validation:** a fake provider commits then loses its response. Repeat the same
logical operation and verify one mutation. Exercise multiple operations per step,
changed parameters, a deliberately new operation, expired provider deduplication,
and unsupported idempotency. Ambiguity remains visible. If restart-safe replay is
promised, interrupt before/after send and prove the original binding is recovered.

**Open:** addressing/API, persistence-before-send protocol, and provider-specific
recovery policy. General reconciliation and universal exactly-once remote
execution are outside this requirement.

**Owner decision (2026-09-30).** A stable operation identity is persisted before
every external call. When the provider offers no idempotency and a response is
lost, the outcome is **unknown** and there is no automatic replay. The author may
declare an operation safe to repeat, which permits a retry under the same
operation identity. Otherwise the operator decides.

**Selected mechanism (M5, #119).**
- **Addressing.** An operation is addressed by its step attempt's subject, an
  identifier name and an author-supplied binding digest. An unsettled
  operation at an address (pending, deferred or unknown) keeps its identity
  for every retry; a settled address or a changed binding is a new operation.
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
- **Unknown outcomes.** A lost response, or one the adapter cannot classify,
  is unknown. It is retried only with a safety basis (the author's
  safe-to-repeat declaration, or provider idempotency keys, which carry the
  operation identity) and a policy allowing another attempt. Otherwise the
  step attempt is tainted: every later call it makes rethrows the signal
  without sending, its step stays pending, and later runs are denied
  admission until an operator resolves or abandons the operation. An
  operation that a dead run, or a run that lost its lease, left in flight is
  recorded unknown by the next writer.
- **Operator settlement.** Resolving records the asserted outcome and
  acknowledges usage the operator learned through Accounting under an
  operator-namespaced report identity; abandoning leaves the usage unknown.
  Both are fenced journal commits, and both unblock the step.
  - **Resolved as succeeded.** The effect happened, so the address stays
    consumed: a later call at the same subject, name and binding mints and
    sends nothing and fails with a typed `operation-resolved` code that
    carries no value. The author may catch it; uncaught, the step attempt
    fails, naming the code. Mutations are never retried blindly (A-12).
  - **Resolved as failed** asserts that nothing happened, and frees the
    address for a new operation.
  - **Abandoned.** The address is free: abandoning is the operator's explicit
    authorization of a possible second effect.
  - A resolution that supplies the operation's result is deferred to M6.

### RUN-013 — Retry history is part of supervision

Observations MUST correlate the logical external operation, its request attempts,
the enclosing step attempt, member, and run where applicable. Distinguish failure,
retry scheduled, waiting for eligibility, retry started, success, policy exhausted,
cancellation, and unresolved remote outcome. A scheduled retry MUST NOT be counted
as another completed request or settled member.

**Validation:** a transient failure followed by success, a long quota wait,
exhaustion with continuing siblings, and an idempotent recovery all preserve
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
names and operator identities must be identifiers.

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

**Open:** active-work policy, exact propagation scopes, shared-work ownership,
deadlines, publication/cancellation race rule, and final exit behavior. These must
be specified and tested before end-to-end cancellation is declared complete.

**Owner decision (2026-09-30).** A soft stop admits no new work and drains
in-flight work, with **no default deadline**. An operator deadline or a hard stop
escalates it. A hard stop aborts author bodies and marks their attempts
interrupted. Remote state is recorded as cancelled, still running or unknown,
never omitted. [EXP-8](experiments.md) selects the drain unit, the escalation
mechanics and the publication/cancellation race rule.

**Selected mechanism (M5, #119).** The remote state of an external operation's
aborted request attempt is committed through the operation journal by operation
and request attempt, so later runs and the operator see it after a restart. A
provider-confirmed cancellation settles the operation; `running` or `unknown`
leaves it unknown and its step blocked until an operator settles it.

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
isolation of external side effects.

Within the same compatible environment, repeated trials and widening scope MUST
reuse eligible completed member work while affected aggregates reconsider their
membership. Crossing from trial into production MUST NOT imply automatic cache
sharing or promotion. Cleanup must also preserve the retained-reference and
paid-result guarantees in the execution contract; absent observed spend is not
proof that deleting a result is permitted.

**Validation:** run trial and production concurrently; inspect store/claim routing
and cleanup. Clearing trial data cannot delete production results or break
retained references. Widen trial membership and reuse unaffected eligible member
results. Separate external-output destinations are exercised where the application
performs writes.

**Open:** separate storage remains the recommended default, but exact backend or
namespace routing, external destinations, and deliberate import/promotion rules
are unresolved. This does not select a promotion feature.

**Owner decision (2026-09-30), superseding the separate-storage recommendation
above.** Environments are **namespaced within one store**. Results, current heads,
claims, acceptances, accounting and cleanup are all isolated per environment.
Trial work satisfies production only through an explicit, recorded promotion. The
environment is selected per run, never process-wide. External destinations remain
open.

### RUN-018 — Trial adequacy is distinct from execution success

The system MUST NOT claim semantic trial coverage or representativeness merely
because every stage ran or every input was nonempty. The author defines meaningful
trial selection. Optional future coverage assistance must preserve unknowns and
must not silently expand paid work to satisfy inferred goals.

**Validation:** a trial with no staff engineers legitimately produces an empty
leadership input; it can succeed without exercising leadership analysis. A
single-point box plot is execution-successful without proving useful variation.
Automatic economical subset selection is not a prerequisite for trial mode.

## CLI and read-side delivery

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
resource sink must not change execution or retry policy.

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
usage an operator learns while resolving an unknown operation as
`operator:<report>`, so the two can never collide.

### ACC-004 — Resource state is not additive consumption

Remaining quota, reset time, and similar current resource-state observations MUST
remain distinct from consumption increments. Combining observations across quota
pools or windows MUST NOT invent a shared remaining balance. Reporting a reset
time does not itself schedule a retry; Run Supervision applies the chosen policy.

**Validation:** two responses reporting remaining quota are shown as state
observations, not summed as consumed or remaining units. Separate provider/account
pools remain separate without exposing raw credentials as identifiers.

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
| Preview types, coalescing/error lifetime, aggregate loading | Observation boundary with Materialization | RUN-006–RUN-008, CLI-004 |
| Retry/long-deferral ownership and safe external-operation addressing | Run Supervision/adapters with Result History & Publication | RUN-011–RUN-013 |
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
