# Track D durable emitted-artifact controls

Implementer: Codex worker (gpt-6.1-sol), operating for Mike North.

Production baseline: `c5802daca4a0bb8ea91159854d84eddcfa5215b6`. This follows the observer-only probe and source qualification at `930f5e9bec473f3434a08dfd555de31908cae473`; no production changes are included.

The six Jest cases in `packages/core/test/gap-hunt-contracts-artifact-durable.test.ts` each start a tiny independent SQLite store. Three separate Node processes execute cold baseline, changed variant and repeated variant. Each process creates the same facade declarations, structural identities, environment and logical store, and closes the workspace. Distinct request keys prevent in-run memo sharing from masquerading as durable reuse.

| Variant | Cold bodies | Changed bodies | Changed exact reference | Score | Repeated bodies/reference |
| --- | --- | --- | --- | --- | --- |
| Unchanged emitted modules | 1 | 0 | Same as baseline | 6 | 0 / same as changed |
| Transitive declared imported leaf body `*2` → `*3` | 1 | 1 | Different from baseline | 9 | 0 / same as changed |
| Dependency version metadata `1.0.0` → `2.0.0` alone | 1 | 0 | Same as baseline | 6 | 0 / same as changed |
| Emitted function name | 1 | 1 | Different from baseline | 6 | 0 / same as changed |
| Emitted formatting only | 1 | 1 | Different from baseline | 6 | 0 / same as changed |
| Emitted comment only | 1 | 1 | Different from baseline | 6 | 0 / same as changed |

`artifact-durable-results.json` records actual locators, counts, results and before/after emitted leaf hashes for all six cases (18 child processes). `artifact-durable-results.log` records 6/6 passing; `artifact-durable-check.log` records strict TypeScript and type-aware lint. Source fixtures compile as ordinary checked TS; the test changes only a uniquely matched emitted leaf token, preserving the exported callable shape. For rename it retains the `dependency` named export via an explicit alias. The worker and intermediary bytes stay unchanged, and leaf bytes stay identical in the metadata-only case.

## Supported capture boundary

The worker imports the leaf through an intermediary module's re-export, so the module graph is worker → intermediary → leaf. Both imported implementations are registered in explicit facade helper slots before composition. The memo invokes `helpers.intermediary(helpers.dependency, 3)`: the intermediary receives a current tracked leaf parameter and invokes it normally. This makes both implementations observed; it does not hide a raw imported closure behind one tracked outer function. Every callback passes the existing capture lint without suppression or casts. A test-only declared trace helper, identical in all variants, emits a body marker.

This is a transitive imported dependency that is explicitly declared and tracked. It does not establish automatic discovery of hidden untracked transitive imports or arbitrary closure captures; those remain outside TRK-4/CMP-3. Package version metadata alone is not read by the computation. Comments and formatting here exist in emitted function text; TypeScript source edits removed by compilation are not claimed to invalidate.

The original observer-only cases remain correctly qualified in `TRACK-A-D-SOURCE-REVIEW.md`. These new controls add the previously missing durable re-execution/exact-reference evidence for transitive imports, metadata bumps, emitted comments/formatting and renamed functions. They show conservative reruns for the latter three, without classifying the specified emitted-text implementation policy as a defect.

## One command

From a clean checkout:

```sh
node scratch/gap-hunt/contracts/reproduce.mjs artifact-durable
```

It installs dependencies, builds generated declarations/packages, compiles strict test sources and runs only the six durable variants. For an installed checkout, the focused command actually executed is:

```sh
npm run test:unit -w microdelta -- --runTestsByPath .test-build/test/gap-hunt-contracts-artifact-durable.test.js --verbose
```

Set `MICRODELTA_ARTIFACT_EVIDENCE` to an absolute writable path to retain actual locator/count/hash evidence. Temporary stores and copied emitted modules are removed in `finally`. No paid provider, publication or issue mutation is involved.
