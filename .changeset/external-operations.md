---
"@microdelta/supervision": minor
"@microdelta/resolution": minor
"microdelta": patch
---

Add external operations to Run Supervision, with retry and durable deferral, operator settlement and privacy-restricted events (project-private `@alpha` surfaces).

- **Operation handle.** `execution().operation({ name, binding, perform, ... })`, called from an admitted step attempt's body, performs one logical external call. Before each send it commits the operation's intent through History's operation journal and records Accounting's usage intent; a usage report is acknowledged before the outcome is committed. Outcomes are succeeded, failed, deferred until a time, or unknown.
- **Ports.** A run receives `operations: { journal, accounting }`. Both ports are structural and owned by Supervision (`IOperationJournalPort`, opened with `operationJournalDeclaration`, and `IOperationAccounting`), so Supervision takes no dependency on History or Accounting.
- **Retry and deferral.** Rate and quota responses with a retry time are deferred durably and retried by default, at most 5 times unless the author overrides it. Other transient failures retry only under an author policy. A lost response is never replayed without a safety basis (`safeToRepeat`, or `providerIdempotency`) and a policy. A step attempt that meets a deferral or unknown outcome sends nothing more and stays pending.
- **Passes.** Once only deferred work remains, a run releases its writer lease and either sleeps and resumes in another pass (`deferral: 'sleep'`, the default) or returns with `waitingUntil` (`'exit'`). Admission in later runs honors the time and blocks unknown outcomes; pending members name the block.
- **Hard stop.** An aborted request's remote state is recorded durably in the journal.
- **Operator settlement.** `run.inspectOperations()` and `run.settleOperation({ action: 'resolve' | 'abandon', ... })` settle an unknown operation; operator usage is acknowledged under an operator-namespaced report identity.
- **Events.** New `operation` and `wait` run events carry identifiers, closed codes, times, usage with identifier units and remote state, never values. Exhaustive narrowing of `IRunEvent` must now handle them.
- **Resolution.** The cancellation port's `execute` receives the claimed attempt's subject and identity, and may report an `unsettled` execution, which ends the attempt interrupted and leaves the step pending. A promoted candidate's recorded dependencies are accepted as historical evidence of the same analysis.
- **Facade.** A workspace run passes `inspectOperations` and `settleOperation` through; without operation ports they fail with `invalid-request`.
