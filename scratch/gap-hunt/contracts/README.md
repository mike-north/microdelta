# Nullable-container guard false reuse

Pinned baseline: `c5802daca4a0bb8ea91159854d84eddcfa5215b6`.

A memo reads only a tracked declared input's nullable container guard. After the
first run publishes `{ state: 'present' }`, a fresh composition replaces that
container with `null` or omits its property. Closing and reopening SQLite still
returns the old result as `reused`. The expected result is a newly published
`{ state: 'absent' }`.

The facade reproduction contains no hidden external influence or lint suppression.
Its scalar boolean control passes. The Tracking reproduction shows that the
initial container guard records **zero observations**; an explicit `!== null`
comparison has the same gap. Explicit own presence correctly detects deletion
(and correctly treats present-null as still present).

Governing obligations: TRK-4 captures branch influences; TRK-5 observes performed
value reads; TRK-8 invalidates a changed tracked guard. CMP-9's sandbox disclaimer
does not reject this ordinary tracked-input case. The reproduction proves both reopened durable-store behavior within one process
and two independent-process cases. It does not claim power-loss evidence.

## Replay

From the repository root:

```sh
npm ci --no-audit --no-fund
npm run build
npx tsc -p packages/tracking/tsconfig.test.json
npx tsc -p packages/core/tsconfig.test.json
npx eslint packages/tracking/test/gap-hunt-contracts-container-guard.test.ts packages/core/test/gap-hunt-contracts-container-guard.test.ts
node --experimental-vm-modules node_modules/jest/bin/jest.js --config packages/tracking/jest.config.mjs --runInBand --runTestsByPath packages/tracking/.test-build/test/gap-hunt-contracts-container-guard.test.js
node --experimental-vm-modules node_modules/jest/bin/jest.js --config packages/core/jest.config.mjs --runInBand --runTestsByPath packages/core/.test-build/test/gap-hunt-contracts-container-guard.test.js
```

Install, build, strict TypeScript, and type-aware ESLint pass. The intentionally
red Tracking suite reports 3 failures and 1 positive-control pass; the facade suite
reports 4 failures (two reopened-store cases and two independent-process cases)
and 1 scalar-control pass. Exact failure output is retained
beside this file as `container-guard-results.log` and
`facade-container-guard-results.log`.

No production change is included. Tests are assertion-first gap evidence.

Implementer: Codex worker (gpt-6.1-sol), operating for Mike North.
Agent assistance: Codex authored the synthetic reproduction and ran its checks;
supervisor review and any fix are separate.
