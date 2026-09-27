# Working in microdelta

## Authority and design

- Use `microdelta` for the project and library entry package, and `@microdelta/*`
  for scoped packages. This naming decision is settled.
- Start with [the specification entry point](docs/spec/README.md), then the owning
  contract and its acceptance criteria. [Milestones](docs/milestones.md) define
  delivery order. Archived material is historical evidence, not another active spec.
- Use the [ubiquitous language](docs/spec/glossary.md) for domain terms
  in code, tests, issues, and discussion; update definitions with their owning
  contracts when their meaning changes.
- Explain an abstraction's meaning, purpose, responsibilities, relationships, and
  invariants before choosing its representation. Challenge it with concrete consumer
  questions and realistic variation. Do not invent future requirements or reopen
  settled decisions without a demonstrated conflict.
- Preserve the six bounded contexts and their invariant owners. Machine supplies
  host capabilities; it does not absorb domain policy or persistence ownership.
- Record durable intent in comments throughout the codebase, including but not
  limited to constants, types, functions, classes, and modules. Explain meaning and
  boundaries rather than restating declarations. Keep task progress and milestone
  narratives in work records. Update comments when semantic contracts change.

## Engineering discipline

- Write tests first from specification requirements or explicit intended outcomes,
  including negative cases. Observe the expected failure before implementation.
- Apply strict TypeScript and type-aware linting from the start, including in
  experiments. Prefer narrowing over casts, immutable values, exhaustive unions,
  and explicit function contracts. Do not weaken checks or introduce broad escape
  hatches to make an experiment pass.
- Use Jest for runtime behavior and tsd for type contracts. Document suppressions;
  obtain user approval before enabling `skipLibCheck`. Prefer named type/interface
  declarations with the `I` prefix. Do not use TypeScript enums.
- Follow the declaration tiers and dependency boundaries in
  [package boundaries](docs/spec/package-boundaries.md). Each exported API needs
  an intentional release tag and appropriate TSDoc. Sibling consumers use generated
  declarations, never private source aliases.
- Node-specific runtime access belongs in the Node Machine implementation. Tests
  and build tooling may run in Node. Do not add another host implementation without
  an issue requiring it.
- Automate mechanically assessable expectations with compiler, lint, tests, hooks,
  or CI. Review judgment evaluates domain meaning and whether those checks express
  the right requirements; it does not substitute for executable checks.

## Delegation and merge authority

- GitHub issues are the implementation queue. Use the GitHub CLI for projects.
  Read [delivery conventions](ENG_TEAM_INSTRUCTIONS.md) before claiming work.
- The supervisory agent owns architecture, issue readiness, substantive review,
  and merge decisions. Delegate contained implementation to the least expensive
  capable agent; escalate consequential semantic questions with concrete evidence.
- Implementers work on one issue in an isolated worktree, open a pull request with
  evidence, and stop for review. They do not merge or broaden their assignment.
- No paid-provider execution, package publication, repository visibility changes,
  or release automation changes without explicit authorization for that work.
