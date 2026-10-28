# Within-person discovery and readiness

**Standing:** supervisory-selected Candidate A for a bounded correctness experiment
under [#297](https://github.com/mike-north/microdelta/issues/297), a documentation-only
child of [#170](https://github.com/mike-north/microdelta/issues/170). Selection follows
architecture and different-agent design review, including the declared-child drain
clarification and cumulative-frontier risk below. Candidate B remains unselected.
The [experiment charter](within-person-discovery-experiment.md) records the selected
semantic scope and accepted fixture/resource ceilings. Actual execution needs a
separate runtime issue and review of its invocation matrix, finite operation
allowance, measurement plan and concrete launcher bounds before any probe runs.
This decision establishes no runtime behavior, public spelling or full-report adoption.

The accepted completed-search report under #240 and the
[controlled roster first-delivery scope](controlled-roster.md) remain unchanged.
This plan addresses the separate, still-open full-target
[RUN-003–005](../spec/operations.md#run-003--readiness-is-scoped-to-the-consuming-calculation)
boundary. The six context owners, [CMP-1/4/8/9](../spec/composition.md), current
source acceptance, exact references, fencing, admission, retry and Accounting
contracts continue to govern.

## Consumer and decision

In one authorized invocation, one person's fresh traversal validates page one's
qualified PR A. A's required current detail becomes ready, its cold assessment
executes, and History publishes the result while page two is demonstrably held.
The strict person summary's body has not started. If page two fails, the invocation
cannot claim a complete person population or strict summary. A later invocation
in a fresh process starts traversal at its root, justifies A's current membership
and evidence, and can retain the exact eligible A result. Moving A to another
page does not itself change A's identity or replay its paid work.

The bounded fixture has a provider-guaranteed fixed dataset for the selected
query/revision. That controlled premise supplies consistency evidence; a local
traversal identifier, fixed date interval or repeated cursor does not. A consumed
input change **between** fresh invocations tests normal invalidation. Conflicting
revision or identity evidence **within** a traversal tests refusal to certify
consistency. Neither scenario chooses RUN-004's open mutable-live-source policy.

The live design question is how declared page acquisition hands an immutable
frontier to current Resolution while that same invocation continues discovery.
There are two concrete missing interfaces, not an already available orchestration
recipe:

1. A declared acquisition target with current tracked arguments must be invoked
   under the existing run's operation/admission/stop authority. Today's root
   `IRun.resolve` takes a binding descriptor, not a parameterized callable target;
   source-call handles are minted for declared parent invocations.
2. Each normal Resolution request must capture an explicit immutable frontier
   binding whose origin and currentness the collection source can justify.
   Today's frozen composition and request-local population cache do not accept
   a different frontier argument for each request. A mutable helper closure or
   overwritten composition input does not fill this gap.

Candidate A below fixes the selected bounded semantic contract for both interfaces. Their absence
in the current API is an implementation gap, not a reason by itself to leave the
design undecided. Calling them a run-owned stream or mailbox would still fail
to establish their authority, tracked evidence, or dispatch path.

## Meanings and owners

A **traversal** is the adapter's fresh non-memoized attempt to establish the
selected person's population. It carries provider-specific query, continuation
and consistency evidence. It is not a reusable continuation or durable result
identity. A **frontier** is one immutable statement of the accepted members so
far and whether provider evidence certifies closure. A frontier belongs to one
traversal and does not grow after a request captures it. An open frontier is
useful evidence for member work, never evidence for a complete person analysis.

A **ready member** has a stable qualified identity and the current required
evidence for its declared PR work. Membership does not itself accept retained
detail. An **exact retained result** is History's immutable committed reference;
its continued existence does not establish today's acceptance. **Closure** is
positive source evidence of exhaustion for the selected population, not producer
inactivity or the settlement of all work discovered so far. **Run lifetime** is
one Supervision invocation with one stop, operation and allowance authority;
it is not established by equal public `runId` text across invocations.

| Owner | Responsibility in either candidate | Boundary |
| --- | --- | --- |
| Example adapter | Validate provider query/revision, continuation, page overlap/conflict and exhaustion; offer immutable discovered records and truthful closure/failure evidence. | Cannot read the hidden fixture manifest, declare work, accept retained results, publish History, or decide permits. |
| Definition & Binding | Freeze acquisition, collection, PR work and strict-fold relationships before execution; establish stable subjects, correspondence and any new binding witnesses. | Runtime pages instantiate existing work; they cannot add a template, callback or edge. Page/cursor/frontier sequence is not PR identity. |
| Reuse Resolution | Establish each request's current source result, key its population, accept current detail and validate consumed facts/exact candidates; enforce strict-fold readiness. | No retained open snapshot, old true finality answer or bare reference bypasses current policy. |
| Run Supervision | Own the producer/coordinator lifetime, operation dispatch, normal requests, admission, stop, allowance, drain and cleanup. | Cannot certify provider consistency or turn an ordinary callback into an undeclared external-operation capability. |
| History | Publish source/member/fold results through ordinary fenced publication and preserve exact immutable references. | No second store, mutable published collection or application publisher. |
| Accounting | Record actual reported usage and preserve unknown usage around possible sends. | Page receipt or cancellation does not imply zero usage. |
| Machine | Supply clock, scheduling, storage/host and other injected capabilities. | No traversal, currentness, closure or admission policy. |

Tracking continues to own observations and argument recipes; Materialization
continues to expose the selected result views. Neither becomes a producer or
currentness authority. These supporting roles do not add a bounded context.

The adapter may coalesce a legitimate repeated identical PR across pages before
publishing a keyed frontier. The collection still requires one record per key;
Definition's duplicate-key rejection is not weakened. Conflicting records for
the same qualified identity, repeated invalid continuation, or mismatched revision
cannot be silently deduplicated into certified coverage. A later frontier must
preserve accepted member meaning under the fixed-dataset premise; contradictory
removal/change is a consistency failure, not a live-update implementation.

## Observed support and the boundary it does not cross

These are source observations at
`452760f6ea0e67b0803d8d7d14fa5f8e28b687fe`, not new acceptance evidence.

| Current support | Relevant source | Missing consequence |
| --- | --- | --- |
| An ordinary collection source returns one immutable `{members,status}` result; keying is all-or-nothing. | [collection declaration](../../packages/definition/src/collection.ts) | A pending source does not expose part of its eventual return. |
| `populationOf`/`discover` resolve, read and key one exact collection result per template per request. Open results allow their ready members to proceed. | [Resolution request context and discovery](../../packages/resolution/src/resolution.ts) | A second page cannot mutate that request's captured population. A later normal request can capture a different result, but needs explicit current frontier authority. |
| `foldReadiness` requires closed discovery and successful required current members before a strict fold is ready. | [Resolution strict-fold readiness](../../packages/resolution/src/resolution.ts) | Running a summary body on page one and merely delaying its publication would violate the required unstarted-body witness. |
| Callable sources receive tracked arguments and return one source outcome; they reject child/collection declarations. | [source slots](../../packages/definition/src/source-slot.ts), [SCD-1–6](scoped-source-calls.md#selected-bounded-contract) | A callable source cannot silently become a producer with nested populations. |
| Parent invocation dispatch supplies structural witnesses and tracked argument handling. Root run requests accept descriptors. | [invocation](../../packages/definition/src/invocation.ts), [generated Supervision API report](../../packages/supervision/etc/supervision.api.md) | There is no current root parameterized acquisition call with the proposed coordinator's authority. |
| Normal requests within a run share writer acquisition, with separate request/pass scopes. `ordinary` wraps work and lifecycle. | [Supervision](../../packages/supervision/src/supervision.ts) | Neither proves page handoff, current-frontier injection or a declared external operation inside `ordinary`. |
| The controlled adapter completes all pages before returning IDs; the person-summary memo first awaits search, then calls discussion/detail/assessor itself. | [adapter](../../examples/contribution-report/src/controlled/github.ts), [application](../../examples/contribution-report/src/controlled/application.ts) | That body cannot both initiate PR A's calls and remain unstarted while page two is held. |

The accepted #85/#86 open-snapshot and fold controls are useful existing controls.
Their returned-open-then-later-closed snapshots, including restart cases, do not
establish a live page-to-work bridge. #252/#254's source calls support the accepted
completed-search flow; they do not establish streaming or nested PR collections.
The historical standing text in the scoped-call plan is not a delivery readback.

Consumers must use ordinary package imports and generated declaration tiers.
The example's [TypeScript configuration](../../examples/contribution-report/tsconfig.json)
selects each package's `dist/api/*.alpha.d.ts`; the
[fixture configuration](../../fixtures/contribution-report/tsconfig.json) inherits
that path. The `etc/*.api.md` files are reviewed API reports, not import targets.
A selected future seam needs intentional release tags, declaration generation,
API reports and boundary/type checks under [package boundaries](../spec/package-boundaries.md).
A private source alias, cast, unsupported overload or permissive local test port
would not demonstrate a usable mechanism.

## Candidate A: coordinated immutable frontiers across normal requests

**Supervisory-selected for the flat correctness experiment only.** A separate
Supervision-owned coordinator manages one adapter traversal in one run, outside
admitted member callbacks. Definition binds its possible acquisition and consumer
relationships before graph freeze. The producer validates pages; the coordinator
schedules normal requests over immutable frontiers and drains them on termination.
No request's population or source result is modified.

### Selected bounded authority and frontier contract

This is a selected engineering extension for the bounded experiment, not an
existing API or selected public spelling. Its semantic unit is **one declared traversal relationship**,
not a general source subscription or arbitrary runtime input facility.

**Declaration and minting.** Before graph freeze, Definition binds one traversal
role to: its current query inputs; exactly one page-acquisition source-call slot;
one ordinary collection source; one already declared PR template/member target;
and its separate strict person fold. The query includes the selected fixed person,
repository/account, time interval, filters and controlled revision. Existing unique
slot/implementation checks apply. The relationship declares possible edges once;
page responses supply only arguments and member data. For this experiment, one
such relationship exists in the composition. It can later be a relationship of
a declared person group; this proposal does not add that group now.

**Page-acquisition authority.** Definition mints a root-call witness only for that
relationship's page source. Supervision receives a run-bound dispatch capability
for that witness from Resolution, not an arbitrary callable invoker. This is the
small intended extension to the current parent-only supplied-source invocation
path. It does not give source callbacks children or expose arbitrary targets via
`IRun.resolve`. Resolution checks the frozen unique binding, creates tracked
arguments from the current query and the prior accepted page's continuation,
and invokes ordinary source policy. The first call has an explicit root
continuation; later calls must name continuation evidence from that traversal's
preceding accepted page. Forged, cross-composition, cross-run and after-close
calls reject before callbacks or sends. Historical continuation alone cannot
establish this relationship.

Each page call is a fresh acquisition: no retained page/finality answer can skip
the source call in this proof. The source callback uses the existing supervised
operation capability. All sends, retries, possible-send records and reported or
unknown usage belong to the same operation engine and finite run allowance;
the coordinator cannot start a new run to reset those limits during traversal. A callback may return one ordinary
source outcome and never yields a live collection. The run-local root witness is
not a durable parent recipe: no parent memo is being skipped or reconstructed.
Ordinary source/argument observations and immutable result references retain
their existing roles. A later runtime issue must map this path to the actual
owner ports and reviewed generated declarations, without a new persistence
protocol or test-only dispatch authority.

**Current-frontier authority.** The adapter validates accepted page responses
and offers a copied immutable frontier. The coordinator associates it with the
relationship and exact live invocation, and assigns a monotonically increasing
run-local frontier sequence. Sequence proves ordering only; provider consistency
and closure still require adapter evidence. Resolution mints a request-bound
capture from that association. It contains the relationship descriptor,
invocation/traversal association, frontier sequence, immutable member records,
open/complete evidence, and the exact accepted page evidence supporting it.
These are semantic requirements, not a selected transport/schema.

A normal request may capture only the relationship's latest offered frontier
while the producer remains live or has successfully closed. Capture is atomic
with respect to producer advance/failure/stop. The captured frame remains fixed
for that request even if another page later arrives; an older in-flight request
is still honestly evaluating its earlier open frontier. A new request cannot
recapture an older frontier after advance, or any frontier after failure/stop.
Absent, forged, wrong-relationship, wrong-invocation or superseded-start frames
refuse before source callbacks, member gates or fold bodies.

Capture eligibility is checked when that root request captures its frontier.
Failure or soft stop closes **new** root-request/capture authority, not the
already captured binding of an admitted drain unit. Its immutable frontier and
member/argument bindings remain available to declared children demanded by an
already admitted, executing parent that is untainted and not pending. Such a
child's first attempt is still decided by the ordinary admission policy under
RUN-014; it does not start a new root request or capture. Checking its existing
binding must not repeat the now-closed producer-live capture test or revoke the
binding before drain completes. This authority grants no independent page/member
work, new frontier, undeclared edge or retry. Hard stop/deadline escalation
prohibits further affected child admission/sends, while evidence and owned
bindings remain retained through orderly drain/cleanup.

Definition marks only that collection source as receiving this declared evidence;
Resolution supplies tracked immutable views through its source bindings. This is
a narrow new internal request binding, rather than mutation of composition
inputs or general author-controlled request context. Current source policy checks
the offered adapter evidence for the selected query/revision and returns an
ordinary fresh immutable collection result under the stable person/query subject.
It does not retain a previous frontier merely because it was once accepted.
History publishes normally. The collection's member keys remain stable qualified
PR IDs; traversal/frontier sequence is not a hidden PR subject prefix. Current
PR detail hooks run normally; equal consumed facts can retain exact assessment
results across requests. The source result and request population never mutate.

**Terminal and disposal authority.** Supervision owns the producer and every
captured consumer request in this run's drain set. A validated terminal page
permits one closed frontier; no later page can reopen that traversal. A terminal
producer error prevents further captures and becomes an explicit failed current
discovery outcome at the normal request/report boundary. It is not a third
successful collection status, an empty value, or a retained open frontier used as
current. For this bounded one-person candidate, terminal producer failure
requests the existing **soft stop**: no new root requests/frontier captures,
independent top-level page/member admissions or retries. Already admitted steps
and the first attempts of declared children demanded by their executing bodies
drain under
[RUN-014](../spec/operations.md#run-014--cancellation-conveys-escalating-intent-honestly).
This engineering choice does not derive a hard abort from discovery failure or
reset retry allowance. Prior open request reports remain open historical
observations;
no report is edited to make it closed or failed. A pending strict consumer learns
the terminal failure from the coordinated outcome and cannot wait indefinitely.
Current typed error/report spelling is left to the later owner-port mapping,
while the failure and body/send outcomes are fixed here.

After soft stop, including the selected producer-failure path, no new independent
top-level page/member work, root request, frontier capture or retry starts. An
already admitted, executing, untainted/non-pending step may still demand the first
attempt of a declared child; ordinary admission policy decides that child within
the admitted parent's drain unit. The parent and those children retain the
captured frontier/binding authority they need, may finish remaining first-attempt
requests after permit/rate waits, and may publish under the current fence and
commit rule. A's assessment having been admitted is therefore different from A
merely being ready in an open frontier. A cooperative adapter may cancel on soft
intent, but that is not a framework prohibition on this child admission or its
draining sends.

Hard stop or an explicit operator-deadline escalation prohibits further affected
sends, aborts author bodies and records interrupted attempts and truthful remote
cancelled/running/unknown outcomes. Publication obeys the existing commit
linearization rule: escalation does not retract an already committed result.
There is no new default soft-stop deadline. The coordinator awaits all owned
work through the selected drain/escalation outcome before dropping frame
references and adapter resources; it cannot silently replace soft stop with hard
abort to obtain a zero-send trace. A later invocation receives no live capability, frame or continuation from this one; it
begins at the root and reestablishes current membership/evidence. Exact History
references survive only as ordinary candidates. One run-level stop controller,
operation engine, allowance and admission pools govern the entire sequence.

The proposal thus adds a restricted root source-call witness and one explicitly
declared source-evidence binding per request. It does not change the meaning of
an ordinary returned collection, add source children, expose a mutable source
mailbox, or make `ordinary` grant acquisition capabilities. This is the minimum
selected cut for the bounded experiment; a runtime child must establish whether the
existing owner ports can realize it before any broader adoption.

The selected bounded sequence is:

1. Start one run; acquire page one through its declared capability. The adapter
   validates A's identity and consistency basis and offers frozen open frontier F1.
2. Capture F1 for normal request R1. After page two's actual controlled send enters
   its hold barrier, R1 resolves the already-declared PR template from F1. A's
   current detail and assessment may execute and publish under ordinary fencing.
   A strict-fold request over F1 returns waiting without admitting its body.
3. With page two still held, acknowledge A's committed exact reference and the
   strict body's zero count. The harness can now release page two to succeed or
   fail. No timer or two-invocation sequence substitutes for these acknowledgments.
4. A valid next page yields a new frozen frontier F2. Only a **new normal request**
   R2 can capture F2; R1 retains F1 throughout. R2 performs ordinary current source
   checks and member validation, so A can reuse when eligible. A closed frontier
   permits the strict fold once every required member has an accepted outcome.
5. Producer failure yields an explicit failed current discovery/request outcome.
   The coordinator must not dispatch another evaluation against F1 as current,
   invent empty/complete data, or run the strict body. Already committed A survives
   as a candidate. A later separately authorized run starts traversal at its root.

Step 5 uses the terminal/disposal contract above: Supervision supplies terminal
producer failure to Resolution's coordinated discovery outcome, stops further
captures and drains the attempt. The existing collection value remains
open/complete. An earlier F1 request cannot be relabeled failed/closed by mutation.
A runtime child must map the typed failure/report boundary before implementing
the successful path; making the pending fold wait forever would reject A.

A bounded coordinator should have at most one page acquisition and one frontier
consumer request active, with no unbounded queue of frontiers. It may wait for the
current consumer before admitting another frontier. It must keep the producer,
consumer and strict-wait tasks in one run's drain set, reject new root requests
and captures after stop, and keep existing captured bindings available to owned
declared-child first attempts during soft drain. It releases run-local frames
and adapter resources only after drain. A blocked
page must be interruptible under the existing stop/possible-send protocol; it
cannot require the person summary to start in order to release its own lane.
The run's lease must exceed the slowest request, including an actual held send;
normal request-start renewal is not a heartbeat or proof of indefinite liveness.

**Selection rationale:** the exact population and gate caches remain
request-local and immutable, and existing source/member/fold rules can be reused
at each frontier. The cost is repeated current validation and source publication,
plus the two bounded authority extensions above.

Capturing cumulative frontier F_i processes/validates its whole population, so
capturing every page exposes `sum_i |F_i|` member processing, keying, reconstruction
and settlement, even if every eligible assessment body is reused. With p pages
adding k distinct members each, this is `k * p * (p + 1) / 2`, quadratic in page
count at fixed page size. Each capture also exposes a fresh cumulative source
result to ordinary publication. This is a logical population-work/publication
exposure, not a measured physical SQLite-write or storage-growth claim. One
active consumer request does not remove the amplification: a slow producer and
fast consumer can capture every cumulative page.

The supervisory owner accepts the small-frontier premise only for this selected
bounded correctness experiment. The charter's fixture/resource ceilings are
accepted as ceilings; the actual runtime invocation matrix, finite operation
allowance, measurement plan and concrete launcher bounds still require review
in a separately scoped runtime issue before execution.
Before full-report adoption, a later integration decision must select and justify
a frontier capture schedule and its amplification under the actual consumer
workload: it may coalesce intermediate offers or choose checkpoints, or reconsider
B. It needs explicit evidence beyond low paid-body counts and the constant-small
fixture; #297 authorizes no optimization platform, scale probe or benchmark.

The two authority extensions' implementation cost is unmeasured, but their
proposed responsibility and refusal rules are explicit. If
owner-port mapping demonstrates that they require a general runtime-input platform,
new persistence protocol, nested run or hidden source authority, reject this
formulation and return that concrete conflict rather than broaden the child.

## Candidate B: one request with incrementally admitted members

**Proposal, not selected.** Definition would declare a producer/member/fold
relationship; one long Resolution request would consume validated discovery
arrivals and key each eligible member without waiting for producer completion.
Its producer uses the same declared acquisition and Supervision operation
authority required by A. A separate terminal signal supplies closed or failed
discovery to that exact evaluation. History still publishes immutable per-PR and
collection results; no already published result grows.

B avoids a new normal request per frontier and repeated validation of already
accepted members in that evaluation. It could be simpler if a separately accepted
consumer needs long-lived incremental evaluation as its core abstraction. It
would, however, replace today's one-exact-population assumption: the design must
identify immutable membership versions, when each version becomes visible,
all-or-nothing keying of arrivals, gate/call cache scope, repeated identity rules,
provenance for members accepted before closure, the strict fold's final membership
fact, and failure/stop behavior for in-flight arrivals. A mutable `populations`
entry is not that design. The new request must own producer liveness and release
its admission resources while waiting; a pending producer cannot occupy the only
member lane needed by A. A long request also needs a bounded lease strategy under
the current no-heartbeat contract.

B does not eliminate the declared acquisition gap or the need for source-specific
consistency evidence. No new source callback return mode, subscription API or
public DSL is selected here. Before B could replace A, its reduced orchestration
cost would need to justify the larger change to Resolution's request semantics
and all affected exact-reference, gate and fold contracts.

| Question | Candidate A | Candidate B |
| --- | --- | --- |
| Where does a new member become visible? | In a new normal request capturing the next immutable frontier. | At a specified arrival/version boundary within one long request. |
| What is unchanged? | Existing captured population, member/gate caches and strict-fold rules per request. | Immutable retained results and stable PR identity; request population semantics change. |
| How is A ready during held page two? | Concurrent declared producer and R1 consumer in one run. | Producer and ready member work are coordinated inside one request. |
| How is closure/failure associated? | Explicit frontier binding or failed discovery outcome for the same run/traversal; never reuse the prior frontier as current after failure. | Explicit terminal evidence for that request's incremental population. |
| Main proposed extension | Restricted root acquisition witness, immutable request capture and coordinated terminal outcome. | Acquisition dispatch plus population versions, caches, gates, provenance, final membership and request lifetime. |
| Concrete rejection | Each frontier uses a new run or hidden mutable current source state. | Mutate the captured/published collection or let an arrival authorize a strict body before closure. |

## Supervisory selection, rationale and rejection gates

The supervisory owner selected A for the bounded correctness experiment after
review of its two restricted authority extensions, owner boundaries and refusal
rules above. Its enabling
assumption is that a small number of frozen frontiers and normal requests can
compose one live traversal without changing exact-population semantics. The
small-frontier assumption applies only to this correctness experiment; later
full-report selection must address the capture-schedule/amplification gate above.
Its sacrifice is repeated current validation and a coordination boundary. The
selection accepts that tradeoff only for the small flat experiment. It does not
select B, a public spelling, a full nested-report representation or runtime adoption.

The later runtime child must reject A or return an evidence-backed unresolved
decision if any of these counterexamples occurs:

- Page two can be acquired only through a nested `run`, untracked host helper or
  member-held call handle; the producer lacks a declared same-run capability.
- R1 must await page two before F1 can be returned, or a new run must be opened to
  see F1. Neither provides the same live invocation witness.
- The ordinary collection's finality accepts an old F1 after producer failure,
  or a mutable closure decides which frontier the request sees.
- The current summary memo is used as the driver, so its body starts before
  discovery closure; withholding only publication does not satisfy RUN-004.
- A required source revision changes inside traversal and the implementation
  continues as if the fixed-dataset premise still held.
- The actual held page-two send has a permit while A cannot obtain another
  despite the approved two-permit/two-member configuration; useful work starves.
- A publisher/consumer escapes stop or drain, publishes through a stale fence,
  silently refreshes allowance by starting another run, or reports unknown usage
  as zero after an ambiguous send.

Architecture and different-agent design review support this bounded selection,
including the restricted acquisition witness, immutable request capture and owned
declared-child bindings through soft drain. Current API absence alone is not a
contract conflict; a different viable owner-preserving spelling may implement the
same selected semantics. The actual owner-port/declaration mapping and executable
evidence remain later work. A separately scoped runtime issue must preserve these
rejection gates and obtain review of its actual execution plan within the charter
ceilings before a probe runs. Selection of this documentation decision is not
delivery of RUN-005 or closure of #170.

## Path from a flat proof to the full person workflow

The experiment uses one fixed person/query, one declared flat PR collection,
a declared PR template and a separate strict person fold. This is enough to
isolate the live handoff and unstarted-summary witness, using existing supported
flat composition rather than pretending to deliver nested fanout.

The full report still requires a declared per-person group linking roster
membership, that person's fresh producer, PR population, detail/assessment work,
and strict person outcome; the team/report consumes those outcomes. Today's
supplied source cannot own child collections, and the ordinary child declaration
surface does not supply a nested strict fold. This plan chooses no representation
for that missing group. Its required relationship is nevertheless concrete: a
person instance must bind the query from its current keyed roster record; own one
fresh traversal and its frontier; instantiate the already declared PR template
under a stable structural person/PR scope; expose one strict person outcome only
when that frontier closes and its required PR outcomes are accepted; and supply
that outcome to the declared outer report fold. The topology factory runs once
against symbolic person/PR bindings, not once per HR result. Sharing a qualified
PR between people must follow explicitly declared correspondence and current
source policy, rather than an implicit global cache or hidden person prefix.
This is an integration requirement, not a claim that current APIs express it.
At least these representation questions remain for later integration:

- How does fixed roster-person topology bind each person's acquisition and
  frontier without factories running per runtime person or hidden graph changes?
- What stable structural address relates person/query membership to the PR
  template and strict person fold across restart, and how is person removal
  reflected without changing PR subjects or silently adding cross-person sharing?
- How can independent person producers and ready PR work share one run's limits
  without an organization barrier or one blocked producer holding needed lanes?
- What frontier capture schedule controls `sum_i |F_i|` population processing
  for the actual per-person corpus, and does evidence favor coalescing/checkpoints
  under A or reconsidering B before full-report adoption?
- How do current person outcomes feed the existing outer report fold while
  preserving failed/open/closed-empty distinctions and equal-output cutoff?

A pass of the flat experiment would justify only its selected seam. It does not
settle these questions, adopt #176/#232, reopen #240, deliver #170/RUN-005 for the
assembled report, or close M6/M7. Advanced #239 scheduling, #272 scale/retry,
preview/CLI, mutable real providers and 150,000-subject qualification remain
outside the charter. Relevant first-delivery obligations stay in the
[controlled roster plan](controlled-roster.md), rather than being rewritten here.
