# Independent returned-output binding probe

Baseline c5802da; generated workspace alpha declarations, Node24.22.1 Darwin arm64. No production fixes. Complements contracts worker's declared-input fixture with member and forwarded-argument bindings.

Four separate-process assertions yield two failures and two passes:

- Scalar member output `{ value: member.selected.score }` retains its exact reference on identical restart (positive control).
- Member subtree output `{ value: member.selected }` republishes with a new exact reference despite equal decoded data. Miss: `unavailable materialized-output at member`, binding `[member]`, address property `selected`, selection MDS1 materialized-output.
- Parent that calls a supplied step with `forward.member(['selected'])` retains its exact reference on identical restart (equal-output cutoff control).
- That supplied child returns `{ value: args[0] }`. After two identical process runs, History contains two completed results for its subject `description`; expectation is one. Thus the retained parent alone would hide unnecessary child execution/publication.

`packages/resolution/src/current.ts:216–222` accepts current argument/member facts only when request.kind is `selected`; these recorded observations are `materialized-output`. This supports the same current-fact selection limitation as the contracts worker's input fixture. No incorrect decoded value was observed; this is avoidable recomputation/publication and loss of exact child reference retention, not demonstrated stale reuse.

Commands from repository root after npm ci/build:packages:

```sh
node node_modules/typescript/bin/tsc -p scratch/gap-hunt/consumer-dx/tsconfig.all.json
node node_modules/typescript/bin/tsc -p packages/core/tsconfig.test.json
node --experimental-vm-modules node_modules/jest/bin/jest.js --config packages/core/jest.config.mjs --runInBand --runTestsByPath packages/core/.test-build/test/gap-hunt-dx-output-bindings.test.js
node node_modules/eslint/bin/eslint.js scratch/gap-hunt/consumer-dx/output-bindings.ts packages/core/test/gap-hunt-dx-output-bindings.test.ts
```

Strict compilation and type-aware lint pass; runtime tests intentionally fail2/4. Scope excludes changed-member/argument cases, Linux execution, paid providers, full materialization or general reuse qualification. Separate processes share only SQLite history. SQL inspection is test tooling using Node Machine; it is not consumer runtime policy.

# DOM-2 generated declaration boundary

`contracts.test-d.ts` now independently compiles facade-only implicit lookup for `currentRun()` (environment/analysis) and `currentExecution()` (abort signal, operation, send, sleepUntil), using generated alpha aliases. The test does not call those accessors outside a live scope; previously executed scope/operation suites cover outside/closed/concurrent lifetime semantics.

The declared IRunContext itself contains runId, analysis and environment; execution facilities use the separate implicit currentExecution accessor. Storage/services are supplied through workspace/declaration/helper composition, not a general service-container field on IRunContext. DOM-2 does not settle exact constructor names or demand one TypeScript interface. This is a residual breadth question for the target wording, not a demonstrated failure or grounds to add a speculative service-container API. Runtime policy remains outside Machine; this probe introduces no host or persistence policy abstraction.
