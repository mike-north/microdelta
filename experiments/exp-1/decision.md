# EXP-1 bounded mechanism decision — proposed for supervisory review

**Result: pass within the stated fixture domain; generic closure soundness is
rejected.** This experiment tests structural current correspondence after a
complete process exit. It does not implement or prove the M3 runtime, History
publication, source freshness, nested paid-parent validation, or EXP-2's value
encoding. The recommendation below is a mechanism proposal, not automatic
normative adoption.

## Candidate and bounded domain

Process A declares one nonmemoized producer of two keyed member inputs, and
calls one memoized consumer per member. Both processes import a tracked config
object, a tracked helper, and a supplied tracked assessor callable. The
consumer reads the member score; the helper reads the config factor. Keys
`a` and `b` are invoked in opposite orders across processes. The fixture
registers current declarations in opposite orders as well. A display label
can change without changing an address.

The current registry binds a structural descriptor
`{ scope, role: input|callable|step, slot, memberKey? }` to each fresh tracked
object or function. It rejects a missing or multiply occupied required slot.
The descriptor, not a display/function name, source text, hash, call ordinal,
or process-local wrapper identity, reconnects historical observations. The
wrapper's object identity is used only to record which current declaration
was actually consumed during this process. Its ephemeral reverse map is never
serialized.

The captured record contains the consumer's exact author subject and
compatibility group, a fixture exact-result reference, and only actual
observations: flat own scalar fields and called function implementation text.
The function text comes automatically from
`Function.prototype.toString.call(originalImportedFunction)` at invocation.
It is compared **after** descriptor lookup. An uncalled registered helper
has no observation. There is no retained tag, revision, closure, or live
function. The fixture serializes this record as JSON solely to force a
process boundary. It uses no production Machine host capability; Node
file/process I/O is confined to `test/`. Portable `src/` also passes
`types: []` checking and the checked Node-access rule.

Only synchronous calls and plain string-keyed objects with flat own finite
scalar fields are supported. Accessors, user symbol keys, and nonplain
objects are rejected. Undefined, nested values, inherited property
semantics, collections, canonical hashing, and selected loading belong to
EXP-2. The current JSON fixture format is not a chosen persisted schema.

## Assertion-first evidence

The first unit assertions ran against a scaffold before the mechanism:
Jest reported **6 failed, 1 passed**; failures included exact-reference
retention, observed helper/config changes, ambiguity and version behavior.
The separate-process assertions then ran against an empty driver:
**11 restart failures, 7 unit passes**. Later negative accessor and null
version assertions each failed before their handling was implemented.
The context-import rule and CI wiring each had a failing negative fixture
before their extensions. All now pass.

| Process B variant | Exact references after validation | Consumer bodies in B | Evidence |
| --- | --- | ---: | --- |
| Fresh allocations; reverse member and registration order | `a=result-1, b=result-2` | 0 | Structural descriptors reconnect |
| Member `a` consumed score edited | `a=result-3, b=result-2` | 1 | Keyed input field evidence |
| Called helper implementation edited | `a=result-4, b=result-3` | 2 | Captured actual emitted function text |
| Same helper text; tracked captured factor edited | `a=result-4, b=result-3` | 2 | Config field evidence, not source text alone |
| Unread fields and display label edited | `a=result-1, b=result-2` | 0 | No broad object/name dependence |
| Uncalled helper implementation edited | `a=result-1, b=result-2` | 0 | No invented call observation |
| Required assessor missing or helper slot ambiguous | prior pointers unchanged | 0 | Diagnostic miss, no validation replay |
| Version 2 then rollback to 1, unchanged facts | rollback `a=result-1, b=result-2`; newer pointers `a=result-4, b=result-3` | 2 for version 2; 0 for rollback | Newer history retained; hit does not rewind pointer |
| Version 2 then rollback to 1, changed tracked factor | rollback is a changed-evidence miss; newer pointers retained | 2 for version 2; 0 check-only rollback | Version match does not bypass current facts |

The per-step compatibility version defaults to 1 and accepts positive safe
integers, the unambiguous JavaScript-number subset. Zero, negatives,
fractions, NaN, infinity, too-large numbers, null, strings and booleans
are rejected. The harness first chooses retained candidates in the
requested version group and then performs ordinary current evidence
validation. A hit reports the old exact reference without touching the
current pointer. Fresh execution and publication are separate decisions.

The local commands `npm run check`, `npm test`, and `npm run build`
passed on Node 24.14.0 after `npm ci --offline` refreshed this
worktree's stale workspace links. `npm test` included 77 tooling tests,
the existing package suites, and 20 EXP-1 Jest cases plus its tsd
contract. CI's configured Node 20/22/24 matrix remains a separate
PR check. Directly invoking the emitted process driver with `A` then
`B` and `unchanged` reported `producerExecutions=2` in both
processes, consumer `executions=2` then `0`, and exact
`a=result-1, b=result-2` references in both.

## Counterexample, alternative, and build implications

The preserved counterexample closes over an **untracked** mutable scalar.
Its value changes while the called function's source text remains identical;
the probe reports a false hit. Automatic source evidence is therefore not
proof of arbitrary closure capture. The contract's tracked-influence
boundary and later capture lint are necessary. This result is a pass only
for the declared tracked fixture domain.

An alternative is a build-generated per-export implementation manifest.
It could make emitted-code inputs explicit, but it still needs structural
slot binding and tracked captured values, and would add a parser/build
dependency. This experiment does not implement or approve it.

The tested build emits NodeNext JavaScript with TypeScript **5.9.3**;
local evidence used Node **24.14.0**, Jest **30.5.1**, tsd **0.33.0**,
and ESLint **10.10.0**, pinned in the workspace lockfile. Source-text
comparison is sensitive to compiler, bundler, transform, and minifier
changes: equivalent code may miss after a build change. A future
implementation needs a declared artifact policy and must not treat
stable source text as evidence that tracked captured data stayed equal.
This probe stores raw implementation text to expose its actual input.
VAL-2 already selects SHA-256 for content fingerprints. A later runtime
can hash selected implementation bytes; canonical durable encoding and
artifact normalization remain unproven here. A digest remains evidence,
never a locator.

## Proposed owning-contract amendment, pending review

For CMP-6 and REUSE-006, permit a current registry of explicit structural
input/callable/step slots, with member identity where applicable, to
reconnect a historical observation only when the current slot has exactly
one declaration. Missing or ambiguous required correspondence is an
honest miss. A display label, source text, hash, call ordinal, or old
object identity never repairs that failure.

For TRK-2 and REUSE-008, compare implementation evidence from the actual
called imported function after current correspondence is established.
The compared evidence must be paired with actual tracked captured inputs;
an uncalled helper does not become an observation. The per-step positive
integer compatibility group filters history before current implementation
and input validation. A rollback hit preserves the old exact result and
does not itself change the current publication pointer.

The proposal does not select a public API spelling, EXP-2 encoding,
arbitrary closure analysis, or publication schema.
