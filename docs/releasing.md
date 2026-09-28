# Package versions, releases and API reports

microdelta uses Changesets to prepare version and changelog updates, and npm
trusted publishing to publish the first-party packages after a maintainer
decides to release. The only release decision is a maintainer merging the
reviewed **Version Packages** PR into `main`; nothing else publishes. Every
workflow in this document lives in
[`.github/workflows/release.yml`](../.github/workflows/release.yml), the one
workflow identity npm trusts for this repository.

No implementation release has been published yet. The registry holds only the
`0.0.0` namespace-bootstrap placeholders described below. Configuring trust and
verifying the workflow locally are not evidence of a real OIDC publication; the
first real publication is the first merge of a Version Packages PR after this
configuration reaches `main`.

## When to add a changeset

Add a changeset in the implementation PR when a package's API, behavior, or
declared contract changes in a way package consumers need reflected in version
history. Select patch, minor, or major based on the compatibility effect, and
write a short consumer-facing summary. Internal `@alpha` contracts are still
package contracts even though they are not the default public release surface.

Documentation-only, test-only, CI, and tooling maintenance that does not change
package behavior or contracts normally needs no changeset. A change spanning
several packages should include each affected package when its consumer-facing
contract changes; Changesets also updates dependent package ranges according to
the workspace configuration. Review those generated edits rather than assuming
all dependency changes have the right semver meaning.

A package that has never been bumped is still at the reserved bootstrap version
`0.0.0` and cannot be released (see below). A new first-party package needs a
changeset before its first release.

Use these commands from the workspace root:

```sh
npm run changeset:add
npm run changeset:status
npm run changeset:version
```

The add command records package names, bump levels, and a summary in
`.changeset/`. Status displays the pending release plan. Version applies that
plan to package manifests and changelogs, consumes the corresponding changeset
files, and refreshes the npm workspace lockfile without running install scripts
or publishing. Inspect the full diff before committing it.

## Preparing the Version Packages PR (`version` job)

The automation uses the Changesets v1.9.0 action at commit
[`a45c4d594aa4e2c509dc14a9f2b3b67ba3780d0d`](https://github.com/changesets/action/tree/a45c4d594aa4e2c509dc14a9f2b3b67ba3780d0d).
The reviewed [manifest](https://github.com/changesets/action/blob/a45c4d594aa4e2c509dc14a9f2b3b67ba3780d0d/action.yml)
defines the `version`, optional `publish`, and `createGithubReleases` inputs,
plus the `pullRequestNumber` output. Its
[entry point](https://github.com/changesets/action/blob/a45c4d594aa4e2c509dc14a9f2b3b67ba3780d0d/src/index.ts)
dispatches to versioning when changesets are present and no publish command is
configured; its [version runner](https://github.com/changesets/action/blob/a45c4d594aa4e2c509dc14a9f2b3b67ba3780d0d/src/run.ts)
selects the CLI `version` command for Changesets 2.x. The `version` job sets
`createGithubReleases: false` and omits `publish`; Changesets never publishes.

The `version` job runs after pushes to `main` and when the workflow is started
manually. It creates or updates one reviewable Changesets PR. Because GitHub does
not start normal pull-request workflows for PRs created with `GITHUB_TOKEN`, the
job explicitly dispatches the existing core and PR-metadata checks against the
generated branch. It rewrites the PR body using the repository's required
five-section evidence format, with the actual package plan, a statement that
merging is the release decision, and no claim that checks or review are already
complete.

The release PR must satisfy the same `main` protection as any PR, including
the exact-head **Supervisor review** status. The ordinary supervisor command
refuses release PRs because it arms auto-merge. Instead, once the owner decides
to release, a human maintainer reviews the PR and records that status with the
[release review](supervisor-review.md#release-review-for-the-version-packages-pr)
(`tooling/release-review.mjs`). It requires completed passing checks and a
submitted Copilot review on the exact head, records scope, evidence and fresh
verification, and never merges or arms auto-merge. The maintainer then merges
the PR manually; there is no administrator bypass. This workflow does not change
the repository's checks or protections.

The repository setting **Allow GitHub Actions to create and approve pull
requests** must be enabled for Changesets to create the PR. The `version` job
has write access only to version changes, pull requests, and dispatching those
checks. It has no OIDC permission, and no tag, approval, or merge command is
configured.

## Publishing after the release decision

The other three jobs in `release.yml` run for every push and manual run, but do
real work only for the release decision:

1. **`release-decision`** (`contents: read`, `pull-requests: read`) runs
   [`tooling/release-decision.mjs`](../tooling/release-decision.mjs). It
   outputs `publish=true` only for a `push` to `main` in `mike-north/microdelta`
   whose commit is the merge commit of a merged `changeset-release/main` PR
   from this repository, and only if that PR is still the most recently merged
   Version Packages PR. Manual dispatch, feature pushes, and pushes to the
   version branch output `publish=false`. Re-running an older release after a
   newer Version Packages merge fails as stale.
2. **`package`** (`contents: read`) checks out that exact commit, runs
   `npm ci`, `npm run check` and `npm test`, then
   `node tooling/release-artifacts.mjs --release --out <dir>`. That command
   validates the first-party graph, packs one tarball per package in
   dependency order, verifies each tarball's entry points and public
   declarations, and refuses any tarball whose emitted JavaScript or
   declarations import a first-party package it does not declare as a
   dependency. It then installs **each package alone** into a scratch consumer.
   npm `overrides` point that package's *declared* first-party dependencies at
   the local tarballs, so the registry never supplies a first-party version and
   an undeclared dependency cannot be satisfied by a sibling installed beside
   it. Each install must import the package root and typecheck every exported
   entry through its public declarations. Finally it installs
   `@microdelta/machine-node` with install scripts enabled, as a consumer's normal
   `npm install` does, and uses its SQLite capability to write, close, reopen and
   read a temporary database file. That loads better-sqlite3's native binding,
   which importing the package root does not. The check covers only this
   open/write/read/reopen/close path on the runner's platform and Node version;
   it is not a general integration suite and changes no declaration tier. It
   uploads the tarballs and `release-manifest.json`. Dependency install scripts
   run only in this job, which cannot obtain an OIDC token.
3. **`publish`** (`contents: read`, `id-token: write`, `pull-requests: read`) is the only job that can
   request an OIDC token. It installs and builds nothing. It downloads the
   verified artifact and runs
   [`tooling/publish-release.mjs`](../tooling/publish-release.mjs), which
   refuses to start unless the artifact names this repository and commit,
   every tarball still matches its recorded integrity, every package is
   registered for trusted publishing, no version is `0.0.0`, no long-lived npm
   token variable is set, the job has an OIDC endpoint, and npm is at least
   11.5.1. It does not trust the earlier decision job's output: a run can wait
   for packaging or the `publish-npm` lock, or be re-run, while a newer Version
   Packages PR merges. So it re-reads GitHub with the job's read-only token and
   requires this commit to still be the latest merged Version Packages PR, both
   before planning and before every individual publish. Missing or unreadable
   evidence refuses. It then reads every package version, and every package's
   current `latest` tag, from the registry before any publish. It refuses a
   version below the current `latest`, which `--tag latest` would move
   backward, and publishes the absent ones in dependency order with
   `npm publish <tarball> --access public --tag latest --provenance --ignore-scripts`.

`tooling/release-graph.mjs` defines the release graph: `microdelta`, every
non-private workspace package, and every first-party runtime dependency of
those, which must all be workspace packages, public, registered for trusted
publishing, pinned to each other's exact versions, and published from this
repository (`repository.url` and `repository.directory`). The workspace root
stays private. `npm run check:release` runs this structural check and the
[`release.yml` audit](../tooling/release-workflow.mjs) on every CI run, so a
change that would break a later release fails in its own PR. The audit also fixes
the workflow root to `name`, `on`, `permissions` and `jobs`, in that order, and
refuses `npm_config_*` environment overrides, so no root key added after `jobs:`
can change what the audited jobs do.

### Partial and repeated publication

npm versions are immutable. Before publishing anything, the publisher classifies
every package as absent, already published with identical tarball integrity,
or conflicting. A conflict (the version exists with different contents) or any
registry error other than "not found" stops the run before any publish. If a
publish fails part way, the job stops, names what was already published, and
publishes nothing further. To resume, use **Re-run failed jobs** on the same
release run: identical versions are skipped and the rest publish in order. The
resumed job re-establishes eligibility first. If a newer Version Packages PR has
merged since, the old run is stale and publishes nothing. The newer release
publishes its own versions of every package, including any the older run never
reached, so `latest` only moves forward. Do not start a new release to recover a
run that is still the latest release.

## npm trusted publishing configuration

Each first-party package on npmjs.com has a trusted publisher with:

| Setting | Value |
| --- | --- |
| Provider | GitHub Actions |
| Organization or user | `mike-north` |
| Repository | `microdelta` |
| Workflow filename | `release.yml` |
| Environment | none |
| Permissions | `npm publish` and `npm stage publish` |

Renaming or moving `release.yml`, or moving the repository, breaks every
connection. npm requires GitHub-hosted runners, npm CLI 11.5.1 or later and
Node 22.14.0 or later for trusted publishing; the publish job uses Node 24 and
checks the npm version. Provenance is generated automatically because the
repository and packages are public. See
[npm trusted publishers](https://docs.npmjs.com/trusted-publishers).

Registered packages, recorded in `registeredPackages` in
`tooling/release-graph.mjs`, with evidence in the
[trusted-publishing record](validation/trusted-publishing-2026-09-27.md):

- `microdelta`
- `@microdelta/machine`, `@microdelta/value`, `@microdelta/history`,
  `@microdelta/machine-node`, `@microdelta/tracking`
- `@microdelta/definition`, `@microdelta/materialization`
- `@microdelta/resolution`, `@microdelta/supervision` (registered ahead of
  their workspace packages)

### Adding a new first-party package

A new owner (for example `@microdelta/accounting`) cannot be published until:

1. A maintainer with npm org access creates the name on npm and adds the
   trusted publisher above in the package's **Settings → Trusted publishing**.
   npm configures trust only on an existing package, which is why names were
   bootstrapped (below).
2. The name is added to `registeredPackages` with dated evidence in a
   validation record. Adding a name before the npm connection exists makes
   the release fail at publish time.
3. Its manifest is public with `publishConfig.access: public`, the repository
   metadata above, exact first-party dependency versions, and a changeset.

Until then `npm run check:release` fails once any released package depends on
it, and the release is refused before any publish.

## Bootstrap versions versus implementation releases

On 2026-09-27 the scoped names were created on npm at version `0.0.0` so trust
could be configured. Those tarballs contain only a manifest and a README
identifying the package as a namespace bootstrap; they have no runtime code,
dependencies, or scripts, and are not usable library releases. `microdelta`
was already at `0.0.0` and was not republished. Some scoped names also carry
earlier `0.0.0-bootstrap.0` prereleases from before `0.0.0` was selected.

`0.0.0` is reserved: both the release graph (`--release`) and the publisher
refuse it, so an unbumped package can never be released over or beside the
bootstrap. Implementation releases start at the versions a Version Packages
PR selects (for example `0.1.0`). Pre-1.0 versions and the project-private
`@alpha` declaration tier mean the published runtime is incomplete and not
stable; packages publish only their public declaration rollups as the default
type entry.

## Consumer installation

After an implementation release, consumers install from npm as usual:

```sh
npm install microdelta
```

npm resolves the exact first-party versions the release pinned. Consumers can
check provenance with `npm audit signatures`. Until the first implementation
release, `npm install microdelta` installs only the bootstrap placeholder.

## Current authorization limits

The repository owner authorized npm-side setup (name bootstrap and trust
configuration) and this GitHub-side configuration. Merging a Version Packages
PR is a release decision the owner makes separately; agents do not record its
release review, merge it, dispatch releases, add registry tokens or secrets, or
change repository visibility. The release review procedure is implemented and
tested but has not been applied to any release PR. No npm token is stored
anywhere in this repository or its secrets.

## API Extractor reports

Normal `npm run build`, `npm run check`, and CI compare generated declarations
with committed API reports. They do not regenerate or rewrite reports. A stale
report is a failing check and should be reviewed as an intentional contract
change.

To deliberately regenerate a report after reviewing the declaration change,
run API Extractor in local update mode for the affected entry point, for example:

```sh
npx api-extractor run --local --config packages/tracking/api-extractor.json
```

Use the corresponding config for the package and report being changed, including
additional conformance entry points where applicable. Review the resulting
`.api.md` diff and run the ordinary checks afterward; do not leave a locally
rewritten report whose signature or release-tag change was not intended.
