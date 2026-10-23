# microdelta Linux parity results

Completed 2026-10-23. Both main-branch full npm test runs passed. All eight checkouts remained git-clean. Read-only verification; no fixes or pushes. Each branch/Node pair has an isolated worktree and node_modules under `/pay/home/owner/microdelta-linux/.worktrees/`. Native bindings were installed independently. Processes ran at nice +10. Origin is the local `/tmp/microdelta.bundle`; no GitHub calls were made for this parity task.

Host: Linux aarch64. Installed Node 26.12.1 was used for the requested 26.12 line (patch substitution); Node 24.13.0 was exact. Node binaries: `/home/owner/.nodenv/versions/{24.13.0,26.12.1}/bin`; each command prepended its version to PATH.

Exact commits:

- `main`: `c5802daca4a0bb8ea91159854d84eddcfa5215b6`
- `gap-hunt-contracts`: `43444bb0a67e638c9dd8b5cb2c0a41c68d98de99`
- `gap-hunt-durability`: `bfb1cc3ad88694d13637316c95d269f3a7206a56`
- `gap-hunt-dx`: `4e0bf6f605c3e233d304534447217043915a49b9`

All 8 isolated installs and all 8 full builds passed. Reproduction failures below are preserved gap evidence, not newly introduced fixes. The DX runtime positive is shown separately from its expected failed compiler attempt.

| Branch | Node | Actual primary command | Result | First substantive failure |
| --- | --- | --- | --- | --- |
| main | 24.13.0 | `npm test` | PASS | — |
| main | 26.12.1 | `npm test` | PASS | — |
| gap-hunt-contracts | 24.13.0 | `node --experimental-vm-modules node_modules/jest/bin/jest.js --config packages/core/jest.config.mjs --runInBand --runTestsByPath packages/core/.test-build/test/gap-hunt-contracts-container-guard.test.js packages/core/.test-build/test/gap-hunt-contracts-nested-current.test.js packages/core/.test-build/test/gap-hunt-contracts-operation-matrix.test.js packages/core/.test-build/test/gap-hunt-contracts-scalar-roots.test.js` | FAIL | Expected published/absent; received reused/present. Tracking guard also expected changed, received equal (known negative repro). |
| gap-hunt-contracts | 26.12.1 | `node --experimental-vm-modules node_modules/jest/bin/jest.js --config packages/core/jest.config.mjs --runInBand --runTestsByPath packages/core/.test-build/test/gap-hunt-contracts-container-guard.test.js packages/core/.test-build/test/gap-hunt-contracts-nested-current.test.js packages/core/.test-build/test/gap-hunt-contracts-operation-matrix.test.js packages/core/.test-build/test/gap-hunt-contracts-scalar-roots.test.js` | FAIL | Expected published/absent; received reused/present. Tracking guard also expected changed, received equal (known negative repro). |
| gap-hunt-durability | 24.13.0 | `node --experimental-vm-modules node_modules/jest/bin/jest.js --config packages/core/jest.config.mjs --runInBand --runTestsByPath packages/core/.test-build/test/gap-hunt-durability-crash.test.js packages/core/.test-build/test/gap-hunt-durability-fold.test.js packages/core/.test-build/test/gap-hunt-durability-storage.test.js packages/core/.test-build/test/gap-hunt-portability-alias.test.js` | FAIL | SqliteError: disk I/O error (hard-file-alias probe); 3 durability suites passed. |
| gap-hunt-durability | 26.12.1 | `node --experimental-vm-modules node_modules/jest/bin/jest.js --config packages/core/jest.config.mjs --runInBand --runTestsByPath packages/core/.test-build/test/gap-hunt-durability-crash.test.js packages/core/.test-build/test/gap-hunt-durability-fold.test.js packages/core/.test-build/test/gap-hunt-durability-storage.test.js packages/core/.test-build/test/gap-hunt-portability-alias.test.js` | FAIL | SqliteError: disk I/O error (hard-file-alias probe); 3 durability suites passed. |
| gap-hunt-dx | 24.13.0 | `node --experimental-vm-modules node_modules/jest/bin/jest.js --config scratch/gap-hunt/consumer-dx/jest.config.mjs --runInBand` | PASS | Positive checks pass; preserved single mapping compile: TS2305 no exported IAbortSignal (expected failed attempt). |
| gap-hunt-dx | 26.12.1 | `node --experimental-vm-modules node_modules/jest/bin/jest.js --config scratch/gap-hunt/consumer-dx/jest.config.mjs --runInBand` | PASS | Positive checks pass; preserved single mapping compile: TS2305 no exported IAbortSignal (expected failed attempt). |

All recorded commands and exact arguments are retained in [results.json](/pay/home/owner/microdelta-linux-logs/results.json). Each log starts with its exact command. `npm test` on main includes another build, tooling, workspace, experiment and example tests; failure can prevent later phases.

| Branch | Node | Command | Result | First error / failure line | Log |
| --- | --- | --- | --- | --- | --- |
| gap-hunt-contracts | 24.13.0 | `npm ci --no-audit --no-fund` | PASS | — | [log](/pay/home/owner/microdelta-linux-logs/gap-hunt-contracts-node24.13.0/install.log) |
| gap-hunt-contracts | 24.13.0 | `npm run build` | PASS | — | [log](/pay/home/owner/microdelta-linux-logs/gap-hunt-contracts-node24.13.0/build.log) |
| gap-hunt-contracts | 24.13.0 | `compile-tracking` | PASS | — | [log](/pay/home/owner/microdelta-linux-logs/gap-hunt-contracts-node24.13.0/compile-tracking.log) |
| gap-hunt-contracts | 24.13.0 | `repro-tracking` | FAIL | Expected: "changed" | [log](/pay/home/owner/microdelta-linux-logs/gap-hunt-contracts-node24.13.0/repro-tracking.log) |
| gap-hunt-contracts | 24.13.0 | `compile-core` | PASS | — | [log](/pay/home/owner/microdelta-linux-logs/gap-hunt-contracts-node24.13.0/compile-core.log) |
| gap-hunt-contracts | 24.13.0 | `repro-core` | FAIL | Expected published/absent; received reused/present (nullable container guard) | [log](/pay/home/owner/microdelta-linux-logs/gap-hunt-contracts-node24.13.0/repro-core.log) |
| gap-hunt-contracts | 24.13.0 | `scalar-root-types` | PASS | — | [log](/pay/home/owner/microdelta-linux-logs/gap-hunt-contracts-node24.13.0/scalar-root-types.log) |
| gap-hunt-contracts | 26.12.1 | `npm ci --no-audit --no-fund` | PASS | — | [log](/pay/home/owner/microdelta-linux-logs/gap-hunt-contracts-node26.12.1/install.log) |
| gap-hunt-contracts | 26.12.1 | `npm run build` | PASS | — | [log](/pay/home/owner/microdelta-linux-logs/gap-hunt-contracts-node26.12.1/build.log) |
| gap-hunt-contracts | 26.12.1 | `compile-tracking` | PASS | — | [log](/pay/home/owner/microdelta-linux-logs/gap-hunt-contracts-node26.12.1/compile-tracking.log) |
| gap-hunt-contracts | 26.12.1 | `repro-tracking` | FAIL | Expected: "changed" | [log](/pay/home/owner/microdelta-linux-logs/gap-hunt-contracts-node26.12.1/repro-tracking.log) |
| gap-hunt-contracts | 26.12.1 | `compile-core` | PASS | — | [log](/pay/home/owner/microdelta-linux-logs/gap-hunt-contracts-node26.12.1/compile-core.log) |
| gap-hunt-contracts | 26.12.1 | `repro-core` | FAIL | Expected published/absent; received reused/present (nullable container guard) | [log](/pay/home/owner/microdelta-linux-logs/gap-hunt-contracts-node26.12.1/repro-core.log) |
| gap-hunt-contracts | 26.12.1 | `scalar-root-types` | PASS | — | [log](/pay/home/owner/microdelta-linux-logs/gap-hunt-contracts-node26.12.1/scalar-root-types.log) |
| gap-hunt-durability | 24.13.0 | `npm ci --no-audit --no-fund` | PASS | — | [log](/pay/home/owner/microdelta-linux-logs/gap-hunt-durability-node24.13.0/install.log) |
| gap-hunt-durability | 24.13.0 | `npm run build` | PASS | — | [log](/pay/home/owner/microdelta-linux-logs/gap-hunt-durability-node24.13.0/build.log) |
| gap-hunt-durability | 24.13.0 | `compile-core` | PASS | — | [log](/pay/home/owner/microdelta-linux-logs/gap-hunt-durability-node24.13.0/compile-core.log) |
| gap-hunt-durability | 24.13.0 | `repro-core` | FAIL | SqliteError: disk I/O error | [log](/pay/home/owner/microdelta-linux-logs/gap-hunt-durability-node24.13.0/repro-core.log) |
| gap-hunt-durability | 26.12.1 | `npm ci --no-audit --no-fund` | PASS | — | [log](/pay/home/owner/microdelta-linux-logs/gap-hunt-durability-node26.12.1/install.log) |
| gap-hunt-durability | 26.12.1 | `npm run build` | PASS | — | [log](/pay/home/owner/microdelta-linux-logs/gap-hunt-durability-node26.12.1/build.log) |
| gap-hunt-durability | 26.12.1 | `compile-core` | PASS | — | [log](/pay/home/owner/microdelta-linux-logs/gap-hunt-durability-node26.12.1/compile-core.log) |
| gap-hunt-durability | 26.12.1 | `repro-core` | FAIL | SqliteError: disk I/O error | [log](/pay/home/owner/microdelta-linux-logs/gap-hunt-durability-node26.12.1/repro-core.log) |
| gap-hunt-dx | 24.13.0 | `npm ci --no-audit --no-fund` | PASS | — | [log](/pay/home/owner/microdelta-linux-logs/gap-hunt-dx-node24.13.0/install.log) |
| gap-hunt-dx | 24.13.0 | `npm run build` | PASS | — | [log](/pay/home/owner/microdelta-linux-logs/gap-hunt-dx-node24.13.0/build.log) |
| gap-hunt-dx | 24.13.0 | `dx-compile` | PASS | — | [log](/pay/home/owner/microdelta-linux-logs/gap-hunt-dx-node24.13.0/dx-compile.log) |
| gap-hunt-dx | 24.13.0 | `dx-runtime` | PASS | — | [log](/pay/home/owner/microdelta-linux-logs/gap-hunt-dx-node24.13.0/dx-runtime.log) |
| gap-hunt-dx | 24.13.0 | `dx-types` | PASS | — | [log](/pay/home/owner/microdelta-linux-logs/gap-hunt-dx-node24.13.0/dx-types.log) |
| gap-hunt-dx | 24.13.0 | `dx-lint` | PASS | — | [log](/pay/home/owner/microdelta-linux-logs/gap-hunt-dx-node24.13.0/dx-lint.log) |
| gap-hunt-dx | 24.13.0 | `dx-reflection` | PASS | — | [log](/pay/home/owner/microdelta-linux-logs/gap-hunt-dx-node24.13.0/dx-reflection.log) |
| gap-hunt-dx | 24.13.0 | `dx-known-failed-attempt` | FAIL | packages/core/dist/api/microdelta.alpha.d.ts(9,15): error TS2305: Module '"@microdelta/supervision"' has no exported member 'IAbortSignal'. | [log](/pay/home/owner/microdelta-linux-logs/gap-hunt-dx-node24.13.0/dx-known-failed-attempt.log) |
| gap-hunt-dx | 26.12.1 | `npm ci --no-audit --no-fund` | PASS | — | [log](/pay/home/owner/microdelta-linux-logs/gap-hunt-dx-node26.12.1/install.log) |
| gap-hunt-dx | 26.12.1 | `npm run build` | PASS | — | [log](/pay/home/owner/microdelta-linux-logs/gap-hunt-dx-node26.12.1/build.log) |
| gap-hunt-dx | 26.12.1 | `dx-compile` | PASS | — | [log](/pay/home/owner/microdelta-linux-logs/gap-hunt-dx-node26.12.1/dx-compile.log) |
| gap-hunt-dx | 26.12.1 | `dx-runtime` | PASS | — | [log](/pay/home/owner/microdelta-linux-logs/gap-hunt-dx-node26.12.1/dx-runtime.log) |
| gap-hunt-dx | 26.12.1 | `dx-types` | PASS | — | [log](/pay/home/owner/microdelta-linux-logs/gap-hunt-dx-node26.12.1/dx-types.log) |
| gap-hunt-dx | 26.12.1 | `dx-lint` | PASS | — | [log](/pay/home/owner/microdelta-linux-logs/gap-hunt-dx-node26.12.1/dx-lint.log) |
| gap-hunt-dx | 26.12.1 | `dx-reflection` | PASS | — | [log](/pay/home/owner/microdelta-linux-logs/gap-hunt-dx-node26.12.1/dx-reflection.log) |
| gap-hunt-dx | 26.12.1 | `dx-known-failed-attempt` | FAIL | packages/core/dist/api/microdelta.alpha.d.ts(9,15): error TS2305: Module '"@microdelta/supervision"' has no exported member 'IAbortSignal'. | [log](/pay/home/owner/microdelta-linux-logs/gap-hunt-dx-node26.12.1/dx-known-failed-attempt.log) |
| main | 24.13.0 | `npm ci --no-audit --no-fund` | PASS | — | [log](/pay/home/owner/microdelta-linux-logs/main-node24.13.0/install.log) |
| main | 24.13.0 | `npm run build` | PASS | — | [log](/pay/home/owner/microdelta-linux-logs/main-node24.13.0/build.log) |
| main | 24.13.0 | `npm test` | PASS | — | [log](/pay/home/owner/microdelta-linux-logs/main-node24.13.0/test.log) |
| main | 26.12.1 | `npm ci --no-audit --no-fund` | PASS | — | [log](/pay/home/owner/microdelta-linux-logs/main-node26.12.1/install.log) |
| main | 26.12.1 | `npm run build` | PASS | — | [log](/pay/home/owner/microdelta-linux-logs/main-node26.12.1/build.log) |
| main | 26.12.1 | `npm test` | PASS | — | [log](/pay/home/owner/microdelta-linux-logs/main-node26.12.1/test.log) |

Reproduction command labels identify exact recorded commands in the linked logs: `compile-*` emits that package’s test files with installed TypeScript; `repro-*` runs all branch-added gap-hunt test files by exact path through that package’s Jest config; `scalar-root-types` runs the added tsd file. DX labels follow its README: full mapping compile, Jest, tsd, lint, reflection diagnostic, and preserved single-facade mapping attempt.

No installation, build or subprocess-launch failure occurred in this matrix. The hard-file-alias I/O failure is an observed probe result; this run does not establish its underlying cause.

Known reproduced results (not fixes):

- Contracts: both Nodes report Tracking 3 failures / 17 passes and core 20 failures / 14 passes. The nullable-container guard fails; the scalar control passes. Core also retains operation-matrix and scalar-root failures. Added scalar-root type contracts pass.
- Durability: both Nodes report 3 durability suites passing, with 12 passes across all four selected suites; the hard-file-alias probe fails with `SqliteError: disk I/O error` (1 failure). This is recorded as a failure, not counted as a successful writer-fencing test.
- DX: both Nodes pass full mapping compile, 3 runtime tests, tsd, lint and the reflection diagnostic. The preserved single-facade mapping attempt fails with TS2305 as documented.

Main Node 24.13.0: PASS; first failure: —. Selected emitted summaries: Test Suites: 1 passed, 1 total; Tests:       16 passed, 16 total; Test Suites: 1 passed, 1 total; Tests:       12 passed, 12 total; Test Suites: 2 passed, 2 total; Tests:       59 passed, 59 total; Test Suites: 3 passed, 3 total; Tests:       73 passed, 73 total

Main Node 26.12.1: PASS; first failure: —. Selected emitted summaries: Test Suites: 1 passed, 1 total; Tests:       16 passed, 16 total; Test Suites: 1 passed, 1 total; Tests:       12 passed, 12 total; Test Suites: 2 passed, 2 total; Tests:       59 passed, 59 total; Test Suites: 3 passed, 3 total; Tests:       73 passed, 73 total
