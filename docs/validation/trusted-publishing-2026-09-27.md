# npm trusted publishing setup (issue #64)

Dates are 2026-09-27 Pacific for npm-side setup and 2026-09-28 UTC for the
registry read-back and local verification below. Local runs used Node v24.14.0
and npm 11.18.0 on macOS; Node 20 and 22 are exercised only by the repository CI
matrix. This record distinguishes three different things: configured trust,
locally verified workflow and tooling, and actual OIDC publication. **No
actual OIDC publication has happened.** The first one is the first merge of a
Version Packages PR after this change reaches `main`.

## Authorization

The repository owner requested npm trusted publishing, asked that npm-side
setup be finished first, extended coverage to every first-party package in
microdelta's dependency graph, authorized creation of `@microdelta/*` names,
selected exact version `0.0.0` for the bootstrap, and separately approved
registering Resolution and Supervision. Implementation releases and merging
the Version Packages PR (#49) were not requested and were not performed.

## npm-side configuration (supervisor evidence)

The npm account `northm` owns the `microdelta` organization. For each package
below, npm CLI reported the trusted-publisher connection created, and the
supervisor independently read it back in the authenticated package **Settings**
page: repository `mike-north/microdelta`, workflow `release.yml`, no
environment, permissions `npm publish` and `npm stage publish`. The npm CLI
trust read-back itself required a one-time password and was not used as
evidence. The implementer of this change could not read trust settings and
relies on that supervisor read-back.

| Package | npm trust ID |
| --- | --- |
| `microdelta` | `5dce3d5a-716a-4825-bea8-1718420a458a` |
| `@microdelta/machine` | `6217fc54-a873-468d-914c-0f93b4598180` |
| `@microdelta/value` | `5b18eec2-fd1d-4012-adbd-166f86fcbb47` |
| `@microdelta/history` | `60e5d202-5c09-4217-98be-81b37b8db784` |
| `@microdelta/machine-node` | `44617914-05f5-4b1b-b20f-c4832a59d8bf` |
| `@microdelta/tracking` | `f3a1cd63-9318-4067-9ce2-fb60d3304faf` |
| `@microdelta/definition` | `acd70187-270c-4b94-94a4-92262df53e4b` |
| `@microdelta/materialization` | `00df2d1b-5da3-4ceb-a120-810059ed7bdf` |
| `@microdelta/resolution` | `6af853be-fb74-4b92-9586-ec00a49473cd` |
| `@microdelta/supervision` | `3cfbb22a-4220-4288-9358-beefaeccb01f` |

Each new scoped `0.0.0` tarball contains only `package.json` and a README
identifying it as a namespace bootstrap, with no runtime code, dependencies or
scripts. `microdelta` was already at `0.0.0` and was not republished.

## Registry read-back (2026-09-28 06:04 UTC)

`npm view <name> versions dist-tags --json --prefer-online`, anonymous and
read-only:

| Package | Versions | dist-tags |
| --- | --- | --- |
| `microdelta` | `0.0.0` | `latest: 0.0.0` |
| `@microdelta/machine` | `0.0.0-bootstrap.0`, `0.0.0` | `latest: 0.0.0`, `bootstrap: 0.0.0-bootstrap.0` |
| `@microdelta/value` | `0.0.0-bootstrap.0`, `0.0.0` | `latest: 0.0.0`, `bootstrap: 0.0.0-bootstrap.0` |
| `@microdelta/history` | `0.0.0-bootstrap.0`, `0.0.0` | `latest: 0.0.0`, `bootstrap: 0.0.0-bootstrap.0` |
| `@microdelta/machine-node` | `0.0.0-bootstrap.0`, `0.0.0` | `latest: 0.0.0`, `bootstrap: 0.0.0-bootstrap.0` |
| `@microdelta/tracking` | `0.0.0` | `latest: 0.0.0` |
| `@microdelta/definition` | `0.0.0` | `latest: 0.0.0` |
| `@microdelta/materialization` | `0.0.0` | `latest: 0.0.0` |
| `@microdelta/resolution` | `0.0.0` | `latest: 0.0.0` |
| `@microdelta/supervision` | `0.0.0` | `latest: 0.0.0` |

The four `0.0.0-bootstrap.0` prereleases were published before the owner
selected exact `0.0.0`; the `machine-node` one, whose command had been
interrupted, did commit. They are left in place with their `bootstrap`
dist-tag; any cleanup is an owner decision. Both bootstrap versions are
occupied and immutable; the release tooling refuses `0.0.0`, and the pending
Version Packages plan selects `0.0.1` for `microdelta` and `0.1.0` for the
other seven workspace packages, none of which exist on npm.

## GitHub-side configuration in this change

- `release.yml` keeps the `version` job and adds `release-decision`,
  `package`, and `publish` jobs (see [releasing](../releasing.md)).
  Workflow-level permissions are empty; only `publish` has
  `id-token: write`, and it installs nothing.
- The seven publishable scoped manifests and `microdelta` are no longer
  `private`; each has `repository` metadata matching the trusted repository
  and its directory, and `publishConfig.access: public`. The workspace root
  stays private. `dist/api-temp` (API Extractor scratch) is excluded from
  tarballs.
- The generated Version Packages PR body now states that merging it is the
  release decision.
- `npm run check:release` (part of `npm run check`) audits `release.yml` and
  the first-party graph on every CI run.
- No secret, npm token, repository setting, branch protection, or visibility
  was changed.

## Tests written before implementation and observed failures

1. **Missing modules only (not behavioral):** the five new test files failed
   with `ERR_MODULE_NOT_FOUND` for `release-graph.mjs`,
   `release-decision.mjs`, `publish-release.mjs`, `release-artifacts.mjs` and
   `release-workflow.mjs`.
2. **Behavioral, graph:** with the graph module implemented and manifests
   unchanged, `the checked-in workspace is a complete trusted graph containing
   the facade closure` failed (15/16 passed) with `microdelta is private but
   required by the release entry` and the same refusal for History,
   machine-node, Tracking, Value and Machine.
3. **Behavioral, artifacts:** `the real workspace packs and installs as one
   coherent first-party graph from tarballs` failed with the same private
   refusals (5/6 passed).
4. **Behavioral, workflow:** with the audit implemented and the old
   `release.yml`, `node tooling/release-workflow.mjs` reported 16 diagnostics
   (workflow-level write permissions, missing jobs, missing publish guards)
   and 11 of 13 workflow tests failed.
5. **Behavioral, Version PR body:** the new assertion that the body states
   merging is the release decision failed against the old "does not publish"
   text.
6. **Wiring:** the new foundation-wiring test failed until `check:release` was
   part of `check:workspace`; the new graph CLI test failed before the CLI
   existed.

Two existing assertions in `tooling/changeset-automation.test.mjs` that forbade
`id-token: write` and any publish command anywhere in `release.yml` were
narrowed to the `version` job, which must still never publish; the new audit
restricts OIDC to the `publish` job.

## Negative controls

- Graph: unregistered new transitive owner (`@microdelta/accounting`), missing
  first-party dependency, private reachable package, internal version
  conflict, caret and `workspace:` ranges, reserved `0.0.0`, invalid version,
  wrong repository URL/directory, missing or redirecting `publishConfig`,
  public workspace root, private facade, non-first-party name, dependency cycle.
- Decision: feature push, manual dispatch, `pull_request` event, version-branch
  ref, unmerged PR, different merge SHA, fork head, other base, other
  repository, stale re-run after a newer version merge, missing confirmation,
  GitHub read failure.
- Artifacts: missing runtime or declaration entry, alpha or untrimmed type
  entry, TypeScript source, `.npmrc` and `.env` files, cross-package
  declaration error, failing runtime import, `0.0.0` in release mode (no output
  written).
- Publisher (fake `npm` on `PATH`, no network): registry conflict, E500 not
  treated as absent, `0.0.0`, unregistered name, tampered tarball, artifact
  from another commit, path traversal, `NODE_AUTH_TOKEN`/`NPM_TOKEN`/
  `npm_config__authToken`, missing OIDC endpoint, npm 11.5.0; every
  refusal happens before the first publish. Partial failure stops, and a
  re-run skips only identical versions.
- Workflow: each mutation (workflow-level OIDC, OIDC in the version job,
  extra publish permission, missing decision condition, skipped packing,
  secret token, `npm ci` in the publish job, self-hosted runner, unpinned
  action, `registry-url`, pull-request trigger, publish input on Changesets,
  non-release packing, packing another ref) is refused.

## Commands and results

Final results for the pushed head are recorded in the pull request.

## Limitations

- No actual OIDC publication, provenance generation, or registry write was
  performed or simulated against npm; publisher tests use a fake `npm`.
- The release-decision, package and publish jobs have not run on GitHub. Their
  first real run is the first Version Packages merge after this change.
- Packages keep their existing `UNLICENSED` license field; publishing makes
  that code public on npm under the same terms as the public repository.
- `npm view` is used to classify existing versions; very recent publications
  may be briefly invisible to it, in which case the npm publish itself refuses
  the duplicate and the re-run skips it once visible.
