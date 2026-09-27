# Package versions and API reports

microdelta uses Changesets to prepare version and changelog updates for its
private workspace packages. This workflow records reviewed package changes; it
does not publish packages. Package manifests remain private, and Changesets is
configured to version private packages without creating private package tags.
Version and release PRs remain subject to normal human review and merge checks.

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

Use these commands from the workspace root:

```sh
npm run changeset:add
npm run changeset:status
npm run changeset:version
```

The add command records package names, bump levels, and a summary in
`.changeset/`. Status displays the pending release plan. Version applies that
plan to package manifests and changelogs and consumes the corresponding
changeset files. Inspect the full diff before committing it. This command does
not publish packages or create tags.

The `Prepare release PR` workflow runs after pushes to `main` and can also be
started manually. It uses the same version operation and creates or updates one
reviewable Changesets PR. Because GitHub does not start normal pull-request
workflows for PRs created with `GITHUB_TOKEN`, the workflow explicitly dispatches
the existing core and PR-metadata checks against the generated branch. It rewrites
the PR body using the repository's required five-section evidence format, with the
actual package plan and no claim that checks or review are already complete. A
maintainer reviews and merges that PR under the repository's required checks.

The repository setting **Allow GitHub Actions to create and approve pull
requests** must be enabled for Changesets to create the PR. This is a GitHub
repository setting; the workflow does not change it. The action has write access
only to version changes, pull requests, and dispatching those checks. No publish,
tag, approval, or merge command is configured.

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
