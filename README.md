# microdelta

Persisted incremental analysis that reuses retained work across complete process
shutdown. **Implementation is incomplete; no package has been published.**

The repository, workspace, and core package use the `microdelta` identity.

Start with the **[specification entry point](docs/spec/README.md)**. It identifies
the active contracts, their owners, acceptance evidence, and bounded experiments.
Use the [milestones](docs/milestones.md) to choose the next work. Old source drafts
and exploratory APIs are [archived](docs/archive/README.md), not alternate authority.

The [delivery board](https://github.com/users/mike-north/projects/9) tracks readiness
and progress. [Repository issues](https://github.com/mike-north/microdelta/issues)
are the implementation queue; [delivery conventions](ENG_TEAM_INSTRUCTIONS.md)
define claims, acceptance evidence, supervisory review, and merge authority.

## Current checkout

The private `microdelta` facade reexports the existing public Store contract from
`@microdelta/history`. The implemented owner packages are
`@microdelta/definition` (diagnostic naming), `@microdelta/tracking`
(process-local observation utilities), and `@microdelta/history` (legacy row
Store, memory adapter, and conformance suite). The [package map](docs/package-map.md)
records their ports, release tiers, and the explicitly absent contexts.

API Extractor generates four declaration tiers and reviewed reports for each
implemented package. The checked source-import registry enforces directed context
edges. The full M0.5 foundation is still incomplete: the Node-first
[Machine host boundary](docs/spec/architecture.md) is issue #3, and direct
`AsyncLocalStorage` and `node:v8` imports remain known baseline violations.
The memory backend cannot persist across process exits or prove cross-row
publication. See [store conformance](packages/history/test/conformance/store/README.md).

[Historical validation](docs/validation.md) and the
[repository bootstrap record](docs/bootstrap-validation.md) are dated evidence,
not a claim that the remaining foundation gates pass.

## Development

```sh
npm ci
npm run check
npm test
npm run build
```

Runtime tests use Jest over compiled TypeScript ESM; type tests use tsd.
The checked declaration fixtures compile own untrimmed, sibling alpha, normal
external public, and explicitly selected beta package views. No package is
published, and release-tier trimming is a TypeScript contract boundary rather
than a JavaScript security sandbox.

Write tests from the governing requirements before implementing functionality,
and comment durable intent for modules and software abstractions. Runtime
experiment work starts at [M1](docs/milestones.md) after M0.5.
