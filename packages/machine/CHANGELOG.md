# @microdelta/machine

## 0.2.0
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
- dba23f0: Processes that open the same new SQLite store at the same time now all succeed: the Node adapter retries its durable configuration within the bounded busy wait instead of failing the losers with a raw driver error. Contention that outlasts the wait surfaces from opening, statements and transactions as the typed alpha `SqliteBusyError`, which Machine now declares.
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

## 0.1.0
### Minor Changes

- 39eef60: Add separate alpha SQLite and clock capabilities for durable local storage consumers. The Node adapter provides configured persistent connections, synchronous immediate transactions, portable value transport and explicit connection lifetime checks while preserving existing Machine consumers.
- 0b26e08: Add `@microdelta/value` for canonical value and snapshot encodings, structured selected-fact observations, and fingerprints. Add the Machine SHA-256 capability and its Node implementation.
