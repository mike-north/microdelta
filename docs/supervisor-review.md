# Exact-head supervisor review

Issue #34 adds one protected status, **Supervisor review**, so a substantive
supervisory decision applies only to the commit that was reviewed. Each new head
starts without that successful status. The four existing Actions checks remain
independent requirements, as do pull-request-only changes, an up-to-date `main`,
administrator enforcement, and resolved review conversations.

## Procedure

The supervisor reviews the current GitHub PR head, implementation, issue
acceptance, test-first evidence, applicable checks, and every review conversation.
Before arming auto-merge, obtain a completed GitHub Copilot review on that same
head. A requested or pending review does not count; the submitted review must be
authored by a GitHub `Bot` with login `copilot-pull-request-reviewer[bot]`
(the GraphQL login `copilot-pull-request-reviewer` is also accepted) and have
state `COMMENTED` or `APPROVED`. Login text alone is insufficient; the command
checks the review author's GraphQL type. It rejects an old-head, dismissed,
pending, or `CHANGES_REQUESTED` Copilot review and any outstanding Copilot
review request.
The supervisor still assesses Copilot's findings and owns their disposition.

The command records the supervisor's own review scope and evidence; it does not
infer review approval from a passing test suite. Release-version PRs are rejected
by this command and use the human-operated
[release review](#release-review-for-the-version-packages-pr) instead.

With the expected full commit SHA and substantive review evidence ready, run:

```sh
node tooling/supervisor-review.mjs \
  --pr 34 \
  --head 0123456789abcdef0123456789abcdef01234567 \
  --scope "Review the changes to the bounded review state machine and its GitHub adapter." \
  --evidence "Inspected the changed implementation and tests; no blocking findings remain."
```

The command is fixed to `mike-north/microdelta`. Before it writes, it reads back
the repository's current `main` protection and verifies that it requires PRs,
strict up-to-date checks, administrator enforcement, resolved conversations, all
four existing checks, and **Supervisor review**. It verifies that each existing
check remains restricted to the GitHub Actions app. If any part of the review
gate is absent, the command fails before writing a comment or status. The root
supervisor must install and independently verify this protection before first use.

`main` is governed by a repository ruleset (24154977), so the read-back uses two
read-only sources and combines them. A requirement holds when either source
enforces it; a requirement absent from both fails.

- **Legacy branch protection** (`GET branches/main/protection`). A 404 means the
  branch has none and is not an error; any other failure stops the command.
- **Active rulesets** (`GET rules/branches/main`, then `GET rulesets/{id}` for each
  contributing ruleset). A `pull_request` rule requires PRs;
  `required_review_thread_resolution: true` requires resolved conversations;
  `strict_required_status_checks_policy: true` is the up-to-date base. Each
  required status check is read with its `integration_id`: 15368 is the GitHub
  Actions app, and **Supervisor review** stays an unscoped status. "Applies to
  administrators" holds only when every contributing ruleset is `active` and has
  no bypass actor of any mode; an `evaluate` or `disabled` ruleset enforces
  nothing. A branch-rules response large enough to be truncated is refused.

The command never edits protection or rulesets and has no flag that relaxes this
check. The ruleset's Copilot code review does not re-review on push, so the
supervisor requests a fresh Copilot review for each new head; the exact-head
Copilot gate below then requires it to complete.

It then confirms the PR is open, not a draft or release-version PR, targets `main`,
still has the expected head, has no unresolved conversations, has a completed
Copilot review on that head, and has visible required CI results that have not
failed or been cancelled. Pending CI is allowed
because those checks remain required by GitHub. Passing them locally is not a
replacement for their GitHub results.

The command records scope and evidence in a PR comment, publishes a pending
**Supervisor review** status on the expected SHA, and rechecks the head and gates.
It asks GitHub to enable auto-merge with the same expected head OID, then publishes
success only on that SHA and reads back both the status and auto-merge outcome. The
result distinguishes a merged PR, one awaiting required checks, and one whose
checks are already complete. It never requests administrator bypass. If a write or
readback fails, treat the run as incomplete and inspect the PR comment, exact-head
status, and auto-merge state before continuing; do not infer success from partial
output.

The status prevents a stale review on an older SHA from satisfying the new
commit's review gate. Agents share one GitHub identity, so this procedural gate
does not prove distinct identity or protect against another actor with the same
credentials.

If more code changes are requested after review, the supervisor first disables
auto-merge and invalidates the old review status as appropriate. The implementation
then receives a scoped assignment. Every changed head receives fresh substantive
review and current checks. After a merge, the supervisor verifies default-branch CI
and closes the issue only when its acceptance criteria are met.

## Release-version exception

The command refuses either Changesets release signature: a case-insensitive title
beginning with `Version Packages`, including prerelease suffixes, or a head branch
beginning with `changeset-release/`. It never arms auto-merge on those PRs, because
merging a Version Packages PR is the release decision: `release.yml` then publishes
the packages to npm (see [releasing](releasing.md)). An ordinary feature title such
as `fix version comparison` is not treated as a release PR.

## Release review for the Version Packages PR

`main` still requires **Supervisor review** on the release PR's exact head. A
human maintainer records it with the separate
[`tooling/release-review.mjs`](../tooling/release-review.mjs), then merges the PR
manually. Running it is a release step: it needs the repository owner's decision
to release, and agents must not run it or merge the PR on their own authority.

```sh
node tooling/release-review.mjs \
  --pr 49 \
  --head 0123456789abcdef0123456789abcdef01234567 \
  --scope "Reviewed every generated version, changelog and internal range." \
  --evidence "No package remains at 0.0.0; versions match the changesets." \
  --verification "Fresh clone of this head: npm ci, npm run check, npm test, npm run build exited 0."
```

It keeps every gate of the ordinary command: the fixed repository, the complete
`main` protection read-back, an open non-draft PR on `main` at the expected head,
resolved conversations, and a submitted Copilot `COMMENTED` or `APPROVED` review by
the Copilot `Bot` on that head with no outstanding Copilot request. It adds:

- the PR must be titled `Version Packages` and come from this repository's
  `changeset-release/main` branch;
- every required check must have **completed successfully** on the head; pending
  or skipped results, which the ordinary command tolerates, are refused;
- auto-merge must be off;
- the operator supplies substantive scope, evidence, and fresh verification of
  that head (for example the fresh-clone gate results), all recorded in the PR;
- the command runs only in an interactive terminal and the operator must type the
  first 12 characters of the head after reading that merging publishes to npm.

It then writes the review comment and a pending status, re-reads every gate, and
publishes success on that exact SHA with a read-back. It never approves, arms
auto-merge, or merges; if it finds auto-merge enabled afterwards it reports an
error. The maintainer then merges manually under the same protection, with no
administrator bypass. A new commit on the release branch needs a new release
review. Implemented and tested for issue #64. It was applied once, to PR #49 at
`c92f2f60be759314c6acc01ce1c998c4bc999a1f` (see the
[first-release record](validation/first-release-2026-09-28.md)); that use does
not relax the procedure, and every future release PR needs its own exact-head
review, owner authorization, and human confirmation.
