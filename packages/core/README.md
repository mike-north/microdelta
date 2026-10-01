# microdelta facade

The `microdelta` entry preserves the scaffold's existing public History
Store API. It explicitly reexports `@microdelta/history` declarations and runtime
values; it does not own the Store or grant other contexts an import shortcut.
See the [package map](../../docs/package-map.md) and [active specification](../../docs/spec/README.md).

```js
import { createMemoryStore } from 'microdelta';
const store = createMemoryStore();
console.log(await store.meta());
await store.close();
```

The existing Jest suite remains available at `microdelta/conformance/store` and
is implemented by History. Memory is process-local and non-durable.

## Project-private workspace path (alpha)

The facade's generated **alpha** declarations also carry the workspace
authoring and run path. Every name is a project-private `@alpha` contract that
may change without notice; the default public entry exposes none of it. It
composes the owners and adds no policy of its own:

- `authoring<TInputs, THelpers>()`: Definition's builders bound to Reuse
  Resolution's binding family: `source` (including keyed collection sources),
  `memo`, `template` (fanout over a keyed collection with an optional custom
  key and tracked gate; member steps read their member through the `member`
  binding), `fold` (a strict fold over one template step), `outcomeFold` (an
  outcome fold over every member's settled status), `stepSlot`,
  `suppliedStep` and `supply` (callable step slots bound at composition),
  the canonical `forward` argument origins, and `compose`. Step callbacks also
  receive the observed `untracked` read.
- `openWorkspace({ location, logicalStore })`: durable History over Node's
  SQLite and clock. `workspace.run(options, body)` is one Run Supervision run
  whose Resolution resolves against that store; the run offers the normal entry
  operation `resolve(step, { requestKey })`, `resolveMembers(target, {
  requestKey })` for every current member of a template step,
  `resolveFold(step, { requestKey })` for a strict fold (reporting discovery,
  each member's typed outcome and the fold's outcome with coverage),
  `resolveOutcomeFold(step, { requestKey })` for an outcome fold (the same
  report, with an outcome that folds every settled status and coverage that
  never claims a complete set while anything is unsettled), the
  recovery entry operation `recover(step, { requestKey })`, `check(step)`,
  observed nonmemoized `ordinary(label, work)`, and exact `read(reference)`.
  A run's options may also carry an operator stop controller (`stop`), its
  permit pool size (`permits`, default 1) and fan-out window (`window`,
  default 8, independent of permits; a member waiting for a time lends its
  lane), how it waits for another holder's writer lease (`writerWait`, with
  no default deadline; `WriterBusyError` names the holder at the deadline),
  and what it does once only deferred work remains (`deferral`: `sleep`, the
  default, or `exit`, reporting `waitingUntil`). Unless the caller supplies
  `runId`, every run is identified as `run:<32 hex digits>` from 128 random
  host bits, so no two runs of any process share one. A caller-supplied
  `runId` must be an identifier (`^[a-z][a-z0-9_.:-]{0,63}$`) other than that
  reserved form, and keeping it unique is the caller's responsibility.
- Operations: `openWorkspace({ ..., accounting })` takes the caller's
  Resource Accounting port (`IWorkspaceAccounting`, which Accounting's durable
  adapter satisfies structurally; the facade never imports Accounting). With
  it, the workspace builds History's operation journal and Node's random
  source and gives every run Supervision's operation ports:
  `currentExecution().operation(request)` performs one declared external
  operation (intent before send, usage counted once, no blind replay), and the
  run offers `inspectOperations()`, `settleOperation(settlement)` and
  `usage(filter?)`, its environment's usage summary with unknown usage kept
  apart.
- Environments: a run selects its environment. Supervision's run operation
  `promote({ into, references, evidence })` records a promotion of exact
  results into *another* environment, under the writer lease and refused when
  a stop is in force, through History's durable store as Supervision's
  structural promotion port; `promotions()` lists the promotions recorded
  *into the run's own* environment. Trial results satisfy production only
  that way.
- `currentRun()`: the live run's context, looked up without a parameter.
- `createStopController()`: operator stop intent with deadlines on Node's
  timer. A soft stop admits no new work and drains admitted steps (with the
  first attempts of the children their bodies demand), with no
  default deadline; a deadline or a hard stop aborts sends, permit waits and
  waits for a time, and discards uncommitted output.
- `currentExecution()`: the live run's execution controls, looked up without
  a parameter: its stop intent and abort signal, permit-guarded `send`,
  stop-aware `sleepUntil` and the external `operation` handle, attributed to
  the admitted step running there.

The alpha view names the owners' contracts through facade-local aliases, so a
consumer imports only `microdelta`: for example `IMemberBuilder`,
`IStepSlot`, `IForwarded`, `IFoldEntry`, `IFoldReport`, `IStrictFoldOutcome`,
`IFoldCoverage`, `IOutcomeEntry`, `IOutcomeFoldReport`,
`IOutcomeFoldRunOutcome`, `IOutcomeFoldCoverage`, `IOperationRequest`,
`IOperationView`, `IOperationEvent`, `IWaitEvent`, `IUsageSummary` and
`IPromotionRecord`.

The [contribution report example](../../examples/contribution-report/README.md)
uses this path through the installed workspace's generated alpha declarations.
The M3 independent-process acceptance harness in `test/acceptance` exercises
this path across process exits, kill boundaries and lost-acknowledgment
recovery; see the [M3 acceptance record](../../docs/validation/m3-acceptance-2026-09-28.md).
The M4 independent-process acceptance suite in `test/m4-acceptance` drives the
keyed, gated, nested and strictly folded contribution analysis through the same
path; see the [M4 acceptance record](../../docs/validation/m4-acceptance-2026-09-29.md).
