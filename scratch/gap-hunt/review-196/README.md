# Independent bounded fan-out review, issue #173 / PR #196

Product source: `f7307e1542d6170505f31a3926bdc13917f603df`.
Frozen original diagnostic: `gap-hunt-dx@3a63e6cbd1c83dcc94e38fa4359d9501b3816558`.
Governing contracts: DOM-3, RUN-002, ARC-005; issue #173's numbered acceptance criteria.

Run from a clean checkout with Node 24, npm and Python 3:

```sh
python3 scratch/gap-hunt/review-196/replay.py
```

Default execution owns its install, runs the full strict/type-aware-lint/declaration
`npm run check`, and builds all packages. Install/check are unconditional in the
product replay; inherited `GAP_HUNT_REUSE_BUILD` is removed. Only the fixture
commands reuse the fresh invocation's completed build. There is no skip-install
or skip-check option.
The runner rejects product differences from the frozen reviewed source, allows
this evidence directory, prints a fresh temporary output directory and writes normalized command logs
and a receipt there, preserving the committed captures in `results/`,
and restores every temporarily replaced source/fixture in `finally`.
It performs no provider execution, remote writes, or package publication.

## Observations

| Population | Window | Held phase | Admissions | Bodies | Pending waits | After stop |
| ---: | ---: | --- | ---: | ---: | ---: | ---: |
| 100 | 1 | admission | 1 | 0 | 1 | 0 |
| 1000 | 1 | admission | 1 | 0 | 1 | 0 |
| 100 | 8 | admission | 8 | 0 | 8 | 0 |
| 1000 | 8 | admission | 8 | 0 | 8 | 0 |
| 8 | 8 | admission | 8 | 0 | 0 | 0 |
| 100 | 8 | body | 8 | 8 | 8 | 0 |

All six have one source body (roster published before instrumentation), unchanged
abstract topology, complete canonical report membership, zero published member
results, and no additional bodies after hard stop. Necessary roster and final
report memory are outside the scheduling-state bound. Eight pending acquisitions
are the coordinator's explicitly window-bounded slack, not eight admitted bodies.

The complete Supervision unit suite passes **197 tests / 5 suites**. The selected
facade suites pass **103 tests / 10 suites**: stop, drain, lifecycle, resolution-port,
keyed members/restart/refusal, workspace operations/async supplied inputs, and M5
stop acceptance. No roster, skips, refusals, or stopped-member cases are excluded.
These exercise useful concurrency, canonical dispatch/report order, independent
failure, soft drain, nested/send permit separation, timed lane lending, FIFO
priority reclaim, hard stop, and complete outcome reporting.

## Frozen original and instrumentation boundary

The byte-for-byte original probe is preserved in `frozen/`. Running it unchanged
against this implementation gives **1 pass / 1 failure**, not an unconditional
original pass. Its allocation matcher searches the whole stack for both
`at new Promise` and `permits.js`. The new dispatch promise appears as an ancestor
of immediate `Promise.resolve(permit())` acquisitions. It counts 16 acquisitions
as queued at window 8 although only 8 remain pending; the unchanged equality
control fails (expected 16, received 8). Its original waiting-growth test passes.

The precise-original replay changes only instrumentation: it reads the generated
permit file, finds the actual `return new Promise(` wait-constructor line, and
matches that location. The population/body/stop setup and original Jest assertions
remain byte-for-byte unchanged. These **2 original tests pass**. The source
comment and negative below make the source-specific limitation explicit; moving
the scheduler's allocations is not by itself evidence of boundedness.

The deliberate negative replaces only Resolution's bounded dispatch/suffix with
the original eager `Promise.all(keys.map(...supervision.member...))` expression.
The same six rows produce **99, 999, 92, 992, 0, 92 pending waits**. Both current
fixture tests fail. The unchanged original tests with the precise observer give
**1 pass / 1 intended failure**, reporting population-growth delta **900 > 8**.
No observer, admission, body, roster, or assertion is altered for that negative.
The source and both fixtures are then restored byte-for-byte, Resolution rebuilt,
and both current tests pass again. Full matrices and expected diagnostic failures
are in the logs, with command exit codes in the receipt.

## Current-head delta and limits

PR head moved during review to `4408ab236562e1f4fd4d7f15d353d04fe7a86eb7`.
The entire delta is import ordering in Resolution's type test. Runtime source,
fixtures, generated contract source and tests used above are byte-identical.
The runner also checks that exact changed file with Resolution's strict/lint check
and tsd, then restores the frozen source file.

This is finite deterministic macOS arm64 evidence at 100/1000 members, plus the
existing bounded owner/facade controls. It establishes no full-corpus capacity,
peak-heap, Linux, or contribution-report rehearsal claim. The window-bound is also
supported by source inspection: one cursor registration per active fan-out and at
most `laneWindow` acquisition loops globally; keys/current evidence stay owned by
Resolution. Timed sleeping members may retain active execution evidence while
lending lanes, as required by the existing lifetime contract.


## Guard-only amendment after the captured execution

The full fresh install/build/product replay above executed the recipe at
`f348f72465a7b74189fd51d69cffaa43c745df25`; capture commit
`76ca301714f57a5240d60f1730cdc88c65b54561` added its logs. The final runner adds
pure log guards and external output handling; **the final runner has not been
claimed as a fresh full product execution**. Its guard-only path was executed:

```sh
python3 scratch/gap-hunt/review-196/replay.py --guards-only
```

It accepts all 15 hash-verified recorded commands, validates exact suite/test
counts for all 8 Jest-bearing steps, rejects runtime/load diagnostics, and
requires the exact named semantic failures and numbers for all expected reds.
It rejects 38 synthetic cases: missing logs, load errors even with valid count
summaries, wrong test counts, wrong suite counts, wrong failure names, and wrong
semantic matchers. `guard-validation.json` records the guard-only execution and
script hashes. This path writes to its printed temporary directory and checks
that committed captures remain unchanged; it performs no product runtime replay.
The output initialization is shared by guard-only and full replay. Future full
replays now preserve this evidence tree's committed captures as well.
