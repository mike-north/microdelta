# Composition, binding, and higher-order work

Status: normative boundaries; binding representation is EXP-1/EXP-4 work.
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
Their abstract graph must be fully bound before runtime data is resolved. Named,
typed structural callable slots are the proposed mechanism for reconnecting a
supplied implementation, such as `assessor`, across restarts. This does not require
a globally public step ID or manually declared field dependencies. The slot/registry
representation must earn adoption through EXP-1 and EXP-4.

**CMP-4 — Fanout template.** Build the declared member template once with a symbolic
member input, then instantiate it for actual member keys. Do not rerun a topology
factory for every runtime member. Member cardinality may be unknown at composition;
possible operations and connections must not be. Preserve explicit precedence,
without imposing arbitrary global serial execution on unrelated branches.

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

**CMP-7 — Arguments.** Forwarded current bindings can be resolved directly. A stored
derived argument is usable only with sufficient supporting evidence that it still
applies, including governing tracked inputs and implementation. If a current child
invocation cannot be reconstructed without executing the skipped parent's body,
report an ordinary parent miss and execute normally when admitted; children may
still reuse. Never execute paid work merely to discover whether that same work was
necessary and label it cache validation. Do not promise serialized closures.

## Gates, skips, and enforcement

**CMP-8 — Tracked runtime gates.** A runtime predicate may select whether a declared
operation instance runs, without removing it from the abstract graph. Its relevant
inputs are tracked. Distinguish skipped/no-value from success returning undefined,
failure, cancellation and pending work. Exact fold policy for skipped members must
be selected in EXP-4; no silent partial corpus is allowed for a strict consumer.

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
