# microdelta

microdelta is a TypeScript project for analyses that should keep their results
useful across complete process shutdowns. You choose which work may be retained;
the intended runtime records what that work actually consumed, then checks those
facts against current inputs and code before reusing an exact prior result.
This can apply to local computation, network work, or a nondeterministic judgment.

For example, an assessment of pull request 42 may read its title and prompt
configuration but never read its labels. A labels-only change need not require the
assessment to run again. A changed title or assessor implementation may. An
unrelated pull request has its own work and remains unaffected. The point is to
avoid work that the author chose to retain when its meaningful inputs are still
acceptable, not to require deterministic output or to cache every function.

microdelta is in development. Its active specification describes the target;
the current workspace implements owner contracts and bounded runtime pieces, not
the complete authoring, persistence, or reuse lifecycle. No package has been
published, and there is not yet a supported durable-analysis API for an external
consumer to install.

## Target workflow

The complete-runtime example is conceptual; it does not name a current API:

1. A source adapter obtains a current pull-request snapshot. The analysis declares
   an assessment for that pull request and opts that assessment into result
   retention. Source acceptance policy remains an explicit current decision.
2. The assessment reads `title` and tracked prompt/model configuration, then
   produces a result. Its provenance records the exact input/result references,
   consumed values, and called implementation evidence that support that run.
3. In a later process, microdelta reconnects the current definition and resolves
   those recorded paths against current bindings. If only `labels` changed and
   policy accepts the source, it can retain the prior assessment's exact result
   reference. If the title, consumed configuration, or called implementation
   changed, it must run the assessment again when admitted.
4. A newly retrieved source snapshot can become current even when the assessment
   reuses an older result. Revalidation records the new binding and acceptance;
   it does not rewrite the original result's historical provenance. A source policy
   can also reject reuse even when consumed values compare equal.

This example depends on several separate contracts. **Observation** says what an
operation consumed: reading `pr.author.name` consumes the name at that path, not
the author's ID or every pull-request field. Replacing the author while preserving
the name can compare equal; a later name change under that replacement must be
detected. Reading the ID explicitly makes it a dependency. **Implementation
evidence** belongs to functions actually called; changing an uncalled helper is
not evidence that the assessment changed. **Memoization policy** is an author
choice separate from tracking: tracked functions execute when called and are not
automatically memoized.

**Composition** declares a fixed graph of steps and relationships. It may create
dynamic instances for discovered pull requests or keyed members, but an execution
result cannot add undeclared graph structure. A tracked predicate may determine
whether a declared operation runs without changing that graph. These boundaries
allow current values and observed branches to vary without making the workflow's
topology an opaque consequence of arbitrary JavaScript.

These are target behaviors, not claims that the current checkout persists or
reuses assessment results. The [domain contract](docs/spec/domain.md),
[tracking contract](docs/spec/tracking.md), [composition contract](docs/spec/composition.md),
and [execution contract](docs/spec/execution.md) define their owners and cases.
The [glossary](docs/spec/glossary.md) establishes shared terms; the
[acceptance scenarios](docs/spec/acceptance.md) specify the required evidence.

The selected Value experiment covers `undefined`, `null`, booleans, strings,
numbers, sparse arrays, and supported plain records with bounded prototype
support. It rejects cycles/shared references, accessors, symbols, data functions,
`Date`, `Map`, `Set`, and class instances instead of silently treating them as
ordinary data. These are explicit support limits, not a promise that every value
JavaScript can express can be retained. See the [supported-value contract](docs/spec/tracking.md#structured-addresses-and-fingerprints).

## What runs in this checkout

The [package map](docs/package-map.md) records the current implementation and its
limits. The existing facade's public API is the compatibility History Store;
it is not the durable-analysis workflow above. Tracking's project-private alpha
observer can capture supported reads and called-function implementation evidence,
then compare those facts through a caller-supplied current-fact provider. Value
owns selected-fact encoding and comparison primitives. The observer does not own
a durable binding registry, source freshness policy, output materialization,
reuse decision, or persisted result lifecycle. Process-local tags and derivations
are also not cross-process evidence.

The following probe runs against those built workspace entries. It demonstrates
the current Tracking and Value alpha contracts only. It imports generated files
inside the private workspace because Tracking and Value are project-private alpha
declarations; their current names are absent from the default external TypeScript
surface. The JavaScript files are not a supported package entry point.

From a checkout with Node.js 20 or newer:

```sh
npm ci
npm run build
node --input-type=module <<'NODE'
import assert from 'node:assert/strict';
import { createNodeMachine } from './packages/machine-node/dist/src/index.js';
import { createTrackingObserver } from './packages/tracking/dist/src/index.js';
import { observe } from './packages/value/dist/src/index.js';

// Bind one captured source and one actually called assessor to current structural locations.
const observer = createTrackingObserver(createNodeMachine());
const sourceBinding = { path: ['pull-requests', '42'] };
const assessorBinding = { path: ['assessors', 'summary'] };
// This counter verifies ordinary calls; it is not an external influence of the assessment.
let calls = 0;
const assess = (pr) => {
  calls += 1;
  return `${pr.title}: ${pr.author.name}`;
};
const trackedPR = observer.tracked({
  title: 'Add retry support',
  labels: ['ready'],
  author: { id: 'u-1', name: 'Ada' },
}, sourceBinding);
const trackedAssess = observer.tracked(assess, assessorBinding);
const first = observer.capture(() => trackedAssess(trackedPR));
assert.equal(first.value, 'Add retry support: Ada');
assert.equal(first.observations.length, 3);

let currentPR = {
  title: 'Add retry support',
  labels: ['ready', 'backend'],
  author: { id: 'u-2', name: 'Ada' },
};
let currentAssess = assess;
const provider = {
  resolve(binding, address, operation) {
    if (binding.path[0] === 'assessors') {
      return { kind: 'available', fact: currentAssess };
    }
    return { kind: 'available', fact: observe(currentPR, address, operation) };
  },
};
const unreadChange = observer.compareCurrent(first, provider);
assert.equal(unreadChange.kind, 'equal');

currentPR = { ...currentPR, author: { id: 'u-2', name: 'Grace' } };
const changedRead = observer.compareCurrent(first, provider);
assert.equal(changedRead.kind, 'changed');

currentPR = {
  title: 'Add retry support',
  labels: ['ready', 'backend'],
  author: { id: 'u-2', name: 'Ada' },
};
currentAssess = (pr) => `${pr.title.toUpperCase()}: ${pr.author.name}`;
const changedImplementation = observer.compareCurrent(first, provider);
assert.equal(changedImplementation.kind, 'changed');

trackedAssess(trackedPR);
assert.equal(calls, 2);
console.log(JSON.stringify({
  result: first.value,
  observations: first.observations.map(({ kind, address }) => ({ kind, address })),
  unreadLabelAndAuthorIdChange: unreadChange.kind,
  changedConsumedName: changedRead.kind,
  changedCalledImplementation: changedImplementation.kind,
  callsWithoutMemoization: calls,
}, null, 2));
NODE
```

The probe returns `Add retry support: Ada`; it records the assessor
implementation, `title`, and `author.name`. Changing only labels and author ID
compares `equal`; changing the consumed name or called implementation compares
`changed`. Calling the tracked assessor twice increments its call count twice.
The counter is test instrumentation for this snippet; production conclusions
must not depend on an untracked closure value like this one.
The provider is deliberately local and in-memory: this demonstrates observation
semantics, not durable binding reconstruction, a source-policy decision, exact
result-reference retention, or restart behavior. Function-source evidence also
cannot prove arbitrary closure captures sound; the author remains responsible for
tracking every external influence that should invalidate retained work.

## Project status and contribution

The [specification entry point](docs/spec/README.md) is the active design
authority. Read it first, then the owning contract and its acceptance scenarios.
[Delivery milestones](docs/milestones.md) define the implementation order; the
[repository issue queue](https://github.com/mike-north/microdelta/issues) tracks
the work. The current milestone record marks M0.5 and M1 accepted. M2 tracking
and package contracts are in progress and establish supported observations and
value semantics, not durable memoization. M3 adds the
small persisted analysis path with exact references and current source acceptance.
M4 adds general composition and keyed collections. M5 covers operational
correctness; M6 delivers the CLI and inspection surface; M7 assembles the full
roster workflow and scale acceptance. Review the [milestones](docs/milestones.md)
and [implementation map](docs/package-map.md) for current status rather than
inferring completion from an experiment or alpha package.

To build and check this private workspace:

```sh
npm ci
npm run check
npm test
npm run build
```

Runtime behavior uses Jest; package type contracts use tsd. The checks also cover
strict TypeScript, type-aware lint, source-import boundaries, generated declaration
consumers, and reviewed API reports. For implementation work, follow
[delivery conventions](ENG_TEAM_INSTRUCTIONS.md): derive outcome assertions from
the owning contract before changing software, observe the expected failure, and
document durable intent in code. Contributors open scoped PRs for supervisory
review; only the supervisor merges accepted work. Packages remain private and
unpublished.
