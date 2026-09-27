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
infer review approval from a passing test suite. Release-version PRs use the
human-controlled release procedure and are rejected by this command.

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
beginning with `changeset-release/`. Those PRs remain under human-controlled
release procedure. This command cannot publish their required **Supervisor review**
status or arm auto-merge; until the supervisor defines a separate human release
procedure for that status, those PRs cannot be merged under the new rule. Do not
bypass protection or reuse a status from another head. An ordinary feature title
such as `fix version comparison` is not treated as a release PR.
