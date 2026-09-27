# EXP-6: flat-record observation theorem pilot

This pilot addresses [EXP-6](../../docs/spec/experiments.md) and [issue #9](https://github.com/mike-north/microdelta/issues/9). Its proof target is deliberately smaller than EXP-2's supported domain. It does not decide runtime reuse, source freshness, or publication.

## Proof target, fixed before the implementation

A key is a sequence of UTF-16 code units. An atom is a distinct tag for `undefined`, `null`, a boolean, a Unicode-scalar string, or an opaque canonical numeric token. Lean's string type cannot represent a lone surrogate as a text value, so the bridge rejects such values; this theorem does not cover EXP-2's full UTF-16 string-value domain. Keys remain explicit code-unit lists, including surrogate units. A record is an ordered list of **unique** string-keyed own data entries with a null prototype and scalar atom values. Duplicate keys and non-data or non-scalar values are rejected at the translation boundary. There are no arrays, nested paths, symbols, accessors, or inherited members in this theorem.

`normalForm` sorts entries by key code-unit order without changing their values. Independently, `readValue` means the selected own entry's atom or `undefined` when absent; `readOwn` means whether an entry with that key exists. For any two supported records and one `Property(key)` path:

> If their sorted normal forms are equal, their value-read outcomes and own-presence outcomes for that key are equal.

The theorem gives only the direction from structural normal-form equality to equal selected facts; it does not claim the converse or that the sort algorithm implements every EXP-2 byte. It is not about SHA-256 equality. Applying it to an equal hash would separately assume collision resistance. The Lean proof must check with no `sorry` or new axioms; `#print axioms` records its kernel trust dependencies. The model and TypeScript comparison remain separate evidence.

## Counterexamples and scope controls

| Case | Expected fact | Incorrect generalization exposed |
| --- | --- | --- |
| `{b: 2, a: 1}` versus `{a: 1, b: 2}` | Equal unordered normal form and selected value/own facts; different explicit `Object.keys` order | Including key enumeration in the theorem |
| Missing `x` versus own `x: undefined` | Equal `Property('x')` value read, different own-presence | Treating value read as existence |
| `Property('0')` on an object versus `Index(0)` on an array | Distinct structured operations; array case outside this algebra | Conflating numeric property and positional index |
| `0` versus empty string | Distinct value facts despite equal falsy coercion | Encoding truthiness instead of value |
| Duplicate key or getter | Translation error before the model | Guessing after a lossy parse or invoking author code |

The theorem does not cover EXP-2's arrays, sparse holes, prototypes, nested paths, materialization, selected-content loading, key enumeration, or snapshot transport. Their existing tests remain the relevant evidence. A stronger model requires an observed gap that this pilot cannot address.

## Reproduction and observed evidence

The pin is the official [Lean 4.34.1 release](https://github.com/leanprover/lean4/releases/tag/v4.34.1), recorded in [`lean-toolchain`](lean-toolchain). The macOS ARM release archive `lean-4.34.1-darwin_aarch64.tar.zst` had SHA-256 `65f22a4f047738ec742667b3247e836a86ebf06eabc12655c3dee00637e37866` when downloaded for this run. It was extracted to temporary storage; no Mathlib, global installation, or repository-wide Lean CI wiring was added. The archive was 562 MB and the extracted toolchain occupied 2.7 GB on this host. A different platform should select its matching official archive for the same version.

On macOS ARM with `gh` and `zstd` available, the temporary setup is:

```sh
mkdir -p /private/tmp/microdelta-lean-v4.34.1
gh release download v4.34.1 --repo leanprover/lean4 --pattern lean-4.34.1-darwin_aarch64.tar.zst --dir /private/tmp/microdelta-lean-v4.34.1
shasum -a 256 /private/tmp/microdelta-lean-v4.34.1/lean-4.34.1-darwin_aarch64.tar.zst
zstd -dc /private/tmp/microdelta-lean-v4.34.1/lean-4.34.1-darwin_aarch64.tar.zst | tar -xf - -C /private/tmp/microdelta-lean-v4.34.1
export EXP6_LEAN=/private/tmp/microdelta-lean-v4.34.1/lean-4.34.1-darwin_aarch64/bin/lean
```

Compare the `shasum` result with the digest above before running the extracted checker.

From the repository root, set `EXP6_LEAN` to the absolute path of that pinned toolchain's `bin/lean`, then run:

```sh
"$EXP6_LEAN" --version
"$EXP6_LEAN" experiments/exp-6/FlatRecord.lean
npx tsc -p experiments/exp-6/tsconfig.test.json
EXP6_LEAN="$EXP6_LEAN" node --experimental-vm-modules node_modules/jest/bin/jest.js --config experiments/exp-6/jest.config.mjs --runInBand
npm run check
npm test
npm run build
```

The assertion-first Lean run failed on the unsolved theorem goal while the reverse-insertion, missing/undefined, and falsey-value controls checked. The TypeScript bridge's first run compiled but all three Jest cases failed at intentional `not implemented` placeholders. With the mechanism completed, Lean exited successfully and `#print axioms` reported only `[propext, Classical.choice, Quot.sound]`; there is no `sorry`, `native_decide`, or new axiom. The optional differential suite passed three tests across 2,285 independently generated cases: zero, one, or two own fields over four ASCII key spellings and six atom examples, queried at each key plus an absent key. Each case compares Lean's direct value/own facts with EXP-2 `observe`, and checks source versus Lean-normalized `encodeValue` equality and observations after EXP-2 normal-form decode. The suite separately checks order-sensitive `keys` and MDS1 snapshot preservation. The Lean corpus does not sample non-ASCII key ordering, though the theorem's key type admits arbitrary UTF-16 code-unit sequences.

Two temporary negative controls were run outside the repository: changing `normalForm` to the identity (and adapting its permutation proof) made the reverse-insertion equality example fail; deriving `readOwn` from whether `readValue` is undefined (and adapting the theorem proof) made the present-undefined own-presence example fail. These failures demonstrate that the concrete controls constrain the model beyond successful compilation. Both mutated files were discarded.

`npm run check`, `npm test`, and `npm run build` passed after `npm ci --offline` restored this worktree's existing EXP-3 dependency. The EXP-6 Lean/Jest comparison is an explicit optional command, so those ordinary gates do not themselves prove the Lean artifact. The proof source, checked assumptions, and differential test must be run together when evaluating this pilot.

## Trust boundary and recommendation

The theorem proves only the structural implication for all records in its declared flat algebra. Its proof relies on Lean's standard permutation and list facts and on the kernel assumptions printed above; it does not prove that the comparator is a complete implementation of EXP-2's canonical byte format, that SHA-256 equality is mathematical equality, or that a TypeScript runtime follows the Lean model. The finite comparison samples agreement for its generated cases, not all JS values. The numeric atom token is opaque in Lean; its translation into a supported JavaScript number is a separately checked bridge assumption. Duplicate keys, accessors, unsupported values, and lone-surrogate text values fail before entering the model. EXP-2's broader tests and contract remain authoritative for those excluded cases.

**Decision: retain the bounded pilot as optional review evidence; do not require Lean in unrelated CI.** The theorem exposed a crisp boundary between unordered equality and order-sensitive keys, and the differential suite challenges its connection to EXP-2. Maintaining this artifact requires rerunning it when the flat-record meaning, normalizer, or Lean version changes, and reviewing the bridge whenever supported scalar translation changes. A small scoped change appears to require roughly half a day of proof/fixture review; Lean-version upgrade effort remains unmeasured. The 2.7 GB local toolchain and the unproven broader value domain outweigh the case for making the checker a mandatory gate at this stage. The supervisor records this bounded selection in the [owning Tracking contract](../../docs/spec/tracking.md); broader proof or production adoption remains a separate decision.
