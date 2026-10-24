# Deterministic lease-drain evidence — 2026-10-24

Issue [223](https://github.com/mike-north/microdelta/issues/223) repairs the test
boundary for [RUN-014](../spec/operations.md#run-014--cancellation-conveys-escalating-intent-honestly),
[PUB-002](../spec/execution.md#pub-002--every-ownership-sensitive-mutation-is-fenced)
and EXP-8 ruling R. The [test design](lease-drain-design.md) records the narrow
clock seam and preserved facade assembly.

## Observed defect and test-first failures

PR #222's [Node 22 run](https://github.com/mike-north/microdelta/actions/runs/40140720152)
failed both old cases while waiting for the member to send, before either
post-loss assertion. The unchanged fixture used a real 150 ms writer lease.
Other runs passed; the CI log alone does not establish every intermittent cause.

Before the repair, a controlled probe advanced `Date.now()` by 300 ms at the
first verification event after acquisition. Its expectation that setup reached
sending failed: the actual outcome was `refused`, `lease-lost`, `denied`, and no
provider request was sent. This proves the fixture can consume its lease during
setup, independently of its intended late-publication scenario. The retained
`lease-setup-probe.test.ts` now explicitly asserts that setup-failure distinction.

Two tests of the boundary helper then failed under the old polling behavior:
completed denial and rejected setup both reported `timed out waiting until
provider send`, losing the terminal outcome. They now require the actual return
or rejection as the cause of `Run ended before provider send`.

Independent review found that the original 2,000-immediate-turn boundary could
expire before a legitimate asynchronous send: its helper-only probe timed out
in 26 ms on Node 24 and 28 ms on Node 22 before a 250 ms timer. The original
`Atomics.wait` setup blocked the event loop and did not test that case.

The checked-in asynchronous 250 ms boundary regression first failed with
`timed out waiting until asynchronously delayed send` (1 failed, 6 passed).
The repaired helper uses a two-second monotonic deadline, native timer-backed
polling and immediate wake-up on run settlement. Both full-facade cases now
use a test adapter that yields to a real 250 ms timer before the underlying
provider send. No synchronous `Atomics.wait` delay remains.

## Acceptance mapping

| Issue criterion | Executable proof |
| --- | --- |
| 1: establish setup race | `lease-setup-probe.test.ts`: the controlled pre-send advance returns lease-lost without sending; observed RED recorded above |
| 2: deterministic owner boundary | `lease-drain.test.ts`: actual `openStopSession`/`runIn` facade, scoped Node wall-clock spy, unmocked scheduling and real SQLite; exact held expiry is advanced only after provider receipt |
| 3: both post-loss cases | Same two ruling-R cases: send received and incomplete attempt verified before loss; soft stop, exact expiry, optional real History successor acquisition, late provider completion, lease-lost/denied, no work publication, unchanged attempt, unchanged successor |
| 4: fail-fast/bounded cleanup | `lease-setup-probe.test.ts` checks returned denial, rejected run, never-settling boundary, already reached boundary and real completion deadline; test cleanup stops/releases work, bounds settling, closes storage and restores the clock in nested finally blocks |
| 5: delayed setup/control | Both drain cases asynchronously defer the actual provider send for 250 ms while the 150 ms lease clock stays fixed; both then reach sending. The two emitted-output negative controls below reject missing guards through actual forbidden late publication |
| 6: repository verification | Required static, runtime and build gates are recorded below; no production source is changed |

The two drain cases moved from `stop.test.ts` into their own suite so controls
can execute their complete title set without skipped unrelated tests. They
continue exercising the same production facade assembly and existing owners.

## Negative controls

After building packages and compiling the Core tests, run:

```sh
node packages/core/test/stop/controls/lease-drain-mutation-controls.mjs
```

Both controls passed:

- Removing the expiry check from emitted History code makes only the simple
  expiry case publish late and fail its expected lease-lost denial.
- Removing holder/fence equality makes only the successor case publish late and
  fail that denial.

The runner requires the exact two baseline titles, complete normal Jest results,
the specific intended failing case and a publication mismatch. Timeouts,
pre-send errors, killed children and unrelated failures cannot count as proof.
Each child has a 30-second bound; original emitted bytes are restored in finally
blocks and ordinary signal handlers, checked exactly, and the restored two-case
suite must pass. The repository's existing automatic anchor check discovers the
runner and checks both mutation anchors during `npm test`.

## Verification

The focused run passed 26 tests across the stop, lease-drain and setup probe
suites:

```sh
npx tsc -p packages/core/tsconfig.test.json
node --experimental-vm-modules node_modules/jest/bin/jest.js --config packages/core/jest.config.mjs --runInBand --testPathPatterns 'stop/(lease-|stop.test)'
```

The final review-repair source passed all required gates sequentially, each with exit 0:

- `npm run check`: strict compiler, type-aware lint, declaration/package boundaries
  and repository enforcement checks.
- `npm test`: all tooling, workspace, experiment and example suites. Core passed
  91 suites and 1,070 tests, including the final cleanup paths. Its automatic
  anchor check discovered and validated the new lease-drain control runner.
- `npm run build`: all package/declaration, fixture, experiment and example builds.

`git diff --check`, relative documentation-link checks, saved PR metadata
validation and all 23 metadata checker tests passed. Verification used no live
provider or paid execution.

## Limits

Clock control is local to serial Jest cases and is always restored. Native
timer scheduling remains unmocked, but Machine timer deadlines also read the
spied clock; these cases choose no timed stop deadline. Test wait bounds use
monotonic time/native timers independently of that clock. These tests prove the existing facade's
post-send fence behavior against real SQLite, not distributed timing or every
possible CI scheduling failure. No production clock, renewal, fencing, retry or
stop contract changed. A process killed before the mutation runner's cleanup
can require rebuilding output, as with existing mutation runners. Independent
exact-head repair review remains a separate gate. The independent reviewer
ran the helper-only probe on Node 22, but the full local Node 22 facade run was
blocked by the installed SQLite binary targeting Node 24 ABI 137 instead of
Node 22 ABI 127. Dependencies were not rebuilt for review, and this local
evidence makes no fresh Node 22 full-suite claim.
