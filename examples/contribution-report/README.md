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
| `--rubric A\|B\|C\|P` | The assessor implementation supplied to the `assessor` slot; `P` is the paid-like assessor (below) | `A` |
| `--minimum-authored N` | The gate threshold input (a nonnegative integer) | `1` |
| `--key key\|id` | Designated identity `key`, or the custom key `id` | `key` |
| `--open-discovery` | The fixture upstream reports its contributor listing as still open | closed |
| `--reverse` | Register helpers and steps in reverse order | forward |

`recover` takes no composition choices: it uses the ones saved with the
request. It accepts a repeatable `--member KEY` to name a member explicitly.

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
| `--minimum-authored 1` after starting at 2 | Cy's activity and summary, PR 301's assessment and the report | Discovery, Ada's and Ben's summaries and assessments |
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
  admitted executions durably produced, without running a source hook,
  finality policy or step body: discovery's, the report fold's, and the summary
  of every member named by the recovered discovery listing, the recovered
  report's required members or `--member`. Keying the recovered listing runs
  the declared key projection, so under `--key id` it evaluates the custom key.
  A run interrupted before its report executed (for example a report left
  waiting on open discovery) still recovers every member its discovery listed.
  Reuse allocates no execution, so after a run that reused discovery and the
  report `recover` reports them `absent` and lists only `--member` keys. Each
  `run` replaces `requests.json`, so recover an interrupted run *before*
  starting another.
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

## Operating the analysis: the paid-like assessor

`--rubric P` supplies the **paid-like assessor**: each PR's assessment is one
declared external operation (`currentExecution().operation`) sent to the
example's fake provider (`src/provider.ts`). It never costs money. It answers
after a deterministic latency, scores as rubric A does (so the report text is
the same), and reports 100 tokens of usage per answered assessment and 1
request per refusal. Each assessment is its own supplied step, so a completed
assessment is reused rather than paid for again.

The provider keeps its state in `DIR/provider`: `ledger.jsonl` records every
request received, applied and aborted, and an optional `script.json` scripts
each PR's successive responses, across processes:

```json
{ "responses": { "201": ["rate-limit:1500"], "103": ["stall"], "301": ["refuse", "ok"] } }
```

Responses are `ok`, `slow:<ms>`, `rate-limit:<ms>` (refused with a retry time
`<ms>` after receipt), `refuse` (permanent), `lost` (performed, response lost)
and `stall` (never answered until aborted). Unscripted requests answer `ok`.

Every command opens Resource Accounting's durable adapter over
`DIR/accounting.sqlite` and injects it into the workspace
(`openWorkspace({ ..., accounting })`). The facade itself never depends on the
Accounting package, which is not yet published; the example imports it, and
the Node SQLite capability it opens with, as the facade's caller.

| Command or flag | Meaning |
| --- | --- |
| `--environment fixture\|trial\|production` | The run's environment (`run`, `status`, `check`, `operations`, `settle`); environments are namespaces of the one store |
| `--deferral sleep\|exit` | `run`/`status`: once only deferred work remains, sleep and resume (default), or exit and report `Deferred work waits until T` |
| `--permits N`, `--window N` | `run`/`status`: sends in flight at once (default 1), members resolving at once (default 8) |
| `--lease-ms N` | `run`/`status`: the writer lease duration (default 30 s) |
| `--writer-deadline-ms N` | `run`/`status`: fail with `writer-busy` if the writer lease is still held N ms after start; without it a second process waits |
| SIGINT, then SIGINT again | `run`/`status`: a soft stop (admit nothing new; admitted steps drain), then a hard stop (abort in-flight sends; publish nothing partial) |
| `status` | The outcome (tolerant) status report: every contributor's settled status, failures included, with coverage; it waits while a member is unsettled |
| `operations` | The environment's external operations, usage summary and promotions; needs no writer lease |
| `settle --operation ID --abandon` or `--resolve succeeded\|failed` | The operator's settlement of an unknown operation |
| `promote --from trial --to production` | Promote every result the source environment's current report rests on; executes nothing |

Usage is counted once per report. An attempt whose response was lost, or whose
process died before its report, is **unknown**, never zero, and is never
replayed until an operator settles it. A rate limit with a retry time defers
only that assessment; its siblings finish, and no run sends it before the time.
Trial results satisfy production only through a recorded promotion, after
which production reuses them and pays nothing. `npm run test:examples` drives
each of these through separate processes (`test/paid.test.mjs`).

## Limits

No paid provider, language model or live GitHub API is called: the paid-like
assessor is a local fake. The example's process tests prove the single-host
process-termination scope only, not power loss. Independent-process acceptance
and dated evidence are separate proofs.
