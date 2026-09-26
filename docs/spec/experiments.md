# Bounded experiments and mechanism gates

Status: planned, none executed by specification consolidation. This is the work
queue after M0.5 establishes the tooling and Machine foundation. Requirement IDs in the
linked contracts govern expected behavior; an experiment may reject a mechanism,
not quietly weaken the behavior to make its prototype pass.

## Common experiment contract

**EXP-0 — Evidence before adoption.** Each experiment produces a small fixture,
assertions written before the proposed implementation, exact reproduction commands,
pinned tool versions, observed results/counterexamples, a recommendation, and a
coverage limit. Preserve failing counterexamples. Use controlled/fake paid work.
Set a bounded input domain and candidate set before coding; expand only to resolve
an observed failure. Output is a mechanism decision and amendment to the owning
contract, not a claim that the runtime is complete.

`Pass` means the defined evidence supports the mechanism within its declared scope.
`Reject` means a counterexample defeats it. `Inconclusive` means the evidence is
insufficient; report what is missing. Lack of a parser, toolchain, or time is never
silently treated as proof. Do not ask the user to choose routine schema details;
escalate only a conflict with settled behavior or a material product tradeoff.

**Prerequisite:** M0.5's strict TypeScript, type-aware lint, generated declaration
views, fail-closed import checks, deterministic CI, and Node Machine boundary are
in force before runtime experiments EXP-1/2/3. Each new host capability used in
an experiment has a contract and Node conformance test before its result counts
as runtime evidence. EXP-5 investigates CML correspondence separately; its
outcome does not decide whether baseline API Extractor enforcement exists.

## EXP-1 — Current binding and implementation evidence after restart

**Question:** can ordinary imported tracked objects/functions and current declared
input/callable slots reconnect to historical observations without source hashes,
names or call order becoming locators?

**Scope:** one nonmemoized producer, one memoized consumer, one imported tracked
config and helper; two separate Node processes; two reordered member invocations.
Add one supplied callable slot. No streaming engine or broad closure analysis.

**Assertions first:** unchanged input retains exact result; consumed-field/helper
implementation edit invalidates; unread-field/display-label edit does not; fresh
registration order and object allocation do not affect identity; missing or
ambiguous current correspondence yields a diagnostic/miss, never guessed reuse.
No durable tag/revision/closure survives serialization. Same source text with changed
tracked captured configuration still invalidates. A call to an uncalled tracked
helper is not invented as an observation.

**Decision outputs:** concrete current binding registry/descriptor strategy;
implementation fingerprint input and build-artifact implications; the concrete
protocol combining automatic evidence with the settled compatibility version
(per memoized step, positive integer, default 1, rollback allowed after normal
validation). Version selects an eligible history group; it does not bypass
current implementation/input evidence. Rollback never deletes newer history or
silently rewinds a current pointer. Public naming is secondary to the behavior.

**Gate:** settles dependent durable schema and M2/M3 work. Links:
[tracking TRK-2/3](tracking.md), [composition CMP-6/7](composition.md),
[execution](execution.md).

## EXP-2 — Values, observations, and materialization boundary

**Question:** what bounded value domain and canonical encoding preserve the
observation decision table across serialization and selective loading?

**Scope:** JSON-like records/arrays plus explicit treatment or rejection of each
edge case in VAL-2. Cover Property('0') vs Index(0), missing vs undefined, own vs
inherited existence, array length, selected fields, and a uniform collection
projection. Do not implement all native types merely because they exist.

**Assertions first:** table-driven observation equivalence/counterexamples;
roundtrip equality; unambiguous paths; SHA-256 consistency; duplicate-key rejection;
no silent omission of unsupported data; no payload reads for fingerprint-only
verification with an instrumented positive control; field loading and output
materialization preserve observations. Test a nonblocking/synchronous access
candidate only where its backing-store assumptions justify it; separately test
any explicit asynchronous preparation/access mechanism against normal scalar
reads. No primitive proxy emulation.

**Decision outputs:** supported-value/access matrix; canonical format version;
selection/projection representation; current evidence schema; materialization I/O
surface and bounded cache ownership. Preserve a single logical dependency for a
uniform projection without claiming arbitrary early-stop evidence is constant size.

**Gate:** settles M2 and durable encoding before M3. Reject incompatible formats
explicitly; do not migrate stored data by guessing.

## EXP-3 — Atomic publication and recovery protocol

**Question:** can the first durable backend implement History's combined
claim/allocation/publication authority with explicit crash boundaries?

**Scope:** tiny SQLite fixture is the recommended candidate; first enforce a
single-writer limitation if used, then model concurrent fencing before M5. Start
from the required invariant, not the old Store's row layout. Account for payloads,
fingerprints, provenance, current pointer and allocation together.

**Assertions first:** kill a writer at every authoritative boundary; no partial
result accepted, old complete result still readable, allocation not silently reused,
new complete result survives reopen. Inject stale publish/renew/release after
reclaim; none alters the current holder. Failed writes do not advance pointers or
produce completed snapshots. Faults after successful commit cannot turn observer
failure into a recomputation. Distinguish commit success from lost acknowledgment.

**Decision outputs:** transaction/linearization points, fencing token lifecycle,
attempt recovery states, writer model, migration/version metadata, conformance
suite changes. If the backend cannot support the invariant, reject the backend or
protocol rather than weaken retained history.

**Gate:** publication design before M3; concurrency proof before M5. A successful
SQLite transaction alone does not qualify all backends.

## EXP-4 — Nested arguments, higher-order bindings, and skipped members

**Question:** which reconstructible nested invocation forms preserve output cutoff
without replaying a skipped paid parent?

**Scope:** one supplied assessor slot, one frozen fanout template, one gate; forwarded
references, derived scalar arguments with evidence, and one intentionally
unreconstructible argument. Add changed graph correspondence as a negative case.

**Assertions first:** child changes but selected output remains equal → parent
reference retained; output changes → parent runs; current child source hook consulted;
unjustified argument → ordinary parent miss; template built once; frozen topology
cannot be mutated; tracked gates alter instances not graph; skips differ from
undefined/pending/error. Verify custom/default keys and duplicate diagnostics.

**Decision outputs:** nested invocation record/argument recipe; permitted supplied
callable interface; strict fold treatment of skip with no implicit partial success.
No general closure serialization or result-created topology.

**Gate:** M4. Can follow the small durable MVP; it does not delay M2 for arbitrary
nested cases.

## EXP-5 — Native CML correspondence to established package contracts

**Question:** which existing CML subset maps faithfully to our package/context,
class structure and exported contract models, at acceptable tooling cost?

**Scope:** two tiny workspace packages, own/sibling/external/beta consumers, one
class with native TS modifiers and `#` members, standalone function/interface/type
exports, and internal declarations. Reuse the M0.5 public/beta/alpha/untrimmed
API Extractor rollups and read `.api.json` with its maintained model library. Explicit sibling
`paths` point at alpha declarations. CML syntax is unchanged; use its official
parser/library, not a handwritten full-language parser. Java tooling is a build
concern only. Generic text/JSON export is a candidate bridge, not selected runtime
infrastructure.

**Assertions first:** take the passing PKG-007 consumer boundaries, underscore
enforcement, missing-declaration failure, and release-tier independence as
baseline fixtures, then test the additional CML mapping. A TypeScript public
alpha member remains project-private; `#` privacy is not collapsed into a
release tag. Compare represented names, parameters, return
types, ownership and permitted type references. Deliberately mutate each represented
fact and show the checker detects it. TypeScript-only structures with no faithful
CML counterpart produce explicit unsupported coverage, never a false match.

**Decision outputs:** a mapping table from native CML concepts to compiler/API facts;
explicit bounded-context→package/port mapping; parser-validated `.cml`; extraction
artifact and conformance checks; cost/setup assessment; adopted subset and omissions.
Do not force generic unions, overloads or internal implementation detail into an
inaccurate CML equivalent. Release-tier metadata representation is an experiment
outcome. CML relationship arrows alone do not define TypeScript import permission.

**Gate:** decide whether a bounded native CML model adds reliable architecture
correspondence after basic API Extractor and import enforcement already pass.
The chosen semantic package tiers remain requirements even if the CML
experiment is rejected. It cannot block M1 runtime experiments or M2 merely
because CML lacks a faithful counterpart for a TypeScript construct.

Primary references: [CML library](https://contextmapper.org/docs/library/),
[tactical syntax](https://contextmapper.org/docs/tactic-ddd/),
[generic generator](https://contextmapper.org/docs/generic-freemarker-generator/),
[API Extractor configuration](https://api-extractor.com/pages/configs/api-extractor_json/).

## EXP-6 — Lean semantic pilot

**Question:** does a small proof model help keep structured paths, projections and
observation normalization correct enough to justify ongoing maintenance?

**Scope:** choose one independently stated theorem, such as normalization preserving
observation meaning over the chosen bounded value algebra. Model explicit assumptions
and error cases. Do not model the whole runtime or pretend memoized LLM work is
mathematically deterministic.

**Assertions/proof target first:** accepted/rejected counterexamples from TRK-5 and
VAL-1/2; a theorem over all modeled values under explicit assumptions; no `sorry` or
unreviewed new axioms. Hash collision resistance is an assumption, not value equality.
If an executable Lean oracle is practical, compare independently generated cases
with the TypeScript experiment; do not copy production branches into the oracle.

**Decision outputs:** checked proof, assumptions and trust boundary, differential
fixture, toolchain/reproduction and maintenance assessment. Proof of the model is
not proof of TypeScript implementation; distinguish oracle agreement from theorem.

**Gate:** adopt or decline the proof artifact before making it a required CI tool.
It is not a prerequisite for every unrelated context. Reference:
[Lean proof validation](https://lean-lang.org/doc/reference/latest/ValidatingProofs/).

## EXP-7 — Publication state-model pilot

**Question:** can a compact TLA+/PlusCal model expose protocol errors around claim
expiry, stale workers, crashes and acknowledgment before concurrency implementation?

**Scope:** minimal contender count and finite state instance for TLC; explicit
safety invariants and any liveness/fairness assumptions. Couple model actions to
EXP-3 protocol boundaries, not to an independently invented publication algorithm.

**Assertions first:** only authorized current holder publishes; no incomplete
snapshot reachable; acknowledged completed history remains readable; expired holder
cannot renew/release another holder; counters/fences survive restart. Include a
known-bad interleaving as positive control for the model checker.

**Decision outputs:** machine-checked model, counterexample traces, explored bounds,
assumptions, and implementation-test mapping. TLC checking is scoped to the model
instance; do not call it a general proof. TLA+ itself is not limited to bounded
checking. P is an alternative for a later event-oriented supervision study, not
an additional mandatory framework; PObserve would need a complete event contract.

**Gate:** decide value before requiring formal tooling for M5. If declined, retain
explicit protocol transition tables and deterministic interleaving/crash tests.

## EXP-8 — Operational policy details

**Question:** which concrete cancellation/wait/accounting mechanisms satisfy the
settled operations contract without losing history or obscuring costs?

**Scope:** fake provider, fake clock, short run with one successful member, one
long quota wait and one cancelled member. No live spend. Model soft then hard
interrupt, acknowledgment lost after accounting write, duplicate report delivery,
and interruption around publication.

**Assertions first:** no admission/retry after effective stop; no partial output
as success; supported remote cancellation distinguished from local abort; known
usage retained once and missing usage marked unknown; unrelated siblings continue;
long waits do not retain execution permits or fake progress forever. Observer
exceptions cannot invalidate committed output. Trace correlation spans retries.

**Decision outputs:** soft-stop drain unit/deadline/escalation semantics, publication
race outcome, long-wait claim handoff/resume, durable usage acknowledgment and
idempotent delivery protocol, privacy-safe inspection event schema.

**Gate:** M5/M6 before paid providers. Product feedback is required only if a concrete
tradeoff changes the chosen protection, cost-saving or operator-interaction goals.
