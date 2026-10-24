# PR203 / #158 bounded documentation and diagnostic qualification

Exact source `3e8fe78df48222b3ccb2f56163a8e2ad159c8807`, base `e3e1920a1300b4205b5c417f98d1202e75f2d3ba`: **PASS for the bounded documentation and diagnostic reporting contract.** No native dependency installation or Linux runtime was performed in this review. Real native compatibility claims retain their historical source and owner attribution.

The seven-file patch changes onboarding, documentation, a captured Node24 observation, an unchanged disposable diagnostic and its documentation tests. No runtime, engine, driver, adapter, package export or release machinery changes. The guide correctly separates public memory from project-private durable usage, package-manager trust (#157) from host compiler/linker/SDK diagnosis, prebuild availability from source-build prerequisites, engine metadata from observations, and independent installs from same-store reuse.

## Checks executed

A clean archive of the exact source passed all5 documentation assertions and5 synthetic diagnostic cases. All816 original archived files remained byte-identical. Every inspected relative link in root/facade/guide/evidence resolves. The one-command replay below needs Python3, Bash and Node with VM modules, but installs no repository or native dependencies and writes output only to a fresh temporary directory.

The synthetic cases evaluate the exact unchanged diagnostic in an isolated JavaScript context with synthetic process/filesystem/child ports. They verify install failure means no smoke, successful install/smoke retains the success marker, smoke failure stays failed, child error/signal remains visible, and an unselected Node version rejects before installation. Synthetic Node26 identity is injected only to reach this reporting control flow; it is not real Node26 execution or native compatibility proof. Temporary cleanup is asserted. The outer diagnostic completing is never counted as native success.

The guide's actual shell block also ran with npm replaced by a local environment-recording function. It selected the exact seven command-local CLT/compiler/SDK values and Node/CLT PATH prefix from the historical recipe, with arguments `ci --no-audit --no-fund`. No npm installation, compiler, linker, global environment or xcode-select mutation occurred. `captures/recipe-environment.json` records this recipe-expansion check.

## Pinned historical provenance

- The diagnostic is byte-identical to `faa7d2563945374b75cbd5b239a82df4e17a334d`, SHA256 `05062901824f478b0ca4a25b6c1f2ce101cd76e2f8c0b9169a3d4012b97953a4`.
- The declared Node24 adaptation changes only the version guard and has the recorded `700f7cc4...` digest. Captured Node24.14.0 JSON has exact declared `c9bd9bfa...` digest, install/smoke0 and the success marker. It remains the implementer's adapted host observation, not an unchanged Node26 replay by this reviewer. The advisory alone cannot determine prebuild versus compilation.
- `6d3f3f3533d75ea42be226edbd7e3932b974f447` records the macOS26.12.0 SDK-stub linker failure after successful header downloads; incomplete CLT selection's separate stdio.h discovery failure; then the exact successful consistent CLT recipe. Its source-pinned24↔26 shared-store sequences remain bounded macOS observations.
- The `faa7d25` diagnostic report separately records actual unchanged Node26.12.0 install/smoke0 with the CLT environment. This is historical executed evidence, not a new native install.
- `e475049c3f858c270791581fb77f925e761363ce` Linux provenance attributes main `c5802da` independent npm installs/build/full-suite results to the supplied aarch64 report, Node24.13.0/26.12.1. It explicitly excludes pnpm approval and Linux same-store cross-version reuse. This reviewer did not inspect remote raw Linux logs or execute Linux.

`captures/receipt.json` carries exact historical document hashes, verified markers, fixture identity, source/link checks and executed command counts. No universal Node26/macOS/Linux support, release-policy change or full-current-main execution is claimed.

## Replay and excluded harness attempts

```sh
python3 scratch/gap-hunt/review-203/reproduce.py
```

Git/archive reads are bounded60seconds, documentation/synthetic tests120seconds and recipe-environment expansion30seconds. The helper uses a new exact source archive; it does not touch captured evidence. One early synthetic harness attempt used an incorrect fixture-relative path and failed to load; a recipe harness using a Node shim changed PATH before observation. Both were corrected, excluded from product judgments, and the final complete lightweight replay passed. Neither attempted native installation.

Attribution: Codex worker GPT-6.1 Sol prepared and executed this bounded review for Mike North. Historical native and supplied Linux observations retain their authorship; no human or new Linux execution is claimed.
