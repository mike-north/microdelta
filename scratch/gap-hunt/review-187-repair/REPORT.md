# PR187 pristine compiler-config repair

Bounded PASS at exact `accad3a07a24b7b544b22003a6f8a283c624efc9`. The two-file delta from `0af7f746aa82fc72e88d24c3945061b1a17c0511` replaces the fixture's missing `tsconfig.all.json` parent with tracked strict root configuration and explicit generated-alpha mappings, and adds a tooling check that the parent is tracked. It changes no package/runtime code, owner tests or frozen consumer fixture source.

## Pristine delivery and focused oracle

Actual host: macOS27.0.1 arm64, Node24.22.1/npm11.12.1. Before creating this evidence subtree, the pristine PR checkout had no node_modules or support config. `npm ci --no-audit --no-fund`, `npm run build` (the default complete build) and `npm run check:output-fixture` all exited0, with clean tracked/untracked state before and after and `tsconfig.all.json` absent throughout. The supervising thread retains that separate raw pristine receipt.

The self-contained command repeats locked installation, default build and fixture compiler/lint checks, then runs the exact frozen original reproducer. Its normal install/build path now reaches and passes the actual minimal runtime oracle: **2 passed,7 intentionally skipped,9 total**, rather than stopping at TS5083. No support overlay is created. The new compiler-config tooling test passes. The generated-alpha member/argument fixture passes **4 tests/1 suite,0 failures/0 runtime-error suites**: scalar, member subtree and forwarded argument retain exact references across independent processes; the argument child History row count remains1, so parent cutoff cannot hide a child republication. All six wrapper commands exit0.

The fixture config inherits `tsconfig.base.json`'s strict compiler flags, sets emission explicitly, and maps all eleven public sibling packages to generated alpha declarations. It does not introduce source aliases, `skipLibCheck`, suppression or broad type escape. `check:output-fixture` exercises strict compilation and the existing type-aware ESLint config against the same worker. Four pinned original test/worker blobs and the original runner remain byte-identical to their `4dc00d6`/`a97c11f` objects, verified before the run.

## Previous evidence remains separately qualified

The complete `packages` Git tree is byte-identical between old and current PR heads: `e63d5246a17ed6ada3805fc3fabe44daa9dd25a4`. Earlier14Core/6Resolution-owner/54Tracking passing tests and old-source negatives remain evidence from the `565f838` publication / `64b8493` fresh execution at old `0af7f74`, which explicitly supplied and removed the missing config only for runtime checks. These broad suites are not claimed newly executed here. The package-tree comparison preserves their runtime-source relevance while this focused replay validates the repaired delivered tooling path.

The earlier pristine failure at that old pin remains unchanged: historical summary and TS5083 log copied byte-exact from `565f8384d8ca32681d45b8db262f2cf9571d04c7` record original exit2 before the runtime oracle. The runner verifies those historical artifact bytes; it does not retarget them or claim the old pristine checkout passes.

## Pickup and limits

From this evidence commit on Node24 with standard native build prerequisites:

```sh
python3 scratch/gap-hunt/review-187-repair/reproduce.py
```

Raw local results stay ignored; committed captures only normalize checkout paths and trailing whitespace. This qualifies the pristine build/compiler/lint path and finite2+4 runtime fixtures on the recorded host. No Linux, full-repository check/test, new runtime fix, package publication or provider execution is claimed. The hunt supervisor owns public posting and evidence assessment; the repository supervisor owns acceptance/merge.
