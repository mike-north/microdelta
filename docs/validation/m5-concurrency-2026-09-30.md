# M5 concurrency evidence: the single fenced writer across processes (issue #110)

This record rechecks the EXP-7 publication model against production durable
History (`packages/history/src/durable`). It adds a sibling model of the
owner-decided writer protocol and gives Node evidence that a stale worker cannot
publish, renew, release, allocate, stage, abandon or accept on behalf of
another holder. That evidence comes from fresh, separate processes with
deterministic interleavings and from real simultaneous contention, as
PUB-004 and the M5 exit require. The source base was
`e1b8100` (`origin/main` on 2026-09-30). Local verification used Node v24.14.0
on macOS (arm64, 18 logical cores); CI runs Node 20, 22 and 24.

The owner's 2026-09-30 concurrency decision is taken as settled. It provides
one fenced writer per store and members running concurrently in-process under a
bounded permit pool. Other processes wait for the lease, taking over an expired
lease through fencing, until an operator deadline. After that deadline the
waiter fails with a typed writer-busy error naming the holder. Check and
inspection need no lease. This issue supplies evidence and a model for that
protocol. It does not implement the lease wait, the deadline, the writer-busy
error or the permit pool, and no production behavior changed.

## Results at a glance

- **TLC.** Every good configuration exhausted its finite state graph with no
  violation. Every known-bad configuration (three for `Publication.tla`, seven
  for `WriterLease.tla`) stopped with exit 12 at a counterexample.
- **Deterministic interleavings.** 84 enumerated stale-holder cases (four
  takeover kinds × seven operations × three positions) and eight targeted
  scenarios pass against production History across separate processes.
- **Real concurrency.** Four processes contending simultaneously showed exactly
  one authority per fence, a typed refusal for every loser, and storage writes
  in non-decreasing fence order.
- **Mutation controls.** Seven controls, including the required fence-check and
  expiry-check removals, were each rejected by named tests. The restored build
  passed all 95 tests.
- **Earlier alignment findings.** Findings 1, 2 and 4 are closed against
  production History. Finding 3 is also covered.
- **Production defect found, not fixed.** Several processes creating the same
  new store at once fail with an untyped `SQLITE_BUSY` inside the Node SQLite
  capability's connection setup. An already initialized store opens cleanly in
  every process. See [the store-creation finding](#finding-simultaneous-creation-of-a-new-store).

## Toolchain

- `tla2tools.jar` from the official
  [TLA+ tools v1.7.1 release](https://github.com/tlaplus/tlaplus/releases/tag/v1.7.1).
  SHA-256 `d532ba31aafe17afba1130f92410d9257454ff7393d1eb2fe032f0c07f352da5`
  and SHA-1 `9416f74257aa50f250776db34964db7ec99e9883` were verified before use.
  It reports `TLC2 Version 2.16 of 31 December 2020 (rev: cdddf55)`.
- Portable Eclipse Temurin JDK `17.0.20.1+1` for macOS aarch64, a native arm64
  binary, from the Adoptium release
  `OpenJDK17U-jdk_aarch64_mac_hotspot_17.0.20.1_1.tar.gz`. Its SHA-256,
  `196d13ba5f10414bef7f6a05a9b3f00edacb18ebacef2b99485db9e2ee18f0e8`, matched
  the Adoptium API's published checksum. TLC's banner prints `x86_64` for the
  64-bit data model even on this arm64 JVM.
- Nothing was installed system-wide. The JDK, jar, TLC state databases
  (`-metadir`) and logs lived in the repository's gitignored `scratch/`.

Every run used one worker, from `experiments/exp-7`:
`java -cp ../../scratch/tla-toolchain/tla2tools.jar tlc2.TLC -workers 1 -metadir ../../scratch/tlc-meta/<name> -config <cfg> <model>.tla`. The [EXP-7 README](../../experiments/exp-7/README.md#reproduction)
gives the full loop.

Before any model change, the retained 2026-09-26 configurations reproduced
exactly under this toolchain. `PublicationBad.cfg` gave exit 12 at
`PublicationUsedCurrentAuthority` with 47,256 generated, 13,732 distinct and
depth 8. `Publication.cfg` gave exit 0 with 29,599,222 generated, 2,624,759
distinct, depth 24 in 2 min 5 s.

## Model recheck

### What changed

- `Publication.tla` gained the two production transitions it lacked.
  `Abandon` ends an allocated or staged attempt under current authority; its
  `ended` phase is production's `failed`/`interrupted`. `Accept` records
  acceptance of a retained result. The single `OmitPublishFence` switch became
  a `Fault` constant with one known-bad configuration per guard. Two invariants
  were added: `EndedAttemptIsNeverAResult` and
  `AcceptanceKeepsCurrentAndHistory`. Bounds are unchanged.
- `WriterLease.tla` is new. It models the owner-decided writer protocol as
  production implements it:
  - acquisition takes an absent or expired lease with the next fence, and an
    unexpired holder yields `held` (`Grant`/`Held`);
  - every lease-guarded mutation goes through the one shared holder guard
    (`HolderOp` over renew, release, allocate, stage, publish, abandon and
    accept);
  - inspection needs no lease (`Inspect`);
  - "now" is the larger of an arbitrary host reading and the persisted
    high-water, persisted by every writer transaction, including refusals and
    `held` observations.

  Its known-bad faults are:
  - takeover without a fence increment;
  - renewal accepted from a stale fence;
  - the holder guard without its fence check;
  - the holder guard without its expiry check;
  - takeover of an unexpired holder;
  - a waiter's observation that advances the fence;
  - an ignored high-water.

### TLC results

The final run of every configuration (`scratch/tlc-logs/final-*.log`):

| Model / configuration | Fault | Exit | Generated | Distinct | Depth | Time | Result |
| --- | --- | --- | --- | --- | --- | --- | --- |
| `Publication.cfg` | none | 0 | 44,070,530 | 3,836,999 | 24 | 3 min 43 s | no violation; graph exhausted |
| `PublicationBad.cfg` | omit-publish-fence | 12 | 65,681 | 18,886 | 8 | 1 s | `PublicationUsedCurrentAuthority` |
| `PublicationBad-abandon-completed.cfg` | abandon-completed | 12 | 16 | 16 | 3 | <1 s | `CurrentIsComplete` |
| `PublicationBad-accept-moves-current.cfg` | accept-moves-current | 12 | 17,978 | 6,085 | 7 | 1 s | `AcceptanceKeepsCurrentAndHistory` |
| `WriterLease.cfg` (2 processes) | none | 0 | 4,133,247 | 69,779 | 10 | 13 s | no violation; graph exhausted |
| `WriterLeaseThreeProcesses.cfg` | none | 0 | 29,429,491 | 382,168 | 10 | 1 min 36 s | no violation; graph exhausted |
| `WriterLeaseBad-takeover-without-fence.cfg` | takeover-without-fence | 12 | 20 | 20 | 3 | <1 s | `GrantIssuesFreshFence` |
| `WriterLeaseBad-renew-ignores-fence.cfg` | renew-ignores-fence | 12 | 864 | 470 | 4 | <1 s | `AcceptedByCurrentAuthority` |
| `WriterLeaseBad-holder-ignores-fence.cfg` | holder-ignores-fence | 12 | 854 | 460 | 4 | <1 s | `AcceptedByCurrentAuthority` |
| `WriterLeaseBad-holder-ignores-expiry.cfg` | holder-ignores-expiry | 12 | 50 | 46 | 3 | <1 s | `AcceptedByCurrentAuthority` |
| `WriterLeaseBad-acquire-ignores-expiry.cfg` | acquire-ignores-expiry | 12 | 36 | 20 | 3 | <1 s | `TakeoverOnlyAfterExpiry` |
| `WriterLeaseBad-waiter-advances-fence.cfg` | waiter-advances-fence | 12 | 28 | 28 | 3 | <1 s | `WaiterPreservesAuthorityState` |
| `WriterLeaseBad-ignore-high-water.cfg` | ignore-high-water | 12 | 208 | 192 | 3 | <1 s | `EffectiveTimeNeverRegresses` |
| `WriterLeaseConsequence-takeover-without-fence.cfg` | takeover-without-fence | 12 | 21 | 21 | 3 | <1 s | `AtMostOneAuthority` |
| `WriterLeaseConsequence-ignore-high-water.cfg` | ignore-high-water | 12 | 2,116 | 1,298 | 4 | <1 s | `EndedAuthorityNeverActs` |
| `WriterLeaseConsequence-acquire-ignores-expiry.cfg` | acquire-ignores-expiry | 0 | 4,185,687 | 67,235 | 8 | 15 s | no storage-safety violation |
| `WriterLeaseConsequence-waiter-advances-fence.cfg` | waiter-advances-fence | 0 | 4,641,583 | 82,739 | 10 | 16 s | no storage-safety violation |

Generated and distinct counts of a stopped run are TLC's counts at the stop,
not an exhausted graph. The final runs shared the machine with the full
build and test gate, so the times are indicative. An earlier run of the
same configurations produced identical counts. TLC's fingerprint-collision
estimates (optimistic / actual) were `8.4E-6`/`6.8E-7` for `Publication.cfg`,
`1.5E-8`/`4.8E-10` for `WriterLease.cfg` and `6.0E-7`/`2.5E-8` for three
processes. `WriterLease.cfg` uses two processes, two holder names, fences 0–3,
host readings 0–3 and lease length 2; `Publication.cfg` keeps the EXP-7 bounds.

The consequence-only runs omit the direct protocol statements (the fresh-fence,
takeover-after-expiry, waiter, inspection and high-water invariants). Two of
them show that storage harm is reachable once the guard is weakened. The other
two exhaust: early takeover and a fence-advancing waiter reach no
storage-safety violation. Fencing alone keeps storage safe; waiting until
expiry is the lease promise the decision makes to the holder, and it is
checked directly by `TakeoverOnlyAfterExpiry` and `WaiterPreservesAuthorityState`.

### Counterexamples

Shortest traces reported by TLC. `w` is a holder name, `w`/1 a lease of that
name with fence 1; `P1` and `P2` are processes; `hw` is the persisted clock
high-water.

- **takeover-without-fence.** P1 is granted `w`/1, expiry 2. At reading 2 the
  lease has expired and a new grant keeps fence 1. In the consequence-only run
  that grant goes to P2, and both processes then hold a `w`/1 lease object the
  row accepts (`AtMostOneAuthority`).
- **renew-ignores-fence.** P1 is granted `w`/1. At reading 2, P2 is granted
  `w`/2. P1 renews with its stale `w`/1 lease; the renewal is accepted and
  writes fence 1 back into the writer row, so the durable fence regresses
  from 2 to 1.
- **holder-ignores-fence.** P1 `w`/1, then P2 `w`/2 at reading 2. P1's
  `allocate` with fence 1 is accepted while P2 holds the lease.
- **holder-ignores-expiry.** P1 `w`/1, expiry 2. P1's `allocate` at reading 2
  is accepted after its own lease expired.
- **acquire-ignores-expiry.** P1 `w`/1, expiry 2. At reading 0 a second grant
  (fence 2) takes over the unexpired lease.
- **waiter-advances-fence.** P1 `w`/1. A `held` observation advances the durable
  fence to 2, invalidating the live holder.
- **ignore-high-water.** P1 is granted at reading 1 (hw 1). A `held` observation
  at reading 0 persists hw 0, so time regresses. In the consequence-only run,
  P1's `allocate` at reading 2 is refused as expired (hw 2). At reading 0 the
  same lease allocates successfully, a revived expired lease
  (`EndedAuthorityNeverActs`).
- **Publication omit-publish-fence.** The same eight steps as the 2026-09-26
  evidence: acquire A; allocate; execute; stage; tick to expiry; reclaim by B;
  A publishes with fence 1 while B holds fence 2.
- **abandon-completed.** Acquire A, then abandon the completed seed: the
  current pointer names a non-completed attempt.
- **accept-moves-current.** Acquire A, allocate, execute, stage and publish
  generation 2 (current 2). Accepting generation 1 moves current back to 1.

### Setup failures observed

The first runs of the `WriterLease` known-bad configurations reported
`EndedAuthorityNeverActs` at depth 3 for three different faults
(renew-ignores-fence, holder-ignores-fence and ignore-high-water), each with
the same grant-then-release trace. The invariant was wrong, not the protocol: a
legitimate release added its own fence to the ended set in the same step and
was then judged by it. The witness now records whether the presented fence had
ended at evaluation, before the step's effect. All configurations were rerun
after the correction. No other model or configuration error occurred.

## Model→code→test mapping

Code locations are in `packages/history/src/durable/index.ts` unless noted.
Tests are in `packages/core/test/`:

- `concurrency/interleavings.test.ts`: `T*`, `W*`, `K*`, `R1`, `A1`;
- `concurrency/contention.test.ts`: `C1`, `C2`;
- `durable-history/durable-history.test.ts`: `DH:`;
- `durable-history/crash-recovery.test.ts`: `CR:`.

### Production transitions and model actions

| Production transition | Code | Model action | Named tests |
| --- | --- | --- | --- |
| acquire (grant) | `acquireWriter` 493–514: expiry check 500, next fence 504 | `WriterLease!Grant`; `Publication!Acquire`, `Reclaim` | T1–T4 (successor fence > A's), W1, W3, K1, C1 (fence = round), C2; `DH: one live holder at a time; release keeps the fence advancing`; `CR: a kill after acquisition leaves the lease until expiry, then a successor gets a larger fence` |
| acquire (held, waiter) | `acquireWriter` 500–503, `observeTime` 303–313 | `WriterLease!Held`; `Publication!Held` | W1 (every point of the holder's work), K1, C1 (losers told the winner and its expiry), C2 |
| reacquire after expiry | `acquireWriter` 500, 504 | `Grant` with a prior holder (`TakeoverOnlyAfterExpiry`) | T1, T2, T4, W1 (held up to the renewed expiry, granted at 1 540), K1 (held at 1 050, granted at 1 100), C1 |
| renew | `renewWriter` 516–523 through `asHolder` 321–341 | `HolderOp(renew)`; `Publication!Renew`, `RejectRenew` | T1–T4 × renew (refused), T* (successor renews), W1, W3; `DH: one live holder at a time…` |
| release | `releaseWriter` 525–530 | `HolderOp(release)`; `Publication!Release`, `RejectRelease` | T1–T4 × release, T3 (release then same-name reacquire before expiry); `DH: one live holder at a time…` |
| allocate | `allocateAttempt` 537–551 (new identity 546–548; stable key 540–545) | `HolderOp(allocate)`; `Publication!Allocate`, `RebindAttempt` | T* × allocate, K1, K2 (same key, same attempt), C1, C2; `DH: allocation commits a never-reused identity…`; `DH: stable keys identify one execution…`; `CR: a kill after/inside the allocation…` |
| stage | `stageAttempt` 553–574 | `HolderOp(stage)`; `Publication!Stage` | T* × stage, C1, C2; `DH: a staged attempt is not a completed result…`; `CR: a kill after/inside the staging…` |
| publish | `publishAttempt` 576–610 (completed re-publication 581–587) | `HolderOp(publish)`; `Publication!AtomicPublish`, `AbortPublish`, `RetryCompleted` | T* × publish, K1, K2, C1 (stale publish of a staged attempt), C2; `DH: a staged attempt is not a completed result, and publication installs everything in one commit`; `CR: a kill just before the publication commit…`; `CR: a kill after the publication commit but before acknowledgment…` |
| abandon | `abandonAttempt` 612–627 | `HolderOp(abandon)`; `Publication!Abandon` | T* × abandon; E1; `DH: allocation commits a never-reused identity before staging, including across abandonment and reopen`; `CR: an expired holder cannot … abandon …` |
| accept | `recordAcceptance` 674–692 | `HolderOp(accept)`; `Publication!Accept` | T* × accept, A1; `DH: candidates filter by compatibility version … rollback acceptance never rewinds current or rewrites provenance` |
| recover | `recoverAttempt` 629–638 | `WriterLease!Inspect`; `Publication!RetryCompleted`, `RebindAttempt` lookup | W2, K1, K2; `CR: a kill after the publication commit but before acknowledgment…` |
| inspection and exact reads | `currentWriter` 532–535, `readCurrent` 645–658, `readEnvelope` 660–667, `resolveResult` 254–276, reader | `WriterLease!Inspect`; `Publication!ReadExact` | W2 (clock made to fail; state byte-identical), R1, T* final reads; `DH: exact references resolve their own snapshot…` |
| clock high-water | `observeTime` 303–313, persisted inside every writer transaction | `WriterLease!Effective` in every action; abstracted to `Publication!Tick` | W1, W3, T4 (forward jump then regressed reading), T* (high-water never decreases); `DH: a backward host clock never evaluates before the persisted high-water…`; `DH: a forward jump can expire a lease early…` |
| process death | SIGKILL before or after a commit | `Publication!Crash`, `Restart`; in `WriterLease`, a process that stops acting | K1; the `CR:` kill matrix |
| acknowledgment | caller-side, outside History | `Publication!Ack` (ghost) | `CR: a kill after the publication commit but before acknowledgment…` |
| author body | Resolution/Supervision, not History | `Publication!Execute` | body-counter assertions in `CR:` publication-kill tests |

### Invariants

| Invariant | Enforced by | Named tests |
| --- | --- | --- |
| `GrantIssuesFreshFence`, `FenceNeverRegresses` | `safeSum(writer.lastFence, 1)` 504; release and renew write the presented fence only after `asHolder` has proved it current | C1 (fence = round), W1, W3, T* (fence strictly greater; writer row unchanged by a same-name stale renew); `CR: … successor gets a larger fence` |
| `TakeoverOnlyAfterExpiry` | `writer.expiresAt > now` → `held` (500) | W1, K1, C1 |
| `WaiterPreservesAuthorityState` | the `held` branch writes nothing but `observeTime` | W1 (all rows except the high-water equal; high-water = max(prior, reading)) |
| `InspectionChangesNothing` | read paths run no writer statement and no clock read | W2 (every row including the high-water equal, clock failing) |
| `EffectiveTimeNeverRegresses`, `EndedAuthorityNeverActs` | `observeTime` max 308; `asHolder` expiry check 330 | W3 (expired lease refused at a regressed reading; the next grant is evaluated at the high-water), T4; `DH: a backward host clock…` |
| `AcceptedByCurrentAuthority`, `PublicationUsedCurrentAuthority` | `asHolder` holder and fence 328, expiry 330, inside the IMMEDIATE transaction | T1–T4 (84 cases), C1, C2 (every accepted mutation presented a fence its own process was granted) |
| `RejectedPreservesAuthorityState`, `RejectedStaleMutationPreservesDurableState` | `asHolder` runs the operation only when authorized; a refusal commits only `observeTime` | T1–T4: writer row, sequences, attempts (state, fences, staged flag), results, current pointer and acceptances equal before and after every refusal |
| `StorageSeesNonDecreasingFences` | fencing plus SQLite write serialization | C1, C2 (attempt `allocated_fence` in identity order and result `published_fence` in publication order are non-decreasing) |
| `AtMostOneAuthority` | fence uniqueness | C1 (exactly one of four simultaneous acquirers wins each round), C2 (each fence granted exactly once) |
| `CurrentIsComplete`, `CompletedHistoryIsRetained` | `readCurrent` resolves exactly; immutability triggers in `schema.ts` | T* final reads; `DH: stored results and acceptances are immutable in storage`; `DH: candidate, current and dependency metadata reject…` |
| `AcknowledgedHistoryIsReadable`, `CompletedRetryKeepsReferenceAndSkipsBody` | stable key lookup; re-publication returns the existing reference | K2 (successor's re-publication returns the same locator); `CR: a kill after the publication commit but before acknowledgment…` |
| `DurableHighWaterNeverRegresses` | `history_sequences`, `history_writer.last_fence` | T* (sequences unchanged by refusals); `CR: a kill inside the allocation transaction … issues no identity`; `DH: allocation commits a never-reused identity…` |
| `ExactReferenceReadIsStable` | `resolveResult` never consults current | R1 (superseded result read exactly in a fresh process after every process closed), T* final reads |
| `EndedAttemptIsNeverAResult` | `abandonAttempt` state guard 621 and SQL `state IN ('allocated','staged')` | E1 (the current holder's abandonment of a completed attempt is refused and rolled back); `DH: allocation commits a never-reused identity before staging, including across abandonment and reopen` (a failed attempt cannot be staged or published; its identity is not reused) |
| `AcceptanceKeepsCurrentAndHistory` | `recordAcceptance` writes only acceptance rows | A1; `DH: candidates … rollback acceptance never rewinds current or rewrites provenance` |

### Gaps, with reasons

- **Operator deadline and typed writer-busy error.** These are not
  implemented; they are separate M5 work. The model represents waiting only
  as repeated `held` observations. The current refusal of an acquisition is
  the `held` outcome naming the holder and its expiry, and C1/C2 assert
  exactly that. When the error lands, it should be mapped as a process-local
  action that changes no durable state.
- **Permit pool and in-process member concurrency.** Members sharing one
  process's lease are outside both models and these tests, because the lease
  is per store and the pool is not implemented.
- **Liveness.** Neither model checks fairness. Nothing here proves that a
  waiter is eventually granted the lease or that a holder makes progress.
- **Author body and acknowledgment.** These belong to Resolution and
  Supervision. `Execute` and `Ack` are abstractions, covered by the M3
  body-counter tests, not by History code.
- **Transaction internals.** Both models treat each IMMEDIATE transaction as
  one step. The M3 kill matrix interrupts real transactions at their commit
  boundaries; no evidence steps individual SQL statements.
- **Publication-model time.** `Publication.tla` keeps the global monotonic
  tick. The clock policy is covered by `WriterLease.tla` and W1/W3/T4 instead.
  A combined model was not built. Both models represent the same shared
  `asHolder` guard, and the clock policy only decides whether that guard
  admits a lease; their interaction is exercised by T4 and W3.

## Earlier alignment findings against production History

The [2026-09-27 audit](exp7-exp3-alignment-2026-09-27.md) examined EXP-3. Each
finding is re-scoped here to production History.

1. **Death inside the allocation and staging transactions. Closed.** M3's
   production kill matrix already interrupts both transactions before commit.
   `CR: a kill inside the allocation transaction leaves no attempt and issues no identity`
   shows no attempt and the next identity equal to seed + 1.
   `CR: a kill inside the staging transaction leaves the attempt allocated without content`
   covers staging. Both use a real SIGKILL on a file-backed store.
2. **Stale rejection preserves the complete successor state. Closed.**
   - T1–T4 compare the full durable state, not just the holder, before and
     after each of the seven stale operations. They seed a non-empty current
     pointer and place B's work at three positions, including a staged but
     unpublished successor attempt.
   - The stale holder is a live process presenting its own lease object, and
     B then finishes, renews and keeps its fence.
   - Successful renewal and release postconditions are asserted by
     `DH: one live holder at a time; release keeps the fence advancing`, and by
     W1 (renewal extends expiry, same fence) and T3 (release, then a
     same-name reacquire gets a strictly larger fence).
3. **Staged-attempt recovery by a successor. Covered** (not required to close).
   These tests exercise it: `CR: a kill just before the publication commit publishes nothing; a later holder publishes without rerunning the body`,
   K1 with a waiter present during the kill, and K2 with a live stale holder
   refused throughout.
4. **Exact historical reference after reopen. Closed.** R1 closes every
   process, then reads the superseded seed in a fresh process: its label, its
   last part and a consistent index verification. Every T case re-reads the
   seed from this test process after all workers have closed. M3's
   `CR: a kill after the publication commit but before acknowledgment…` also
   reads the noncurrent seed after reopen.

## Deterministic interleavings checked

Every scenario uses long-lived worker processes (`concurrency/worker.ts`) over
one real SQLite file. Each worker has its own History handle and its own lease
objects, and uses a Machine clock whose reading the test sets per operation.
The test sends one command at a time to the worker it names, which fixes the
global order.

- **T1–T4 × seven operations × three positions (84 cases).** A holds
  `holder`/fence 1 from 1 000 (expiry 1 100) and does its legitimate work: it
  publishes the seed, allocates `a-allocated`, and allocates and stages
  `a-staged`. B then takes over. A presents its own stale lease for renew,
  release, allocate, stage (`a-allocated`), publish (`a-staged`), abandon
  (`a-staged`) or accept (seed). It does so after B acquires, after B stages,
  or after B publishes. The takeover kinds are:
  - T1: expiry, other holder name;
  - T2: expiry, same holder name, so only the fence distinguishes;
  - T3: A releases, then B reacquires under the same name while A's expiry is
    still ahead;
  - T4: B takes over at a forward-jumped reading (50 000) and A acts at a
    regressed reading (1 050) before its own recorded expiry.

  Every case asserts:
  - B's fence is strictly greater than A's;
  - A's operation fails with `StaleWriterError`;
  - all durable rows except the high-water are unchanged, and the high-water
    does not decrease;
  - B then publishes and renews under its own fence, evaluated at the
    high-water;
  - after every process closes, a fresh handle finds exactly the seed and B's
    result, both complete and index-consistent, with B's current. A's attempts
    are still allocated and staged, `a-after-takeover` is absent, and no
    acceptance exists.
- **W1.** A waiter observes the holder at four points of the holder's work.
  Each time it is told the holder and its current expiry, and nothing but the
  high-water changes. It takes over at expiry with the next fence.
- **W2.** A process with no lease runs `inspect`, `recover` (staged, completed,
  absent) and exact `read` while another holds the writer, with its clock
  failing. Every durable row, including the high-water, is byte-identical
  afterwards.
- **W3.** A's own operation at reading 5 000 is refused as expired. At 1 050,
  allocate and renew are still refused (no revival). B, reading 1 060,
  acquires with expiry 5 100, evaluated at the high-water.
- **K1.** A is SIGKILLed inside its publication commit while B waits. B is told
  A holds until 1 100, recovers `a-work` as staged (no partial result) and
  takes over with a larger fence. It then re-allocates `a-work` by key and
  gets the same attempt, staged. B publishes that attempt without restaging;
  its content reads back complete, and its `ended_fence` is B's.
- **K2.** B completes live stale A's staged attempt. A is refused before and
  after, including re-publication of the now completed attempt. B's
  re-publication returns the same reference.
- **R1.** A superseded exact reference is read in a fresh process after all
  processes closed.
- **A1.** A stale acceptance is refused. The successor's acceptance records
  its own fence and leaves current unchanged.
- **E1.** The current holder B names A's completed seed by its key and tries
  to abandon it. The attempt is refused with `AttemptStateError` and the
  transaction rolls back: every row, including the high-water, is unchanged,
  and the seed stays current and readable. An incomplete attempt is still
  abandoned normally. This closes the one mapping gap found while building the
  table: no existing test covered the guard behind
  `PublicationBad-abandon-completed.cfg`.

**Real concurrency.** Two tests cover simultaneous contention.

- **C1**, 10 rounds with a controlled clock. In each round four processes call
  `acquireWriter` at the same host instant through a barrier. Assertions:
  - exactly one wins, with fence = round and the expected expiry;
  - the other three receive `held` naming the winner and its expiry;
  - every process holding a lease object then mutates at one instant: the
    winner's allocation succeeds, and every stale holder's publication of its
    left-behind staged attempt fails with `StaleWriterError`;
  - storage fences are non-decreasing, and the ten results were published
    under fences 1–10;
  - all ten left-behind attempts remain staged.
- **C2**, 1.5 s with the host clock. Four processes loop. Each tenure publishes
  one attempt and stages another, renews, sleeps past its expiry and presents
  the lease again. Assertions:
  - every fence was granted exactly once, with no gap;
  - every refused acquisition names a real holder;
  - every refused mutation is `StaleWriterError`, with no untyped error such
    as `SQLITE_BUSY`;
  - every accepted mutation presented a fence its own process was granted;
  - storage fences are non-decreasing;
  - no post-expiry publication or allocation took effect;
  - contention actually occurred: at least two grants, one `held` and one
    stale refusal.

  Three separate probe runs of the C2 shape each gave 10 grants, about 1,350
  `held` observations, 60 accepted and 20 refused mutations. Every refusal
  was `StaleWriterError`.

## Test-first evidence and mutation controls

The suites were written before their driver and worker existed. The first
typecheck failed on the missing `./driver.js` module.

The first run against production then failed 81 of 94 tests. Workers opening
the same new file together died with `SQLITE_BUSY` during connection setup,
the defect recorded below. Opening a store initialized by the parent made all
94 pass. No assertion was changed after observing production behavior.
Before that first run, reviewing the draft suites against the contract, I
corrected two of my own expectations:

- A stale holder's refused operation persists its reading as the high-water,
  so B's next renewal is evaluated at the larger of its reading and A's.
  That follows the documented clock policy.
- A single stable key reused across C1 rounds would name one attempt.

Seven mutation controls, `concurrency/controls/controls.mjs`, plant one
weakened guard each into History's emitted build. Each corresponds to one
`WriterLease` fault. `node packages/core/test/concurrency/controls/concurrency-mutation-controls.mjs`
exited 0 with `baseline: 95 tests, 0 failing`, then:

| Control (model fault) | Failing tests | Examples |
| --- | --- | --- |
| holder guard ignores the fence (`holder-ignores-fence`) | 63 | T2/T3/T4 same-name stale renew, release, allocate, … |
| holder guard ignores lease expiry (`holder-ignores-expiry`) | 2 | W3; C2 |
| takeover reuses the previous fence (`takeover-without-fence`) | 90 | T1–T4 fence assertions; W1; C1 |
| acquisition takes over an unexpired holder (`acquire-ignores-expiry`) | 4 | W1; K1; C1; C2 |
| a waiter's observation advances the fence (`waiter-advances-fence`) | 3 | W1; C1; C2 |
| clock high-water ignored (`ignore-high-water`) | 85 | W3; T* renewal expectations evaluated at the high-water |
| renewal adopts the current fence (`renew-ignores-fence`) | 9 | T2/T3/T4 stale renew at every position |

The run ended `restored: 95 tests, 0 failing` and `PASS: 7 controls`. The
expiry control is caught deterministically by W3; C2 also catches it when a
stale tenure outlives its lease before any takeover. `controls.test.mjs` runs
in `npm test`. It checks that every anchor occurs exactly once in the current
build and that every control names a distinct model fault with a known-bad
configuration, so the controls cannot silently disarm between on-demand runs.

A one-off control for E1 (`scratch/abandon-guard-control.mjs`, not committed)
removed `abandonAttempt`'s state guard from the emitted build. E1 then failed:
the abandonment returned the unchanged completed record instead of refusing,
because the SQL predicate still blocked the write. The file was restored and
E1 passed again. That guard is a `Publication.tla` fault, not a writer guard,
so it is not in the writer-guard control list.

## Finding: simultaneous creation of a new store

When several processes open one nonexistent SQLite file at the same instant,
all but one usually fail in `@microdelta/machine-node`'s connection setup.
`driver.pragma('journal_mode = WAL')` (`packages/machine-node/src/node/sqlite.ts`,
`openConnection`) throws an untyped `SqliteError` `SQLITE_BUSY`,
"database is locked". This happens before History runs. The failure arrives
well inside the capability's 500 ms busy timeout; the committed reproduction
fails in about 40 ms. The busy wait is evidently not applied to switching a
new database to WAL. An existing store opens cleanly.

A local probe, `node scratch/probe-open.mjs <mode> <processes> 20` (not
committed; `store-open.test.ts` is the committed reproduction), gave:

| Mode | Processes | Trials with a failure | Failed opens |
| --- | --- | --- | --- |
| fresh file | 4 | 20 / 20 | 58 / 80 |
| fresh file | 2 | 19 / 20 | 19 / 40 |
| initialized store | 4 | 0 / 20 | 0 / 80 |

This matters for the owner's decision. Two runs started together against a
store that does not exist yet do not wait for the lease: one crashes with an
untyped host error. A retry succeeds because the file then exists. The fix
belongs to the Node Machine capability, for example serializing or retrying
the WAL switch on a new database. It is outside this issue's no-production-change
boundary, so it was not made.

`concurrency/store-open.test.ts` asserts the correct behavior. It checks
simultaneous opening of an initialized store with a plain test, which passes.
It checks simultaneous creation of a new store with `test.failing`, which
passes while the defect exists and will fail, prompting removal of the marker,
once it is fixed. The concurrency suites create each store from the parent
before starting workers, so they test History's protocol rather than store
creation.

## Other observations (no defect)

- **The waiter's durable footprint.** A `held` observation, and every refused
  mutation, persists the evaluated time as `time_high_water`. Nothing else
  changes. `contracts.ts` documents this clock policy. The model states the
  waiter property accordingly: authority and data are untouched, and the
  high-water may only rise. If "a waiter never mutates durable state" is meant
  literally, including the high-water, the protocol and the decision differ on
  this one field.
- **Renew and release rewrite the fence column.** They write the presented
  lease's fence into the writer row, which is safe only because `asHolder`
  proved it equal to the current fence. The `renew-ignores-fence`
  counterexample shows that weakening that check would regress the durable
  fence, and the Node control confirms it. Writing `last_fence` unchanged
  would be defense in depth; it is not needed for correctness.

## Commands and results

| Command | Result |
| --- | --- |
| `npm run clean && npm run build && npm run check && npm test` | exit 0. Tooling tests 332/332; facade Jest 33 suites, 466/466, including the three concurrency suites' 97 tests; facade control tests 10/10, including `controls.test.mjs`; every other workspace suite, tsd and experiment suite passed |
| `cd packages/core && npx tsc -p tsconfig.test.json && node --experimental-vm-modules ../../node_modules/jest/bin/jest.js --config jest.config.mjs --runInBand .test-build/test/concurrency` | 3 suites, 97 tests passed in about 10–11 s; three consecutive repeats passed 97/97 each |
| `node packages/core/test/concurrency/controls/concurrency-mutation-controls.mjs` | exit 0, `PASS: 7 controls` (table above) |
| TLC, each configuration (see [Toolchain](#toolchain)) | results table above |
| The EXP-7 README reproduction block, run verbatim with `sh` from the repository root | exit 0; 12 violations at the listed invariants and 5 exhausted runs, each with the counts in the results table |

## Limits

- **No multi-writer parallelism.** The protocol admits one fenced writer per
  store. SQLite serializes the IMMEDIATE transactions, and nothing here
  measures or permits concurrent writers.
- **No power loss, device or filesystem failure.** Process termination is
  SIGKILL on one local file with WAL and `synchronous=FULL`.
- **No distributed coordination.** There are no multiple hosts, network
  filesystems or distributed clocks. All processes read one host clock;
  backward and forward steps are simulated by the controlled clock and
  arbitrary model readings, not produced by a real host.
- **Finite, safety-only models.** TLC checked two or three processes, bounded
  fences, times and attempts, and no fairness or liveness. A waiter's
  eventual grant, holder progress and starvation freedom are unproven.
- **Unimplemented protocol parts.** The operator deadline, the typed
  writer-busy error and the permit pool are not implemented, so none are
  tested; the current acquisition refusal is `held`.
- **Contention bounds.** C1 and C2 used four processes and short transactions.
  Under heavier contention a transaction could wait past the Node capability's
  500 ms busy timeout and surface an untyped `SQLITE_BUSY` rather than a typed
  refusal. That was not observed here and is not ruled out.
- **Store creation.** Simultaneous creation of a new store fails as recorded
  above. The concurrency suites avoid it by design.
- **Schedule coverage.** C2's interleavings depend on the host scheduler. Its
  assertions hold for any schedule, but a given run exercises only the
  schedules it happens to produce. The deterministic families T/W/K/R/A and
  C1 carry the enumerated evidence.
- **Platform.** Evidence is local to Node v24.14.0 on macOS arm64; CI adds
  Node 20, 22 and 24 on its own hosts. Model checking ran on the stated JDK
  only.
