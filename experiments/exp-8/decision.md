# EXP-8 bounded mechanism decision

**Result: seven candidate mechanisms pass within the stated fixture domain.
One alternative (request-granularity soft-stop drain) is rejected by a
counterexample. Five preserved counterexamples bound the passing candidates, and
eight questions are left for the supervisor (see "Decisions for the
supervisor").** The experiment realizes the owner's settled M5 decisions of
2026-09-30 for stop, accounting, quota waits, lost responses, retry and event
privacy. It evaluates concrete mechanisms for them with a fake paid provider, a
fake clock and real separate Node processes. It does not implement an M5
runtime, a production History or Accounting schema, a concurrency proof or a
CLI, and it spends nothing.

| Mechanism | Result | Bound |
| --- | --- | --- |
| 1. Soft stop with step-granularity drain, operator deadline, hard stop and honest remote state | Pass | No forced cancellation of arbitrary JavaScript (CX-2) |
| 1a. Soft stop with request-granularity drain (alternative) | **Reject** | CX-1: paid in-flight step work is discarded |
| 2. Publication commit as the stop/observer linearization point | Pass | A hard stop before the commit forbids publication of a finished body (decision 2) |
| 3. Durable "not before T" deferral with permit and lease handoff (sleep or exit) | Pass | Resume re-runs the body; CX-3 (RUN-011 tension) |
| 4. Intent-before-call journal and usage acknowledgment keyed by (operation ID, report ID) | Pass | Unknown is pessimistic: CX-4 |
| 5. Stable operation identity, no replay of ambiguous outcomes, author safe-to-repeat | Pass | Repeat eligibility needs a declaration and a retry policy (decision 4) |
| 6. Retry correlation (operation, request attempt, step attempt, member, run) | Pass | Across three processes |
| 7. Privacy-restricted event and diagnostic schema with observer isolation | Pass | Member keys are identifiers (CX-5) |

## Bounded domain (fixed before coding)

- A fake paid provider (`test/fakes.ts`) scripted per operation name and call
  index. Every success reports 100 tokens under a stable report ID
  `usage-<name>-<index>`. Every refusal reports 1 request. Response bodies and
  error text carry planted values. Its ledger of received requests, applied
  effects, cancellations and late reports persists across processes, so
  "applied once" can be checked after a restart.
- A fake clock that moves only when advanced or slept. T0 is
  2026-01-01T00:00Z, the quota wait's retry time T is T0 + 3h, the lease TTL
  is 5 minutes and the provider latency is 1 second per request.
- The short run: `m-ok` (one `summarize`) succeeds; `m-quota` (one `assess`)
  is rate-limited until T; `m-cancel` (`fetch`, `generate`, `polish`) is
  stopped while `generate` is in flight.
- Faults: soft then hard interrupt, an operator deadline, a lost
  acknowledgment after the accounting write, a failed accounting write,
  duplicate and conflicting report delivery, interruption on either side of the
  publication commit, a lost response on a non-idempotent operation, an author
  safe-to-repeat declaration, provider idempotency keys, a throwing observer and
  a failing presenter.
- The durable state is one JSON snapshot committed whole through a port
  (`src/state.ts`, `src/store.ts`). In-process tests serialize every commit
  through `MemoryPort`. Restart tests use `FilePort` (write, then rename) in
  `test/process-entry.ts`. The JSON only forces the process boundary; it is not
  a selected schema and makes no power-loss or concurrency claim.

Portable `src/` passes `types: []` checking and the context-import Node-access
rule, now enumerated for `experiments/exp-8` in
`tooling/context-boundaries.test.mjs`. Node file and process I/O is confined to
`test/`.

## Candidates as implemented

**1. Stop (`src/control.ts`, `src/runtime.ts`).** `StopController` records
operator intent at run or member scope. Levels only escalate. A soft stop is
effective immediately: no member is admitted afterwards
(`member-not-admitted`, reason `stop-soft`), and no retry starts, whether a
resumed deferral, an in-body transient retry or an ambiguous-outcome retry.
The **drain unit is the admitted step attempt**: it keeps running and may
issue its remaining first-attempt requests, then publishes. **There is no
default deadline.** An operator deadline arms a fake-clock timer that
escalates an unfinished soft stop to hard (`stop-escalated`, reason
`deadline`). A hard stop aborts every in-flight request of the affected
members through a portable abort signal, without waiting for the provider.
It records `local-abort`, then `remote-cancel-requested` only if the adapter
declares remote cancellation, then `remote-state` as `cancelled` (provider
confirmed), `running` (provider says it continues) or `unknown` (no support, or
no answer). The request and operation records take that state, and the step
attempt becomes `interrupted`. A step attempt that met a stop, deferral or
unknown outcome is *tainted*. Whatever its body returns afterwards is
discarded (`partial-output-discarded`), so a body that swallows the signal
cannot publish partial work.

**2. Publication linearization (`Store.publish`).** One commit retains the
payload, moves the member's result pointer and completes the attempt. The
runtime checks stop intent immediately before that commit. A hard stop
effective before it forbids publication, even if the body finished. A stop
after it, a throwing observer, or a failing presenter cannot undo it, and a
later pass reuses the result without re-executing.

**3. Deferral and handoff.** A rate limit with a retry time settles the request
`not-applied`, stores the operation as `deferred` with `notBefore`, emits
`retry-scheduled`, and ends the step attempt as `deferred`. The deferred
member holds no request permit and no running attempt. Its siblings keep
running and publishing. With one permit, both siblings complete while it
waits. When only deferred work remains, the run emits `run-waiting` and
releases the store's writer lease. In **sleep** mode it then calls
`clock.sleepUntil(T)` once, re-acquires the lease with a new fence and
admits the member again. In **exit** mode it returns `waiting` with
`waitingUntil: T`. Any later pass classifies a member with a future
`notBefore` as `waiting` and never admits it. After T it admits a new step
attempt whose call reuses the deferred operation's ID (`retry-started`). A
rate limit without a retry time is not a deferral: it retries only under an
author policy. Rate-limit deferrals stop at the policy's `maxAttempts`, or at
the default of 5 (`retry-exhausted`).

**4. Accounting.** Before each paid call, one commit (`operation-intent`)
creates or reuses the operation and records the request attempt as `pending`.
A usage report is then acknowledged by an idempotent commit keyed by
(operation ID, report ID) (`usage-acknowledged`). A redelivery with equal
quantities is `duplicate` (no write); different quantities are a `conflict`
(first kept, diagnosed). Only after that is the request outcome committed
(`request-settled`). If the port reports an ambiguous commit
(`CommitUnknownError`, a lost acknowledgment), the store reloads, and the
runtime diagnoses `acknowledgment-lost` and re-acknowledges once, so the reload
decides between `acknowledged` and `duplicate`. If a write fails, no
acknowledgment is issued (`usage-not-durable`). Acquiring the lease after a
crash turns every `pending` request into `unknown` and every running attempt
into `interrupted`. `summarizeUsage` sums acknowledged reports once by unit and
lists every settled request attempt with no acknowledged report as unknown.
Unknown is never counted as zero.

**5. Operation identity and replay.** A logical operation is addressed by
(member, author operation name, canonical request binding). A call reuses the
ID of an unsettled operation at that address (`pending`, `deferred`,
`unknown`, `running`); a settled one (`succeeded`, `failed`, `cancelled`) or a
changed binding yields a new operation. A lost response settles the request
and operation as `unknown`. It is retried only when the operation is
repeat-safe and a retry policy allows another attempt. Repeat-safe means the
author declared `safeToRepeat`, or the adapter declares idempotency keys.
Attempts are counted across processes. Otherwise the step attempt ends
`unknown-outcome`, and every later pass reports the member blocked
(`member-blocked`, reason `not-repeat-safe`) without running its body.
Transient refusals (`unavailable`) retry only under an author policy with
`maxAttempts` and `backoffMs`. The backoff is a fake-clock sleep holding no
permit.

**6. Correlation.** Every request event carries the operation ID, a fresh
request attempt ID, the step attempt ID, the member key and the run ID. All
identifiers come from one durable counter, so none repeats across processes.

**7. Event schema (`src/events.ts`).** `IEvent` has `sequence`, `at`, `kind`,
`runId` and optional `member`, `stepAttemptId`, `operationId`,
`requestAttemptId`, `status`, `reason`, `level`, `quantities`, `reference`,
`notBefore` and `fence`. `kind`, `status` and `reason` are closed unions. There
is no field for a binding, argument, output, provider body or error message,
and the tsd contract rejects each. `IDiagnostic` is a closed code plus
identifiers, with no message. Events are frozen and appended before observers
run. An observer exception becomes an `observer-failed` diagnostic and changes
nothing else.

Event kinds: `lease-acquired`, `lease-released`, `recovered`,
`member-reused`, `member-waiting`, `member-blocked`, `member-not-admitted`,
`step-admitted`, `request-started`, `request-settled`, `usage-acknowledged`,
`retry-scheduled`, `retry-started`, `retry-exhausted`, `stop-requested`,
`stop-escalated`, `local-abort`, `remote-cancel-requested`, `remote-state`,
`step-settled`, `published`, `run-waiting` and `run-settled`.

## Assertion-first evidence

All assertions were written against a typed scaffold in which every mechanism
function threw `EXP-8 scaffold: ... is not implemented` (`runPass`, `Store`,
`StopController`, `Permits`, `EventLog`, `summarizeUsage`). Only the data
helpers and the fixture parser existed.

- `protocol.test.ts` against the scaffold: **40 failed, 0 passed** (40 total).
- `restart.test.ts` against the scaffold: **17 failed, 0 passed** (17 total).
  Every stage exited with status 1 from the scaffold throw, so killed stages
  showed no SIGKILL and reporting stages printed no report.
- Combined Jest run: **57 failed, 57 total**. The tsd contract compiled against
  the scaffold's declared types, as expected, since the types are the design
  under test.
- First run after implementation: **57 passed, 57 total**, with no test edits.
  Because a clean first run can hide vacuous assertions, nine mutation controls
  each broke one mechanism in the built output and reran the suite. Every
  mutation was detected (see "Mutation controls").
- Written after the implementation, and asserting the observed result: the
  RUN-011 tension counterexample (CX-3). All other counterexamples were in the
  assertion-first set. The `kill-after-intent` restart test was then
  strengthened to assert the persisted post-recovery state, after mutation M5
  showed that only the store unit test covered it.
- One implementation refinement after the first green run: an ambiguous-outcome
  retry now takes its backoff from the operation's persisted policy (the policy
  that decided eligibility) rather than the current declaration. No test
  changed.

Final: `npm run test:exp8` reports **58 passed** (41 in-process, 17 restart)
plus the tsd contract. A tsd negative control, a copy of the contract with one
deliberately wrong `expectError` on a valid event, failed at exactly that line.

## Mutation controls

Each control replaced one line of the built `.test-build/src` output, reran the
whole Jest suite and restored the file (`--testTimeout=20000`). A mutation
counts as detected when at least one test fails or the suite cannot finish.

| Mutation (mechanism broken) | Detected by |
| --- | --- |
| M1 `repeatAllowed` always true (blind replay of ambiguous outcomes) | Suite hangs: a body whose response is always lost retries forever |
| M2 publish tainted or hard-stopped output | 4 tests: the three "no partial output as success" cases and "counterexample (arbitrary JavaScript)" |
| M3 usage acknowledgment not keyed (redelivery rewrites) | 4 tests: lost acknowledgment, duplicate delivery, conflicting redelivery, cross-process duplicate delivery |
| M4 keep the writer lease while sleeping | 2 tests: in-process sleep mode and the cross-process lease probe |
| M5 recovery reads a pending intent as succeeded | Store recovery test; the `kill-after-intent` restart test now also asserts the persisted state after recovery |
| M6 request binding added to `request-started` events | 2 tests: in-process and cross-process privacy |
| M7 soft stop still admits new members | "soft stop admits no new step, and the admitted step drains to publication" |
| M8 soft stop still allows in-body retries | "soft stop refuses an in-body transient retry even under an author policy" |
| M9 intent kept in memory, not committed before the call | 7 tests: the intent-before-receipt test, store recovery and five fault-point restart tests |

## Process-stage results

Stage A starts at T0, B at T0 + 1h, and C at T + 1 min. A killed stage ended
with SIGKILL at the named point. Provider counts come from the persisted
provider ledger.

| Scenario | Stage results (hand-derived expectations, all observed) |
| --- | --- |
| `quota-exit` | A: `m-ok` published, `m-cancel` interrupted (remote `cancelled`), `m-quota` waiting until T; status `waiting`; lease released. B: `m-ok` reused (same reference), `m-cancel` re-run and published, `m-quota` only `member-waiting` (no admission, no request). C: `m-quota` published with the **same operation ID**, a new request attempt ID and a new run ID; siblings reused. Totals: 600 tokens, 1 request; the cancelled `generate` attempt is the only unknown. |
| `quota-sleep` | One `sleepUntil(T)`. During the sleep a separate probe process saw no lease holder and acquired fence 2. The run re-acquired fence 3 and retried the same operation after T. |
| `soft-then-hard` | A: stop events `soft`, `hard`; no remote-cancel request (unsupported); `generate` recorded `unknown`; attempt `interrupted`; no `m-cancel` result. B: `m-cancel` blocked as `unknown-outcome` on that operation; `m-quota` still waiting. |
| `soft-drain` | A: `m-cancel` drained through `polish` and published, `m-quota` deferral never retried; status `stopped`. B: drained result reused. |
| `kill-after-intent` | A killed after the intent commit. B: `recovered` (`unknown`, `recovered-after-crash`), usage unknown (not zero), `m-ok` blocked, provider received nothing. |
| `kill-after-send` | A killed after the provider applied the effect. B: unknown usage and outcome, provider applied once, no replay. |
| `kill-after-usage` | A killed after the usage acknowledgment. B: exactly one usage record (100 tokens); outcome unknown, `m-ok` blocked. |
| `kill-before-publication` | A killed before the publication commit. After A there is no result (old complete state). B recovers A's attempt as `interrupted` and re-executes as a distinct operation; 200 tokens over two operations. |
| `kill-after-publication` | A killed after the commit. B reuses the same reference; A's attempt stays `completed`; provider called once. |
| `observer-presenter-throw` | A exits 1 after committing (presenter), with only `observer-failed` diagnostics. B reuses the result. |
| `duplicate-delivery` | A acknowledges; B receives the late duplicate and reports `duplicate`; one usage record. |
| `lost-response-mutation` | A: `unknown-outcome`, applied once. B: `member-blocked`, still one call. |
| `safe-repeat-after-send` | A killed after the effect. B retries with the same operation ID and a new attempt and run ID; 2 effects (the author accepted them). |
| `idempotent-after-send` | As above with provider idempotency keys: 2 requests, **1 effect**. |

## Preserved counterexamples

Each test asserts the *observed* result, so a later mechanism that changes it
must update the test deliberately.

- **CX-1 (rejects 1a, request drain):** soft stop while `generate` is in flight,
  under `drainUnit: 'request'`. `generate` completes, `polish` is refused, and
  the step is interrupted. Two paid requests (200 tokens) produce no reusable
  result (`protocol.test.ts`, "counterexample (request drain)"). The owner's
  "drains in-flight work" is not met for the admitted step.
- **CX-2 (bounds 1, arbitrary JavaScript):** a body awaiting non-provider work
  keeps running after a hard stop and returns complete output. The abort
  signal cannot stop it. Only the publication check discards the output
  ("counterexample (arbitrary JavaScript)").
- **CX-3 (bounds 3, RUN-011 tension):** a body that completes `fetch` and is
  then deferred on `assess` re-runs from the start after T. `assess` keeps its
  operation ID, but `fetch` is a new, paid operation, with the provider applying
  it twice ("counterexample (RUN-011 tension)"). The restart counterexample "no
  request checkpoint" shows the same effect for the re-run of a cancelled
  member across processes.
- **CX-4 (bounds 4, pessimistic intent):** after a kill between the intent and
  the send, the provider received nothing, yet the request reads `unknown` and
  the member stays blocked in every later process ("counterexample (pessimistic
  intent)"). This is the price of intent-before-call without a provider
  status query.
- **CX-5 (bounds 7, member keys):** member keys are identifiers and appear in
  events, so an author key derived from a sensitive value is published
  ("counterexample (member keys are identifiers)").

## Decisions for the supervisor

1. **Lease release point.** With one fenced writer per store, the lease cannot
   be released at the moment of a deferral while siblings still need to
   publish. The candidate releases the deferred member's permit and attempt
   immediately. It releases the store lease when only deferred work remains,
   before sleeping or exiting. Confirm this reading of "the deferral releases
   the writer lease".
2. **Hard stop versus a finished but unpublished body.** The candidate
   forbids publication after an effective hard stop, even for a complete
   output. That gives "nothing new is published after a hard stop" and
   discards paid work that finished in the race window. The alternative
   publishes complete outputs and aborts only running bodies.
3. **RUN-011 and step-granularity resume (CX-3).** Resuming a deferred step
   re-runs its body and re-pays earlier successful operations. RUN-011 forbids
   "indiscriminately" replaying earlier successful paid work in an enclosing
   body, and RUN-015 implies no request checkpoint. The options are to accept
   the re-payment for multi-operation bodies, to reuse a completed operation's
   recorded response on resume (a request checkpoint), or to sleep in-body for
   short waits. This is a concrete conflict to settle before M5 adopts the
   mechanism.
4. **Repeat eligibility.** The candidate requires both a repeat-safety basis
   (`safeToRepeat`, or provider idempotency keys) and an author retry policy.
   It applies the no-replay rule to every operation, including reads. Confirm,
   or allow `safeToRepeat` alone to imply a default attempt limit.
5. **Resolving unknown outcomes.** Unknown outcomes block the member
   indefinitely (CX-4, `soft-then-hard` stage B). M5/M6 needs an explicit
   operator action to resolve or abandon an unknown operation. This experiment
   does not define it.
6. **Default rate-limit cap.** The owner settled "retry by default" for rate
   limits with a retry time, but not a limit. The candidate uses 5
   deferrals per operation unless the author's policy says otherwise.
7. **Member keys in events (CX-5).** Either require keys to be non-sensitive
   identifiers, or emit an opaque member identifier in events.
8. **Usage before outcome.** The candidate commits the usage acknowledgment
   before the request outcome. A kill between them leaves the usage known and
   the outcome unknown (`kill-after-usage`), which blocks the member. The
   reverse order would make the outcome known and the usage unknown. Both are
   honest; confirm the order.

No conflict was found with the owner's decisions themselves. Decision 3 is a
tension between the step-granularity mechanism and RUN-011's wording, and it
remains open. Decisions 1 and 4 are interpretations for the supervisor to
confirm.

## Exact commands and versions

```sh
npm ci
npm run clean && npm run build && npm run check && npm test   # all exit 0
npm run build:experiments && npm run test:exp8
node experiments/exp-8/.test-build/test/process-entry.js <dir> quota-exit A
node experiments/exp-8/.test-build/test/process-entry.js <dir> quota-exit B
node experiments/exp-8/.test-build/test/process-entry.js <dir> quota-exit C
```

Local evidence used Node **24.14.0**, with TypeScript **5.9.3**, Jest
**30.5.1**, tsd **0.33.0**, ESLint **10.10.0** and typescript-eslint
**8.70.0** pinned by the workspace lockfile. CI's Node 20/22/24 matrix is a
separate PR check.

## Limitations

- One process writes at a time. Fencing is checked against the in-memory
  snapshot only. There is no compare-and-swap against the file and no
  concurrent-writer proof (separate M5 work). The lease renews only on
  commits, so a single request longer than the TTL could let another process
  take over mid-request. That case is not exercised.
- The runtime handles an ambiguous commit only for usage acknowledgments.
  Elsewhere it treats one as fatal, which is not exercised.
- One step per member, and no nested or shared (converging) consumers.
  Cancelling one member does not affect a sibling, but shared-work
  cancellation authority is not modeled.
- Usage reports are deltas only. Cumulative snapshots, report ordering and
  corrections (ACC-003) are not modeled, and neither are quota pools or
  remaining-quota state (ACC-004).
- Provider behavior is scripted. Idempotency-key expiry, partial remote
  effects and billing for cancelled work are not modeled. Cancelled or aborted
  requests report no usage, so they read as unknown.
- The fake clock makes `sleepUntil` instant. Real sleeping, wake-up drift and
  OS signal handling (first and second interrupt) are CLI and runtime work.
- The JSON files force a process boundary only: whole-file rename, with no
  fsync and no power-loss claim.
