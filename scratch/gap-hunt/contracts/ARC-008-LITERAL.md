# ARC-008 literal fake-child-resolver obligation

Implementer: Codex worker (gpt-6.1-sol), operating for Mike North.

**Classification: specified but missing validation seam / isolated contract evidence.** This does not depend on finding a masked runtime bug. The prior conclusion that no concrete child outcome had been shown inexpressible does not establish conformance with this explicit validation requirement.

## Full owning paragraph and consequence

`docs/spec/architecture.md:134–151` requires:

> Each context/module must have contract tests against fakes of its ports before relying on end-to-end tests. Required seams include:
> - fresh binding catalogs with missing, renamed-label and reordered-registration cases;
> - in-memory observation tests with no persistence dependency;
> - resolution tests using fake current facts, source policies and child resolvers;
> - history tests with deterministic crash boundaries and stale-holder schedules;
> - supervisor tests with fake clocks, admission and execution services;
> - accounting tests separating acknowledgment, duplicate delivery and unknowns;
> - materialization tests proving selected loading and observation without freshness decisions.
>
> Fresh-process assembly tests then verify the contracts compose. Passing them does not replace isolated invariant tests. Tests are written before implementation and derive expected behavior from requirements, not production internals.

“Required seams” and “does not replace isolated invariant tests” make this a present normative validation obligation. The paragraph does not condition it on a demonstrated runtime failure or on proving the existing implementation impossible to test. It does not mandate a public API, option spelling, or separate package.

## Exact construction and recursive-call routes

At production baseline `c5802daca4a0bb8ea91159854d84eddcfa5215b6`, evidence branch `ac582e1272978af32508809a4b10d4011de592d6`:

- `packages/resolution/src/contracts.ts:248–276` defines `IResolutionOptions`: declarations, composition, bindings, environment, History, Tracking, host, admission, observer and execution. `packages/resolution/dist/api/resolution.alpha.d.ts:801–829` carries the same constructor shape; `createResolution` at line 44 takes that one options object.
- `packages/resolution/src/resolution.ts:804–822` captures those dependencies. The recursive current-child resolution functions are lexical functions inside that constructor, not functions obtained from an injected resolver port.
- Direct retained-child validation calls internal `resolveSourceShared` at `:1573`. Nested retained-call validation dispatches to internal `resolveSourceShared`, `resolveMemoShared` and `resolveSuppliedShared` at `:1653/:1655/:1669`.
- Executing parent calls similarly route through `deliverChild`/`dispatchNested` to those lexical functions at `:2320` and `:2372/:2375/:2383`.
- The exposed `resolve` method at `:3299–3303` invokes lexical `resolveStep`; the returned API object is frozen at `:3298`. Wrapping the exposed top-level resolver therefore does not replace recursive child results consumed by a parent validation.
- `IExecutionSupervision` (`contracts.ts:154–195`) runs or interrupts author work, policy hooks and windowed member work. Its own contract says it decides nothing about reuse. A fake execution outcome is not a fake complete child resolution, which includes current eligibility, acceptance/publication and exact-reference result evidence.

The observed options surface, exported API and call routes establish the missing literal seam without guessing a new property. A failed compile using an invented `childResolver` spelling would prove only that spelling absent and is deliberately not presented as evidence.

## Existing tests do not supply the named substitute

- `packages/core/test/resolution/support.ts:1–10/:94–138` explicitly constructs real durable History, real Definition composition and real Tracking around `createResolution`. It supplies scripted admission and observer ports. Its source-world callbacks are controlled current facts/policies; these are valid fakes for those behaviors.
- `packages/core/test/nested/support.ts:60–85` similarly uses real History/Tracking/Definition and recursive Resolution. `nested/arguments.test.ts:317–340` follows the same route.
- `packages/core/test/stop/resolution-port.test.ts:142–166` supplies a fake **execution-supervision** port while keeping the actual Resolution and real History. It satisfies that cancellation/control seam, not an independent recursive child resolver seam.
- `packages/resolution/test/outcome.test.ts` isolates source-envelope minting/lookalike rejection. It does not construct Resolution with a fake child resolver or test parent candidate validation against substituted child-resolution outcomes.
- Controlled child callbacks in `nested/arguments.test.ts:70–99/:166–169/:496` and `resolution/summary-validation.test.ts:208–226` independently vary child work values, exceptions, references and equal-output implementation changes. These remain substantive behavior tests. They still execute the actual recursive child algorithm and its real collaborating contexts.

## #144 evidence and its precise limit

The verified-load #144 controls in `RESOLUTION-144.md` discriminate five concrete faults: gate capture, in-flight direct-memo sharing, supplied invocation intent, supplied own-implementation integrity and fold own-implementation integrity. Baseline/restored expanded selections pass 221 tests; each of the five focused tests fails for its matching isolated emitted mutant. The runner verifies package paths and emitted hashes, and excludes its earlier invalid symlink-copy run.

Those controls demonstrate successful fault detection using existing assembly seams. They do not replace the recursive child resolver with a fake, and are not evidence that the literal ARC-008 seam exists. Mutating the engine under test is different from supplying a fake collaborating resolver. No additional mutation or broad rerun is required to establish that distinction.

## Remaining disposition

The literal ARC-008 child-resolver validation obligation is unmet in the inspected source/test/API routes. Existing supplied callback control is a partial surrogate, not an accepted spec amendment. Requiring a masked runtime bug before acknowledging this gap would weaken the normative objective.

No runtime defect, public API design, implementation change or owner question is proposed here. The finding is bounded to the stated validation obligation and inspected baseline. A resolution can either provide the required isolated contract evidence/seam or explicitly reconcile the governing contract; this report does not select a new API. No GitHub write was made.
