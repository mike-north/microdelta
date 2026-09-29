# Contribution report example

A checked-in, executable example of the workspace authoring and run path. For
`acme/widget` over the UTC window `[2026-01-01, 2026-04-01)` it **discovers**
the repository's contributors, summarizes each required contributor with a
nested, supplied assessor, and combines every required summary into one
**strict** repository report. It keeps the report current across complete
process exits.

> **Unstable, project-private API.** The example imports `microdelta`'s
> generated **alpha** declarations from this workspace. Every name it uses is a
> project-private `@alpha` contract that may change without notice. The
> default `microdelta` package entry does not expose any of it, and this
> example is not an installation guide for a published package.

## Run it now

From the repository root, after `npm ci`:

```sh
npm run build                     # builds the packages and this example
node examples/contribution-report/dist/main.js run --store .test-build/example-store
node examples/contribution-report/dist/main.js run --store .test-build/example-store --reverse
node examples/contribution-report/dist/main.js recover --store .test-build/example-store
node examples/contribution-report/dist/main.js check --store .test-build/example-store
```

`run` and `check` accept composition choices:

| Flag | Meaning | Default |
| --- | --- | --- |
| `--rubric A\|B\|C` | The assessor implementation supplied to the `assessor` slot | `A` |
| `--minimum-authored N` | The gate threshold input (a nonnegative integer) | `1` |
| `--key key\|id` | Designated identity `key`, or the custom key `id` | `key` |
| `--open-discovery` | The fixture upstream reports its contributor listing as still open | closed |
| `--reverse` | Register helpers and steps in reverse order | forward |

Add `--json` to any command for machine-readable output: discovery, each
member's typed outcome and exact reference, each succeeded member's summary,
the report's typed outcome with its exact reference and coverage, and counts of
executed bodies and finality evaluations by step, observed through run
observers. `npm run test:examples` runs these commands as separate processes
and checks their output.

The first `run` executes discovery, each contributor's activity source and
summary, six assessments and the report once, and prints:

```text
Contribution report for acme/widget, 2026-01-01 to 2026-04-01 (exclusive)
Required: contributors with at least 1 authored pull request in the window
- person:ada (score 5): Ada authored 3 pull requests, 2 of which were merged, and submitted 5 reviews.
- person:ben (score 3): Ben authored 2 pull requests, 1 of which was merged, and submitted 3 reviews.
- person:cy (score 2): Cy authored 1 pull request, 1 of which was merged, and submitted 1 review.
Coverage: 3 required, 0 skipped; discovery closed
```

A later `run` in a new process evaluates discovery's and each activity's
current finality policy and executes no member, assessment or report body: the
report and every summary keep their exact references.

## What changes rerun

| Change | What executes | What keeps its exact reference |
| --- | --- | --- |
| Nothing (restart, in either registration order) | No body; finality policies only | Discovery, activities, summaries, assessments, report |
| `--rubric B` (explanation text only) | The six assessments | Every summary and the report |
| `--rubric C` (Ben's merged bug fix scores 3) | The six assessments, Ben's summary and the report | Ada's and Cy's summaries |
| `--minimum-authored 2` | The report; Cy is skipped | Ada's and Ben's summaries |
| `--minimum-authored 1` again | Nothing | Cy's summary and the earlier report validate again |
| `--open-discovery` | Discovery's check; the report waits | Every summary; no report is published |
| Closed listing again | Discovery's check | The earlier complete report validates again |

A skip or an open listing never retracts an earlier publication. The report
states the threshold it applied, so any threshold edit changes a fact the
report consumed and reruns it.

## What the example shows

- **Discovery** (`src/discovery.ts`). `contributors` is a composition-level
  keyed collection source. Its result lists contributor records with a
  completion status. Each record's designated identity is its `key`
  (`person:ada`). With `--key id`, the template keys members by the upstream
  profile `id` (`gh:1001`) instead. A missing or duplicate key would reject the
  whole listing before any member work; array position is never identity.
- **Fanout template and gate** (`src/analysis.ts`). The `contributor` template
  builds its member steps once against a symbolic member and is instantiated
  per member key. Its gate is a tracked author predicate: a member is required
  when its authored count reaches `config.minimumAuthored`, and otherwise is a
  `skipped` instance.
- **Member binding.** Each member's `activity` source reads its member's `key`
  through the `member` binding to select that contributor's activity. Its
  subject is `activity:acme/widget:2026-Q1:<member key>`.
- **Nested memoized calls through a supplied assessor.** Each `summary` calls
  `activity`, then the `assessor` step slot once per authored PR. The PR number
  is a derived argument, and the PR record is forwarded from the activity result
  (`forward.child(activity, ['pullRequests', index])`). Each assessment
  publishes under `assessment:acme/widget:<number>`. The summary consumes each
  assessment's `score`, never its explanation, so an equal score keeps the
  summary even when the assessment reran.
- **Strict fold** (`report`). The report runs only when discovery is closed
  and every required member succeeded. Its body receives one entry per current
  member in key order: succeeded with the member's summary, or skipped. It
  lists required members with sentence and score, lists skipped members as
  excluded by the gate, and states repository, window and threshold. Coverage
  (`required`, `skipped`, closed discovery) comes from the framework's fold
  outcome, not from the body. With open discovery or a pending member the
  report waits, and a failed member fails it; neither runs its body.
- **Source policy.** The fixture adapters read `data/acme-widget.json` in place
  of a live GitHub API. Activity finality treats the previous result as final
  while the fixture revision is unchanged. Discovery finality also requires
  the upstream's listing status to be unchanged. Both confirm the run's
  environment with `currentRun()`; no context parameter is threaded through a
  helper.
- **Normal and recovery entry operations** (`src/main.ts`). `run` saves a
  fresh request key and its composition choices to `requests.json` *before*
  starting work, then resolves the report through `run.resolveFold(step, {
  requestKey })`. `recover` reads that request and reports what the identified
  admitted executions durably produced, without running author code or source
  hooks: the report fold's, and each summary the recovered report lists as
  required. Reuse allocates no execution, so after a run that reused the report
  `recover` reports `absent` and lists no members. Each `run` replaces
  `requests.json`, so recover an interrupted run *before* starting another.
- **Check.** `check` reports what a normal run would do for discovery and,
  once discovery is reusable, for each keyed member's summary, without
  admission, bodies or writes. A strict fold has no check-only request.

## Attribution, discovery and rubric rules

These are the example's application policy, not framework rules:

- A contributor's **authored pull requests** are the unique PRs they authored
  whose creation time falls in the half-open window `[start, end)`. PR 98
  (created before the window) and PR 204 (created exactly at the exclusive end)
  are excluded.
- The **merged** subset uses each PR's current merged status. The window
  restricts creation time, not merge time.
- A contributor's **reviews** are the unique reviews they *submitted* in the
  window. Pending reviews are excluded (`rv-ada-6`), as are reviews outside the
  window (`rv-ada-0`, `rv-ben-4`).
- A contributor is **discovered** when they authored a PR created in the
  window or submitted a non-pending review in the window: Ada, Ben and Cy.
  `person:dot` is not: PR 99 predates the window, `rv-dot-1` is pending and
  `rv-dot-2` follows the window.
- **Rubric A** scores a merged PR 2 and an unmerged PR 1 and explains its
  reasoning in text: Ada 2 + 2 + 1 = 5, Ben 2 + 1 = 3, Cy 2. **Rubric B**
  changes only the explanation text. **Rubric C** also scores a merged PR
  labelled `bug` 3; in the window only Ben's PR 201 is one, so Ben scores 4.
- A duplicate PR number or review id, or a record naming an unknown
  contributor, is a fixture error.
- PR counts and scores are not a measure of contribution quality.

## Array-position semantics

The selected activity keeps PRs ordered by number and reviews by id. The
summary reads `pullRequests.length`, each `pullRequests[index].merged` and
`number`, and `reviews.length` with indexed loops. Those are positional facts
about the exact retained arrays: changing an unread field (a label, the avatar
URL, profile identity or the fixture revision) keeps the summary, while
changing a consumed merged status or the number of PRs or reviews reevaluates
it. Discovery order is not identity: members are keyed, and reordering the
listing changes no member.

## Limits

No paid provider, language model or live GitHub API is called. The example
exercises the durable path within ordinary process restarts. Process-kill
points, lost-acknowledgment acceptance and dated evidence are separate proofs.
Retry, quota waits and cancellation breadth are later work.
