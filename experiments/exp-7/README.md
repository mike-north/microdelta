# EXP-7 finite TLA+ publication model

This model checks the safety boundary already exercised by the EXP-3 SQLite
fixture: only a live current holder with the current fence may publish, and a
published reference names a retained complete attempt. It is a finite protocol
abstraction, not a model of SQLite internals or a general proof of History.

## State represented

`Publication.tla` represents one subject, two contenders (`A`, `B`), a retained
seed result, and two further stable attempt keys (`abandoned`, `successor`).
Durable state contains the holder, expiry, monotonically increasing fence and
generation, per-key lifecycle and reference, retained complete snapshots, and
the current pointer. Process-local state contains liveness, the held token, the
attempt currently being resumed, whether body execution has returned, and an
unacknowledged publication reference. Body calls and the latest event witnesses
are bounded; cumulative acknowledgments and issued high-water observations are
ghost state used to check invariants, not EXP-3 database records.

`RebindAttempt` models stable-key lookup followed by resuming an existing
allocated or staged attempt under the current authority. `Execute` allows two
bounded calls to represent a pre-commit retry. `Crash` and `Restart` clear only
process-local credentials and pending acknowledgment; they preserve durable
state. `AbortPublish` is a pre-commit rollback and leaves all durable fields
unchanged. `AtomicPublish` represents the one successful transaction boundary.

## Bounds and interpretation

The configurations fix two contenders, three attempt keys, generations 0–3,
fences 0–2, logical times 0–2, and lease length 1. The seed occupies generation
1; later successful allocation consumes one of generations 2–3. Logical time
moves forward one tick at a time and operations use that model time. EXP-3 instead
accepts a caller-supplied `nowMs`; the model does not check clock behavior or
arbitrary timestamp sequences. The model makes no fairness or liveness claim.
`CHECK_DEADLOCK FALSE` suppresses deadlock reporting because reaching a configured
finite bound can intentionally leave no enabled transition; it does not assert
that a production writer always makes progress.

Staged payload bytes, fingerprints, and provenance are abstracted to the
`staged` lifecycle value. The model has no per-subject table shape, schema
versioning, corrupt-storage cases, filesystem behavior, SQLite lock behavior, or
process scheduling. The SQL operations inside publication are not stepped or
interrupted individually: a successful `AtomicPublish` commits all represented
publication fields together, while rollback is represented by an unchanged
`AbortPublish`. Consequently the real child-process kill tests remain the
independent evidence for SQLite crash and reopen behavior. The model does not
prove power-loss durability, distributed coordination, provider exactly-once
execution, or unrestricted concurrency safety.

`PublicationBad.cfg` changes one guard only: `OmitPublishFence = TRUE` allows the
publisher to satisfy liveness and lease-time checks without matching the current
holder and fence. TLC must find the stale-publisher violation of
`PublicationUsedCurrentAuthority`; this is a positive control demonstrating that
the invariant detects the intended fault. `Publication.cfg` restores the guard
and checks the same invariants over the same finite bounds.

## Invariants

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

Event-specific ghost witnesses are reset on unrelated transitions to avoid
retaining irrelevant history in the finite state graph. The acknowledgment set
and high-water maxima persist because their invariants depend on cumulative
history.

## Relation to EXP-3 tests

| Model boundary | EXP-3 executable evidence |
| --- | --- |
| Acquire, held, expiry, reclaim, monotonic fence; crash/reopen preserves the old result and a reopened successor gets the next fence | `a process killed after acquiring ownership leaves the old complete result readable`; `the next writer advances the durable fence after the prior process dies and the store reopens`; `only one live writer is admitted, and every stale authority operation is fenced` |
| Allocation consumes a generation, and an allocated or staged attempt is not current | `killing after allocation consumes the generation without publishing a partial result`; `a staged payload is not a completed result and cannot become current after a crash` |
| Publication is atomic at its commit boundary; rollback leaves the old pointer and the staged attempt | `publication is one commit: death just before commit leaves the staged attempt unpublished`; `a failed publication transaction keeps the pointer and completed set unchanged`; EXP-3 `sqlite-capability.test.ts` transaction rollback case |
| Crash after commit but before acknowledgment; stable-key retry returns the same exact reference without repeating work | `death after commit but before acknowledgment preserves the result and prevents body replay`; `retry after an observer loses the committed acknowledgment returns the same result without rerunning work` |
| Retained exact-reference reads remain independent of current | `exact older references remain readable after a newer result becomes current` |
| Stale authority cannot renew, stage, publish, or release the successor lease | `only one live writer is admitted, and every stale authority operation is fenced` |

The separate process-kill tests exercise real Node child processes and reopen a
file-backed SQLite store; this model does not substitute for those observations.
The fence-after-reopen assertion directly checks the token advances from the
seed writer's `1` to `3` after the killed holder consumed `2`.

## Reproduction

Run each configuration from this directory with the pinned `tla2tools.jar` from the official
[TLA+ tools v1.7.1 release](https://github.com/tlaplus/tlaplus/releases/tag/v1.7.1)
and a Java 17 runtime. This jar reports `TLC2 Version 2.16 of 31 December 2020
(rev: cdddf55)`. Its SHA-1 matches the release page,
`9416f74257aa50f250776db34964db7ec99e9883`; the measured SHA-256 is
`d532ba31aafe17afba1130f92410d9257454ff7393d1eb2fe032f0c07f352da5`.
The observed host used Eclipse Adoptium 17.0.20.1 on macOS ARM (x86_64 JVM). Keep TLC's state database outside the source tree:

```sh
java -cp /path/to/tla2tools.jar tlc2.TLC -workers 1 \
  -metadir /tmp/exp7-bad-states -config PublicationBad.cfg Publication.tla
java -cp /path/to/tla2tools.jar tlc2.TLC -workers 1 \
  -metadir /tmp/exp7-good-states -config Publication.cfg Publication.tla
```

The bad configuration is expected to stop with exit code 12 and a counterexample
at `PublicationUsedCurrentAuthority`. The good configuration is expected to
exhaust its finite reachable state graph with all listed invariants intact.
The [observed evidence](evidence.md) records counts, exits, and the counterexample.
Those observed results are evidence for these bounds only.


## Decision and maintenance

Retain this model as optional protocol-review evidence, as recorded in
[PUB-004](../../docs/spec/execution.md). The known-bad interleaving demonstrates
useful sensitivity to the authority boundary, and the corrected finite run is
small enough to reproduce locally. This does not make TLC a mandatory dependency
for unrelated CI or discharge M5's implementation concurrency gate. Reassess the
mapping and rerun both configurations when the publication transitions, lease
rules, stable-key recovery, or model bounds change. Broader contender/time bounds
and toolchain upgrades have unmeasured maintenance costs. The present corrected
run took 2 minutes 15 seconds; routine Node CI remains independent of Java.
