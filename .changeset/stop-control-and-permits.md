---
"@microdelta/machine": minor
"@microdelta/machine-node": minor
"@microdelta/resolution": minor
"@microdelta/supervision": minor
"microdelta": minor
---

Add operator stop control, a bounded permit pool, the publication-commit rule and bounded nested waiting to supervised runs (project-private `@alpha` surfaces).

- **Stop controller.** `createStopController()` holds operator stop intent, and a run receives it as `stop`. Levels only escalate.
  - A soft stop admits no new work and refuses every retry, while admitted steps drain with no default deadline.
  - An operator deadline on a soft stop escalates it to hard; its timer never keeps the host alive on its own.
  - A hard stop interrupts admitted bodies at once, even ones that never settle. It aborts sends in flight, permit waits and waits for a time, and it forbids later commits.
- **No partial output.** A step whose send or wait was refused or aborted can no longer publish. An interrupted attempt ends `interrupted`, with a `stopped` ending, and reports a `refused` outcome with disposition `cancelled`.
- **Publication commit.** Each commit first asks Supervision whether a hard stop forbids it, in the same synchronous turn, so the commit is the linearization point. History's commit still re-reads the writer lease durably, so a drain that outlives its lease cannot publish.
- **Permits and window.** A run's `permits` (default 1) bound sends in flight; a permit guards only a real send, never waiting. Its `window` (default `permits`) bounds how many members of one members request or strict fold resolve at once. Members start and report in canonical key order.
- **Execution controls.** `currentExecution()` returns the live run's controls, attributed to the admitted step running there:
  - its stop state and abort signal;
  - `send({ label, retry?, perform, cancel? })`, which records the remote state (`cancelled`, `running` or `unknown`) of an aborted send;
  - `sleepUntil(time)`, which any stop ends at once.

  The controls fail with `run-closed` after the run closes.
- **Run report.** Observers see `stop` and `send` events, which carry identifiers, levels and states only. A run result reports its closing stop state and every aborted send's remote state.
- **Bounded nested waiting.** A nested memo still waits for the calls it started before ending its attempt, but run cancellation now bounds that wait. A never-settling child ends interrupted under a hard stop, and a body that threw while children hung reports its own error.
- **Timer capability.** Machine adds the portable `ITimerCapability`: the wall clock plus one-shot callbacks at a wall-clock time. The Node adapter adds `createNodeTimer()`, which re-arms rather than firing early and splits waits beyond Node's timer range.
