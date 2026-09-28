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
is a structurally injected capability (`{ createAsyncContext<T>() }`), which
assembly supplies. It never decides reuse, touches History or threads a
context argument through author helpers.

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
  started through it (`resolve`, `check`, `recover`, `ordinary`) have settled,
  including operations started while it waits and ones the body stopped
  awaiting early (a `Promise.all` whose sibling failed). The body's own value
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
  presents after reuse had its chance; the default admits everything.
- **Observers.** Observers are captured at start and see frozen events at the
  fixed positions `stepLifecycle` and `ordinaryLifecycle`. They cannot veto or
  replace work. A throw before work stops only that call; a throw after a
  commit or after ordinary work finished becomes a diagnostic.
- **Ordinary work.** `ordinary(label, work)` runs nonmemoized work in the run
  scope, observed at `begin`/`end`/`fail`. It has no completed-result identity
  and no hidden memoization.

Retry, cancellation, scheduling and fanout breadth remain later work.

## Tests

Owner tests (`test/`) use Node's real AsyncLocalStorage through the
structural capability and a recording Resolution port double; `test-d/`
holds the type contracts. The same behaviors run over the real owner
implementations in the facade's assembly suites (`packages/core/test/workspace`).
