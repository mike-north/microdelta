# Pickup candidate: custom-key-only collection declaration

Proposed title: Allow an explicit custom-key strategy for member schemas without a designated string identity.

This is a local candidate contract for supervisory review, not an issued or adopted API design. No production fixes included. Fixture baseline c5802da, portable probe commit3586b2d; Node24.22.1 Darwin arm64. Scope is the current project-private alpha declaration path.

## Governing intent and delivery boundary

COL-1 (`docs/spec/tracking.md:227–232`) allows an explicit author custom-key function; “No-identity members need an explicit supported key strategy before keyed work proceeds.” CMP-4 (`docs/spec/composition.md:54–57`) requires keying before any gate/member work using designated identity **or** an explicit custom key. `docs/plans/m4-composition.md:143–150` repeats the alternative and pre-work validation. The key remains a nonempty string scoped to its collection; this candidate does not ask to admit numeric keys, ordinals or implicit fallback.

The selected M4 and EXP-4 fixtures already have string designated identities (M4 plan79–82; EXP-4 decision23–32). Their custom-key variants replace one string field with another. Current tests `packages/core/test/keyed/restart.test.ts:249–270` establish correspondence under renumbered designated IDs, not authoring of no-string-identity schemas. Implementation comments call a custom key an override of designated identity. The broad active requirement and narrower delivered prerequisite therefore need an explicit supervisory decision; do not claim the existing M4 fixtures failed or that arbitrary collection types were promised.

## Minimal measured reproduction

Members are supported records `{id:7,score:3}`. Generated-alpha code declares a source of `{status:'complete',members:[...]}` and a template custom key `member => 'id:'+member.id`. It typechecks without casts/suppressions, then `api.template` throws `DefinitionError`: `Template member must fan out over a keyed collection source declaring its designated identity.` `template.ts:403–406` checks the required source marker before considering the key.

The numeric-only schema cannot supply that marker through current types: `ICollectionOptions` requires `identity` and `IIdentityField` admits only string-valued member fields. `collection:{}` and `identity:'id'` both fail generated-alpha type tests. Adding only optional `key?:string` to the TypeScript member interface, plus the identity marker, makes identical physical data and custom key execute successfully: discovery key `id:7`, member succeeded. This fictional annotation is a diagnostic workaround, not proposed caller syntax.

Current minimal runtime outcome: **one red/two green**. Explicit custom string key without fictional identity is rejected (red); no key strategy is rejected (green); optional identity annotation plus custom key completes actual member work (green). Type/lint checks pass. Existing AUTHORING-MATRIX.md records the broader passing arrays/source-envelope/gate controls.

From a clean checkout containing this branch's fixtures and Node24.x:

```sh
node scratch/gap-hunt/consumer-dx/repro-custom-key.mjs
```

Default runner installs locked dependencies, builds all package declarations, strictly compiles only the custom-key fixture, checks it with repository type-aware ESLint, then runs the three assertions. Native better-sqlite3 prerequisites are the same as the repository; no global CLI, credentials or provider execution is needed. Baseline expected exit1 is the intended acceptance failure. `GAP_HUNT_REUSE_BUILD=1` skips bootstrap only when dependencies and generated package outputs are already fresh. No command depends on a user-specific path.

## Numbered acceptance criteria

1. A caller can declare a supported collection whose member schema has no designated string-valued identity field, supply an explicit custom function returning supported nonempty string keys, and execute keyed member work. Do not require a fictional identity field, additional payload projection, or a cast/suppression solely to satisfy declaration machinery. No particular field name or constructor spelling is prescribed.
2. The generated alpha contract accepts that supported path with precise member fields in the key/gate/member bodies. Unsupported key return types and mismatched collection result types produce appropriate diagnostics; generated consumer checks use built alpha outputs. Do not loosen unrelated type checks or admit arbitrary native values.
3. Default designated-identity behavior remains supported. Missing designated identity with no custom strategy is rejected before gate/member execution, with a diagnostic naming the collection and key strategy. No ordinal/index/label fallback is introduced.
4. Custom key validation remains pre-work and whole-snapshot: duplicate keys, absent/undefined return, empty string, non-string return and a thrown key function yield the appropriate rejection/diagnostic and admit no gate/member body. Deliberately invalid runtime returns may be exercised from JavaScript without weakening production TypeScript checks.
5. Stable custom keys retain correspondence and exact eligible member references across process exit and source reorder. When a caller changes its key strategy's output for a member (an unstable or changed key), it must not guess correspondence or silently reuse the prior instance under the new key; normal new-key correspondence applies. Duplicate results from an unstable strategy still reject. This does not require proving arbitrary key functions deterministic or detecting hidden closure state.
6. Preserve collection scoping and preexisting default/custom identity tests, gate behavior and frozen topology. Identity is author-declared policy; the implementation must not infer a default from numeric id, record position or payload equality.
7. The minimal baseline reproduction becomes green through the accepted contract path, while both controls stay green. Add focused type/runtime negative tests and separate-process custom-key controls derived from these outcomes before changing implementation; check strict TypeScript, type-aware lint, API reports/declaration consumers and affected Definition/assembly tests.

## Scope, owners and dependencies

Definition & Binding owns collection declaration, key strategy and symbolic template typing. Reuse Resolution consumes keyed snapshots/correspondence; the facade aliases the generated contracts. Change only the owning source/template contracts, generated declarations/API reports and focused tests/docs needed for this path. No new host capability, persistence format/schema, paid-provider behavior, release tier, package publication or general CLI is required. Runtime authority stays with existing owners.

No prerequisite production fix is known. Coordinate generated facade aliases with producer builds; use a fresh isolated issue worktree if authorized. Parent must settle whether broad COL-1/CMP-4 authoring is delivered now or intentionally deferred before assigning implementation. If the restriction is deliberate, amend the active contract and document the current caller boundary instead of manufacturing an implementation promise. Do not require a new collection field/API spelling solely because this fixture used an omitted marker to expose the mismatch.
