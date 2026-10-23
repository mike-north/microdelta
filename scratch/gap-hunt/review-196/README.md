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


## Final recipe execution and guard verification

The complete final recipe at `550cba91c5edaa254a85916946611b1208e368e8` executed
from a fresh checkout without node_modules. All 16 commands returned their exact
expected exits. Captures in `results/` are from that final execution; the later
publication commit adds only report/capture artifacts and is not a new runtime
execution. The only later guard code change makes guard-only receipt metadata
read this recorded recipe commit from summary.json instead of an earlier constant;
it does not alter full replay behavior or judgment. The recipe printed a temporary output directory outside the checkout,
and the tracked tree was clean at terminal completion before captures were copied
into this evidence directory. Committed captures were not overwritten by replay.

Source and fixture restoration run in `finally`, followed there by rebuilding
Resolution and compiling the fixture. Both emitted files' SHA-256 hashes equal
the initial fresh-owned build. If an intermediate command fails, finalization
still runs; if restoration also fails, the initial exception remains primary and
the restoration failure is recorded. Four synthetic exact-finalizer-AST controls
exercise successful restoration and restoration failure with/without an initial
error using filesystem/build doubles, without product runtime repetition.

```sh
python3 scratch/gap-hunt/review-196/replay.py --guards-only
python3 scratch/gap-hunt/review-196/check-finalizer.py
```

The guard-only path accepts all 16 hash-verified recorded commands, validates
exact suite/test counts for all 8 Jest-bearing steps, rejects runtime/load
diagnostics, and requires exact named semantic failures and numeric observations
for all expected reds. It rejects 38 synthetic cases: missing logs, load errors
even with valid count summaries, wrong test counts, wrong suite counts, wrong
failure names, and wrong semantic matchers. `guard-validation.json` records the
execution and script hashes. This path writes to its printed temporary directory
and verifies that committed captures remain unchanged. Install/check are also
verified as unconditional by inspecting the runner AST.
