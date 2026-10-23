# PR179 normalized-boundary follow-up — PARTIAL

Reviewed exact head `e00d5f999725800eb4f574b8e73d7300e71ad44d`. **The original dot-prefix repair passes. The import checker remains partial**, with one literal ESM bypass and one separately demonstrated local-call false positive. This is tooling/source-boundary evidence, not a claim about full CI acceptance or actual imported-module execution.

## Governing boundary and original regression

PKG-004 prohibits relative/deep workspace source bypasses. PKG-007.5 requires equivalent source imports/re-export chains not to bypass the chosen surface; PKG-008 requires source enforcement to diagnose forbidden edges rather than fall through. #145 explicitly requires forbidden dynamic `import()` literals to be refused. Ordinary lexical function calls do not create module edges and must not be classified as imports merely because their parameter is named `require`.

Three original files are byte-identical to published evidence `1a5f108491fa8f6e90f2673e7d5a20b0f4d593a9`: `probes.mjs`, `path-matrix.mjs` and the historical `reproduce.py`; their SHA-256 values are preserved in `original-fixtures.json`. The historical wrapper deliberately expects the old 11-test suite and old red matrix. It remains unchanged as historical evidence and is **not** the acceptance command for the repaired head. The unchanged path matrix's own correct assertions now exit 0: **8/8 pass**, including canonical and dot-prefixed static/dynamic imports for both example and Accounting package roles. Original qualified probes pass **21/21**; the current official suite passes **12/12**.

The new checker uses lexical `path.resolve` for relative targets and handles static imports, re-exports, runtime imports, TypeScript import types/import-equals, and literal `require` calls. Its normalization repairs the previously demonstrated leading-dot spellings, including the official new fixture's TypeScript import-type paths.

## Remaining literal ESM bypass

From virtual importer `examples/contribution-report/src/probe.ts`:

```ts
void import('./%2e%2e/%2e%2e/%2e%2e/packages/history/src/index.js');
```

Node's `import.meta.resolve` with the importer URL resolves this literal to exactly `packages/history/src/index.js`, identical to the rejected canonical `../../../packages/history/src/index.js`. The new checker returns **zero diagnostics** for the encoded literal. The proof resolves without loading or executing that target. No computed-expression support or broader module-resolution policy is needed to demonstrate the mismatch.

The tiny `residual-matrix.mjs` asserts the owning requirement: canonical forbidden source is rejected, equivalent encoded forbidden source must be rejected, and both canonical/encoded local imports remain allowed. Actual outcome is **3 pass / 1 fail, exit 1**. The two local positive controls resolve exactly to `examples/contribution-report/src/local.js`, protecting ordinary local imports from blanket rejection. Absolute and `file:` source literals also receive zero diagnostics in supplementary probes; their path values are generated at runtime and redacted in captured public output. These support the same source-normalization finding. Bare owner-package TypeScript-import/require observations are pre-existing and are not counted as additional #145 dynamic findings.

## Introduced local-call false positive

```ts
export const label = (require: (value: string) => string): string =>
  require('../../../packages/history/src/index.js');
```

This calls a locally supplied function parameter. There is no import/module edge. The current checker nevertheless emits `microdelta/example-source-imports`, `messageId: forbidden`. The exact old config emits zero diagnostics for the same source. `shadowed-require.mjs` preserves the correct zero-diagnostic assertion: **current exit 1, previous config exit 0, restored current exit 1**. This is separate from the encoded-path false negative. The new `CallExpression` visitor matches the identifier spelling without checking lexical scope.

## Sensitivity, restoration and reproduction

The only mutation is temporary replacement of `tooling/context-imports.config.mjs` with its exact `04f9754843fb8eddbc7b8e15b34a3e35d91c1c9a` bytes, committed as an isolated control fixture. Current tests/assertions stay unchanged. That rollback restores the original matrix's **6 pass / 2 fail** and makes the new official boundary fixture fail (**11 pass / 1 fail**). A `finally` restores actual config bytes. Current **12/12**, original **8/8**, and `npm run check:imports` return green after restoration; the encoded and local-call assertions remain correctly red on the restored source.

```sh
python3 scratch/gap-hunt/review-179-repair/reproduce.py
```

The new wrapper verifies original fixture hashes and exact reviewed source, installs dependencies independently, executes official/original/remaining-boundary checks, requires the exact old-config negative outcomes, restores config bytes in `finally`, and reruns restored controls. Its exit 0 means the expected **PARTIAL** evidence matched, including the failing residual requirement assertions. It does not turn those red assertions green or alter the historical red harness. The bare residual command uses `node --experimental-import-meta-resolve scratch/gap-hunt/review-179-repair/residual-matrix.mjs` and intentionally exits 1 until repaired.

Raw local receipts are ignored under `local-results/`; retained captures replace checkout-local absolute paths with `<checkout>`/`<workspace>` where necessary; log trailing whitespace is normalized. No product fix, PR-branch change, comment, approval or merge is part of this work. Node 24.22.1 / macOS arm64; no runtime package build, full repository gates, Linux or provider execution is claimed. The hunt supervisor owns the scoped comment; the repository supervisor owns final acceptance and merge.

Attribution: GPT-6.1 Sol independently executed and packaged this bounded review for Mike North. Parent and durability agents independently reproduced/reviewed the literal boundary finding.
