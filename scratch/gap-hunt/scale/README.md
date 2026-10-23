# Synthetic scale gap reproductions

Baseline c5802daca4a0bb8ea91159854d84eddcfa5215b6. Node24.22.1, macOS arm64.
No provider calls. All records are invented. No absolute latency SLA is asserted.

Implementer: Codex worker (gpt-6.1-sol), operating for Mike North.
Agent assistance: gpt-6.1-sol authored and ran these bounded probes; supervisor reviews findings.

From repository root:

```sh
npm ci
npm run build:packages
node node_modules/typescript/bin/tsc -p scratch/gap-hunt/scale/tsconfig.json
node scratch/gap-hunt/scale/dist/benchmark.js
node scratch/gap-hunt/scale/dist/context.js
node scratch/gap-hunt/scale/dist/context.js --isolated
node --expose-gc scratch/gap-hunt/scale/dist/context.js --fresh-source
node scratch/gap-hunt/scale/collection-runner.mjs
```

Every invocation uses new PID-suffixed store files. `benchmark.ts` publishes
1k/2k/4k records and measures an independent encodeSnapshot array control.
`large-payload.ts` publishes20k records (~11.2MB JSON); it took155.5s locally.
Only run it when a few minutes of synchronous CPU/storage work is acceptable:

```sh
node --cpu-prof --cpu-prof-dir=scratch/gap-hunt/scale/logs scratch/gap-hunt/scale/dist/large-payload.js
```

`context.ts` runs20batches*100requests with100promise ticks each. Default reuses
one source; `--fresh-source` gives each request a fresh subject in the same store.
`--isolated` wraps workspace.run in one AsyncResource per execution. It controls
that specific workaround, not all possible async-context lifetimes. `--expose-gc`
collects after each batch before reporting heap, outside its measured run time.

`collection-runner.mjs` runs1k/10k/100k members as independent processes and
SIGKILLs after60s/60s/10s.100k timed out during discovery, so it does not establish
member throughput, completed correctness, or recovery at100k. The limit protects
the developer machine; it is not a framework timeout requirement.

Compact original results are checked in under logs. Raw SQLite files, native
binaries and CPU profiles are excluded. The profile summary in FINDINGS.md
identifies dominant sampled frames; `--cpu-prof` regenerates raw evidence.
Wall-clock samples can vary with concurrent machine activity. Strongest evidence
is asymptotic growth plus matched control and sampled hot path, not exact ms.

No performance threshold assertions are added to CI. Strict TypeScript compiles
all probes; a separate scratch type-aware ESLint configuration was run successfully.
Jest/tsd consumer assertions are in the sibling private scratch exercise and are
not a replacement for runtime performance measurement.

Wide/deep strict folds (one chain per member, static declared topology):

```sh
node scratch/gap-hunt/scale/generate-folds.mjs
node node_modules/typescript/bin/tsc -p scratch/gap-hunt/scale/tsconfig.folds.json
node scratch/gap-hunt/scale/fold-runner.mjs
```

The generator covers width1000/depth1 and width1/depth10/50/100. Fold runner
limits each to60s and preserves diagnostics. Generated TS contains no type casts.

Store-layout original command was `node scratch/gap-hunt/scale/store-layout.mjs`
against original unsuffixed stores; only its compact output is retained. Replay
against new benchmark outputs by passing the actual20k payload file and reused
context history file as two arguments. It copies the payload file before VACUUM.
`node --expose-gc .../context.js --fresh-source` is the exact memory command.

Corrected `*-unique-*` logs supersede the earlier context samples: every normal
resolve request now has a fresh request key, and elapsed time is captured before
explicit GC. `benchmark-matched-node24.jsonl` additionally measures encoding the
same record-array shape that publication uses. Earlier snapshots are historical
measurements with the limitations recorded in FINDINGS.md.

Deterministic acceptance readback regression (intentionally fails on baseline):

```sh
node node_modules/typescript/bin/tsc -p packages/core/tsconfig.test.json
node --experimental-vm-modules node_modules/jest/bin/jest.js --config packages/core/jest.config.mjs --runInBand --runTestsByPath packages/core/.test-build/test/gap-hunt-scale/acceptance-readback.test.js
```

The test wraps the actual SQLite port, records returned acceptance rows only
while each new acceptance is acknowledged, and expects[1,1,1]. Baseline returns
[1,2,3]. Full readAcceptances still returns all3 immutable records. This is an
outcome/resource regression target, not a timing assertion or production fix.

Deterministic array-validation regression (intentionally fails on baseline):

```sh
node node_modules/typescript/bin/tsc -p packages/core/tsconfig.test.json
node --experimental-vm-modules node_modules/jest/bin/jest.js --config packages/core/jest.config.mjs --runInBand --runTestsByPath packages/core/.test-build/test/gap-hunt-scale/array-validation.test.js
```

Matched encoding counts [20,40] exposed array slots; real stage+publish counts [1323,5043]. Doubling the fixture exceeds the proposed linear work boundary. The native reflection spy preserves behavior; no timing threshold is used.
