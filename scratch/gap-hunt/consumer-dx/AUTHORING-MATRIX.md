# Generated-alpha authoring matrix and no-identity custom keys

Baseline c5802da; Node24.22.1 Darwin arm64. Generated alpha entries only; no casts, suppressions, production edits or providers.

## Supported matrix: no gap observed

`authoring-matrix.ts` compiles against generated declarations and a separate-process runtime test passes. One source returns a readonly record-array root through minted `fresh<IRows>` on cold execution, then explicitly retains its eligible previous carrier. An async memo reads array positions and publishes a new array root; a readonly tuple memo preserves number/string positional precision in its consumer. The summary computes independent expected value `{key:'ada',score:6,name:'ada',length:1}` and retains its exact reference after process exit. A keyed template's boolean gate admits Ada and skips Ben in both processes. Initial harness used member.kind instead of documented member.status; that corrected fixture error is not a product finding.

`authoring-matrix.test-d.ts` passes positive/negative generated-alpha contracts: source fresh/retain and readonly indexing, literal tuple length and positional scalar types, declared call result precision; rejection of array mutation/native methods, wrong call arity/undeclared calls, non-string identity field, async/nonboolean gates, fabricated source envelope, wrong result field type and fabricated previous carrier. Native array methods remain deliberately unsupported, not an erased-precision defect.

## Candidate: custom-key-only collections require a fictional identity annotation

COL-1 (`docs/spec/tracking.md:227–232`) allows an explicit custom-key function and states: “No-identity members need an explicit supported key strategy before keyed work proceeds.” CMP-4 (`docs/spec/composition.md:54–57`) says discovery keys members using designated identity **or** a custom-key function. M4 plan lines143–150 repeats the alternative. Neither says every custom-key member schema must include an otherwise unused designated string field.

The suppression-free generated-alpha example in `custom-key.ts` declares members `{id:number,score:number}` and a source of `{members,status:'complete'}`. Template key `member => 'id:'+member.id` is a supported nonempty string key; no traversal index or numeric key is supplied. The source and template **compile**, but `api.template` immediately throws `DefinitionError`: `Template member must fan out over a keyed collection source declaring its designated identity.` The runtime checks collection.identity before considering the explicit custom key (`packages/definition/src/template.ts:403–406`).

Adding `collection:{}` cannot provide the marker: generated `ICollectionOptions` requires identity, and identity fields are limited to string-valued member fields (`packages/definition/src/collection.ts:47–60`). The numeric schema has none. Tsd confirms both empty marker and `identity:'id'` are rejected. The generated template type independently permits the unmarked collection source plus custom key; this is accepted declaration syntax followed by deterministic rejection, rather than a generic TypeScript impossibility.

Positive control: extend only the TypeScript member interface with unused optional `key?:string`, add `collection:{identity:'key'}`, and keep the actual source data unchanged (still no key field) and same custom key. Declaration and complete workspace member execution pass, producing key `id:7` and status succeeded. Thus custom-key runtime machinery handles the data; the mandatory identity marker/schema is the obstruction. Negative control: no identity marker and no custom strategy is rejected. Three runtime assertions: one expected acceptance fails, two controls pass.

### Delivery boundary / classification

EXP-4 decision bounded domain (lines23–32) uses records already containing string id/login, with default id and custom login. M4 plan lines79–82 likewise chooses stable string key and upstream string id. Existing custom-key tests (`packages/core/test/keyed/restart.test.ts:249–270`) prove correspondence after renumbered designated ids; they still use schemas with designated identity. The implemented declaration comment describes a custom key as overriding designated identity. Those delivered fixtures do not test or establish no-string-identity authoring. The current broad COL-1/CMP-4 wording supports this as a bounded authoring gap/target-delivery mismatch; no wrong keying of an admitted collection or stale reuse is demonstrated. If designated identity in every member schema is an intentional mandatory prerequisite, the active contract must say so explicitly. Do not generalize this into arbitrary native-value or arbitrary-key support.

## Replay

After npm ci and build:packages:

```sh
node node_modules/typescript/bin/tsc -p scratch/gap-hunt/consumer-dx/tsconfig.all.json
node node_modules/tsd/dist/cli.js scratch/gap-hunt/consumer-dx --files authoring-matrix.test-d.ts
node --test scratch/gap-hunt/consumer-dx/authoring-matrix.test.mjs
node --experimental-vm-modules node_modules/jest/bin/jest.js --config scratch/gap-hunt/consumer-dx/custom-key.jest.config.mjs --runInBand
node node_modules/eslint/bin/eslint.js scratch/gap-hunt/consumer-dx/authoring-matrix.ts scratch/gap-hunt/consumer-dx/custom-key.ts
```

Strict compile, generated-alpha tsd and type-aware lint pass. Matrix runtime1/1 passes; custom-key runtime1red2green. Logs are `logs/authoring-matrix*.log`, `logs/custom-key*.log`. No Linux replay or broad runtime suite was performed for these new probes.
