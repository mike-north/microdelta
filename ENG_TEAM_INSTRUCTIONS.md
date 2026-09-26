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
   follow a scoped review request. Release/Version PRs remain under human control.
8. The supervisor reviews the current commit, checks required CI and declaration
   changes, and accounts for every review comment. Respond before resolving a
   thread. Changed commits require review of the affected substance and fresh checks.
9. Only the supervisor merges accepted work. Merge authority is delegated by the
   repository owner; it does not authorize bypassing checks, force-pushing the
   default branch, publishing packages, or changing secrets and visibility.
10. After merge, verify the default-branch result, close fully satisfied issues,
    release claims, update project fields, and unblock only dependencies actually met.
    Pass, reject, or inconclusive experiment results must state their evidence and
    the next decision; an inconclusive mechanism is not an adopted implementation.

Use lower-cost agents for contained coding and test work. Keep architecture,
normative specification changes, evidence assessment, and merge decisions with
the supervisor; seek focused Astra consultation for consequential unresolved
questions. Avoid repeated review reasoning for properties a deterministic check
can enforce.
