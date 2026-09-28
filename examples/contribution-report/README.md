# Contribution report example

A checked-in, executable example of the workspace authoring and run path. It
builds a repository contribution report for `acme/widget` over the UTC window
`[2026-01-01, 2026-04-01)` for two explicitly selected contributors,
`person:ada` and `person:ben`, and keeps it current across complete process
exits.

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

Add `--json` to any command for machine-readable output, including counts of
executed source checks and summary bodies, finality evaluations and ordinary
work, observed through run observers. `npm run test:examples` runs these
commands as separate processes and checks their output.

The first `run` executes each contributor's activity source and summary once
and prints:

```text
Contribution report for acme/widget, 2026-01-01 to 2026-04-01 (exclusive)
Selected contributors: person:ada, person:ben (not complete repository coverage)
- person:ada: Ada authored 3 pull requests, 2 of which were merged, and submitted 5 reviews.
- person:ben: Ben authored 2 pull requests, 1 of which was merged, and submitted 3 reviews.
```

A later `run` in a new process (optionally resolving Ben first with
`--reverse`) evaluates each source's current finality policy, executes no
summary body, reuses both exact summary results and assembles the report again.

## What the example shows

- **Declarations and composition** (`src/analysis.ts`). Each contributor has
  a retained activity **source** and a memoized **summary** whose only child
  is that contributor's activity. The fixed relationships are composed before
  any run. Callbacks use only their typed context: tracked `inputs` and
  `helpers`, a source's `previous` and `outcome`, and a memo's declared
  `calls`. A declared child call resolves to `{ data }`, a lazy view over the
  child's exact result, so awaiting it never reads a `then` field.
- **Opaque subjects.** Subjects such as
  `summary:acme/widget:2026-Q1:person:ada` are complete author-chosen strings.
  The framework never derives them from names or labels. Member keys, not
  registration order, connect each contributor's steps across runs.
- **Source policy** (`src/activity.ts`). The source check reads the checked-in
  fixture `data/acme-widget.json` in place of a live GitHub API. The finality
  hook treats the previous result as final while the fixture revision is
  unchanged. It runs only for an eligible previous result.
- **Scoped run context.** The source adapter confirms the run's selected
  environment with `currentRun()`. No context parameter is threaded through
  any helper. Lookup outside a live run, from a callback that escaped a closed
  run, or during composition fails.
- **Normal and recovery entry operations** (`src/main.ts`). `run` saves a
  fresh request key per summary to `requests.json` *before* starting work and
  passes it as `{ requestKey }`. `recover` reads those keys and reports what the
  identified admitted executions durably produced, without running author code,
  source hooks or writing acceptance. Reuse allocates no execution, so after a
  run that reused both summaries `recover` reports `absent`. After the first,
  executing run it returns the exact committed summaries.
- **Ordinary report assembly** (`src/report.ts`). The report is nonmemoized
  work: it runs on every run, is observed at `begin` and `end`, and has no
  completed-result identity. It reads each summary's exact result and orders
  contributors by stable key, whatever order they were resolved in.

## Attribution rules

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
- A duplicate PR number or review id, or a record naming an unknown
  contributor, is a fixture error.
- The report covers only the **selected scope**: the two named contributors.
  `person:cy` has activity in the fixture but is not selected. The report never
  claims complete repository coverage, and PR counts are not a measure of
  contribution quality.

## Array-position semantics

The selected activity keeps PRs ordered by number and reviews by id. The
summary reads `pullRequests.length`, each `pullRequests[index].merged` and
`reviews.length` with indexed loops. Those are positional facts about the
exact retained arrays: changing an unread field (a label, the avatar URL,
profile identity or the fixture revision) keeps the summary, while changing a
consumed merged status or the number of PRs or reviews reevaluates it.
Reordering the arrays changes which element sits at each position; the
framework does not promise that a reordering is invisible to code that reads
positions.

## Limits

No paid provider, language model or live GitHub API is called. The example
exercises the durable path within ordinary process restarts. Process-kill
points and lost-acknowledgment acceptance are separate proofs. Dynamic
contributor discovery, general fanout and cached report folds are later work.
