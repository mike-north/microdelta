# Reuse Resolution

This package owns current candidate eligibility, current source policy,
direct-child and nested-call validation with consumed-output cutoff, honest
misses, and execution through injected admission and History ports. Every export is a
project-private `@alpha` declaration; spellings are not a public contract. See
the [execution contract](../../docs/spec/execution.md), the
[M3 plan](../../docs/plans/m3-contribution-analysis.md) and the
[package map](../../docs/package-map.md).

It consumes Definition, Tracking, History and Materialization through their
generated alpha declarations only. It never touches History rows, stores no
finality answer, and never replays a body as validation. Admission policy and
run lifetime belong to Run Supervision; storage consistency to History.

## Binding family

`IResolutionFamily<TInputs, THelpers>` is the family a facade passes to
Definition's `declarations()`. Callbacks receive:

- `inputs`: the declared input slots as one tracked record, so consumed
  configuration fields become evidence;
- `helpers`: each declared helper as a tracked function, so an actually called
  helper's implementation becomes evidence and an uncalled one does not;
- sources also receive `previous` (the eligible previous result's immutable
  `{ data }` carrier, or `undefined`) and `outcome`, whose `fresh(data)` and
  `retain(previous)` mint the only outcomes a source may return;
- memos receive Definition's declared `calls`; each resolves to `{ data }`, a
  lazy view over the child's exact retained result;
- supplied steps receive `args`, a frozen array that behaves as the plain
  argument list under every ordinary idiom. Its elements are read through the
  observed `argument` binding. Its shape is evidence too: reading `length` or a
  position past the end, an `in` check and key reflection all record it. An
  unreconstructible argument throws on read;
- every callback receives `untracked(view, key)`, the explicit observed
  untracked read: it returns a scalar member without consuming it, the capture
  records the read, and any derived argument a memo passes afterwards is
  recorded unjustified, as is any forwarded path chosen afterwards.

## Resolution order

`createResolution(options).resolve({ step, requestKey, lease })`:

1. **Candidates**: History results for the step's scoped subject and
   compatibility version, latest publication first.
2. **Own evidence**: each candidate's actually called implementation, consumed
   inputs and called helpers are compared with current facts. A source's reads
   of its previous result are history and are not compared.
3. **Source policy**: only for a still-eligible source candidate is the
   *current* finality hook evaluated. `true` retains the exact reference with a
   new acceptance record. `false` or no hook admits the source check, which
   receives the eligible carrier and returns fresh data (a new publication, even
   when equal) or `retain` of exactly that carrier. Anything else fails.
4. **Direct children** (memos): each recorded witness is reconnected through
   Definition; the current child is resolved under current policy and shared
   within the request; only the child output facts the memo consumed are
   compared. A different subject occupying the uniquely reconnected slot is
   the current child. Unsupported or unreconnectable witnesses are honest
   misses; a missing or wrong-scope historical child is an integrity failure.
   Child views are delivered inside a `{ data }` carrier, so awaiting a call
   never reads the child's `then` member.
4a. **Nested calls** (memos whose calls carry version-2 witnesses): a memo
   whose supplied slot is unbound is judged with no child work at all. After
   the memo's own evidence, every recorded witness is reconnected through
   Definition before any child is resolved; then, call by call in order, its
   arguments are rebuilt (forwarded origins from current bindings or the
   current output of an earlier call, forwarded paths and derived values only
   when recorded as justified, never an unreconstructible one); the current child
   (a sibling source or memo, or the implementation currently supplied to a
   callable slot under that slot's subject) is validated or executed under
   normal admission; and only the facts consumed from that call are compared.
   The first failure is a distinct miss: `changed`, `changed-child-output`,
   `missing-binding`, `ambiguous-binding`, `unreconstructible-argument`,
   `unjustified-argument` or `unsupported-evidence`. Children obtained while
   validating are shared with the parent's execution, so none runs twice in a
   request. A memo whose supplied slot is missing or ambiguous fails with
   `unbound-step` before admission, and a body that returns while a call it
   started is unsettled fails without publishing. Before any attempt ends,
   the memo waits for every call its body started to settle, so no child write
   races the ending. If the body threw, its own failure is still the one
   reported. That wait is unbounded; bounding it and cancelling in-flight work
   belong to Run Supervision's cancellation contract (A-13).
5. **Admission and execution**: work that validation could not avoid is
   admitted before any claim, attempt or body. Denial is a typed `refused`
   outcome. Admitted work allocates an attempt keyed by the request key and the
   structural invocation, with the complete current intent digest, then runs
   under capture and publishes through History.

`check({ step })` reports `reusable`, `execution-required` or `uncertain` at a
needed source boundary without admission, attempts, bodies or writes.
`recover({ step, requestKey })` recomputes the attempt key and intent without
running author code and reports the identified execution's durable outcome;
a different intent is rejected and nothing is executed automatically.

## Durable evidence

Provenance, acceptance and attempt-ending records use the versioned formats
`microdelta.resolution.provenance`, `.acceptance` and `.attempt-ending`,
documented in `src/evidence.ts`. History stores them opaquely. Version 1 keeps
its M3 meaning (sources and memos with direct children by slot). Version 2 of
provenance records a nested memo's ordered calls (each witness, exact child
result and `call` binding) or a supplied step; version 2 of acceptance names
each call's current result by position. Any other version is unsupported
evidence. A supported record must carry the step's own implementation
observation, and a source record has no child edges; otherwise it is an
integrity failure.

An outcome's `trace` is the requested step's own lifecycle; its `diagnostics`
cover the whole request, including nested children, once each.

## Tests

Owner tests cover the outcome-envelope registry and the typed family (`tsd`).
Behavioral suites run in the facade's assembly tests
(`packages/core/test/resolution`, and `packages/core/test/nested` for nested
validation, including separate-process restarts) because only assembly may
compose History with Node's real SQLite capability. An on-demand mutation-control runner there
plants single wrong behaviors into this package's emitted build.
