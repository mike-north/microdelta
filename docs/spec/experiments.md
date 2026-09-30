# Bounded experiments and mechanism gates

Status: M0.5 foundation is accepted and the six M1 experiment decisions are
recorded below. [The M1 evidence record](../validation/m1-2026-09-26.md) defines
final delivery acceptance and links implementation, review, and CI evidence.
EXP-4 is decided for M4 and EXP-8 for M5 (see their rows below). Requirement IDs
in the linked contracts govern behavior; a rejected mechanism does not weaken
the required behavior.

| Experiment | Bounded result and owning decision |
| --- | --- |
| EXP-1 | Select structural current binding and synchronous observed implementation/scalar evidence; [CMP-6](composition.md), TRK-2, REUSE-006/008. Arbitrary closure soundness remains excluded. |
| EXP-2 | Select unordered equality, separate order-preserving snapshot transport, observations/projections, and top-level scalar access; [VAL-1/2/3 and COL-2](tracking.md). Reject async preparation as a general getter solution; nested lazy access was unproven within EXP-2 (see the M3 nested-read row). |
| M3 nested read | Select bounded synchronous navigation over exact retained record and array roots: tagged scalar facts or container shapes, existing TRK-5 leaf/length/presence/key-order/explicit-output observations, no whole-object dependency from navigation, and file-backed SQLite evidence of no root or unrelated payload in selected reads and none in fingerprint comparison; [tracking decision](tracking.md) and [protocol](../../experiments/exp-nested/protocol.md). Durable publication, scale, cache/eviction and projection indexing remain outside it. |
| EXP-4 | Select the nested invocation record and `forwarded`/`derived`/`unreconstructible` argument recipe validated in recorded call order, structural supplied callable step slots, a once-built keyed fanout template with default/custom keys and pre-work duplicate rejection, tracked gates, and strict folds over an explicit gate-declared required population; [CMP-3/4/7/8](composition.md), REUSE-006/007, RUN-010, [decision](../../experiments/exp-4/decision.md). Sound only under the tracked-influence contract (CX-1/CX-2); tolerant folds, pending-read semantics and multi-level nesting depth remain unproven. |
| EXP-8 | Select a step-granularity soft-stop drain with operator deadline and honest remote state, the publication commit as the stop/observer linearization point (requiring an unexpired current lease), a durable "not before T" deferral that holds no permit, an intent-before-send journal with usage keyed by (operation, report), stable operation identity with no blind replay and author safe-to-repeat, retry correlation, and identifier-only events; [RUN-002/011/012/013/014/015](operations.md), [ACC-003/005/007](operations.md), [decision](../../experiments/exp-8/decision.md). Request-granularity drain rejected. Bounded by the tracked-influence contract; no forced cancellation of arbitrary JavaScript (CX-2). |
| EXP-3 | Select the single-file, single-active-writer SQLite protocol shape under process-kill/reopen evidence; [PUB-004](execution.md). Broader durability/concurrency claims remain unproven. |
| EXP-5 | Historical bounded CML correspondence only; superseded by [PKG-006](package-boundaries.md). No CML model, parser, checker, or fixture is an active tool or gate. |
| EXP-6 | Historical flat-record theorem and finite TypeScript comparison; [VAL-2](tracking.md). Lean is dormant unless a concrete need justifies renewed use. |
| EXP-7 | Historical finite publication model; [PUB-004](execution.md) defines selective model-to-code-and-test review. No unbounded, liveness, or SQLite proof is claimed. |

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
as runtime evidence. EXP-5's historical outcome did not decide whether baseline
API Extractor enforcement exists. The 2026-09-27 decision retires its runnable
source; see PKG-006 and the archive
record. Package/API gates remain the primary architecture contract.

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

## EXP-5 — Retired CML correspondence pilot

EXP-5 ran and produced bounded evidence, but the 2026-09-27 formal-policy decision
retired its fixture, parser bridge, and checker from active source and normal
build/check/test paths. Its findings and Git provenance are recorded in the
[historical archive](../archive/experiments/exp-5.md). PKG-006 now selects shaped
package surfaces, generated declarations, API Extractor reports, compiler checks,
and import checks as the architecture/API contract. CML is not an optional active
tooling path or an implementation requirement.

## EXP-6 — Dormant Lean evidence

The checked flat-record theorem and finite differential fixture remain historical
evidence under [VAL-2](tracking.md), with their original scope and assumptions.
Do not rerun, expand, install, or add Lean to routine CI by default. Resume Lean
only when a concrete correctness question has a mathematical invariant for which
this tool offers a material benefit over bounded executable properties and tests.
Any renewed work must state the invariant, domain, assumptions, trusted toolchain,
and relation to implementation checks before it begins. A theorem about a model
does not establish TypeScript implementation behavior.

## EXP-7 — Selective publication state-model review

The finite publication model and its stale-writer control remain supporting
historical evidence for [PUB-004](execution.md). For a concrete correctness
question where state exploration adds value, record the state, transitions,
invariants, bounds, abstraction assumptions, and meaningful faulty control.
Then independently map model invariants and counterexamples to actual
implementation code and named test assertions. Classify each mapping as aligned,
divergent, missing, insufficient, or ambiguous; turn actionable gaps into
test-first implementation tests that run in ordinary CI. Record residual
model-only assumptions and unproven properties. The model checker itself need not
run in CI, and bounded safety results establish neither unbounded behavior,
liveness, nor SQLite correctness. No model audit of the existing EXP-7/EXP-3
artifacts is claimed by this policy edit.

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
