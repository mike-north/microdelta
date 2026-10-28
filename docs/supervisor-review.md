# Exact-head supervisor review

Issue #34 adds one protected status, **Supervisor review**, so a substantive
supervisory decision applies only to the commit that was reviewed. Each new head
starts without that successful status. The two existing Actions checks remain
independent requirements, as do pull-request-only changes, administrator
enforcement, and resolved review conversations. Passing checks do not require
the PR branch to include the latest `main`; branch freshness is intentionally
not a merge requirement.

Ordinary PR **core (24)** is the [complete preparation/shard aggregate](pr-ci.md).
Automatic feature pushes have no duplicate full run; main pushes and explicit
manual Check runs keep the full four-step job. Recover a failed PR attempt with
**Re-run all jobs**, because preparation and receipts bind the current attempt.
An explicitly dispatched full Check may coexist with PR CI; every returned
required-check result still participates in exact-head readback.

## Procedure

The supervisor reviews the current GitHub PR head, implementation, issue
acceptance, test-first evidence, applicable checks, and every review conversation.
Before arming auto-merge, obtain a completed GitHub Copilot review present on
some commit in the pull request. Copilot is requested automatically when the PR
opens, and the review need not be on the latest commit; the supervisor's own
exact-head review binds the decision to the current commit. Commits that
address review feedback need no new Copilot review. The supervisor requests a
new one only when significant new commits add scope Copilot never reviewed in
concept, and records why. A requested or pending review does
not count, and neither does an errored Copilot run (a `COMMENTED` review whose
body reports that Copilot could not review, such as on a rate limit). The
submitted review must be authored by a GitHub `Bot` with login
`copilot-pull-request-reviewer[bot]` (the GraphQL login
`copilot-pull-request-reviewer` is also accepted) and have state `COMMENTED` or
`APPROVED`. Login text alone is insufficient; the command checks the review
author's GraphQL type. It rejects the PR when its most recent Copilot review is
dismissed, pending, or `CHANGES_REQUESTED`, and when any Copilot review request is
still outstanding.
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
administrator enforcement, resolved conversations, both existing checks,
and **Supervisor review**. The Actions contexts are **PR metadata** and
**core (24)**; retired Node 22 is not required. It verifies that each existing
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
  `required_review_thread_resolution: true` requires resolved conversations.
  Each required status check is read with its `integration_id`: 15368 is the GitHub
  Actions app, and **Supervisor review** stays an unscoped status. Administrator
  enforcement is assessed per contributing source before requirements are combined:
  ordinary protections must apply to administrators in every source that supplies
  them. The repository owner may bypass only a separate active ruleset whose sole
  branch protection is the **Supervisor review** status and whose sole bypass actor
  is RepositoryRole ID 5 with `always` or pull-request-only (`pull_request`) mode.
  The narrower pull-request-only mode supports the same owner override without
  widening it. That exception cannot supply ordinary protections, PR
  requirements, conversation resolution, or CI checks. The checker
  derives this from the returned branch rules, each full ruleset's rule details,
  and actor data; it refuses the exception if full details are absent or broader
  than the branch slice. It does not trust a ruleset name or ID. An `evaluate` or
  `disabled` ruleset enforces nothing. A branch-rules response large enough to be
  truncated is refused.

The command never edits protection or rulesets and has no flag that relaxes this
check. This owner-only exception records the repository owner's authority; agents
must use the normal protected workflow and never request administrator bypass.
Agents and the owner may share GitHub credentials, so this is an execution rule,
not identity isolation. The ruleset's Copilot code review does not re-review on push, by
design: the Copilot gate below requires a completed Copilot review on some
commit in the pull request, not on each head.

It then confirms the PR is open, not a draft or release-version PR, targets `main`,
still has the expected head, has no unresolved conversations, has a completed
Copilot review of the pull request, and has visible required CI results that have not
failed or been cancelled. Pending CI is allowed
because those checks remain required by GitHub. Passing them locally is not a
replacement for their GitHub results.

Required CI readback uses the canonical
[REST check runs](https://docs.github.com/en/rest/checks/runs#list-check-runs-for-a-git-reference)
for the supplied exact commit in this repository, independently of GraphQL's
status-check rollup.
GitHub's `latest` filter selects current attempts; every returned duplicate of a
required name is retained, so success cannot hide a pending or failed result.
Required runs must identify that commit, the canonical repository URL, and the
GitHub Actions app (ID 15368 and slug `github-actions`). The reader requires
complete pages with a consistent count and distinct run IDs. It first requires
a check-suite count below 1,000 because GitHub's commit check-run endpoint only
considers the most recent 1,000 suites. Missing contexts, unreadable or malformed
responses, mismatched identity, changing pages, and uncertain coverage stop the
readback. The existing bucket policy remains: success passes; skipped and neutral
are skipping; queued, in-progress, requested, waiting, pending, and stale are
pending; cancellation and failure conclusions block. The stricter release gate
below still requires every required context to pass.

The command records scope and evidence in a PR comment, publishes a pending
**Supervisor review** status on the expected SHA, and rechecks the head and gates.
It then publishes success only on that SHA and reads the status back. Before asking
GitHub to enable auto-merge, it reads the repository protection, PR head, review
conversations, required CI and Copilot state again; an absent or mismatched
readback, moved head, or changed gate stops before auto-merge. It enables
auto-merge with the same expected head OID and reads back the resulting status
and merge outcome. The result distinguishes a merged PR, one awaiting required
checks, and one whose checks are already complete. The agent workflow never
requests administrator bypass. If a write or readback fails, treat the run as
incomplete and inspect the PR comment, exact-head status, and auto-merge state
before continuing; do not infer success from partial output.

The status prevents a stale review on an older SHA from satisfying the new
commit's review gate. Agents share one GitHub identity, so this procedural gate
does not prove distinct identity or protect against another actor with the same
credentials.

Once all required PR, review, and status gates pass, the branch need not
incorporate the latest `main` before merge. After merge, retain the
merged-branch worktree and verify the
default-branch integration build with `npm run check`, `npm test`, and
`npm run build`; repair integration failures with tests-first changes and
independent review. This post-merge acceptance work is asynchronous: a pending
default-branch run does not block starting another ready issue in a separate
worktree. Return to the retained worktree if integration fails.

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
resolved conversations, and a completed Copilot `COMMENTED` or `APPROVED` review by
the Copilot `Bot` of the pull request with no outstanding Copilot request. It adds:

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
error. The maintainer then merges manually under the same protection. The command
never invokes administrator bypass; the repository owner's narrow Supervisor
status override does not waive any other release gate or human release decision.
A new commit on the release branch needs a new release review. Implemented and
tested for issue #64. It was applied once, to PR #49 at
`c92f2f60be759314c6acc01ce1c998c4bc999a1f` (see the
[first-release record](validation/first-release-2026-09-28.md)); that use does
not relax the procedure, and every future release PR needs its own exact-head
review, owner authorization, and human confirmation.
