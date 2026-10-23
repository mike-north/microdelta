# Pinned default clean-bootstrap verification

Executed 2026-10-23 on macOS 27.0.1 arm64, Node 24.22.1/npm 11.12.1. These are **filed baseline** reproductions, not assertions about current main. Each exact default command ran in its own detached worktree with clean initial status, no node_modules, its own npm ci and package build, no borrowed dependencies, and GAP_HUNT_REUSE_BUILD absent. NODE_PATH/NODE_OPTIONS were cleared. All final working trees were clean. No product/fixture/runner modification was required.

| Issue | Exact source pin | Default command after `node` | Exit | Verified result |
| --- | --- | --- | --- | --- |
| #169 | faaa87426c565452d24cb128a1cfb4df3bc86405 | scratch/gap-hunt/consumer-dx/repro-async-source.mjs | 2 | Exactly four TS2322 diagnostics and no other compiler diagnostic; tsd and type-aware lint pass; Jest 2/2 runtime controls pass. |
| #159 | abb9bab1987d18644093fb67dadb17c3ea9f94ce | scratch/gap-hunt/contract-surface/repro-159.mjs | 1 | Full-history 3-record control passes before final expected readback assertion: [1,2,3] versus [1,1,1]. One failed test, no extra suite. |
| #160 | abb9bab1987d18644093fb67dadb17c3ea9f94ce | scratch/gap-hunt/contract-surface/repro-160.mjs | 1 | Matched encoding [20,40] passes; stage/publication work [1323,5043] fails the final linear-bound assertion. One failed test. |
| #161 | abb9bab1987d18644093fb67dadb17c3ea9f94ce | scratch/gap-hunt/contract-surface/repro-161.mjs | 1 | 15/15 facade operations and 8/8 example controls pass; one stale-document assertion then fails. This baseline predates the separately repaired current documentation. |
| #168 | b1b42c304db15fe0c3c306a0fb4f71660970040f | scratch/gap-hunt/consumer-dx/repro-custom-key.mjs | 1 | Strict compile/type-aware lint pass; final Jest fixture has expected explicit-key rejection (1 red) plus missing-key rejection and optional-identity controls (2 green). |

## Why these runs were necessary

#169 previously reused a fresh build; the analogous M7 default bootstrap did not establish this command. #159/#160/#161 previously relied on #154's shared bootstrap and reuse-build runs. #168 had a verified default at98c70b8, but b1b42c3 materially replaced the Node test-runner invocation with Jest; this run verifies that published final command independently. Published pins are unchanged.

## Evidence and scope

`159.log` through `169.log` (the five issue numbers above) are unedited combined stdout/stderr. Matching JSON files record exact argv, full source pin, UTC start/end, working-tree status, host/tool versions, cleared reuse boundary, log hashes and runner/helper/lock hashes. `verify.py` checks expected exit codes, exact known diagnostic signatures and passing-control counts without executing runtime work again. All five assertions passed. The intentional product/document failures are diagnostic success, not passing product contracts.

No Linux, paid provider, large workload, unrelated full suite, GitHub mutation, release action, root status or handoff control edit is included. npm package caches were allowed; installed node_modules and generated outputs were independent. Disposable evidence worktrees were removed after their metadata and logs were captured.
