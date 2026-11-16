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

## See it work

The checked-in [contribution report](examples/contribution-report/README.md)
scores the pull requests in a fixture repository and combines each contributor's
summary into a report. It needs no credentials, network provider or paid calls.
With Node.js 24, from a checkout:

```sh
npm ci
npm run build
node examples/contribution-report/dist/main.js run --store .test-build/readme-demo --json
node examples/contribution-report/dist/main.js run --store .test-build/readme-demo --json
node examples/contribution-report/dist/main.js run --store .test-build/readme-demo --rubric C --json
```

Each command is a fresh process opening the same SQLite store. The JSON reports
each step's outcome, its exact result reference and how many step bodies ran.
These commands belong to the example. The installed `microdelta` executable can
also start a run in the foreground and observe a finite exact execution; the
[workspace consumer guide](docs/private-alpha-workspace-consumers.md) describes
those commands and their receipts.

| Run | What executes | What changes |
| --- | --- | --- |
| First run | Discovery, three activity sources, six assessments, three summaries, the report | Ada scores 5, Ben 3, Cy 2 |
| Unchanged restart | Source-policy checks only; no step bodies | Every result is reused with its earlier reference |
| Changed assessor (`--rubric C`) | All six assessments, Ben's summary, the report | Ben becomes 4; Ada's and Cy's summaries keep their references |

In the last run every assessment executes, but Ada's and Cy's scores come out
equal. Their summaries consumed only scores, so the runtime cuts off there and
retains them. That is reuse across a complete process exit, decided by what each
step actually read.

## How reuse works

An author declares **sources**, **memoized steps** and their composition.
Sources carry an explicit acceptance policy: a stored snapshot is current only
when its policy says so. Tracked reads record the facts a step consumes, so
reading one field does not make the whole record a dependency. Called
implementations are recorded too, so a changed assessor invalidates what it
produced.

On a later run the runtime checks that evidence against current bindings and
source policy. Accepted reuse keeps an exact reference to the earlier result.
When a child produces new output, downstream work stays reusable if the facts it
consumed are unchanged.

The [facade guide](packages/core/README.md) describes the authoring surface, and
the [tracking](docs/spec/tracking.md) and [execution](docs/spec/execution.md)
contracts define the model.

## Status

microdelta is experimental. The authoring API is project-private alpha and the
durability evidence is bounded to a single fenced writer on local SQLite.
[Status and limits](docs/status.md) lists every current boundary in one place,
including the native SQLite dependency. If `npm ci` has no prebuilt
`better-sqlite3` for your platform, see the
[native toolchain guide](docs/native-sqlite-toolchain.md) or, for pnpm
consumers, the [native install guide](docs/native-sqlite-install.md).

## Explore and contribute

- [Example walkthrough](examples/contribution-report/README.md): run, change,
  recover and inspect the fixture analysis.
- [Implementation map](docs/package-map.md): what each package does today.
- [Specification](docs/spec/README.md) and [glossary](docs/spec/glossary.md).
- [Milestones](docs/milestones.md) and the
  [issue queue](https://github.com/mike-north/microdelta/issues).

Contributors run `npm run check`, `npm test` and `npm run build`, and follow the
[delivery conventions](ENG_TEAM_INSTRUCTIONS.md). Publication is a separate,
human-controlled decision under the [release process](docs/releasing.md).
