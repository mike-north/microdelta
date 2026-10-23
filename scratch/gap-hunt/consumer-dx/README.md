# F fresh-eyes synthetic consumer replay

Codex worker (gpt-6.1-sol), operating for Mike North. Baseline c5802da.
The initial docs/declarations-only attempt precedes implementation-source reading.
Current pipeline supports four synthetic members with cap2range bisection; it
executes no provider calls. See FINDINGS.md for corrected interpretation and limits.
All paths/configs are checkout-relative. From repository root after npm ci:

```sh
npm run build:packages
node node_modules/typescript/bin/tsc -p scratch/gap-hunt/consumer-dx/tsconfig.all.json
node --experimental-vm-modules node_modules/jest/bin/jest.js --config scratch/gap-hunt/consumer-dx/jest.config.mjs --runInBand
node node_modules/tsd/dist/cli.js scratch/gap-hunt/consumer-dx --files contracts.test-d.ts
node node_modules/eslint/bin/eslint.js --config scratch/gap-hunt/consumer-dx/eslint.config.mjs scratch/gap-hunt/consumer-dx/pipeline.ts scratch/gap-hunt/consumer-dx/reflection-probe.ts
```

Expected positive evidence: Jest3/3, tsdpass, compile/lintpass. Runtime tests
create only synthetic SQLite stores beneath this owned scratch directory.
Reflection boundary diagnostic:
`node scratch/gap-hunt/consumer-dx/dist/reflection-probe.js`.

Preserved failed consumer attempts (not production regressions):

```sh
node node_modules/typescript/bin/tsc -p scratch/gap-hunt/consumer-dx/tsconfig.single.json
```

Expected TS2305 from facade-only alpha mapping. `first-attempt.ts` and
`failed-inference.ts` capture the initial inference problem; explicit
outcome.fresh<IListing> fixes it in pipeline.ts. Missing alpha exports are
intentional PKG-003 privacy. The full mapping recipe includes all11packages for
convenience, not a claim that every transitive consumer needs all11.
The initial reflection-attempt.ts also returned an unsupported scalar root;
the corrected pipeline returns a supported object root and explicitly serializes
selected fields. Repeated open snapshots across separate runs do early member
work; this is not native single-live-run streaming pagination.

M7 diagnostic/control replay: `node scratch/gap-hunt/consumer-dx/repro-m7-controls.mjs` performs clean install/build by default, strict compile, type-aware lint and the existing three Jest controls. These controls cover authored cumulative snapshots, not full M7 acceptance. See [M7-WORKFLOW-PICKUP.md](M7-WORKFLOW-PICKUP.md).
