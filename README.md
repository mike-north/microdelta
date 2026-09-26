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

The private `microdelta` package in `packages/core` contains an in-memory Store,
naming utility, internal tracking facade and tests. It does not yet provide an
assembled durable runtime. The accepted six-context architecture and declaration
tiers are targets; the current single-package scaffold does not enforce them yet.
The Node-first [Machine host boundary](docs/spec/architecture.md) is also a target;
runtime `AsyncLocalStorage` and `node:v8` dependencies are not yet isolated.

[Historical validation](docs/validation.md) records earlier checks and their limits.
The [repository bootstrap record](docs/bootstrap-validation.md) records the current
import's local checks and distinguishes them from the unimplemented foundation.
The Store conformance suite establishes single-row CAS/snapshot behavior, not
cross-row publication, restart recovery or stale-worker fencing. The memory backend
cannot persist across process exits. See [store conformance](packages/core/test/conformance/store/README.md).

## Development

```sh
npm ci
npm run check
npm test
npm run build
```

Runtime tests use Jest over compiled TypeScript ESM; type tests use tsd. The existing
ESLint component graph and its fixture describe the old scaffold only. Migrating
that checker to the new package/context contracts, adding type-aware lint and
API Extractor declaration checks, and enforcing the Node boundary are the
[M0.5 foundation](docs/milestones.md). The commands above describe the current
scaffold, not evidence that this gate already passes.

Write tests from the governing requirements before implementing functionality,
and comment durable intent for modules and all software abstractions. Runtime
experiment work starts at [M1](docs/milestones.md) after M0.5; it must not
silently implement an archived API.
