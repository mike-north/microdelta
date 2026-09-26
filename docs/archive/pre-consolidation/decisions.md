> Historical artifact. Superseded by the [active specification](../../spec/README.md). Do not implement from this document.

# Implementation decisions

These decisions record explicit user confirmations. They amend implementation
assumptions without editing the supplied source documents.

## 2026-09-13 — runtime and array length

The user confirmed:

- **Node.js ≥20** is an acceptable runtime baseline.
- **AsyncLocalStorage** is acceptable for execution frames (TK-2).
- **Array `.length` is a field read** (MT-2). Reading length alone must not create
  a whole-array content dependency.

This unblocks the `track` façade. The length decision will be enforced when
`fingerprint` and `materialize` are implemented; it does not resolve the rest of
OQ2's collection fingerprint contract.

Still unconfirmed: argument-order subjects (TY-2), the pinned-string identity
encoding (WR-7), unnamed `step()` throwing (WR-1), and the numeric lease, polling,
sweep, duration-window, and tracing defaults. The existing ESM scaffold is a
proposed package-format choice; the user did not separately confirm ESM here.

The [design findings](design-findings.md) remain open except where a later entry
explicitly resolves one. No confirmation above selects a publication protocol,
read-address representation, primitive identity carrier, or reclamation policy.

## 2026-09-13 — promise-valued properties are an option, not the selected surface

The user clarified that a tracked property may be a promise. A property getter
can therefore return immediately while its promise resolves storage I/O:
`await pr.createdAt`. This disproves the claimed necessity of explicit `get()` or
`read()` methods; it does not select property promises as the final API.

The user subsequently emphasized deliberate authoring-surface design and asked
to explore code snippets for powerful, approachable options. The exploration
must include individual promised properties, collectively resolved field bags,
and lightweight PromiseLike handles, with allocation behavior assessed rather
than assumed. U5 is corrected as a limitation claim, but the surface remains open.
The materializer must not replay paid bodies to recover from an unloaded property.

Promises do not, by themselves, transport identity through arbitrary primitive
expressions after resolution. That separate U9/U10 provenance question remains
open, as do durable nested-call replay addresses. Array `.length` remains a field
read regardless of whether resolving its value is asynchronous.

No new author-facing root exports are selected by the internal tracking façade
work. Exploratory snippets describe candidates, not implemented package APIs.

## 2026-09-13 — analysis CLI and fan-out failure requirements

The user requires an excellent analysis CLI experience with visible progress,
confidence in cache behavior, and first-class fan-out presentation. Aggregate
counts and cost reporting, such as token spend, should be explored as part of
that experience. Fan-out errors and the dependent fold are now explicit design
topics alongside authoring ergonomics.

The [CLI and failure exploration](exploration/analysis-cli-and-failures.md) records
candidate policies, code snippets, a terminal sketch, and future validation cases.
The user has not selected sibling failure policy, partial-fold semantics, retry
or cancellation behavior, a CLI toolkit, package placement, or accounting storage.
Existing prohibitions on core retries and timer-driven lease renewal still apply.

## 2026-09-15 — streaming observation and blocking computation are both required

The user confirmed that the product must support both behaviors. A viewer must
show results forming throughout a long analysis and update as data arrives. An
expensive calculation must not start a succession of paid executions merely
because its related inputs arrive or update separately, even if obsolete
executions are allowed to finish and their outputs are never made active.

This is not a product-wide choice between streaming and blocking. Different
consumers of the same underlying data need different readiness behavior.
Streaming consumption may expose pending inputs and author-supplied defaults;
blocking consumption needs a defined readiness/consistency boundary before
starting the calculation. The user has not yet selected the syntax, the meaning
of a coherent/fresh input set, or the policy for genuinely new updates after a
paid execution has started. Awaiting all currently available field values alone
does not establish that an upstream update is complete.

The reference/combinator discussion remains an exploration: individual field
awaits and explicit collective selection are compatible candidates. The new
requirement does not by itself approve a particular combinator or step API.

## 2026-09-15 — previews and permission to recompute are independent

The user agreed to the following behavioral distinction during the authoring
discussion:

- A step can expose a preview of its available result without that observation
  authorizing another execution. An invalidated prior result remains explicitly
  distinguishable from a verified result; no prior result means no such preview.
- Calculations that the author permits to run on provisional inputs, such as a
  sum or moving average, may recalculate using currently available inputs and
  update as the analysis progresses. Missing-input handling is explicit rather
  than silently assuming zero or another default.
- A calculation requiring ready inputs must wait before executing. Provisional
  downstream calculations must not trigger upstream paid recalculation merely
  by observing available results.
- Preview/provisional status must not silently satisfy a verified read. A result
  can satisfy that read once the required inputs are verified for the intended
  evaluation and the calculation completes against them.

The user suggested a higher-level author-facing knob because this choice is
usually motivated by time or financial expense. Its name, location, defaults,
and relationship to memoization remain open. This suggestion does not authorize
automatic cost inference or select cost classes as a core mechanism. Reference
await/combinator syntax also remains exploratory; the confirmed behavior can
guide those API exercises without claiming the whole authoring contract settled.

## 2026-09-15 — memoization as the default recomputation policy signal

The user proposed linking the default to the author's existing memoization choice:
unmemoized calculations are treated by the authoring model as cheap to recalculate,
while memoized calculations deserve protection against premature executions,
including API requests and agentic work. This supplies the working default design:

- Unmemoized calculations may recompute previews from provisional inputs by
  default, subject to explicit missing-input handling.
- Memoized calculations may expose available stored previews, but preview demand
  does not execute their bodies. Execution waits for the required ready input set
  through the normal verified-evaluation path.
- Recomputing an unmemoized preview does not recursively authorize execution of
  memoized dependencies. Their previews retain their availability/validity status.

This is an author-facing policy convention, not a runtime measurement or guarantee
that every unmemoized function is cheap or free of effects. The library does not
infer cost from source or provider behavior. The proposed linkage refines the
previous open relationship to memoization without making names or identities
depend on whether a step is stored. Override syntax, exact readiness semantics,
and behavior when genuinely newer inputs arrive during execution remain open.

## 2026-09-15 — GitHub contribution analysis as a product anchor

The user supplied a concrete scenario: live, cheap histograms over an arriving
fan-out of PR/review facts should update throughout a long analysis, while
memoized agentic analysis of an individual's body of work for a review period
waits until all required data is in hand. Intermediate paid executions whose
outputs later become obsolete are explicitly undesirable. Aggregate refreshes
may be throttled to limit database work.

The [product scenario](scenarios/github-contribution-analysis.md) captures the
story, preview and readiness expectations, open implementation details, and
test-first acceptance cases. It anchors both viewer and CLI confidence in visible
progress without coupling observation to expensive execution. Efficient SQLite
aggregation is a workload to evaluate, not a verified capability of the current
storage implementation.

## 2026-09-15 — readiness is scoped to each calculation's dependencies

The user explicitly confirmed that an individual's analysis becomes eligible when
discovery is complete for that person's review period and its required evidence
is verified, even while unrelated organization-wide collection remains underway.
An individual with fewer contributions can finish earlier, including their
agentic analysis.

The same rule composes through team, group-of-teams, and organization roll-ups.
Each agentic calculation waits for its own complete required input set; only
calculations requiring the full organization-wide set wait until the end. There
is no global barrier for all consumers and no framework-hardcoded organization
hierarchy. The [product scenario](scenarios/github-contribution-analysis.md)
includes the corresponding hierarchical readiness acceptance case.

This resolves readiness scope. The mechanism that proves discovery completeness
and the handling of new updates during an already-running calculation remain open.

## 2026-09-15 — a complete corpus is the dependency boundary

The user confirmed the distinction between fulfilling an existing dependency and
changing an input already resolved for an evaluation. Individual PRs discovered
through pagination or other required discovery are part of an unfinished corpus;
their arrival is not a new update that should launch replacement paid analyses.
The fully instantiated result graph need not be known at evaluation start, but
unfinished discovery must prevent premature readiness. The next decision
clarifies that the pipeline structure itself is known upfront.

For the contribution scenario, the person-and-period corpus is a folded-in
concept, represented through dependency composition or an explicit step. It
provides a new verified value only after all required PRs have arrived and the
required discovery is complete. Dependent agentic analysis consumes that complete
corpus. Member-level observations can continue streaming before the corpus is
ready; a prior corpus can remain available as a marked preview, but cannot
satisfy the new evaluation's readiness requirement merely because it exists.

This confirms the semantic publication boundary without selecting a new core
primitive or requiring eager whole-corpus payload loading. Existing content-based
verification still applies: completing verification of unchanged inputs does
not inherently require a new paid execution. Source-specific discovery closure,
the exact API, and handling genuinely subsequent input changes remain to design.

## 2026-09-15 — known pipeline structure, discovered result cardinality

The user explicitly narrowed the model: analysis work and its dependency structure
are stated upfront. Execution discovers result instances, member identities, and
cardinality within that known pipeline. It does not discover novel analysis steps
or previously undeclared analysis structure in the middle of a job. The earlier
discussion of unknown graphs must be read as unknown instantiated cardinality,
not unknown pipeline topology.

For the contribution scenario, fetching members, processing each member, binding
the complete person-period corpus, and consuming that corpus in analysis are
known relationships. The number and identities of PR instances emerge at runtime.
Streaming/preview and complete-value consumption are to be expressed through the
way values are bound. A complete collection binding waits for enumeration closure
and readiness of its required members; a preview binding can expose intermediate
availability. Exact binding syntax remains undecided.

This new user direction takes precedence over readings of rev 9 §2.4–2.7 that
require support for arbitrary dynamically discovered pipeline structure. Preserve
field-level autotracking and observed read fingerprints: knowing the pipeline
does not imply recording every possible field as a dependency. The representation
of upfront structure, any validation/enforcement mechanism, and the treatment of
predeclared conditional paths still need concrete authoring examples. No graph DSL,
compiler, source analysis, or persisted graph has been selected by this decision.

## 2026-09-15 — conventional TypeScript and an obvious happy path

The user explicitly prefers the authoring surface to feel as much like
conventional TypeScript as possible. The happy path should be what a user would
naturally try first. Evaluate ordinary function calls, normal arguments, property
access, and await before requiring a separate binding vocabulary or configuration
graph. This is a design criterion, not approval of the current standalone `bind`
sketch or any other final API.

The next comparison should make normal calls to wrapped step/memo functions the
leading candidate for expressing bindings. Their types must honestly expose lazy
result references rather than pretending ordinary synchronous values were
returned. Upfront composition, inferred signatures, collection completeness, and
preview versus verified consumption still need to work under that syntax.

## 2026-09-15 — pipeline source, live bindings, and durable evidence

The user accepted the storage split: authored TypeScript is the source of truth
for pipeline structure and connections; memory holds live references,
subscriptions, awaits, and bounded active fan-out state; disk holds durable
results and dependency evidence for verification and reuse across restarts.
Rebuild live bindings from the program and reconnect them to stored results;
do not serialize promises/subscriptions or maintain a second independent graph
definition. SQLite remains the planned default durable backend.

The accepted split does not select the corpus membership/completion schema or
claim that persistence alone proves freshness for a new evaluation. Those remain
implementation contracts to specify. The current memory store and tracking
foundation do not yet implement the complete binding runtime or SQLite backend.

## 2026-09-15 — preview envelopes and throttled updates

The user selected latest-available previews: keep the latest available value and
replace it as new values arrive. Expose freshness alongside the value. A preview
returns a value envelope that the consumer explicitly unwraps, not a bare value
that can hide its provisional or stale status. The exact TypeScript discriminants
and freshness representation remain to design; absent data must remain distinct
from a legitimate empty or zero value.

Provide an optional throttle for preview updates. The user explicitly rejected
debounce as the model because continuous arrivals must not indefinitely postpone
delivery: an observer should receive periodic latest-state updates while changes
continue. The implementation contract must bound refresh frequency, avoid
starvation under sustained input, and deliver the final coalesced state after
activity ends. This is observation/presentation policy, not a timer-driven claim
renewal or a readiness heuristic for paid work. Exact interval defaults and
leading/trailing delivery details are engineering choices to document and test.

Freshness shown in the envelope does not allow available old records to count as
verified completion for the current evaluation. Refresh error behavior was
subsequently confirmed in the next entry.

The user also clarified the discussion workflow: when they ask “what's next,”
first check that the current topic's key points are addressed, then move to a
different topic only if it is complete.

## 2026-09-15 — previews support human supervision and expose errors

The user confirmed the proposed refresh-failure behavior: preserve a last
available value with its stale status and the refresh error; if no value exists,
expose unavailable data and the error. Verified reads report failure rather than
silently substituting the stale preview.

The user supplied the product litmus test for preview recommendations: a human
who started a long-running analysis uses previews to see data arriving, understand
what is happening, sanity-check values, and decide whether to stop the analysis,
adjust it, and restart. Surfacing errors is central to this usage, not optional
decoration. Preview design should support that supervision rather than optimizing
only for a smooth display or hiding failures behind a retained value.

This settles the preview behavior decisions discussed so far: latest available
values, explicit freshness envelopes, throttled delivery without waiting for
quiet, and visible refresh failures with prior-value retention. Exact types,
error retention under coalesced updates, observer lifetime, and stop/restart
mechanics still require concrete design and validation; this confirmation does
not silently select a cancellation or retry policy.

## 2026-09-15 — partial failures are expected at analysis scale

The user emphasized that sufficiently large analyses will almost inevitably
encounter some errors. Design previews, progress, and failure reporting for this
normal operating condition, not only a wholly successful graph or one terminal
exception. Preserve successful work and make failed members, coverage, and
blocked dependent results understandable to the supervising human. This principle
does not yet select sibling continuation defaults, partial aggregate acceptance,
automatic retries, or behavior on shared infrastructure failures.

## 2026-09-15 — independent siblings continue after member failure

The user explicitly selected continuing independent fan-out members as the
default. Large fan-outs, such as thousands of API calls over a long-running
analysis, must tolerate isolated intermittent server failures, including failures
associated with upstream service deployments. An isolated member failure must
not abort unrelated work, discard completed results, or force wholesale paid
re-execution.

Preserve successful memoized results under normal retention and verification
rules. Record failed members and expose their downstream impact. Calculations
that require a failed member's verified result remain blocked or fail explicitly;
unrelated calculations can finish. Existing strict complete-input semantics are
not permission to silently omit failures from a final aggregate.

Retry eligibility, limits, timing, operator repair within a run, systemic storage
failures, and final run exit behavior still need decisions. This confirmation does
not imply automatic retries of ambiguously completed paid calls, arbitrary code
hot-reloading, or continued execution when storage correctness cannot be assured.

## 2026-09-15 — explicit outcome folds and repair

The user confirmed that downstream authors may fold all settled outcomes with
statistics about success/failure, or explicitly filter for successful results.
This can produce an updated organization-level summary despite failed members.
Repairing those members later changes the outcome/success collection and must
allow affected aggregates to update under normal verification rules. Unchanged,
unaffected memoized work remains reusable.

This is an explicit input contract, not permission to silently omit failures from
a strict all-success corpus. A complete outcome collection and an all-success
collection are distinct: discovery and the relevant attempts must settle before
an outcome fold treats its set as complete. Coverage, failure counts, membership,
and status changes must remain observable and verifiable; a previously failed
member becoming successful cannot be invisible to a cached success-only fold.
Exact collection types and repair orchestration remain design work.

## 2026-09-15 — retry support must accommodate rate limits

The user explicitly requires retry support, identifying HTTP 429 API responses as
a motivating case. The system must accommodate rate limits during large fan-outs
rather than treating every rate-limit response as an unrecoverable member failure.
Retry policy specifics, defaults, placement, and limits are not yet selected.
This does not authorize indiscriminate replay of an enclosing paid calculation.

Engineering recommendation: provider-aware request policies should honor server
retry/reset guidance, coordinate cooldown for the affected quota scope, expose
rate-limit waiting and retry attempts to observers, and use bounded retries.
Unrelated quota scopes should continue. Preserve the distinction between a
scheduled retry and a terminal failure for fold readiness. Prefer retrying the
appropriate request boundary over repeating earlier successful work in its body.
Core remains responsible for lifecycle correctness rather than provider-specific
HTTP policy; helpers/application adapters can supply the retry behavior.

GitHub's current guidance honors `retry-after`, or the primary quota reset when
remaining quota is zero, with a minimum wait and bounded exponential backoff for
other secondary-limit cases. See [GitHub rate-limit handling guidance](https://docs.github.com/en/rest/using-the-rest-api/best-practices-for-using-the-rest-api#handle-rate-limit-errors-appropriately).
The HTTP 429 standard permits, but does not require, a `Retry-After` header:
[RFC 6585 section 4](https://www.rfc-editor.org/rfc/rfc6585#section-4).

Cooldown/lifecycle integration must be designed before implementation: waiting
must not hold scarce request permits, silently lose claim ownership, fabricate
progress for timer-driven renewal, or cause a second worker to duplicate the
attempt. A retrying request inside a body and a new durable step attempt are
different operations; the final contract must specify which is being requested.

## 2026-09-15 — unattended runs and long quota waits

The user requires an unattended usage pattern: start a long analysis before bed
and allow it to continue making progress overnight despite recoverable failures
or usage-window limits. Retry policies must accommodate provider subscription or
token quota windows that may require waiting hours, not only short backoff.
Automatic recovery support is required; an operator must not need to intervene
for every recognized, recoverable quota limit.

Affected work should remain visibly waiting for retry/reset rather than become
a terminal failure solely because a known reset is distant. Independent work
that does not use the exhausted resource should continue. When the policy permits
resumption, the affected work resumes automatically. An exhausted run can be
honestly idle until a reset, but must not be silently stopped or falsely report
active execution. Unknown reset times, permanent errors, retry deadlines, and
overall run limits need explicit policy rather than an unconditional success or
infinite-retry promise. The user's five-hour-window example is a motivating
provider scenario, not a claim that every LLM API exposes that quota scheme.

Engineering recommendation: distinguish short transient-failure retry from
scheduled quota deferral, support provider-advised resume times, and coordinate
the affected quota scope. Do not burn a retry budget by repeatedly probing a
known exhausted window. Record the waiting reason, next eligible time where known,
and attempt history for human supervision. Persisting deferred work would support
recovery after a process restart; that durability and the exact claim/queue state
transition require a design before implementation. Do not fabricate progress or
renew active claims on a timer simply to cover hours of inactivity. This adds
recovery requirements without selecting a new core scheduler or overriding the
existing no-hidden-core-retry boundary.

## 2026-09-15 — idempotency for uncertain external mutations

The user explicitly requires idempotency support: a failed request or lost
response may leave the caller unable to tell whether an external write occurred.
Retry support must accommodate provider idempotency keys so a repeat attempt
does not accidentally perform the same intended mutation twice.

Recommended contract to specify and test:

- Associate a key with the logical external operation, not an individual network
  attempt. Retries of that operation use the same key and equivalent request
  parameters. A deliberately new mutation needs a distinct operation identity.
- Establish and persist the operation identity/key and its request binding before
  sending the first potentially mutating request, so recovery can reuse them.
  Raw credentials must not be stored as part of that request binding.
- A result subject alone is insufficient: one step may make several external
  calls, and reevaluation may intentionally change the request. Define stable
  operation addressing within the step and avoid accidental reliance on volatile
  attempt IDs or reordered call positions.
- Separate network-attempt history from logical-operation identity. A timeout is
  not proof of no mutation; represent ambiguous outcomes honestly.
- Respect the provider's supported endpoints, key scope, request-matching rules,
  retention window, and replay behavior. The framework cannot manufacture remote
  idempotency for a provider that does not implement it, nor guarantee safety once
  its deduplication window expires.
- Do not automatically replay an ambiguous non-idempotent write without an
  explicit recovery policy. This requirement does not select general provider
  reconciliation machinery or promise universal exactly-once execution.

These are engineering recommendations implementing the confirmed need, not a
selected operation API or completed persistence mechanism. As one concrete
provider example, Stripe replays stored responses for a reused key, checks request
parameters, and permits key pruning after its documented retention period:
[Stripe idempotent requests](https://docs.stripe.com/api/idempotent_requests).
Adapters must use the actual provider's contract rather than assume all APIs
share that behavior.

## 2026-09-15 — retries are part of tracing

The user explicitly requires retries to be incorporated into tracing. Correlate
request attempts with their logical operation, enclosing step, fan-out member,
and run. Retry attempts are execution history within the declared pipeline, not
new dynamically introduced analysis structure.

The trace should distinguish an attempt failing, a retry being scheduled, waiting
for a quota/reset, an actual retry beginning, and the final success, exhausted
policy, cancellation, or unresolved outcome. Include attempt number, reason,
timing, scheduled eligibility where known, and reported usage/cost. A scheduled
retry is not another completed request, and a transient failed attempt is not
necessarily terminal member failure. Preserve both request-attempt and durable
step-attempt identifiers where they differ, rather than calling both a retry
without showing the boundary.

Idempotency correlation must remain stable across related attempts, without
exposing credentials or sensitive request bodies. Aggregate spend counts each
reported charge once; reusing an idempotency key alone does not prove a request
was billed or unbilled. Trace/CLI roll-ups must avoid double-counting parent spans
and their child attempt costs. Tracing observes retries; attaching a trace sink
does not initiate retries or change execution policy.

Acceptance cases: one transient failure then success; a long quota wait followed
by resume; exhausted retries with continuing siblings; and a lost response
followed by an idempotent retry. Assert parent/attempt correlation, event ordering,
visible waits, final member status, and non-duplicated cost aggregation. Exact
event schema and durability remain implementation design work.

## 2026-09-15 — cancellation must leave room to avoid further spending

The user requested careful investigation of stopping expensive LLM work and
preserving optionality for cooperative cancellation. The motivating case is an
operator discovering a mistake in a prompt while a multi-minute agent turn is
running: stopping avoidable work can be valuable even when the unfinished step
will yield no reusable result. No default stop policy or cancellation API has
been selected.

The memoized step remains the durable result boundary. Finishing one of three
requests inside a body does not produce a reusable step result. An earlier
recommendation to drain requests and resume later incorrectly assumed request
checkpointing; that is not an accepted capability. Draining complete active steps
was then proposed, but the user raised the cost-saving case before approving it.

The researched recommendation is to offer both finishing active steps and
cancelling avoidable work promptly. An AbortSignal-style mechanism can convey
intent to participating bodies and adapters, but local abort is not universally
remote cancellation. Stop future participating calls/retries and use documented
provider cancellation where supported; report uncertainty and preserve observed
costs without treating partial outputs as complete values. These are design
recommendations, not implemented behavior.

See [cancellation and billing research](exploration/cancellation-and-billing.md)
for current primary-source evidence, proposed acceptance cases, and unresolved
lifecycle decisions. The study did not measure actual charges or establish a
universal cancellation billing cutoff.

## 2026-09-15 — cancellation support and escalating operator intent

The user endorsed stopping avoidable work even when an unfinished step cannot
be cached, and expects provider support for money-saving cancellation to improve.
That expectation is a design motivation, not a verified forecast or a guarantee
about any provider. The higher the cost of the analysis, the more important it
is to avoid continuing work the operator already knows is unwanted.

Cancellation support is therefore a requirement, with room for adapters to use
stronger remote cancellation capabilities as they become available. Preserve the
distinction between intent, local stopping, and confirmed remote cancellation;
do not make today's weakest provider behavior the ceiling for the design.

The user proposed an escalating CLI interaction: the first Ctrl+C requests a soft
stop; the second requests a more forceful shutdown that aborts everything it can.
This establishes the desired interaction, but does not yet specify whether soft
stop drains entire active steps or only current requests, its wait deadline, or
the precise cleanup/exit behavior of escalation. Do not silently equate the
first interrupt with a previously proposed drain policy. These lifecycle details
remain to be specified; the user requested moving to the next design topic.

## 2026-09-15 — real execution on a narrow scope before widening fan-out

The user described their existing validation workflow: restrict an organization
analysis to one team, perhaps five or six people, and execute the real pipeline
end to end. Inspect output quality and actual costs, correct mistakes while
their impact is small, and only then widen fan-out to the full organization.
Prioritize supporting this workflow for confidence before an expensive run.
The user suggested it may serve this need better than a dry run; this does not
remove explanation or estimation capabilities from scope.

The important control is selection of workload, not merely lower concurrency.
The selected subset should traverse the real pipeline, including downstream
aggregation, so the operator can evaluate the actual experience. Exact filtering
syntax, placement, and whether the framework supplies a dedicated facility are
still open.

Engineering recommendations for the authoring exploration:

- Make the selected scope visible in results and supervision. A verified result
  for one selected team is complete for that scope, not a complete organization
  analysis. Intentional exclusion is distinct from missing or failed work.
- Apply selection before excluded members start expensive work. Preserve the
  distinction between limiting people and truncating each selected person's
  corpus: the latter changes their analysis inputs and meaning.
- Widening scope should reuse completed member results when their identities,
  consumed inputs, and applicable computation versions remain valid. Aggregates
  must track their actual membership and verify/recompute when it changes. Scope
  must affect identity or dependencies wherever it changes the result, without
  gratuitously invalidating otherwise independent member computations.
- Report actual pilot usage and coverage. Any extrapolation to the organization
  remains an estimate with explicit assumptions; one team need not represent
  other teams' corpus sizes or costs.

Acceptance scenarios to specify before implementation: run a selected team
through every stage with no excluded member's expensive work admitted; rerun it
unchanged; change a prompt and verify affected invalidation; widen scope and
reuse still-valid member work while updating aggregate membership; ensure a
selected-team result cannot satisfy a full-organization request as complete.
These are proposed checks, not claims of implemented behavior or passing tests.

## 2026-09-15 — execution plans paired with limited fan-out

The user explicitly wants an execution-plan view, analogous to database query
planning, combined with the ability to execute a limited workload. The plan
shows what will execute; the scoped real run supplies evidence about result
quality and cost. This replaces an exact simulated dry run as the primary framing
for this workflow, without claiming that all future values or cardinalities can
be predicted.

Recommended plan contents: declared stages and dependencies, selected scope and
filters, fan-out boundaries, known cardinalities or symbolic unknowns, and
evidence-backed reuse/recompute explanations. Distinguish declared structure
from instantiated work and validated cache decisions from decisions conditional
on upstream results or validation. A stored result's existence alone is not proof
of current reusability. Showing a plan does not by itself authorize paid analysis
execution; permitted discovery and validation during planning remain to specify.

After scoped execution, compare the plan with observed member counts, reuse,
executions, timing, and reported costs. This comparison is an engineering
recommendation inspired by the query-plan analogy, not selected command syntax.
Tests should ensure unknown cardinality is labeled, filters precede excluded
expensive work, and a plan neither promises exact future spend nor describes a
conditional downstream execution as certain. Existing source requirements for
exact rerun/cost prediction need reconciliation with this selected framing.

## 2026-09-15 — choose a small workload for meaningful coverage

The user confirmed that a selected team with no staff engineers may legitimately
produce an empty collection/value and uninteresting leadership-analysis results.
This is a coverage gap in the trial, not necessarily an execution failure. The
plan should distinguish running a stage on empty input from exercising its
substantive behavior with matching data.

The user wants to explore a smarter subset selection than manually picking one
team: use knowledge of the plan to obtain exposure to the important analysis
cases at low cost. Treat this as a desired planning capability; no selection
algorithm, annotation API, or optimal-cost guarantee is selected.

Engineering recommendation: combine declared plan structure, available input
metadata, and explicit author/operator coverage goals. Structure alone cannot
reveal arbitrary semantic categories in opaque functions or predict categories
only discovered by expensive analysis. A goal such as including staff engineers
needs an available role field or a declared predicate; otherwise label its
coverage unknown until discovery/execution supplies evidence.

Recommend a small scope with an explanation of each inclusion, covered goals,
uncovered or unknown goals, and estimated cost with its basis. Preserve complete
inputs for selected units unless the operator explicitly chooses a different
analysis scope: selecting people is distinct from truncating their PR histories.
Grouping requirements may mean selecting whole teams instead of independent
people. Selection should be inspectable and overridable, and observed execution
should update coverage rather than imply that the proposed subset guarantees it.

For example, a proposed trial might include a small team containing a staff
engineer to exercise both individual and leadership analyses. If several inputs
are required for a meaningful aggregate, the selection must respect that
requirement instead of merely ensuring one nonempty value at each stage. Low
estimated cost is an optimization objective, not proof of the cheapest possible
trial or a representative sample for organization-wide conclusions.

Future acceptance cases: a one-team selection lacks staff engineers and exposes
that gap; metadata supports a proposed alternative that covers the role; missing
metadata leaves coverage unknown; a group-level goal requires multiple members;
actual execution can revise a prediction; selection preserves complete required
corpora and admits no excluded expensive member work. Placement of coverage
declarations and planning-time discovery permissions remain open.

## 2026-09-15 — authors define meaningful trial coverage

The user clarified that meaningful coverage requires author knowledge. A box
plot receiving one data point may execute but does not adequately exercise the
intended visualization. Neither reaching every stage nor supplying one nonempty
input to each stage is a sufficient generic criterion for a useful trial.

Author-defined adequacy criteria are therefore the basis for assisted subset
selection. The framework may help find an economical scope satisfying those
criteria and report observed satisfaction, but must not infer semantic adequacy
from topology alone. Criteria might concern member counts per group, category
coverage, or properties of produced values; these are illustrative possibilities,
not a selected declaration syntax or universal statistical threshold.

Distinguish criteria that available metadata can establish before execution from
those requiring actual downstream outputs. The latter remain unverified until
execution supplies evidence. Do not manufacture variation, independently sample
away required corpus inputs, or silently expand paid work to satisfy an unmet
criterion. Selection/execution policy and authoring ergonomics remain open.

Acceptance example: a single-point box-plot input can be execution-successful
while failing its author's trial criterion. A larger selection does not satisfy
a declared variation criterion merely because it meets a count threshold. Report
these separately from execution errors and from statistical representativeness.

## 2026-09-15 — first-class, author-defined trial mode

The user selected a first-class trial mode. Give analysis authors tools to encode
their own trial-only filters, selections, and limits in the program, and honor
those choices during real execution. The author defines what trial means; the
framework does not need to infer meaningful coverage or optimize a sample.
Earlier assisted-selection and coverage-criteria ideas remain optional future
exploration, not prerequisites for this feature.

Examples supplied by the user include choosing employees whose last names start
with A, or deliberately selecting two staff engineers, one designer, and two
product managers. These are examples of author logic, not prescribed sampling
rules or a selected constraint language. The feature must accommodate more than
a global maximum item count.

The purpose is cheap, repeatable iteration on the real analysis: enter trial
mode, inspect output and costs, edit, run again, and return to trial mode during
later development. Provide a clear, durable place in the program for trial
behavior so authors need not create temporary CSVs or hunt for ad hoc array
truncations. The exact authoring API and arrangement of trial policies remain
to be designed. Trial mode complements execution-plan inspection.

The user also proposed an independent trial cache, comparing this to development
or staging, and emphasized preserving valuable full-analysis data (an $8,000
analysis as the motivating example). Protection of that data is required; the
cache mechanism is proposed rather than finalized. Engineering recommendation:
default to a separate trial storage environment for reads and writes, including
results, indexes/heads, claims, and cleanup, with reuse across repeated trial
runs. Do not merely label trial results while sharing mutable production state.
Exact store routing, external output destinations, retention, and any deliberate
import or promotion workflow remain open.

This isolation proposal qualifies earlier recommendations to reuse trial work
when widening scope: within a trial environment, ordinary validity rules still
permit reuse; crossing into production must not imply automatic cache sharing
or promotion. Separate cache storage also does not itself isolate external
side effects. How authors configure trial-specific output destinations or other
external resources needs an explicit contract where applicable.

Acceptance cases to specify before implementation: author trial filters apply
before excluded expensive work is admitted; ordinary mode does not apply those
trial-only filters; repeated trials reuse still-valid trial results; altered
trial membership invalidates affected aggregates; mode propagates through nested
work and recovery; concurrent trial and production execution do not share claims
or mutable result state under the isolation proposal; clearing trial storage
cannot delete production results. A trial remains an actual paid execution where
providers charge for work, not a simulated or guaranteed-free run.

## 2026-09-15 — analysis context carries the execution environment

The user proposed an object called analysis context that flows through the
analysis, analogous to request context in an application API, and exposes the
current environment. This is the selected direction for making environment
available to author-defined trial behavior throughout execution. The examples
of session data and API-key authorization explain the analogy; they do not
establish requirements for an authentication system or credential-bearing cache
records.

Engineering recommendations for the concrete authoring design:

- Establish the environment at the run entry point, before choosing storage or
  admitting work. Nested steps, fan-out tasks, and retries inherit it. Keep that
  environment stable throughout an invocation; switching environments starts a
  separately configured invocation rather than mutating active work.
- Select the storage environment consistently with this context. An environment
  field alone does not isolate caches, claims, or outputs. Concurrent trial and
  production runs must not read each other's context or use a mutable process
  global to determine routing.
- Runtime metadata and computation inputs need distinct cache semantics. An
  environment selects the proposed storage boundary; other context values that
  affect outputs must participate in dependency/identity validation as specified.
  Run IDs, trace identifiers, and cancellation signals should not automatically
  invalidate every result merely because the enclosing context object is new.
- Define explicit reconstruction across process/recovery boundaries; an in-memory
  context mechanism alone does not durably preserve environment selection.

Still open: exact type and accessor names, explicit parameter versus scoped
access (or a combination), built-in versus custom environment values, extension
fields, and how output-affecting context reads participate in memoization.
Cancellation and tracing are plausible related context facilities, not yet
selected members. The object name does not finalize a public export.

Acceptance cases: nested asynchronous work observes the selected environment;
concurrent runs remain isolated; retries retain the environment; recovery uses
the recorded environment or fails clearly if it cannot reconstruct it; trial
storage routing agrees with the context; differing output-affecting configuration
cannot reuse an incompatible memoized result.

## 2026-09-15 — request-context analogy and environment credentials

The user clarified that application session/authentication data was solely an
analogy for context propagation. There is no analysis authentication feature
under discussion. Environment is the first concrete need motivating an analysis
context; do not repeatedly reopen authentication as a separate design topic.

An environment may have provider credentials, potentially supplied through a
`.env` file, for requests the analysis makes. This is environment-specific
configuration, not a selected credential-loading API or a requirement to place
raw secrets on the public context object. Exact configuration loading and file
selection remain open. Any eventual implementation should keep credentials out
of persisted result/plan/trace data and avoid cross-run configuration leakage.

## 2026-09-15 — resource-agnostic execution accounting

The user requires running execution metadata that aggregates from step execution
to the analysis job, without hardcoding the mechanism to money. Motivating
quantities include REST API quota consumption, GraphQL nodes/edges retrieved or
provider-reported quota units, LLM tokens and monetary cost, and metered data
retrieval. Budgeting and efficiency concerns apply to each resource; the core
aggregation mechanism should not depend on which resource is being counted.
Provider-specific conversions (such as nodes to quota charge or tokens to
currency) are not universal equivalences and must not be inferred by the core.

Engineering recommendation: report named additive quantities with defined units
and applicable resource scope, attributed to the executing attempt. Roll them up
through step/fan-out/run views without counting both parent totals and their
constituent child reports. Keep currencies, units, and independently limited
provider/account quota pools distinct. Scope identifiers need not expose secrets.
Authors and adapters can supply quantities; built-in displays may understand
common ones without making those the only supported metrics.

Execution accounting is independent of successful result publication. Reported
consumption from failed, cancelled, or retried work still belongs in execution
totals; historical quantities associated with cached results are not newly
consumed resources. Missing final observations remain unknown. Reporting should
be possible during execution, not solely when a step returns; exact persistence,
crash recovery, attribution, and duplicate-report handling remain to specify.

Additive consumption and current resource state are different: quota consumed
can be summed within its defined scope, whereas remaining quota and reset times
are observations, not increments to sum across steps. Keep such observations
separate rather than introducing an arbitrary aggregation framework by default.
Likewise distinguish delta reports from cumulative snapshots so repeated updates
do not inflate totals. Neither reporting metadata nor displaying its roll-up
alone enforces a budget, schedules work, or grants retry permission.

Exact schema, registration/API syntax, supported numeric representation,
context access, quota-window identity, and enforcement policy remain open.
Acceptance examples: sum request consumption across sibling steps; preserve
consumption after a failed third request; avoid double-counting cumulative usage
or parent/child views; distinguish separate provider quota pools and currencies;
show remaining-quota observations without adding them; reuse a cached result
without charging its historical execution metrics again.

## 2026-09-15 — accounting covers observed usage, not a reconstructed bill

The user explicitly bounded accounting to resource consumption for which the
analysis has supporting observations. A third-party operation can fail while
still incurring charges, and the caller may receive no usage report. Discovering
those charges might require a separate provider reporting/accounting API; building
that reconciliation machinery is not required by this accounting feature.

Aggregate the quantities actually reported or otherwise supported by available
evidence. Describe monetary totals as observed/reported spend rather than a
guaranteed final bill, and apply the same boundary to other resource quantities.
No observation contributes no numeric increment; it is not evidence of zero
actual consumption. Where missing/partial reporting is known, retain that fact
without guessing a charge or requiring recovery of the missing value.

This narrows earlier language about preserving failed-attempt consumption:
preserve observations that were received, including those from failed work; do
not promise that every failed/cancelled request can report its consumption.
Accounting does not require provider billing integrations, invoice matching,
or exhaustive charge discovery. Any future optional reconciliation would be a
separate capability, not a prerequisite for useful observed totals.

Acceptance example: one request reports 100 units and another fails without
usage data. Show 100 observed units, with the known reporting gap; do not show
100 as guaranteed total consumption, fabricate the second request's usage, or
block the analysis waiting for a third-party accounting lookup.

## 2026-09-15 — observed resource counts versus estimated currency

The user supplied a concrete accounting scenario: an LLM API may report input
and output tokens without a cached-input breakdown, while its billing charges
cached input at a lower rate. Converting all input at the normal rate can be
substantially wrong even when the token observations themselves are accurate.
This is a user-provided design case, not a verified provider-specific assertion.

Keep observed quantities separate from derived monetary estimates. Missing cached
input is unknown, not zero. A pricing conversion with incomplete billing inputs
must be labeled as an estimate with its assumptions; it must not appear as
observed spend merely because it was calculated from observed tokens. Reporting
tokens without a monetary value is a valid outcome, and no billing integration
is required to complete it. See the [scenario](scenarios/observed-usage-and-estimated-cost.md)
for expected behavior and a future acceptance case.

## 2026-09-15 — justify exposed concepts and reveal complexity gradually

The user requested two concrete authoring options with simplicity and familiar
TypeScript as governing criteria. Every exposed concept must justify its cognitive
cost. Simple usage should stay simple, with advanced facilities introduced only
when needed. This strengthens the earlier conventional-TypeScript criterion;
it does not authorize choosing an API without the comparison.

The [concrete authoring comparison](exploration/concrete-authoring-options.md)
holds pipeline semantics constant and compares scoped context access with an
opt-in explicit context parameter. It includes full TypeScript examples, a shared
launch flow, test-first type probes, a concept-by-concept justification, and
explicit remaining runtime contracts. Scoped access is the recommendation for
discussion, not a user-approved export. The examples do not implement core or
claim runtime validation.

## 2026-09-15 — scoped analysis context selected

After hearing the completed authoring comparison, the user explicitly selected
scoped context and agreed to a test-first implementation plan. Adopt the scoped
access direction for the primary authoring path. Context-dependent bodies obtain
the current analysis context without requiring it as a parameter through ordinary
step calls or helper chains. Preserve isolated asynchronous execution scopes.

This approves the context-access direction, not every experimental declaration in
the example files. Exact reference/collection APIs, durable reporting, storage
isolation mechanics, and stop escalation semantics still need their recorded
contracts. The explicit-context option remains comparative material rather than
a second selected public interface.

The [scoped-context implementation plan](scoped-context-implementation-plan.md)
sets out tests before implementation, the proposed private context leaf, the
remaining core sequencing gates, and later helper/CLI acceptance. Preparing the
plan does not itself implement these capabilities or select defaults by silence.

## 2026-09-16 — required author-supplied memoized-step identity function

The user proposed supplying an identity-returning function in the analysis step
definition, then clarified that the required callback applies to every memoized
step. The earlier phrase "every step" must not be treated as a decision to require
it on non-memoized steps. There is no implicit identity default for memoized steps.
The user's rationale is that a general default cannot reliably infer the stable
logical identity appropriate to the analysis.

Engineering recommendation in response to the user's question: do not require
an identity callback on non-memoized steps. Their names/bindings identify declared
work for planning, and execution IDs distinguish invocations for tracing; neither
is a substitute for a memoized result's durable semantic identity. Continue to
track values/fields and membership consumed by downstream memoized calculations.
If a non-memoized calculation produces a collection used in fan-out, stable member
keys still need a contract at that collection boundary. This does not imply a
mandatory result-identity callback on every non-memoized calculation. Durable
binding/reconstruction semantics remain to specify independently.

The exact callback signature and identity value format remain open. Define its
access to inputs, execution/readiness timing, namespace, relation to step name and
revision, and collision behavior before implementation. In particular, selecting
a required callback does not select content hashing, index-derived identities,
or unrestricted side effects in identity calculation. Recommend an inexpensive,
deterministic calculation over explicit identity inputs, available before cache
lookup or execution admission.

This changes the earlier authoring examples: their memo wrappers omit this
required callback and therefore no longer represent the complete selected memo
definition shape. Preserve them as context-access comparisons until identity is
incorporated into the next concrete API exercise. Source enumeration keys,
fan-out occurrence keys, and step-result identity may have related roles, but
their relationship is not settled merely by this decision.

Future acceptance cases: a memoized step definition without its identity function
is rejected; a non-memoized step can be declared without that callback under the
recommended contract; a stable logical member retains identity across array reorder or
trial selection changes when the author's function returns the same identity;
content changes under the same identity still undergo normal dependency
verification; identity collisions have defined diagnostics rather than silently
overwriting results. Callback output and namespacing need a concrete contract
before those tests can be implemented.

## 2026-09-16 — HR roster, nested PR fan-out, and per-person fold

The user selected a concrete next authoring exercise: an internal HR organization
ID feeds a memoized CSV roster fetch; parse the roster and fan out over people;
use each person's GitHub username to retrieve paginated PRs for a period; analyze
each PR with an LLM complexity prompt as its evidence becomes available, returning
structured output. Finally, fold the PR summaries and complexity assessments into
one IC-level summary per roster row. This collapses the inner PR fan-out while
preserving the outer person fan-out.

The [scenario and acceptance inventory](scenarios/hr-roster-pr-complexity.md)
records this workflow. Per-PR readiness and final person-summary readiness have
different scopes: complete evidence for one PR versus closed discovery and the
required assessment set for one person. Unrelated people need not wait for each
other. Recommend a strict final person-summary example, with any partial policy
expressed explicitly rather than inferred from a missing member.

Page-level memoization plus a declared pagination helper is the engineering
recommendation to explore. It is not yet selected over one whole-person fetch,
and does not authorize arbitrary resumable JavaScript. Required identity callbacks,
source freshness, cursor validity, duplicate membership, and recovery across pages
must be visible in the next concrete API example. No HR/GitHub endpoint, provider
pricing, exact CSV schema, complexity rubric, or pagination interface is selected
by this scenario.

## 2026-09-16 — changing pages and explicit cache control

The user challenged page-level memoization when new records change page boundaries,
and proposed a lower-level API allowing the analysis author to use the memoized
cache explicitly according to the source's semantics. The precise API is still
under exploration; do not treat page caching or a universal pagination helper as
selected behavior.

Revise the earlier engineering recommendation: a page number, cursor, or local
enumeration ID alone does not justify reusing a page against a changing source.
Mixed old/new pages can miss or duplicate records; deduplication cannot recover
omitted members. Separate current membership discovery from reuse of completed
per-record analysis. Reuse requires appropriate source/version validation and
ordinary dependency checks, not merely a matching PR ID. The person-level fold
also depends on refreshed membership.

Explore page reuse only where a provider/source contract actually establishes
its validity, such as an appropriate stable snapshot. Author-controlled cache
operations must preserve local environment, dependency, claim, and publication
invariants rather than exposing unchecked store writes. The [expanded scenario](scenarios/hr-roster-pr-complexity.md)
includes the page-shift counterexample and a corresponding acceptance case.

## 2026-09-16 — cache PR hydration using an explicit content-version key

The user clarified the intended optimization: repeat relatively inexpensive PR
search/discovery, then reuse expensive individual PR point reads (hydration).
This is distinct from caching only the subsequent LLM assessment. Their suggestion
that hydration could account for 95 percent of this phase's requests is an
illustrative workload estimate, not a measured performance claim.

The user proposed the PR URL plus its branch head-commit SHA as the point-read
identity. Use this as the next concrete identity candidate. It separates PR
versions despite changing page membership, but the hydrated payload and validity
contract must be explicit. It is not automatically a version of every PR field.

GitHub's update endpoint permits title, body, and base-branch changes separately
from the head commit; see [official PR documentation](https://docs.github.com/en/rest/pulls/pulls#update-a-pull-request).
Thus, inferring that unchanged head SHA means all PR metadata is unchanged would
be unsound. Define whether the cached value is head-version code evidence, a diff
against a particular base, or a broader PR snapshot. Other consumed fields may
need separate freshness/version handling, or an explicit author-chosen staleness
policy. A code comparison also needs its comparison-base semantics defined.

The adapter must obtain the target SHA before lookup and ensure hydration matches
the requested version; do not label a response for a newer head with an older
head's key. How discovery supplies this metadata, URL normalization, and callback
output encoding remain to design. Prompt and model configuration remain semantic
inputs of the downstream assessment, not properties of the PR hydration key.

## 2026-09-16 — distinguish logical identity from content/version validation

The user questioned whether the URL-plus-head and selected-field checksum
discussion was conflating PR identity with a content key. The governing design
already distinguishes stable identity from per-field content fingerprints
(Rev 9 sections 2.1 and 2.3–2.4). Preserve that distinction while incorporating
the newly required author-supplied memo identity callback.

Engineering clarification: a PR's logical identity can be its canonical URL or
provider ID; its head SHA identifies a code revision; fingerprints of consumed
fields determine whether relevant content changed. Putting URL plus head in an
identity callback intentionally names a PR-version artifact, rather than the
same logical PR across revisions. Hashing all or selected fields into identity
similarly chooses a content-addressed artifact; it is not equivalent to ordinary
content verification under a stable subject and its retained generations.

Recommended default framing for the next example: the author supplies logical
identity; the library tracks/compares consumed input content. A hydration step
can have a stable PR subject and consume an explicit discovered source version
to decide whether it must fetch a new generation. That version must actually be
a recorded dependency, not an unused argument. It validates only the payload
covered by its source contract. Mutable fields not covered by that token require
additional evidence/policy; the library cannot discover unseen remote changes by
fingerprinting its own stale cached copy.

The exact choice between a stable PR subject and an explicitly versioned artifact
is not selected by this clarification. Nor is a separate callback/API for remote
freshness selected. Do not silently treat a required identity function as also
being a required author-written checksum or universal cache-validity function.

## 2026-09-16 — PR URL identity and remote source validation

The user clarified the intended PR identity as its URL, keeping head commit,
title, description, and other consumed content separate. The author should not
manually reproduce the library's field-sensitive content invalidation. The new
question is how fresh discovery can establish whether a cached PR point read is
still usable without fetching its full contents—an ETag-like source validation
problem, distinct from identity and local dependency verification.

Engineering recommendation: source/adaptor validation establishes current input
evidence; ordinary microdelta fingerprint verification then determines downstream
reuse. If fresh discovery supplies a trustworthy version covering the exact
cached payload, comparing it may avoid a point request. Otherwise revalidate
with the provider, or explicitly accept a source-specific staleness policy.
No key or hash of a local cached copy can reveal an unseen remote change.

GitHub documents conditional GETs using a saved ETag/If-None-Match, returning
304 for an unchanged representation. A properly authorized 304 does not consume
the primary rate limit. This still makes an HTTP request, and does not promise
zero latency or exemption from every resource limit. See [GitHub conditional-request guidance](https://docs.github.com/en/rest/using-the-rest-api/best-practices-for-using-the-rest-api#use-conditional-requests).
Endpoint/representation support must be verified for the chosen adapter; a PR
response validator is not automatically a validator for every linked resource.

The source-validation path must actually run when required by the chosen policy;
placing a conditional GET inside a memo body that is indefinitely served by URL
alone would never perform that validation. Exact low-level cache/source hooks
remain open. Treat validation failure as unknown freshness or error, not proof
that the cached value is unchanged. Compare refreshed fields so a remote change
to an unread field need not trigger another downstream LLM call.

## 2026-09-16 — author-defined source finality from cached data

The user requires the ability to express their real-world policy: once a PR has
been observed as merged, the cached data can be treated as final for this
analysis, and no further point-read revalidation or hydration is needed. They
explicitly accept that title/description may subsequently change and do not want
those changes considered for this purpose. This is an author-defined input
contract, not a claim that the remote PR becomes physically immutable.

Local cached state can therefore authorize indefinite reuse under the selected
policy. Do not require an ETag, HEAD, or other network probe merely to justify
reuse when the author's finality rule already accepts the cached value. The
framework must support this policy rather than forcing generic remote-freshness
rules or treating the accepted snapshot as an invalid result forever.

The related user scenario allows a sequence of progressively more expensive
checks: inspect local state first; if needed, fetch limited metadata; compare
relevant version information; then fetch additional evidence only when needed.
Exact HTTP methods, endpoint support, costs, and the validity of particular
comparison tokens are adapter-specific and have not been selected here.

Recommended source-control contract: an author can inspect prior cached data and
explicitly choose reuse, additional validation, or refresh. Exact API syntax is
open. Finality applies to the accepted source snapshot, not to every downstream
calculation: changing an assessment prompt or implementation revision can still
require new analysis of that same retained input. Identity stays the PR URL;
dependency fingerprints remain the library's responsibility. Deliberately
changing the source-acceptance policy must have an explicit revision/override
path, rather than silently preserving a formerly final decision forever.

Acceptance cases: cached merged PR performs zero source-network requests on
rerun; unchanged accepted evidence permits ordinary downstream reuse; changed
prompt can rerun assessment without refetching the merged PR; non-final PR can
perform cheap checks and short-circuit before expensive hydration; no cached
value follows the initial fetch path; observation of merge leads to the
author-selected final snapshot. Define that last transition explicitly without
assuming the library must force one extra full fetch or finalize an incomplete
payload. The policy author determines the accepted snapshot and required data.

## 2026-09-16 — class-based definitions and optional override exploration

The user proposed allowing authors to define steps as classes, potentially using
an abstract base class with a required identity-returning method and optional
overrides for finality or whether an update should happen. They cited React class
components' `shouldComponentUpdate` as an analogy for discoverable optional
behavior, not a request to adopt React or reproduce its lifecycle semantics.
Optional method overrides are explicitly attractive as a gradual-reveal technique.

Explore a class-based memoized step definition against the function-based
candidate. Required identity remains specific to memoized steps; do not silently
extend it back to every non-memoized calculation. A concrete calculation also
needs an execution method/body. The final class hierarchy, method names, invocation
syntax, hook defaults, and whether class definitions replace or complement
functions are not yet selected. Scoped analysis context remains the selected
context-access direction.

The comparison should test a minimal memoized class first, then add only the
optional source-policy method for the cached-merged-PR case. Assess whether
required abstract methods and editor-visible overrides reduce cognitive burden
enough to justify generic parameters, instances, and the distinction between
defining execution and invoking a managed binding. No builder framework or
second public authoring style is automatically approved by this exploration.

The update/finality hook needs a precise contract before coding: when it runs,
what prior value and current inputs it receives, whether it may await cheap
provider checks, what omitted/true/false mean, and how failures are reported.
Do not conflate accepting a source snapshot with disabling automatic downstream
dependency verification. The merged-PR rule can reuse source data while a changed
prompt still invalidates a downstream assessment. Cold misses, incomplete prior
attempts, changed definition revisions, cancellation, concurrency, and source-policy
changes require explicit behavior. A class shape alone does not settle those rules.

## 2026-09-16 — structured step definitions and discovery/retrieval boundaries

The user clarified that classes and interfaces with callback fields can both
express the intended design. The essential direction is an object-oriented step
definition that groups execution, identity for memoized work, and optional
finality/update behavior. Class inheritance is not itself the requirement. This
refines the preceding class-versus-function comparison: explore the cohesive
definition and lifecycle first, then choose its TypeScript expression. Optional
behavior should remain progressively discoverable; multiple work phases are a
case to investigate, not yet a requirement for a generic lifecycle framework.

Recommended decomposition for the concrete PR workload (not yet a selected API):

- Discovery enumerates PR references for a person/query/time range and establishes
  membership and traversal completion. Repeat it under the author's source policy;
  do not assume pages are durably reusable.
- Retrieval accepts one PR reference and produces the accepted evidence snapshot.
  Its memoized identity is the PR URL. Its source policy can inspect prior data,
  accept a merged PR as final, or perform progressively more expensive checks.
- Assessment consumes that snapshot and the analysis inputs. Its dependency
  verification remains separate from source acceptance.

Discovery and retrieval have different cardinalities, outputs, reuse policies,
and completion conditions, so recommend separate managed operations even if a
convenience composition exposes them together. Fetching metadata and then a diff
can remain phases inside one PR retrieval operation. Introduce a durable child
step when an intermediate result needs independent reuse, dependency tracking,
or recovery; a method boundary or HTTP request alone does not require one.
Ordinary sequential phases do not imply persisted execution continuations.

Validation targets for the eventual example: rediscovery can add a PR while an
already-final PR incurs zero retrieval requests; unchanged relevant metadata can
short-circuit expensive retrieval; failure before a complete retrieval result
does not publish that partial result as a completed cache value; only explicitly
managed child results can supply independent durable reuse. A changed assessment
prompt can still rerun analysis on a retained final source snapshot. Exact method
names, invocation, lifecycle order/defaults, async hook results, and intermediate
phase persistence remain open.

## 2026-09-16 — explicit retention outcome from source retrieval

**Settled by explicit user confirmation on 2026-09-16.** Prior-result access and
an explicit reuse outcome are selected semantics, not a candidate to compare
against returning old data as a fresh result. The user chose this for low cognitive
burden and broad applicability. Exact public spelling remains an implementation
design detail; no additional approval of these semantics is needed.

The user selected discovery as a distinct non-memoized step for this workload.
It leads into memoized per-PR data retrieval. Retrieval must have access to the
last eligible completed cached representation and must be able to explicitly
signal that this representation remains accepted, potentially after doing some
work. Returning the old payload as an ordinary fresh result is insufficient:
the framework must distinguish retention from producing a freshly fetched result.

Required semantics for the source-retrieval contract:

- Expose absence or the prior cached result to the author's retrieval logic.
  Prior data is for inspection; accidental mutation must not alter stored data.
- Permit a distinct control outcome meaning "retain this prior result and accept
  it under my source policy." It must be distinguishable from every valid payload,
  not inferred from reference equality or equal content.
- Preserve the retained payload's provenance. Record the current acceptance
  attempt separately, including any observed resource usage and available reason
  or validation evidence. Local merged-state acceptance and a network check that
  confirms no change are different activities even though both retain the result.
- A fresh fetch whose payload happens to be equal remains a fresh fetch for
  observability; content equality can still allow downstream reuse.
- Retention requires an eligible prior completed result. It cannot turn a cold
  miss or incomplete attempt into a successful cached result. Validation failure
  alone is not a retention decision.
- Acceptance establishes freshness under the author's policy for this resolution.
  It does not by itself declare permanent finality; subsequent checks still follow
  that policy. Downstream dependency verification continues normally.

Illustrative spelling only: `return previous.reuse({ reason: "already merged" })`
versus returning newly retrieved data. A handle-bound control result could name
the exact prior generation and prevent a concurrent update from changing which
snapshot is being accepted. Whether the public API uses that handle, a dedicated
sentinel, or tagged outcomes remains open, as do revision eligibility, conflict
handling, validation metadata updates, and storage of the acceptance record.
Do not silently retrofit these semantics into the current generation/claim schema.

Validation targets: local finality retains the result with zero source requests;
a successful conditional check retains it while recording the check's actual
work; a fresh equal-valued fetch is distinguishable from both; an initial fetch
cannot signal reuse without prior data; failed validation does not advance
successful-acceptance metadata. Retention alone does not invalidate downstream
work, while changed prompts or other consumed inputs still can. Required source
checks must execute even when an outer memoized consumer is being verified.

The confirming example performs a cheap PR point read and, if the author's
comparison accepts the existing snapshot, skips further retrieval of the diff,
reviews, and other supplemental evidence already held. The framework permits
that policy without mandating separate hooks for each phase. Whether a particular
provider timestamp or validator covers those supplemental resources is an adapter
contract or an explicitly accepted analysis policy, not a guarantee inferred by
microdelta. Optional lifecycle hooks can be added where justified; a large hook set
is not required to express this selected workflow.

## 2026-09-16 — HTTP response caching below step memoization (proposal)

The user asked whether a provided HTTP client could implement standards-based
network caching below the selected step-result memoization and reuse mechanism.
Engineering recommendation: yes, as an optional HTTP client/adapter capability.
Keep the core step contract transport-independent. This is an architectural
recommendation under discussion, not authorization to select a client library,
add a core HTTP dependency, or implement another persistence subsystem now.

HTTP caching owns individual response representations. It can store permitted
responses and validators, serve still-fresh entries, or revalidate with a
conditional GET. A successful 304 permits reuse with metadata updates; a full
response supplies new content. Correct handling includes Cache-Control, Vary,
and authorization context. ETags describe the selected representation; weak
validation does not prove byte identity. See [HTTP caching, RFC 9111](https://www.rfc-editor.org/rfc/rfc9111.html)
and [validators, RFC 9110](https://www.rfc-editor.org/rfc/rfc9110.html#section-8.8).

The step author still decides whether the assembled result is acceptable.
One PR-response validator cannot automatically justify reuse of separately
retrieved reviews or diff data. A source adapter can define broader coverage or
the author can deliberately accept that policy. A local merged-means-final rule
can skip calling the HTTP client entirely. A refreshed step can independently
benefit from cached HTTP responses while rebuilding its result.

Expose network outcomes to observation and, when useful, source-policy code:
served without a request, revalidated over the network, or fetched anew. HTTP
reuse must not automatically return the step-level reuse control outcome;
the step may combine multiple resources or execute changed transformation code.
Attribute network work once to the current step and retain the distinction
between a request avoided and response-body transfer avoided. Trial/environment
and credential boundaries must also hold for any proposed HTTP cache.

Acceptance cases if adopted: final source acceptance makes no HTTP calls;
304 reuse records a request but no newly transferred representation body;
changed step code can execute against reusable responses; separate supplemental
resources are not silently marked validated by a PR-only validator; incompatible
response variants/credential contexts cannot share entries; no-store responses
are not persisted by this HTTP cache. Client choice, durability, metadata surface,
and package location remain open.

## 2026-09-16 — finality metadata versus acceptance on this resolution

**Superseded:** the later settled hook-authority decision rejects persisted
finality markers. Retain this entry only as the history of an unselected proposal.

The user asked whether avoiding future source work requires a finalized state
on a result node. Clarification: the settled explicit reuse outcome accepts a
previous result for the current resolution; it does not necessarily suppress
future retrieval-policy execution. The author can already avoid all HTTP work
by inspecting cached merged state and returning reuse on each resolution.

If the desired behavior is for the runtime to skip that policy execution too,
recommend a persisted author-declared finality marker on the accepted result,
scoped to the applicable source definition/policy. Treat this as source-acceptance
metadata, distinct from whether an execution completed successfully. It is not
yet a selected enum, API spelling, or amendment to the generation state machine.
Do not infer permanent finality from ordinary reuse, HTTP freshness, or a 304.

Final source acceptance does not finalize downstream assessments: changed prompts
or other consumed inputs can still require new analysis of the retained source.
Define revision eligibility and an explicit refresh/policy-change path before
implementing durable finality. Validation must distinguish repeated ordinary
reuse (policy can run again) from declared finality (runtime can skip source-policy
execution), while permitting downstream invalidation in either case.

Related correction to the spoken request-count discussion: conditional GET sends
the saved validator with the data request. The server can return either 304 or
the new body in that one exchange; a preliminary HEAD/ETag probe followed by GET
is not required. See [RFC 9110 conditional requests](https://www.rfc-editor.org/rfc/rfc9110.html#section-13.1.2).

## 2026-09-16 — finality for immutable results (accepted direction)

**Mechanism clarified below:** finality is determined by the current optional
hook, not persisted as a property or state of the result.

The user endorsed finality for state-machine snapshots in a terminal state where
the analysis chooses to regard that state machine as immutable thereafter, and
more broadly for any immutable data. This accepts finality as a general result
capability, beyond the merged-PR example. It does not select a particular state
enum, method signature, or persistence protocol.

Finality expresses the author's assertion that the accepted result will remain
valid under the applicable definition and policy without further source checks.
That assertion can follow from intrinsic immutability or from the analysis's
deliberate decision to ignore subsequent changes. A terminal state is evidence
the author may use; microdelta must not infer that every terminal entity's associated
metadata is immutable. Likewise, an immutable input does not automatically make
every derived result final across changes to its calculation or other inputs.

Examples and validation implications:

- A terminal workflow snapshot can be finalized under a policy that accepts its
  captured fields permanently, skipping subsequent source-policy execution.
- An immutable artifact identified by a fixed content digest can be finalized
  immediately after successful retrieval; no state-machine transition is needed.
- A mutable alias for that artifact is a separate input and is not finalized
  merely because its current target is immutable.
- Declaring the source final does not prevent a changed downstream calculation
  from consuming that same snapshot and producing a new result.

Preserve the distinction between accepting a cached result now and finalizing
it under its definition/policy. Define revision scope and explicit override
behavior before implementation; finality must not silently bypass those boundaries.

## 2026-09-16 — finality relative to analysis inputs

The user added a third basis for finality: immutability relative to the analysis
inputs. In a time-bounded analysis, PRs outside the selected range are irrelevant
to that analysis. Finality must therefore be able to express stability of the
analysis-relevant result under particular inputs, rather than only intrinsic
immutability or unconditional source acceptance.

Required boundary (mechanism clarified by the later hook-authority decision):
evaluate the current finality hook with the cached result and current analysis
inputs. Changing a relevant input, such as the time range, can change its answer;
a previously observed answer cannot bypass this evaluation. The same PR
can be excluded for one window and relevant for another. Its stable identity
does not change, and an analysis-specific exclusion must not globally finalize
that PR's source data for every consumer.

Distinguish scope exclusion from source finality. When a reliable membership
field establishes that a PR is outside the window, the analysis can avoid its
expensive retrieval/assessment. A stable exclusion decision can itself be final
under the window and membership contract. Merely filtering an item out does not
assert that all of its source fields are immutable. If the membership field can
change, the author needs an acceptance policy or fresh evidence to justify keeping
that exclusion. The exact time field and boundary inclusivity remain scenario
inputs to specify, not framework assumptions.

A fixed historical window alone also does not prove discovery complete or prevent
late-arriving/corrected records. Closing collection membership needs its own source
or author-acceptance contract; individual final results do not establish that.

Validation targets: an out-of-window PR incurs no unnecessary hydration or LLM
work; widening the window can admit it; a final exclusion in one analysis cannot
suppress another analysis's inclusion; unchanged relevant inputs preserve valid
finality; changed inputs used by the finality decision force reconsideration.
Public hook syntax remains open. The later decision rules out a durable finality
marker or persisted finality decision as the mechanism for honoring these inputs.

## 2026-09-16 — finality hook is authoritative; no stored finality (settled)

The user explicitly locked in the optional method/callback on the node definition
as the source of truth for finality. Do not store a flag, node state, or equivalent
database assertion that a cached result is final. This supersedes the proposed
persisted marker and dependency-verification shortcut discussed above.

Whenever resolution needs a finality decision for an eligible cached result,
evaluate the current definition's hook against that result and current applicable
analysis inputs. A previous true answer does not suppress later hook execution.
Changes to the hook's logic or inputs can therefore yield a different answer
without clearing or migrating a stored finality state. Runtime verification of
an outer cached consumer must also honor this current decision where needed.

A true answer permits retaining the accepted result without source refresh for
that resolution. A false answer follows normal verification/retrieval policy;
it does not by itself demand a full fetch. With no hook there is no finality
shortcut. With no eligible cached result there is no completed value to retain.
The explicit reuse outcome remains useful when retrieval does run and performs
checks before deciding to keep the prior result. Finality does not disable
verification of separate downstream inputs or changed downstream calculations.

The database continues to hold cached data and ordinary provenance/accounting;
it is not an authority on finality. Do not replace the forbidden finality flag
with a persisted callback answer or a finality-dependency cache that skips the
current hook. Exact hook naming, synchronous/asynchronous signature, invocation
deduplication within one resolution, and eligible-result rules remain to specify.

Test-first acceptance targets: a stored merged PR is accepted after the hook runs
on each resolution with zero source requests; changing the time range can change
the hook's answer for the same cached result; correcting the hook can revoke an
earlier finality answer without resetting database metadata; reopening storage
still consults the current hook; false/absent hooks follow ordinary retrieval
rules; no finality column/state or equivalent persisted assertion is introduced.

## 2026-09-16 — concrete roster authoring exercise

At the user's request, the [roster example](exploration/roster-example/README.md)
now expresses the complete org-to-person-summary workflow through object-shaped
definitions. Its surface is compile-checked declarations, not a public API or
implemented engine. Application callbacks have tests written first. A separate
read-only review checked the example against the settled finality/reuse decisions.

New spelling under exploration: `retrieval(...)` shares the `memo(...)` definition
shape but explicitly delegates each required source validation to the current
finality hook and then, if needed, the retrieval body. Ordinary `memo(...)` keeps
automatic dependency verification for derived calculations. Both require author
identity. This avoids accidentally hiding source checks behind an automatic URL
cache hit. The constructor split is proposed, not a user-selected export.

The example uses creation time in a half-open window, explicit trial employee IDs,
three adapter validators covering details/diff/reviews, and a strict per-person
fold sorted by PR URL. These are labeled application choices. It does not claim
that a GitHub point-resource timestamp validates the whole evidence bundle or
that the callback tests prove persistence, scheduling, or field-sensitive cutoff.
The README identifies those remaining engine/adapter validation obligations.

## 2026-09-16 — validation API comparison and lifecycle recommendation

The user asked to continue reviewing the concrete authoring API through cold run,
cached merged PR, validation followed by reuse, and changed policy/prompt cases.
The [review](exploration/roster-example/validation-api-review.md) now includes
compile-checked alternatives with identical definitions and consumer wiring.

Engineering recommendation after comparison and independent read-only review:
prefer one `memo(...)` constructor, with `validation: 'author'` explicitly selecting
author-controlled source acceptance. Dependency validation stays the default.
Both options need the same identity, previous snapshot, finality hook, reuse,
publication, and accounting machinery. This option keeps the validation strategy
on the object definition and avoids adding a separate category of step. It is a
recommendation, not a newly user-selected public export; the earlier full example
remains available as the separate-constructor candidate.

Lifecycle recommendations: eligibility before finality but without requiring
ordinary input equality; current hook before the chosen validation path; thrown
hooks fail rather than implicitly fetch or accept; nested consumers must discharge
current source acceptance; explicit reuse pins the inspected generation; different
current policies cannot share acceptance merely because their URL matches.
The review specifies expected traces and V1–V11 future integration tests. Passing
type tests prove the candidate's authoring contracts, not those runtime guarantees.

## 2026-09-16 — compatibility version and advisory change-detection opportunity

The user confirmed the need for an author-controlled cache compatibility version:
changing the version can force recomputation even when the subject and inputs
are unchanged. The analogy is a version change in an HTML5 AppCache manifest.
Earlier-version results become ineligible for reuse under the new version;
their stored data and history remain preserved. Exact version scope, public
field name, representation, and rollback behavior remain to specify.

At the user's request, retain this potential user-experience improvement for
later evaluation: compare a function's source representation, for example via
`Function.prototype.toString()`, with a previously observed representation. If
the logic appears to have changed while the compatibility version has not,
invite the author to consider a version bump.

The reminder should explicitly explain that changes to calculation logic alone
do not trigger recalculation. When the author makes a meaningful logic change,
bumping the cache compatibility version (the user's "manifest version" analogy)
ensures that the affected calculation recomputes when next required, even if its
subject and inputs are unchanged. Source comparison supplies the reminder; it
does not itself trigger recalculation. This does not imply eagerly rerunning all
stored subjects when a version is edited.

This is an advisory opportunity, not a selected implementation requirement.
Source-text comparison cannot establish semantic compatibility: formatting or
build output can change without a meaningful behavior change, while captured
values or called dependencies can change behavior without changing the function's
own source text. A notice must therefore describe an apparent change, not claim
proof of incompatibility. This proposal does not authorize automatic version
bumps, source-derived subject identity, automatic invalidation, or deletion of
prior results. The author's version remains the explicit compatibility control.
