# #156 selected contract addendum: record/array result roots

Implementer: Codex worker (gpt-6.1-sol), operating for Mike North.

Status: **owner selected record/array roots for the current alpha; document scalar wrappers**.
The defect is the accepted-type/runtime mismatch. Existing governing text does not
require extending M3 navigation to scalar roots.

## Governing contract and decision

`docs/spec/tracking.md:196–202` explicitly bounds the M3 selected-read capability
to retained **record and array roots**. `docs/spec/tracking.md:135–149` includes
scalar atoms as supported *values*; that does not independently promise every atom
as a navigable completed-result root. `docs/spec/composition.md:131–135` CMP-8
requires skipped/no-value to remain distinct from success returning undefined;
it defines outcome meaning, not an unbounded scalar-root materialization API.

Current generated alpha authoring declarations accept `source<TResult>` and
`memo<TResult>` returning string, number, boolean, null or undefined; normal
execution rejects all ten cases as `unsupported-result`. Five wrapped `{value}`
controls succeed. Thus neither type acceptance nor runtime rejection alone resolves
the intended author contract.

The owner selected the bounded resolution: expose and enforce the existing
record/array root restriction in authoring types and facade documentation. Scalar
values remain supported inside records/arrays; authors use `{ value }` wrappers.
The historical accepted scalar declarations below reproduce the original mismatch.

## Numbered acceptance criteria

1. Record the selected record/array root contract in owning specification/API
   documentation, including `{ value }` wrappers for scalar author data.
2. Generated alpha `source` and `memo` declarations reject bare string, number,
   boolean, null and undefined through tsd negative tests. Preserve record and
   readonly-array inference and declaration tiers.
3. Unsupported roots entering from untyped JavaScript fail visibly with the stable
   supported-result diagnostic and publish no completed result.
4. Supported nested scalar fields retain their existing Value semantics, including
   present undefined, NaN/infinities and distinct negative zero. Wrapped positive
   controls remain valid.
5. Skipped/no-value remains distinct from successful data containing an undefined
   field; root restrictions do not collapse framework outcome distinctions.
6. Strict TypeScript, generated-declaration tsd, type-aware lint, supported runtime
   controls and workspace declaration checks pass against the selected contract.

## Scope, exclusions, dependencies

Scope: the source/memo result-root author contract and faithful API/runtime/docs
alignment. Out of scope: generic TypeScript serialization completeness, arbitrary
class/native data support, release/publication, closure soundness, and #155.

Dependency: no unresolved root-policy decision remains. Implementation belongs to
the issue owner; this gap-hunt worktree preserves the original reproducer.

## One clean-checkout Linux reproduction command

Run from a clean checkout of branch `gap-hunt-contracts` with Node >=20 and npm installed. The fixed script revision is recorded in the handoff; the script prints the exact checkout revision, installs pinned dependencies and builds generated declarations itself:

```sh
node scratch/gap-hunt/contracts/reproduce.mjs 156
```

Expected current result: generated alpha type assertions pass (all ten bare scalar
source/memo declarations compile), followed by ten intentionally failing runtime
assertions and five passing wrapped controls. `SCALAR-ROOTS.md` contains the exact
stable runtime rejection and additional evidence. No external service is used.

Fixed reproduction revision: `9267a44e1a203966e6ccd73db188e5826506326b` on branch `gap-hunt-contracts`.
The script and all required fixture modules are present in that commit.
