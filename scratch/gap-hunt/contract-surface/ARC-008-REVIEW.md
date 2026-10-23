# ARC-008 Resolution isolation review

Provisional classification: **insufficiently established proof obligation**, not a
confirmed runtime defect or a claim that Resolution has no test doubles.

Owning clause `docs/spec/architecture.md:134–151`:

> Each context/module must have contract tests against fakes of its ports before
> relying on end-to-end tests. Required seams include:
> ... resolution tests using fake current facts, source policies and child resolvers;
> ... Fresh-process assembly tests then verify the contracts compose. Passing them
> does not replace isolated invariant tests.

This is an explicit normative testing obligation, stronger than an optional style
preference. Its behavioral purpose is to distinguish Resolution's validation
rules from the correctness of the contexts supplying facts and child outcomes.
It does not mandate a particular TypeScript interface spelling (architecture
introduction explicitly calls capability names conceptual).

Actual extant seams and assertions:

- `packages/core/test/resolution/fixture.ts:107–130,218–274` supplies controlled
  `world.remote`, source check policies, finality outcomes/counters and fake
  failures. These are genuine fake current facts and policy behavior.
- `source-policy.test.ts:91,116,217,231` asserts current-hook invocation each
  session, false-hook checks with a carrier, fresh-equal distinct publication,
  throwing/nonboolean hook failure with no acceptance/publication. Those tests
  passed in the130test workspace/Resolution run. Absence of mocked modules
  does not mean absence of fake facts or policies.
- `resolution/support.ts:104–138` injects scripted admission/observer ports;
  `stop/resolution-port.test.ts:142–166` injects a scripted execution-supervision
  port. These independently control refusal/observer/cancellation cases.
- `resolution/support.ts:1–9,94–115`, `nested/arguments.test.ts:317–340` and
  `stop/resolution-port.test.ts:142–166` all explicitly compose real durable
  History, real Tracking and real Definition. Broad component behavior tests
  therefore retain those integration dependencies.
- `packages/resolution/src/contracts.ts:248–276` exposes injected History,
  Tracking, host, admission, observer and execution ports. It does not expose a
  separately injectable child resolver; child resolution recursively uses the
  current Resolution implementation (`resolution.ts` direct-child/nested paths).
- `packages/resolution/test/outcome.test.ts` independently tests source-envelope
  minting, lookalike rejection and payload distinction, rather than candidate
  validation over fake History/current facts/child resolutions.

What remains unproved: an isolated test replacing child resolution outcomes
independently from real Definition/Tracking/History, as the listed seam suggests.
The current controlled source callbacks and real recursive child resolution may
be the intended bounded surrogate; calling them insufficient is an interpretation
that should be checked against the owning contract's purpose, not silently turned
into a requirement for another public port. There is no observed wrong outcome.

No issue is proposed solely from a test-path count or absence of a mock import.
If further work needs this isolation to expose a concrete validation failure,
first add an outcome-based failing component test using existing injected ports.
Only if they cannot express the contract should a narrower internal seam or a
clarification of ARC-008 be considered. No production seam or public API change
was made during this audit.

## Follow-up recommendation: no new API or missing-contract issue

ARC-008 already states the testability obligation; a new “define testability” target would duplicate it. The current supplied callbacks do satisfy the concrete purpose of controlling **child work behavior**: `nested/arguments.test.ts:70–99` injects helpers returning known child values with independent run counters; `:166–169` throws a selected child failure; `:402` asserts unchanged arguments retain both child and parent exact references; `:496` distinguishes parent failure from an in-flight child failure. `resolution/summary-validation.test.ts:208–226` varies the child's implementation and forces equal output, then independently asserts a new child reference, zero parent bodies and exact parent retention. Those are substantive controlled child outcomes, not merely test IDs or mock counts.

The narrower literal reading—replace the *recursive Resolution result* independently of History, Tracking and Definition—remains unproved. The construction contract has no child-resolver port; child resolution is internal recursion. Supplied callback control is therefore not evidence that a separately substituted recursive resolver exists. It would be misleading either to mark that literal isolated seam verified or to infer a runtime defect from its absence.

Recommend **no new issue from this audit**: no missing normative requirement and no concrete invariant has been shown inexpressible through the supplied callbacks and existing injected ports. Retain the precise evidence qualification in the ledger. If future mutation/fault evidence shows a validation invariant cannot be discriminated because recursive child resolution masks it, write that outcome-based component test first; use existing History/Tracking/admission/execution seams where possible, and introduce only the smallest internal seam if actually necessary. An architecture clarification can record that child-work callbacks are the accepted bounded surrogate, if the owner wants to close the literal wording; this is not a reason to mandate a new public interface.

These follow-up anchors were inspected against current source; their earlier execution is recorded by the owning broad suites, rather than claimed as a fresh rerun in this follow-up.
