# M5 concurrency evidence: the single fenced writer across processes (issue #110)

This record rechecks the EXP-7 publication model against production durable
History (`packages/history/src/durable`). It adds a sibling model of the
owner-decided writer protocol and gives Node evidence about stale workers. A
stale worker cannot renew, release, allocate, stage, publish, abandon or accept
with its own lease object, and cannot stage, publish or abandon the attempt of
the holder that superseded it. The evidence comes from separate processes with
deterministic interleavings and from barrier-aligned contention whose overlap
is measured, as PUB-004 and the M5 exit require. The source base is
`7b05191` (`origin/main` on 2026-09-30). Local verification used Node v24.14.0
on macOS (arm64, 18 logical cores); CI runs Node 20, 22 and 24.

The owner's 2026-09-30 concurrency decision is taken as settled. It provides
one fenced writer per store and members running concurrently in-process under a
bounded permit pool. Other processes wait for the lease, taking over an expired
lease through fencing, until an operator deadline. After that deadline the
waiter fails with a typed writer-busy error naming the holder. Check and
inspection need no lease. This issue supplies evidence and a model for that
protocol. It does not implement the lease wait, the deadline, the writer-busy
error or the permit pool, and no production behavior changed. The
[writer-wait addendum](#addendum-lease-wait-operator-deadline-and-writer-busy-2026-09-30) records the later implementation of the lease wait, the deadline and
the writer-busy error.

PUB-006 (resource reporting that survives failed publication) is out of
scope: resource accounting has no History writer transition, and nothing here
models or tests it.

## Results at a glance

- **TLC.** Every good configuration exhausted its finite state graph with no
  violation. Every known-bad configuration (three for `Publication.tla`, eight
  for `WriterLease.tla`) stopped with exit 12 at a counterexample.
  Storage-only runs separate storage guards from lease-promise guards: only
  the fence guards protect storage.
- **Deterministic interleavings.** 103 enumerated stale-holder cases across
  separate processes, plus nine targeted scenarios, pass against production
  History:
  - four takeover kinds × seven operations × three positions of the
    successor's work;
  - seven expiry-branch cases before any takeover;
  - four takeover kinds × three operations on the successor's own staged
    attempt.
- **Real concurrency.** Four processes are released by a shared barrier. The
  measured start skew was at most 0.041 ms, and every round of 30 had two
  acquisitions inside History at once. Exactly one authority per fence, a
  typed refusal for every loser, and storage writes in non-decreasing fence
  order.
- **Mutation controls.** Ten code controls were each rejected by named tests:
  the required fence-check and expiry-check removals, the expiry boundary,
  the five other writer faults and two Publication faults. The restored build
  passed all 115 tests.
- **Earlier alignment findings.** Findings 1, 2 and 4 are closed against
  production History. Finding 3 is also covered.
- **Store creation.** Several processes creating the same new store at once
  was observed to fail in the Node SQLite capability. This is tracked as
  [#113](https://github.com/mike-north/microdelta/issues/113) and fixed by
  [PR #125](https://github.com/mike-north/microdelta/pull/125). This PR carries
  no test for it. See [the store-creation observation](#observation-simultaneous-creation-of-a-new-store).

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

Every run used one worker, with `JAVA` set to the JDK's `java` as a path
relative to the repository root:

- macOS layout: `scratch/tla-toolchain/jdk-17.0.20.1+1/Contents/Home/bin/java`;
- Linux layout: `scratch/tla-toolchain/jdk-17.0.20.1+1/bin/java`.

From `experiments/exp-7`, each run was
`../../"$JAVA" -cp ../../scratch/tla-toolchain/tla2tools.jar tlc2.TLC -workers 1 -metadir "../../scratch/tlc-meta/<name>" -config <cfg> <model>.tla`.
The [EXP-7 README](../../experiments/exp-7/README.md#reproduction) gives the
full loop, which was run verbatim for the final numbers below.

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
    accept), which treats a lease as expired from its recorded expiry onwards;
  - inspection needs no lease (`Inspect`);
  - "now" is the larger of an arbitrary host reading and the persisted
    high-water, persisted by every writer transaction, including refusals and
    `held` observations.

  Its invariants are split in two:
  - storage safety: `AcceptedFromLatestGrant`,
    `StorageSeesNonDecreasingFences`, `AtMostOneAuthority`,
    `FenceNeverRegresses`, `RejectedPreservesAuthorityState`;
  - the lease promise and direct protocol statements: `AcceptedWithinLease`,
    `EndedAuthorityNeverActs`, `EffectiveTimeNeverRegresses`,
    `GrantIssuesFreshFence`, `TakeoverOnlyAfterExpiry`,
    `WaiterPreservesAuthorityState`, `InspectionChangesNothing`.

  Its eight known-bad faults are:
  - takeover without a fence increment;
  - renewal accepted from a stale fence;
  - the holder guard without its fence check;
  - the holder guard without its expiry check;
  - the holder guard treating the expiry instant as still live;
  - takeover of an unexpired holder;
  - a waiter's observation that advances the fence;
  - an ignored high-water.

### TLC results

The final run of every configuration was the README's reproduction block run
verbatim with `sh`. Its log was local and is not committed; the counts below
reproduce from that block. `WriterLease.cfg` uses two
processes, two holder names, fences 0–3, host readings 0–3 and lease length 2.
`Publication.cfg` keeps the EXP-7 bounds.

| Configuration | Fault | Kind | Exit | Generated | Distinct | Depth | Result |
| --- | --- | --- | --- | --- | --- | --- | --- |
| `Publication.cfg` | none | — | 0 | 44,070,530 | 3,836,999 | 24 | no violation; graph exhausted |
| `PublicationBad.cfg` | omit-publish-fence | storage | 12 | 65,681 | 18,886 | 8 | `PublicationUsedCurrentAuthority` |
| `PublicationBad-abandon-completed.cfg` | abandon-completed | storage (retained history) | 12 | 16 | 16 | 3 | `CurrentIsComplete` |
| `PublicationBad-accept-moves-current.cfg` | accept-moves-current | restating | 12 | 17,978 | 6,085 | 7 | `AcceptanceKeepsCurrentAndHistory` |
| `PublicationConsequence-accept-moves-current.cfg` | accept-moves-current | restating | 0 | 81,829,654 | 6,801,263 | 24 | no retained-history violation |
| `WriterLease.cfg` (2 processes) | none | — | 0 | 4,133,247 | 69,779 | 10 | no violation; graph exhausted |
| `WriterLeaseThreeProcesses.cfg` | none | — | 0 | 29,429,491 | 382,168 | 10 | no violation; graph exhausted |
| `WriterLeaseBad-takeover-without-fence.cfg` | takeover-without-fence | storage | 12 | 20 | 20 | 3 | `GrantIssuesFreshFence` |
| `WriterLeaseBad-renew-ignores-fence.cfg` | renew-ignores-fence | storage | 12 | 864 | 470 | 4 | `AcceptedFromLatestGrant` |
| `WriterLeaseBad-holder-ignores-fence.cfg` | holder-ignores-fence | storage | 12 | 854 | 460 | 4 | `AcceptedFromLatestGrant` |
| `WriterLeaseBad-holder-ignores-expiry.cfg` | holder-ignores-expiry | lease promise | 12 | 50 | 46 | 3 | `AcceptedWithinLease` |
| `WriterLeaseBad-holder-expiry-inclusive.cfg` | holder-expiry-inclusive | lease promise | 12 | 50 | 46 | 3 | `AcceptedWithinLease` |
| `WriterLeaseBad-acquire-ignores-expiry.cfg` | acquire-ignores-expiry | lease promise | 12 | 36 | 20 | 3 | `TakeoverOnlyAfterExpiry` |
| `WriterLeaseBad-waiter-advances-fence.cfg` | waiter-advances-fence | lease promise | 12 | 28 | 28 | 3 | `WaiterPreservesAuthorityState` |
| `WriterLeaseBad-ignore-high-water.cfg` | ignore-high-water | lease promise | 12 | 208 | 192 | 3 | `EffectiveTimeNeverRegresses` |
| `WriterLeaseConsequence-takeover-without-fence.cfg` | takeover-without-fence | storage | 12 | 21 | 21 | 3 | `AtMostOneAuthority` |
| `WriterLeaseConsequence-holder-ignores-expiry.cfg` | holder-ignores-expiry | lease promise | 0 | 4,583,599 | 76,507 | 10 | no storage-safety violation |
| `WriterLeaseConsequence-holder-expiry-inclusive.cfg` | holder-expiry-inclusive | lease promise | 0 | 4,591,007 | 76,755 | 10 | no storage-safety violation |
| `WriterLeaseConsequence-acquire-ignores-expiry.cfg` | acquire-ignores-expiry | lease promise | 0 | 4,185,687 | 67,235 | 8 | no storage-safety violation |
| `WriterLeaseConsequence-waiter-advances-fence.cfg` | waiter-advances-fence | lease promise | 0 | 4,641,583 | 82,739 | 10 | no storage-safety violation |
| `WriterLeaseConsequence-ignore-high-water.cfg` | ignore-high-water | lease promise | 0 | 28,185,223 | 464,351 | 11 | no storage-safety violation |

Generated and distinct counts of a stopped run are TLC's counts at the stop,
not an exhausted graph. Every count above was identical in each run of the
same configuration and model. The final run shared the machine with the full
gate, so its times are indicative: the good runs took 3 min 48 s (`Publication.cfg`),
18 s (`WriterLease.cfg`) and 1 min 45 s (three processes); the storage-only
runs took 8 min 1 s (`PublicationConsequence-accept-moves-current.cfg`),
2 min 4 s (`ignore-high-water`) and 13–19 s (the other exhausting ones); every
known-bad run took about a second.

**How to read the kinds.**

- A *storage* guard's defect lets a superseded writer change storage.
- A *lease-promise* guard's defect breaks the holder's lease or the clock
  policy, but a superseded writer is still refused by the fence, so storage
  stays safe. The storage-only `WriterLeaseConsequence-*` runs check exactly
  that. Each omits the lease-promise and protocol invariants, and five of the
  six exhaust.
- A *restating* guard is caught by an invariant that restates it. Accepting
  an older result and rewinding the current pointer breaks RES-007's
  acceptance semantics. It does not break retained-history integrity; the
  storage-only Publication run exhausts.

So storage safety rests on the fence guards: `takeover-without-fence`,
`renew-ignores-fence`, `holder-ignores-fence` and `omit-publish-fence`. The
expiry, boundary, waiter and high-water guards keep the owner's lease promise.

### Counterexamples

Shortest traces reported by TLC. `w` is a holder name, `w`/1 a lease of that
name with fence 1; `P1` and `P2` are processes; `hw` is the persisted clock
high-water.

- **takeover-without-fence.** P1 is granted `w`/1, expiry 2. At reading 2 the
  lease has expired and a new grant keeps fence 1. In the storage-only run
  that grant goes to P2, and both processes then hold a `w`/1 lease object the
  row accepts (`AtMostOneAuthority`).
- **renew-ignores-fence.** P1 is granted `w`/1. At reading 2, P2 is granted
  `w`/2. P1 renews with its stale `w`/1 lease; the renewal is accepted and
  writes fence 1 back into the writer row, so the durable fence regresses
  from 2 to 1.
- **holder-ignores-fence.** P1 `w`/1, then P2 `w`/2 at reading 2. P1's
  `allocate` with fence 1 is accepted while P2 holds the lease.
- **holder-ignores-expiry** and **holder-expiry-inclusive** share one trace.
  P1 is granted `w`/1, expiry 2. P1's `allocate` at reading 2, the expiry
  instant itself, is accepted.
- **acquire-ignores-expiry.** P1 `w`/1, expiry 2. At reading 0 a second grant
  (fence 2) takes over the unexpired lease.
- **waiter-advances-fence.** P1 `w`/1. A `held` observation advances the durable
  fence to 2, invalidating the live holder.
- **ignore-high-water.** P1 is granted at reading 1 (hw 1). A `held`
  observation at reading 0 persists hw 0, so evaluated time regresses.
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
the same grant-then-release trace. The invariant was wrong, not the protocol:
a legitimate release added its own fence to the ended set in the same step
and was then judged by it. The witness now records whether the presented
fence had ended at evaluation, before the step's effect. All configurations
were rerun after the correction. No other model or configuration error
occurred.

## Model→code→test mapping

Code locations are in `packages/history/src/durable/index.ts` unless noted.
Tests are in `packages/core/test/`:

- `concurrency/interleavings.test.ts`: `T0`–`T4`, `O1`–`O4`, `W1`–`W4`, `K1`,
  `K2`, `R1`, `A1`, `E1`;
- `concurrency/contention.test.ts`: `C1`, `C2`;
- `durable-history/durable-history.test.ts`: `DH:`;
- `durable-history/crash-recovery.test.ts`: `CR:`.

The classification column uses PUB-004's terms for the correspondence among
model, code and tests: aligned, divergent, missing, insufficient or ambiguous.

### Production transitions and model actions

| Production transition | Code | Model action | Named tests | Classification |
| --- | --- | --- | --- | --- |
| acquire (grant) | `acquireWriter` 493–514: expiry check 500, next fence 504 | `WriterLease!Grant`; `Publication!Acquire`, `Reclaim` | T0–T4 (successor fence > A's), W1, W3, W4, K1, C1 (fence = round), C2; `DH: one live holder at a time; release keeps the fence advancing`; `CR: a kill after acquisition leaves the lease until expiry, then a successor gets a larger fence` | aligned |
| acquire (held, waiter) | `acquireWriter` 500–503, `observeTime` 303–313 | `WriterLease!Held`; `Publication!Held` | W1 (every point of the holder's work), W4 (one millisecond before expiry), K1, C1 (losers told the winner and its expiry), C2 | aligned. The waiter persists the clock high-water; see "The waiter's durable footprint". |
| reacquire after expiry | `acquireWriter` 500, 504 | `Grant` with a prior holder (`TakeoverOnlyAfterExpiry`) | T0, T1, T2, T4, W1 (granted at 1 540), W4 (granted at the expiry instant 1 100), K1 (held at 1 050, granted at 1 100), C1 | aligned |
| renew | `renewWriter` 516–523 through `asHolder` 321–341 | `HolderOp(renew)`; `Publication!Renew`, `RejectRenew` | T0–T4 × renew (refused), T*/O* (successor renews), W1, W3, W4; `DH: one live holder at a time…` | aligned |
| release | `releaseWriter` 525–530 | `HolderOp(release)`; `Publication!Release`, `RejectRelease` | T0–T4 × release, T3 (release then same-name reacquire before expiry); `DH: one live holder at a time…` | aligned |
| allocate | `allocateAttempt` 537–551 (new identity 546–548; stable key 540–545) | `HolderOp(allocate)`; `Publication!Allocate`, `RebindAttempt` | T0–T4 × allocate, W4, K1, K2 (same key, same attempt), E1, C1, C2; `DH: allocation commits a never-reused identity…`; `DH: stable keys identify one execution…`; `CR: a kill after/inside the allocation…` | aligned |
| stage | `stageAttempt` 553–574 | `HolderOp(stage)`; `Publication!Stage` | T0–T4 × stage, O1–O4 × stage (B's attempt), C1, C2; `DH: a staged attempt is not a completed result…`; `CR: a kill after/inside the staging…` | aligned |
| publish | `publishAttempt` 576–610 (completed re-publication 581–587) | `HolderOp(publish)`; `Publication!AtomicPublish`, `AbortPublish`, `RetryCompleted` | T0–T4 × publish, O1–O4 × publish (B's attempt), K1, K2, C1 (stale publish of a staged attempt), C2; `DH: a staged attempt is not a completed result, and publication installs everything in one commit`; `CR: a kill just before the publication commit…`; `CR: a kill after the publication commit but before acknowledgment…` | aligned |
| abandon | `abandonAttempt` 612–627 | `HolderOp(abandon)`; `Publication!Abandon` | T0–T4 × abandon, O1–O4 × abandon (B's attempt), E1; `DH: allocation commits a never-reused identity before staging, including across abandonment and reopen`; `CR: an expired holder cannot … abandon …` | aligned |
| accept | `recordAcceptance` 674–692 | `HolderOp(accept)`; `Publication!Accept` | T0–T4 × accept, A1; `DH: candidates filter by compatibility version … rollback acceptance never rewinds current or rewrites provenance` | aligned |
| recover | `recoverAttempt` 629–638 | `WriterLease!Inspect`; `Publication!RetryCompleted`, `RebindAttempt` lookup | W2, K1, K2; `CR: a kill after the publication commit but before acknowledgment…` | aligned |
| inspection and exact reads | `currentWriter` 532–535, `readCurrent` 645–658, `readEnvelope` 660–667, `resolveResult` 254–276, reader | `WriterLease!Inspect`; `Publication!ReadExact` | W2 (clock made to fail; compared rows identical), R1, T*/O* final reads; `DH: exact references resolve their own snapshot…` | aligned |
| clock high-water | `observeTime` 303–313, persisted inside every writer transaction | `WriterLease!Effective` in every action; abstracted to `Publication!Tick` | W1, W3, W4, T4 (forward jump then regressed reading), T* (high-water never decreases); `DH: a backward host clock never evaluates before the persisted high-water…`; `DH: a forward jump can expire a lease early…` | aligned |
| process death | SIGKILL before or after a commit | `Publication!Crash`, `Restart`; in `WriterLease`, a process that stops acting | K1; the `CR:` kill matrix | aligned |
| acknowledgment | caller-side, outside History | `Publication!Ack` (ghost) | `CR: a kill after the publication commit but before acknowledgment…` | aligned; abstracted outside History |
| author body | Resolution/Supervision, not History | `Publication!Execute` | body-counter assertions in `CR:` publication-kill tests | aligned; abstracted outside History |
| lease wait, operator deadline and typed writer-busy error | not implemented when this record was made | none beyond repeated `Held` | none; the refusal was `held` (C1, C2) | missing then; now aligned, see the [writer-wait addendum](#addendum-lease-wait-operator-deadline-and-writer-busy-2026-09-30) |
| permit pool (in-process members under one lease) | not implemented | none | none | missing (separate M5 work) |

### Invariants

| Invariant | Enforced by | Named tests | Classification |
| --- | --- | --- | --- |
| `GrantIssuesFreshFence`, `FenceNeverRegresses` | `safeSum(writer.lastFence, 1)` 504; release and renew write the presented fence only after `asHolder` has proved it current | C1 (fence = round), W1, W3, W4, T* (fence strictly greater; writer row unchanged by a same-name stale renew); `CR: … successor gets a larger fence` | aligned |
| `TakeoverOnlyAfterExpiry` | `writer.expiresAt > now` → `held` (500) | W1, W4, K1, C1 | aligned |
| `WaiterPreservesAuthorityState` | the `held` branch writes nothing but `observeTime` | W1 (compared rows except the high-water equal; high-water = max(prior, reading)), W4 | ambiguous: whether the decision's "a waiter never mutates durable state" admits the high-water write |
| `InspectionChangesNothing` | read paths run no writer statement and no clock read | W2 (every compared row including the high-water equal, clock failing) | aligned |
| `AcceptedWithinLease`, `EndedAuthorityNeverActs` | `asHolder` expiry check 330 (`expiresAt <= now`) | T0 (refusal message names the expiry), W4 (refused exactly at the expiry instant, accepted one millisecond earlier), W3 (never revived at a regressed reading); `DH: a backward host clock…` | aligned |
| `EffectiveTimeNeverRegresses` | `observeTime` max 308 | W3, W4, T4; `DH: a backward host clock…` | aligned |
| `AcceptedFromLatestGrant`, `PublicationUsedCurrentAuthority` | `asHolder` holder and fence 328, inside the IMMEDIATE transaction | T1–T4 (84 cases) and O1–O4 (12 cases), whose refusal messages name the stale holder, not expiry; C1, C2 (every accepted mutation presented a fence its own process was granted) | aligned |
| `RejectedPreservesAuthorityState`, `RejectedStaleMutationPreservesDurableState` | `asHolder` runs the operation only when authorized; a refusal commits only `observeTime` | T0–T4, O1–O4: writer row, sequences, attempts (state, fences, staged flag), results, current pointer and acceptances equal before and after every refusal | aligned |
| `StorageSeesNonDecreasingFences` | fencing plus SQLite write serialization | C1, C2 (attempt `allocated_fence` in identity order and result `published_fence` in publication order are non-decreasing) | aligned |
| `AtMostOneAuthority` | fence uniqueness | C1 (exactly one of four barrier-aligned acquirers wins each round), C2 (each fence granted exactly once) | aligned |
| `CurrentIsComplete`, `CompletedHistoryIsRetained` | `readCurrent` resolves exactly; immutability triggers in `schema.ts` | T*/O* final reads; `CR: a kill inside the staging transaction…` (prior current intact); `DH: stored results and acceptances are immutable in storage`; `DH: candidate, current and dependency metadata reject…` | aligned |
| `AcknowledgedHistoryIsReadable`, `CompletedRetryKeepsReferenceAndSkipsBody` | stable key lookup; re-publication returns the existing reference | K2 (successor's re-publication returns the same locator); `CR: a kill after the publication commit but before acknowledgment…` | aligned |
| `DurableHighWaterNeverRegresses` | `history_sequences`, `history_writer.last_fence` | T*/O* (sequences unchanged by refusals); `CR: a kill inside the allocation transaction … issues no identity`; `DH: allocation commits a never-reused identity…` | aligned |
| `ExactReferenceReadIsStable` | `resolveResult` never consults current | R1 (superseded result read exactly in a fresh process after every process closed), T*/O* final reads | aligned |
| `EndedAttemptIsNeverAResult` | `abandonAttempt` state guard 621 and SQL `state IN ('allocated','staged')` | E1 (the current holder's abandonment of a completed attempt is refused and rolled back); `DH: allocation commits a never-reused identity before staging, including across abandonment and reopen` | aligned |
| `AcceptanceKeepsCurrentAndHistory` | `recordAcceptance` writes only acceptance rows | A1; `DH: candidates … rollback acceptance never rewinds current or rewrites provenance` | aligned |
| liveness (a waiter is eventually granted; a holder makes progress) | not modeled | none | missing: no fairness in either model; bounded waiting is now tested, see the [writer-wait addendum](#addendum-lease-wait-operator-deadline-and-writer-busy-2026-09-30) |

### Gaps, with reasons

- **Operator deadline and typed writer-busy error.** These were not
  implemented when this record was made; the [writer-wait addendum](#addendum-lease-wait-operator-deadline-and-writer-busy-2026-09-30) maps them. The model represents waiting only
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
  tick. The clock policy is covered by `WriterLease.tla` and W1/W3/W4/T4
  instead. A combined model was not built. Both models represent the same
  shared `asHolder` guard, and the clock policy only decides whether that
  guard admits a lease; their interaction is exercised by T0, T4, W3 and W4.

## Earlier alignment findings against production History

The [2026-09-27 audit](exp7-exp3-alignment-2026-09-27.md) examined EXP-3. Each
finding is re-scoped here to production History.

1. **Death inside the allocation and staging transactions. Closed.** M3's
   production kill matrix already interrupts both transactions before commit,
   with a real SIGKILL on a file-backed store.
   - `CR: a kill inside the allocation transaction leaves no attempt and issues no identity`
     shows no attempt and the next identity equal to seed + 1.
   - `CR: a kill inside the staging transaction leaves the attempt allocated without content`
     now also asserts that the prior current result and the result count are
     intact.
2. **Stale rejection preserves the successor state. Closed.**
   - T0–T4 and O1–O4 compare a projection of durable state before and after
     each stale operation. The projection covers the writer row, the
     sequences, every attempt's state, fences and staged flag, every result's
     publication and fence, the current pointers and the acceptances. The
     comparison seeds a non-empty current pointer and includes a staged but
     unpublished successor attempt. The projection does not compare payload
     or index bytes; the final exact reads and index verification cover
     those.
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
   last part and a consistent index verification. Every T and O case re-reads
   the seed from the test process after all workers have closed. M3's
   `CR: a kill after the publication commit but before acknowledgment…` also
   reads the noncurrent seed after reopen.

## Deterministic interleavings checked

Every scenario uses long-lived worker processes (`concurrency/worker.ts`) over
one real SQLite file. Each worker has its own History handle and its own lease
object, and uses a Machine clock whose reading the test sets per operation.
The test sends one command at a time to the worker it names, which fixes the
global order.

In every T and O case, A first holds a lease from 1 000 (expiry 1 100). It
publishes the seed, allocates `a-allocated`, and allocates and stages
`a-staged`. The enumeration varies these dimensions:

- **T1–T4: takeover kind × seven operations × three positions (84 cases).**
  B takes over, then A presents its own stale lease for renew, release,
  allocate, stage (`a-allocated`), publish (`a-staged`), abandon (`a-staged`)
  or accept (seed). It does so after B acquires, after B stages or after B
  publishes. The takeover kinds are:
  - T1: expiry, other holder name;
  - T2: expiry, same holder name, so only the fence distinguishes;
  - T3: A releases, then B reacquires under the same name while A's expiry is
    still ahead;
  - T4: B takes over at a forward-jumped reading (50 000) and A acts at a
    regressed reading (1 050) before its own recorded expiry.

  The refusal message must name the stale holder (`is not the current
  holder`), which is the guard's holder-and-fence branch.
- **T0: the seven operations before any takeover (7 cases).** A acts at 1 160
  after its lease expired, while it is still the recorded holder with the
  current fence. Only the expiry branch can refuse it, and the message must
  say `expired at 1100`. B then takes over at 1 170.
- **O1–O4: takeover kind × three operations on B's attempt (12 cases).** At
  the "after B stages" position, stale A names B's staged `b-work` by its
  attempt identity and tries to stage, publish or abandon it. This is the
  literal "on behalf of another holder" case. It must be refused by the
  holder-and-fence branch, and B must still publish its own content.

Every T and O case asserts:

- B's fence is strictly greater than A's;
- A's operation fails with `StaleWriterError` from the expected branch;
- the compared projection of durable state is unchanged, and the high-water
  does not decrease;
- B then publishes and renews under its own fence, evaluated at the
  high-water;
- after every process closes, a fresh handle finds exactly the seed and B's
  result, both complete and index-consistent, with B's current. A's attempts
  are still allocated and staged, `a-after-takeover` is absent, and no
  acceptance exists.

The targeted scenarios:

- **W1.** A waiter observes the holder at four points of the holder's work.
  Each time it is told the holder and its current expiry, and nothing but the
  high-water changes. It takes over at expiry with the next fence.
- **W2.** A process with no lease runs `inspect`, `recover` (staged, completed,
  absent) and exact `read` while another holds the writer, with its clock
  failing. Every compared row, including the high-water, is identical
  afterwards.
- **W3.** A's own operation at reading 5 000 is refused as expired. At 1 050,
  allocate and renew are still refused (no revival). B, reading 1 060,
  acquires with expiry 5 100, evaluated at the high-water.
- **W4.** The expiry boundary. With expiry 1 100, A allocates at 1 099. At
  1 100 its allocate and renew are refused with `expired at 1100` and nothing
  but the high-water changes. B, `held` at 1 099, acquires at 1 100 with the
  next fence.
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
  transaction rolls back: every compared row, including the high-water, is
  unchanged, and the seed stays current and readable. An incomplete attempt
  is still abandoned normally.

**Real concurrency.** Workers are released by a barrier on the host's
system-wide monotonic clock (`process.hrtime`). Each sleeps until 10 ms
before the barrier and then spins. Every reply reports when its operation ran
on that same clock, so overlap is measured, not assumed.

- **C1**, 10 rounds with a controlled History clock. Four processes call
  `acquireWriter` at each barrier. Assertions:
  - exactly one wins, with fence = round and the expected expiry;
  - the other three receive `held` naming the winner and its expiry;
  - every process holding a lease object then mutates at the next barrier:
    the winner's allocation succeeds, and every stale holder's publication of
    its left-behind staged attempt fails with `StaleWriterError`;
  - storage fences are non-decreasing, and the ten results were published
    under fences 1–10;
  - all ten left-behind attempts remain staged;
  - in at least one round two acquisitions overlapped inside History.
- **C2**, 1.5 s with the host clock as History's clock. Four processes loop.
  Each tenure publishes one attempt and stages another, renews, sleeps past
  its expiry and presents the lease again. Assertions:
  - the loops overlapped for more than 1 s;
  - every fence was granted exactly once, with no gap;
  - every refused acquisition names a real holder;
  - every refused mutation is `StaleWriterError`, with no untyped error such
    as `SQLITE_BUSY`;
  - every accepted mutation presented a fence its own process was granted;
  - storage fences are non-decreasing;
  - no post-expiry publication or allocation took effect;
  - contention actually occurred: at least two grants, one `held` and one
    stale refusal.

`node packages/core/test/concurrency/controls/contention-probe.mjs 3` measures
the same shapes. Across three runs:

| Measure | Run 1 | Run 2 | Run 3 |
| --- | --- | --- | --- |
| C1 start skew (min / median / max) | 0.000 / 0.000 / 0.041 ms | 0.000 / 0.000 / 0.036 ms | 0.000 / 0.000 / 0.029 ms |
| C1 rounds with two acquisitions inside History at once | 10 / 10 | 10 / 10 | 10 / 10 |
| C1 longest overlap | 3.969 ms | 4.375 ms | 4.274 ms |
| C1 winners per round | 1 | 1 | 1 |
| C2 grants / `held` observations | 10 / 1,409 | 10 / 1,408 | 10 / 1,404 |
| C2 accepted / refused mutations | 60 / 20 | 60 / 20 | 60 / 20 |
| C2 refusal classes | `StaleWriterError` | `StaleWriterError` | `StaleWriterError` |
| C2 loop start skew / overlap | 0.002 / 1,503.866 ms | 0.033 / 1,502.575 ms | 0.000 / 1,506.973 ms |

An earlier version of the barrier timed operations with
`performance.timeOrigin + performance.now()` and slept to within 2 ms of the
barrier. It measured a median skew near 2 ms. Two things contributed: each
process fixes `timeOrigin` at its own start, and the timed sleep overshoots
when the host coalesces timers. The shared monotonic clock and the 10 ms
spin window removed both.

## Test-first evidence and mutation controls

**First round.**

- The suites were written before their driver and worker existed; the first
  typecheck failed on the missing `./driver.js` module.
- The first run against production then failed 81 of 94 tests: workers
  creating the same new file together died during connection setup (see the
  store-creation observation). With stores initialized by the parent, all 94
  passed.
- No assertion was changed after observing production behavior. Before that
  first run, reviewing the draft suites against the contract, I corrected two
  of my own expectations:
  - a stale holder's refused operation persists its reading as the
    high-water, so B's next renewal is evaluated at the larger of its reading
    and A's;
  - a single stable key reused across C1 rounds would name one attempt.

**Second round**, after supervisor review.

- The new protocol (explicit attempt identity, reply timing) first failed to
  typecheck against the unchanged worker.
- With only timing added to the worker, the 12 O-family cases failed at
  runtime, because a worker could not yet name another holder's attempt.
- W4 and T0 passed against production from the start, and so did the
  strengthened staging-kill assertion. Their sensitivity is shown by the
  controls below.

Ten mutation controls in `concurrency/controls/controls.mjs` each plant one
weakened guard into History's emitted build, and each names its model fault.
The command was `node packages/core/test/concurrency/controls/concurrency-mutation-controls.mjs`,
after `npm run build` and `npm run test:unit --workspace microdelta`. It
exited 0 with `baseline: 115 tests, 0 failing`, then:

| Control (model fault) | Failing tests | Examples |
| --- | --- | --- |
| holder guard ignores the fence (`holder-ignores-fence`) | 72 | T2/T3/T4 same-name stale operations (63); O2–O4 (9) |
| holder guard ignores lease expiry (`holder-ignores-expiry`) | 10 | T0 × all seven operations; W3; W4; C2 |
| holder guard treats the expiry instant as still live (`holder-expiry-inclusive`) | 1 | W4 |
| takeover reuses the previous fence (`takeover-without-fence`) | 110 | every T0–T4 and O1–O4 case (103); W1; W3; W4; K1; K2; C1; C2 |
| acquisition takes over an unexpired holder (`acquire-ignores-expiry`) | 5 | W1; W4; K1; C1; C2 |
| a waiter's observation advances the fence (`waiter-advances-fence`) | 4 | W1; W4; C1; C2 |
| clock high-water ignored (`ignore-high-water`) | 97 | W3; every T1–T4 and O1–O4 case (96), whose successor renewal is evaluated at the high-water |
| renewal adopts the current fence (`renew-ignores-fence`) | 9 | T2/T3/T4 stale renew at every position |
| abandonment ends a completed attempt (`Publication` `abandon-completed`) | 1 | E1 |
| recording an acceptance rewinds the current pointer (`Publication` `accept-moves-current`) | 1 | A1 |

The run ended `restored: 115 tests, 0 failing` and `PASS: 10 controls`.

- The abandonment control weakens both layers, the lifecycle check and the
  SQL state predicate, so the planted build really ends a completed attempt.
- `omit-publish-fence` keeps its code control ("publication ignores the
  fence") in `durable-history/controls/history-mutation-controls.mjs`.
- `controls.test.mjs` runs in `npm test`. It checks that every anchor occurs
  exactly once in the current build and that planting changes it. It also
  checks that every control names a distinct model fault with a known-bad
  configuration, so the controls cannot silently disarm between on-demand
  runs.

## Observation: simultaneous creation of a new store

This belongs to the Node SQLite capability, not History. It is tracked as
[#113](https://github.com/mike-north/microdelta/issues/113) and fixed by
[PR #125](https://github.com/mike-north/microdelta/pull/125), which adds a
bounded retry of the WAL setup, a typed `SqliteBusyError` and a core-level
store-open test. This PR carries no test for it; the concurrency suites create
each store from the parent before starting workers.

**Observed symptom.** Several processes opened one nonexistent SQLite file at
the same instant. All but one usually failed in `@microdelta/machine-node`'s
connection setup: `driver.pragma('journal_mode = WAL')`
(`packages/machine-node/src/node/sqlite.ts`, `openConnection`) threw an
untyped `SqliteError` `SQLITE_BUSY`, "database is locked", before History ran.
The failures arrived well inside the capability's 500 ms busy timeout. An
already initialized store opened cleanly in every process.

A local probe, not committed, gave these counts. They are not reproducible
from this repository; #113 carries the reproduction.

| Mode | Processes | Trials with a failure | Failed opens |
| --- | --- | --- | --- |
| fresh file | 4 | 20 / 20 | 58 / 80 |
| fresh file | 2 | 19 / 20 | 19 / 40 |
| initialized store | 4 | 0 / 20 | 0 / 80 |

**Hypothesis, not established here.** The busy wait does apply to the WAL
switch when another connection merely holds a shared lock. The fast failure
under concurrent creation is more likely SQLite declining to invoke the busy
handler during a lock escalation that could deadlock, so it returns
`SQLITE_BUSY` at once.

## Other observations (no defect)

- **The waiter's durable footprint.** A `held` observation, and every refused
  mutation, persists the evaluated time as `time_high_water`. Nothing else
  changes. `contracts.ts` documents this clock policy. The model states the
  waiter property accordingly: authority and data are untouched, and the
  high-water may only rise. If "a waiter never mutates durable state" is meant
  literally, including the high-water, the protocol and the decision differ on
  this one field. The mapping classifies it as ambiguous.
- **Renew and release rewrite the fence column.** They write the presented
  lease's fence into the writer row, which is safe only because `asHolder`
  proved it equal to the current fence. The `renew-ignores-fence`
  counterexample shows that weakening that check would regress the durable
  fence, and the Node control confirms it. Writing `last_fence` unchanged
  would be defense in depth; it is not needed for correctness.

## Commands and results

| Command | Result |
| --- | --- |
| `npm run clean && npm run build && npm run check && npm test` | exit 0. Tooling tests 332/332; facade Jest 32 suites, 484/484, including the concurrency suites' 115 tests and the strengthened staging-kill test; facade control tests 10/10, including `controls.test.mjs`; every other workspace suite, tsd and experiment suite passed |
| `npm run build && npm run test:unit --workspace microdelta`, then `cd packages/core && node --experimental-vm-modules ../../node_modules/jest/bin/jest.js --config jest.config.mjs --runInBand .test-build/test/concurrency`, three times | 115/115 in each of three consecutive runs, about 13 s each |
| `node packages/core/test/concurrency/controls/concurrency-mutation-controls.mjs`, after the build and facade test build | exit 0, `PASS: 10 controls` (table above) |
| `node packages/core/test/concurrency/controls/contention-probe.mjs 3`, after the build and facade test build | the measurements above |
| The EXP-7 README reproduction block, run verbatim with `sh` from the repository root | exit 0; 21 configurations: 12 violations, each at the invariant in the results table, and 9 exhausted runs, all with the counts in that table |

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
- **Unimplemented protocol parts** (when this record was made; the
  [writer-wait addendum](#addendum-lease-wait-operator-deadline-and-writer-busy-2026-09-30) covers the deadline and writer-busy). The operator deadline, the typed
  writer-busy error and the permit pool are not implemented, so none are
  tested; the current acquisition refusal is `held`.
- **PUB-006.** Resource reporting that survives failed publication is out of
  scope.
- **Contention bounds.** C1 and C2 used four processes and short
  transactions. Under heavier contention a transaction could wait past the
  Node capability's 500 ms busy timeout and surface `SQLITE_BUSY` rather than
  a History refusal. That was not observed here and is not ruled out.
- **State comparisons.** Before/after comparisons cover a projection of
  durable state (writer row, sequences, attempt and result metadata, current
  pointers, acceptances), not a byte-level database image. Payload and index
  content is checked by exact reads and index verification.
- **Store creation.** Simultaneous creation of a new store is outside these
  suites; see #113 and PR #125.
- **Schedule coverage.** C2's interleavings depend on the host scheduler. Its
  assertions hold for any schedule, but a given run exercises only the
  schedules it happens to produce. The deterministic T, O, W, K, R, A and E
  families and C1 carry the enumerated evidence.
- **Platform.** Evidence is local to Node v24.14.0 on macOS arm64; CI adds
  Node 20, 22 and 24 on its own hosts. Model checking ran on the stated JDK
  only.

## Addendum: lease wait, operator deadline and writer-busy (2026-09-30)

[Issue #117](https://github.com/mike-north/microdelta/issues/117) implements
the parts of the owner's decision that this record marked missing: the wait for
the writer lease, the operator deadline and the typed writer-busy error. It
also adds the defense in depth from the "Renew and release rewrite the fence
column" observation above. The base was `0cbb2a4`, merged with `origin/main`
at `7a329fd` (#126, #127), and for the review fix round at `dfe047e` (#132,
code-based busy classification) and `89a27d7` (#133). Toolchain and platform
are unchanged. The fix round's evidence is in its own section below.

### What changed

- **Run Supervision owns the wait** (`packages/supervision/src/writer.ts`),
  as the M5 plan assigns "writer waiting with the operator deadline". A normal
  request tries the writer port once.
  - If another holder owns the lease, the request sleeps on the injected timer
    and tries again. The next try is one poll interval later (one second by
    default) or, if sooner, at the holder's recorded expiry or the deadline.
    Only times strictly after the current reading qualify, so the waiter never
    spins.
  - There is no default deadline. A try at or after the deadline that is not
    granted ends the request with `WriterBusyError`. The error is built from
    that try, so it names the holder that try observed.
  - Any stop ends the wait with `stopped`. Concurrent requests of one run share
    one wait.
- **History keeps lease authority.** Takeover still happens only in
  `acquireWriter`, after expiry and with the next fence. Renewal now writes only
  the expiry, and release only clears the holder: `last_fence` is assigned by a
  grant alone.
- **History classifies contention** (PUB-005). When SQLite stays locked past
  its bounded busy wait:
  - `acquireWriter` returns `contended`, with the writer recorded at that
    moment, read without the write lock (undefined if that read is busy too);
  - `renewWriter` returns `IWriterRenewal`, either `renewed` or that same
    `contended`, so a busy renewal leaves the lease exactly as it was.

  Damaged storage and clock failures stay failures. Other operations still
  fail with Machine's `SqliteBusyError`, which History no longer re-exports.
- **The facade's writer port** (`packages/core/src/writer.ts`) maps History's
  outcomes one to one and decides nothing:
  - `renewed` and `acquired` become `acquired`;
  - `held` passes through;
  - `contended` passes through with `heldByThisRun`, which is true when the
    recorded writer is exactly the lease the run holds.

  A busy renewal keeps the lease, a stale one (`StaleWriterError`) is dropped
  before acquiring, and every other error propagates. A raw driver error never
  reaches Supervision.
- **Nested runs are refused.** A workspace run started from inside an open run
  of the same workspace would wait forever for the lease its caller holds, so
  it is refused at once with `invalid-request`.
- **`WriterLease.tla`.** The renew and release effects leave the fence
  unchanged. A new `Busy` action is a waiter giving up: durably it is exactly a
  `held` observation, and it records the holder it names. The deadline is
  process-local and not modeled, so a waiter may give up at any held
  observation.
  - `WaiterPreservesAuthorityState` now also covers `busy`.
  - The new invariant `BusyNamesUnexpiredHolder` requires the named holder to be
    the observed one, and unexpired at that moment.
  - Three faults are new: `takeover-before-expiry` (acquisition one tick
    early), `busy-without-holder` and `busy-on-stale-observation` (giving up
    whenever any holder is recorded, as a waiter reporting an earlier try
    would).

### Mapping rows added or changed

| Production transition or property | Code | Model | Named tests | Classification |
| --- | --- | --- | --- | --- |
| lease wait: poll, wake at expiry, no spin | `awaitWriter`, `nextAttemptAt`; port `tryLease` | repeated `Held` | Supervision `writer-wait.test.ts` (interval, default 1 s, wake at expiry, no busy spin when expiry reads as past, shared wait); L1, L2, L5; C3 | aligned |
| takeover after the holder dies | `acquireWriter` (unchanged); the waiter wakes at expiry | `Grant` after a prior holder | L2 (SIGKILL; `held` at 1 050, nothing at 1 099, granted at 1 100 with fence + 1); C3 | aligned |
| operator deadline, typed writer-busy | `awaitWriter` deadline branch; `WriterBusyError` | `Busy` | Supervision deadline tests (passed, now, boundary ±1 ms); L3; L4 (deadline 1 100 is granted, 1 099 is busy); facade `writer-wait.test.ts`; C3 | aligned; the deadline arithmetic itself is not modeled |
| `SQLITE_BUSY` exhaustion | History `acquireWriter` and `renewWriter` (`contended`); port mapping; `WriterBusyError.contended` | none (SQLite locks are not modeled) | `writer-port.test.ts` H1–H5 and P1–P7; Supervision contention tests; L7 (another process holds `BEGIN IMMEDIATE`); facade in-process contention test | aligned in code and tests; outside the model |
| a busy renewal keeps the lease | `renewWriter` returns `contended`; the port keeps `held` | none | H2, P2 (next try renews the same fence); Supervision "the run is the recorded holder" message test | aligned; outside the model |
| nested same-workspace run | `openWorkspace().run` refuses it through the run context | none | facade `writer-wait.test.ts` (refused within 1 s; from ordinary work; another workspace allowed; after close allowed) | aligned; outside the model |
| stop during a wait | `sleepUntil`, stop check | none | Supervision soft and hard stop tests; L6 (soft, hard); facade hard-stop test | aligned; not modeled |
| renew and release leave the fence | `extendHolder`, `clearHolder` statements | `Effect` for renew and release | F1 (a connection-local trigger records every `last_fence` assignment: only grants), T* stale renew, `DH:` renew and release tests | aligned |
| `WaiterPreservesAuthorityState` (now `held` and `busy`) | the `held` branch; giving up writes nothing more | `Held`, `Busy` | L1, L2, L3 compare authority rows before and after each waiter step, with only the high-water allowed to rise; W1, W4 | aligned. The plan's wording ("only the time high-water may rise") settles the earlier ambiguity |
| `BusyNamesUnexpiredHolder` | `WriterBusyError` built from the final try | `Busy` | L3, L4 (1 099), L7 (contended, names the recorded holder), L8 (another process took over between tries: names the final holder), C3, Supervision tests | aligned for `held`; the contended outcome is outside the model |
| `FenceNeverRegresses` | only a grant writes `last_fence` | `Grant` | F1, C1, T* | aligned, now by construction as well as by the guard |
| liveness | not modeled | none | a waiter never spins; it wakes at expiry (L1, L2); the deadline (L3, L4) and stops (L6) bound every wait | insufficient: bounded waits are tested, but neither eventual grant nor fairness is proven (see the observations) |

### TLC results

These are fresh runs of every `WriterLease` configuration, with the toolchain
above. `Publication.tla` did not change and was not rerun. Times are from a
shared machine and only indicative.

| Configuration | Exit | Generated | Distinct | Depth | Result |
| --- | --- | --- | --- | --- | --- |
| `WriterLease.cfg` (2 processes) | 0 | 12,206,311 | 200,739 | 11 | no violation; graph exhausted (38 s) |
| `WriterLeaseThreeProcesses.cfg` | 0 | 86,098,219 | 1,084,708 | 11 | no violation; graph exhausted (274 s) |
| `WriterLeaseBad-takeover-without-fence.cfg` | 12 | 20 | 20 | 3 | `GrantIssuesFreshFence` |
| `WriterLeaseBad-renew-ignores-fence.cfg` | 12 | 984 | 534 | 4 | `AcceptedFromLatestGrant` |
| `WriterLeaseBad-holder-ignores-fence.cfg` | 12 | 974 | 524 | 4 | `AcceptedFromLatestGrant` |
| `WriterLeaseBad-holder-ignores-expiry.cfg` | 12 | 54 | 50 | 3 | `AcceptedWithinLease` |
| `WriterLeaseBad-holder-expiry-inclusive.cfg` | 12 | 54 | 50 | 3 | `AcceptedWithinLease` |
| `WriterLeaseBad-acquire-ignores-expiry.cfg` | 12 | 20 | 20 | 3 | `TakeoverOnlyAfterExpiry` |
| `WriterLeaseBad-takeover-before-expiry.cfg` (new) | 12 | 20 | 20 | 3 | `TakeoverOnlyAfterExpiry` |
| `WriterLeaseBad-waiter-advances-fence.cfg` | 12 | 28 | 28 | 3 | `WaiterPreservesAuthorityState` |
| `WriterLeaseBad-ignore-high-water.cfg` | 12 | 224 | 208 | 3 | `EffectiveTimeNeverRegresses` |
| `WriterLeaseBad-busy-without-holder.cfg` (new) | 12 | 36 | 32 | 3 | `BusyNamesUnexpiredHolder` |
| `WriterLeaseBad-busy-on-stale-observation.cfg` (new, fix round) | 12 | 40 | 36 | 3 | `BusyNamesUnexpiredHolder` |
| `WriterLeaseConsequence-takeover-without-fence.cfg` | 12 | 21 | 21 | 3 | `AtMostOneAuthority` |
| `WriterLeaseConsequence-holder-ignores-expiry.cfg` | 0 | 13,744,887 | 220,939 | 11 | no storage-safety violation |
| `WriterLeaseConsequence-holder-expiry-inclusive.cfg` | 0 | 13,754,959 | 221,631 | 11 | no storage-safety violation |
| `WriterLeaseConsequence-acquire-ignores-expiry.cfg` | 0 | 3,919,415 | 67,235 | 8 | no storage-safety violation |
| `WriterLeaseConsequence-takeover-before-expiry.cfg` (new) | 0 | 11,494,919 | 193,251 | 11 | no storage-safety violation |
| `WriterLeaseConsequence-waiter-advances-fence.cfg` | 0 | 13,563,783 | 234,475 | 11 | no storage-safety violation |
| `WriterLeaseConsequence-ignore-high-water.cfg` | 0 | 87,644,111 | 1,359,143 | 12 | no storage-safety violation |
| `WriterLeaseConsequence-busy-without-holder.cfg` (new) | 0 | 4,430,847 | 72,259 | 10 | no storage-safety violation |
| `WriterLeaseConsequence-busy-on-stale-observation.cfg` (new, fix round) | 0 | 12,924,287 | 204,955 | 11 | no storage-safety violation |

The fix round added the `busy-on-stale-observation` fault. Its two
configurations ran, and `WriterLease.cfg` and `WriterLeaseBad-busy-without-holder.cfg`
were rerun on the changed model with identical counts (12,206,311 / 200,739 / 11,
and 36 / 32 / 3). The other configurations do not reach the changed definition,
because it only alters `Busy` under that fault.

The new counterexamples are short:

- **busy-without-holder.** P1 is granted `w`/1, expiry 2. At reading 0 a
  waiter gives up and names no holder.
- **takeover-before-expiry.** P1 is granted `w`/1, expiry 2. At reading 1, one
  tick before expiry, a second grant takes the lease with fence 2.
- **busy-on-stale-observation.** P1 is granted `w`/1, expiry 2. At reading 2,
  when the lease has already expired, a waiter gives up and names `w`.

The **renew-ignores-fence** trace changed with the effect. P1 holds `w`/1. At
reading 2, P2 is granted `w`/2. P1's stale renewal is still accepted, which
breaks `AcceptedFromLatestGrant`, but the durable fence stays 2. Before this
change the same renewal wrote fence 1 back into the row. The
defense in depth keeps the fence from regressing even under a weakened guard;
the guard itself is still what refuses the stale holder.

### Test-first evidence

- **Supervision owner suite** (`packages/supervision/test/writer-wait.test.ts`).
  It was written before any implementation, and its first typecheck failed:
  `WriterBusyError`, `IWriterAttempt`, `tryLease` and `writerWait` did not
  exist. The contracts were then added with a fail-fast stub that made one try
  and failed as busy, as the old port did. Against the stub, 16 of 28 tests
  failed: every poll, wake-at-expiry, deadline, boundary, contention, stop,
  shared-wait and no-timer case. The 12 that passed need no waiting: an
  immediate grant (also with a stop in force), a deadline already passed or
  exactly now, contention with no readable holder at such a deadline, a failing
  port, lease-free requests and five option validations. After the
  implementation all 28 passed, as did the whole supervision suite (138 tests).
- **Facade and cross-process suites.** These were written against the
  unchanged History and port. Supervision's waiter already existed.
  - F1 failed. Renewal assigned `last_fence` 1 → 1, and release did again.
  - L7 failed: the port threw `SqliteBusyError`, so no try was recorded and the
    request failed with the driver-busy error instead of writer-busy.
  - L1–L6 passed, because they exercise the waiter and History's existing
    acquisition. The mutation controls below show that they discriminate.
- **Corrections to my own expectations, made after observing runs.** None
  weakens a requirement.
  - The facade test's locator pattern was wrong.
  - C3 first required a busy waiter to have tried more than once. One try that
    SQLite keeps busy past a 60 ms deadline is legitimate, so the bound is now
    at least one try.
  - C3 first overwrote each event's `holder` with the worker's name. That
    disarmed the busy-without-holder control, which found the bug. It now
    keeps both fields.

### Mutation controls

Command: `node packages/core/test/concurrency/controls/concurrency-mutation-controls.mjs`,
after the build and the facade and Supervision test builds.
- Each control names a target build: History's, Supervision's, or the facade
  port's test build.
- Each control names a run group. `concurrency` runs the interleaving,
  contention and writer-port suites; `supervision` runs Supervision's
  writer-wait owner suite, for a defect only an owner test can see.
- A control with no model counterpart must state why, and `controls.test.mjs`
  enforces that.

Final run, after the fix round on the merged head: exit 0, `PASS: 18 controls`.
The concurrency group's baseline was 139 tests, 0 failing; the supervision
group's was 33, 0 failing. Both groups' restored builds passed in full.

| Control (model fault) | Target | Failing tests | New tests among them |
| --- | --- | --- | --- |
| holder guard ignores the fence (`holder-ignores-fence`) | History | 72 | none (T and O families) |
| holder guard ignores expiry (`holder-ignores-expiry`) | History | 10–11 | none |
| expiry instant still live (`holder-expiry-inclusive`) | History | 1–2 (C2 is schedule-dependent) | none (W4) |
| takeover reuses the fence (`takeover-without-fence`) | History | 115–116 | L1, L2, L4 (1 100), F1, C3 |
| acquisition takes over an unexpired holder (`acquire-ignores-expiry`) | History | 14–16 | L1, L2, L3, L4 ×2, L5, L6 ×2, L8, C3 |
| takeover one millisecond before expiry (`takeover-before-expiry`, new) | History | 2 | W4, L4 (1 099) |
| waiter advances the fence (`waiter-advances-fence`) | History | 12 | L1, L2, L3, L4 ×2, L6 ×2, C3 |
| high-water ignored (`ignore-high-water`) | History | 97 | none |
| renewal adopts the current fence (`renew-ignores-fence`) | History | 9 | none (T2–T4 stale renew) |
| renewal and release write the presented fence back (no model counterpart, new) | History | 1 | F1 |
| writer-busy reports no holder (`busy-without-holder`, new) | Supervision | 4–5 | L3, L4 (1 099), L7, L8, C3 |
| waiting ignores the operator deadline (no model counterpart, new) | Supervision | 4–5 | L3, L4 (1 099), L7, L8, C3 |
| writer-busy built from an earlier try (`busy-on-stale-observation`, fix round) | Supervision | 1 | L8 |
| every failure of acquisition becomes contention (no model counterpart: SQLite contention is not modeled; fix round) | History | 2 | H5, P4 |
| the port treats a busy renewal as stale and swallows renewal failures (no model counterpart; fix round) | facade port | 2 | P2, P4 |
| a wait keeps its abort listener after waking (no model counterpart: listeners are not modeled; fix round, supervision group) | Supervision test build | 2 | Supervision "each sleep registers one listener and removes it on waking…", "a deadline reached after sleeps leaves no listener behind" |
| abandonment ends a completed attempt (`Publication` `abandon-completed`) | History | 1 | none (E1) |
| acceptance rewinds current (`Publication` `accept-moves-current`) | History | 1 | none (A1) |

"Takeover before expiry" is covered twice. The existing
`acquire-ignores-expiry` control is now also rejected by eight new waiting
cases and C3, and the new boundary control `takeover-before-expiry` is
rejected by W4 and L4. Two controls have no model counterpart:

- *renew writing the presented fence* cannot be told apart in the model while
  the holder guard holds;
- deadlines are not modeled;
- the fix round's contention, port and listener controls concern SQLite
  contention, the facade's translation and listener retention, none of which
  the model represents.

`history-mutation-controls.mjs` ran unchanged: `PASS: 25 controls`, with 41
tests restored. `journal-mutation-controls.mjs`, which arrived with the merge
of #127, also passed: `PASS: 11 controls`, with 17 tests restored. Both
results held again on the fix round's head.

`workspace-mutation-controls.mjs` was retargeted in the fix round. Its two
writer controls now plant into the facade port's test build. Its Jest
patterns now name exactly the suites it judges, including the facade's
`writer-wait.test.ts`; previously, suites added to those directories made the
baseline invalid. On the fix round's head:
- the baseline is 96 tests, 0 failing;
- "an expired writer lease is kept instead of re-acquired" is rejected by 1
  test;
- "releasing an expired lease is reported as a failure" is rejected by 1 test;
- the restored build passes.

The runner still ends `FAIL`, because nine of its anchors predate this work
and no longer match: six Supervision run-lifetime anchors, the Supervision
recovery anchor (which the merge of #133 changed) and two example anchors.
The recovery anchor is fixed here in both this runner and the acceptance
runner; the others are left for their own issue. The acceptance runner first reported a `CONTROL RUN INVALID`
because #128 added `stop-publication.test.ts` without adding it to the
runner's suite list. That list now names all nine acceptance suites, and one
control that planted the removed `writer.lease()` call plants
`writer.tryLease()` instead. With those changes the baseline (67 tests) and
the restored build pass, and 11 of 13 controls are rejected, including
"recovery takes the writer lease" (9 failing). The runner still ends `FAIL`.
Two Resolution controls now find their anchors twice on `main` ("a source
candidate skips its own implementation and input validation" and "the
recovery intent ignores the current declaration"), a pre-existing condition;
Resolution is untouched here.

### Fix round (review of `4a70f78`)

The review found no blocking bug. It reversed one decision and asked for
discriminating tests and four nits. Each item was written test first.

- **Contention belongs to History (decision 5 reversed).** I first changed the
  new port and History suite (`writer-port.test.ts`) and the types, then ran
  it against a History that did not yet classify contention. The typecheck
  had already failed on a `contended` acquisition. At runtime, 8 of 12 tests
  failed: H1–H4, P1, P2, P5 and P6, each getting `SqliteBusyError` where a
  `contended` outcome or an integrity failure was expected. After History
  classified contention, 12 of 12 passed. Mutations M6 (every acquisition
  failure becomes contention) and M9 (a busy renewal treated as stale, and
  renewal failures swallowed) survived the earlier suites. They are now
  controls, rejected by H5 and P4 and by P2 and P4.
- **Two of my own expectations were wrong at first.** The fix is in the test
  setup, not the requirement. A failing host clock throws its own error; only
  an invalid reading is `HistoryClockError`, so the tests use a reading of -1.
  The writer row is trigger-protected, so the damaged-storage tests drop and
  restore that trigger around the deletion.
- **Nested same-workspace runs.** Before the refusal existed, the new test's
  inner run was still waiting for the outer run's lease after 2 s. The
  ordinary-work variant completed instead of being refused. After the
  refusal, all four nested-run cases pass and the refusal arrives within 1 s.
  `recovery.test.ts` now starts its second run from outside the first run
  rather than relying on a deadline to escape.
- **Writer-busy from the final try.** L8 passed against the implementation,
  as it should. It is the test that rejects the new
  `busy-on-stale-observation` code control.
- **Self-named holder.** The two Supervision tests failed to typecheck before
  `heldByThisRun` existed, and pass now. The message says the run is the
  recorded holder, contended.
- **Listener cleanup.** The counting-double tests passed against the existing
  code. The new supervision-group control shows they reject a leaked listener.
- **In-process contention test.** It is restored in the facade suite and
  passes with #132's code-based busy classification, so it no longer depends
  on which test file loaded the driver first.
- **C2 and typed contention ([#136](https://github.com/mike-north/microdelta/issues/136)).**
  C2's contend loop calls `acquireWriter` and `renewWriter`, which now return
  `contended` instead of throwing.
  - The loop logs such a try as contention.
  - C2 accepts contention only on those two operations, with no error class,
    and with any named writer a real grantee.
  - Any other refusal must still be `StaleWriterError`, so a raw driver error
    still fails the test.

  The concurrency suites then ran 10 times under parallel load: two Jest runs
  at a time, plus six CPU-bound processes. All 10 runs passed, 139 of 139
  tests each, with no C2 failure. The loop's allocation, staging and
  publication can still throw a bare `SqliteBusyError`, because those
  operations have no contention outcome. None did in these runs.

### Observations

- **Waiting is not fair.** In a first C3 run, workers took a new tenure
  straight after releasing. A releasing worker then usually took the lease
  back before waiters polling every 5 ms tried again, and one worker held a
  long run of grants while the others reached their deadlines. This is the
  absence of fairness that both models declare. The suite now rests each
  worker for 15 ms between tenures. Across three runs it recorded:
  - 46–49 grants, of which 39–46 came after waiting;
  - 36–38 writer-busy outcomes, every one naming a holder that was granted the
    writer;
  - no contended outcome;
  - no worker naming itself;
  - at most 12 tries per wait.
- **Contention never reached SQLite's busy timeout in C3.** Every writer-busy
  there was a held observation. L7 is the deliberate contention case.

### Limits

- **Fairness and eventual grant are unproven.** A holder that keeps renewing,
  or keeps reacquiring, can make every waiter reach its deadline. Without a
  deadline, a waiter then waits until a stop.
- **Other contention is still a bare `SqliteBusyError`.** SQLite contention
  during History operations other than acquisition and renewal (allocation,
  staging, publication) still surfaces as Machine's typed `SqliteBusyError`,
  not as writer-busy. Release contention at run close is a run diagnostic, and
  the lease then ends at its expiry.
- **Time domains are assumed to agree.** The waiter's timer and History's
  clock are assumed to read the same host wall clock. A waiter whose timer
  reads past an expiry that History still treats as live polls at its interval
  rather than spinning.
- **No observer event reports waiting.** The structured event schema belongs to
  #119.
- **Only same-workspace nesting is refused.** A run of a *second* workspace
  opened over the same store file, started inside a run of the first, is a
  different holder to History and still waits, without a deadline until a
  stop.
