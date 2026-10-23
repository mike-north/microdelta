# Accepted scalar TResult versus unsupported runtime root

Both ordinary `memo` and `source<TResult>` accept string, number, boolean, null and
undefined result types through generated alpha declarations. Actual execution
rejects every bare atom with `ResolutionError` code `unsupported-result`: a
completed-result payload needs a record or array root. Wrapping each atom in
`{ value }` works, including present-undefined.

This is a **Medium API/DX inconsistency**, not a claim that full scalar lazy
navigation was promised. M3's selected navigation is explicitly bounded to record
and array roots. The accepted authoring types and current facade documentation do
not make this output-root restriction visible. Either enforce/document the root
restriction before work starts or deliberately support scalar result roots.
CMP-8's distinction between skipped/no-value and success returning undefined is
also relevant to the intended result contract.

## Replay

From the repository root after `npm ci` and `npm run build`:

```sh
npx tsc -p packages/core/tsconfig.test.json
npm run test:types --workspace microdelta
npx eslint packages/core/test/gap-hunt-contracts-scalar-roots.test.ts
node --experimental-vm-modules node_modules/jest/bin/jest.js --config packages/core/jest.config.mjs --runInBand --runTestsByPath packages/core/.test-build/test/gap-hunt-contracts-scalar-roots.test.js
```

Strict TypeScript and type-aware lint pass. The complete core tsd suite passes,
including `test-d/gap-hunt-contracts-scalar-roots.test-d.ts`, which compiles all ten
accepted source/memo atom declarations against generated alpha declarations.
The runtime suite intentionally reports **10 failures, 5 passing wrapped controls**.
See `scalar-root-results.log` for every atom's exact rejection and
`scalar-root-types.log` for the type-check result.

No production changes or unsupported native data are involved. This matrix is
separate from the nullable-container false-reuse reproduction.

Implementer: Codex worker (gpt-6.1-sol), operating for Mike North.
Agent assistance: Codex authored the synthetic reproductions, type assertions and
replay instructions, and ran the checks. Supervisor review is separate.
