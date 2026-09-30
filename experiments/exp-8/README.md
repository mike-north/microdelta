# EXP-8 cancellation, quota waits, idempotency and durable usage accounting

This is the bounded issue #109 experiment for
[EXP-8](../../docs/spec/experiments.md). It is not a production runtime,
package or durable History or Accounting schema. The [decision record](decision.md)
gives the per-mechanism results, preserved counterexamples, limits and the
questions left to the supervisor.

The portable candidate lives in `src/`:

- `control.ts`: injected clock, portable abort signal, operator stop intent and the request-permit pool;
- `events.ts`: the privacy-restricted event schema, diagnostics and observer isolation;
- `provider.ts`: the paid-provider adapter port;
- `state.ts`: the durable fixture snapshot, its strict parser and the usage view;
- `store.ts`: the fenced writer lease, operation journal, keyed usage acknowledgment and publication commit;
- `runtime.ts`: one supervised pass (admission, drain, deferral, retry, abort, publication).

Only `test/` uses Node file and child-process APIs. `test/fakes.ts` holds the
fake clock, the scripted fake provider, an in-memory durable port with fault
injection, and the bounded run's three members. `test/process-entry.ts` runs
one stage of a scenario as a separate OS process over a JSON store file and a
JSON provider ledger; kill points send SIGKILL to that process at a named
commit boundary. `test-d/` checks the event schema's type contract.

```sh
npm run build:experiments
npm run check:experiments
npm run check:imports
npm run test:exp8
```

To reproduce the long quota wait by hand after the build (run from the
repository root; the directory must not exist yet):

```sh
mkdir -p scratch/exp8-manual
node experiments/exp-8/.test-build/test/process-entry.js scratch/exp8-manual quota-exit A
node experiments/exp-8/.test-build/test/process-entry.js scratch/exp8-manual quota-exit B
node experiments/exp-8/.test-build/test/process-entry.js scratch/exp8-manual quota-exit C
```

Stage A (fake time T0) publishes `m-ok`, cancels `m-cancel` mid-flight and exits
reporting `waiting` until T0 + 3h for `m-quota`. Stage B (T0 + 1h) reuses
`m-ok`, re-runs `m-cancel` and admits nothing for `m-quota`. Stage C (after T)
retries `m-quota` with the same operation ID. Scenario names are the keys of
`scenarios` in `test/process-entry.ts`.
