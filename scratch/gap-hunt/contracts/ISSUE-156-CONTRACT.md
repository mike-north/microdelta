# #156 provisional contract addendum: accepted scalar result roots

Implementer: Codex worker (gpt-6.1-sol), operating for Mike North.

Status: **provisional; owner design choice required before implementation-ready**.
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

Recommended bounded resolution for owner review: expose and enforce the existing
record/array root restriction in authoring types and current facade documentation.
This preserves the selected M3 boundary. Alternatively, explicitly authorize scalar
root support and specify publication/materialization/read semantics first. The
issue should not silently select the latter as a bug-fix requirement.

## Numbered acceptance criteria, conditional on owner choice

1. Record the chosen root contract in the owning specification/API documentation
   and link the decision from this issue before changing accepted behavior.
2. If restricting roots: generated alpha `source` and `memo` declarations reject
   bare string, number, boolean, null and undefined through tsd negative tests.
   Preserve valid record and readonly-array inference and declaration tiers.
   Unsupported values entering from untyped JavaScript still fail visibly with
   the stable supported-result diagnostic and publish no completed result.
3. If supporting scalar roots: positive source/memo execution assertions for all
   five atoms succeed, and retained exact scalar results are readable/reusable
   after restart. Define scalar-root publication, selected-read and output behavior
   explicitly; do not fabricate a container or infer silent transport migration.
4. Under either choice, supported nested scalar fields—including present undefined,
   NaN/infinities and distinct negative zero within the declared Value domain—keep
   their existing semantics. Wrapped `{value}` positive controls remain valid.
5. A skipped instance remains distinct from successful author data containing an
   undefined field. Do not use an unsupported bare-root rejection to collapse
   the framework's existing outcome distinctions.
6. Strict TypeScript, generated-declaration tsd, type-aware lint, supported runtime
   controls and workspace declaration checks pass. Tests must express the chosen
   contract, not merely snapshot the current rejection.

## Scope, exclusions, dependencies

Scope: the source/memo result-root author contract and faithful API/runtime/docs
alignment. Out of scope: generic TypeScript serialization completeness, arbitrary
class/native data support, release/publication, closure soundness, and #155.

Dependency: the owner decision in AC1 is unresolved. Treat the acceptance criteria
as conditional and keep this issue provisional until it is made; no new policy is
adopted by this addendum.

## One clean-checkout Linux reproduction command

Run from a clean checkout of branch `gap-hunt-contracts` with Node >=20 and npm installed. The fixed script revision is recorded in the handoff; the script prints the exact checkout revision, installs pinned dependencies and builds generated declarations itself:

```sh
node scratch/gap-hunt/contracts/reproduce.mjs 156
```

Expected current result: generated alpha type assertions pass (all ten bare scalar
source/memo declarations compile), followed by ten intentionally failing runtime
assertions and five passing wrapped controls. `SCALAR-ROOTS.md` contains the exact
stable runtime rejection and additional evidence. No external service is used.
