# Composition, binding, and higher-order work

Status: normative boundaries. EXP-1 selects bounded structural correspondence.
[EXP-4](../../experiments/exp-4/decision.md) selects the bounded nested argument
recipe, supplied callable step slots, keyed fanout templates, tracked gates and
strict-fold skip treatment recorded below. Arbitrary closure soundness remains
excluded.
Owner: Definition & Binding, collaborating with Reuse Resolution.

## Two graphs

**CMP-1 — Freeze the abstract graph.** After composition, abstract operations and
possible edges are fixed. Composition may use configuration and supplied step
definitions to choose a graph before execution. Runtime results may supply data,
instantiate a fixed fanout template, or gate already-declared work. They must not
create, replace, reconnect, or reorder abstract operations. Freeze framework-owned
copies so later mutation of an author's array cannot change topology.

**CMP-2 — Observations remain dynamic.** A fixed graph does not prescribe all data
fields read. Actual conditional observations are discovered during execution and
can change on a later run. A tracked selector can change branches safely; an
untracked external selector cannot be expected to invalidate a cached result.
Keep the declared step graph distinct from the expanded result graph and current
execution's observed dependency evidence.

**CMP-3 — Higher-order composition.** Steps/composites may receive step definitions
and composition factories may return reusable groups, including staged factories.
Their abstract graph must be fully bound before runtime data is resolved.
Structurally declared callable slots are the selected bounded mechanism for
reconnecting a supplied implementation, such as `assessor`, across restarts.
This does not require a globally public step ID or manually declared field
dependencies. EXP-1 establishes direct current-slot correspondence.

**EXP-4 supplied-callable selection:** a supplied step is bound at composition to
a structural callable slot. A step that declares the slot is admitted only when the
slot resolves to exactly one current implementation; missing and multiply supplied
slots are distinct misses before the body runs. The parent's evidence names the
slot descriptor only. The supplied step's implementation evidence belongs to the
child's own provenance, so exchanging implementation A for B is a child
implementation change, not a parent-graph change or a guessed remap. Two
closures with equal emitted text but different captured values are
indistinguishable to this evidence (preserved counterexample CX-2); captured
configuration must be a tracked input.

**CMP-4 — Fanout template.** Build the declared member template once with a symbolic
member input, then instantiate it for actual member keys. Do not rerun a topology
factory for every runtime member. Member cardinality may be unknown at composition;
possible operations and connections must not be. Preserve explicit precedence,
without imposing arbitrary global serial execution on unrelated branches.

**EXP-4 template selection:** the factory runs once against a symbolic member; its
returned declarations are copied and frozen, and every builder rejects later calls.
A member instance is addressed by the template's step descriptor (which includes
its collection binding) plus the member key. Discovery keys every member before
any gate or body runs, using designated identity or an explicit custom-key
function (COL-1). A missing or duplicate key rejects the collection with a
diagnostic naming the collection, the key and the custom-key option; no member
work is admitted. Renaming a template slot or moving it to another collection is
changed correspondence: prior instances are not remapped.

## Nested execution and validation

**CMP-5 — Ordinary nesting.** Invoking declared child bindings inside a memoized
body is permitted. Captured dependency evidence propagates automatically and
hierarchically. Do not flatten every transitive child input into the parent's
immediate validity test: a changed child input can yield equal consumed output,
allowing the parent result to survive.

**CMP-6 — Reconnect current work.** Persist enough evidence to associate a historical
nested call with the current declared callable relationship and arguments, its
prior result and consumed output projection. An old exact result reference alone
cannot identify the current implementation. Neither source text, display name,
execution ordinal, nor process-local object identity is a valid substitute for
proven current correspondence. Changed graph shape without correspondence yields
an honest miss, not a guessed remapping.

**EXP-1 mechanism selection:** a fresh registry binds the declared composition
scope, input/callable/step role, slot, and member key where applicable to current
declarations. Each consumed historical slot must resolve to exactly one current
declaration. Missing and multiply occupied slots produce distinct miss diagnostics.
A process-local reverse map may discover the slot actually consumed, but only
structural descriptors and observed facts enter retained evidence. API spelling
and descriptor wire encoding remain separate implementation choices.

For example, registering member `b` before `a` after restart must reconnect each
member's own observations and exact retained reference; it cannot exchange their
results. The [EXP-1 restart fixture](../../experiments/exp-1/decision.md) proves this
for direct supplied callables and flat scalar inputs in separate processes. It
does not establish arbitrary nested argument reconstruction or closure persistence.

**CMP-7 — Arguments.** Forwarded current bindings can be resolved directly. A stored
derived argument is usable only with sufficient supporting evidence that it still
applies, including governing tracked inputs and implementation. If a current child
invocation cannot be reconstructed without executing the skipped parent's body,
report an ordinary parent miss and execute normally when admitted; children may
still reuse. Never execute paid work merely to discover whether that same work was
necessary and label it cache validation. Do not promise serialized closures.

**EXP-4 argument recipe:** a nested call's durable evidence records its structural
parent and child slots, its position in the parent's call order and one recipe per
argument (the M3 empty form remains valid):

| Recipe | Recorded | Reconstruction |
| --- | --- | --- |
| `forwarded` | Structural origin: an input path, the member binding, or an earlier child call's output path | Resolved again from **current** bindings; a stored value is never substituted |
| `derived` | Canonical supported value, and whether it was justified | Used only when recorded as justified and every earlier validation step passed |
| `unreconstructible` | Its reason (for example a function value) | Always an honest parent miss; the child cannot observe it |

Validation checks the parent's own implementation, consumed bindings and facts
first, then each call in recorded order. For call *k* it resolves the recipe,
obtains the current child result (validated or executed under normal admission)
and compares only the parent's consumed output facts from that call. Under the
tracked-influence contract, an unchanged parent prefix replays to the same derived
value, so a changed basis is reported as changed evidence or changed child output
before call *k*. The distinct unjustified-argument miss is reachable when the
parent made an **observed** untracked read before deriving the argument. Child
history identity is the child descriptor plus its derived argument values;
forwarded values are identified by origin and observed by the child through
`argument` binding paths. Untracked influence the runtime cannot observe remains
outside this justification (preserved counterexample CX-1).

## Gates, skips, and enforcement

**CMP-8 — Tracked runtime gates.** A runtime predicate may select whether a declared
operation instance runs, without removing it from the abstract graph. Its relevant
inputs are tracked. Distinguish skipped/no-value from success returning undefined,
failure, cancellation and pending work. No silent partial corpus is allowed for a
strict consumer.

**EXP-4 strict-fold selection:** a gate yields an explicit `skipped` instance only
for an explicit `false`; a non-boolean result or a failed read fails the instance.
The gate declares the **required population**. A strict fold receives one explicit
keyed entry per current member, `succeeded` with its result view or `skipped`
with no data, in canonical key order. It runs only when discovery is closed and
every required member has an accepted result. Any failed or cancelled required
member fails the fold immediately, naming those keys and still reporting pending
keys and open discovery; otherwise open discovery or a pending member leaves it
waiting. Neither case runs the body or publishes. A closed empty population is a
successful complete fold; an open one waits. By supervisor decision on the
EXP-4 evidence (not exercised by its fixture), the strict fold's outcome also
carries framework-level coverage (required keys, skipped keys, discovery
closure), so consumers need not trust the body to report exclusions; M4 must
test it. Its verification consumes
each member's included-or-skipped outcome and the result facts it read, not the
gate's raw observations; those remain the instance's own evidence. A threshold
change that flips no outcome therefore reruns nothing. A skip or deletion never
retracts an earlier publication: the instance's retained history and latest
pointer are unchanged, and that pointer is not evidence that the member is still
required. Tolerant or outcome folds are separate (RUN-010) and outside EXP-4.

**CMP-9 — Enforceable boundary.** Reject framework result resolution during graph
construction and undeclared calls/target substitution/post-freeze mutation before
admitting affected work. Distinct types/capabilities and runtime validation support
this boundary; they do not sandbox arbitrary JavaScript I/O, closure mutation,
truthiness, time or randomness. Type/lint checks guide correct capture, while the
author's tracked-influence contract remains explicit.

## Worked cases

| Case | Allowed outcome | Assertion |
| --- | --- | --- |
| Composition config supplies either scorer A or B | Bind selected scorer before freeze | Definition has a current supplied callable before any source work |
| One PR is added to discovery | Instantiate existing retrieval/assessment template once for its key | Unchanged PR assessments retain references |
| Tracked gate changes false→true | Previously skipped instance may run | Same abstract nodes/edges, changed predicate evidence |
| Result contains a function used to add an operation | Reject graph mutation/undeclared binding | No new abstract node or paid call admitted |
| Child prompt changes, child emits same selected score | Revalidate/execute child as required, retain outer result | Outer body invocation count stays zero on second run |
| Saved child arguments lack current justification | Parent miss | No validation-only replay; normal admission gate applies |
| Author mutates builder array after freeze | Frozen graph remains unchanged | Stored graph owns its structure |

See [execution](execution.md) for eligibility/source acceptance and
[acceptance](acceptance.md) for restart and invocation-count fixtures.
