# EXP-7 observed evidence — 2026-09-26 Pacific

## Assertion-first model control

The authority, retained-history, lease, allocation, retry, and exact-reference
invariants were stated before treating any model run as evidence. The known-bad
configuration removes holder/fence equality from publication while preserving
process liveness and an unexpired durable lease. A malformed initial key domain
and an early witness-helper declaration error were corrected as setup failures;
neither counts as a protocol counterexample. A broad earlier guard omission was
narrowed so the control isolates reclaim followed by stale publication.

The final reduced model produced this eight-state counterexample before the
corrected configuration was run:

| State | Event | Relevant fact |
| --- | --- | --- |
| 1 | Init | Seed generation 1 is complete; no holder. |
| 2 | Acquire A | A holds fence 1 with expiry 1 at time 0. |
| 3 | Allocate abandoned | Attempt receives generation 2. |
| 4 | Execute | One body call returns. |
| 5 | Stage | Generation 2 is staged, still not current. |
| 6 | Tick | Time reaches 1; A's lease expires. |
| 7 | Reclaim B | B holds fence 2 with expiry 2. |
| 8 | Publish A | A supplies fence 1 while durable holder is B/fence 2; the authority invariant fails. |

The bad run exited **12** at `PublicationUsedCurrentAuthority`: 47,256 generated
states, 13,732 distinct states, depth 8, 8,893 states left on its interrupted
queue. This is the expected failing positive control, not an exhausted graph.

## Corrected finite run

With only `OmitPublishFence = FALSE`, the same invariants and bounds completed
with exit **0**, reporting no error: **29,599,222 generated states, 2,624,759
distinct states, zero queued states, depth 24**. Elapsed time was **2 minutes
15 seconds** using one worker. TLC reported fingerprint-collision estimates of
`3.8E-6` (calculated optimistic) and `8.0E-7` (based on actual fingerprints).
This is TLC's finite-state safety result with its fingerprinting assumptions,
not a mathematical proof for unbounded systems. No fairness or liveness was
checked, and deadlock reporting is disabled explicitly in both configurations.

The setup, exact commands, tool digest, JVM, fixed bounds, and abstraction limits
are in [README](README.md). The only changes made to the model during this run
were explanatory comments; the parsed transitions/configurations are unchanged.
Event-specific witnesses reset on unrelated transitions; only acknowledged refs
and high-water evidence retain history. This removes irrelevant ghost-history
cross-products without narrowing protocol actions. The rejected-mutation witness
checks holder, expiry, fence, and current pointer specifically; it is not a
whole-database corruption check.

## TypeScript correspondence and ordinary gates

The supervisor and a separate peer agent compared the model with EXP-3's actual
protocol source and tests. Stable-key rebinding and bounded precommit retry were
added to the model during review because an earlier draft excluded valid recovery
paths. No production protocol behavior was changed.

A new assertion checks that, after the seed writer consumed fence 1 and a killed
holder consumed fence 2, a reopened successor receives fence 3. It passes against
the existing implementation. This is added acceptance coverage, not a claimed
pre-fix failure. Real SIGKILL and reopen are exercised by the existing harness.

After integration with accepted CML fixture-build wiring, `npm run check`,
`npm test`, `npm run build`, and `git diff --check` passed. Tests included 79
tooling cases, 24 EXP-1 cases, 28 EXP-2 cases, five SQLite capability cases,
13 publication cases, package suites, and tsd. These Node gates do not run TLC;
the model configurations remain explicit optional checks.

## Later model changes

On 2026-09-30 `Publication.tla` gained production History's abandonment and
acceptance transitions. Its single `OmitPublishFence` switch became a `Fault`
constant with one known-bad configuration per guard, and the sibling
`WriterLease.tla` was added. The counts above describe the 2026-09-26 model
only. Rerun under the same pinned toolchain before any change, that model's
two configurations reproduced exactly: the known-bad run gave 47,256
generated, 13,732 distinct, depth 8 at `PublicationUsedCurrentAuthority`, and
the corrected run 29,599,222 generated, 2,624,759 distinct, depth 24. The
current models' results are in the
[M5 concurrency validation record](../../docs/validation/m5-concurrency-2026-09-30.md).
