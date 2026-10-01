---
"microdelta": minor
"@microdelta/supervision": minor
"@microdelta/definition": minor
---

Expose M5's operational surface on the `microdelta` facade (project-private `@alpha` surfaces).

- **Operation ports.** `openWorkspace({ ..., accounting })` takes the caller's Resource Accounting port (`IWorkspaceAccounting`: Supervision's structural `IOperationAccounting` plus `summarizeUsage`). With it, every run receives Supervision's operation ports: the workspace builds History's operation journal and Node's random identifier source itself. Without it, operations, inspection, settlement and usage fail with `invalid-request`. The facade takes no runtime or type dependency on `@microdelta/accounting`; Accounting's durable adapter satisfies the port structurally.
- **Operation handle and operator actions.** `currentExecution().operation(request)` performs one declared external operation; `run.inspectOperations()` and `run.settleOperation(...)` now work in workspaces given Accounting. The facade exports aliases for the request, response, view, settlement, event and wait types (`IOperationRequest`, `IOperationResponse`, `IOperationView`, `IOperationSettlement`, `IOperationEvent`, `IWaitEvent` and the rest).
- **Deferral mode.** Workspace runs accept `deferral: 'sleep' | 'exit'`; in exit mode the result reports `waitingUntil`.
- **Usage summaries.** `run.usage(filter?)` reads the run environment's usage summary through the injected port, keeping unknown usage apart from observed quantities.
- **Environments and promotion.** `run.promote({ into, references, evidence })` records a promotion into another environment of the run's analysis under the store's writer lease, which the run obtains as a normal request does (waiting under `writerWait`, `WriterBusyError` at the deadline). `run.promotions()` lists the promotions into the run's environment.
- **Unique run identifiers.** A run without a caller-supplied `runId` is now identified as `run:<32 hex digits>`, minted from 128 random host bits, so no two runs of any process or host share one; it was a per-workspace counter that repeated across processes.
- **Supervision.** `IRun.withWriterLease(work)` runs operator work under the store's writer lease, obtained exactly as a normal request obtains it, and hands the lease to the work without interpreting it. `IRunOperationName` gains `'withWriterLease'`; exhaustive handling of it must cover the new name. The facade's author-facing run omits it.
- **Definition.** A supplied step's `run` may be asynchronous (`TResult | Promise<TResult>`), as a memo body may: its call's result is the settled value. This lets an author isolate one awaited external operation per supplied call.
