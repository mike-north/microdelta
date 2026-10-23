# Unrelated-subject candidate query regression

Synthetic captured-SQL diagnostic. No consumer repository/data, live providers, package installation or active database is needed for the Python replay:

```sh
python3 scratch/gap-hunt/consumer-requirements/candidate-query/repro.py
```

Expected current outcome: exit1 after all semantic controls complete; main1000 unrelated same-analysis subjects consumes5100 VM instructions versus allowance1200 (twice main100). `repro.py --diagnostic-only` emits the diagnostic and exits0. This finite generous bound distinguishes the observed corpus scan; it is not a universal constant-time SLA. Python3 standard sqlite3 is required; record the emitted SQLite engine version.

The checked-in capture is exact candidate SQL and table/index DDL from installed published History0.1.0 (entry package microdelta0.2.0) versus mainf43c587 generated History dist. Capture includes hashes of actual index.js/schema.js. `captured-sql.json` contains no private source paths. All rows are invented. This SQL-only diagnostic intentionally bypasses History publication/integrity validation, foreign-key enforcement, and immutable triggers. It verifies predicate eligibility/order and access-path work, not the complete public History operation.

On the captured host, Python SQLite3.54.1 gives baseline69 instructions at populations100/1000/10000, versus main600/5100/50100. Node better-sqlite3 SQLite3.53.0 independently shows the same access-path difference: baseline full analysis/environment/subject/version seek; main analysis-only seek plus temporary sort. Exact outputs are `results.json` and `node-plans.jsonl`. Query plans can change with engines/statistics; validate actual runtime plans when qualifying another platform.

After normal repository dependency installation, strict compiler/type-aware lint/Jest commands are:

```sh
node node_modules/typescript/bin/tsc -p scratch/gap-hunt/consumer-requirements/candidate-query/tsconfig.json
node node_modules/eslint/bin/eslint.js -c scratch/gap-hunt/consumer-requirements/candidate-query/eslint.config.mjs scratch/gap-hunt/consumer-requirements/candidate-query/candidate-query.test.ts
node --experimental-vm-modules node_modules/jest/bin/jest.js --config scratch/gap-hunt/consumer-requirements/candidate-query/jest.config.mjs --runInBand
node scratch/gap-hunt/consumer-requirements/candidate-query/node-plans.mjs
```

Observed: strict compile/lint exit0; Jest3controls pass/1bounded-work assertion fails. Python validates missing subject, matching version, descending candidate order, other-analysis isolation and same-environment versus promoted/unpromoted candidates before emitting. Node plan inspection opens only a fresh in-memory synthetic database. No implementation fix is included. Full facade/public-History integration and causal attribution of consumer timing remain unproved.

The SQL/schema capture is frozen evidence of the measured baseline, not an automatically updating production gate. When repairing production, derive the regression input from the actual repaired production query/schema and validate it against the old broad-query negative control. Editing only `captured-sql.json`, skipping the query, or moving the measured work does not establish a repair. Preserve the old capture as historical evidence.
