# PR171 current-head follow-up

Current target: `c75ca18e060a04034f4868e50dadd65b237e9d38`.
Prior target/evidence: `ba497cbd903a76196ea0eff9d77b46f77fd22233`, preserved unchanged in `REPORT.md` and its original raw logs.

The complete old→new delta is one commit changing only `experiments/exp-nested/test/nested-sqlite.test.ts` (10 additions, 3 deletions). It adds container-kind facts to the expected nested observations, expects one container-kind plus materialized-output observation, and classifies profile record→array as changed rather than incompatible. This is a test-oracle delta, not docs-only. Package runtime, package tests, dependency lockfile and build configuration are byte-identical between the two target heads. Full patch and deterministic changed-path assertion are saved as `current-head-delta.patch` and `current-head-boundary.json`.

Merged the new target into the **review evidence branch only**, preserving the earlier published evidence commit. Existing clean generated declarations remain valid because their sources/build/lockfile did not change. No PR branch mutation.

Affected validation:

```sh
npm run test:exp-nested
npx eslint experiments/exp-nested/test/nested-sqlite.test.ts
```

Both exit0. The first includes strict TypeScript compilation and the complete affected SQLite/process experiment: **12/12 tests pass**. Raw logs: `current-head-nested.log`, `current-head-lint.log`.

The original nullable-container facade5/5, operation13/13, and separate component semantic2/2 results retain their prior execution provenance; they were not rerun for this test-only delta. The unchanged raw component suite still has the two disclosed zero-observation diagnostic failures. This follow-up makes no new aggregate-green claim or full-repository-check claim.
