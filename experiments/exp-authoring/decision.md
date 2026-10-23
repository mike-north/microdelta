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

Continue evaluating this construction-time symbolic mechanism against the proposed consumer examples. It supports the first slice's restart/cutoff proof and keeps actual author callbacks compact. It does not decide the final public spelling or prove source policy refresh, keyed fanout, subject selectors, helpers, asynchronous callbacks, scalar result ownership, unrestricted graph size, or external packaged-consumer readiness. The generated alpha declaration mapping is existing workspace infrastructure, not evidence that #154 is resolved. Deferred identity/finality/held-page questions (#170/#173) remain outside this mechanism decision.
