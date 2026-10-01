# Reuse Resolution

This package owns current candidate eligibility, current source policy,
direct-child and nested-call validation with consumed-output cutoff, keyed
template instance resolution with tracked gates, honest misses, and execution
through injected admission and History ports. Every export is a
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
   reported. That wait has no default deadline, but run cancellation bounds
   it (#106): each child's admission, body and nested waits run through Run
   Supervision's ports, so once a hard stop or an operator deadline takes
   effect every in-flight child ends interrupted, even one whose author code
   never settles, and the parent ends cancelled (or with its own error when
   its body had already thrown), never with a partial publication.
5. **Admission and execution**: work that validation could not avoid is
   admitted before any claim, attempt or body. A denial or a cancellation is a
   typed `refused` outcome whose `disposition` carries the decision's kind.
   Admitted work allocates an attempt keyed by the request key and the
   structural invocation, with the complete current intent digest, then runs
   under capture and publishes through History.
6. **Run cancellation**: every admitted body and current-policy hook runs
   through the optional `execution` port (Run Supervision's cancellation
   port), and each publication commit first asks it whether cancellation
   forbids committing now, in the same synchronous turn as the commit. An
   interrupted execution, or output a hard stop discards before its commit,
   ends the attempt `interrupted` with a `stopped` ending and reports a
   `refused` outcome with disposition `cancelled`. Without the port, work runs
   unsupervised and every commit may proceed.

The members of one members request, strict fold or outcome fold resolve concurrently
within Run Supervision's bounded active window: Resolution presents each
member to the port's `member()` in canonical key order, and members are
started and reported in that order (RUN-002). A member not yet started holds
nothing. Without the port, members resolve one at a time.

## Template instances

A template instance is addressed by its template step descriptor plus a
member key. Resolving one (directly, or for every member through
`resolveMembers({ template, step, requestKey, lease })`):

1. **Discovery**: the template's composition-level collection source is
   resolved under its current source policy, once per request.
2. **Keying**: its exact current result is keyed by Definition before any gate
   or member body. A rejected snapshot (duplicate or missing key, failed
   custom key, malformed snapshot) admits no gate or member work: a members
   request reports `rejected` with Definition's diagnostic, and a direct
   request fails with `collection-rejected`. A member absent from the current
   snapshot is an `unbound-step`.
3. **Gate**: each member's gate runs once per request in its own tracking
   frame, over the declared inputs and helpers and the member's current record
   at the `member` binding. Its observations are the member's gate evidence and
   enter no step's provenance. An explicit `false` is a `skipped` outcome that
   admits, publishes and retracts nothing; a non-boolean result or a throw is a
   `gate-failure`, never a skip.
4. **Instance**: a required instance resolves like any source or memo, with
   its member binding. Its callbacks read `member`, a view of the member's
   current record at the `member` binding; those reads are the step's own
   observations and are validated against the current record on reuse. A
   forwarded `member` origin is rebuilt from the same record. So an unread
   discovery field changes nothing, while a consumed member field reruns only
   the member steps that consumed it.

Candidates are found by subject, which an instance keeps when its template is
renamed or its collection moves to another slot. That is changed
correspondence: a template-bearing candidate whose recorded step differs from
the current descriptor is a `correspondence` miss, never a remap.

`resolveMembers` resolves members in canonical key order, independently: a
member whose evidence is ready completes and publishes while discovery is
open or siblings fail, are refused or are skipped. Each member reports its
normal outcome or its member-attributable typed failure (execution failure,
`gate-failure`, `unbound-step` and the like). Run-level failures
(`admission-failure`, `observer-failure`, `integrity`, `wrong-intent`,
`invalid-request`, History or host errors) reject the whole request. A
cancelled child makes its parent's refusal cancelled, whichever child was
refused first. A gate returning a promise or thenable is a `gate-failure`.

## Strict folds

`resolveFold({ step, requestKey, lease })` resolves one strict fold (CMP-8,
RUN-005, RUN-010). `resolve` and `check` refuse a fold step with
`invalid-request`, because their outcomes cannot express waiting, readiness
failure or coverage.

1. **Members**: the fold's consumed template step is settled for every
   current member exactly as `resolveMembers` settles it, so a ready member
   completes whatever the fold then decides. A run-level failure rejects the
   fold request itself, so an outage is never a terminal member failure.
2. **Readiness, failure first**: a failed or cancelled required member, a
   rejected snapshot or cancelled discovery work makes the outcome `failed`.
   It names the failed, cancelled and pending keys and whether discovery is
   open. Otherwise, open discovery, denied discovery work or a pending member
   makes it `waiting`. Neither runs the body, admits fold work or publishes.
3. **Validate or execute**: only a ready fold looks at its candidates. The
   body receives one explicit entry per current member in canonical key
   order: `succeeded` with a lazy view of the member's accepted result, or
   `skipped` with no data (reading a skipped entry's data throws).
4. **Coverage**: a `reused` or `published` fold carries
   `coverage: { required, skipped, closed: true }`. The framework derives it
   from the members it delivered, never from the body's result.

The fold's evidence is the template step it consumed, its membership-and-status
fact (each member key, `included` with its exact result or `skipped`), and the
facts its body read from each included member's entry. The gate's raw reads
stay the instance's own evidence. A candidate is reused only when three things
hold:

- It consumed the same template step. A renamed step or template, or a moved
  collection, is a `correspondence` miss, never a remap.
- Its recorded fact equals the one current discovery and gate outcomes
  establish now (`changed-membership` otherwise).
- Each consumed member fact is unchanged (`changed-member-output` otherwise). So a gate flip, insertion or deletion
reruns the fold, while a reorder or a threshold edit that flips no gate reruns
nothing. A member change reruns the fold only when a fact it consumed changed.
Skips and deletions retract nothing.

## Outcome folds

`resolveOutcomeFold({ step, requestKey, lease })` resolves one outcome
(tolerant) fold (RUN-010). `resolve` and `check` refuse it with
`invalid-request`, as they refuse a strict fold.

1. **Members**: the consumed template step is settled for every current
   member exactly as `resolveMembers` settles it. Each member settles as
   `succeeded` (an accepted result), `skipped`, `failed` (a
   member-attributable typed failure) or `cancelled` (work withdrawn from
   this run: refused by admission as cancelled, or interrupted by a stop).
   Denied work leaves it `pending`, which is unsettled.
2. **Completeness**: no member status fails an outcome fold. A rejected
   snapshot or cancelled discovery work makes the outcome `failed`, because no
   population can be established in this pass. Otherwise open discovery,
   denied discovery work or a pending member makes it `waiting`, with the
   partial coverage settled so far. Neither runs the body, admits fold work or
   publishes: the fold never claims a complete set while anything is unsettled.
3. **Validate or execute**: once every member of a closed population has
   settled, the fold is validated or executed exactly as a strict fold is. Its
   body receives one entry per member with its settled status (only
   `succeeded` carries data). Its membership-and-status fact also records
   `failed` and `cancelled` members, so repairing a failed member changes it
   and the fold reconsiders, while unaffected member results are reused.
4. **Coverage**: every outcome except `failed` carries `coverage: {
   succeeded, skipped, failed, cancelled, pending, openDiscovery, complete }`,
   derived from how members settled, never from the body. `complete` is true
   exactly when discovery is closed and nothing is pending; it is never a
   claim of complete success.

An outcome fold records version-4 provenance, so neither fold contract ever
accepts the other's result: such a candidate is `unsupported-evidence`.

## Checks and recovery

`check({ step })` reports `reusable`, `execution-required`, `uncertain` at a
needed source boundary, or `skipped` for a gated-out instance, without
admission, attempts, bodies or writes.
`recover({ step, requestKey })` recomputes the attempt key and intent without
running author code and reports the identified execution's durable outcome,
a strict or outcome fold's included. A different intent is rejected and nothing is
executed automatically.

## Durable evidence

Provenance, acceptance and attempt-ending records use the versioned formats
`microdelta.resolution.provenance`, `.acceptance` and `.attempt-ending`,
documented in `src/evidence.ts`. History stores them opaquely. Version 1 keeps
its M3 meaning (sources and memos with direct children by slot). Version 2 of
provenance records a nested memo's ordered calls (each witness, exact child
result and `call` binding) or a supplied step; version 2 of acceptance names
each call's current result by position. Version 3 of provenance records a
strict fold's consumed template step, its membership-and-status fact (keys in
canonical order, each included with its exact result or skipped) and its
consumed member facts at `entry` bindings; version 3 of acceptance names each
included member's current result by key. Any other version is unsupported
evidence. A supported record must carry the step's own implementation
observation, and a source record has no child edges. A fold record's consumed
template step is template-bearing with no member key, and its consumed member
facts name only included members. A record that breaks any of these is an
integrity failure.

An outcome's `trace` is the requested step's own lifecycle; its `diagnostics`
cover the whole request, including nested children, once each.

## Tests

Owner tests cover the outcome-envelope registry and the typed family (`tsd`).
Behavioral suites run in the facade's assembly tests
(`packages/core/test/resolution`, `packages/core/test/nested` for nested
validation, `packages/core/test/keyed` for template instances and
`packages/core/test/fold` for strict folds, each including separate-process
restarts) because only assembly may
compose History with Node's real SQLite capability. An on-demand mutation-control runner there
plants single wrong behaviors into this package's emitted build.
