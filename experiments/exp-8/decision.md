# EXP-8 bounded mechanism decision

**Result: seven candidate mechanisms pass within the stated fixture domain;
one alternative (request-granularity soft-stop drain) is rejected.** Mechanisms
1, 3 and 5 pass only in their corrected form. The first submission (PR #111
at `d2a5bd4`) let an author's catch-and-retry replay an unresolved mutation and
send a deferred call before its time. It also ignored stop intent during a
sleep-mode wait and for a body queued for a permit, and it trusted a stale
in-memory lease. Review counterexamples CX-6 to CX-9 record those defects, and
they are fixed and tested. Five further counterexamples bound the passing
candidates. The supervisor's resolutions of the eight questions this experiment
raised, and the ruling on draining versus lease expiry, are recorded below.

The experiment realizes the owner's settled M5 decisions of 2026-09-30 for
stop, accounting, quota waits, lost responses, retry and event privacy. It
evaluates concrete mechanisms for them with a fake paid provider, a fake clock
and real separate Node processes. It does not implement an M5 runtime, a
production History or Accounting schema, a concurrency proof or a CLI, and it
spends nothing.

| Mechanism | Result | Bound |
| --- | --- | --- |
| 1. Soft stop with step-granularity drain, operator deadline, hard stop and honest remote state | Pass (corrected: stop reaches sleeps and permit waits) | No forced cancellation of arbitrary JavaScript (CX-2). A drain ends at lease expiry (ruling R) |
| 1a. Soft stop with request-granularity drain (alternative) | **Reject** | CX-1: paid in-flight step work is discarded |
| 2. Publication commit as the stop/observer linearization point | Pass | Publication also requires an unexpired, current lease |
| 3. Durable "not before T" deferral with permit and lease handoff (sleep or exit) | Pass (corrected: catch-and-retry cannot send before T) | Resume re-runs the body (CX-3, resolved by resolution 3) |
| 4. Intent-before-call journal and usage acknowledgment keyed by (operation ID, report ID) | Pass (corrected acknowledgment reporting) | Unknown is pessimistic (CX-4). A late report after lease loss is not durable |
| 5. Stable operation identity, no replay of ambiguous outcomes, author safe-to-repeat | Pass (corrected: catch-and-retry cannot replay) | Repeat needs a safety basis and a retry policy (resolution 4) |
| 6. Retry correlation (operation, request attempt, step attempt, member, run) | Pass | Across three processes |
| 7. Privacy-restricted event and diagnostic schema with observer isolation | Pass | Member keys are declared identifiers (CX-5, resolution 7). Non-identifier unit names are dropped from events |

## Bounded domain (fixed before coding)

- A fake paid provider (`test/fakes.ts`) scripted per operation name and call
  index. Every success reports 100 tokens under a report ID that is stable per
  operation (`usage-<name>-<index>` unless a script overrides it). Every refusal
  reports 1 request. Response bodies and error text carry planted values. Its
  ledger of received requests, applied effects, cancellations and late reports
  persists across processes, so "applied once" can be checked after a restart.
- A fake clock that moves only when advanced or slept. A *gated* variant keeps
  a sleep pending until the test wakes it. T0 is 2026-01-01T00:00Z, the quota
  wait's retry time T is T0 + 3h, and the provider latency is 1 second per
  request. The default lease TTL is 5 minutes; a test may configure it, as an
  operator would.
- The short run: `m-ok` (one `summarize`) succeeds; `m-quota` (one `assess`)
  is rate-limited until T; `m-cancel` (`fetch`, `generate`, `polish`) is
  stopped while `generate` is in flight.
- Faults: soft then hard interrupt; an operator deadline; a lost
  acknowledgment after the accounting write; an ambiguous commit that did not
  land; a failed accounting write; duplicate, conflicting and misattributed
  report delivery; interruption on either side of the publication commit; a
  lost response on a non-idempotent operation; an author safe-to-repeat
  declaration; provider idempotency keys; a throwing observer and a failing
  presenter; an author catch-and-retry; and lease expiry and takeover during a
  drain.
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
operator intent at run or member scope. Levels only escalate.

- **Soft stop.** It is effective immediately: no member is admitted afterwards
  (`member-not-admitted`, reason `stop-soft`), and no retry starts, whether a
  resumed deferral, an in-body transient retry or an ambiguous-outcome retry.
  - The **drain unit is the admitted step attempt**: it keeps running and may
    issue its remaining first-attempt requests, then publishes.
  - **There is no default deadline.** An operator deadline arms a fake-clock
    timer that escalates an unfinished soft stop to hard (`stop-escalated`,
    reason `deadline`).
- **Hard stop.** It aborts every in-flight request of the affected members
  through a portable abort signal, without waiting for the provider.
  - It also reaches a body **queued for a request permit**: the permit wait
    races the abort signal, and a permit granted afterwards is handed back at
    once.
  - It records `local-abort`. Then, only if the adapter declares remote
    cancellation, it records `remote-cancel-requested`. Then it records
    `remote-state` as `cancelled` (provider confirmed), `running` (provider
    says it continues) or `unknown` (no support, or no answer).
  - The request and operation records take that remote state, and the step
    attempt becomes `interrupted`.
- **Stop during a sleep-mode wait.** A run-wide stop ends the wait at once, and
  the pass reports `stopped` with its deferred work (the sleep races stop
  intent).
- **Taint.** A step attempt that met a stop, a deferral, an unknown outcome or
  lease loss is *tainted*.
  - Whatever its body returns afterwards is discarded
    (`partial-output-discarded`).
  - **Any further `operation` call by that attempt rethrows the same signal
    without sending anything**, so a body that swallows the signal can neither
    publish partial work nor keep paying.

**2. Publication linearization (`Store.publish`).** One commit retains the
payload, moves the member's result pointer and completes the attempt. The
runtime checks stop intent immediately before that commit, and the store
checks publication authority: the durable lease must still be this writer's,
with the same fence, and unexpired. A hard stop effective before the commit
forbids publication, even if the body finished (resolution 2). A stop after
it, a throwing observer or a failing presenter cannot undo it, and a later pass
reuses the result without re-executing.

**3. Deferral and handoff.**
- **Deferring.** A rate limit with a retry time settles the request
  `not-applied`, stores the operation as `deferred` with `notBefore`, emits
  `retry-scheduled`, and ends the step attempt as `deferred`.
- **What the deferred member holds.** It holds no request permit and no running
  attempt, and its siblings keep running and publishing; with one permit, both
  siblings complete while it waits.
- **Waiting.** When only deferred work remains, the run emits `run-waiting` and
  releases the store's writer lease (resolution 1).
  - **Sleep mode** sleeps once until T (a stop ends the sleep at once),
    re-acquires the lease with a new fence and admits the member again.
  - **Exit mode** returns `waiting` with `waitingUntil: T`.
- **Later passes.** Any later pass classifies a member with a future
  `notBefore` as `waiting` and never admits it. After T it admits a new step
  attempt whose call reuses the deferred operation's ID (`retry-started`).
- **Catch-and-retry protection.** A call that reuses a deferred operation
  before its time is refused without sending. The store itself refuses an
  intent that would clear a deferral before `notBefore`. A deferral is
  therefore never erased early.
- **Other rate limits.** A rate limit without a retry time is not a deferral:
  it retries only under an author policy. Rate-limit deferrals stop at the
  policy's `maxAttempts`, or at the default of 5 (`retry-exhausted`,
  resolution 6).

**4. Accounting.**
- **Intent first.** Before each paid call, one commit (`operation-intent`)
  creates or reuses the operation and records the request attempt as
  `pending`.
- **Keyed acknowledgment.** A usage report is then acknowledged by an
  idempotent commit keyed by (operation ID, report ID). Report IDs are unique
  **per operation**, not globally, so the same report ID on two operations
  counts twice.
  - A report that names an unknown operation, or a request of another
    operation, is refused (`usage-unattributable`).
  - A redelivery with equal quantities is `duplicate` (no write). Different
    quantities are a `conflict`: the first is kept and diagnosed.
- **Outcome last.** Only after the acknowledgment is the request outcome
  committed (`request-settled`), so usage precedes outcome (resolution 8).
- **Ambiguous commits.** If the port reports an ambiguous commit
  (`CommitUnknownError`), the store reloads.
  - If this attempt's own write is present, it is reported `acknowledged`, with
    its quantities.
  - Otherwise it is re-acknowledged once. A second ambiguous commit is
    reported as `usage-durability-unknown`, never as `usage-not-durable`.
- **Failed writes.** A failed write, or no authority to write, issues no
  acknowledgment (`usage-not-durable`).
- **Recovery.** Acquiring the lease after a crash turns every `pending`
  request into `unknown`, and every running attempt into `interrupted`.
- **Usage view.** `summarizeUsage(state, now)` sums acknowledged reports once
  by unit.
  - A `pending` intent counts as live only while its own run holds an
    unexpired lease at `now`. Otherwise the view reports it unknown, even
    before any writer has recovered it. The view needs no writer.
  - Unknown is never counted as zero.

**5. Operation identity and replay.**
- **Addressing.** A logical operation is addressed by (member, author
  operation name, canonical request binding).
  - A call reuses the ID of an unsettled operation at that address
    (`pending`, `deferred`, `unknown`, `running`).
  - A settled operation (`succeeded`, `failed`, `cancelled`) or a changed
    binding yields a new operation.
- **Lost responses.** A lost response settles the request and operation as
  `unknown`. It is retried only when the operation is repeat-safe **and** a
  retry policy allows another attempt, with attempts counted across processes
  (resolution 4).
  - Repeat-safe means the author declared `safeToRepeat`, or the adapter
    declares idempotency keys.
  - Otherwise the step attempt ends `unknown-outcome`. Every later pass
    reports the member blocked without running its body, with reason
    `not-repeat-safe`, or `policy-exhausted` when a repeat-safe policy has run
    out.
  - Resolving or abandoning an unknown operation is an M5 operator action
    (resolution 5).
- **Catch-and-retry protection.** A body that catches the unknown outcome and
  calls again is refused without sending, by the taint guard and, as defense
  in depth, by the reuse guard.
- **Transient refusals.** Refusals such as `unavailable` retry only under an
  author policy with `maxAttempts` and `backoffMs`. The backoff is a
  fake-clock sleep holding no permit.

**6. Correlation.** Every request event carries the operation ID, a fresh
request attempt ID, the step attempt ID, the member key and the run ID. All
identifiers come from one durable counter, so none repeats across processes.

**7. Event schema (`src/events.ts`).**
- **Fields.** `IEvent` has `sequence`, `at`, `kind`, `runId` and optional
  `member`, `stepAttemptId`, `operationId`, `requestAttemptId`, `status`,
  `reason`, `level`, `quantities`, `reference`, `notBefore` and `fence`.
  `kind`, `status` and `reason` are closed unions.
- **What is excluded.** There is no field for a binding, argument, output,
  provider body or error message, and the tsd contract rejects each.
- **Unit names.** Units in `quantities` must be lower-case identifiers
  (`^[a-z][a-z0-9_]{0,31}$`). Any other provider-supplied unit is dropped from
  the event and diagnosed (`usage-unit-dropped`); the durable record keeps it.
- **Diagnostics.** `IDiagnostic` is a closed code plus identifiers, with no
  message.
- **Observers.** Events are frozen and appended before observers run. An
  observer exception becomes an `observer-failed` diagnostic and changes
  nothing else.
- **Member keys.** They are declared identifiers, and must not embed sensitive
  data (resolution 7).

Event kinds: `lease-acquired`, `lease-released`, `recovered`,
`member-reused`, `member-waiting`, `member-blocked`, `member-not-admitted`,
`step-admitted`, `request-started`, `request-settled`, `usage-acknowledged`,
`retry-scheduled`, `retry-started`, `retry-exhausted`, `stop-requested`,
`stop-escalated`, `local-abort`, `remote-cancel-requested`, `remote-state`,
`step-settled`, `published`, `run-waiting` and `run-settled`.

## Ruling R: draining versus lease expiry

The supervisor ruled on issue #109 how the settled contracts combine:

- A soft-stop drain has no default deadline (owner decision). Publication
  authority, however, always requires an unexpired, current lease (PUB-004),
  and RUN-015 forbids timer-driven renewal.
- If the lease expires, or another writer takes it over, while a drained
  request is still in flight, that attempt cannot publish. It ends
  interrupted: usage already acknowledged is preserved, and the remote outcome
  is recorded honestly.
- The lease TTL is an operator-configurable setting and should exceed the
  longest expected request.

As implemented, every holder mutation re-reads the durable lease and requires
the same holder, the same fence and `expiresAt > now`; it never trusts the
in-memory snapshot. A late completion therefore writes nothing:
- it does not publish;
- it does not overwrite a successor's lease;
- it makes no further paid call.

The pass ends `lease-lost`. The late response's own usage report cannot be
made durable without authority (`usage-not-durable`), so its request reads
`unknown`: the successor's recovery makes that durable, and the usage view
already reports the dead intent as unknown. Both cases are tested: takeover by
a successor, and plain expiry with no successor.

## Supervisor resolutions (issue #109)

1. **Lease release point:** accepted. The writer lease is released once only
   deferred work remains; a deferred member holds no permit and no running
   attempt.
2. **Hard stop versus a finished but uncommitted body:** the output is
   discarded. No new publication occurs after an effective hard stop.
3. **Re-payment on resume (RUN-011 versus RUN-015):** the reuse unit is the
   step. Authors isolate each paid call in its own memoized or supplied child
   step, whose completed result is reused when a deferred parent resumes. A
   body with several raw paid calls re-pays them on resume (CX-3); there are
   no mid-body checkpoints (RUN-015, CMP-5).
4. **Retrying an unknown outcome:** it requires a safety basis (author
   `safeToRepeat`, or provider idempotency keys) and an author retry policy.
   The same rule applies to reads.
5. **Unknown outcomes:** M5 provides a programmatic operator action to resolve
   or abandon an unknown operation; its CLI surface is M6. That action is not
   implemented here.
6. **Default rate-limit retry cap:** 5, overridable per author policy.
7. **Member keys in events:** keys are declared identifiers; designated keys
   must not embed sensitive data (CX-5).
8. **Write order:** accepted. Usage is written before the outcome.

## Assertion-first evidence

**First round (the original submission).**
- Every mechanism function in a typed scaffold threw `EXP-8 scaffold: ... is
  not implemented` (`runPass`, `Store`, `StopController`, `Permits`,
  `EventLog`, `summarizeUsage`). Only the data helpers and the fixture parser
  existed.
- `protocol.test.ts` failed **40 of 40** and `restart.test.ts` failed
  **17 of 17**. Every stage exited with status 1 from the scaffold throw.
- The first run after implementation passed **57 of 57**, with no test edits.
- The RUN-011 counterexample (CX-3) was then added, asserting the observed
  result, for 58.

**Review round.**
- **Declarations first, no behavior change.** New diagnostic codes
  (`usage-durability-unknown`, `usage-unattributable`, `usage-unit-dropped`),
  a `lease-lost` reason and status, and the `now` parameter of
  `summarizeUsage`.
- **Then assertions against the unfixed implementation.** The new
  `review.test.ts` has 15 tests. Changed tests: the lost-acknowledgment
  expectation, the `kill-after-intent` usage view, and a stderr scan in the
  cross-process privacy test.
- **Result: 15 failed, 58 passed (73 total).** The failures were every
  catch-and-retry, stop-reachability, acknowledgment-reporting, attribution,
  unit-name, blocked-reason, dead-intent and lease-expiry assertion.
- **Tests that passed before the fixes, by design.** "An ambiguous commit that
  did not land is written by the re-acknowledgment", and "the same report ID on
  different operations is counted for each operation". The second is a
  coverage test that mutation R1 must fail. The stderr scan also passed.
- **After the fixes, 71 of 73 passed.** The two failures were existing tests
  that advance fake time past the 5-minute default TTL while a request drains:
  "soft stop has no default deadline" advances 30 days, and "an operator
  deadline escalates" uses a 10-minute deadline. Under ruling R they now lose
  authority, so each configures an operator TTL longer than its request (60
  days and 1 hour). Their assertions are unchanged.
- **Final: 73 of 73.**
- **tsd.** A negative control, a copy of the contract with one deliberately
  wrong `expectError` on a valid event, failed at exactly that line.

Final: `npm run test:exp8` reports **73 passed** (41 in `protocol.test.ts`,
15 in `review.test.ts`, 17 in `restart.test.ts`), plus the tsd contract.

## Mutation controls

Each control replaces lines of the built `.test-build/src` output, reruns the
whole Jest suite (`--testTimeout=20000`) and restores the files
(`scratch/exp8-mutations.py`). A mutation is detected when at least one test
fails.

| Mutation (mechanism broken) | Detected by (73 tests) |
| --- | --- |
| M1 `repeatAllowed` always true (blind replay of ambiguous outcomes) | The restart suite fails **6 assertions**, including no replay of a lost mutation across processes, the blocked member after a hard stop, and every intent and send fault point. The in-process suites cannot finish, because blind replay against an instant fake clock is an unbounded microtask loop |
| M2 publish tainted or hard-stopped output | 6: the three "no partial output as success" cases, the arbitrary-JavaScript counterexample and both catch-and-retry tests |
| M3 usage acknowledgment not keyed (redelivery rewrites) | 3: duplicate delivery, conflicting redelivery, cross-process duplicate delivery |
| M4 keep the writer lease while sleeping | 3: sleep mode in process, stop during the wait, and the cross-process lease probe |
| M5 recovery reads a pending intent as succeeded | 2: store recovery and the `kill-after-intent` restart test |
| M6 request binding added to `request-started` events | 2: in-process and cross-process privacy |
| M7 soft stop still admits new members | "soft stop admits no new step, and the admitted step drains to publication" |
| M8 soft stop still allows in-body retries | "soft stop refuses an in-body transient retry even under an author policy" |
| M9 intent kept in memory, not committed before the call | 10: the intent-before-receipt test, store recovery, the usage-durability test and the fault-point restart tests |
| I1 (item 1) remove the taint guard **and** the replay reuse guard | 2: "a body that retries a lost non-idempotent call by hand sends it once", "a tainted attempt sends no further paid call" |
| I1a remove only the taint guard | 1: "a tainted attempt sends no further paid call of any operation" |
| I1b remove only the replay reuse guard | **Not detected**: this is defense in depth behind the taint guard, and no public path reaches it untainted |
| I2 (item 2) remove the taint guard, the runtime deferral reuse guard and the store deferral guard | 3: "... retries a rate-limited call by hand sends nothing before T ...", the tainted-attempt test, and the store refusal test |
| I2a remove only the store deferral guard | 1: "the store refuses an intent that would clear a deferral before its time" |
| I2b remove only the runtime deferral reuse guard | **Not detected**: this is defense in depth behind the taint guard and the store guard |
| I3 (item 3) sleep ignores stop | "a stop during a sleep-mode wait ends the pass without waiting for T" |
| I4 (item 4) permit wait ignores a hard stop | "a hard stop reaches a body queued for a request permit" |
| I5 (item 5) a reloaded own write reported as `duplicate` | "a lost acknowledgment after the usage write retains the usage exactly once" |
| I5b (item 5) a second ambiguous commit reported as not durable | "a second ambiguous usage commit is reported as unknown durability" |
| R1 (item 6) usage keyed by report ID alone | "the same report ID on different operations is counted for each operation" |
| I7 (item 7) holder check trusts the in-memory lease and ignores expiry | 2: both drain-versus-lease-expiry cases |

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
| `kill-after-intent` | A killed after the intent commit. The crashed store's usage view already reports the dead intent unknown. B: `recovered` (`unknown`, `recovered-after-crash`), persisted request and operation `unknown`, attempt `interrupted`; usage unknown (not zero); `m-ok` blocked; provider received nothing. |
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

Tests CX-1 to CX-5 assert the *observed* result of a bound, so a later mechanism
that changes it must update the test deliberately. CX-6 to CX-9 are defects of
the first submission; their tests now assert the corrected behavior.

- **CX-1 (rejects 1a, request drain):** soft stop while `generate` is in flight,
  under `drainUnit: 'request'`. `generate` completes, `polish` is refused, and
  the step is interrupted. Two paid requests (200 tokens) produce no reusable
  result. The owner's "drains in-flight work" is not met for the admitted
  step.
- **CX-2 (bounds 1, arbitrary JavaScript):** a body awaiting non-provider work
  keeps running after a hard stop and returns complete output. Only the
  publication check discards it.
- **CX-3 (bounds 3, re-payment on resume):** a body that completes `fetch` and
  is then deferred on `assess` re-runs from the start after T. `assess` keeps
  its operation ID, but `fetch` is a new, paid operation. The restart
  counterexample "no request checkpoint" shows the same for a re-run cancelled
  member. Resolution 3 settles this: authors isolate paid calls in child steps.
- **CX-4 (bounds 4, pessimistic intent):** after a kill between intent and
  send, the provider received nothing, yet the request reads `unknown` and the
  member stays blocked. This is the price of intent-before-call without a
  provider status query; resolution 5 supplies the operator action.
- **CX-5 (bounds 7, member keys):** member keys appear in events, so a key
  derived from a sensitive value is published. Resolution 7 forbids such keys.
- **CX-6 (defect, fixed):** a body wrapping a lost, non-repeat-safe call in
  `for (i < 3) try { ... } catch {}` re-sent it through the reused `unknown`
  operation. Now there is 1 call and 1 applied effect
  (`review.test.ts`, "a body that retries a lost non-idempotent call by hand
  sends it once").
- **CX-7 (defect, fixed):** a body catching a rate limit and calling again
  cleared the durable `notBefore` and sent before T. Now there are 0 sends
  before T and the deferral is intact, and a tainted attempt sends no call of
  any other operation.
- **CX-8 (defect, fixed):** a stop during a sleep-mode wait, and a hard stop on
  a body queued for a permit, took effect only when the sleep or the permit
  ended.
- **CX-9 (defect, fixed):** the holder check used the in-memory lease, so a
  drain outliving the TTL could publish and overwrite a successor's lease.

## Exact commands and versions

```sh
npm ci
npm run clean && npm run build && npm run check && npm test   # all exit 0
npm run build:experiments && npm run test:exp8
python3 scratch/exp8-mutations.py   # mutation controls; the script lives in the ignored scratch/ directory
node experiments/exp-8/.test-build/test/process-entry.js <dir> quota-exit A
node experiments/exp-8/.test-build/test/process-entry.js <dir> quota-exit B
node experiments/exp-8/.test-build/test/process-entry.js <dir> quota-exit C
```

Local evidence used Node **24.14.0**, with TypeScript **5.9.3**, Jest
**30.5.1**, tsd **0.33.0**, ESLint **10.10.0** and typescript-eslint
**8.70.0** pinned by the workspace lockfile. CI's Node 20/22/24 matrix is a
separate PR check.

## Limitations

- **One writer at a time.** Every holder mutation re-reads the durable lease
  and checks the holder, the fence and expiry, but the read and the write are
  not one atomic compare-and-swap on the file. There is no concurrent-writer
  proof (separate M5 work).
- **Late usage after lease loss** cannot be made durable by the old writer, so
  it reads unknown. A separate accounting journal that accepts reports
  without the writer lease is not evaluated.
- **Ambiguous commits** are handled only for usage acknowledgments. Elsewhere
  one is treated as fatal, which is not exercised.
- **Structure.** One step per member, and no nested or shared (converging)
  consumers. Child-step isolation of paid calls (resolution 3) is not
  exercised here; EXP-4 covers nested child reuse.
- **Usage reports** are deltas only. Cumulative snapshots, report ordering and
  corrections (ACC-003) are not modeled, and neither are quota pools or
  remaining-quota state (ACC-004).
- **Provider behavior is scripted.** Idempotency-key expiry, partial remote
  effects and billing for cancelled work are not modeled. Cancelled or aborted
  requests report no usage, so they read as unknown.
- **Time and signals.** The fake clock makes an ungated sleep instant. Real
  sleeping, wake-up drift and OS signal handling (first and second interrupt)
  are CLI and runtime work.
- **Skip-send on abort.** The runtime does not send when the member's signal
  is already aborted. Through the public path this is defensive only, because
  the stop check runs in the same synchronous turn just before the send.
- **The JSON files** force a process boundary only: whole-file rename, with no
  fsync and no power-loss claim.
