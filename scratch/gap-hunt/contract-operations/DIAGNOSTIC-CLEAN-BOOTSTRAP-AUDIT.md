# Clean bootstrap provenance for target diagnostics

## Audit boundary

This audit closes provenance for the exact default diagnostic commands pinned by #165/#166/#167 to `0683c2ed73934d10f9b5a1ad9e0dd9e3d1a88d4f`. It does not implement these targets or convert their successful absence diagnostics into regressions. #157 was audited without running another pnpm/native installation. No GitHub mutation, Linux execution, paid call, product/runtime edit or #158 native diagnostic was performed.

Before running anything, inspected the captured `verify-{preview,resource-state,cli}.log`, their script history at4cbe7d0/52ba984, and the four-runner diff at0683c2e. The old logs contain real `npm ci`, full generated-package builds and valid controls; they are not merely component-only observations. However, they lack a pre/post-clean isolated-checkout record, and the52ba984 log tail/diagnostic exit-semantic revision does not itself prove a fresh default invocation. The0683c2e diff only relaxes the guard from exactly24.22.1 to24.x and prints actual Node/platform/arch; it does not change install/build/control behavior. Existing controls were therefore already informative, but the claimed exact clean starting point was not fully evidenced. The three executions below address that provenance gap, not a need for additional counts.

`diagnostic-clean-audit-inputs.json` records SHA256 for all three runners and their control/surface-inspection inputs at0683c2e and this branch: all match. No script or fixture was copied into the clean checkout. Each detached worktree was created directly at the exact pin, had a distinct path and absent node_modules, and was removed after its own run. `npm ci` used the normal package cache; this is not a cold-network/cache claim.

## Exact default commands

Run each separately from the pinned checkout root:

```sh
bash scratch/gap-hunt/contract-operations/verify-preview.sh
bash scratch/gap-hunt/contract-operations/verify-resource-state.sh
bash scratch/gap-hunt/contract-operations/verify-cli.sh
```

No reuse-build override was set. Each default performs locked `npm ci --no-audit --no-fund`, full `npm run build:packages` and its own valid controls before the absence diagnostic. These runners do not run the full test suite or separate type-aware lint; the generated-package build includes its configured TypeScript/API Extractor checks. The CLI command itself includes npm offline executable-discovery failure as an asserted negative control.

`diagnostic-clean-context.json` records each command, exact checkout/pin, start/end, actual Node/npm/platform, absent node_modules before invocation, exit code, and full `git status --porcelain --untracked-files=all` both before and after. An empty cleanliness string is an observed clean status, not an inference from the outer command. Generated ignored artifacts/node_modules exist afterward as expected. Disposable worktrees were then removed.

## Controls and observed results

Final observed outcomes and log hashes are recorded by `diagnostic-clean-results.json`. Full output remains in separate `diagnostic-clean-preview.log`, `diagnostic-clean-resource-state.log`, and `diagnostic-clean-cli.log`.

- Preview: cold histogram publishes; authorized refresh fails with `execution-failure`;1,000 exact reads retain the original histogram and fetch count stays2. Complete run/observer surface matches the reviewed snapshot; no latest-preview/provisional/throttled delivery entry is established.
- Resource state: two properly attributed additive request deltas2+3 produce observed5, unknown[], complete status. Complete Accounting snapshot remains the additive port without state/pool/window/reset record/query. The earlier invalid summation-of-balances probe is excluded.
- CLI: runs its own histogram/failure/exact-read control, then all package manifests lack bin, IWorkspace has close/logicalStore/run, and `npm exec --offline -- microdelta --help` fails executable discovery as expected. It establishes absent standalone CLI, not a CLI implementation.

Successful control/absence diagnostics intentionally exit0. They are not future implementation acceptance tests; a changed owning surface requires renewed semantic review. All evidence is macOS arm64 Node24.22.1/npm11.12.1. This does not certify other Node24 patch versions, Linux, published-package installation or a current-main bootstrap.

## #157: exact documented fallback versus outstanding default/Linux evidence

Superseding follow-up: `PNPM157-CLEAN-FALLBACK.md` records a later qualified executable check and actual exact0683c2e clean explicit-PNPM12_BIN run, exit0 with full negative/positive controls and pre/post-clean provenance. Thus the historical-only fallback observations below describe the earlier audit boundary, not the final current evidence. Default fresh pnpm12 launch and Linux remain unverified.

No #157 command was rerun. Historical `verify-157.log` first committed at10affd562b2642f714f671d0a03435d873693b5d records macOS negative/positive controls for published microdelta0.2.0: pnpm10.34.7 install0/unapproved durable1; pnpm12.10.1 install1/unapproved durable1; memory smoke succeeds; both approved cold runs execute1/publish and independent restart executes0/reuses the exact reference. `ISSUE-157-ADDENDUM.md` explicitly says this used PNPM12_BIN with an existing exact12.10.1 executable. The historical log lacks the complete environment invocation and pre/post-clean checkout record; do not invent them.

The documented existing pnpm12 executable in `../portability/REPORT.md` is `/Users/mnorth/.nodenv/versions/24.14.0/bin/pnpm`, executed under active Node24.22.1. An equivalent fallback replay recipe, reconstructed from the recorded executable path and fallback mechanism rather than a preserved literal invocation, is:

```sh
PNPM12_BIN=/Users/mnorth/.nodenv/versions/24.14.0/bin/pnpm bash scratch/gap-hunt/contract-operations/verify-157.sh
```

This reconstruction is not a newly executed command or a claim that its local executable is still available. The runner checks the supplied binary's exact version12.10.1; its path's nodenv directory does not select the Node runtime. Consumer directories and pnpm stores are disposable; approval is consumer-local `allowBuilds: better-sqlite3: true` then targeted rebuild, with no global trust relaxation. The0683c2e change only adjusts/prints the Node guard; historical fallback behavior is equivalent under its observed24.22.1 runtime but is not evidence of a new exact0683c2e default run.

The default command (without PNPM12_BIN) installs/downloads its pinned manager first. A historical freshly installed pnpm12 executable terminated137 before consumer installation; cause remains unknown. This does not establish its expected ignored-build rejection and is not a microdelta failure. No retry of that launch was attempted. Default fresh pnpm12 launch remains unverified on macOS; no fresh pre/post-clean metadata for the historical fallback is claimed.

Linux still requires actual `bash scratch/gap-hunt/contract-operations/verify-157.sh` in the documented fresh Linux user/container without inherited pnpm approvals, with Node24.x/npm/Bash/network and native build prerequisites if prebuild fallback is needed. Owner-supplied successful Linux npm installs/build/full tests on24.13.0/26.12.1 do not test pnpm approvals or the default downloaded pnpm12 launch. They also must not be hidden by old generalized “Linux unverified” wording: native npm/runtime Linux evidence is positive; this remaining qualification is specifically package-manager approval and newer commands.

Implementer: Codex worker (gpt-6.1-sol), operating for Mike North, inspected historical evidence and executed three exact pinned clean default diagnostics.
Agent assistance: supervising Codex selected this provenance audit and its limits. No human implementation/review, current-main acceptance or Linux execution is claimed.
