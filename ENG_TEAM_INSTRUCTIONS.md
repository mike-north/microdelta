# Delivery conventions

The [project](https://github.com/users/mike-north/projects/9) shows phase, readiness,
priority, and progress. Repository issues contain the implementation contract;
[milestones](docs/milestones.md) and [specification](docs/spec/README.md) govern it.

## Claiming and implementing

1. Check live issue, pull-request, branch, and dependency state before claiming.
   `gh-queue ground-truth` is the preferred bounded helper when installed. An issue
   labeled `backlog`, `needs-decision`, or already `in progress` is not ready to pick up.
2. Claim with the `in progress` label and an issue comment identifying scope and
   intended proof. Use one isolated worktree per implementation. Do not duplicate
   existing work. Keep the project status synchronized through the GitHub CLI.
3. Write behavioral or enforcement assertions first. Record the expected failing
   check, implement the smallest bounded change, and preserve meaningful negative
   cases. Experiments follow [their evidence contract](docs/spec/experiments.md).
4. Run the repository checks and affected suites. The baseline commands are
   `npm run check`, `npm test`, and `npm run build`; new gates become part of the
   checked-in workflow. Run the configured formatter before pushing once adopted.
5. If blocked or a criterion conflicts with the governing contract, report the
   concrete conflict and release the claim. Do not silently weaken a requirement,
   widen an experiment, or substitute a different product decision.

## Review and completion

6. Open a PR using the repository template. Identify the issue, responsible area,
   invariants, tests mapped to acceptance criteria, and any limitations. Attribution
   must accurately state who implemented and reviewed the work, including agent
   assistance. Use `Refs #N`; the supervisor closes the issue after acceptance.
7. Implementers stop at PR-open and report its URL to the supervisor. Further edits
   follow a scoped review request. Release/Version PRs remain under human control:
   merging one publishes to npm, so a human maintainer records its exact-head
   status with the [release review](docs/supervisor-review.md#release-review-for-the-version-packages-pr)
   and merges it manually; it is never auto-merged.
8. The supervisor reviews the current commit, checks required CI and declaration
   changes, and accounts for every review comment. Respond before resolving a
   thread. Changed commits require review of the affected substance and fresh checks.
9. Before merging or arming auto-merge, require a completed GitHub Copilot review
   on the exact current PR head in addition to the supervisor's substantive
   review. A requested or pending Copilot review is not evidence of completion.
   Verify the review author is a GitHub `Bot` with login
   `copilot-pull-request-reviewer[bot]` (the GraphQL login
   `copilot-pull-request-reviewer` is also valid), its commit is the exact
   head, it is submitted as `COMMENTED` or `APPROVED`, and it is not dismissed or
   `CHANGES_REQUESTED`. Review and account for its findings; a completed comment
   review is evidence of reviewer execution, not automatic acceptance of its
   conclusions. The exact-head procedure and gate are in
   [supervisor-review.md](docs/supervisor-review.md).
10. Only the supervisor merges accepted work. Merge authority is delegated by the
   repository owner; it does not authorize bypassing checks, force-pushing the
   default branch, publishing packages, or changing secrets and visibility.
11. After merge, verify the default-branch result, close fully satisfied issues,
    release claims, update project fields, and unblock only dependencies actually met.
    Pass, reject, or inconclusive experiment results must state their evidence and
    the next decision; an inconclusive mechanism is not an adopted implementation.

Use lower-cost agents for contained coding and test work. Keep architecture,
normative specification changes, evidence assessment, and merge decisions with
the supervisor; seek focused Astra consultation for consequential unresolved
questions. Avoid repeated review reasoning for properties a deterministic check
can enforce.

## Executable PR evidence gate

Keep the PR template's five level-two headings and replace every instruction with
concrete content. Under **Governing issue and contracts**, include a line beginning
`Refs #N` with a positive issue number. Under **Attribution**, use separate
`Implementer:` and `Agent assistance:` lines with values; `Agent assistance: None`
is valid when accurate. The acceptance section maps criteria to named tests or
artifacts, including the observed test-first failure and exact commands/results.
State risks explicitly, even when none were identified within the issue scope.
Review may still be pending when the PR is opened.

Validate a saved Markdown body locally before creating or editing the PR:

```sh
npm run check:pr-metadata -- --body-file /path/to/pr-body.md
node --test tooling/pr-metadata.test.mjs
```

The standalone command exits nonzero with field-specific diagnostics for missing
content or untouched placeholders. It is intentionally separate from `npm run
check`: push-only baseline CI has no PR body. Its tests are included in `npm test`.
Local validation and hooks do not replace the required PR workflow.

The exact intended required contexts on `main` are **PR metadata**, **core (20)**,
**core (22)**, **core (24)**, and the separately published **Supervisor review**
commit status. The four Actions checks retain their GitHub Actions source
restrictions; the supervisor status is an additional exact-head review gate. The
three core jobs run `npm ci`, `npm run check`, `npm test`, and `npm run build`.
Require a pull request, passing required checks on an up-to-date base, resolved
review conversations, and administrator enforcement without bypass entries.
`main` is governed by repository ruleset 24154977 rather than legacy branch
protection. The supervisor-review command reads both sources read-only: a
requirement holds if either enforces it, and administrator enforcement requires
every contributing ruleset to be `active` with no bypass actors. The ruleset's
Copilot review does not re-review on push, so the supervisor requests a fresh
Copilot review for each new head. These settings are not evidence by themselves
that live protection is configured; the supervisor reads back the live rule,
recording the result or a specific platform limitation in the governing issue
before closing it. See the
[exact-head supervisor-review procedure](docs/supervisor-review.md).

`PR metadata` runs on PR creation, body edits, reopening, and synchronization.
Every run fetches the current body using a token limited to contents and PR read
access. Cancellation groups use the PR number, so a newer run cancels an older
run on the same commit. A rerun of an old event reads today's body; if its head
has moved it fails closed. The workflow never interpolates PR text into shell,
installs dependencies, or uses `pull_request_target`. Normal `pull_request`
execution runs the proposed checker, with no write permission; the supervisor
must review changes to workflows and enforcement code before merging them.
The ordinary push workflow remains unchanged and needs no PR payload.

GitHub schedules these checks asynchronously. After a body edit, wait for its
new metadata run; do not merge against an earlier success while the replacement
run is still being scheduled. The supervisor checks the current body and current
commit, confirms the latest applicable checks, assesses evidence and declaration
changes, and accounts for review comments before deciding to merge. Metadata
completeness cannot prove the truth of evidence, semantic correctness, completed
review, or independent agent identities sharing one GitHub account. No completed
review claim is required by this checker, and it grants no merge authority.
Implementers continue to stop at PR-open.
