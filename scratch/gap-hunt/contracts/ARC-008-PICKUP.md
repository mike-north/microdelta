# Pickup contract: ARC-008 Resolution child-resolver isolation

Implementer: Codex worker (gpt-6.1-sol), operating for Mike North.

## Problem and governing scope

Severity: **Medium testability/validation gap**. Blocking dependencies: **none**. Coordinate the isolated Resolution fixture with existing #144 fault-control work; its five witnesses remain separate acceptance evidence.

ARC-008 requires Resolution contract tests using fake current facts, source policies **and child resolvers**, before relying on assembly evidence. Current child recursion is captured privately inside `createResolution`; source/parent work callbacks and the #144 mutations do not substitute the child resolver itself. This is a missing required validation seam and isolated evidence, independently of whether those assembled tests expose every known runtime fault. See `ARC-008-LITERAL.md` for the complete owning paragraph, construction API, source routes and existing test inventory.

The purpose is to test the parent's current-validity decision against controlled **child resolution outcomes** without executing the recursive child's candidate validation, source policy, admission or body internals. It is not a new domain context, public facade feature, persistence owner or general mocking framework. No new required public interface or constructor spelling is selected here.

## Honest minimal diagnostic

From a clean evidence checkout:

```sh
node scratch/gap-hunt/contracts/reproduce.mjs arc008
```

The wrapper installs locked dependencies, builds generated declarations and packages, then runs the diagnostic. On a built checkout:

```sh
node scratch/gap-hunt/contracts/arc008-surface.mjs
```

This source/API diagnostic enumerates the exact `IResolutionOptions` members from source and generated alpha declarations, asserts their agreement, and records all lexical child-resolution call sites inside `createResolution`. `arc008-surface.json` preserves the result and hashes. History/Tracking/host/admission/observer/execution are real injection capabilities; recursive child-resolution functions remain lexical implementations. The existing engine's frozen returned `resolve` delegates internally, so a wrapper of the top-level method does not replace those child results.

The baseline diagnostic exits **0** because it successfully records the current census. It is not a failing runtime input or a regression oracle for the eventual seam and may need updating after the implementer selects a representation. The proposed semantic tests below should first fail against that selected internal test boundary before its mechanism is implemented.

This is **static evidence**, not a failing runtime request, proof that every conceivable test-tool transformation is impossible, or a failed compile against an invented option. The exhaustive inspected isolated owner test route is source-envelope construction in `packages/resolution/test/outcome.test.ts`; current parent-validity tests construct real recursive Resolution with real History/Tracking/Definition, as their support files explicitly document. No runtime input expresses the required substitution yet, so none is fabricated here.

## Numbered acceptance criteria

1. Supply an owner-supported internal test seam that lets an isolated parent-validation contract fixture replace the child's resolution service/outcome without executing recursive child internals. Keep current-fact/policy controls independently configurable. Choose the smallest representation under the owning Resolution component; generated alpha or an internal owner test harness may be appropriate. Do not mandate a public facade export.
2. A fake child success with a new exact result reference but equal **parent-consumed** output validates the retained parent: zero parent-body executions, original exact parent reference retained, and current acceptance naming the current child reference while original provenance stays unchanged. Assert the fake receives the current structurally reconnected child invocation; child recursive implementation/policy/body sentinels stay at zero.
3. A fake child whose current resolution is invalidated and whose consumed output changes makes the parent candidate miss. Under normal parent admission the parent executes once and consumes current child data; no stale historical child value is substituted. Assert unrelated/unconsumed child output changes do not cause this miss.
4. A fake unavailable/refused child result and a fake child failure preserve the owning outcome distinctions: an unavailable check-only child cannot authorize parent reuse or secretly run work; a normal refusal/failure must not publish or accept the retained parent as if child success had been obtained. Use the existing declared outcome/error vocabulary, not a newly invented “unavailable” sentinel. Map each expected outcome to the relevant REUSE/CMP contract before implementation.
5. Demonstrate isolation with strict negative sentinels on the actual recursive child route (eligibility, source policy/admission and body) and a positive control proving those sentinels are observable on the normal non-substituted route. The fake must be invoked exactly as expected, so bypassing the child or returning an unconditional parent acceptance fails the tests. Do not claim isolation merely from test-path names or a mock count.
6. Keep at least one existing fresh-process assembly scenario proving the isolated parent rules compose with actual child resolution. Preserve the verified #144 five fault controls; those remain regression evidence and are not renamed as fake-child tests. Any new control must discriminate the corresponding parent decision rather than simply mirror its implementation.
7. Preserve the six bounded contexts and invariant owners. Definition owns current correspondence; Tracking owns observed fact meaning; History owns exact immutable results/acceptance/publication; Resolution owns current validity; supervision owns admission/run lifetime; Machine supplies host capabilities. Do not move those decisions into a fake-host abstraction or public facade convenience.
8. Follow package declaration tiers, generated sibling declarations, strict TypeScript, type-aware lint, Jest runtime tests and tsd where construction types change. No casts or broad suppression may turn an invalid fake into a legal child result. Keep provider execution, public API promotion, release behavior and publication outside scope.

## Suggested semantic test starting point

Reuse the parent-cutoff intent in `resolution/summary-validation.test.ts:208–226`: same selected score, child implementation replaced, new child reference, retained parent with zero bodies. Replace only its child-resolution collaboration with a scripted fake that yields the typed current result/reference. Then vary the consumed score and child refusal/failure independently. The test's expected outcomes come from CMP-5/6/7 and REUSE-005/006/007, with ARC-008 supplying the isolation requirement.

This is a semantic starting point, not executable code against a nonexistent port. The implementer owns the representation. No product implementation or GitHub write is included.

## Out of scope

Public facade expansion, publication/release changes, provider execution, wholesale Resolution redesign, a new bounded context, transfer of invariant ownership, and replacing the existing #144 controls are outside this pickup. No blocking dependency is invented from their shared source files.
