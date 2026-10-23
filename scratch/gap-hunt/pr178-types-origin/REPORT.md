# PR 178 input invariance and forged-origin assertion review

Bounded PASS at exact head `efd50c63eb62b8865cd76587673f6d3d56c9732a`, compared with `577644f188a80bf7b081804fd63fe23ba263f88f`. Owned worktree/branch `gap-hunt-pr178-types-origin`. Review only; no product fixes, comments, PR, commit or push. Current body read from main control `pr178-efd50c6-live.json`.

The analysis input phantom is now a function-valued property consuming and producing `TInputs`. Under strict function parameter checks this makes the contract invariant; `execute` also retains `NoInfer<TInputs>` for its actual input object. `graphOf<TInputs>` preserves inspection without erasing the input contract. The optional phantom remains type-only; this is type safety for supported typed callers, not runtime schema validation or a guarantee against casts/any/JavaScript.

Checked-in tsd passes. Independent `extra.test-d.ts` also passes: required string analysis cannot widen to `object`, unknown-title, optional-title or string/number-title analysis; missing, numeric and `{length:99}` title execution are rejected; generic execution rejects numeric input while string input and generic/direct graph inspection compile. Reverting only the phantom to its old covariant `TInputs` form makes the checked-in tsd fail with exactly one error: line 26 accepts the unsafe widening. Source bytes were restored, then the same checked-in tsd passed. No broad escape hatch or compiler relaxation was used.

The forged-origin negative now uses the actual constructor call as the callback passed to `toThrow`, without its old matching fallback error. The normal tooling test extracts that exact checked-in assertion, transpiles the actual protocol and a one-site mutant, and requires real pass/mutant failure. Independent `origin-witness.mjs` additionally verifies that real protocol rejects with ownership error, mutant successfully builds the forged edge as `{key:'value',kind:'input',slot:'forged'}`, and the checked-in assertion kills it with `matcherResult.pass === false` and `Received function did not throw`. Thus the witnessed failure is not import/transpilation failure or an unrelated exception. The source slice extraction depends on checked-in fixture formatting and asserts its markers/site; this is a bounded fixture mutation witness, not a proof of every forged input shape.

## Executed commands

All from this owned worktree (Node v24.14.0):

- `npm ci --no-audit --no-fund`: exit 0 (`install.log`).
- `npm run build:packages`: exit 0 (`build.log`); generated package declarations used for type checks.
- `npx tsd --typings experiments/exp-authoring/src/protocol.ts --files experiments/exp-authoring/test-d/protocol.test-d.ts`: exit 0 (`official-tsd.log`).
- `npx tsd --typings experiments/exp-authoring/src/protocol.ts --files scratch/gap-hunt/pr178-types-origin/extra.test-d.ts`: exit 0 (`extra-tsd.log`).
- Same checked-in tsd with only old covariance restored temporarily: expected exit 1 / exactly one unsafe-widening error (`covariant-mutant-tsd.log`, `covariant-mutant-receipt.json`). `finally` restored exact bytes.
- Same checked-in tsd after restoration: exit 0 (`restored-tsd.log`).
- `node --test tooling/authoring-origins.test.mjs`: 1 pass / 0 fail (`origin-tooling.log`); real protocol passes, mutant killed.
- `node scratch/gap-hunt/pr178-types-origin/origin-witness.mjs`: exit 0 (`origin-witness.json`), four explicit discriminator assertions.
- `npx tsc -p experiments/exp-authoring/tsconfig.test.json`: exit 0 (`test-compile.log`).
- `node --experimental-vm-modules node_modules/jest/bin/jest.js --config experiments/exp-authoring/jest.config.mjs --runInBand --testPathPatterns protocol.test --json --outputFile scratch/gap-hunt/pr178-types-origin/protocol-jest.json`: 6 pass / 0 fail / 0 pending / 0 runtime errors.

`receipt.json` pins reviewed source hashes and outcomes. Tracked protocol source has no residual diff. Supplementary tests and receipts are local scratch evidence only. No full repository gates, full experiment restart suite, original gap reruns, Linux qualification, current-subject repair acceptance or broader DSL adoption claim. Separate workers own current-subject/runtime/capture review. No paid provider execution.

## Later-head source qualification

Head `648b0aa89d1ea20b100c5e2b8591b3d25d55781b` changes only three wording lines in `experiments/exp-authoring/decision.md` from reviewed `efd50c63eb62b8865cd76587673f6d3d56c9732a`. Parent and contract reviewer verified the delta; this reviewer independently checked the changed-path set. Runtime, input types, tests and tooling are unchanged, so the bounded findings apply to those unchanged bytes at the later head. No rerun was performed or claimed. Parent reviewed and accepted these bounded findings; supervisory overall PR acceptance remains separate.
