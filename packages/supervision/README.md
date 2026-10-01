# Run Supervision

This package owns a run's scoped lifetime and selected environment, admission
of work that Reuse Resolution could not avoid, and the fixed lifecycle
positions observers see. Every export is a project-private `@alpha`
declaration; spellings are not a public contract. See the
[operations contract](../../docs/spec/operations.md) (RUN-001), the
[execution contract](../../docs/spec/execution.md) (REUSE-009), the
[M3 plan](../../docs/plans/m3-contribution-analysis.md) and the
[package map](../../docs/package-map.md).

It consumes Definition and Resolution through their generated alpha
declarations only. It has no Machine or Node import: the asynchronous scope
(`{ createAsyncContext<T>() }`) and the timer that arms stop deadlines and
waits (`{ currentEpochMilliseconds(), schedule() }`) are structurally injected
capabilities, which assembly supplies. It never decides reuse, touches History
or threads a context argument through author helpers.

## A run

`createSupervision({ context }).run(options, body)` runs `body` as one
supervised run and returns `{ context, value, diagnostics }`:

- **Context.** `current()` returns the live run's `{ runId, analysis,
  environment }` anywhere in the run's asynchronous execution, including
  author code a request reaches. It fails with `outside-run` outside any run,
  `run-closed` from a callback that escaped a closed run, and
  `composition-phase` while a composition is being constructed. The run id is
  volatile metadata, never reuse evidence.
- **Lifetime.** The run stays live until its body *and* every operation
  started through it (`resolve`, `resolveMembers`, `resolveFold`,
  `resolveOutcomeFold`, `check`, `recover`, `ordinary`) have settled, including operations started while it waits and
  ones the body stopped awaiting early (a `Promise.all` whose sibling failed). The body's own value
  or failure is what the run reports. `run.open` reports this state. The run
  closes in the same turn that observes no started work, so every operation is
  either accepted and waited for or rejected before starting. After the run
  actually closes, its operations reject with `run-closed` and admission
  requests, or asynchronous decisions arriving late, are denied.
- **Requests.** `resolve(step, { requestKey })` is the normal entry
  operation; `recover(step, { requestKey })` the recovery entry operation;
  `check(step)` is check-only. The caller supplies and saves each request key
  before starting work.
- **Writer.** Storage's single-writer lease is taken through the injected
  writer port only for normal requests and released exactly once at actual
  close, after started work settled.
  Check-only and recovery requests never need it.
- **Admission.** The caller's policy decides admission of work Resolution
  presents after reuse had its chance; the default admits everything. A
  policy may deny work (it stays pending) or cancel it (withdrawn from this
  run). Once the run is stopped, Supervision cancels every later admission
  itself (see below).
- **Member outcomes.** `resolveMembers({ template, step }, { requestKey })` is
  a normal request for one template step across every current member. It
  reports discovery (`keyed` with its completion status, `rejected` with
  Definition's keying diagnostic, or `pending`/`cancelled` when discovery's
  own work was refused) and each member's typed outcome in canonical key
  order: `succeeded` (reused or published, with its exact reference),
  `skipped` (gated out, with gate evidence and no result), `pending`
  (admission denied; never a terminal failure), `failed` (a typed Resolution
  failure, including a gate failure) or `cancelled`. Members progress
  independently.
- **Strict fold outcomes.** `resolveFold(step, { requestKey })` is a normal
  request for one strict fold. It reports discovery and every member of the
  consumed template step as a members report does, then the fold's typed
  outcome:
  - `succeeded`: reused or published, with its exact reference and the
    framework's `coverage: { required, skipped, closed: true }`.
  - `failed`: a required member failed or was cancelled, or discovery was
    rejected or cancelled. It names the failed, cancelled and pending keys and
    whether discovery is open.
  - `waiting`: discovery is open or a required member is pending.
  - `pending` or `cancelled`: the fold was ready, but admission denied or
    cancelled its own work.

  A failed or waiting fold never ran its body, admitted fold work or
  published.
- **Outcome fold outcomes.** `resolveOutcomeFold(step, { requestKey })` is a
  normal request for one outcome (tolerant) fold. It reports discovery and
  every member as a members report does, then the fold's typed outcome:
  - `folded`: reused or published over every member's settled status, with
    complete coverage `{ succeeded, skipped, failed, cancelled, pending: [],
    openDiscovery: false, complete: true }`. It is not complete success: its
    coverage may list failed or cancelled members.
  - `waiting`: discovery is open or a member is pending, with the partial
    coverage settled so far.
  - `failed`: discovery was rejected or cancelled.
  - `pending` or `cancelled`: the set settled, but admission denied or
    cancelled the fold's own work; it carries the coverage it would have
    folded. A soft-stop cancelled member is settled for that run and never a
    success.
- **Observers.** Observers are captured at start and see frozen events at the
  fixed positions `stepLifecycle` and `ordinaryLifecycle`. They cannot veto or
  replace work. A throw before work stops only that call; a throw after a
  commit or after ordinary work finished becomes a diagnostic.
- **Ordinary work.** `ordinary(label, work)` runs nonmemoized work in the run
  scope, observed at `begin`/`end`/`fail`. It has no completed-result identity
  and no hidden memoization.

## Stop control, permits and execution controls

These implement RUN-002, RUN-014 and RUN-015 as the M5 plan's selected
execution contract describes them (EXP-8 mechanisms 1 and 2, ruling R).

- **Stop controller.** `createStopController({ timer })` holds an operator's
  stop intent; a run receives it as `options.stop`. Levels only escalate:
  - A **soft stop** admits no new work: Supervision's admission port
    cancels every later admission except the first attempts of children a
    draining step's body demands (see below). Admitted steps drain, with
    **no default deadline**.
  - An **operator deadline** on a soft stop escalates it to hard when it
    passes. The deadline timer never keeps the host alive on its own.
  - A **hard stop** aborts the run's signal. Admitted bodies are
    interrupted at once, even ones that never settle. Sends in flight,
    permit waits and waits for a time are aborted. Nothing new is committed.
- **Drain unit and taint.** The drain unit is the admitted step attempt: it
  keeps running, issues its remaining first-attempt requests and publishes.
  Authors isolate each paid call in its own child step, so a child an
  admitted, still-executing step's body demands is part of its drain and is
  admitted as a first attempt, transitively. Retries, deferred resumptions
  and waits stay refused, and work no executing admitted body demands (a new
  request, a fan-out member not yet started) is cancelled. A step whose send
  or wait was refused or aborted is tainted: whatever its body returns, its
  execution ends `interrupted`, so partial work is never published, and it
  sends nothing more and obtains no further child.
- **Publication commit.** Resolution asks `publicationRefusal()` in the same
  synchronous turn as each commit, so the commit is the linearization point:
  a hard stop effective before it discards the output, one after it cannot
  undo it. History's commit re-reads the writer lease durably, so a drain
  that outlives its lease cannot publish either.
- **Permits and window.** `options.permits` (default 1) bounds sends in
  flight. A permit guards only a real send, never waiting for a permit,
  children or a time. `options.window` (default 8, independent of permits)
  bounds how many fan-out members actively resolve at once: Resolution runs
  each member through the cancellation port's `member()`, which grants lanes
  first in, first out in canonical key order. A member waiting for a time
  lends its lane and, on waking, reclaims one ahead of members that have not
  started, so it never stalls its siblings. The window bounds members holding
  a lane, not every branch of a member's body; permits still bound its sends.
  The lane pool is run-wide, and only the run body's operations draw from it.
  Every run operation (`resolve`, `resolveMembers`, `resolveFold`,
  `resolveOutcomeFold`, `check`, `recover`, `ordinary`), called from inside
  member work or any step attempt (a fold's body included) by author code
  that kept the run, rejects at once with `undeclared-call` (CMP-9) and a run
  diagnostic naming the operation and the calling step. What it resolves or
  reads would enter no evidence of the calling body, and the refusal means a
  lane holder never waits for the window (RUN-002's nested rule).
  `assertDeclaredCall(operation)` checks the same rule without running
  anything: inside member or step work it records the diagnostic and throws
  the refusal, otherwise it returns. Its `operation` is a closed
  `IRunOperationName`; any other value throws `invalid-request` and records
  nothing. The facade's synchronous exact `read` calls it first, and the
  facade's author-facing run omits it.
- **Execution controls.** `supervision.execution()` gives author code and
  adapters the live run's controls by scoped lookup:
  - `send({ label, retry?, perform, cancel? })` holds one permit per send. A
    hard stop refuses or aborts it; a soft stop refuses retries and sends
    outside an admitted step. After a local abort the provider's `cancel` is
    asked, and the remote state (`cancelled`, `running` or `unknown`) is
    reported as a `send` event and in `result.interruptions`.
  - `sleepUntil(time)` waits, holding no permit, for a retry or deferred
    resumption; any stop ends it at once.

  The controls are attributed to the admitted step whose body is running
  (`step`). Each run's controls are its own, and after close they fail with
  `run-closed`.
- **Events.** Observers also see `stop` events (level, cause) and `send`
  events (label, phase, remote state), never values.

Writer-lease waiting builds on these primitives and is not decided here.

## External operations

These implement RUN-011 to RUN-014 and ACC-003/005/007 with the mechanisms
EXP-8 selected (mechanisms 3 to 7, supervisor resolutions 1 to 8, ruling R).
A run offers them when assembly passes `options.operations: { journal,
accounting }`, which needs the Supervision's timer:

- **Ports.** Both are structural and owned here, as the timer is: History's
  operation journal (`IOperationJournalPort`, opened with
  `operationJournalDeclaration`) and Accounting's durable adapter
  (`IOperationAccounting`). Supervision imports neither package. It keeps
  two collections of its own opaque records in the run's environment: one
  record per operation (`microdelta.supervision.operations`), and a
  per-subject index of the operations still unsettled at its addresses
  (`microdelta.supervision.blocks`). It never touches History rows.
- **The handle.** `execution().operation({ name, binding, perform, ... })`
  is called from an admitted step attempt's body in a normal request. An
  operation is addressed by the attempt's subject, its identifier `name` and
  the author's opaque `binding` digest: an unsettled operation at the address
  keeps its identity, a settled one or a changed binding is new (RUN-012).
  Authors isolate each paid call in its own child step (EXP-8 resolution 3).
- **Intent before send, usage before outcome.** Once the permit is held and
  stop intent rechecked, one journal commit records the operation `pending`
  with a new request attempt, then Accounting records the usage intent; only
  then is the request sent. If either write fails (Accounting busy, or a
  commit it could not confirm), nothing is sent and the attempt is pending on
  a one-second deferral, so its step waits and is retried, never failed. A usage report is acknowledged under
  `provider:<report>` before the outcome is committed; a failed
  acknowledgment is reported, never claimed, and leaves usage unknown.
- **Outcomes and policy.** `succeeded` settles the operation. A permanent
  refusal fails it. A transient failure retries only under the author's
  `retry.maxAttempts`, waiting its backoff as a short durable deferral that
  holds no permit and lends the member's lane. A rate or quota response with
  a retry time defers the operation durably until then and is retried by
  default, at most `retry.rateLimitRetries` times (5). A lost response
  (`unknown`, or a rejected `perform`) is retried at once only with a safety
  basis (`safeToRepeat`, or `providerIdempotency`, which sends the operation
  identity as the key) and a policy allowing another attempt.
- **Taint guard.** A deferral or an unknown outcome makes the step attempt
  pending: every later operation or send it makes rethrows the signal
  without sending, its execution ends `unsettled`, and its step stays
  pending (never failed or cancelled), so a strict fold over it waits.
- **Admission.** Before the caller's policy, admission reads the step's
  unsettled operations: a deferral not yet due, or an unknown outcome that
  may not be retried, denies the work with the block named on the pending
  member (`blocked`); an operation a dead run left in flight is recorded
  `unknown` first (`recovered`). Under stop intent a resumable deferral or
  retry is cancelled.
- **Deferral passes.** Each normal request runs in passes. A pass that met a
  deferral ends with that work pending. Once only deferred work remains the
  run releases its writer lease; in `deferral: 'sleep'` mode (the default) it
  waits until the earliest time, any stop ending the wait, and runs another
  pass under request key `<key>#pass:<n>` (a caller's normal request key
  may not contain `#pass:`), where the deferred work resumes
  under the same operation identities and steps that settled earlier (for
  example failed members) are not executed again; in `'exit'` mode it
  returns, and `result.waitingUntil` reports the time. Later runs honor it.
- **Hard stop.** An aborted request's remote state (`cancelled`, `running` or
  `unknown`) is committed by operation and request attempt; a confirmed
  cancellation settles the operation, otherwise it is unknown.
- **Lease authority.** Every commit uses the lease of the pass, so a pass
  that lost its lease records nothing: its operation stays `pending` and any
  later run records it unknown (ruling R).
- **Operator settlement.** `run.inspectOperations()` lists the environment's
  operations; `run.settleOperation({ action: 'resolve' | 'abandon', ... })`
  settles an unknown one under the writer lease. Usage the operator learned
  is acknowledged under `operator:<report>`; an abandoned operation keeps its
  usage unknown. Either unblocks the step. A resolution as `succeeded` keeps
  the address consumed: a later call there mints and sends nothing and fails
  with `operation-resolved` (no value; the author may catch it). A resolution
  as `failed`, or an abandonment (the operator's explicit authorization of a
  possible second effect), frees the address for a new operation. A
  resolution carrying a result is M6 work. Both actions are run operations,
  so a call from inside member or step work is refused as an undeclared call
  (CMP-9).
- **Identities.** An operation identity is `op-` and an identifier from the
  injected random source (`options.random`, structurally the Machine's
  random identifier capability), so it never repeats across stores,
  processes or hosts; it is the provider idempotency key and every retry
  keeps it. One call at an address may be in progress in a run, and an
  attempt that ended sends nothing.
- **Waking while the lease is held.** A sleeping request that wakes while
  another holder has the writer lease returns waiting until its time, as
  exit mode does (`wait` phase `writer-busy`).
- **Events.** `operation` events carry identifiers (operation, request
  attempt, step attempt, member, run), closed status and reason codes, times,
  usage figures with identifier units and the remote state; `wait` events
  carry the earliest time and whether the lease was released. Neither ever
  carries the binding, arguments, values, provider bodies or error messages,
  and diagnostics name codes and identifiers only (RUN-013).

## Tests

Owner tests (`test/`) use Node's real AsyncLocalStorage through the
structural capability, a recording Resolution port double and in-memory
journal and accounting port doubles for failure paths; `test-d/` holds the
type contracts. The same behaviors run over the real owner implementations
in the facade's assembly suites (`packages/core/test/workspace`,
`packages/core/test/stop` and `packages/core/test/operations`, which also
holds the on-demand mutation controls of external operations).
