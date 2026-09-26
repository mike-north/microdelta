> Historical artifact. Superseded by the [active specification](../../../spec/README.md). Do not implement from this document.

# Product scenario: watch contribution data form without premature paid analysis

Captured from the user's scenario on 2026-09-15. This is a product-direction
anchor and future acceptance scenario, not a claim of implemented functionality.
It exercises the [preview and recomputation decisions](../decisions.md) and the
[authoring surface](../exploration/authoring-surface.md).

## User story

As someone running a long analysis of GitHub contributions, I want to watch the
organization's contribution data take shape in the viewer while collection and
recalculation proceed. I also want expensive analysis of an individual's body of
work to wait until its required evidence is complete, so intermediate arrivals
do not cause repeated paid analyses that will immediately become obsolete.

## The same data, two consumers

The analysis pipeline and dependency relationships are known upfront. The fan-out
discovers PR/review identities and cardinality, not new kinds of analysis work or
novel pipeline structure. Bindings distinguish progressive observation from
waiting for the complete collection. The specific declaration/binding syntax is
still an authoring design task.

A large fan-out collects or refreshes pull requests and code reviews across an
organization. Available facts support histograms by programming language,
bucketed changed-line counts, repository, and organization where applicable.
These are aggregates over contribution facts, not agentic judgments.

The viewer updates these histograms as data becomes available. It is useful for
the provisional distribution to change throughout a six-hour analysis: visible
movement and coverage provide confidence that data is flowing. Aggregate updates
may be throttled or coalesced to bound database and rendering work. The final
update must still be delivered after the data settles.

A separate memoized step analyzes one individual's body of work over a review
period. It must not execute on each intermediate contribution arrival or refresh.
It waits for the required evidence set to be complete and valid for the intended
evaluation, then verifies whether a stored analysis can be served or a new body
execution is necessary. Letting many prematurely started analyses finish and
discarding their outputs is not an acceptable substitute for this start gate.

| Consumer | While inputs are incomplete or being refreshed | Once required inputs are ready |
| --- | --- | --- |
| Unmemoized histogram | Recalculate from available facts; expose coverage and provisional status; coalesce refreshes as needed. | Show the settled aggregate for the evaluation. |
| Memoized individual analysis | Do not start its body; optionally expose the previous stored result with its validity status. | Verify the stored result and execute only when required by normal memoization semantics. |

Observing the histograms must not itself initiate memoized GitHub fetches or
agentic work. The authorized analysis evaluation drives those executions; the
viewer observes their available outputs and lifecycle state.

## Concrete walkthrough

1. Start an evaluation of a defined organization and review period. Existing
   stored contributions may be available, but their validity for this evaluation
   may still need verification. No prior data is also a valid starting state.
2. Discover and resolve contributions through the fan-out. The viewer shows
   available distributions and honest discovery/completion counts. Before
   enumeration finishes, the final total can be unknown.
3. As members arrive or change, update aggregate previews. If a PR's line-count
   bucket changes, replace that member's prior contribution to the histogram;
   do not count both generations as two PRs.
4. Keep the individual analysis waiting while its required membership is unknown,
   or a required contribution is pending, invalid, failed, or refused. A last
   stored analysis can remain visible as a preview, but is not a verified result.
5. Once discovery and required dependency verification complete for that person's
   period, the individual analysis becomes eligible for normal memoized evaluation.
   All fields need not be newly fetched: unchanged verified results qualify.
6. The eventual result becomes available with its verified status. Histograms
   continue to reflect the progressing organization-wide evaluation.

The user explicitly confirmed the scope in step 5: wait for the complete evidence
required by that individual analysis, not unrelated work elsewhere in the
organization. Individuals with fewer contributions may finish earlier, including
their agentic analysis. Higher-level agentic steps can combine contributions or
results across teams, groups of teams, and eventually the organization. Each
roll-up waits for its own complete required dependency set; only calculations
that depend on the full organization-wide set must wait until the end. The
hierarchy is an application composition, not hardcoded organization levels in
the framework.

A concrete completeness signal still needs design; a quiet interval, all
currently discovered promises resolving, or a count of available old rows cannot
prove source enumeration has finished.

The user further identified the **corpus of PRs for one person and period** as
the folded-in dependency. It supplies a new verified value only once required
discovery and PR resolution are complete. More pages discovered while building
that corpus fulfill the existing dependency; they are not separate input changes
justifying premature paid analyses. This corpus can be expressed through graph
composition or an explicit step; no new core primitive is selected. The viewer
may observe member arrivals while the complete-corpus dependency remains pending.

## Preview honesty and defaults

The user's product litmus test is the human supervising the long-running job:
previews help them see data arrive, understand progress, sanity-check values, and
decide whether to stop, adjust, and restart. Errors must remain apparent; a smooth
histogram that hides failed refreshes does not satisfy this scenario.

At the intended scale, the user expects some failures to be almost inevitable.
The experience must remain useful with many successful members and a smaller
failed subset. Present failure counts and inspectable details together with the
affected coverage and blocked downstream results; a single generic error screen
is insufficient. Sibling continuation and partial-fold policies remain separate
decisions from this observability requirement.

The user subsequently confirmed that independent siblings continue by default
after isolated member failures. Unrelated individuals and teams can complete;
roll-ups requiring a failed member do not silently omit it. Preserve successful
results while making repairable failures visible. Retry policy remains separate.

A preview can mean either a retained prior result or a newly calculated aggregate
over currently available inputs. Preserve that distinction and carry availability,
validity, and coverage information. Prior and refreshed records may coexist in a
provisional view only under an explicit presentation policy; they must not be
presented as a complete verified snapshot. The exact default for including old
records during refresh remains open.

The user subsequently selected latest-available previews with explicit freshness:
retain available values and replace them as refreshed values arrive. Return a
preview envelope requiring unwrapping, with freshness directly alongside the
value. A throttle option must allow periodic latest-state delivery under sustained
arrivals; a debounce that waits indefinitely for quiet is not the intended model.
The final coalesced state must still be delivered. Old unverified records do not
count as verified progress even when included in the provisional histogram.

An empty verified set is different from an as-yet-unavailable set. Missing values
must not silently become zero-valued measurements. If a record disappears from
the refreshed membership, a settled aggregate must eventually remove it. The
preview's inclusion/removal timing is part of the presentation policy.

On a refresh failure, preserve the last available value with stale status and the
error in its envelope. With no prior value, expose unavailable data and the error.
A verified read reports the failure rather than falling back to stale data.

Failures remain visible. This scenario requires complete input for the individual
analysis; it does not approve a partial paid analysis, a percentage-based readiness
threshold, automatic retries, or repeated execution after genuine later updates.
Those remain separate author-policy and lifecycle questions.

## SQLite and cost assumptions

### Explicitly tolerant outcome folds

The user subsequently clarified that authors can intentionally fold all settled
outcomes with success/failure statistics, or filter to successful results for an
updated organization summary. This is a supported alternative to the strict
complete-success individual-analysis example above. A failed member repaired
later changes the outcome/success set, so affected summaries must reverify and
recalculate as appropriate. Pending members and scheduled retries do not silently
become terminal failures merely to complete an outcome fold.

Retry support must accommodate API rate limits. A scenario variant should inject
a rate-limit response and verify visible cooldown/retry, continued independent
work outside the affected quota scope, no premature strict fold, and eventual
completion or a surfaced exhausted-retry failure. Request-level retry must not
replay earlier paid work in an enclosing calculation. Policy and lifecycle
details are tracked in [decisions](../decisions.md).

The user's motivating example treats these fact aggregates as cheap database
queries when facts live in SQLite. That is a desired workload and an implementation
opportunity, not evidence that the current field-row schema supports arbitrary
SQL aggregation efficiently. Evaluate indexed aggregate queries, bounded scans,
or incrementally maintained aggregates against representative data before choosing
a mechanism. Keep storage-specific query syntax out of the authoring contract
unless it earns a deliberate public API decision.

The viewer must not materialize every PR body merely to count languages or line
buckets. Cheap preview recalculation should remain cheap at fan-out scale;
throttling bounds aggregate/renderer work and never renews claims or decides when
expensive dependencies are complete. Naming, memoization, and identity rules must
remain consistent for both consumers.

## Acceptance cases to implement test-first

### External-write variant: response lost after mutation

An application step performs an external write through a provider that supports
idempotency keys. The provider commits the mutation, but the response is lost.
Retry the same logical operation with its original key and request parameters;
assert one external mutation and eventual recovery of the provider result. Also
test reconstruction after a process restart, changed parameters, several writes
inside one step, a deliberately new operation, provider key expiration, and a
provider with no idempotency support. Ambiguous unsupported cases must not be
misreported as safe retries or known failures without side effects. This fixture
extends the contribution scenario's recovery requirements; it does not imply
that merely fetching GitHub contribution facts is a mutating request.

### Overnight variant: quotas reset while the operator is away

The operator starts the analysis before bed. After twenty minutes, a provider
reports exhausted usage until a later reset. The affected work becomes visibly
deferred under its retry policy; independent scopes continue. After reset, the
work resumes automatically without requiring the operator to discover and repair
a stopped run the next morning. The system may be idle when all runnable work
depends on the exhausted resource, but its waiting state and planned resumption
must be explicit. This scenario does not guarantee progress when a provider gives
no recoverable path or when the configured policy's time/budget limits are reached.

Use a controlled clock and provider fixture to prove that no request is issued
before the permitted reset, no busy-loop retries occur during the wait, affected
requests coordinate their quota scope, and the required work resumes afterward.
Confirm that waiting does not hold request permits or cause lease expiry to
launch a duplicate paid attempt. Define and test the lifecycle transition rather
than hiding the wait behind invented progress reports. Durable deferral across
process restart is a proposed additional capability, not yet an implemented or
selected guarantee.

- **Progress before completion:** stagger contribution arrivals; observe multiple
  histogram snapshots while the individual analysis body has executed zero times.
- **Ready boundary:** close required discovery and verify the final required
  member; an invalid/missing individual analysis executes once for that stable
  evaluation. A matching stored analysis instead serves with zero body calls.
- **Preview isolation:** repeatedly observe/recalculate histograms without
  increasing memoized GitHub-fetch or agentic-analysis invocation counts.
- **No premature superseded work:** a burst of intermediate field updates causes
  no series of paid executions whose results are later discarded.
- **Replace, do not duplicate:** refresh an existing PR into a different language
  or size bucket; the aggregate includes one contribution for its logical member.
  Final removals are reflected after membership is established.
- **Unavailable versus empty:** an undiscovered set is visibly incomplete; a
  verified empty set yields a complete empty histogram.
- **Failure:** one required member fails; histograms can still preview available
  facts with incomplete coverage, while the individual analysis remains blocked.
- **Failure isolation:** inject intermittent member errors into a large fan-out;
  independent members and their ready downstream analyses still finish, and
  previously completed memoized results are retained without blanket re-execution.
- **Failed refresh envelope:** expose the retained value, stale status, and error
  together; with no prior value, expose unavailability and error. A verified
  consumer receives failure, not the retained preview as a successful result.
- **Previously stored values:** stale previews remain marked and cannot satisfy
  a verified read or open the expensive execution gate.
- **Bounded refresh:** a burst coalesces aggregate/renderer work under the chosen
  policy, and its final snapshot is delivered; inspect real database operations
  and payload reads rather than asserting a visual frame rate proves efficiency.
- **Continuous preview updates:** sustain arrivals beyond multiple configured
  throttle intervals; observe periodic latest-state envelopes without waiting
  for quiescence, then observe the final state after arrivals stop. Each envelope
  exposes freshness, including when its value is unchanged but its status changes.
- **Relevant scope:** once completeness is provable for one person's required
  evidence, unrelated pending work does not block that person's analysis.
- **Hierarchical readiness:** finish one individual's inputs while another is
  pending; the first individual's analysis can finish. A team roll-up becomes
  eligible when its own required inputs are ready, while an organization roll-up
  that requires still-pending teams remains blocked. Each level follows declared
  dependencies rather than a global barrier or fixed organization hierarchy.
- **Unfinished discovery:** resolve every PR on the first page while a further
  page is still being discovered. Histogram previews may update, but no new
  verified corpus value is supplied and no dependent paid analysis starts until
  discovery closes and all required members resolve.
- **Known pipeline, unknown cardinality:** run the same declared pipeline with
  zero, one, and many discovered PR members. The member instances change, while
  the processing and fold relationships remain the same. A closed empty corpus
  is ready; an enumeration with no members discovered yet is not.

These are scenario assertions awaiting implementation and tests. The application
chooses histogram definitions, contribution attribution, and period boundaries;
the framework must preserve the declared dependencies and readiness behavior.
