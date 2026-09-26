# Repository bootstrap validation

Date: 2026-09-26. This is a dated evidence record for the initial repository import,
not an additional specification or a claim that the foundation is complete.

## Verified baseline

On Node 24.14.0 with npm 11.18.0:

- `npm run check` passed the existing TypeScript, lint, and component-boundary checks.
- `npm test` passed 69 runtime tests, the tsd type suites, and five tooling tests.
- `npm run build` passed.
- The package-name consumer fixture failed before the rename, then passed for
  `microdelta` and `microdelta/conformance/store` after the package metadata,
  lockfile, and workspace resolution were updated.
- The private root workspace is `@microdelta/workspace`; its lockfile identity
  matches. The library entry package is `microdelta`; future scoped packages use
  `@microdelta/*`.
- Local Markdown targets, heading/line anchors, code fences, unique requirement
  definitions, and structured artifact syntax were checked without errors.

## Scope and limits

The import preserves the scaffold, tests, active specification, historical archive,
and existing CI workflow. The roadmap now puts the strict engineering and Machine
foundation before runtime experiments. Agent instructions and delivery conventions
make issue ownership, evidence, supervision, and merge authority explicit.

The baseline's component checker is still the legacy scaffold checker. Type-aware
linting, API Extractor declaration tiers, the accepted package layout, and Node
Machine isolation remain foundation work. No bounded mechanism experiment, durable
runtime, paid-provider integration, or package release is claimed by these results.

The existing GitHub workflow runs checks, tests, and build on Node 20, 22, and 24.
Its remote result must be inspected after the import is pushed; the local results
above do not stand in for a GitHub Actions run.

## Clean-checkout consumer correction

The initial GitHub Actions run failed its package-identity fixture because the
fixture assumed Node would resolve an unbuilt workspace export through a physical
`packages/core` path. In an isolated checkout with no `dist`, `npm ci` succeeded,
then the original tooling test failed: Node resolved the package through
`node_modules/microdelta/dist/src/index.js`.

The corrected tooling command builds the workspace package before running its
consumer fixture. The fixture imports the public `microdelta` entry and verifies
`createMemoryStore` is exported. It resolves `microdelta/conformance/store` and
reads the built module; that Jest-specific entry is not imported in a plain Node
test because it requires Jest globals. The revised assertion failed with a
missing built module before the build prerequisite was added. From that clean
install, `npm run test:tooling` passed five tests; `npm run check`, `npm test`
(69 runtime tests, tsd, five tooling tests), and `npm run build` passed on local
Node 24.14.0. This is local evidence; the Node 20/22/24 GitHub matrix still needs
its own result on the fix commit.
