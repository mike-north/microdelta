> Historical artifact. Superseded by the [active specification](../../spec/README.md). Do not implement from this document.

# Design findings before implementation

This is a document audit, not an implementation verdict. Rev 9 governs; the core
spec is a downstream draft, the component boundaries are proposals, and the viewer
sketch describes a consumer. Recommendations below require an explicit recorded
decision before they become implementation contracts.

## Contradictions

**2026-09-15 scope clarification:** the user now requires analysis structure to
be known upfront, with runtime discovery limited to result instances/cardinality
within that structure. See [decisions](decisions.md). Findings concerning nested
replay and primitive provenance still need concrete bindings and read addresses,
but must no longer assume support for arbitrary novel pipeline discovery. The
source copies remain historical; this user direction governs the next design.

### C1. Reclamation can delete paid results

- **Sources:** [spec RP-3, lines 449–450](source/core-package-spec.md#L451)
  permits a predicate to reclaim any superseded or abandoned generation.
  [Rev 9, lines 137–147](source/incremental-analysis-deep-design-rev9.md#L139)
  retains attempts and says nothing paid for is deleted; [line 448](source/incremental-analysis-deep-design-rev9.md#L450)
  explicitly forbids paid-result reclamation.
- **Reproduction:** report a nonzero execution cost, supersede the generation,
  then configure a predicate returning `true`; the draft permits its deletion.
- **Required decision:** preserve the paid-result prohibition independently of
  caller policy. The meaning of **paid** remains open: cost units, zero values,
  unknown/unreported costs, and abandoned attempts need an explicit rule. Do not
  silently equate paid with a particular numeric field or merely nonzero cost.

### C2. Nested-generation comparison defeats content-based cutoff

- **Sources:** [TC-1, line 400](source/core-package-spec.md#L402) invalidates when
  a nested generation differs. [TC-4's example, line 418](source/core-package-spec.md#L420)
  says an outer result is served if the nested `headline` remains identical.
  [Rev 9, line 152](source/incremental-analysis-deep-design-rev9.md#L154)
  verifies fingerprints at the grain read.
- **Reproduction:** `summarize(pr)` produces generation 2 with the same headline
  and a different unread field; `report` read only the headline. TC-1 reruns it;
  the example requires a hit.
- **Required decision:** separate nested-invocation verification from output
  dependencies. A candidate resolution is to use invocation records to refresh
  nested results and compare only the output content the parent actually read.

### C3. Traversal records unread sibling content

- **Sources:** [MT-1, lines 529–530](source/core-package-spec.md#L531) records each
  property `get`; [FP-1, line 165](source/core-package-spec.md#L167) fingerprints
  an object from all descendants. [Rev 9, lines 104–109](source/incremental-analysis-deep-design-rev9.md#L106)
  requires member-grain sensitivity.
- **Reproduction:** reading `pr.author.name` records both `author` and
  `author.name`; changing only `author.avatar` changes the recorded `author`
  fingerprint and reruns the reader.
- **Required decision:** distinguish navigating to a node from consuming its
  whole content; define which operations consume shape, membership, or content.

### C4. Exact dry-run prediction conflicts with unknown future outputs

- **Sources:** [WR-5, line 607](source/core-package-spec.md#L609) returns an old
  generation after detecting a check-mode miss; [rev 9 SC11, line 394](source/incremental-analysis-deep-design-rev9.md#L396)
  asks the prediction to equal the actual rerun set and cost.
- **Reproduction:** an invalidated nondeterministic memo returns a new value that
  selects a different downstream branch. A check-only run using its old value
  cannot know the new branch or its subjects.
- **Required decision:** define a known/unknown frontier and pricing guarantees,
  or constrain the domain in which exact prediction is promised. This is a
  conceptual limitation requiring an acknowledged clarification, not merely a
  missing implementation detail.

## Underspecified interfaces that block implementation

### U1. Claim publication needs crash semantics and stale-holder fencing

- **Sources:** [Store, lines 334–352](source/core-package-spec.md#L336) separates
  subject CAS, generation mutations, and field writes. [RP-2, line 446](source/core-package-spec.md#L448),
  [CL-1, line 479](source/core-package-spec.md#L481),
  [CL-4, line 488](source/core-package-spec.md#L490), and
  [CL-6, line 494](source/core-package-spec.md#L496) span those operations.
- **Reproductions:** kill a process after claiming the subject but before
  inserting its generation; kill it after marking the generation current but
  before publishing the pointer; or let holder A expire, let B acquire, then
  let A finish and attempt to write/release.
- **Required decision:** specify the authoritative publication point, recovery
  of every intermediate state, and an ownership/generation precondition on
  extend, publish, and release. Atomic backend transitions or a recoverable
  publication protocol are possible mechanisms; neither is selected here.
  Tests must establish retained attempts and prevent an expired holder from
  changing a replacement claim or current pointer.

### U2. Generation allocation lacks its required information

- **Sources:** [SubjectRow, lines 305–317](source/core-package-spec.md#L307) has
  no allocation high-water mark; [nextGenerationNumber, line 434](source/core-package-spec.md#L436)
  takes only that row but promises maximum-existing-plus-one.
- **Reproduction:** attempt 1 is abandoned without a current generation. An
  allocator derived from `currentGeneration` reuses 1; reclamation can also hide
  the previous maximum.
- **Required decision:** define durable monotonic allocation under concurrent
  acquisition, including abandonment and reclamation. A subject-CAS allocation
  token is one candidate, not an adopted schema change.

### U3. Several claim operations have incomplete contracts

- **Subject creation:** [acquire, line 471](source/core-package-spec.md#L473)
  accepts no `Subject`, but [CL-1, line 479](source/core-package-spec.md#L481)
  calls `ensureSubject(key, subject)` ([line 432](source/core-package-spec.md#L434)).
  Decide whether the caller ensures the row or acquisition receives its structure.
- **Contention:** CL-1 can return `Held` after a second failed CAS even when no
  claim exists. Define a contention outcome or a retry/reread protocol that
  preserves the meaning of `Held`.
- **Duplicate execution opt-out:** [WR-3, line 597](source/core-package-spec.md#L599)
  permits an unclaimed execution and says its losing generation is superseded,
  but does not allocate that generation or define publication ordering. Define
  retained attempts, generation allocation, and pointer behavior for this path.

### U4. Reported cost durability is unclear

- **Sources:** [reportCost, line 576](source/core-package-spec.md#L578) accumulates
  cost; [WR-3, lines 599–601](source/core-package-spec.md#L601) writes it on normal
  completion or a caught failure. [Rev 9, line 147](source/incremental-analysis-deep-design-rev9.md#L149)
  retains whatever the author reported on an abandoned attempt.
- **Reproduction:** report incurred cost, then kill the process before completion.
  An in-memory accumulator loses the reported amount.
- **Required decision:** define the durability acknowledgment boundary for cost
  reports and how a swept attempt retains acknowledged reports. Do not promise
  persistence that a synchronous fire-and-forget reporting API cannot establish.

### U5. Asynchronous property reads — earlier impossibility claim corrected

- **Sources:** [MT-1, line 529](source/core-package-spec.md#L531) returns loaded
  leaf values from `Proxy.get`; [repository reads, lines 437–438](source/core-package-spec.md#L439)
  return promises. The [viewer sketch, line 54](source/analysis-explorer-viewer-sketch.md#L56)
  explicitly describes asynchronous resolution.
- **Correction:** the earlier audit assumed that the getter had to return an
  unloaded scalar synchronously. A getter can instead synchronously return a
  promise. The user explicitly allowed promise-valued properties as an option on
  2026-09-13; `await pr.createdAt` is possible without an explicit read/get method.
- **Exploration requested:** compare property promises, collectively resolved
  field bags, and PromiseLike field handles using concrete authoring snippets.
  The user has not selected a surface. Any selected API needs accurate types,
  lazy resolution, and correct read grain, without replaying paid bodies. See
  [decision](decisions.md). Primitive provenance and durable nested-call replay
  remain separate findings rather than consequences of asynchronous I/O.

### U6. Durable read addresses cannot express the proposed operations

- **Sources:** [RecordedRead, lines 103–107](source/core-package-spec.md#L105)
  has argument-relative field reads, root-only whole reads, and nested key/generation
  records. [MT-2, line 533](source/core-package-spec.md#L535) needs a whole read
  of a nested node; [WR-3, line 595](source/core-package-spec.md#L597) requires
  re-evaluating nested calls from their recorded keys.
- **Reproductions:** record `[...pr.tags]`; read `summary.headline` from a nested
  call rather than an argument; restart and verify a nested call whose arguments
  included an unidentified version string or a reshape computed inside the
  skipped parent body.
- **Required decision:** define nested-node and memo-output addresses, and how
  current nested-call arguments are reconstructed without rerunning paid parent
  work. A key made only from identities does not supply those arguments.

### U7. Paths and canonical values need a complete durable encoding

- **Sources:** [Path, lines 84–85](source/core-package-spec.md#L86) uses dotted
  strings; [FP-2/FP-3, lines 168–172](source/core-package-spec.md#L170) defines
  a partial canonical domain and an availability-dependent hash algorithm.
- **Reproductions:** distinguish the property `"a.b"` from path `a.b`; compare
  sparse arrays with explicit `undefined`; fingerprint NaN/infinities; open a
  store on a machine where BLAKE3 availability differs.
- **Required decision:** specify collision-free paths, every supported scalar
  and collection case, special-type field navigation, and deterministic algorithm
  selection. Reject unsupported cases explicitly. A fixed initial algorithm is
  a recommendation, not a decision made by this audit.

### U8. Middleware cannot represent a failure on an unmemoized named step

- **Sources:** [Outcome, lines 111–118](source/core-package-spec.md#L113)
  requires a `ResultKey` for `failed`, while an unmemoized named step has a
  keyless `ran` outcome. [MW-4/5, lines 291–294](source/core-package-spec.md#L293)
  require middleware violations and throws to be reported as `failed` on either
  stack. `MemoCtx`, `NamedCtx`, and `AnyCtx` are referenced without definitions
  ([line 579](source/core-package-spec.md#L581), [line 633](source/core-package-spec.md#L635)).
- **Reproduction:** register an around middleware that throws before `next` on
  an unmemoized named step. The generic stack must return `failed` but has no
  legitimate storage key to put in it.
- **Required decision:** define context types and keyless failures, or separate
  named and memoized outcome contracts with explicit failure construction.
  Fabricating a key or throwing instead of reporting the required outcome would
  silently change the contract.

### U9. Identified primitive pins cannot carry symbol metadata

- **Sources:** [pin, line 572](source/core-package-spec.md#L574) returns the same
  unconstrained `T` that it receives; [WR-7, line 613](source/core-package-spec.md#L615)
  says identity travels through a symbol property on that value.
- **Reproduction:** create `pin("same", "a")` and `pin("same", "b")`. Ordinary
  strings cannot retain symbol properties, while a lookup keyed by primitive
  value cannot distinguish these two identities. Boxing changes runtime behavior.
- **Required decision:** choose an explicit value carrier, an argument-binding
  mechanism, or a narrower primitive API. Preserve the distinction between an
  unidentified pinned primitive, which content verification can handle, and an
  identified primitive, which needs an identity transport.

### U10. Unnamed primitive derivations have no provenance transport

- **Sources:** [rev 9, line 121](source/incremental-analysis-deep-design-rev9.md#L123)
  requires unnamed code to compose identity from what it read. The draft accepts
  `derivedFrom` identities ([lines 195–206](source/core-package-spec.md#L197))
  but does not define how arbitrary unnamed expressions supply them.
- **Reproduction:** a proxy observes `pr.title`, but `"prefix " + pr.title`
  produces an ordinary primitive with no attached identity or provenance. An
  ambient frame can collect reads without establishing which resulting primitive
  each read produced.
- **Required decision:** define computation boundaries and value carriers, and
  state the supported provenance guarantee for ordinary TypeScript expressions.
  Proxy interception alone is insufficient to promise arbitrary primitive
  dataflow tracking. This is an incomplete mechanism, not evidence that the
  settled identity rule should be discarded.

### U11. The no-persisted-tags test needs an enforceable boundary

- **Sources:** [TK-1, lines 250–251](source/core-package-spec.md#L252) requests a
  type-level assertion that tracking types never appear in store rows. However,
  [claim progress, line 314](source/core-package-spec.md#L316) and
  [FieldRow, line 332](source/core-package-spec.md#L334) contain `unknown` values.
- **Reproduction:** assign a `Tag` object, or an object containing one, to one
  of those `unknown` members. TypeScript permits the assignment; inspecting the
  declared row types cannot prove that runtime values exclude tags.
- **Required decision:** define a serializer or caller boundary that enforces
  the intended guarantee, and test it at that boundary. Possible approaches
  include a validated serializable value domain and explicit rejection of
  process-local tracking objects. This is a validation gap in an underspecified
  boundary, not an observed violation of rev 9's no-persisted-tags rule.

## Lower-priority contract maintenance

- **Dependency graph drift:** identity calls fingerprint in
  [ID-5, line 219](source/core-package-spec.md#L221), while
  [components, line 56](source/incremental-analysis-components.md#L58) permits
  only name. Claim takes and invokes a live repository
  ([spec, lines 476–479](source/core-package-spec.md#L478)), while
  [components, line 107](source/incremental-analysis-components.md#L109) permits
  its schema only. [WR-8, line 616](source/core-package-spec.md#L618) says only
  wrapper imports both track and repository, although materialize intentionally
  does so ([components, line 116](source/incremental-analysis-components.md#L118)).
  Record any boundary corrections before mechanically enforcing the graph.
- **Acceptance-test ID drift:** [spec, lines 718–725](source/core-package-spec.md#L720)
  renames ST3 to chains and defers ST4 as helper work. In
  [rev 9, lines 413–414](source/incremental-analysis-deep-design-rev9.md#L415),
  ST3 is two grains and ST4 is storage-backed values. Preserve upstream IDs;
  lazy reads and no-load verification are core acceptance obligations.

## Store and lifecycle conformance inventory

The draft baseline is [SA-1–SA-7](source/core-package-spec.md#L358). Implement
tests against both backends for that baseline, then add cases supported by the
recorded decisions resolving the findings above:

- Same-key insert/CAS races; one CAS winner; failed CAS leaves data and version
  untouched; successful CAS increments once; independent keys remain independent.
- Duplicate insert rejection and row/value mutation isolation after writes and reads.
- Supported-value and path roundtrips; missing-path semantics; bounded field
  batches; fingerprint-only reads instrumented to prove payloads were not loaded.
- SQLite persistence after close/reopen and races through independent connections
  or processes; schema and algorithm mismatch refusal without mutation.
- Expired-claim query boundary, ordering, ties, and limits; repeat progress rejection
  without lease mutation; renewal-versus-sweep races.
- Claim creation/publication/abandonment crash boundaries; stale-holder rejection;
  allocation numbers never reused after abandonment, reclamation, or restart.
- Wait completion on publish, abandonment, and sweep; caller re-verification using
  its own arguments; no waiter-owned execution permit or renewal.
- Retention of acknowledged cost reports after process death, and the decided paid
  reclamation prohibition even with a permissive caller predicate.

Numeric lease, polling, sweep, and tracing defaults; Node/ESM/AsyncLocalStorage;
argument-order subjects; and pinned-string encoding are reversible assumptions.
They should be recorded but need not block independent leaf work. Publication,
allocation and nested replay must be settled before their interfaces are treated
as stable. Promise-valued reads are possible; the authoring-surface comparison is
now explicitly requested before choosing their form.
