# PR #171 exact-head reproduction review

Target: `ba497cbd903a76196ea0eff9d77b46f77fd22233` (`codex/issue-155`). New isolated worktree/branch `gap-hunt-review-171` starts exactly at that head. No production changes, fixes, PR comments, approvals or merge actions. Implementer: Codex worker (gpt-6.1-sol).

## Observed outcomes

- Original observer component suite: **2 pass / 2 diagnostic failures**, unchanged from `9267a44`. Explicit null comparison and explicit own-presence control pass. The null/undefined truthiness cases stop at their historical `captured.observations.length === 0` assertion because the repaired implementation records one bounded `container-kind` fact. These raw failures remain preserved in `component.log`; they are not claimed green.
- Separately named component supplement: **2/2 pass**. Only the diagnostic expectation is replaced with one `container-kind` fact at `detail`; original `captured.value === present` and `compareCurrent(...).kind === changed` expectations remain. This reaches the semantic assertion blocked in the unchanged suite.
- Original durable facade suite: **5/5 pass**: two reopened-store record→null/missing cases, scalar boolean control, and two independent-process record→null/missing cases. Previously four red / one control.
- Original fresh-process operation oracle: **13/13 pass**: typeof, Array.isArray diagnostic, nullish, optional nested transitions and historical selected-leaf identity rebinding. Previously six red / seven green. Array.isArray remains an explicitly labelled adversarial extension outside the documented lint allowlist; its pre-existing documented suppression is unchanged.
- Fresh `npm ci`, generated package declaration build, Tracking and Core strict type checks, both test compilations, and targeted type-aware lint pass. No broad repository rerun is claimed.

## Source and harness boundary

Five original test/helper files were copied verbatim from `9267a44` after inspecting imports and worker dependencies. `copied-test-provenance.json` records their SHA256 checksums and byte-equality verification. Component needs only the generated Value declaration and Tracking source; facade suite needs its guard worker, existing Core source and generated sibling declarations; operation matrix needs its operation worker and the same supported facade dependencies. No helper from another branch, old generated declaration, assertion edit, provider call, or child-process transport adaptation was used.

Supplement is `packages/tracking/test/gap-hunt-review-171-invalidation.test.ts`. It is an additional named test, not a rewrite of the original suite. All other additions are evidence or the original reproduction files. Fresh local npm workspace install/build keeps sibling consumption on generated declarations. Host details are in `environment.json`; no Linux or different-Node-version execution is claimed.

## Commands

Run from this worktree root; stdout/stderr logs are adjacent to this report.

```sh
npm ci --no-audit --no-fund
npm run build:packages
npx tsc -p packages/tracking/tsconfig.test.json
npx tsc -p packages/core/tsconfig.test.json
node --experimental-vm-modules node_modules/jest/bin/jest.js --config packages/tracking/jest.config.mjs --runInBand --verbose --runTestsByPath packages/tracking/.test-build/test/gap-hunt-contracts-container-guard.test.js
node --experimental-vm-modules node_modules/jest/bin/jest.js --config packages/core/jest.config.mjs --runInBand --verbose --runTestsByPath packages/core/.test-build/test/gap-hunt-contracts-container-guard.test.js packages/core/.test-build/test/gap-hunt-contracts-operation-matrix.test.js
node --experimental-vm-modules node_modules/jest/bin/jest.js --config packages/tracking/jest.config.mjs --runInBand --runTestsByPath packages/tracking/.test-build/test/gap-hunt-review-171-invalidation.test.js
npm run check:types --workspace @microdelta/tracking
npm run check:types --workspace microdelta
npx eslint packages/tracking/test/gap-hunt-contracts-container-guard.test.ts packages/tracking/test/gap-hunt-review-171-invalidation.test.ts packages/core/test/gap-hunt-contracts-container-guard.test.ts packages/core/test/gap-hunt-contracts-guard-worker.ts packages/core/test/gap-hunt-contracts-operation-matrix.test.ts packages/core/test/gap-hunt-contracts-operation-worker.ts
```

The unchanged component command exits1 for the two historical diagnostic assertions. Every other listed command exits0. Raw logs distinguish those outcomes; no aggregate green claim hides the component diagnostics.
