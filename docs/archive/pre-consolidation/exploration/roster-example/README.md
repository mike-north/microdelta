> Historical artifact. Superseded by the [active specification](../../../../spec/README.md). Do not implement from this document.

# Roster-to-contribution analysis: concrete authoring example

This example carries the selected workflow from an organization ID to one code
contribution summary per selected roster row. Start with [the complete program](analysis.ts).
It uses object definitions, required memo identities, scoped context, fresh
paginated discovery, the current finality hook, and an explicit reuse outcome.

**Status:** the program compiles against [candidate declarations](surface.d.ts).
Those declarations have no runtime implementation and are not public `microdelta`
exports. [Application policies](policies.ts) are executable and tested with fake
provider adapters. No network requests, credentials, paid calls, or database
changes are involved. The fixture does not implement a substitute analysis engine.

**Latest API review:** the [four-case comparison](validation-api-review.md)
recommends a single `memo` constructor with `validation: 'author'`, after testing
both spellings with identical definitions. The original complete program remains
the separate-constructor candidate so the alternatives can be compared. Neither
spelling is presented as a settled export.

## The author-facing path

```text
organization ID
  → retrieve CSV roster → parse and validate → select trial population
  → fan out over employee IDs
      → discover PR references (fresh pagination on every run)
      → fan out over PR URLs as they arrive
          → retrieve PR evidence (current finality hook, then source policy)
          → memoized complexity assessment
      → strict fold of compact assessments, sorted by PR URL
      → memoized person summary
  → report with one summary per selected roster row
```

The main API spelling under exploration is this object shape, taken from the
program. The finality hook reads only merged state and the current policy. The
retrieval body gets an optional previous snapshot and returns either data or an
opaque reuse signal:

```ts
const retrieve = retrieval<{ pr: IPRReference; policy: ISourcePolicy }, IPRData>({
  name: 'retrievePR', revision: 1,
  identity: async input => await input.pr.url,
  isFinal: async (input, previous) => isPRFinal(
    { merged: await previous.value.merged }, await input.policy,
  ),
  run: async (input, previous) => resolvePR(
    await input.pr.url,
    previous === undefined ? undefined : {
      value: await previous.value,
      reuse: previous.reuse,
    },
    services.pr,
    requestOptions(),
  ),
});
```

`resolvePR` is ordinary application code. On a cold miss it fetches a complete
snapshot. With a previous result it inspects validators covering the metadata,
diff, and reviews. If they all match, it returns:

```ts
return prior.reuse('all evidence validators unchanged');
```

Otherwise it fetches and validates the new snapshot. Returning the old payload
as new data would lose the distinction between retrieval and retention, so the
control outcome is explicit. Consumers still receive `IPRData`, with no reuse
marker leaking into their result type.

## Why separate `retrieval` and `memo` in this candidate?

They accept the same definition shape, but have different validation behavior.

| Constructor | Behavior when the result is demanded or recursively validated |
| --- | --- |
| `source` | Non-memoized streaming discovery. It traverses current pages; successful iterator completion closes membership. |
| `retrieval` | For an eligible previous result, consult the current finality hook. If absent or false, execute the author's retrieval body with that previous result. On a cold miss, execute without previous data. |
| `memo` | Use automatic dependency verification to decide whether a calculation body needs execution. A changed prompt/model/evidence can require reassessment. |
| `step` | Ordinary named work, such as parsing, selection, or collecting a complete corpus. No memo identity is required. |

This makes external validation visible without forcing authors to add a second
refresh method or a collection of lifecycle callbacks. Using an ordinary memoized
body for the source check could skip that check forever under an unchanged URL.
The `retrieval` name and constructor split are proposals, not newly settled exports.
An explicit source-validation option on `memo` could express the same semantics;
this example favors a name over a behavioral flag. Classes could satisfy the same
interfaces; inheritance is unnecessary for this first example.

Every memoized definition supplies its own identity. PR evidence and assessment
use the URL; person summaries use employee ID. Windows, prompts, model, and source
policy are inputs, not hand-written content keys. Definition names and revisions
separate different computations. The runtime must verify current source policy
even when reaching retrieval through a cached outer assessment.

Finality is never a database state. Each needed decision invokes the current
hook. This fixture exposes `acceptMergedAsFinal` as an analysis input so changing
policy can revoke a previously true answer. Time range is also a real input:
fresh discovery admits newly in-scope PRs when the range changes. An application
whose finality rule itself depends on the time range can pass that range to its
hook; it must be evaluated currently in exactly the same way.

## Concrete application policies and boundaries

- The period selects PR **creation time** in `[start, end)`. This is a declared
  example policy, not a decision about every contribution analysis. Discovery
  deduplicates URLs within one person's traversal, continues through empty pages,
  rejects cursor cycles, and propagates errors. A new run begins from page one.
- Trial selects explicitly listed employee IDs before any PR or LLM work. A trial
  with no IDs or unknown IDs fails visibly. Production processes the full roster.
  The supplied environment must select its matching store and clients before run.
- The CSV adapter must use a real parser supporting quoted commas/newlines and
  validate required columns. The example additionally rejects duplicate employee
  IDs or empty required values. That adapter is a declared integration boundary;
  no CSV-parser implementation or live HR schema is being claimed here.
- The fixture PR adapter provides **separate validators for all three components**.
  This is not a claim that a GitHub PR ETag or timestamp covers reviews and diffs.
  `inspect` may require several requests. The real adapter must establish those
  contracts or the author must explicitly choose a weaker acceptance policy.
- `fetch` returns a coherent complete snapshot matching the expected validators,
  or fails. The callback also rejects mismatched identity/versions. It cannot
  prove remote snapshot consistency on its own. Provider retries are outside
  this example.
- Complexity scoring is an integer from 1 through 5 with a nonempty summary.
  Unknown model output is validated before it becomes a successful result.
  Assessment reads title, body, diff, reviews, prompt, and model; it deliberately
  does not consume the source validators or merged state.
- Each person's strict fold waits for successful completion of that person's
  discovery and all required assessments. It sorts compact assessments by URL
  before the final LLM call, so completion order cannot change summary inputs.
  A closed zero-PR corpus produces a deterministic no-contributions summary with
  no model call. A failure cannot masquerade as that empty corpus.
- The inner fan-out limit is eight per person and the outer limit is four people.
  This is not a global provider quota mechanism; up to 32 inner operations could
  be admitted. Error isolation, admission lifetime, and globally shared limits
  remain runtime/helper contracts to test during implementation.
  The runtime must own admitted sibling work independently of a failing dependent
  fold: failure of the strict report must not implicitly cancel unrelated people.
  Error propagation in this fixture does not prove sibling continuation or safe
  run-context teardown; both require explicit execution-lifetime tests.
- Adapters propagate cancellation and report observed usage once through scoped
  context. Usage incurred while deciding reuse still belongs to the current
  attempt. The sketch's `record` method does not settle durable acknowledgements
  or missing-report accounting.

The HR CSV retrieval currently fetches afresh while retaining the resulting value.
The earlier scenario requires it to be memoized, but has not selected an HR
freshness validator; this explicit example policy avoids silently treating the
roster as immutable. HR-specific validation can later return the same reuse signal.

## Validation and limits

The tests were written first: the initial behavior suite failed all 17 cases
against stubs, then passed after callback implementation. A subsequent stable-fold
ordering test also preceded its implementation. There are now **18 behavior tests**.
The type tests reject missing memo identity/revision, incompatible inputs/reuse
payload types, prior-result mutation, and cold-miss reuse. They also check that
reuse leaves the public output type unchanged and that discovery/plain steps do
not require a memo identity. The complete program is checked with strict types.
Prior views are deeply readonly at the type level, including after awaiting
nested data. Runtime isolation from mutation still requires an implementation test.

| Checked now | Still requires the real runtime/adapters |
| --- | --- |
| Streaming page callback, fresh traversal, deduplication, closure/error/cancellation behavior | Managed fan-out begins assessment while a later page is blocked; independent people progress and close independently |
| Current finality function changes answer when policy changes | Hook invoked on every needed resolution, after reopen, and through cached outer consumers; no persisted finality flag |
| Validation returns reuse; changed reviews force fetch; failed/raced checks reject | Durable original provenance, concurrent claims, crash-safe publication, and exact prior-result reuse |
| Strict collection waits, propagates failure, and stabilizes ordering | Scheduler isolates independent siblings and never launches a paid summary before required closure |
| Schema validation and roster semantic checks | Real CSV syntax/schema adapter and provider-specific snapshot/validator coverage |
| Candidate types and complete program compile | Changed prompt reruns only affected LLM work; unread changes cut off; binding/identity conflicts across concurrent runs |

No test double is presented as evidence that those engine guarantees already
exist. Tests do not exercise a database, an HTTP cache, or a real LLM.

Run from the repository root:

```sh
node_modules/.bin/tsc --noEmit --strict --module NodeNext --target ES2022 \
  --noUncheckedIndexedAccess --exactOptionalPropertyTypes \
  docs/exploration/roster-example/analysis.ts
node_modules/.bin/tsd --typings docs/exploration/roster-example/surface.d.ts \
  --files docs/exploration/roster-example/authoring.test-d.ts
node_modules/.bin/tsc --strict --module NodeNext --target ES2022 \
  --noUncheckedIndexedAccess --exactOptionalPropertyTypes \
  --outDir docs/exploration/roster-example/.test-build \
  docs/exploration/roster-example/behavior.test.ts
NODE_OPTIONS=--experimental-vm-modules node_modules/.bin/jest \
  --config '{"rootDir":"./docs/exploration/roster-example","testEnvironment":"node","testMatch":["<rootDir>/.test-build/behavior.test.js"],"transform":{}}' \
  --runInBand
```

No package scripts or dependencies were changed. Generated test files live in the
already-ignored `.test-build` directory. Runtime execution of `analysis.ts` will
require implementation of the candidate surface; do not import it as a runnable
`microdelta` program today.
