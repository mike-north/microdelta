# Original #162/#164 replay on merged main

Implementer: Codex worker (gpt-6.1-sol), operating for Mike North.

Production baseline: `f43c5872987573d9b98a19f41c324b4d9336894c` (merged main including PR #171). No production file changed. All six original fixture/config files retain byte-identical content and expectations from the origin commits recorded in `fixture-hashes.json`; origin Git objects were compared directly.

| Focused original fixture | Failed | Passed | Skipped | Observed failure |
|---|---:|---:|---:|---|
| #162 intrinsic presence/membership | 9 | 2 | 0 | Presence/membership observations throw `Unsupported value at $.<intrinsic>: intrinsic inherited data` |
| #164 durable input, scalar and base-to-base selection | 1 | 1 | 7 | Identical restart expects reused, receives published |
| #164 durable member/forwarded argument | 2 | 2 | 0 | Member restart publishes/new reference; forwarded argument child executes twice instead of once |

All three Jest result files report zero runtime-error suites. Five positive controls pass: intrinsic value rejection; own-shadow/custom-prototype support; scalar exact-reference restart; scalar member restart; parent equal-output cutoff. Original semantic failures therefore remain reproducible after #171; no selected original diagnostic became obsolete. The input test fails before its later rollback assertions, so this replay does not claim rollback execution. Seven unrelated input/output cases were intentionally skipped.

Fresh locked installation and the full workspace build completed successfully on Node 24.22.1/npm 11.12.1 (`install.log`, `build.log`). Tracking and Core strict package checks, consumer extension type compilation and type-aware lint all pass. New tooling-only config narrows the original all-consumer config to its original output-binding source; fixture source and expectations were not edited.

## Reproduction

```sh
node scratch/gap-hunt/current-contracts/replay.mjs
```

The wrapper installs locked dependencies, builds, checks fixture hashes, runs only the three focused expected-red selections, then runs strict checks and consumer lint. It exits 0 only when expected failure/pass/skip counts and zero runtime errors match. A successful wrapper means the expected-red diagnostics are preserved, not that the product passes these contracts.

The captured run used `node scratch/gap-hunt/current-contracts/replay.mjs --reuse-build` after the separate fresh installation/full build; that wrapper completed exit 0. The default install/build path is composed from those same commands but was not separately executed as a single clean wrapper invocation. `local-replay-summary.json`, `local-*-results.json` and `local-*.log` preserve that focused replay; initial results are also retained. `runtime-source-pins.json` records runtime and source/lock hashes.

No broad suite, provider call, issue comment or production change is included.

## Independent clean default-wrapper verification

The complete default command above was subsequently executed once from a fresh detached checkout at exact evidence head `ae51eab3878dfdfb0db746f46615de7f8b88f17a`, without borrowed dependencies or build outputs. It completed **exit 0**, including locked install and full build, original-fixture hash checks, #162 **9 failed/2 passed**, #164 input **1 failed/1 passed/7 skipped**, bindings **2 failed/2 passed**, zero runtime-error suites, and all strict checks/type/lint passes. Node 24.22.1/npm 11.12.1.

`standalone-clean.log` captures the wrapper output; `standalone-clean-replay-summary.json` and the prefixed per-step logs/Jest JSON preserve its internally captured results. `standalone-clean-metadata.json` records the exact head, command, runtime, lock hash and post-run status. The wrapper rewrites its tracked local evidence files as designed; production source and lockfile have no changes. Original fixture bytes and expectations remain unchanged. This closes the earlier single-invocation verification boundary; no additional runtime scenario was run.
