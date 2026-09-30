# M5: operational correctness for the contribution analysis

Status: M5 implementation plan for [issue #114](https://github.com/mike-north/microdelta/issues/114).
M4 is accepted ([#89](https://github.com/mike-north/microdelta/issues/89)). The owner's
product decisions of 2026-09-30 are recorded in the owning contracts
([operations](../spec/operations.md) RUN-002/010/011/012/013/014/017,
ACC-003/007). The [EXP-8 decision](../../experiments/exp-8/decision.md)
([#109](https://github.com/mike-north/microdelta/issues/109)) selects the
operational mechanisms. [#110](https://github.com/mike-north/microdelta/issues/110)
supplies the concurrency and model evidence. This plan applies the active
specification and does not replace it. Implementation readiness follows plan
acceptance and each prerequisite issue, as the dependency table records.

## Consumer outcome

The contribution report now calls a **paid-like assessor**: a deterministic fake
provider with latency, rate limits, lost responses and usage reports. It never
costs money. An operator runs the analysis unattended and gets the following
behavior:

- A quota limit on one PR defers only that assessment. The run then either
  sleeps and resumes, or exits and reports "waiting until T". Every other
  contributor finishes, and a later run honors T.
- A soft stop admits nothing new and lets in-flight steps finish. A hard stop
  aborts them honestly.
- Every paid call is recorded before it is sent. Its usage is counted exactly
  once. A crash leaves usage **unknown**, never zero.
- A lost response on a non-idempotent call is **unknown** and is not replayed,
  unless the author declared it safe to repeat. An operator can resolve or
  abandon an unknown operation.
- A second process waits for the writer lease instead of failing, up to an
  operator deadline.
- A trial run's results never satisfy production except through a recorded
  promotion.
- An outcome fold reports every contributor's settled status, including
  failures, with coverage.
- Events carry identifiers, statuses, timings, usage figures and references,
  and never values.

## What M5 adds

| Concept | Before M5 | M5 |
| --- | --- | --- |
| Concurrency | One store-wide fenced writer; a second process fails immediately | Same single writer, plus an in-process bounded permit pool. Other processes wait for, or take over through fencing, the lease until an operator deadline, then fail with a typed writer-busy error |
| Stop | Closed run denies admission | Soft stop drains admitted steps with no default deadline. An operator deadline or a hard stop escalates. Remote state is cancelled, running or unknown |
| External calls | None modeled | A declared operation handle. A stable operation identity is persisted before each send. Outcomes are succeeded, failed, deferred (not before T), or unknown. There is no blind replay |
| Retry | None | Rate and quota responses with a retry time retry by default (cap 5, overridable). Other transient failures retry under an author policy. Every retry is correlated with operation, request attempt, step attempt, member and run |
| Accounting | No package | `@microdelta/accounting`: usage observations keyed by (operation, report), with known and unknown kept separate and ACC-* summaries |
| Environments | A string on the run | Namespaced results, heads, attempts, acceptances, operations and accounting, plus a recorded promotion |
| Folds | Strict only | Outcome (tolerant) folds over settled statuses, with coverage |
| Events | Step lifecycle only | A privacy-restricted structured event schema with correlation identities |

## Outcomes to prove before implementation

| Scenario | Required evidence | Gate |
| --- | --- | --- |
| Two processes contend for one store; the holder is killed; a waiter takes over | The waiter acquires only after expiry, with a higher fence. The stale holder cannot publish, renew, release, allocate, stage, abandon or accept. The operator deadline yields a typed writer-busy error naming the holder | A-09, PUB-004, #110 |
| Deterministic interleavings of two workers across processes | Every enumerated interleaving preserves authority, fencing and exact references. Mutation controls are caught | A-09/A-10 |
| Soft stop during a run with one in-flight step and one queued member | No new admission or retry after the stop. The step drains and publishes. A queued member ends interrupted without a send | A-13, RUN-014 |
| Hard stop during a send, a permit wait and a deferral sleep | The body is aborted and the attempt is interrupted. Remote state is recorded. Nothing partial is published | A-13, RUN-014/015 |
| Kill just before and just after the publication commit | Old complete state, or the committed success reused. Never a re-execution of committed success | A-09, A-19 |
| Throwing observer and failing presenter | The committed success is preserved and never re-executed | A-19 |
| Quota response with a retry time 3h ahead | A durable deferral holds no permit and releases the lease once only deferred work remains. Siblings finish. A restart before T admits nothing. After T it retries under the same operation identity | A-11, A-12, RUN-011 |
| Lost acknowledgment, duplicate report, kill between intent and usage | Known usage counted exactly once. Unknown usage reported as unknown, never zero. Same report ID on two operations counted twice | A-14, ACC-003/005/007 |
| Lost response on a non-idempotent call; the author body catches and retries | One send. Unknown outcome. No replay in this pass or later passes until an operator resolves it | A-12, RUN-012 |
| Safe-to-repeat operation, or provider idempotency keys | Retry under the same operation identity; one effect with keys | A-12 |
| Drain outlives the lease TTL and a successor takes over | The late completion cannot publish or overwrite the successor's lease. It ends interrupted with usage preserved | A-09, EXP-8 ruling R |
| Trial run then production run | Trial results never satisfy production. After an explicit recorded promotion they do, with provenance preserved | RUN-016/017 |
| One failed, one pending, one successful member; outcome fold | The outcome fold reports every settled status with coverage and never claims completeness while anything is unsettled. Repairing the failure makes it reconsider | A-11, RUN-010 |
| Concurrent runs in one process; a thrown nested frame; a detached callback after close | No cross-run leakage; late use fails clearly | A-18 |
| Planted payload values | No event, diagnostic, stdout or stderr contains them | RUN-013 |

## Owner contracts to implement

| Owner | Responsibility in M5 | Boundary |
| --- | --- | --- |
| Result History & Publication | Lease waiting and fenced takeover (the History side). A versioned, fenced **operation journal** port that stores Supervision's opaque operation and deferral records atomically with fencing. Per-environment namespacing of attempts, heads and acceptances. A recorded promotion record | Does not interpret operation semantics, retry policy or accounting. It is the only consistency authority |
| Run Supervision | Permit pool; stop controller (soft/hard, drain unit = admitted step, deadline escalation, abort signal to bodies); operation handle and outcome states; retry and deferral policy; correlation identities; writer waiting with the operator deadline; operator resolve/abandon for unknown operations; the structured event schema | Persists only through History's journal port and Accounting's contract; never touches History rows. No CLI |
| Resource Accounting (new package) | Usage observations keyed by (operation, report); known vs unknown; ACC summaries; its own persistence port with a SQLite adapter over the Machine capability; environment-scoped | Never invents usage and never counts estimates as observed. It does not decide execution policy (ACC-008) |
| Reuse Resolution | Admission honors "not before T" and unknown-operation blocks. Outcome-fold resolution. Nested waiting bounded by run cancellation (#106) | No bypass of History fencing |
| Definition & Binding | The outcome-fold declaration and the declared external-operation slot shape | No execution |
| Facade and example | Assemble the owners; the paid-like fake assessor example | No fixture-only alternate API |

**Accounting write authority.** Usage observations are idempotent, keyed facts about
money already spent, so recording one does not require the History writer fence. A
stale holder's late usage report is still recorded, because the usage happened. This
is stricter truthfulness than EXP-8's lease-bound report (its CX-4 limit). Publication
authority still requires the fence.

**Writer lease (from #110).**
- **Model.** `WriterLease.tla` models the owner-decided protocol. A waiter changes no authority or data; its only effect is that the monotonic time high-water may rise. Takeover happens only after expiry, with a fresh fence.
- **Evidence.** The model→code→test mapping and the interleaving and contention results are in [the concurrency record](../validation/m5-concurrency-2026-09-30.md).
- **Scope.** Liveness and multi-writer parallelism are not claimed.

**Package addition.** Add `packages/accounting` under the package-boundary rules:
- declared edges `accounting.uses = ['machine', 'value']`;
- API Extractor rollups and reports, and `@alpha` surfaces;
- Node conformance for any new capability use;
- placement in `build:packages` order before `supervision`.

## Selected execution contract (from EXP-8, rulings on #109)

- **Stop.** The drain unit is the admitted step. A request-granularity drain is
  rejected. A hard stop:
  - aborts sends, permit waits and deferral sleeps;
  - discards a returned but uncommitted output;
  - records remote cancellation only where the provider supports it, and otherwise
    running or unknown.
- **Publication race.** The publication commit is the linearization point. It
  requires an unexpired, current lease that is re-read durably.
- **Taint guard.** Once a step attempt has a pending signal (unknown outcome or
  deferral), further operation calls rethrow it without sending. A deferred operation
  is never sent before T.
- **Reuse.** The reuse unit is the step. Authors isolate each paid call in its own
  memoized or supplied child step. Raw multi-call bodies re-pay on resume, and this
  is documented.
- **Unknown outcomes.** Retrying one needs a safety basis (safe-to-repeat or
  provider idempotency) and an author policy. It blocks the member until an operator
  resolves or abandons it.
- **Write order.** Intent before send, usage before outcome.
- **Leases.** A drain is bounded by lease authority (ruling R). The lease TTL is
  operator-configured.
- **Events.** Identifiers, closed status and reason codes, times, usage figures and
  references. Unit names must be identifiers, and designated member keys must not
  embed sensitive data.

## Planned evidence names

| Planned case | Independent assertion |
| --- | --- |
| `writer-wait-and-takeover` | Waiter, deadline, typed writer-busy, fenced takeover across processes |
| `stale-holder-interleavings` | Every enumerated interleaving keeps authority; mutation controls are caught |
| `soft-then-hard-stop` | No admission after soft stop; drain; hard stop aborts send, permit wait and sleep |
| `publication-commit-race` | Kill before and after the commit; observer and presenter failure preserve success |
| `durable-quota-deferral` | Sleep and exit modes; restart before and after T; siblings finish; no permit held |
| `usage-exactly-once` | Lost acknowledgment, duplicate, cross-operation report IDs, kill points, unknown vs zero |
| `no-blind-replay` | Lost non-idempotent response, catch-and-retry, safe-to-repeat, idempotency keys |
| `operator-resolves-unknown` | A resolution unblocks the member with provenance |
| `drain-outlives-lease` | Late completion is refused and the successor is untouched |
| `trial-production-isolation` | No accidental satisfaction; recorded promotion |
| `outcome-fold-coverage` | Settled statuses, coverage, no premature completeness, repair |
| `lifecycle-isolation` | Concurrent scopes, thrown nested frame, late detached callback |
| `event-privacy` | Planted values never appear in events, diagnostics, stdout or stderr |

## Implementation queue and readiness

| Issue | Deliverable | Accepted dependencies |
| --- | --- | --- |
| [#109](https://github.com/mike-north/microdelta/issues/109) | EXP-8 mechanism decision | — |
| [#110](https://github.com/mike-north/microdelta/issues/110) | Concurrency evidence and model recheck | — |
| [#114](https://github.com/mike-north/microdelta/issues/114) | This plan and the recorded owner decisions | #109, #110 |
| [#115](https://github.com/mike-north/microdelta/issues/115) | `@microdelta/accounting` package: observations, idempotency, unknowns, summaries, SQLite port | #114 |
| [#116](https://github.com/mike-north/microdelta/issues/116) | History operation journal port, environment namespacing, promotion record | #114 |
| [#113](https://github.com/mike-north/microdelta/issues/113) | Concurrent first open of a new store serialized, with typed busy errors (machine-node) | #114 |
| [#117](https://github.com/mike-north/microdelta/issues/117) | Writer lease waiting, operator deadline, typed writer-busy (including `SQLITE_BUSY` exhaustion), fenced takeover, `last_fence` written unchanged on renew/release | #114, #110, #113 |
| [#118](https://github.com/mike-north/microdelta/issues/118) | Permit pool, stop controller, publication race rule, #106 bounded nested wait, A-18 run-scope lifecycle isolation | #114 |
| [#119](https://github.com/mike-north/microdelta/issues/119) | Operation handle, retry/deferral policy, correlation, operator resolve, events schema | #116, #115, #118 |
| [#120](https://github.com/mike-north/microdelta/issues/120) | Outcome folds | #114 |
| [#121](https://github.com/mike-north/microdelta/issues/121) | Facade assembly and the paid-like example | #119, #117, #120, #113 |
| [#122](https://github.com/mike-north/microdelta/issues/122) | Independent-process acceptance and dated evidence | #121 |
| [#123](https://github.com/mike-north/microdelta/issues/123) | Supervisor final M5 acceptance | All of the above |

Implementers own one contained issue and worktree, and stop at a reviewable PR. The
supervisor owns contract decisions, independent review, exact-head review and merges.
Each PR needs a completed Copilot review on some commit. No paid calls,
publication or release changes.
