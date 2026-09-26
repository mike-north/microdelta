# Domain, scope, and vocabulary

Status: normative target. Parent: [specification entry point](README.md).

## Purpose and scope

**DOM-1 — Durable incremental analysis.** A normal lifecycle is define an analysis,
run it for hours if needed, exit completely, then run it again later with changed
inputs and code. Reuse must survive that lifecycle. Minimize unnecessary work of
whatever kind the author memoizes; do not define expensive as synonymous with LLM,
network, CPU, or elapsed time. Nondeterministic judgments are valid retained results.

**DOM-2 — Ordinary authoring.** Provide a clear TypeScript path using scoped analysis
context, ordinary value reads and tracked function calls, and explicit memoization.
The context carries the run's environment, storage/services, cancellation and
resource-reporting facilities. Authors must not thread an infrastructure parameter
through every call or duplicate manually the fields that execution reads. Runtime
context lookup outside a live scope fails clearly. Exact constructor names remain
experimental. Observability applies to nonmemoized work too.

**DOM-3 — Scale and materialization.** Expensive small results and cheap enormous
source datasets must use the same semantic model. Storage-backed values load only
what consumption needs, with bounded caching and reclaimable materializations.
Fingerprint verification should avoid payload loading where recorded fingerprints
suffice. Fanout memory is bounded by admitted work, not full corpus cardinality.
Do not require authors to write custom projections simply to keep an unread payload
out of memory. Prefetch predictions cannot change correctness: an unprefetched
read loads and records the requested field rather than reporting a semantic change.
The concrete asynchronous loading surface is an experiment, not a promise that a
synchronous JavaScript getter can perform arbitrary asynchronous I/O.

## Distinct concepts

| Term | Meaning | Must not be confused with |
| --- | --- | --- |
| Analysis | Declared computation and logical namespace | One execution attempt or one giant memoized step |
| Environment | Selected store/services/credentials and isolation scope | A cache-key string alone |
| Run | Supervised execution lifetime | A result or one worker |
| Step definition | Declared operation, implementation and policy | Invocation, display name, stored snapshot |
| Binding | Current relationship connecting a declared operation/input/slot | Function text or an old snapshot pointer |
| Step graph | Fixed abstract operations and possible relationships | Expanded result cardinality or observed read set |
| Result graph | Invocations/results and actual observed relationships | A persisted live proxy graph |
| Subject | Complete opaque author-supplied memoization identity, unique in an analysis | Output content hash or display name |
| Compatibility version | Per-memo positive integer, default 1; controls eligible history, permits validated rollback | Diagnostic timestamp or implementation locator |
| Implementation fingerprint | Automatically observed implementation evidence | Identity of a definition or proof of semantic equivalence |
| Result | Immutable completed author value plus framework metadata | Failed attempt or reference |
| Reference | Scoped pointer to an exact retained snapshot | Payload, latest alias, or request to compute |
| Attempt | Work performed trying to produce or accept a result | Guaranteed successful output |
| Acceptance evidence | Why a previous result is usable under current conditions | A rewrite of its historical provenance |
| Observation | The semantic fact an execution consumed | All fields reachable from an object |
| Identity | Which logical entity/member this is | Automatic dependency of every field read |
| Finality | Current hook's acceptance of a cached result for this resolution | Persisted final status |
| Resource observation | Reported quantity/unit/attribution of actual work | Invoice total or an estimate |

**DOM-4 — Independent axes.** Identity, content, storage, readiness, observation,
source acceptance, and permission to execute are separate. Selecting memoization
adds durability/reuse; it does not invent entity identity, determine provider cost,
or make every intermediate update eligible for expensive recomputation.

## Non-goals and deferred work

**DOM-5 — Explicit limits.** No partial reevaluation inside a memoized body; authors
split independent work into steps. No arbitrary closure serialization, general
JavaScript purity proof, hidden-environment detection guarantee, or resumable JS
stack after a crash. No deterministic-output requirement for LLM/random judgments.
No guarantee of exactly-once remote side effects or recovery of an unreported
provider bill. No automatic reconstruction of invoice currency from token counts.
No result-driven mutation of the abstract graph. A graphical viewer, browser runtime,
smart trial sampling, extensive distributed scheduling, class-aware `tracked()`
support and broad native-value support are deferred. Class visibility inspection
in architecture tooling does not imply class support in tracked author values.

## Worked minimal example

**DOM-6 — Expected behavior.** A source produces PR `{ id, title, labels }`. A memoized
assessment reads only `title` and tracked prompt/model configuration. On a later
process run the current source policy is consulted. A new label alone preserves the
assessment's exact result reference; a changed title recomputes that assessment.
A new source snapshot with equal title may be retained as current source data while
the assessment keeps its older exact result. A changed tracked assessment
implementation also triggers the applicable validation. An unrelated PR is unaffected.

This example proves neither provider validator coverage nor arbitrary function
purity. It defines the expected value/identity/cost separation exercised in
[acceptance](acceptance.md) and [execution](execution.md).
