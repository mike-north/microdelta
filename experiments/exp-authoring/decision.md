# Issue 176 first-slice decision and evidence

Status: proposed mechanism with passing bounded evidence; no public API adoption.

## Domain and mechanism

The domain is one or two fixed numeric nodes, synchronous author callbacks, explicit string identities and owned input/memo tokens. Factories build copied frozen relationships without invoking computation. A private dispatcher reconstructs current `from` edges from tracked recipe inputs and invokes the actual authored callback through a stable tracked helper slot. Callback code and current origin correspondence remain observed influences. This preserves ordinary imported factory composition without teaching manual child paths or storage wrappers.

The existing runtime requires record/array result roots. The adapter stores `{ value: number }` privately and unwraps at its execution boundary; History's exact record remains visible in the test receipts. This is not scalar-root runtime support or resolution of #156. The updated #156 alpha typing decision remains independent.

Application inputs and child numeric outputs are own getter properties. Their selected values are observed only when the callback reads them. Declared children still resolve eagerly before the synchronous callback: an ignored child may execute, wait or fail. The experiment does not claim general lazy scheduling. Current recipe shape is tracked even when a corresponding value is unread.

Only the framework's immutable occurrence correspondence has a documented callback-capture exception. Actual authored modules have none. The capture checker identifies the exact experimental constructor declaration, including imported aliases, rather than accepting arbitrary functions named `memo`. Arbitrary closure soundness remains excluded by the existing tracked-influence contract.

## Assertions and counterexamples

`test/restart.test.ts` invokes a new Node process for every run over one SQLite store. Both child and parent execute/publication counts and exact references come from lifecycle events, rather than counters captured by author callbacks.

| Case | Required observed result |
| --- | --- |
| Cold one-node and composed run | Each required body executes and publishes once |
| Unchanged restart | Both levels retain exact references, zero bodies/publications |
| Unread label/scalar change | Both levels retain exact references, zero bodies/publications |
| Consumed edit, equal child number | Child executes/publishes a new reference; parent retains exact reference with zero body |
| Consumed edit, changed child number | Child and parent execute/publish with changed references |
| Actual callback-only edit | Child implementation invalidates; equal output cuts off parent; changed output reruns parent |
| Changed `from` origin with unchanged callback | Both levels invalidate, then reuse the new correspondence after restart |
| Reserved names and same-child aliases | Literal names survive, aliases execute successfully, unchanged restart reuses |
| Ignored child output changes | Child executes/publishes; parent retains its exact reference |

`test/protocol.test.ts` rejects forged/foreign tokens, duplicate occurrences and complete subjects, and graphs beyond two nodes. It verifies copied frozen edges, factory-once/body-never construction and legal aliases. `test/invalid-result.test.ts` deliberately crosses the untyped JavaScript boundary and rejects Promise, thenable, record, string and null results with no completed publication. `test-d/protocol.test-d.ts` checks numeric inference and rejects invalid inputs, raw origins, unknown fields, authored wrappers and async callbacks.

Baseline owner controls are preserved in `test/baseline-worker.ts`. On base `f43c587`, a raw scalar memo executes then reports unsupported-result without publication (#156). A subtree-output child publishes reference 2 on cold run, then executes/publishes reference 3 on unchanged fresh-process restart while its parent retains reference 1 with zero bodies (#164). The bounded numeric adapter does not repair either owner contract; its tests measure both levels to avoid hiding that distinction.

## Reproduction and observed progression

Toolchain: macOS, Node 24.14.0, npm 11.18.0; local evidence does not claim another platform.

Before implementation, the missing protocol failed type resolution, then a typed throwing scaffold failed all eight original behavioral tests. Actual-author capture negatives failed two assertions while the positive control passed. The first mechanism passed all eight behavior assertions. Added hardening assertions then failed three of ten tests for duplicate complete subjects, reserved dictionary spellings and eager unread scalar observation; own-safe dictionaries, subject validation and lazy getters made all ten pass. Runtime-return and alias/ignored-output controls bring the final focused suite to sixteen passing tests. The capture suites pass 37 tests, including three experiment-specific assertions.

Exact focused commands:

```sh
npx tsc -p experiments/exp-authoring/tsconfig.test.json
npm run test:exp-authoring
npx tsc --noEmit -p experiments/exp-authoring/tsconfig.portable.json
npx eslint experiments/exp-authoring
node --test tooling/tracked-captures.test.mjs tooling/authoring-captures.test.mjs
```

Baseline controls after build:

```sh
node .test-build/experiments/exp-authoring/test/baseline-worker.js /tmp/authoring-scalar.sqlite scalar first
node .test-build/experiments/exp-authoring/test/baseline-worker.js /tmp/authoring-subtree.sqlite subtree first
node .test-build/experiments/exp-authoring/test/baseline-worker.js /tmp/authoring-subtree.sqlite subtree second
```

Use fresh database paths for baseline controls. Required full gates are `npm run check`, `npm test`, and `npm run build`; their final results are recorded in the pull request rather than inferred from focused tests.

## Recommendation and limits

Continue evaluating this construction-time symbolic mechanism against the proposed consumer examples. It supports the first slice's restart/cutoff proof and keeps actual author callbacks compact. It does not decide the final public spelling or prove source policy refresh, keyed fanout, subject selectors, helpers, asynchronous callbacks, scalar result ownership, unrestricted graph size, or external packaged-consumer readiness. The generated alpha declaration mapping is existing workspace infrastructure, not evidence that #154 is resolved. Deferred identity/finality/held-page questions (#170) and bounded admission scaling (#173) remain outside this mechanism decision.

## Adversarial review repair

The initial passing matrix did not cover reassignment of complete subjects between unchanged structural occurrences. Review found a counterexample: `a(11) => 11`, `b(a) => 22`, with subjects `a=X, b=Y`, followed by a fresh process with only those subjects exchanged. The initial adapter returned the old child's `11` as the parent with zero bodies. Its suppressed occurrence capture selected a historical recipe path without proving that path still belonged to the current subject. This invalidates the initial correspondence evidence beyond its original cases.

Every current recipe now carries its exact complete subject, and dispatch unconditionally reads and validates that scalar before invoking an author callback. Retained observation of the recipe's structural path together with this subject value records the required current occurrence-to-subject association. A subject move changes that evidence; neither opaque subject bytes nor compatibility versions are changed. The new fresh-store regression runs cold and swapped entirely with the candidate dispatcher, so changed adapter code alone cannot explain the repair. It also checks a clean swapped control, unchanged reuse before the swap and exact-reference reuse after it. Existing equal-output cutoff assertions remain in force.

The input phantom is now an invariant function property: an analysis requiring a string cannot be widened to accept unknown data before execution. Tsd rejects that assignment and malformed execution inputs, while validating ordinary/generic execution and graph inspection. This is a compile-time contract; arbitrary untyped input validation is not added.

The forged-origin assertion now returns the reflective constructor result directly, with no fallback error that can match its rejection expression. `tooling/authoring-origins.test.mjs` runs the actual checked-in assertion against both the real protocol and an isolated mutant accepting that forged token. The original assertion passed the mutant, so the mutation control failed with missing expected rejection; the corrected assertion kills it. Production origin validation was already correct.

Test-first receipts: subject-swap expected `22` but received `11` (six existing restart cases passed); the new tsd nonassignability assertion failed because the unsafe widening compiled; the mutation test failed because the original assertion accepted the mutant. After repair, the focused suite has eighteen passing Jest tests plus tsd and the forged-origin mutation control. Reproduce with the focused commands above plus `node --test tooling/authoring-origins.test.mjs`; the wildcard tooling suite includes this control in normal `npm test`.
