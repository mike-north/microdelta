# PR evidence gate validation — 2026-09-26

This point-in-time record covers [issue #4](https://github.com/mike-north/microdelta/issues/4)
and [PR #14](https://github.com/mike-north/microdelta/pull/14), with checker behavior
validated at commit `d12fdbbfa5a70f90c38acacdaf1d28c611cc5071`. It records observed
results, not continuing enforcement or acceptance of the whole M0.5 foundation.
The [delivery conventions](../../ENG_TEAM_INSTRUCTIONS.md#executable-pr-evidence-gate)
define the ongoing workflow.

## Local evidence

Tests were written before implementation. `node --test tooling/pr-metadata.test.mjs`
first failed because the checker was absent. A temporary no-op seam then produced
17 failing negative assertions and three passing positive/skip assertions. The
completed suite passes 22 tests, including required omissions, untouched template
text, pending review, current metadata replacing stale event text, changed heads,
API failures, inert shell-looking text, and push-only CLI execution without a PR
payload or token. It also asserts the actual workflow's four event types,
read-only permissions, cancellation group, and checker invocation.

On Node 24.14.0, `npm ci`, `npm run check`, `npm test`, `npm run build`, and
`git diff --check` passed. The full suite passed 49 tooling tests, 69 Jest tests,
and tsd. The saved PR body passed `npm run check:pr-metadata -- --body-file PATH`.
This subsequent evidence-only change does not rerun or imply new runtime results.

## Live PR-event evidence

The supervisor exercised PR #14's body and lifecycle. The linked GitHub runs were
also read back for their conclusions; all four used the implementation commit
above.

| Event / deliberate change | Observed result |
| --- | --- |
| [PR opened](https://github.com/mike-north/microdelta/actions/runs/36279387164) | `PR metadata` passed. |
| [Body edited to empty Acceptance evidence](https://github.com/mike-north/microdelta/actions/runs/36279457814) | Failed specifically with `Fill the "Acceptance evidence" section.` |
| [Complete body restored](https://github.com/mike-north/microdelta/actions/runs/36279513551) | `PR metadata` passed. |
| [PR closed and reopened](https://github.com/mike-north/microdelta/actions/runs/36279554640) | `PR metadata` passed on reopening. |

The source fixture verifies `synchronize` wiring. Pushing this record will create
a new head and provide the live synchronization run; the supervisor must verify
that run and review its exact commit before merge. The observed failure followed
by recovery demonstrates that a passing body check did not remain the applicable
result after the deliberate incomplete-body edit.

## Live merge protection remains pending

The supervisor prepared a classic `main` rule requiring a PR, all four checks
from GitHub Actions (`PR metadata`, `core (20)`, `core (22)`, `core (24)`), an
up-to-date base, resolved conversations, and administrator enforcement, with no
force pushes, deletions, or bypass entries. An approval count was not artificially
required: agents share a GitHub identity, and an approval count cannot establish
independent substantive review. Supervisory review remains a separate prerequisite.

Saving the prepared rule reached GitHub's fresh-authentication prompt. At this
checkpoint the rule is **not verified saved or enforced**. The supervisor requested
user authentication and owns subsequent save/readback. Authentication pending is
not evidence of an unsupported platform. Issue #4 stays open until the live gate
is verified or a specific unsupported-platform result is established.

Metadata completeness cannot establish truthful evidence, semantic correctness,
or distinct identities behind a shared account. This record claims no completed
human review and grants no merge authority. GitHub's asynchronous event scheduling
still requires the supervisor to wait for the latest body/head checks.
