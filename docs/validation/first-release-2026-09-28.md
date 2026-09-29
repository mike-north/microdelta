# First implementation release: verified npm outcome (issue #76)

The first implementation release, `0.1.0` of ten packages, was published on
2026-09-28 (UTC) by merging the Version Packages PR. This record states what was
observed on the public registry, separately from what the workflow reported.
**A successful workflow run is not proof of publication**; each claim below is
supported by registry reads, downloaded bytes, or signed provenance.

Nothing here is a release gate, and nothing here authorizes a later release
(see [Authority and limits](#authority-and-limits)). Older dated observations
remain historical evidence and are not rewritten:
[trusted publishing setup](trusted-publishing-2026-09-27.md) and
[M3 status](m3-2026-09-28.md).

## What was released

- Merged PR: [#49 Version Packages](https://github.com/mike-north/microdelta/pull/49),
  merged 2026-09-28T22:02:40Z.
- Reviewed head: `c92f2f60be759314c6acc01ce1c998c4bc999a1f` (base
  `dfd133cd98cff9dff53756df82ad6949bddd1185`, the merge of PR #75).
- Merge commit on `main`: `546c5e6e29fa786a6bc04c006c96535b06acc03f`
  (parents `dfd133cd...` and `c92f2f60...`).
- Release workflow: [run 36489991465](https://github.com/mike-north/microdelta/actions/runs/36489991465),
  attempt 1, event `push` on `main`, workflow `Release`
  (`.github/workflows/release.yml`). Jobs `release-decision`, `version`,
  `package`, and `publish` all concluded `success`; `publish` ran
  2026-09-28T22:12:06Z to 22:13:14Z. Its single artifact is `release-packages`.
- Default-branch CI at the merge commit: [Check run 36489991363](https://github.com/mike-north/microdelta/actions/runs/36489991363)
  concluded `success` for `core (20)`, `core (22)`, and `core (24)`.
- Exact-head PR #49 checks (recorded in its release-review comment): Check
  36484039603 attempt 2 and PR metadata 36484039474 attempt 2 passed.

## Provenance of this evidence

Two verifications exist. They are recorded separately because the first was
performed by a different verifier whose raw logs are not in this repository.

1. **Prior verifier**, reported in the
   [PR #49 post-publication comment](https://github.com/mike-north/microdelta/pull/49)
   (posted 2026-09-28T22:25:27Z). It reported all ten versions present, matching
   digests, verified provenance, a clean `npm audit signatures`, and a clean
   external install with a public Store smoke. It also reported **transient
   E404 responses**: earlier fresh registry lookups returned E404 for
   `@microdelta/definition` and, briefly, for the `microdelta` facade; its final
   all-ten lookup and byte comparison passed. It did not establish the cause.
   The E404s are reported here as that verifier described them; this record's
   author did not observe or reproduce them, and their cause remains unknown.
   Their resolution is that every lookup below succeeded.
2. **Independent re-verification**, below, run read-only from a separate
   machine session on 2026-09-29 between 03:19Z and 03:21Z (evening of
   2026-09-28 Pacific), roughly five hours after publication. Node v24.14.0,
   npm 11.18.0, macOS. No E404 or other registry error occurred during any of
   these commands.

## Packages and registry digests

Read with `npm view <name>@0.1.0 version dist.integrity --json`, then
`npm view <name> dist-tags.latest --json`, at 2026-09-29T03:19:56Z onward.
Every package's `latest` dist-tag is `0.1.0`. The downloaded column is the
SHA-512 of the tarball fetched with `npm pack <name>@0.1.0`
(`openssl dgst -sha512 -binary <file> | base64`); the CI artifact column is the
SHA-512 of the same-named tarball downloaded with
`gh run download 36489991465 -n release-packages`. All three digests are equal
for every package (`RESULT-MATCH` x10), and they also equal the `integrity`
values in the artifact's `release-manifest.json`, which names repository
`mike-north/microdelta` and commit `546c5e6e...`.

| Package | Version | Registry versions | `dist.integrity` (registry = downloaded = CI artifact) |
| --- | --- | --- | --- |
| `microdelta` | 0.1.0 | 0.0.0, 0.1.0 | `sha512-0wltXX2rtFxo90fB3BgKNKdZUPZrDDOlaZNZHS6COxISR6QHKUqweab5JNT3oNXTn0B6yFHUBDROTDkXwmnv8A==` |
| `@microdelta/definition` | 0.1.0 | 0.0.0, 0.1.0 | `sha512-y7v9ng8rYYxPyxmJods4Wf/HIx12XCopDA6xd4DEfBobsCtzd3sJX8DJCv2ClVG9Hd3oE6rmWx0reLctF2+NpQ==` |
| `@microdelta/history` | 0.1.0 | 0.0.0-bootstrap.0, 0.0.0, 0.1.0 | `sha512-uLWv+LmNwN/IZ1iEU786OjKAPUAR53XCCu07GEvKC5aXLvMZUOcgnXNeO37m3Y94xAlf2/K3TS3zSThO+5YYWw==` |
| `@microdelta/machine` | 0.1.0 | 0.0.0-bootstrap.0, 0.0.0, 0.1.0 | `sha512-APvT2pA+vmdB+asnkIF3DYyH7Gl0rhgTY6W8XDYfaJV8LmRcVHciKnH6JRwsldurlQG9QeY19R0dIlYgBdT/yQ==` |
| `@microdelta/machine-node` | 0.1.0 | 0.0.0-bootstrap.0, 0.0.0, 0.1.0 | `sha512-DMqhcWj9g7ngoUZWqObYdHzJPAGQ8W0yZUZEFZMrGrSVF0LaLZUA9NDc9CPoWu3H3JCTmi/cp3uBgG9fnTX4qg==` |
| `@microdelta/materialization` | 0.1.0 | 0.0.0, 0.1.0 | `sha512-LHuH9EFZQNF+EU69mmwoR0bJJch6/22r2jek4Pdem+Rr6DWAx1Q5t2x3cAZ1TQt9uJ5W2RZzMj28kLwrfF6GAw==` |
| `@microdelta/resolution` | 0.1.0 | 0.0.0, 0.1.0 | `sha512-7DzgSpqwqJWQeqGrgtMCxfJ+VVDMFVqqg+LWkeJafi5dag2ugRdIQBVm6UE7yUbd7ZDGSrrUZnB6ONqFtkVtOA==` |
| `@microdelta/supervision` | 0.1.0 | 0.0.0, 0.1.0 | `sha512-D9TfjYtHsftbMf7Gifm9ONA8W67TYBwfS5329AZ96H4zkM0OO0XWV0QxmHa6KLXYQ34yfHXcuWistFORVrbckA==` |
| `@microdelta/tracking` | 0.1.0 | 0.0.0, 0.1.0 | `sha512-hskNh4RXuGL/3qH+n5xDEMZzvy0yBDPL2Sv30y5YD+RlgW3IGSUTQExjiwC0JGh5/tde9r8fJEPGAG3dBpo5iQ==` |
| `@microdelta/value` | 0.1.0 | 0.0.0-bootstrap.0, 0.0.0, 0.1.0 | `sha512-KLWaldNgWbIJW6go16PWZthQo0ZO8hAD/WKUv+8Jf+akcihz6a3YITSn8AYhuzsWis31QLFC7qRrt2Gp0MP8FQ==` |

The `0.0.0` (and, for four packages, `0.0.0-bootstrap.0`) entries are the
earlier namespace-bootstrap placeholders; they remain on the registry and are
not part of this release.

## Signed provenance claims

For each package the registry attestation
(`https://registry.npmjs.org/-/npm/v1/attestations/<name>@0.1.0`, read
2026-09-29T03:20:40Z) contains a DSSE-signed SLSA provenance v1 statement
(`https://slsa.dev/provenance/v1`). Decoding each payload showed, identically
for all ten packages:

- workflow repository `https://github.com/mike-north/microdelta`, path
  `.github/workflows/release.yml`, ref `refs/heads/main`, event `push`;
- resolved source `git+https://github.com/mike-north/microdelta@refs/heads/main`
  at commit `546c5e6e29fa786a6bc04c006c96535b06acc03f`;
- invocation `https://github.com/mike-north/microdelta/actions/runs/36489991465/attempts/1`;
- subject `pkg:npm/<name>@0.1.0` with a SHA-512 that equals the registry
  `dist.integrity` (spot-checked in hex against the base64 value for
  `microdelta`: `d3096d5d...` equals `0wltXX...`).

Decoding shows the claims; signature verification is the next section.

## `npm audit signatures`

Run in a throwaway project (`npm init -y`, then
`npm install microdelta@0.1.0 --save-exact`, 2026-09-29T03:20:21Z to 03:20:24Z,
outside this repository) with `npm audit signatures --include-attestations`:

```text
audited 49 packages in 0s

49 packages have verified registry signatures

15 packages have verified attestations
```

Exit status 0; no invalid or missing signatures were reported. The 15 attested
packages include the ten first-party packages plus five third-party
dependencies that publish provenance (`better-sqlite3`, `@preact/signals-core`,
`detect-libc`, `semver`, `node-abi`); the install resolved all ten first-party
`0.1.0` packages.

## Clean external install and public Store smoke

In the same throwaway project, a script importing only the public
`microdelta` entry ran at 2026-09-29T03:21:07Z (exit 0):

```text
SMOKE PASS: insert, read, CAS, stale-CAS refused; version=1 durations=[11]
```

It called `createMemoryStore()`, `putSubject` (insert), `getSubject` (read),
`casSubject(key, 0, ...)` (succeeded), and a second `casSubject(key, 0, ...)`
against the stale version (refused). This verifies that the published
artifacts install and that the public non-durable memory Store behaves as
specified for those operations. It does **not** verify SQLite consumer
initialization or any durable-analysis workflow. The install printed an npm
warning that `better-sqlite3` has an install script not covered by an
`allowScripts` policy; the memory-Store smoke did not depend on it.

## Commands

All read-only against public services except installing into the throwaway
directory. `<name>` iterates over the ten packages above.

```sh
gh run view 36489991465 --json status,conclusion,headSha,headBranch,event,workflowName,attempt,createdAt,updatedAt,jobs
gh run view 36489991363 --json conclusion,headSha,event,jobs
gh pr view 49 --json number,state,mergedAt,mergeCommit,headRefOid,baseRefName
git log -1 --format='%H parents=%P %cI %s' 546c5e6e29fa786a6bc04c006c96535b06acc03f
gh run download 36489991465 -n release-packages -D art
npm view <name>@0.1.0 version dist.integrity --json
npm view <name> dist-tags.latest --json
npm view <name> versions --json
npm pack <name>@0.1.0 --silent
openssl dgst -sha512 -binary <tarball> | base64
npm install microdelta@0.1.0 --save-exact        # in a throwaway project
npm audit signatures --include-attestations       # in that project
node smoke.mjs                                    # public createMemoryStore smoke
```

Timestamps (UTC): registry reads and tarball comparison 2026-09-29T03:19:56Z
to 03:20:17Z; install 03:20:21Z to 03:20:24Z; attestation decode 03:20:40Z;
smoke 03:21:07Z.

## Authority and limits

- The owner gave a specific authorization to release PR #49 at head
  `c92f2f60be75`, and a one-time waiver of the missing current-head Copilot
  review for that head. Earlier, PR #75 received a one-time missing-Copilot
  waiver at its own exact head `342044074911e38edc6a32340472f20f4f07c43e`. Each
  waiver applied only to its exact head. Neither changes the ordinary
  requirement of a completed Copilot review on the current head, and neither
  authorizes any later release.
- The exact-head release-review procedure was applied once, to PR #49 at
  `c92f2f60be75`. It remains the normal procedure. Every future release still
  needs fresh owner authorization, exact-head checks and review, human
  confirmation, and a manual merge under branch protection.
- The published `0.1.0` packages are an incomplete pre-1.0 runtime. This
  record does **not** claim that the full durable-analysis API is supported.
  Only the checks above are verified: registry presence, byte and provenance
  integrity, install, and the public memory Store operations exercised.
