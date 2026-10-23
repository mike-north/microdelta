# Synthetic scale gap reproductions

Baseline c5802daca4a0bb8ea91159854d84eddcfa5215b6. Node24.22.1, macOS arm64.
No provider calls. All records are invented. No absolute latency SLA is asserted.

Implementer: Mike North, assisted by Codex.
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
