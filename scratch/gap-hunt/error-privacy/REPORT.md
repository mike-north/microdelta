# Author-created ResolutionError bypasses the safe failure boundary

Source: `2a640aca75d5728484a2cb06af88c77690616ba9`. Evidence only; no product change.

RUN-013 (`docs/spec/operations.md:499–504`) excludes everything author/caller code throws from framework messages and diagnostics, preserving it only as cause. The exported ResolutionError TSDoc (`packages/resolution/src/errors.ts:42–48`) repeats that contract without an exception for author-created instances.

The real alpha Core authoring/workspace facade runs a memo whose bound helper throws an exported `new ResolutionError('unsupported-result', 'SYNTHETIC-OPAQUE-DETAIL-9d72')`. The caught outer error is the identical author-created object, with code unsupported-result and message exactly the marker. Its cause is not the thrown object. These values are recorded before the failing message assertion; later expected code/cause assertions do not execute. No completed result is returned.

The bypass is at `packages/resolution/src/resolution.ts:2225–2231`: the body catch trusts any non-execution-failure ResolutionError based on public class identity and rethrows it. A genuine declared child failure still needs to propagate its framework classification; class identity alone cannot establish provenance.

## Bounded controls

Final run: 8 passing assertions, 1 intended failing assertion, 0 runtime-error suites. TypeScript strict test compilation and type-aware ESLint pass.

- Ordinary author Error is wrapped in execution-failure, safe outer message, exact original cause.
- Genuine declared child returning a record with a callable value produces runtime unsupported-result and preserves that classification through its parent.
- Six opaque provider cases: failed response and rejected perform, each with nested cause, custom conversion hooks, or throwing getters. Real SQLite History/Accounting, successful sibling, exactly one invocation each, correct failed/unknown semantics, safe observations, and no marker bytes in stores. Failed-response cases preserve opaque cause identity. No conversion hooks/getters execute.

The confirmed leak is the author-path outer framework message. This probe does not claim that author-path events/stores leak, or that every callback boundary has been exercised. No paid provider runs. Recorded host: macOS 27.0.1 arm64, Node 24.22.1; no other platform claim.

## Reproduction

From a checkout of this evidence commit with Node 24:

```sh
python3 scratch/gap-hunt/error-privacy/run.py
```

The runner installs from the lockfile, builds package declarations, strictly compiles tests, lints this fixture, and verifies the exact expected 8-pass/1-fail oracle with no runtime-error suites. It exits zero only if reproduction succeeds; it does not make the product suite green. `local-results/receipt.json` records the actual Git head, host, command exits and observations. Public `captures` retain the qualified run. Only synthetic text is emitted.

Earlier harness development used NaN as the invalid child output; Value admits NaN, so that control was corrected to a callable value. That exploratory failure is not counted as a product failure.

## Deduplication

Parent checked live issue/PR state: closed #147 fixed ordinary author Error interpolation; this public error-class bypass is a distinct recurrence of the same privacy contract. Historical #119/#122 acceptance does not supply this discriminator. Open PRs #188/#187/#185/#184/#179 do not cover it. Parent owns publication and readiness decisions.

The first clean runner at41521ed reached the8-pass/1-fail Jest result but failed its observation parser because Jest sent console records to stderr. That runner failure is historical evidence, not a product failure. The corrected evidence runner parses both output streams and asserts the observed codes, message and identities directly. Production and fixture bytes are unchanged.
