> Historical artifact. Superseded by the [active specification](../../spec/README.md). Do not implement from this document.

# Test-first plan for the scoped authoring surface

**2026-09-26 roadmap update:** [the milestone plan](../../milestones.md) now defines
the delivery sequence. Use this document's detailed scenarios and test obligations
where they remain consistent with later decisions. Design exploration and
executable experiments are scoped milestone work, rather than prerequisites to
planning all implementation. The older leaf-first sequence below does not require
finishing every optional facility before proving durable restart behavior.

**Prepared 2026-09-15.** The user selected scoped analysis context and requested
this implementation plan. This selects Option A's context-access direction; it
does not approve every experimental wrapper, collection, observer, or storage API.
No runtime implementation is part of preparing this plan.

**2026-09-16 next authoring fixture:** the user selected the
[HR roster → paginated PR complexity → per-person summary scenario](scenarios/hr-roster-pr-complexity.md).
Use it to exercise required memo identity callbacks and pagination/fold boundaries
before treating the earlier comparison's signatures as implementation contracts.
The first internal context leaf remains independent of those unresolved APIs.

The [concrete roster example](exploration/roster-example/README.md) now exercises
that scenario with object definitions and an explicitly proposed `retrieval`
constructor. Its application-policy tests and type checks are executable; the
managed runtime, scheduling, durable reuse, and nested-verification guarantees
remain future integration work. Use its validation table as a test-first handoff,
not evidence that higher layers already exist.

The subsequent [validation API review](exploration/roster-example/validation-api-review.md)
recommends one memo constructor with explicit author validation. It traces cold
miss, current finality, partial validation/reuse, and changed policy/prompt cases,
and assigns V1–V11 lifecycle assertions to repository, wrapper, observation, and
concurrency tests. These are proposed integration rules alongside the settled
hook/reuse semantics, not implemented guarantees or a selected public export.

**2026-09-16 settled source-retrieval behavior:** the scenario's discovery step is
non-memoized; per-PR retrieval receives the previous eligible completed result
and can return either newly retrieved data or an explicit reuse outcome. Reuse
preserves result provenance while recording the current acceptance attempt and
its observed work separately. Source logic can perform staged checks and stop
early without additional mandatory lifecycle hooks. Carry this decision into
wrapper, publication, and observer design; exact syntax and durable storage
integration remain to specify. See the explicit retention decision in
[decisions](decisions.md).

**Settled finality mechanism:** an optional method/callback on the current node
definition is the source of truth. Evaluate it against the eligible cached result
and current analysis inputs whenever finality is needed. Never persist a finality
flag, node state, or equivalent database assertion. Prior true answers must not
skip later hook evaluation. This supports immutable data, terminal snapshots,
and input-relative policies such as a time range; changed inputs or corrected
hook logic can change the answer without database invalidation. True can skip
source refresh; false/absent follows normal policy, which can still reuse data.
Write tests for repeated resolution, changed inputs/logic, storage reopen, and
cached outer consumers before wrapper integration. Exact hook syntax remains open.
Immutable source data does not freeze downstream calculations when their inputs
or code change, and analysis-specific exclusion does not imply complete discovery.

Governing inputs: [decisions](decisions.md), the
[authoring comparison](exploration/concrete-authoring-options.md), the
[contribution scenario](scenarios/github-contribution-analysis.md), and the
[component sequence](source/incremental-analysis-components.md). Later explicit
user decisions govern where they revise supplied documents. Preserve the original
core dependency order; add helper and CLI behavior at their own boundaries.

## Outcome and current baseline

The intended outcome is a real analysis that an author can inspect, run on a
trial population, observe, cancel, revise, and rerun, with valid completed work
reused and observed resource consumption reported honestly. Plain domain helpers
stay plain TypeScript; a body accesses `analysisContext()` only when it needs run
facilities. Environment selection flows through nested work without parameter
plumbing or shared mutable process state.

Source inspection currently finds the memory store, naming, and internal tracking
facade. There is no completed durable analysis runtime, SQLite backend, reference
materializer, claim lifecycle, or helper pipeline to extend as if those existed.
The comparison examples compile against experimental declarations only. Context
integration must not be mistaken for completion of the whole analysis engine.

Keep the original memory-store conformance and tracking/name tests as regression
gates. Preserve exact upstream acceptance IDs when adding core steel threads;
helper/CLI scenarios get additional descriptive tests rather than renumbering ST
cases. No publication or deployment is included in this plan.

## First implementation slice: scoped context as an internal leaf

Start with a deliberately small context mechanism after recording its dependency
boundary. Proposed location: `packages/core/src/context/index.ts`, with focused
runtime tests and type tests alongside the existing component tests. This is a
proposed addition to the component graph, not permission to bypass its enforced
allowlist. Update the local boundary amendment, tooling rule, and graph test
before introducing imports. Keep the supplied source documents unchanged.

The leaf owns scoped access, immutable environment selection, and frame lifetime.
It does not own a scheduler, retry policy, provider client, store, or price table.
The eventual wrapper installs execution frames; tests use a private installation
helper. Do not export a public scope-construction/testing API merely to make the
implementation tests convenient.

Write these behavioral tests first:

| Test | Required result |
| --- | --- |
| Access outside an installed execution | Clear error; no fabricated default environment. |
| Access before/after several awaits | Same selected environment and active execution frame. |
| Concurrent trial and production executions | Each sees its own context under forced interleaving. |
| Nested execution and return | Child sees inherited environment and its own execution attribution; parent frame is restored. |
| Child throws or is cancelled | Parent/sibling contexts are preserved; cleanup does not leak the failed child. |
| Escaped asynchronous callback after frame completion | Cannot acquire a live context or record new work against the closed frame. |
| Retained context object | Its execution operations reject after closure; already-read immutable environment data need not be erased. |
| Attempt to change environment | Rejected or impossible through the public type; no mid-run store rerouting. |
| Context versus tracked reads | Merely retrieving context does not consume application fields or contaminate the existing tracking facade's frame. |
| Lazy async-generator execution | Body access after generator creation, across awaits and yields, sees the intended frame when iteration resumes. Creating the iterator alone does not prove scope propagation. |
| Generator completion, early return, or throw | Cleanup runs in the intended scope; the execution closes only at its terminal boundary and cannot record work afterward. |

Use deferred promises/barriers rather than timing-dependent sleeps. Implement only
the mechanism needed for these tests. Cancellation/reporting facilities may be
injected private test doubles until their contracts are settled; do not freeze
experimental `record(): void` as a durable reporting API.

**Gate:** this leaf passes its runtime/type tests and existing workspace checks.
It remains internal until wrapper integration exercises the public accessor.
This is an independently useful milestone, not a functioning analysis API.

## Contracts to settle before their dependent implementation

These are explicit design tasks with a recommended direction, not unanswered
questions silently converted into defaults. They need short contract amendments
and concrete counterexamples before dependent code is written. Independent leaf
work above need not wait for every row.

| Contract | Recommendation to formalize | Blocks |
| --- | --- | --- |
| Value domain, paths, field reads | Collision-free structured paths, deterministic canonicalization, and separate address traversal/content consumption. Resolve C3, U7, U11. | Fingerprint, identity, materialize. |
| Durable identity and replay | Stable source/member keys and recorded binding addresses; content-based cutoff at the fields read. Ordinary resolved primitives do not carry invisible provenance. Resolve C2, U6, U9/U10 and remaining subject-order decisions. | Repository verification and wrapper. |
| Required memo identity callback (2026-09-16 clarified decision) | Every memoized step definition must supply the author's identity function; no implicit default. Recommend allowing non-memoized steps without it. Specify callback input access, timing, output domain, namespace, name/revision relationship, and collision handling separately from plan/invocation labels and collection member keys. | Final memo definition types and durable identity integration. |
| Publication and generation allocation | A fenced, recoverable protocol with a single authoritative publication point and durable monotonic allocation. Specify every crash/interleaving state, including stale writers. Resolve U1–U3. | Claim, SQLite lifecycle, completed-result reuse. |
| Explicit source reuse (settled behavior, integration to specify) | Prior-result access and a distinct reuse outcome are required. Test local acceptance, remote revalidation, and fresh equal-valued retrieval as distinct activities; preserve original payload provenance and current observed work. Specify prior-generation eligibility, concurrency, acceptance metadata, and verification of cached outer consumers. | Source retrieval wrapper, publication integration, and observer outcomes. |
| Context/configuration semantics | Environment chosen once before store/client construction. Keep volatile runtime context out of cache inputs; represent output-affecting configuration as explicit inputs or a declared version. | Public context and runtime construction. |
| Environment isolation | Separate trial storage by default, covering claims, heads, observations, and cleanup as well as result rows. Resolve actual store namespace ownership, not just differing labels. | Trial/production integration. |
| References and names | Retain simple named-function calls and field awaits as the working candidate; settle whole-value reads, `then` collisions, optional values, name overrides, and durable versions. | Public type surface. |
| Observation durability | Separate receiving an observation from acknowledging persistence. Prefer an awaitable acknowledgment for a report promised durable; a synchronous enqueue cannot imply crash durability. Specify failure/backpressure and delta deduplication before final signature. | Durable usage reporting and crash assertions. |
| Cancellation lifetime | Define first-interrupt soft-stop boundary, second-interrupt escalation, shared-work ownership, publication race, and cleanup deadline. Pass cooperative signals and use capable adapters without asserting remote termination. | End-to-end cancellation and CLI shortcuts. |
| Retention | Preserve the governing paid-result retention guarantee; define unknown/unreported usage explicitly. Never use absent observed currency as proof an attempt was free. Resolve C1 independently of generic metrics. | Reclamation. |

Exact lease/polling defaults and display formatting can remain documented,
reversible choices. They must not be used to conceal missing lifecycle semantics.
The optional `.withContext` API is not part of the selected primary surface.

## Delivery sequence and test gates

Every stage follows: derive tests from the contract → observe relevant failures →
implement the minimum behavior → pass focused tests → run the applicable existing
checks. Comments explain public contracts and non-obvious lifecycle decisions.
Do not write tests that merely repeat implementation structure.

### 1. Complete the remaining core leaves

Continue `fingerprint`, `identity`, and `middleware` in the original dependency
order once their corresponding amendments above are concrete. Reuse the existing
store, name, and tracking work. The context leaf can proceed independently under
its recorded graph amendment.

**Tests first:** canonical value/path edge cases; field versus whole-value grain;
array length and membership; named/unnamed and primitive identity boundaries;
revision forks; middleware ordering, stops, and keyless failures. No tag or live
context can be serialized into storage. Use instrumented fakes where appropriate.

**Gate:** each leaf has its own green contract tests; no later module substitutes
for missing leaf correctness.

### 2. Repository, claims, tracing, and durable storage

Implement the second layer against dependency fakes before assembling it. Add the
SQLite backend and run the same store conformance suite plus reopen and independent
connection/process tests. Provider credentials remain external configuration.

**Tests first:** one-winner claims; monotonic generation allocation across abandoned
attempts and restart; interrupted publication at each durable boundary; stale
holder unable to publish/release/renew a successor; retained acknowledged usage;
no double-counting replayed observation records; fingerprint checks perform zero
payload reads. Test the retention contract with a permissive reclamation predicate.

Generic observations carry units/resource scopes and execution attribution.
Reported units survive a later body failure when their persistence was acknowledged.
An operation with no usage report creates no invented numeric quantity. An estimate
is not added to observed currency. These obligations do not require a provider
billing API or inference about unseen charges.

**Gate:** memory and SQLite conformance pass, and process-failure tests establish
the chosen protocol rather than merely testing normal close/reopen.

### 3. Materialization, references, and wrapper assembly

Build `materialize`, then the thin `wrapper`, preserving the component sequence.
Integrate the internal context installer here and expose the selected scoped
accessor once its lifetime is exercised in real wrapped work.

**Tests first:**

- Calling wrapped functions builds bindings with zero body/provider calls.
- Reading a selected field loads and records only the required grain; address
  navigation does not consume siblings. `refs.all` and individual awaits agree.
- Conditional loading continues the same body and never replays an earlier paid
  call. An async helper returning a thenable resolves it according to JavaScript;
  documentation and type tests do not promise identity survives that boundary.
- Cold execution, identical rerun, changed consumed field, changed unread field,
  and changed revision have the expected invocation counts and result identities.
- Nested generation change with unchanged consumed content cuts off recomputation.
- Two concurrent runs and nested tracked calculations retain separate contexts,
  dependency frames, cancellation scope, and observation attribution.
- A new context/run ID alone does not invalidate results; changed semantic
  configuration cannot incorrectly reuse them.

**Gate:** original core steel threads (including ST0–ST3 before explain) and
relevant storage-laziness, claim, and no-replay cases pass on real storage.
Do not expose speculative APIs simply because their ambient declarations compiled.

### 4. Explanation and structural planning

Implement core explanation over repository evidence. Expose a plan-construction
contract that helpers can extend with member templates in the next stage.
Planning executes pure composition callbacks, never source or computation bodies.
Unknown cardinalities and conditional reuse remain visible.

**Tests first:** inspect a plan with forbidden source/body spies and assert zero
invocations; show named selection and fan-out placeholders; reject attempted
value resolution during construction; assert reasons for confirmed cache decisions
and preserve unknowns otherwise. A synchronous arbitrary JavaScript callback's
purity cannot be proven by the TypeScript signature alone—document the supported
boundary instead of claiming a general sandbox.

**Gate:** explanation matches stored evidence; planning makes no exact future-cost
or cardinality promise. Reconcile C4 with the selected plan-plus-trial workflow.
Run the original SQLite performance/scale acceptance before adding infrastructure
based on presumed bottlenecks.

### 5. Helper composition, collections, and trial execution

Keep fan-out admission, request retry/backoff, provider quota waits, and resource
concurrency in helpers/application adapters rather than core. Resolve package
placement and dependency edges explicitly before adding the helper package.

**Tests first:** stable keyed membership under filtering/reordering; nested bounded
fan-out; per-person discovery closure; closed-empty versus undiscovered; no
premature memoized judgment; one person completes while unrelated people wait;
independent sibling continuation; explicit `.settled()` fold retains errors and
responds when a failed member is repaired. Source discovery errors cannot masquerade
as complete partial membership. Scheduled retries are pending, not terminal failures.

Trial tests exercise ordinary author-defined filters, not a sampling engine:
selected people retain full histories; excluded expensive work has zero admissions;
trial reruns reuse valid trial work; changed membership affects the right aggregates;
production ignores trial-only rules; clearing trial storage leaves production
results and claims untouched; concurrent environments do not contend on shared
mutable state. Seed the same result keys with distinct values in both stores and
prove a trial evaluation never reads the production rows, including lookup and
verification paths, and prove the corresponding production evaluation never
reads the trial rows. Recover a trial run under a process whose default environment
is production: it must reconstruct the recorded trial environment/store/client
selection or fail clearly before admitting work. Store durable references to
configuration, not raw credentials. No automatic cross-environment promotion is
implied.

Cancellation tests use a controlled adapter and deterministic barriers: stop
admitting new participating work after cancellation; honour the chosen active-work
policy; prevent retry/reset timers from reviving a cancelled run; preserve valid
completed results and observed usage; distinguish local stop from remote requested
or confirmed cancellation. Test the completion/publication race and shared-consumer
ownership according to the contract from the preceding table.

**Gate:** the contribution fixture runs through all stages in trial and normal
environments using the same program; the helper layer preserves core invariants.

### 6. Preview observation, CLI supervision, and final acceptance

Use the observer seam to surface the running program. A React viewer is not
required for this slice; a deterministic structured event stream precedes terminal
rendering. Human-facing output remains a consumer of lifecycle state.

**Tests first:** a histogram emits finite provisional snapshots during continuous
arrivals, including status-only changes and the final throttled state; retained
stale values carry errors; unavailable is not zero/empty; observing alone performs
zero memoized source/LLM calls. A verified read never returns a provisional value.
Assert bounded event buffering, unsubscribe cleanup, and useful failure detail.
Renderer errors must not turn committed success into a paid retry.

Exercise generic observed quantities: tokens, quota units, and data volume roll up
once under their own scopes/units. Cache history is separate from new consumption.
Include the [missing cached-input breakdown](scenarios/observed-usage-and-estimated-cost.md)
case: exact reported tokens, unknown cached fraction, estimated—not observed—currency.
Also test one request reporting 100 units followed by a failed request with no
usage report: show 100 observed units and the known reporting gap, not a guaranteed
total of 100. No final-bill reconciliation is required. CLI interrupt behavior
follows the contract resolved in the cancellation design task above, not an
incidental signal handler; exact soft/escalation boundaries are not yet settled.

**Gate:** the full acceptance walkthrough below passes with controlled providers,
plus relevant original core tests. End-to-end performance measurements distinguish
live references, loaded payloads, promises, and stored results; no scalability
claim is based only on a responsive terminal.

## Full acceptance walkthrough

Use deterministic directory/PR/model fixtures and a controlled clock. No paid
provider calls are needed to establish correctness.

1. Inspect the trial plan: structure is visible, counts remain unknown where
   discovery has not occurred, and no provider body has executed.
2. Run trial selection through source discovery, facts, histograms, judgments,
   team outcomes, and final report. Show selected scope and actual observed usage.
3. Observe multiple histogram updates before the first complete person corpus;
   assert zero premature judgment calls. Then let one person finish independently.
4. Fail one person and defer another under a recoverable quota policy. Unrelated
   work proceeds, failed member details remain inspectable, and the scheduled
   retry is visibly pending. Request-level retry within a live body does not
   restart its earlier requests. After process failure, reuse is at completed
   memoized-step boundaries; no general request checkpointing is implied.
5. Rerun unchanged: eligible completed work is reused. Change prompt or a consumed
   field: only the semantically affected work executes; old successful results
   remain retained under the governing contract.
6. Cancel during an expensive request, including a fixture that cannot confirm
   remote stop. No false remote-stopped or zero-cost claim is emitted; no automatic
   retry revives the run. Verify the chosen publication and cleanup rules.
7. Kill a process after a durable observation acknowledgment but before result
   publication. Recover its retained attempt/observation without fabricating a
   successful result. An unacknowledged report is not claimed durable.
8. Switch to the production environment. Its storage/configuration is separate;
   trial cleanup cannot damage production. Output explicitly identifies scope.

## Completion reports and review boundaries

For each gate report: implemented contract, tests added first, check results, and
remaining dependent work. A green context leaf or memory backend is not full core
completion. Use focused Jest runtime tests, tsd type tests, shared store conformance,
and applicable workspace type/lint/dependency checks. Recheck on supported Node
versions at runtime milestones; do not infer cross-version support from one host.

The immediate coding entry point, if implementation follows this plan, is the
private context leaf and its boundary amendment. The public authoring surface
comes later at wrapper assembly. Contract decisions listed above are resolved
before their dependent gates, rather than hidden inside the implementation.

### Baseline verification when preparing this plan

On 2026-09-15, `npm run check` and `npm test` passed in this checkout. This includes
four dependency/tooling tests, 69 existing runtime tests across three suites,
the package build, and existing type tests. These results establish the current
lower-layer baseline only; none of the new plan's runtime tests exists yet.
