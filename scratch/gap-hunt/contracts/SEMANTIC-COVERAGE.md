# Tracking, Composition, and glossary semantic coverage

Implementer: Codex worker (gpt-6.1-sol), operating for Mike North.

`semantic-clauses.json` retains all 178 non-code paragraph/table blocks of
`tracking.md`, `composition.md`, and `glossary.md`. Thirty named assertion anchors
record the concrete behavior they establish and the actual execution log. This is
an exhaustive clause inventory, **not complete normative certification**: 72 blocks
have bounded semantic assertion evidence, 77 remain explicitly uncovered by this
audit, and 29 are structural text. Every partial block explicitly leaves all
unproved sub-obligations uncovered. An uncovered block is not itself a defect or
proof that the repository lacks a relevant test. Literal requirement-ID references
were never counted as assertion coverage.

Executed in this worktree:

- Tracking observer, lazy-view, output-observation, and the new invalidation matrix:
  73 assertions passed (`semantic-tracking.log`).
- Value package: 50 assertions passed (`semantic-value.log`).
- Definition package: 281 assertions passed (`semantic-definition.log`).
- Assembled M4 keyed, nested, strict-fold, topology suites: 22 assertions passed
  (`semantic-composition.log`), including separate processes and SQLite stores.
- New precision matrix: strict TypeScript compilation and type-aware lint pass.

The strongest verified boundaries are selected-leaf and operation precision,
missing-versus-undefined, current-path rebinding with retained original evidence,
concurrent/late async frames, cached derivation replay, value transport/equality
separation, exhaustive versus visited collection evidence, frozen topology,
tracked gate membership, child-output cutoff, keyed insertion/deletion/reorder,
and framework strict-fold coverage. These proofs remain bounded to their fixtures.

The ledger deliberately retains gaps: the complete supported capture-lint syntax
matrix, proposed identity conveniences, arbitrary ordering/ranking variants,
all argument-reconstruction sub-obligations, production cache eviction/scale,
and glossary definitions owned by operational/history contracts are not certified
here. EXP-6 Lean remains dormant as directed. Experimental/proposal text must not
be promoted to a current shipped obligation. The single logical projection digest
has component evidence; integrated arbitrary-loop scale remains outside this audit.

Two separately captured inconsistencies remain the substantive findings:

1. Nullable tracked container guards produce false reuse when a nonnull object
   changes to null/missing; the scalar guard control passes. See `README.md` and
   the container-guard tests/logs, including independent-process variants.
2. The author declaration/type surface accepts scalar result roots while runtime
   supports only record/array roots. See `SCALAR-ROOTS.md`. This is an API/DX
   mismatch, not a claim that M3 promised scalar-root lazy navigation.

`imported-artifact-probe.mjs` exercises the **production** observer with actual
imported emitted modules in independent Node processes. Its six cases pass:
unchanged fresh modules remain equal; a transitive tracked imported leaf edit
changes evidence; dependency package version metadata alone does not; function
rename, emitted formatting and emitted comments conservatively change evidence.
The latter are expected conservatism under TRK-2, not false reuse or defects.
Each frame observes both the intermediary and imported leaf implementation under
separate structural bindings. This does not establish untracked closure soundness.

Reproduce from the repository root:

```sh
node scratch/gap-hunt/contracts/imported-artifact-probe.mjs
node scratch/gap-hunt/contracts/semantic-map.mjs
npm run test:unit --workspace @microdelta/tracking -- --runTestsByPath .test-build/test/observer.test.js .test-build/test/lazy-view.test.js .test-build/test/output-observation.test.js .test-build/test/gap-hunt-contracts-invalidation.test.js
npm run test:unit --workspace @microdelta/value
npm run test:unit --workspace @microdelta/definition
npm run test:unit --workspace microdelta -- --runTestsByPath .test-build/test/m4-acceptance/keyed.test.js .test-build/test/m4-acceptance/nested.test.js .test-build/test/m4-acceptance/fold.test.js .test-build/test/m4-acceptance/topology.test.js
```
