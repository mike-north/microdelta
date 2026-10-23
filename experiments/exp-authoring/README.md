# Bounded expressive authoring experiment

```ts
const assessment = analysis<IPullRequestInputs>((input) =>
  memo({
    name: 'assessment',
    from: { pr: input('pr') },
    run: ({ pr }) => pr.title.length,
  }));
```

This is an internal experiment, not an exported library API. The complete executable examples are [entries.ts](authors/entries.ts) and its imported [assessment factory](authors/assessment.ts). The [proposal](../../docs/plans/authoring-experience.md) contains the wider authoring sketches; only fixed graphs with one or two synchronous numeric computations are implemented here. The executable first slice uses `input('pr')`; the proposed `input.pr` syntax is not implemented.

A factory constructs the graph once. `from` supplies owned symbolic origins, not runtime values. A callback receives ordinary selected values, and returns a number directly. Its `name` is both its structural occurrence and default complete history subject; an explicit `subject` overrides the latter verbatim. Distinct nodes cannot share an occurrence or complete subject. Two aliases of the same node are valid.

The application opens the existing workspace and calls `execute` with the graph, current input snapshots, analysis, environment and request key. See [worker.ts](test/worker.ts) for complete local bootstrap and shutdown. No provider, manifest, transform, new host or runtime package is introduced.

Run from the repository root after dependencies are installed:

```sh
npm run build
npm run test:exp-authoring
npm run check
npm test
```

The configured build emits the experiment before Jest. Normal `check` includes strict/portable compilation, type-aware capture lint and import boundaries; normal `test` includes its tsd and runtime assertions. See the [decision and evidence](decision.md) for the mechanism boundary and baseline counterexamples.
