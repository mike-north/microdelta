# @microdelta/supervision

## 0.3.0
### Minor Changes

- af7323b: Add external operations to Run Supervision, with retry and durable deferral, operator settlement and privacy-restricted events (project-private `@alpha` surfaces).
  
  - **Operation handle.** `execution().operation({ name, binding, perform, ... })`, called from an admitted step attempt's body, performs one logical external call. Before each send it commits the operation's intent through History's operation journal and records Accounting's usage intent; a usage report is acknowledged before the outcome is committed. Outcomes are succeeded, failed, deferred until a time, or unknown.
  - **Ports.** A run receives `operations: { journal, accounting }`. Both ports are structural and owned by Supervision (`IOperationJournalPort`, opened with `operationJournalDeclaration`, and `IOperationAccounting`), so Supervision takes no dependency on History or Accounting.
  - **Retry and deferral.** Rate and quota responses with a retry time are deferred durably and retried by default, at most 5 times unless the author overrides it. Other transient failures retry only under an author policy. A lost response is never replayed without a safety basis (`safeToRepeat`, or `providerIdempotency`) and a policy. A step attempt that meets a deferral or unknown outcome sends nothing more and stays pending.
  - **Passes.** Members, strict-fold and outcome-fold requests run in passes. Once only deferred work remains, a run releases its writer lease and either sleeps and resumes in another pass (`deferral: 'sleep'`, the default) or returns with `waitingUntil` (`'exit'`). Admission in later runs honors the time and blocks unknown outcomes; pending members name the block.
  - **Hard stop.** An aborted request's remote state is recorded durably in the journal.
  - **Operator settlement.** `run.inspectOperations()` and `run.settleOperation({ action: 'resolve' | 'abandon', ... })` settle an unknown operation; operator usage is acknowledged under an operator-namespaced report identity. A resolution as succeeded keeps the address consumed: a later call there sends nothing and fails with `operation-resolved`. A resolution as failed, or an abandonment, frees the address.
  - **Identities.** Operation identities, which are also provider idempotency keys, carry 128 random bits from the new Machine random identifier capability (`IRandomIdentifierCapability`, Node's `createNodeRandom()`), passed to Supervision with the operation ports (`operations: { journal, accounting, random }`). An intent that cannot be made durable sends nothing and leaves the step pending on a deferral that backs off exponentially (1 s, doubling, capped at 60 s).
  - **Events.** New `operation` and `wait` run events carry identifiers, closed codes, times, usage with identifier units and remote state, never values. Exhaustive narrowing of `IRunEvent` must now handle them.
  - **Resolution.** The cancellation port's `execute` receives the claimed attempt's subject and identity, and may report an `unsettled` execution, which ends the attempt interrupted and leaves the step pending. A promoted candidate's recorded dependencies are accepted as historical evidence of the same analysis.
  - **Facade.** A workspace run passes `inspectOperations` and `settleOperation` through; without operation ports they fail with `invalid-request`.
- 3eaa7ed: Expose M5's operational surface on the `microdelta` facade (project-private `@alpha` surfaces).
  
  - **Operation ports.** `openWorkspace({ ..., accounting })` takes the caller's Resource Accounting port (`IWorkspaceAccounting`: Supervision's structural `IOperationAccounting`, which the facade now aliases, plus `summarizeUsage`). With it, every run receives Supervision's operation ports: the workspace builds History's operation journal and Node's random identifier source itself. Without it, operations, inspection, settlement and usage fail with `invalid-request`. The facade takes no runtime or type dependency on `@microdelta/accounting`; Accounting's durable adapter satisfies the port structurally.
  - **Operation handle and operator actions.** `currentExecution().operation(request)` performs one declared external operation; `run.inspectOperations()` and `run.settleOperation(...)` now work in workspaces given Accounting. The facade exports aliases for the request, response, view, settlement, event and wait types (`IOperationRequest`, `IOperationResponse`, `IOperationView`, `IOperationSettlement`, `IOperationEvent`, `IWaitEvent` and the rest).
  - **Deferral mode.** Workspace runs accept `deferral: 'sleep' | 'exit'`; in exit mode the result reports `waitingUntil`.
  - **Usage summaries.** `run.usage(filter?)` reads the run environment's usage summary through the injected port, keeping unknown usage and estimates (`estimates`) apart from observed quantities.
  - **Recorded promotion (Supervision).** New run operations `IRun.promote({ into, references, evidence })` and `IRun.promotions()` over a structural promotion port (`IRunOptions.promotion: IRunPromotionPort`), which History's durable store satisfies and the facade supplies. A promotion obtains the writer lease as a normal request does (waiting under `writerWait`, `WriterBusyError` at the deadline), is refused with `stopped` when stop intent is in force immediately before the commit, and offers an identifier-only `promotion` event (`IPromotionEvent`). `promote` targets another environment; `promotions()` lists the promotions recorded into the run's own. `IRunOperationName` gains `'promote'` and `'promotions'`, and `IRunEvent` gains the `promotion` kind: exhaustive handling of either must cover the new members.
  - **Settlement (Supervision).** An operation resolved as succeeded keeps its address consumed until the operator abandons it; `settleOperation({ action: 'abandon' })` now accepts such an operation, which frees its address. The record and `IOperationView` keep the superseded resolution (`resolution`: operator, outcome, time and usage report) beside the abandonment, so the audit trail survives; records written before the field existed read as having none.
  - **Unique run identifiers.** A run without a caller-supplied `runId` is now identified as `run:<32 hex digits>`, minted from 128 random host bits, so no two runs of any process or host share one; it was a per-workspace counter that repeated across processes. A caller-supplied `runId` must be an identifier (`^[a-z][a-z0-9_.:-]{0,63}$`) and must not take the reserved minted form; anything else is refused with `invalid-request`.
  - **Definition.** A supplied step's `run` may be asynchronous (`TResult | Promise<TResult>`), as a memo body may: its call's result is the settled value. This lets an author isolate one awaited external operation per supplied call.
- 7293b47: Add outcome (tolerant) folds over a template step's members (project-private `@alpha` surfaces).
  
  - **Declaration.** `outcomeFold({ subject, over: { template, step }, run })` declares an outcome fold. It is a composition-level step of its own kind, never a child, member step or template step. The composition topology lists it in `outcomeFolds`, apart from strict `folds`.
  - **Entries.** The body receives one entry per current member in canonical key order, with that member's settled status: `succeeded` with a view of its result, or `skipped`, `failed` or `cancelled` with no data. Reading data from a failed or cancelled entry throws `unsuccessful-member`. A pending member is never an entry.
  - **Completeness.** `resolveOutcomeFold` settles every member first. While discovery is open or any member is pending, the outcome is `waiting` with the partial coverage settled so far. A waiting fold runs no body, admits no fold work and publishes nothing. A rejected or cancelled discovery makes it `failed`.
  - **Repair.** Once the set has settled, the fold is validated or executed over its membership-and-status fact, which also records failed and cancelled members. Repairing a failed member makes the fold reconsider, and unaffected member results are reused.
  - **Coverage.** Every member is listed under exactly one of `succeeded`, `skipped`, `failed`, `cancelled` or `pending`, with `openDiscovery` and `complete`. Coverage is derived by the framework and is never a claim of complete success. A member cancelled by a stop is settled but not successful for that run.
  - **Separation.** Outcome folds record version-4 provenance, so a strict fold never accepts an outcome fold's result, nor the reverse. Strict folds are unchanged.
  - **Report.** Supervision and the facade report `IOutcomeFoldReport` with `folded`, `waiting`, `failed`, `pending` or `cancelled`.
  - **Nested run operations are refused.** Author code may keep the run and call one of its operations (`resolve`, `resolveMembers`, `resolveFold`, `resolveOutcomeFold`, `check`, `recover`, `ordinary`, or the facade's `read`) from inside member work or any step attempt, a fold's body included. That call now rejects at once with the new `undeclared-call` Supervision error, before any of its work is admitted, and the run records a diagnostic that names the operation and the calling step (CMP-9). What it resolves or reads would enter no evidence of the calling body. Previously such a call could wait for the run-wide window lane that its caller held, and deadlocked with a window of one lane. `IRun.assertDeclaredCall(operation)` checks the same rule: inside member or step work it records the diagnostic and throws the refusal, otherwise it returns. Its `operation` is one of the closed `IRunOperationName`s, and any other value throws `invalid-request` without recording anything. The facade's synchronous `read` uses it, and the facade's author-facing `IWorkspaceRun` omits it.
- 00f672e: Add operator stop control, a bounded permit pool, the publication-commit rule and bounded nested waiting to supervised runs (project-private `@alpha` surfaces).
  
  - **Stop controller.** `createStopController()` holds operator stop intent, and a run receives it as `stop`. Levels only escalate.
    - A soft stop admits no new work and refuses every retry, while admitted steps drain with no default deadline. The drain unit is the admitted step attempt: a child its still-executing body demands is admitted as a first attempt; its retries and waits stay refused, and work no executing admitted body demands is cancelled.
    - An operator deadline on a soft stop escalates it to hard; its timer never keeps the host alive on its own.
    - A hard stop interrupts admitted bodies at once, even ones that never settle. It aborts sends in flight, permit waits and waits for a time, and it forbids later commits.
  - **No partial output.** A step whose send or wait was refused or aborted can no longer publish. An interrupted attempt ends `interrupted`, with a `stopped` ending, and reports a `refused` outcome with disposition `cancelled`.
  - **Publication commit.** Each commit first asks Supervision whether a hard stop forbids it, in the same synchronous turn, so the commit is the linearization point. History's commit still re-reads the writer lease durably, so a drain that outlives its lease cannot publish.
  - **Permits and window.** A run's `permits` (default 1) bound sends in flight; a permit guards only a real send, never waiting. Its `window` (default 8, independent of permits) bounds how many fan-out members actively resolve at once. Resolution runs each member through the cancellation port's `member()`; members start first in, first out, and report in canonical key order. A member waiting for a time lends its lane and, on waking, reclaims one ahead of members that have not started, so it never stalls its siblings. Each send's `perform` receives its own abort signal, detached from the run once the send settles. Resolution without Supervision resolves members one at a time.
  - **Execution controls.** `currentExecution()` returns the live run's controls, attributed to the admitted step running there:
    - its stop state and abort signal;
    - `send({ label, retry?, perform, cancel? })`, which records the remote state (`cancelled`, `running` or `unknown`) of an aborted send;
    - `sleepUntil(time)`, which any stop ends at once.
  
    The controls fail with `run-closed` after the run closes.
  - **Run report.** Observers see `stop` and `send` events, which carry identifiers, levels and states only. A run result reports its closing stop state and every aborted send's remote state.
  - **Bounded nested waiting.** A nested memo still waits for the calls it started before ending its attempt, but run cancellation now bounds that wait. A never-settling child ends interrupted under a hard stop, and a body that threw while children hung reports its own error.
  - **Timer capability.** Machine adds the portable `ITimerCapability`: the wall clock plus one-shot callbacks at a wall-clock time. The Node adapter adds `createNodeTimer()`, which re-arms rather than firing early and splits waits beyond Node's timer range.
- a6addaa: Wait for the store's writer lease until an operator deadline, with a typed writer-busy outcome. This is a breaking change to project-private `@alpha` surfaces.
  
  - **Waiting.** A normal request that finds another run, in this or another process, holding the writer lease now waits instead of failing. It polls on Supervision's timer every `writerWait.pollMilliseconds` (default one second) and also wakes exactly at the holder's recorded expiry and at the deadline. History alone decides takeover: an expired lease is taken over only through a fresh fence, and a poll changes nothing but the clock high-water. Concurrent requests of one run share one wait.
  - **Deadline.** `writerWait.deadline` (whole epoch milliseconds) has no default: without one a request waits until it holds the lease or a stop ends the wait. A deadline already reached still allows one try. At the deadline the request fails with `WriterBusyError` (code `writer-busy`), which names the holder and expiry its final try observed, or reports storage contention, and says when the recorded holder is the run itself (`heldByThisRun`).
  - **Breaking: `writer-unavailable` is removed.** `writer-busy` replaces it as the code a held writer lease produces.
  - **Breaking: the writer port only tries.** `IRunWriter.lease()` is removed. Its replacement, `IRunWriter.tryLease()`, returns an `IWriterAttempt` (`acquired`, `held` or `contended`) instead of throwing.
  - **Stops.** Any stop, soft or hard, ends a wait at once with `stopped`; a stop already in force does not keep a request from a free lease. Check-only and recovery requests never wait.
  - **Breaking: History reports contention as an outcome.** When SQLite stays locked past its bounded busy wait:
    - `acquireWriter` now returns a `contended` outcome (`IWriterContention`) carrying the writer recorded at that moment, read without the write lock.
    - `renewWriter` now returns an `IWriterRenewal`, either `renewed` with the extended lease or `contended`. A busy renewal therefore leaves the lease in place instead of being treated as stale.
  
    Neither ever surfaces a raw driver error. Renewal and release no longer assign the writer row's fence column; only a grant writes it.
  - **Nested runs.** A workspace run started from inside an open run over the same store file is refused at once with `invalid-request`; it would otherwise wait forever for the lease its caller holds. This holds whichever workspace object opened the file and however its location was spelled, using machine-node's new `canonicalNodeLocation`, which gives an existing file's real path.
  - **Facade.** Workspace runs accept `writerWait`, and the facade exports `WriterBusyError` and `IWriterWaitOptions`.

### Patch Changes

- cd05189: Fixes for defects found by the M5 acceptance suite (project-private `@alpha` surfaces).
  
  - **Stop at the start of a deferral sleep.** A hard stop that is already in force when a run begins its deferral sleep no longer arms the sleep's keep-alive timer. For example, a stop requested by an observer reacting to the `sleeping` event. The process can now exit at once instead of staying alive until the deferral's time.
  - **`resumed` wait events.** `released` reports whether the run released its writer lease for that wait, including a release made while the request slept. It is no longer always `false`.
  - **A lost writer lease mid-pass.** History may refuse a write because the lease no longer authorizes it. This covers claims, publications, acceptances and attempt endings. The refused write records nothing, and it no longer escapes as History's raw `StaleWriterError`. The step that needed it is denied with reason `lease-lost`. So a soft-stop drain that outlived its lease ends with typed member outcomes, even when it meets results its successor published (EXP-8 ruling R). Every other History failure keeps its own typed outcome and is never reported as `lease-lost`. Integrity damage met while staging or publishing a result now reports `integrity`, as it already did for claims and acceptances.
  - **Author error text.** Framework failure messages and diagnostics name the step or position and the failure kind only. They never repeat what author or caller code threw. This covers bodies, source checks, finality hooks, gates, custom keys, slot subject functions, admission, lifecycle and run observers, and abort listeners. The thrown value stays available as the failure's `cause`. `DefinitionError` accepts an optional `cause`, and a throwing slot subject function's rejection carries it.
- b6406a9: Follow-ups to external operations (project-private `@alpha` surfaces).
  
  - **Stop during a woken pass's lease wait.** It now returns the earlier pass's report with `waitingUntil`, as a stop during the sleep does, instead of rejecting with `stopped`.
  - **Unsent request attempts.** One is reused, with the attribution its intent was first recorded with, only when that intent may have landed, that is when Accounting's failure carries `durability: 'unknown'`. A failure that recorded nothing, such as `AccountingBusyError`, leaves the attempt as not sent, and the retry is a fresh request attempt credited to the run that sends it. The mark is sticky, so a reused attempt stays unconfirmed whatever its own retry's failure is. A not-sent attempt recorded before the mark existed is read as unconfirmed.
  - **Accounting.** `AccountingDurabilityUnknownError` carries `durability: 'unknown'`, so consumers without an Accounting edge can tell a write that may have landed from one that recorded nothing.
- Updated dependencies [cd05189]
- Updated dependencies [af7323b]
- Updated dependencies [3eaa7ed]
- Updated dependencies [c0eaf43]
- Updated dependencies [7293b47]
- Updated dependencies [00f672e]
  - @microdelta/resolution@0.3.0
  - @microdelta/definition@0.3.0

## 0.2.0
### Minor Changes

- 70b9d9b: Resolve keyed template member instances with tracked gates, and report typed member outcomes (project-private `@alpha` surfaces).
  
  - Resolution resolves template instance steps: a template step descriptor plus a member key. Strict folds are still refused with `invalid-request`.
  - Discovery: the template's collection source resolves under its current source policy, once per request. Definition keys its exact result before any gate or member body.
  - A rejected snapshot (duplicate or missing key, failed custom key, malformed snapshot) admits no gate or member work and surfaces Definition's keying diagnostic. A direct instance request fails with the new `collection-rejected` code. A member absent from the current snapshot is an `unbound-step`.
  - Gates: each member's gate runs once per request in its own tracking frame, over the declared inputs and helpers and the member's current record at the `member` binding. Its observations are the member's gate evidence and never enter a step's provenance.
    - An explicit `false` is a new `skipped` normal and check outcome, carrying the gate evidence. It admits, publishes and retracts nothing.
    - A non-boolean result or a throw fails with the new `gate-failure` code.
  - Member step callbacks receive the member binding. A member source's `run` and `finality` and a member memo's `run` get `member`, a view of the instance's current keyed record, typed from the collection's member type (`IMemberBinding`, `IMemberBuilder<F, TMember>`).
    - Definition applies instances with Resolution's member supplier. An instance without one, or any other step with one, rejects with `invalid-bindings`. Explicitly keyed members have no member binding.
    - `ISourceDeclaration`, `IMemoDeclaration` and their options gain a defaulted context-extension parameter; ordinary declarations are unchanged. `IPreviousSupplier.carrier` accepts any source declaration of the result type.
  - Reads of `member` are the step's own observations, validated against the current keyed record on reuse. A forwarded `member` origin is rebuilt from the same record. An unread discovery field therefore changes nothing, and a consumed member field reruns only the member steps that consumed it.
  - A template instance candidate whose recorded step no longer matches the current descriptor (a renamed template, or a collection moved to another slot) is a `correspondence` miss; prior instances are never remapped.
  - `resolveMembers({ template, step, requestKey, lease })` resolves one template step for every current member in canonical key order, each member independently. A member whose evidence is ready completes and publishes while discovery is open or siblings fail.
    - Member-attributable failures (execution, `gate-failure`, `unbound-step` and the like) stay with their member.
    - Run-level failures (`admission-failure`, `observer-failure`, `integrity`, `wrong-intent`, `invalid-request`, History or host errors) reject the whole request.
  - A gate that returns a promise or thenable fails with `gate-failure` ("returned a promise, not a boolean").
  - Admission decisions gain `cancelled`. A refused outcome's `disposition` records whether admission denied or cancelled the work; a cancelled child makes its parent's refusal cancelled, whichever child was refused first.
  - Supervision adds `run.resolveMembers({ template, step }, { requestKey })`. It reports discovery (`keyed`, `rejected`, `pending` or `cancelled`) and each member's typed outcome: `succeeded`, `skipped`, `pending`, `failed` or `cancelled`. A pending member is never a terminal failure.
  - The workspace run exposes `resolveMembers`, and the facade re-exports `IMembersTarget`, `IMembersReport`, `IMemberOutcome`, `IDiscoveryReport` and `IGateEvidence`. Consumers that narrow `IResolutionOutcome` must now handle `skipped`.
- bc4fc00: Resolve strict folds with honest readiness, framework coverage and membership-aware verification (project-private `@alpha` surfaces).
  
  - `resolveFold({ step, requestKey, lease })` resolves one strict fold. It first settles the consumed template step for every current member, each independently, exactly as `resolveMembers` does.
  - Readiness is decided before any fold work:
    - A failed or cancelled required member, a rejected snapshot or cancelled discovery work makes the outcome `failed`. It names the failed, cancelled and pending keys and whether discovery is open.
    - Otherwise, open discovery, denied discovery work or a pending member makes it `waiting`.
    - Neither runs the fold body, admits fold work or publishes.
  - Only a ready fold is validated or executed. Its body receives one explicit entry per current member in canonical key order: `succeeded` with a view of the member's accepted result, or `skipped` with no data.
  - A `reused` or `published` fold carries framework coverage `{ required, skipped, closed: true }`, derived from the delivered members rather than the body's result. A closed empty population is a successful fold. An open one waits, and never rewinds an earlier result.
  - Fold provenance (version 3) records the consumed template step, the membership-and-status fact and the member facts the body consumed; gate observations stay each instance's own evidence. Validation recomputes the fact from current discovery and gate outcomes.
    - A renamed consumed step or template, or a moved collection, is a `correspondence` miss, never a remap.
    - The new miss reasons are `changed-membership` and `changed-member-output`.
    - A gate flip, insertion or deletion reruns the fold. A reorder or a threshold edit that flips no gate reruns nothing. A member change reruns the fold only when a fact it consumed changed.
  - Skips and deletions retract nothing.
  - `resolve` and `check` still refuse a fold step with `invalid-request`, now pointing to `resolveFold`. `recover` reports a fold's admitted execution. Admission requests gain the `fold` step kind.
  - Supervision adds `run.resolveFold(step, { requestKey })`. It reports discovery, every member's typed outcome and the fold's typed outcome: `succeeded`, `waiting`, `failed`, `pending` or `cancelled`. The workspace run exposes it.

### Patch Changes

- Updated dependencies [70b9d9b]
- Updated dependencies [8574520]
- Updated dependencies [9393e12]
- Updated dependencies [5593f4d]
- Updated dependencies [bc4fc00]
  - @microdelta/definition@0.2.0
  - @microdelta/resolution@0.2.0

## 0.1.0
### Minor Changes

- 438854d: Add the project-private Run Supervision owner and the facade's alpha workspace path. Supervision runs scoped work over a structurally injected async-scope capability: runtime context lookup fails outside a live run, after close and during composition; normal requests take the writer lease lazily and the run releases it once; the caller's policy decides admission; observers see frozen events at fixed lifecycle positions and cannot veto work; ordinary nonmemoized work is observed without result identity. The facade composes the owners into `authoring()`, `openWorkspace()` with normal and recovery entry operations, and `currentRun()`, all as facade-local alpha declarations, so the public Store API is unchanged. Definition's topology now names its declared input and callable slots, and `isComposing()` reports the composition phase.

### Patch Changes

- Updated dependencies [5420e30]
- Updated dependencies [7004ca9]
- Updated dependencies [438854d]
  - @microdelta/definition@0.1.0
  - @microdelta/resolution@0.1.0
