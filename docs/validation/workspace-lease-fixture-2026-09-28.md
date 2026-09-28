# Workspace lease fixture repair (issue #74)

This dated record covers a test-only repair to the two adjacent workspace lease
tests in `packages/core/test/workspace/recovery.test.ts`. Local runs used Node
v24.14.0 and the real facade, Supervision, History, Node clock and SQLite file.
The starting source was `129d0f8`. Node 20 and 22, the final combined PR head,
and its required review and CI checks are outside this local record.

## Trigger and contract

On the History release-note repair PR [#73](https://github.com/mike-north/microdelta/pull/73)
at head `9b337a6`, push [Check 36474319692](https://github.com/mike-north/microdelta/actions/runs/36474319692)
failed on Node 20 in *a normal request after the run's writer lease expired
re-acquires a fresh lease instead of failing*: the facade suite had 205 passing
tests and one failure. Ben's request reached `publishAttempt`, where History
rejected writer fence **2** as expired. A parallel PR Check at the same head
passed. Fence 2 shows that the old holder had been replaced; the observed
failure was during the new request, whose 250 ms real-time lease could expire
under runner load. The old test slept 400 ms between requests, and its adjacent
expired-release test used the same short real-time fixture. This evidence does
not establish the scheduling cause of the failed CI worker, and PR #73 changed
only a changeset.

[PUB-002](../spec/execution.md#pub-002--every-ownership-sensitive-mutation-is-fenced)
requires History to reject stale publication and release.
[RUN-015](../spec/operations.md#run-015--partial-work-is-not-a-completed-result)
uses that ownership protocol. The [accepted workspace contract](m3-supervision-workspace-2026-09-28.md#selected-encodings-and-disclosed-choices)
re-acquires an expired lease between normal requests with a higher fence and
treats an already expired holder as released at run closure. It does not renew
the lease during one request; an overlong request must still fail stale.

## Fixture proof and chronology

Both tests now hold the Node clock's `Date.now()` reading fixed during each real
request and explicitly advance it to one millisecond beyond the *persisted*
lease expiry only at the intended between-request or post-request boundary.
An independent real History connection reads the stored holder, fence and
expiry without taking writer authority. The reacquisition test verifies Ada's
successful publication and held lease, the intentional expiry, Ben's successful
publication under the same holder with a higher fence and a fresh unexpired
250 ms lease, and no diagnostics. The closure test verifies Ada's publication,
its held lease, the actual expired stored lease during later ordinary work, and no
false release diagnostic. Nested cleanup closes the workspace and restores the
Date.now spy even if setup, an assertion, or workspace closure fails.

The existing Node 20 CI failure is the observed RED for the old timing fixture.
Persisted-holder/fence assertions were added before replacing the sleeps; the
focused recovery suite passed 9/9, so those new assertions are **preservation**,
not a newly observed local RED. After the controlled-clock change, the same
suite passed 9/9. A later cleanup-only move placed contributor setup inside
the workspace's `try` and the focused suite again passed 9/9.

The existing workspace mutation runner began with 65/65 passing tests, rejected
all 23 planted defects, and returned to 65/65. Its expired-reacquisition and
expired-release controls each failed the corresponding test. A separate
temporary control skipped the first clock advance in emitted test code; the
explicit expiry assertion failed, the emitted bytes were restored, and the
focused baseline passed. The control wrapper's first invocation incorrectly
expected Jest to report `1 passed` before its skipped count; the control and
restored test outcomes were correct, and the corrected wrapper exited zero.
Ten repeated focused invocations passed 9/9 each. These controls discriminate
the intended boundaries; they do not prove behavior under arbitrary host-clock
movement or a request that actually outlives its lease.

## Local gates and limits

| Command | Result |
| --- | --- |
| `cd packages/core && npx tsc -p tsconfig.test.json && node --experimental-vm-modules ../../node_modules/jest/bin/jest.js --config jest.config.mjs --runInBand workspace/recovery.test.js` | 9/9 passed after the final cleanup move |
| `node packages/core/test/workspace/controls/workspace-mutation-controls.mjs` | 23/23 controls rejected; restored baseline 65/65 |
| `npm test` | exited 0 before the cleanup-only move; facade Jest 206/206 and remaining suites passed |
| `npm run check` | exited 0 after the cleanup move |
| `npm run build` | exited 0 after the cleanup move |

The local logs and temporary skipped-advance control are under
`/private/tmp/microdelta-issue74-*`; they are working evidence, not checked-in
CI gates. No runtime, public API, dependency, declaration, workflow, or release
behavior changed. Supported-Node CI and exact-head reviews belong to the
supervisor's final PR gate; this record makes no claim that they have passed.
