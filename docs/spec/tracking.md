# Tracking, values, and observations

Status: normative semantics; supported encodings are gated by EXP-2.
Owners: Tracking & Observation and Value Semantics in [architecture](architecture.md).

## Unified author surface

**TRK-1 — One wrapper.** `tracked()` wraps supported objects and functions with one
nominal brand. Object fields yield ordinary scalar values when scalar-valued;
function values are invoked normally. Bare primitive wrapper inputs must fail at
both type and runtime boundaries; a boxed boolean cannot emulate native truthiness.
Importing a tracked declaration must not require rewrapping or passing it manually
through every consumer. Classes are deferred, not silently supported as plain data.

**TRK-2 — Function evidence.** Calling a tracked function observes its implementation
fingerprint and the tracked values/functions it consumes. Tracking a function does
not, by itself, memoize its output. Automatic implementation change detection is
selected; routine manual version bumps are not the only way code changes propagate.
EXP-1 selects the actual called function's emitted
`Function.prototype.toString()` text as a bounded implementation-evidence input,
compared only after current structural correspondence is established. A runtime
must declare its build-artifact policy; compiler, bundler, or minifier changes may
conservatively invalidate this evidence. The text is neither semantic identity
nor proof that captured influences were included. Pair it with actual tracked
reads/calls; an uncalled helper contributes no implementation observation.

The [EXP-1 counterexample](../../experiments/exp-1/decision.md) rejects source-text
equality as arbitrary closure soundness: an untracked captured scalar can change
while the text remains equal. Its synchronous fixture rejects asynchronous and
thenable calls and accessors without claiming the production async tracking
contract is implemented. TRK-3 and TRK-4 remain obligations of that implementation.

**TRK-3 — Scoped collection.** Async and concurrent tracking frames must isolate
observations, restore surrounding context on success/failure, and reject late work
against closed run/frame lifetimes. Reused in-process derivations replay their
observations to consuming frames. Process-local tags/revision counters are useful
for reactive composition but must never enter durable evidence. Persist semantic
addresses/fingerprints, then reconstruct current bindings after restart.

**TRK-4 — Capture boundary.** Every external influence intended to affect reuse,
including branch selection, must be tracked or covered by explicit source/freshness/
compatibility policy. A typed lint rule should use existing scope and TypeScript
services plus the shared brand to flag untracked external captures. Locals and
parameters need not all be branded. Extracting a scalar from tracked configuration
before the active computation and capturing it can lose tracking and merits a
fixture. Builtin exemptions are an experiment detail. No semantic-changing autofix
or claim of sound detection for arbitrary JavaScript. Deliberately memoized random
or LLM output remains valid; this rule concerns influences expected to invalidate it.

## Observation decision table

**TRK-5 — Literal semantics.** Observe the operation performed, not inferred intent.
The table is normative; examples name JavaScript semantics, not final API spellings.

| Operation | Consumed fact | Must not additionally consume | Counterexample/assertion |
| --- | --- | --- | --- |
| `pr.author.name` | Value at the current bound path | Author ID, unread author fields, whole PR | Replace author, preserve name: equal observation |
| `obj.optional` / comparison to `undefined` | Returned value | Property existence as separate fact | Missing and present-undefined compare equal for this read |
| `if (obj.flag)` | Actual flag value | Merely its boolean coercion result | `0` to `''` changes value even though both are falsey |
| Own-property check | Whether this object owns that key | Inherited existence or sibling keys | Own absent to inherited present remains own-absent |
| Inherited membership check (`in`) | Presence along the supported lookup chain | Value at that key or all other keys | Present-undefined still present; own→inherited can stay present |
| Single keyed-member presence | Membership of that one key | Unrelated keys, values or cardinality | Adding another member preserves this observation |
| Key enumeration | Enumerated keys and relevant order semantics | Every member payload | Key addition invalidates enumeration, field edit need not |
| Array `length` | Length field | All elements | Same-length value edit preserves length-only observation |
| Positional array read | Value at the observed index/path | Entity identity of every element | Inserting before the position may change it |
| Keyed member field | Projection under stable member key | Traversal position | Reorder alone preserves per-member assessment |
| Ordered ranking/list | Selected ordered sequence | Unselected member fields | Rank change invalidates ranking consumers |
| Explicit identity read | Designated logical identity value | Whole entity content | Equal names with different IDs invalidate identity consumer |
| Pass object to another function | Nothing beyond what callee/materialization consumes | Automatic deep traversal | Callee reads one leaf: unread siblings remain irrelevant |
| Materialize/return data as result | Actual selected output values/references | All reachable but unreturned data | Pass-through output cannot escape dependency tracking |
| Invoke tracked function | Implementation evidence plus observed internal reads | Uncalled functions' code | Uncalled helper edit does not invalidate caller |

Own/inherited distinctions are required semantics where supported. EXP-2 must
specify the supported prototype/value domain or reject unsupported cases clearly;
it must not silently reinterpret `in` as an own-only check.

**TRK-6 — Current paths and historical provenance.** Revalidate a consumed path
against the current input binding, even when an intermediate object's identity
changes. Equal consumed value can preserve the result. Record current acceptance
against the new binding while retaining the old result's original provenance.
A later change under the new author must be detected; retaining only the old author
link as current evidence is incorrect.

**TRK-7 — Identity consumption.** Merely traversing an identity-bearing object does
not read its identity. `dependOn(author.id)` adds no information beyond evaluation
of `author.id`; a proposed `dependOnIdentity(author)` convenience performs an
explicit designated-identity read. Several identities may be consumed without
defining the output's identity. Reading identities does not enforce output-key
uniqueness. The exact identity-bearing brand/helper API remains experimental.

**TRK-8 — Branches and output.** A changed tracked guard invalidates the prior
execution when required, then a fresh frame records the newly taken branch. Do not
accumulate abandoned branch reads into current evidence. Returning tracked input
as output must account for the data/reference actually materialized. These are
ordinary consumption cases, not extra author dependency declarations.

## Structured addresses and fingerprints

**VAL-1 — Paths carry structure.** A durable path uses structured segments and an
operation kind, not a dotted string. A dictionary property named `"0"`, an array
index `0`, and a keyed member identity are distinguishable concepts. Determine
property-vs-index from container/operation: JavaScript does not preserve whether
source syntax used `[0]` or `['0']`. Property names containing dots or brackets
must not alias multiple segments. Exact JSON/binary encoding is EXP-2 work.

**VAL-2 — Canonical supported values.** SHA-256 is the selected content fingerprint.
Define a versioned canonical encoding before durable writes. Equal supported
values under a specified observation must encode consistently across processes;
semantically different observations must not collapse through JSON omissions or
coercions. Encode operation, structured address, selected value and relevant
structure unambiguously. Hash collision resistance is an assumption, not proof of
mathematical equality. Diagnostics/timestamps are not value equality evidence.

The first experiment must decide or reject, with fixtures: missing vs undefined;
null; booleans; strings; numbers including NaN/infinities/negative zero; sparse
arrays/holes; dictionary key order; cycles/shared references; inherited properties;
getters; bigint; symbol keys; functions as implementation dependencies versus data;
Date/Map/Set/class instances. This is a bounded support decision, not a requirement
to support all of them. Framework branding symbols are distinct from user symbol
keys; ignoring unsupported user data silently is forbidden.

**VAL-3 — Immutability and retention.** Stored values are immutable snapshots.
Input inspection and materialization must not mutate stored history. In-memory
changes are new observed facts; they cannot mutate a retained result in place.
Strong ownership of all loaded payloads is not required: a field may be evicted and
loaded again without losing its durable identity or observation semantics.

## Collections

**COL-1 — Member identity.** Use designated member identity as the default key;
allow an explicit author custom-key function. Keys are scoped to their collection
binding. Duplicate keys fail with a diagnostic identifying the collection/key and
pointing to the custom-key option. A traversal ordinal or array index must not
silently substitute for logical identity in keyed fanout. No-identity members need
an explicit supported key strategy before keyed work proceeds.

**COL-2 — Projection grain.** A uniform exhaustive read such as every member's
`name` is representable as one logical collection dependency describing current
collection binding, projection, traversal semantics, relevant structure and
fingerprint. This does not promise constant-size evidence for arbitrary conditional
or early-stop loops. Preserve guards and actual coverage; do not pretend unread
members were consumed. Exact storage addresses and collection projections are
separate concepts.

**COL-3 — Order.** Arrays/explicit ordered results preserve relevant order. Dictionary
key insertion/serialization order is not semantic data or member identity; an
unordered dictionary projection must not invalidate just because that order changes. A calculation that intentionally uses
order must observe an ordered value; sorting/ranking can produce one independently
of keyed per-member results. Membership, member fields, presence and order must not
be collapsed into a whole-payload fingerprint.

**COL-4 — Test obligations.** Test insertion/deletion/reordering, changed unread
fields, changed projection, duplicates, custom keys, early termination and changed
guards. Confirm exactly the affected memoized members execute, while aggregate
consumers respond to the collection facts they actually consumed. These assertions
span [composition](composition.md) and [acceptance](acceptance.md).
