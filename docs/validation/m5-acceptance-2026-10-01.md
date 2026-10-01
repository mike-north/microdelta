# M5 independent-process acceptance (issue #122)

Implementation base: `30b5bdd` (`origin/main` on 2026-10-01, after #142),
later merged with `origin/main` at `18af318`, which brings #143 (#135, the
control anchor drift guard) and #148 (#147, the fixes for the defects this
suite found).
Every M5 implementation issue is merged there: #110, #113, #115, #116, #117,
#118, #119, #120, #121 and the follow-ups #131, #136 and #139. Local runs used
Node v24.14.0 on macOS (arm64) with SQLite through better-sqlite3 12.9.0 via
Machine's Node adapter. Node 20, 22 and 24 run in the repository CI matrix.
Dates are UTC. This record supports the supervisor's final M5 decision
([#123](https://github.com/mike-north/microdelta/issues/123)). It does not
declare M5 accepted. Results that depend on the merge commit are marked "to
be filled at acceptance".

## What was proved, and how

`packages/core/test/m5-acceptance` is an end-to-end suite over the actual
workspace alpha path, the production SQLite History backend and Resource
Accounting's durable SQLite adapter. It follows the M4 harness
(`packages/core/test/m4-acceptance`):

- **Independent processes.** Each step spawns `node worker.js <job>`. The
  worker imports the *built* `microdelta` package and composes the analysis
  afresh, so declarations, callbacks, helpers and inputs are newly allocated.
  It opens the workspace over the scenario's History file and injects
  Accounting's durable adapter, opened over its own file, as the caller's
  Accounting port (the facade never imports Accounting). It performs one
  caller command through the facade's entry operations: `resolveMembers`,
  `resolveFold`, `resolveOutcomeFold`, `check`, `resolve`, operator
  `settleOperation`, `promote` and `inspectOperations`. Nothing survives
  between steps except the two store files, the world file and the provider
  directory. There is no shared closure, test-only cache or in-memory reset.
- **The composition** (`analysis.ts`), through the facade's `authoring()`: a
  keyed discovery source `prs` over three pull requests; a template `pr` whose
  one member memo, `assess`, makes exactly one paid-like external operation
  through `currentExecution().operation` (each paid call isolated in its own
  step, EXP-8 resolution 3); a member memo `isolated` whose paid call is its
  memoized child `paid`; a strict fold `report` over the scores; and an
  outcome fold `tally` over the settled statuses. The operation's binding is a
  SHA-256 digest of the request (key, merged flag, title). Its safety
  declarations, retry policy and provider-cancellation support come from the
  world's per-PR declaration, as an adapter's configuration would.
- **The paid-like provider** (`provider.ts`) never costs anything. It scores a
  merged PR 2 and an unmerged PR 1 and reports 100 `tokens` per answer and 1
  `requests` per refusal. A per-PR script, positioned by the ledger so it
  spans processes, makes it rate-limit with a retry time, refuse permanently
  or transiently, lose a response (after or before applying), stall, or hold
  a request at a gate file the parent opens. It deduplicates by idempotency
  key. Its ledger records every request received, applied and aborted, with
  operation, request attempt, idempotency key, clock time and process.
- **Faults only at the caller's boundaries.** The facade and the owners run
  unmodified. Faults are a SIGKILL from the provider (before the send, after
  the provider applied the effect) or from the caller's Accounting port
  (after the usage acknowledgment); an Accounting acknowledgment that fails,
  either after its commit landed (marked `durability: 'unknown'`) or before
  recording anything; an observer that throws; a presenter that fails;
  operator stop requests made through the run's stop controller when a named
  observation happens (a provider receipt, a member body starting, the run
  starting to sleep); and the host wall clock, which a job may set forward to
  stand in for hours passing between processes. The facade reads that clock
  unmodified through the Node Machine's clock and timer.
- **Evidence.** The worker prints every run event exactly as observers
  receive it, a trace line per author body (with the body's run context),
  members' typed outcomes, folds, operator views, usage summaries,
  diagnostics, stop state, interruptions and `waitingUntil`. It never prints a
  body value. The parent inspects durable state directly: History through a
  raw read-only query of every table in its catalog (each row as JSON, the
  writer row without its clock high-water, which the writer-lease model lets
  any writer transaction raise), with the fenced rows also read in a compact
  form that names the fence each was written under; and Accounting's summary
  through its own adapter. Every expected
  status, score, time, count, fence and usage total is written by hand in the
  tests from the owner decisions and contracts. None is captured from output.

## Exit criteria and named tests

The suite has ten files. Each planned evidence name is a `describe` block;
test names are abbreviated below.

| Exit criterion | Evidence (tests) |
| --- | --- |
| A-09 publication and fencing: kill every commit boundary; stale publish, renew and release | `writer-wait-and-takeover` (kill, then fenced takeover only at expiry); `stale-holder-interleavings` (9 cases: late publish, renew and release against no successor, a holding successor and a finished one; plus one run's two tenures under one holder name); `drain-outlives-lease`; `publication-commit-race` (paid step killed after its answer and before publication, with the call inline and isolated in a child, and after publication); commit-boundary kills of History's own commit cited from `acceptance/stop-publication.test.ts` and the M3 kill matrix; History-port matrix cited from the [concurrency record](m5-concurrency-2026-09-30.md) |
| A-10 reference integrity across processes and scoped stores | `trial-production-isolation` (exact trial references reused by production after promotion; production's own references otherwise); `publication-commit-race` (exact committed references reused); `stale-holder-interleavings` (no row of any History table changes under a stale action) |
| A-11, M5 portion: outcome fold settled statuses with coverage, never complete while unsettled, reconsiders after repair | `outcome-fold-coverage` (failed, pending and succeeded members; repair). The open-discovery leg across processes is cited from `outcome-fold/restart.test.ts` (`A-11 across processes`: waits while discovery is open or a member unsettled) |
| A-12 retry and idempotency: rate wait, exhaustion, lost response to a mutation | `durable-quota-deferral` (rate wait in sleep and exit modes, retry under the same identity, transient backoff, exhaustion of the rate-limit cap and of the author's attempts); `no-blind-replay` (lost response, catch-and-retry, safe to repeat, idempotency keys); `operator-resolves-unknown` |
| A-13 cancellation: soft then hard stop, provider unsupported, commit race | `soft-then-hard-stop` (drain, refused retries, hard stop of a send, a permit wait and a sleep; remote state `unknown`, `running` and `cancelled`); `publication-commit-race`, plus the cited soft-stop commit kills |
| A-14 accounting: duplicate or lost acknowledgment, crash, unreported usage | `usage-exactly-once` |
| A-19 admission and middleware, M5 fault cases: misses refused before claims, throwing observer, committed success preserved | `publication-commit-race` (throwing observer at the commit, failing presenter); `durable-quota-deferral` (deferred work refused before any claim); `soft-then-hard-stop` (queued members cancelled before any claim); M3's budget refusal, cached hit and check-only miss cited from `acceptance/admission-observers.test.ts` |
| A-18 lifecycle isolation | `lifecycle-isolation` |
| Deterministic interleavings and fresh processes: stale workers cannot publish, renew or release for another holder | `stale-holder-interleavings`, `drain-outlives-lease`, `writer-wait-and-takeover` |
| Known usage survives faults once; unknown work is never reported free | `usage-exactly-once`; usage assertions in `no-blind-replay`, `operator-resolves-unknown`, `soft-then-hard-stop`, `stale-holder-interleavings`, `drain-outlives-lease` and `lifecycle-isolation` |
| Presentation failure never re-executes committed success | `publication-commit-race` |
| RUN-013 private events | `event-privacy`, including no author error text in framework failure messages from a member body, a fold body or a source check (the regression test for defect 3, fixed by #148) |
| RUN-016/017 environments with recorded promotion | `trial-production-isolation`, `lifecycle-isolation` (two environments in one process) |

## Planned evidence names

| Planned case | File | What it asserts, by hand |
| --- | --- | --- |
| `writer-wait-and-takeover` | `writer.test.ts` | While a holder's request is in flight, a second process with a 300 ms operator deadline exits with `WriterBusyError` (`writer-busy`) naming the holder's recorded identity and expiry, and every fenced row, the writer row included, is unchanged. A third process with no deadline neither fails nor writes for a second, exits only after the holder, takes the lease under fence + 1, reuses every result and sends nothing. After a SIGKILL, the grant itself (read the moment the stored holder changes) has fence + 1 and an expiry no earlier than the dead holder's expiry plus the lease, and the successor's tenure is unchanged until its next request; it records the in-flight operation `recovered-after-crash` and never resends it. The busy waiter's process is bounded at 10 s |
| `stale-holder-interleavings` | `writer.test.ts` | Nine enumerated cases. A late completion changes no History row (writer row included), reports `request-settled:unknown:lease-lost`, leaves its step pending (`refused:denied`), and its spent usage is still recorded once (totals by hand per successor position). A late next request cannot renew: with a holding successor it waits and changes nothing, then takes a fresh lease; otherwise it takes one at once; every row it writes carries only the fresh fence (stale + 1, or successor + 1). A late release leaves every row unchanged, including a holding successor's lease. A holding successor then finishes writing only under its own fence. One run, two tenures: a request still holding the run's expired lease waits while the run's next request takes the lease again under the *same* holder name with fence + 1 and publishes; the first request's late completion is refused (`refused:denied`, `lease-lost`), publishes nothing, and every History table except the run's own release of its current lease is unchanged. Only the fence distinguishes the two tenures |
| `soft-then-hard-stop` | `stop.test.ts` | Soft stop at pr-1's receipt: the drain has no default deadline; pr-1 publishes; pr-2 and pr-3 are cancelled with no send, body or attempt. Retries after a soft stop are refused, both a backoff deferral's and an immediate safety-basis retry's: one request each, nothing published. Soft then hard: the send is aborted, remote state `unknown`, no assessment published, usage unknown, and a later process reads the state from the journal. Hard stop with one permit: the member waiting for it started its body but never sends; the member waiting for a lane never starts. Hard stop during a sleep: the run returns waiting until T, the member stays pending, and the process exits long before T. Provider cancellation absent, `running` or `cancelled`: remote state recorded as `unknown`, `running` or `cancelled`; the first two leave the operation unknown and blocked, the last settles it so a later process sends a new operation |
| `publication-commit-race` | `publication.test.ts`; cited `acceptance/stop-publication.test.ts` | An observer throwing at pr-1's `publish` and a presenter failing afterwards fail the process, but all three assessments are committed; the next process reuses each exact reference, runs no assessment body, sends nothing and reports usage unchanged (300 tokens). Killed after pr-1's paid answer but before its step publishes (outcome and 100 tokens committed): the resumed step re-executes and pays again under a new operation (EXP-8 CX-3); pr-1 has two succeeded operations, one acknowledged report each; usage complete, 400 tokens, 4 operations, 4 reports, nothing unknown. The same kill with the paid call in the memoized child `paid`: the child published, the resumed parent reuses it, no second send; usage 300 tokens, 3 operations. Killed after the step published: the next process reuses the exact reference; the provider was called once. The cited M3-harness cases kill a soft-stop drain immediately before and after History's publication commit, and hard-stop it before the commit, through the same facade path |
| `durable-quota-deferral` | `deferral.test.ts` | Exit mode, pr-2 rate-limited 3 h: `waitingUntil` T = receipt + 3 h; pr-1 and pr-3 finish and pr-3 is sent after the refusal; pr-2 pending on a deferral with T; report waiting. Before T: no claim, body or send for pr-2; same T. A process whose host clock reads 3 h 1 min later retries pr-2 under the same operation with a new request attempt, at or after T; the report succeeds (2, 1, 2); usage 300 tokens and 1 request, 4 reports. Sleep mode, 1.5 s: the stored writer row names no holder while the run sleeps; pr-3 is sent before T with one permit and one lane; pr-2 is retried under the same identity at or after T in the same process. A transient failure's 1 s backoff is a timed wait inside the body: with one permit and one lane, pr-2 and pr-3 are sent during it, and the retry keeps the operation identity. Exhaustion: pr-2 rate-limited six times (200 ms each) is sent once and retried five times under one operation, then fails as `policy-exhausted`; pr-1 refused transiently under `maxAttempts: 2` is sent twice, then fails the same way; pr-3 succeeds; usage 8 requests and 100 tokens |
| `usage-exactly-once` | `usage.test.ts` | SIGKILL before the send, after the provider applied the effect, and after the usage acknowledgment: by hand, the usage another process reads straight from Accounting, then after the next process (which records the operation unknown and never resends it), then after a third (no change). A lost acknowledgment whose commit landed is counted once and the outcome stands; one that recorded nothing leaves that attempt unknown, never zero. A report redelivered after a crash (idempotency key, the provider answers from its first application) is counted once and reported as a `conflict`; the retry that only redelivered it has unknown usage of its own. The same report identity on two operations is two reports |
| `no-blind-replay` | `replay.test.ts` | A lost response with an attempt policy but no safety basis is sent once; the author's catch-and-retry sends nothing; the member stays pending (`not-repeat-safe`) and two later processes deny it without a body or send. A different fallback operation the author makes instead is never minted or sent: the step attempt is tainted. Safe to repeat: retried under the same operation, a new request attempt, two effects accepted. Provider idempotency: both sends carry the operation identity as key; the provider applies once |
| `operator-resolves-unknown` | `replay.test.ts` | Resolving as failed is recorded with action, outcome, operator and time; the next process sends a new operation and the member succeeds. Resolving as succeeded with the operator's usage acknowledges it once (`operator:invoice-7`, usage now complete); later processes fail the member with `operation-resolved` and send nothing; abandoning keeps the earlier resolution for the audit trail and frees the address. Abandoning leaves the usage unknown |
| `drain-outlives-lease` | `writer.test.ts` | A soft-stop drain outlives its lease while a successor holds it (fence + 1). The late completion changes no History row and leaves the successor's lease exactly as it was; it reports `lease-lost`; its usage is still recorded; the successor finishes writing only under its own fence. Ruling R's typed ending, the regression test for defect 4 (fixed by #148): the drained run completes; pr-1 is `request-settled:unknown:lease-lost` and pending on an `unrecorded` unknown outcome, pr-2 (whose reuse needed an acceptance the stale lease cannot record) is pending `lease-lost`, pr-3 is cancelled by the soft stop; no History row is written under the stale lease |
| `trial-production-isolation` | `environments.test.ts` | A trial run pays for three assessments. A production check finds nothing reusable and writes nothing. A promotion recorded under the writer lease names the five results the trial report rests on; afterwards production reuses every one with its exact trial reference, runs no body, sends nothing, and its usage is empty while the trial's is its own. Without a promotion, production executes and pays for its own work under its own operations, and the trial still reuses exactly its own results |
| `outcome-fold-coverage` | `outcome-fold.test.ts` | pr-1 succeeds, pr-2's response is lost (pending), pr-3 is refused (failed). The strict report fails (`failed [pr-3]`, `pending [pr-2]`) without a body. The outcome fold waits with coverage `succeeded [pr-1]`, `failed [pr-3]`, `pending [pr-2]`, `complete: false`, without a body or publication. After the operator abandons pr-2's operation it folds `succeeded [pr-1, pr-2]`, `failed [pr-3]`, `complete: true`. Repairing pr-3 publishes a new fold result while pr-1 and pr-2 are reused unexecuted; an unchanged run reuses it |
| `lifecycle-isolation` | `lifecycle.test.ts` | One process runs two workspaces over two stores in `env:alpha` and `env:beta` concurrently. Every body sees its own run and environment before and after its awaits; every event names its own run. Hard-stopping beta never reaches alpha, which publishes. After a nested frame throws, alpha's context and attribution are its own (outside any step). After alpha closes, an escaped continuation's `currentRun`, `currentExecution`, `resolve` and exact `read` each fail with `run-closed` and send nothing. Each store holds only its own environment's results and usage |
| `event-privacy` | `privacy.test.ts` | A workload over five PRs reaches success, a lost response, a permanent refusal, a sleeping rate limit, a hard-stopped stall, a process killed after the provider applied an effect and its recovery, an acknowledgment that recorded nothing, an observer throwing after a commit, operator settlement and both folds. No process's stdout or stderr (every event, diagnostic, typed outcome, operator view and usage summary) contains the provider's planted value, the planted titles, the answer text or any binding digest. A second test plants author failures whose messages carry the planted titles at a member body, a fold body and a source check. It first proves each fired as its kind (pr-1 `failed` with `execution-failure`; the fold body and the source check each fail the run with a `ResolutionError` coded `execution-failure` naming that step), then that no output repeats them (the regression test for defect 3, fixed by #148) |

## Outcome rows of the plan

| Plan row | Test |
| --- | --- |
| Two processes contend; the holder is killed; a waiter takes over | `writer-wait-and-takeover` (both tests) |
| Deterministic interleavings of two workers across processes | `stale-holder-interleavings`; the History-port matrix of #110 (cited) |
| Soft stop with one in-flight step and one queued member | `soft-then-hard-stop` (drain; refused retries) |
| Hard stop during a send, a permit wait and a deferral sleep | `soft-then-hard-stop` (escalation; permit wait; sleep; provider cancellation) |
| Kill just before and just after the publication commit | `publication-commit-race` (paid step: after its answer, inline and isolated; after its publication); cited `acceptance/stop-publication.test.ts` (History's own commit boundary, A-09 and A-13 cases) |
| Throwing observer and failing presenter | `publication-commit-race` (paid); cited `acceptance/stop-publication.test.ts` (A-19 case) |
| Quota response with a retry time 3 h ahead | `durable-quota-deferral` (exit-mode and sleep-mode tests; the backoff and exhaustion tests cover the rest of the retry policy) |
| Lost acknowledgment, duplicate report, kill between intent and usage | `usage-exactly-once` |
| Lost response on a non-idempotent call; the author body catches and retries | `no-blind-replay` (first test) |
| Safe-to-repeat operation, or provider idempotency keys | `no-blind-replay` (second and third tests) |
| Drain outlives the lease TTL and a successor takes over | `drain-outlives-lease`; `stale-holder-interleavings` (late publish) |
| Trial run then production run | `trial-production-isolation` |
| One failed, one pending, one successful member; outcome fold | `outcome-fold-coverage` |
| Concurrent runs in one process; a thrown nested frame; a detached callback after close | `lifecycle-isolation` |
| Planted payload values | `event-privacy` |

## Model, code and tests: the writer lease (#110)

The [concurrency record](m5-concurrency-2026-09-30.md) and its
[writer-wait addendum](m5-concurrency-2026-09-30.md#addendum-lease-wait-operator-deadline-and-writer-busy-2026-09-30)
are the model evidence; this suite adds the assembled path on top of them.

- **Models.** `experiments/exp-7/Publication.tla` was rechecked against
  production History, and the new `WriterLease.tla` models the owner-decided
  protocol: grants take an absent or expired lease with the next fence, every
  lease-guarded mutation passes one holder guard, inspection needs no lease,
  and waiting (`Held`, `Busy`) changes no authority. TLC exhausted every good
  configuration (two and three processes) with no violation, and every
  known-bad configuration (three for `Publication.tla`, eleven for
  `WriterLease.tla` after the addendum) stopped at a counterexample.
- **Code to model.** The record maps each production transition (acquire,
  held, reacquire after expiry, renew, release, allocate, stage, publish,
  abandon, accept, recover, inspection, clock high-water, process death) and
  each invariant to its History code and model action, all classified
  aligned. The addendum adds the lease wait, the operator deadline, typed
  writer-busy (including `SQLITE_BUSY` exhaustion), nested-run refusal and
  renew/release leaving the fence unchanged.
- **Tests at History's port.** 103 enumerated stale-holder cases in separate
  processes (four takeover kinds × seven operations × three successor
  positions; seven expiry-branch cases; the successor's own staged attempt),
  nine targeted scenarios, barrier-aligned contention, and the waiting cases
  L1–L8 and C3. Nineteen code controls were each rejected by named tests.
- **This suite at the facade.** The model's statements as an operator sees
  them through `openWorkspace`:

| Model statement | Facade evidence here |
| --- | --- |
| `TakeoverOnlyAfterExpiry`, `GrantIssuesFreshFence` | `writer-wait-and-takeover` (kill): granted at or after the dead holder's expiry, fence + 1; `stale-holder-interleavings`: every successor and every late renewal writes under a fence one above the last |
| `WaiterPreservesAuthorityState` (`Held`, `Busy`) | `writer-wait-and-takeover`: every fenced row, writer row included, identical across a busy waiter and a second of waiting; `stale-holder-interleavings` (late renew, holding) |
| `BusyNamesUnexpiredHolder` | `writer-wait-and-takeover`: writer-busy names the recorded holder and its expiry |
| `AcceptedFromLatestGrant`, `EndedAuthorityNeverActs`, `RejectedPreservesAuthorityState` | `stale-holder-interleavings` (late publish and release, all successor positions), `drain-outlives-lease`: no History row changes. `AcceptedFromLatestGrant` with the same holder name: one run's two tenures, where only the fence refuses the first tenure's late publish |
| `FenceNeverRegresses` | `stale-holder-interleavings` (late release leaves `last_fence`; late renew raises it by one) |
| Ruling R: a drain bounded by lease authority | `drain-outlives-lease`; `stale-holder-interleavings` (late publish reports `lease-lost` and stays pending) |

Facade holder identities are unique per run (`microdelta-run:<run id>`), but
not per tenure: a run that loses its lease and takes it again keeps its holder
name with the next fence. So a holder guard that ignored the fence would let
that run's own stale request act, and the one-run, two-tenure case rejects
it.

## Commands

Every command runs from the repository root:

```sh
npm run build
npm run test:unit --workspace microdelta        # includes .test-build/test/m5-acceptance
node --experimental-vm-modules node_modules/jest/bin/jest.js \
  --config packages/core/jest.config.mjs --runInBand .test-build/test/m5-acceptance/
node packages/core/test/m5-acceptance/controls/m5-mutation-controls.mjs   # on demand
node packages/core/test/m5-acceptance/controls/m5-mutation-controls.mjs --check-anchors
node packages/core/test/m5-acceptance/controls/m5-mutation-controls.mjs --only "<name text>"   # one control, not evidence
```

The suite is wired into `npm test` through the facade's existing `test:unit`:
`tsconfig.test.json` emits every `test/**/*.ts` and Jest runs every emitted
`*.test.js`. The CI matrix (`core (20)`, `core (22)`, `core (24)`) runs `npm
test`. Each test allows 120 s, because several worker processes and real
lease expiries add up on slow hosts; locally the whole suite takes about 42 s.

## Test-first record and honest classification

The suite, harness, worker and composition were written against the assembled
path before any run, with every expected value written by hand. No runtime
package was changed. The M5 components were already merged, so most
assertions are preservation evidence of accepted components through the
assembled path in independent processes, not RED; discrimination is shown by
the negative controls below. First-run observations, per suite:

- **Passed on the first run:** `usage-exactly-once` (7 of 7), the
  exhaustion case (added when the record's A-12 row was checked against the
  suite, with its two controls),
  `outcome-fold-coverage`, `publication-commit-race`, `lifecycle-isolation`,
  and all twelve `writer.test.ts` tests (including the nine interleavings);
  the exit-mode deferral test.
- **Wrong test assumptions or harness faults, corrected without weakening a
  requirement:**
  - `operator-resolves-unknown`: two failures because JSON transport drops
    `undefined` fields (`settlement.report`, `settlement.outcome`), which
    `toMatchObject` then required. They are now asserted absent.
  - `soft-then-hard-stop`: a stop requested on a `setTimeout(0)` after a
    provider receipt landed after the whole synchronous run, so the retry and
    two queued members were sent before the stop. A stop with no delay is now
    requested synchronously inside the observation, as an interrupt arriving
    exactly then. Two tests expected no result at all after a hard stop;
    discovery had completed before the stop and is legitimately its own
    result, so they now assert that no assessment was published.
  - `trial-production-isolation`: the worker checked the strict fold with
    `check`, which Resolution refuses for a fold ("resolve it with
    resolveFold"). The check now targets a member's assessment.
  - `event-privacy`: no stage produced a diagnostic, and a killed process has
    no result line. The recovery stage now meets an acknowledgment that
    recorded nothing and an observer that throws after a commit.
  - `stale-holder-interleavings` (late publish): the late completion's
    outcome is asserted as `refused:denied`, a pending step whose block is
    the `unrecorded` unknown outcome that `IOperationBlock` documents for a
    pass that lost its writer lease (ruling R).
  - Control runs before the final one (on intermediate code, with 28
    controls) showed guards that no test exercised,
    and controls that removed only one of two guards:
    - A timed wait's lane lending had no test, because a rate limit with a
      retry time ends the step attempt rather than waiting inside it. The
      transient-backoff case was added.
    - The taint guard ("a tainted step attempt keeps sending") was masked:
      calling the *same* operation again is also refused by the unsettled
      address. A case where the author makes a *different* fallback operation
      after the failure was added.
    - "A soft stop does not refuse a retry" removed only the send-time
      refusal; the permit wait that a stop cancels for a retry refuses it too.
      The control now removes both, as one defect, and an immediate
      safety-basis retry case was added beside the transient one.

    Each added case passed on its first run; each revised control was then
    rejected when run alone (`--only`), before the final full run.
  - That first controls run also hung: under the blind-replay control a test
    failed while background workers were still running, and those workers
    kept the test runner open. The harness now kills any background worker
    still running when a scenario is removed after each test.
- **Review fix round** (independent review of `de7be8f`). The review found
  that this record's reason for omitting a fence-only holder-guard control
  was false, and that the drain case pinned the wrong outcome. Tests were
  written first, then run once each:
  - *One run, two tenures* (`stale-holder-interleavings`): passed on its
    first run. Before it, the reviewer's probe showed the 48 tests passing
    with History's holder guard planted as holder-only (the run's stale
    request published under the old fence). The new fence-only control, run
    alone, is rejected by exactly this test and by no earlier one.
  - *Drain outlives lease*: the earlier version of this record and test
    asserted the drained run's raw `StaleWriterError`, which was the observed
    behavior, not ruling R's. The test now asserts only the outcome-neutral
    facts (no row changes, `lease-lost`, usage preserved, the successor
    untouched), and ruling R's typed ending became a `test.failing` DEFECT
    (#147), which failed on the escaping `StaleWriterError` until #148.
  - *Paid work across a step's publication* (`publication-commit-race`):
    the three kill cases passed on their first run.
  - *Privacy DEFECT at three sites*: a probe before running the test showed
    each site leaking the planted title: the member's typed outcome ("Body
    of … failed: …"), the fold run's failure ("Body of strict fold … failed:
    …") and the source check's run failure ("Source check of … failed: …").
  - `rows()` now snapshots every History table; the takeover case reads the
    grant's own expiry; the busy waiter is bounded at 10 s, which lets the
    deadline control join the runner. The suite passed 53 of 53 on its
    first full run after these changes.
- **Final review round** (review of `9922587`). The privacy regression only
  checked that nothing planted appeared, so it would pass if a planted
  failure stopped firing. It now asserts a precondition per site first; the
  worker prints Resolution's failure code for a run failure. Each
  precondition was shown to fail when its failure does not fire: with each
  planted throw disabled in the emitted fixture in turn, the test failed at
  that site's precondition (member body, fold body, source check), and
  passed again once restored. The drain regression now pins pr-1's refusal
  reason (`Operation <id> has an unknown outcome (unrecorded); it is not
  replayed`), and the strict fold's failure is asserted exactly, diagnostic
  included (`Strict fold report requires every required member of pr step
  assess: failed [pr-3], cancelled [], pending [pr-2], discovery closed`).
  A 33rd control removes #148's lease-lost mapping.
- **Defects found, filed as
  [#147](https://github.com/mike-north/microdelta/issues/147) and fixed by
  #148.** Until #148 merged, each was a clearly marked `test.failing` DEFECT
  test, so the suite stayed green while recording it. After merging
  `origin/main` at `18af318`, all four `test.failing` cases reported failure
  because every assertion now held. Each was then turned into an ordinary
  regression test referencing #147, and all four passed on their first run.
  The drain test's expectation was checked against ruling R and tightened to
  the exact typed ending (above), not adjusted to fit:
  1. **A hard stop requested as a run starts to sleep leaves the process
     alive until T.** `sleepForDeferral` (`packages/supervision/src/supervision.ts`)
     registers its abort listener first; for a signal already aborted the
     listener runs at once, while `cancel` is still a no-op, and the timer is
     then armed anyway with keep-alive. The run returns at once, but the
     process cannot exit until the deferral's time, which for a quota deferral
     is hours. Reproduced with a synchronous stop at the `sleeping` event: a
     3 s deferral kept the process for 3 061 ms, against 164 ms when the stop
     came 100 ms later. Regression test: `soft-then-hard-stop … a hard stop
     requested as the run starts to sleep lets the process exit before T
     (#147)`. The planned case itself passes with a stop during the
     sleep.
  2. **The `resumed` wait event reports `released: false`.** For a wait whose
     lease the run did release, `sleeping` reports `true` (as would `stopped`),
     but `resumed` is emitted with a literal `false`, contrary to
     `IWaitEvent.released` ("whether the run released its writer lease for the
     wait"). The durable release is proven through the writer row. Regression test:
     `durable-quota-deferral … the resumed wait event reports that the run
     released its lease for that wait (#147)`.
  3. **Framework failure messages repeat author error text.** Reuse
     Resolution builds its typed failures' messages from the author error's
     message (`describe(cause)` in `packages/resolution/src/resolution.ts`),
     so any value an author puts in its error reaches typed outcomes, run
     failures and every consumer that prints them. RUN-013 requires
     diagnostics to name fields and keys, not their contents; the author's
     error is still available as `cause`. Sites, each planted by the test:
     a member body (`execution-failure`, "Body of <step> failed: …", reaching
     the member's typed outcome), a fold body ("Body of strict fold <step>
     failed: …", rejecting the run) and a source check ("Source check of
     <step> failed: …", rejecting the run). The same `describe(cause)` pattern
     also builds the finality-hook, supplied-step and child-failure messages,
     which this suite does not plant. Regression test: `event-privacy … no framework
     failure message repeats an author error's text, from a member body, a
     fold body or a source check (#147)`.
  4. **A drain that outlives its lease fails its whole run with a raw
     `StaleWriterError`.** After the refused late completion, the drained
     members request meets the successor's newer pr-2 result, cannot record
     its acceptance without authority, and History's error escapes
     `resolveMembers` instead of ending the pass `lease-lost` with typed
     outcomes (ruling R). Regression test: `drain-outlives-lease … the drained
     run ends its pass lease-lost with typed outcomes, not a raw
     StaleWriterError (#147, ruling R)`.

## Negative controls

`node packages/core/test/m5-acceptance/controls/m5-mutation-controls.mjs`
plants one wrong behavior at a time into an emitted build that the worker
processes load through the built facade: Supervision's operation engine, run
engine, records and execution controls; History's durable authority; the
Accounting adapter and its summary; and the facade's writer port. It reruns
the ten M5 suites, judges each run fail-closed with the shared
`control-outcome.mjs`, and restores the bytes. A control fails the run if no
test fails or if any case it predicts still passes. Every prediction was
written before the control ran. `--check-anchors` verifies every anchor
matches exactly once without running a suite.

The final review round added a 33rd control, "a lost lease escapes
Resolution as History's raw error instead of ending the step lease-lost": it
plants #148's mapping away in Resolution's emitted `resolution.js`
(`withLeaseAuthority` rethrows the History error). Run alone with `--only`
on `43dcd26`, it is rejected by exactly the drain regression test (1 failing;
baseline and restored 53/53). The full run below has the other 32.

Final full run, in the post-merge gate below after the clean build: **PASS, 32 of
32 rejected**, with every predicted case failing; baseline and restored
53/53, 0 failing; 1 361 s. #148 moved `sleepForDeferral`, so "a stop does not
end a deferral sleep" was re-anchored to the stop-listener registration that
now follows the timer (`remove = state.stopped.signal.onAbort(…)` becomes
`remove = () => undefined;`), verified against the emitted build. The runner
answers `--check-anchors` through #143's shared `anchor-check.mjs`, and
`npm test`'s drift guard (`anchor-check.test.mjs`) now covers it. The
fix-round run before the merge (on `919f5f9`: PASS 32/32, 53/53, 1 472 s)
also rejected every control with its predicted cases. The review round added two controls: the holder
guard without its fence check (rejected only by the one-run, two-tenure case)
and the waiter that ignores its operator deadline (rejected by the busy
waiter, whose process is bounded at 10 s). Earlier runs on intermediate code
are not results. The first missed two controls (a timed wait's lane, and the
soft-stop retry refusal) and then hung (see the test-first record); the second
rejected 26 of 28, and its two misses exposed the soft-stop retry's second
guard and the taint guard's masking. The gaps were closed, and the two
exhaustion controls added, before the 30-control run on `fb26bb5` (PASS 30/30,
48/48), which this run supersedes.

| Guard | Planted defect | Target | Tests failing | Predicted cases, all failing | Other cases failing |
| --- | --- | --- | --- | --- | --- |
| stop | a soft stop admits new work | supervision | 4 | `soft-then-hard-stop` | `drain-outlives-lease` |
| stop | a soft stop does not refuse a retry | execution (2 edits) | 2 | `soft-then-hard-stop` | none |
| stop | a stop does not end a deferral sleep | supervision | 1 | `soft-then-hard-stop` | none |
| stop | a hard stop's remote state is not made durable | engine | 5 | `soft-then-hard-stop` | `event-privacy` |
| deferral | a deferral is not honored before its time | engine | 1 | `durable-quota-deferral` | none |
| deferral | the writer lease is kept while only deferred work remains | supervision | 2 | `durable-quota-deferral` | none |
| deferral | a timed wait keeps its window lane | execution | 1 | `durable-quota-deferral` | none |
| deferral | an unsettled address is forgotten, so a resumed deferral mints a new operation | engine | 5 | `durable-quota-deferral` | `usage-exactly-once`, `operator-resolves-unknown` |
| deferral | the rate-limit retry cap is not enforced | engine | 1 | `durable-quota-deferral` | none |
| deferral | a transient failure is retried beyond the author's attempts | engine | 1 | `durable-quota-deferral` | none |
| no-replay | an unknown outcome is replayed blindly | records | 16 | `no-blind-replay` | `writer-wait-and-takeover`, `stale-holder-interleavings`, `drain-outlives-lease`, `usage-exactly-once`, `event-privacy`, `soft-then-hard-stop`, `operator-resolves-unknown`, `outcome-fold-coverage` |
| no-replay | a tainted step attempt keeps sending | engine | 1 | `no-blind-replay` | none |
| no-replay | an address resolved as succeeded is minted and sent again | records | 1 | `operator-resolves-unknown` | none |
| no-replay | the provider idempotency key is not sent | engine | 2 | `no-blind-replay`, `usage-exactly-once` | none |
| accounting | a usage report is acknowledged twice | engine | 25 | `usage-exactly-once` | `no-blind-replay`, `operator-resolves-unknown`, `stale-holder-interleavings`, `drain-outlives-lease`, `durable-quota-deferral`, `publication-commit-race`, `soft-then-hard-stop`, `trial-production-isolation`, `lifecycle-isolation` |
| accounting | an unknown outcome is reported as zero usage | engine | 4 | `no-blind-replay`, `operator-resolves-unknown` | `soft-then-hard-stop` |
| accounting | the usage intent is not recorded before the send | engine | 27 | `usage-exactly-once` | `soft-then-hard-stop`, `no-blind-replay`, `operator-resolves-unknown`, `stale-holder-interleavings`, `drain-outlives-lease`, `durable-quota-deferral`, `publication-commit-race`, `trial-production-isolation`, `lifecycle-isolation` |
| accounting | Accounting records a redelivered report again | accounting | 25 | `usage-exactly-once` | `stale-holder-interleavings`, `drain-outlives-lease`, `durable-quota-deferral`, `publication-commit-race`, `soft-then-hard-stop`, `no-blind-replay`, `operator-resolves-unknown`, `trial-production-isolation`, `lifecycle-isolation` |
| accounting | Accounting keys a report identity globally rather than per operation | accounting | 1 | `usage-exactly-once` | none |
| accounting | Accounting counts unreported request attempts as reported (zero) | summary | 12 | `usage-exactly-once` | `stale-holder-interleavings`, `drain-outlives-lease`, `soft-then-hard-stop`, `no-blind-replay`, `operator-resolves-unknown`, `lifecycle-isolation` |
| fence | the holder guard checks the holder name but not the fence | history | 1 | `stale-holder-interleavings` | none |
| fence | the holder guard ignores lease expiry | history | 4 | `stale-holder-interleavings` | none |
| fence | acquisition takes over an unexpired holder | history | 3 | `writer-wait-and-takeover` | `stale-holder-interleavings` |
| fence | waiting ignores the operator deadline | wait | 1 | `writer-wait-and-takeover` | none |
| fence | a takeover reuses the previous fence | history | 17 | `writer-wait-and-takeover`, `stale-holder-interleavings` | `drain-outlives-lease`, `usage-exactly-once`, `event-privacy` |
| fence | a waiter's observation advances the fence | history | 3 | `writer-wait-and-takeover` | `stale-holder-interleavings` |
| fence | release clears the writer row without the holder guard | history | 7 | `stale-holder-interleavings` | `drain-outlives-lease` |
| fence | a lost lease escapes Resolution as History's raw error instead of ending the step lease-lost (run alone, final round) | resolution | 1 | `drain-outlives-lease` | none |
| fence | the facade's writer port keeps a stale lease instead of acquiring afresh | port | 4 | `stale-holder-interleavings` | none |
| privacy | operation events carry the request binding | engine | 1 | `event-privacy` | none |
| privacy | a diagnostic repeats the adapter's error text | engine | 1 | `event-privacy` | none |
| environment | candidate lookup admits results of any environment without a promotion | history | 2 | `trial-production-isolation` | none |
| lifecycle | a closed run's context is still available to an escaped callback | supervision | 1 | `lifecycle-isolation` | none |

Targets: `engine`, `records`, `supervision` and `execution` are Supervision's
emitted `operation-engine.js`, `records.js`, `supervision.js` and
`execution.js`, and `wait` its `writer.js`; `history` is History's `durable/index.js`; `accounting` and
`summary` are Accounting's `sqlite/index.js` and `summary.js`; `resolution`
is Resolution's `resolution.js`; `port` is the
facade's `writer.js`. Every planned evidence case is rejected by at least one
control. `outcome-fold-coverage` is rejected only by the blind-replay control
here; the outcome-fold guards themselves have their own runner
(`outcome-fold/controls`).

## Final gates

The implementer ran these sequentially, each step logged with its exit code
by a script in `scratch/` (not committed), on Node v24.14.0, macOS. Record
edits after the gates change no code.

**Final-round gate, on `43dcd26`**, after `npm run clean`:

| Command | Result |
| --- | --- |
| `npm run clean` / `npm run build` / `npm run check` | exit 0 / exit 0 (31 s) / exit 0 (48 s) |
| `npm test` | exit 0 (312 s). Facade Jest 819/819, including the ten M5 acceptance suites (53 tests); the drift guard passes `m5-mutation-controls.mjs` |
| M5 acceptance alone, once | 53/53 (40 s) |
| `m5-mutation-controls.mjs --check-anchors` | `ANCHORS OK: 33 controls` |
| `m5-mutation-controls.mjs --only "lost lease escapes"` | PASS 1/1: rejected by the drain regression test; baseline and restored 53/53 |

**Post-merge gate, on `5263fd8`** (the branch after merging `origin/main` at
`18af318` and turning the defect records into regression tests), after
`npm run clean`:

| Command | Result |
| --- | --- |
| `npm run clean` | exit 0 |
| `npm run build` | exit 0 (20 s) |
| `npm run check` | exit 0 (40 s) |
| `npm test` | exit 0 (265 s). Facade Jest 819/819, including the ten M5 acceptance suites (53 tests, none `test.failing`). The anchor drift guard reports every runner's anchors matching exactly once, `m5-acceptance/controls/m5-mutation-controls.mjs` included. Facade tsd and controls checks, every other workspace suite, the experiments and the example pass |
| M5 acceptance alone, three times | 53/53 each (39 s, 38 s, 39 s) |
| `m5-mutation-controls.mjs` | PASS 32/32; baseline and restored 53/53 |
| `--check-anchors`, every runner | `ANCHORS OK` for all twelve: acceptance 13, accounting 12, concurrency 19, history 25, journal 11, M4 23, M5 32, operations 47, outcome-fold 11, resolution 29, workspace 23, facade-operations 12 |

The post-merge gate's full controls run (32 controls) stands for the 32
controls unchanged since; the final-round gate adds the 33rd. The earlier
gates on `919f5f9` (53 tests, four of them `test.failing` DEFECT records; 32
controls) and on `fb26bb5` (48 tests, 30 controls) passed the same steps
before the merge and are superseded.

**Every other control runner in full, on `2a5c4c5`, before the merge** (none of these runners runs the
M5 suites, and no later commit of this branch changes a file outside
`packages/core/test/m5-acceptance` and this record), after its own clean
build, check and test, all exit 0:

| Command | Result |
| --- | --- |
| `accounting-mutation-controls.mjs` | PASS 12/12 |
| `concurrency-mutation-controls.mjs` | PASS 19/19 |
| `history-mutation-controls.mjs` | PASS 25/25 |
| `journal-mutation-controls.mjs` | PASS 11/11 |
| `operations-mutation-controls.mjs` | PASS 39/39 |
| `outcome-fold-mutation-controls.mjs` | PASS 11/11 |
| `facade-operations-mutation-controls.mjs` | PASS 12/12 |
| `acceptance-mutation-controls.mjs` (M3) | FAIL: the 11 controls that ran were all rejected; 2 anchors match twice |
| `m4-mutation-controls.mjs` | FAIL: the 21 controls that ran were all rejected; 2 anchors match twice |
| `resolution-mutation-controls.mjs` | FAIL: the 21 controls that ran were all rejected; 8 anchors match 0, 2, 3 or 5 times |
| `workspace-mutation-controls.mjs` | CONTROL RUN INVALID at its baseline: it builds each Jest path by joining a regular-expression pattern into the suite path (`join(dirname(config), pattern, suite)`), so no suite file is found |

This PR changes none of the four runners that failed there, their targets,
suites or anchors. Their stale anchors were the condition #135 tracked, which
#143 re-anchored; after the merge every runner's `--check-anchors` passes
(above). Those runners were not rerun in full for this record.

Main-branch results on the #146 merge commit `3df7c57`, recorded at acceptance (#123):

| Evidence on the merge commit | Result |
| --- | --- |
| CI: PR metadata, core (20), core (22), core (24) | `success` on the PR. [`Check` run 36891934977](https://github.com/mike-north/microdelta/actions/runs/36891934977) on `main`: `success` for core (20), (22) and (24) |
| `m5-mutation-controls.mjs --check-anchors` | `ANCHORS OK: 33 controls` |
| `m5-mutation-controls.mjs` (full run) | `PASS: 33 controls`; baseline and restored 53/53 |
| M5 acceptance suite, standalone | 10/10 suites, 53/53 tests (38 s) |
| `/clean_blt` from a fresh `npm ci` | exit 0 throughout; facade 819/819 (see the [M5 evidence record](m5-2026-10-01.md)) |

## Limits: what is and is not proven

- **No multi-writer parallelism.** One fenced writer per store, as the owner
  decided. In-process member concurrency runs under the permit pool; nothing
  measures or permits concurrent writers across processes.
- **Liveness and fairness are unproven.** Waits are bounded by an operator
  deadline or a stop, and waiters wake at a holder's expiry, but neither
  model nor test proves a waiter is eventually granted the lease or that
  waiting is fair (see the concurrency record's observations).
- **No real providers.** The provider is a deterministic local fake. Its
  idempotency, cancellation and usage reports are scripted. No paid call was
  made, and no claim is made about a real provider's deduplication window,
  billing for cancelled work or report redelivery.
- **Accounting is injected.** `@microdelta/accounting` is a development
  dependency of the facade and is not yet registered as a published package,
  so the caller opens its durable adapter and passes it to `openWorkspace`.
  Until the package is registered and the facade can assemble the default
  adapter itself, every path here (and the example's) injects it.
- **One host, process termination only.** Processes run on one host over
  local SQLite files. SIGKILL is the only fault of the process itself; there
  is no power loss, filesystem failure or network storage.
- **Simulated time.** Hours between processes are simulated by setting a
  worker's host clock forward; real multi-hour sleeps are not run. Sleep mode
  is exercised with a 1.5 s deferral. Each later process's clock offset never
  decreases, so History's clock high-water is never ahead of a later reader.
- **Stop timing.** Operator stops are requested by the worker when an
  observation happens, standing in for interrupts; OS signal handling
  (first and second interrupt) belongs to the CLI (M6).
- **Facade-level interleavings.** The nine cases enumerate the holder's late
  action against the successor's position through the facade. The full
  seven-operation matrix, contention and the model checking are the #110
  record's, cited rather than repeated.
- **Re-payment on resume is documented, not prevented (EXP-8 CX-3).** The
  reuse unit is the step. A process killed after a paid answer came back but
  before its step published leaves the operation succeeded and its usage
  known, but no step result, so a resumed run re-executes the step and pays
  again under a new operation. `publication-commit-race` asserts exactly
  that: two succeeded operations for pr-1, one acknowledged report each,
  usage complete at 400 tokens over 4 operations and 4 reports, nothing
  unknown, nothing counted twice within an operation. Authors who isolate the
  paid call in its own memoized child step pay once: the same kill leaves the
  child published, the resumed parent reuses it, and usage stays at 300
  tokens over 3 operations. A kill after the step published reuses it, with
  the provider called once.
- **Cited cases.** Commit-boundary kills of History's own publication commit
  are cited from `acceptance/stop-publication.test.ts`, which meets the same bar
  (assembled path, separate processes, hand-derived values) through the M3
  harness's instrumented host. M3's budget refusal, cached hit and check-only
  miss are cited from `acceptance/admission-observers.test.ts`.
- **Usage units.** That a usage unit which is not an identifier is dropped
  from events (and kept by Accounting) is proven in-process by
  `operations/privacy.test.ts`, not here.

## Open follow-ups

- [#129](https://github.com/mike-north/microdelta/issues/129): History
  immutability triggers can be bypassed by `INSERT OR REPLACE`.
- [#138](https://github.com/mike-north/microdelta/issues/138): a typed busy
  outcome for History data operations and the journal (today they surface
  Machine's `SqliteBusyError`).
- [#144](https://github.com/mike-north/microdelta/issues/144): Resolution test
  gaps, five fault sites no suite rejects.
- [#145](https://github.com/mike-north/microdelta/issues/145): context import
  rules do not cover dynamic `import()`.
- [#147](https://github.com/mike-north/microdelta/issues/147), the four
  defects above, is fixed by #148 (merged as `18af318`); each is now an
  ordinary regression test here. #148 moved `sleepForDeferral`, so the
  control "a stop does not end a deferral sleep" was re-anchored to the
  stop-listener registration that now follows the timer.
