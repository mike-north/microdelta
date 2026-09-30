# EXP-7 finite TLA+ publication and writer-lease models

Two finite models check the safety boundary of History's durable publication
protocol. `Publication.tla` began with the EXP-3 SQLite fixture: only a live
current holder with the current fence may publish, and a published reference
names a retained complete attempt. It now also represents production History's
abandonment and acceptance transitions. `WriterLease.tla` models the production
writer protocol (`packages/history/src/durable/index.ts`) under the owner's
2026-09-30 concurrency decision. The decision's elements are one fenced writer
per store, contending processes that wait and take over only an expired lease
through a fresh fence, and inspection without a lease. The model also covers
the shared holder guard and the clock high-water policy under arbitrary host
readings.

Both are finite protocol abstractions, not models of SQLite internals or
general proofs of History. The model→code→test mapping against production
History is in the
[M5 concurrency validation record](../../docs/validation/m5-concurrency-2026-09-30.md).

## `Publication.tla`: state represented

`Publication.tla` represents one subject, two contenders (`A`, `B`), a retained
seed result, and two further stable attempt keys (`abandoned`, `successor`).
Durable state contains:

- the holder, expiry, and monotonically increasing fence and generation;
- per-key lifecycle and reference;
- retained complete snapshots and the current pointer.

Process-local state contains liveness, the held token, the attempt currently
being resumed, whether body execution has returned, and an unacknowledged
publication reference. Body calls and the latest event witnesses are bounded.
Cumulative acknowledgments and issued high-water observations are ghost state
used to check invariants, not database records.

The model's actions:

- `RebindAttempt` models stable-key lookup followed by resuming an existing
  allocated or staged attempt under the current authority.
- `Execute` allows two bounded calls to represent a pre-commit retry.
- `Crash` and `Restart` clear only process-local credentials and pending
  acknowledgment; they preserve durable state.
- `AbortPublish` is a pre-commit rollback and leaves all durable fields
  unchanged.
- `AtomicPublish` represents the one successful transaction boundary.
- `Abandon` ends an allocated or staged attempt under current authority. The
  terminal `ended` phase stands for production's `failed` and `interrupted`
  states.
- `Accept` records that an existing retained result was accepted. No other
  transition reads acceptance records, so they are witnessed rather than
  stored. Only the current pointer and retained history are durable facts an
  acceptance could disturb.

## `WriterLease.tla`: state represented

`WriterLease.tla` represents two processes, two holder names (so a process may
reuse another's name), fences 0–3, host clock readings 0–3 and lease length 2.
Durable state is:

- the writer row: holder, last fence, expiry and persisted clock high-water;
- the fence of the latest data write, which stands for the rows that record
  `allocated_fence`, `ended_fence`, `published_fence` and the acceptance fence.

Each process keeps the lease object (name and fence) of its latest grant until
it is granted again, so it can present that object at any later step after it
has gone stale. A crashed process is one that takes
no further step, and a restarted one acquires a new lease object. Every
operation reads an arbitrary host clock value, so readings may move backwards
or jump forwards between any two steps. History evaluates the larger of that
reading and the high-water, as production does.

The model's actions:

- `Grant`: `acquireWriter` taking the lease, either because none is recorded
  or because the recorded one has expired.
- `Held`: `acquireWriter` observing an unexpired holder.
- `HolderOp`: the shared `asHolder` guard, applied to `renew`, `release`,
  `allocate`, `stage`, `publish`, `abandon` and `accept`.
- `Inspect`: a lease-free read.

Accepted effects mirror the production statements, including renew and
release writing the presented fence back into the writer row. A rejected
mutation commits only the time observation.

## Bounds and interpretation

`Publication.cfg` fixes two contenders, three attempt keys, generations 0–3,
fences 0–2, logical times 0–2, and lease length 1. The seed occupies generation
1; later successful allocation consumes one of generations 2–3. Logical time
moves forward one tick at a time. `WriterLease.cfg` covers the clock policy that
`Publication.tla` abstracts, with the bounds above; `WriterLeaseThreeProcesses.cfg`
repeats it with three processes. Neither model makes a fairness or liveness
claim. `CHECK_DEADLOCK FALSE` suppresses deadlock reporting because reaching a
configured finite bound can intentionally leave no enabled transition. It does
not assert that a production writer always makes progress, that a waiter is
ever granted the lease, or anything about the operator deadline and typed
writer-busy error, which are not yet implemented.

Staged payload bytes, fingerprints, and provenance are abstracted to the
`staged` lifecycle value. The models have no per-subject table shape, schema
versioning, corrupt-storage cases, filesystem behavior, SQLite lock behavior, or
process scheduling. The SQL operations inside a transaction are not stepped or
interrupted individually: each accepted transition commits all represented
fields together, and rollback is an unchanged state. Consequently the real
child-process kill tests remain the independent evidence for SQLite crash and
reopen behavior. The models do not prove power-loss durability, distributed
coordination, provider exactly-once execution, multi-writer parallelism, or
unrestricted concurrency safety.

## Known-bad controls

Each known-bad configuration sets `Fault` to weaken exactly one guard and
checks the same invariants over the same bounds. TLC must find a violation.
The guards fall into three kinds:

- **Storage guards.** A defect lets a superseded writer change storage.
- **Lease-promise guards.** A defect breaks the holder's lease or the clock
  policy, but storage stays safe because the fence still refuses every
  superseded writer.
- **Restating guards.** The invariant that catches the defect restates the
  guard itself.

| Configuration | Weakened guard | Kind | First violation |
| --- | --- | --- | --- |
| `PublicationBad.cfg` | publication without holder/fence equality | storage | `PublicationUsedCurrentAuthority` |
| `PublicationBad-abandon-completed.cfg` | abandonment of a completed attempt | storage (retained history) | `CurrentIsComplete` |
| `PublicationBad-accept-moves-current.cfg` | acceptance rewinds the current pointer | restating | `AcceptanceKeepsCurrentAndHistory` |
| `WriterLeaseBad-takeover-without-fence.cfg` | takeover reuses the previous fence | storage | `GrantIssuesFreshFence` (storage-only run: `AtMostOneAuthority`) |
| `WriterLeaseBad-renew-ignores-fence.cfg` | renewal checks holder and expiry, not fence | storage | `AcceptedFromLatestGrant` |
| `WriterLeaseBad-holder-ignores-fence.cfg` | every holder mutation skips the fence | storage | `AcceptedFromLatestGrant` |
| `WriterLeaseBad-holder-ignores-expiry.cfg` | every holder mutation skips expiry | lease promise | `AcceptedWithinLease` |
| `WriterLeaseBad-holder-expiry-inclusive.cfg` | the expiry instant still counts as live | lease promise | `AcceptedWithinLease` |
| `WriterLeaseBad-acquire-ignores-expiry.cfg` | acquisition takes over an unexpired holder | lease promise | `TakeoverOnlyAfterExpiry` |
| `WriterLeaseBad-waiter-advances-fence.cfg` | a `held` observation advances the fence | lease promise | `WaiterPreservesAuthorityState` |
| `WriterLeaseBad-ignore-high-water.cfg` | time is the raw host reading | lease promise | `EffectiveTimeNeverRegresses` |

The kinds are established by storage-only runs. Each
`WriterLeaseConsequence-<fault>.cfg` checks only the storage-safety invariants
for the six faults not first caught by one:

- takeover without a fence increment reaches `AtMostOneAuthority`;
- the other five exhaust without a storage-safety violation.

`PublicationConsequence-accept-moves-current.cfg` omits the restating
invariant and exhausts: a rewound current pointer still names a retained,
complete result. That violates RES-007's acceptance semantics, not
retained-history integrity.

Code controls in `packages/core/test/concurrency/controls/controls.mjs` plant
each `WriterLease` fault, `abandon-completed` and `accept-moves-current` into
History's emitted build; `omit-publish-fence`'s control is "publication
ignores the fence" in
`packages/core/test/durable-history/controls/history-mutation-controls.mjs`.

## Invariants

`Publication.tla`:

- `TypeOK` checks each durable, process-local, ghost, and bounded value against
  its declared finite domain.
- `CurrentIsComplete` and `CompletedHistoryIsRetained` require the current pointer
  and every completed reference to resolve to retained complete state.
- `AcknowledgedHistoryIsReadable` requires every ghost-observed acknowledgment
  to resolve through the exact-reference store.
- `PublicationUsedCurrentAuthority` compares the actor and supplied token with
  independently captured pre-transition holder, token, lease, operation time,
  and process liveness.
- `RejectedStaleMutationPreservesDurableState` records the successor lease and
  current pointer before a rejected stale renewal or release and checks they are
  unchanged afterward.
- `DurableHighWaterNeverRegresses` compares current durable fence and generation
  to ghost maxima of the values already issued.
- `CompletedRetryKeepsReferenceAndSkipsBody` checks the key's exact reference
  and body-call count on completed-key retry.
- `ExactReferenceReadIsStable` checks the selected retained reference at the
  read event.
- `EndedAttemptIsNeverAResult` keeps an abandoned attempt out of retained
  results and the current pointer, with its generation still consumed.
- `AcceptanceKeepsCurrentAndHistory` requires an acceptance to name a retained
  result and leave the current pointer where it found it.

`WriterLease.tla` storage-safety invariants:

- `AcceptedFromLatestGrant`: an accepted mutation came from the process that
  received the latest grant (a ghost fact independent of holder names),
  presenting that grant's name and fence.
- `StorageSeesNonDecreasingFences`: data writes arrive in non-decreasing fence
  order.
- `AtMostOneAuthority`: at most one process holds a lease object the durable
  row would accept.
- `FenceNeverRegresses`: the durable fence is never below any issued fence.
- `RejectedPreservesAuthorityState`: a refusal changes only the high-water.

`WriterLease.tla` lease-promise invariants and direct protocol statements:

- `AcceptedWithinLease`: an accepted mutation was evaluated before the lease's
  recorded expiry.
- `EndedAuthorityNeverActs`: a fence once found expired, released or superseded
  never mutates again.
- `EffectiveTimeNeverRegresses`: the persisted high-water is never below any
  evaluated time.
- `GrantIssuesFreshFence`: every grant issues the previous fence plus one.
- `TakeoverOnlyAfterExpiry`: a recorded holder is taken over only once its
  lease has expired at the evaluated time.
- `WaiterPreservesAuthorityState`: a `held` observation leaves holder, fence,
  expiry and data untouched and can only raise the high-water.
- `InspectionChangesNothing`: a lease-free read changes no durable state.

Event-specific ghost witnesses are reset on unrelated transitions. Only
cumulative facts persist: acknowledgments, high-water maxima, the latest
grantee and ended fences.

## Relation to executable tests

The production mapping, with named tests per action and invariant, is in the
[M5 concurrency validation record](../../docs/validation/m5-concurrency-2026-09-30.md).
The historical EXP-3 correspondence remains:

| Model boundary | EXP-3 executable evidence |
| --- | --- |
| Acquire, held, expiry, reclaim, monotonic fence; crash/reopen preserves the old result and a reopened successor gets the next fence | `a process killed after acquiring ownership leaves the old complete result readable`; `the next writer advances the durable fence after the prior process dies and the store reopens`; `only one live writer is admitted, and every stale authority operation is fenced` |
| Allocation consumes a generation, and an allocated or staged attempt is not current | `killing after allocation consumes the generation without publishing a partial result`; `a staged payload is not a completed result and cannot become current after a crash` |
| Publication is atomic at its commit boundary; rollback leaves the old pointer and the staged attempt | `publication is one commit: death just before commit leaves the staged attempt unpublished`; `a failed publication transaction keeps the pointer and completed set unchanged`; EXP-3 `sqlite-capability.test.ts` transaction rollback case |
| Crash after commit but before acknowledgment; stable-key retry returns the same exact reference without repeating work | `death after commit but before acknowledgment preserves the result and prevents body replay`; `retry after an observer loses the committed acknowledgment returns the same result without rerunning work` |
| Retained exact-reference reads remain independent of current | `exact older references remain readable after a newer result becomes current` |
| Stale authority cannot renew, stage, publish, or release the successor lease | `only one live writer is admitted, and every stale authority operation is fenced` |

## Reproduction

Use the pinned `tla2tools.jar` from the official
[TLA+ tools v1.7.1 release](https://github.com/tlaplus/tlaplus/releases/tag/v1.7.1)
and a Java 17 runtime. This jar reports `TLC2 Version 2.16 of 31 December 2020
(rev: cdddf55)`. Its SHA-1 matches the release page,
`9416f74257aa50f250776db34964db7ec99e9883`; verify its SHA-256 before use:
`d532ba31aafe17afba1130f92410d9257454ff7393d1eb2fe032f0c07f352da5`.

The 2026-09-30 runs used a portable Eclipse Temurin 17.0.20.1+1 JDK for macOS
aarch64, a native arm64 binary; TLC's banner labels any 64-bit JVM `x86_64`.
Its tarball was `OpenJDK17U-jdk_aarch64_mac_hotspot_17.0.20.1_1.tar.gz`, SHA-256
`196d13ba5f10414bef7f6a05a9b3f00edacb18ebacef2b99485db9e2ee18f0e8`. Keep the
toolchain and TLC's state database in the repository's gitignored `scratch/`
directory, not in the source tree or a system location. From the repository
root:

```sh
mkdir -p scratch/tla-toolchain
# place tla2tools.jar and an unpacked Temurin 17 JDK in scratch/tla-toolchain, then:
shasum -a 256 scratch/tla-toolchain/tla2tools.jar
# The JDK tarball's layout differs by platform. macOS:
JAVA=scratch/tla-toolchain/jdk-17.0.20.1+1/Contents/Home/bin/java
# Linux instead: JAVA=scratch/tla-toolchain/jdk-17.0.20.1+1/bin/java
"$JAVA" -version
cd experiments/exp-7
for cfg in PublicationBad.cfg PublicationBad-abandon-completed.cfg \
    PublicationBad-accept-moves-current.cfg PublicationConsequence-accept-moves-current.cfg \
    Publication.cfg; do
  ../../"$JAVA" -cp ../../scratch/tla-toolchain/tla2tools.jar tlc2.TLC -workers 1 \
    -metadir "../../scratch/tlc-meta/${cfg%.cfg}" -config "$cfg" Publication.tla
done
for cfg in WriterLeaseBad-*.cfg WriterLeaseConsequence-*.cfg \
    WriterLease.cfg WriterLeaseThreeProcesses.cfg; do
  ../../"$JAVA" -cp ../../scratch/tla-toolchain/tla2tools.jar tlc2.TLC -workers 1 \
    -metadir "../../scratch/tlc-meta/${cfg%.cfg}" -config "$cfg" WriterLease.tla
done
```

Every known-bad configuration is expected to stop with exit code 12 at the
violation listed above, as is `WriterLeaseConsequence-takeover-without-fence.cfg`.
Every good configuration and every other consequence run is expected to
exhaust its finite reachable state graph with exit code 0. The
[observed evidence](evidence.md) records the 2026-09-26 EXP-3-era runs. The
[M5 validation record](../../docs/validation/m5-concurrency-2026-09-30.md)
records the current models' counts, exits and counterexamples. These results
are evidence for these bounds only.

## Decision and maintenance

Retain these models as optional protocol-review evidence, as recorded in
[PUB-004](../../docs/spec/execution.md). The known-bad configurations
demonstrate sensitivity to each guard, and the good runs are small enough to
reproduce locally. This does not make TLC a mandatory dependency for CI, and it
does not discharge M5's implementation concurrency gate, which the Node suites
in `packages/core/test/concurrency` address. Reassess the mapping and rerun
every configuration when the publication transitions, lease rules, clock
policy, stable-key recovery, or model bounds change. Broader bounds and
toolchain upgrades have unmeasured maintenance costs. Routine Node CI remains
independent of Java.
