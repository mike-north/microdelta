# microdelta

microdelta is a TypeScript library for keeping expensive analyses current across
process restarts. You choose which steps to memoize. The runtime retains their
results and records the inputs and called implementations they consumed, so later
runs can validate that evidence before deciding what to reuse.

Consider a report that assesses hundreds of pull requests. An assessment reads a
pull request's title and diff, but ignores its labels. A labels-only edit should
not require another assessment. A changed title or assessor should. If an
assessment runs again but produces the same score, a summary that consumed only
that score can still keep its earlier result. The goal is to avoid repeating work
whose relevant evidence remains acceptable, including work that is costly or
nondeterministic.

**Experimental:** a bounded durable runtime, keyed composition, and operational
controls are implemented in this repository. The authoring API remains
**project-private alpha**, with breaking changes expected. The default public
TypeScript entry exposes the compatibility History Store API, not the durable
analysis API used below. Start with the checkout example to evaluate the runtime;
this is not a supported external installation guide.

## Try a durable analysis

The checked-in [contribution report](examples/contribution-report/README.md)
analyses a fixture repository, scores its pull requests, and combines contributors'
summaries into a report. It uses local fixture data and deterministic TypeScript
assessors: no GitHub credentials, network provider, or paid calls are required to
run it.

Use **Node.js 24** and npm from a checkout of this repository. Installation needs
network access for dependencies. The SQLite adapter uses the native
`better-sqlite3` dependency; if a matching prebuilt binary is unavailable, a working
native build toolchain is required. Do not assume every newer Node version is
supported by that dependency.

From the repository root, choose a store directory that does not already contain
a previous example run:

Before choosing a durable store location, review the [native store location
guidance](docs/native-store-locations.md) for supported path spellings and the
SQLite hard-link/WAL limitation.

```sh
npm ci
npm run build
node examples/contribution-report/dist/main.js run --store .test-build/readme-demo --json
node examples/contribution-report/dist/main.js run --store .test-build/readme-demo --json
node examples/contribution-report/dist/main.js run --store .test-build/readme-demo --rubric C --json
```

Each `node` command starts a fresh process and opens the same SQLite-backed store.
These commands belong to the **example's CLI**; the general-purpose microdelta CLI
and inspection checkpoint are still planned.

The JSON includes the report, each member's outcome and exact result reference,
body execution counts (`executions`), and source-policy checks (`finality`). The
three commands show different behavior:

| Run | What executes | What the report shows |
| --- | --- | --- |
| First run | Discovery, three activity sources, six assessments, three summaries, and the report | Ada scores 5, Ben 3, Cy 2; all three contributors are covered |
| Unchanged restart | Source-policy checks; no step bodies (`executions` is `{}`) | The summaries and report have `kind: "reused"` and retain their exact references |
| Changed assessor (`--rubric C`) | All six assessments, Ben's summary, and the report | Ben's score becomes 4; Ada's and Cy's summaries retain their exact references |

The final run changes how a merged bug fix is scored. Ada's and Cy's assessments
also run again, but their scores stay equal. Their summaries consume scores rather
than assessment explanation text, so those summaries can be retained. This is
reuse across a complete process exit and a cutoff at unchanged consumed output,
not merely an identical printed report.

See the [example guide](examples/contribution-report/README.md) for its source,
composition choices, recovery commands, cancellation, and spend-free operational
scenarios. Its [existing tests](examples/contribution-report/test/example.test.mjs)
check output, invocation counts, and exact references in separate processes.

## How reuse works

An author declares sources, memoized steps, and their composition. **Sources have
an explicit acceptance policy**: a stored snapshot does not become current merely
because it exists. In this example the policy checks a fixture revision; a real
adapter must decide how to validate its own source.

Tracked reads record the supported facts a step consumes. Reading a name does not
implicitly consume every other field of its containing record. Called
implementation evidence matters too. Tracking and memoization are separate:
authoring a tracked helper does not automatically retain its result.

On a later run, the runtime checks the recorded evidence against current bindings
and source policy. Accepted reuse keeps an **exact reference** to the earlier
result. Current acceptance is separate from that result's original provenance.
When a child produces new output, downstream work can remain reusable if the facts
it consumed are unchanged.

Authors remain responsible for declaring and tracking relevant external
influences. Arbitrary mutable closure state, hidden I/O, and every possible
JavaScript operation are not automatically made safe by function-source tracking.
The [facade guide](packages/core/README.md) describes the alpha authoring surface;
the [tracking](docs/spec/tracking.md) and [execution](docs/spec/execution.md)
contracts explain the model and its boundaries.

## Current scope and limitations

The repository's accepted runtime includes durable results and references, keyed
fanout and folds, fenced writer coordination, retry and cancellation controls,
environment isolation, and known-versus-unknown resource accounting. Its evidence
is bounded to one fenced writer per store on single-host SQLite, including process
kill/restart tests; it does not establish distributed or power-loss guarantees,
lease-wait fairness, or production readiness.

[Nullable-container guards](https://github.com/mike-north/microdelta/issues/155)
retain bounded kind evidence across restarts. Upgrading invalidates earlier
computation evidence and may recompute prior work; exact historical results and
operation journals remain readable. See the
[tracking evidence compatibility boundary](docs/spec/execution.md#reuse-001--reuse-is-a-current-contextual-decision).
Do not treat the example or accepted checkpoints as a guarantee that arbitrary
analyses are safe. General CLI inspection, full workflow/scale acceptance, and
real-provider acceptance remain undelivered.

Supported structured data is deliberately constrained. Plain records and arrays
are the current result-root shapes; unsupported values such as cyclic/shared
references, accessors, `Date`, `Map`, `Set`, and class instances are rejected. See
[supported values](docs/spec/tracking.md#structured-addresses-and-fingerprints)
and the [implementation map](docs/package-map.md) for precise boundaries.

Published packages and the checkout's private-alpha API are different surfaces.
The [first-release record](docs/validation/first-release-2026-09-28.md) documents the
historical `0.1.0` publication; it does not make the current alpha authoring API a
supported public contract. Resource Accounting remains a private workspace
package supplied through an injected port.

## Explore and contribute

- [Example and walkthrough](examples/contribution-report/README.md): run, change,
  recover, and inspect the fixture analysis.
- [Facade API guide](packages/core/README.md): public compatibility Store versus
  private-alpha authoring and operations.
- [Implementation map](docs/package-map.md): package responsibilities and delivered
  capabilities.
- [Specification](docs/spec/README.md) and [glossary](docs/spec/glossary.md): active
  design authority and shared terms.
- [Delivery milestones](docs/milestones.md) and
  [issue queue](https://github.com/mike-north/microdelta/issues): accepted evidence
  and remaining work.

After installing dependencies, contributors run:

```sh
npm run check
npm test
npm run build
```

Runtime tests use Jest and type contracts use tsd. Checks enforce strict
TypeScript, type-aware lint, package/declaration boundaries, and API reports.
Follow [delivery conventions](ENG_TEAM_INSTRUCTIONS.md): use a scoped issue and
isolated worktree, derive tests from intended behavior before changing software,
and open a PR for supervisory review. Package publication remains a separate,
human-controlled decision under the [release process](docs/releasing.md).
