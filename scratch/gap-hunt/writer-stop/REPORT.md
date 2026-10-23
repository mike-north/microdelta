# Hard stop during writer reacquisition after durable deferral

Source pin `f43c5872987573d9b98a19f41c324b4d9336894c`; branch `gap-hunt-writer-stop`. Only tracked change: two-case test in `packages/core/test/operations/boundaries.test.ts`. No production changes, commits, pushes or GitHub writes.

Existing integrated source has a soft-stop writer-reacquisition case at baseline line 167 and normal release/reacquire controls, but no exact hard-stop variant. Governing requirements: RUN-014 (stopped work must not revive; another consumer's work must not be silently cancelled), RUN-015 (preserve partial evidence without manufacturing completed output), EXP-8 resolution 1 (release writer when only deferred work remains). This test concerns framework writer waiting, not provider cancellation or arbitrary JavaScript termination.

## Discriminator

Real owner assembly: History over file-backed SQLite, Accounting, Supervision, Resolution, Node asynchronous context, controlled clock, synthetic provider ledger. Three PR members; pr-1 gets an explicit one-hour durable rate-limit deferral while two siblings complete. Before waking, require writer released and journal deferred/notBefore evidence; capture complete persisted History attempt/result rows and journal. Competing holder takes the writer for ten hours. Advance to deferral time and require the one-second reacquisition polling timer, with no new attempts/results/provider sends while blocked.

Hard-stop case: stop before competing holder releases; run returns prior report (pr-1 pending, siblings succeeded, original waitingUntil). Competing writer lease remains exactly unchanged; no pending timer; no further step lifecycle events (including admit/execute/publish); exact persisted attempt/result rows and journal unchanged. Release the competing writer later, advance another hour and let five event-loop turns run: still no revival, publication, attempt or provider send. Writer becomes unheld only by the competing holder's explicit release.

Positive control: release competing holder without stopping and fire poll; deferred member reacquires, sends once more, succeeds and produces additional persisted attempt/result rows. Earlier siblings remain succeeded.

## Recorded execution

- Independent `npm ci --no-audit --no-fund` and `npm run build:packages`: exit 0.
- `npm run test:unit --workspace microdelta -- --testPathPatterns operations/boundaries.test --testNamePattern 'writer reacquisition after durable deferral' --json --outputFile ../../scratch/gap-hunt/writer-stop/jest-results.json`: strict test compilation succeeds; two pass, 30 skipped, zero runtime errors.
- `npm run check --workspace microdelta`: strict TypeScript and type-aware ESLint pass.
- Negative emitted control removes only `cancel()` from the abort callback in `packages/supervision/dist/src/writer.js`. Normal control passes; hard-stop case fails exactly at `timer.pending()` because the writer poll remains scheduled at T0 + hour + 1000. One failed, one passed, zero runtime errors; no timeout-based failure.
- Emitted file restored byte-for-byte (SHA in mutation-metadata.json). Same targeted test command rerun with restored-results.json: two pass, zero runtime errors.

No current-runtime defect was found; the failing result is deliberate emitted fault injection. This is bounded persisted integration evidence for one currently supported lifecycle. It does not assert universal latency, all future wait classes, full target capacity, forced provider cancellation, or termination of detached arbitrary JavaScript. No full suite or capacity workload run.

## Reproduce from a clean checkout

Run from this repository checkout:

```sh
python3 scratch/gap-hunt/writer-stop/reproduce.py
```

The runner permits evidence-only HEAD commits, rejects production/tooling drift from the exact source pin, and verifies the qualified test bytes. It installs and builds its own dependencies, runs strict TypeScript/type-aware lint, requires exactly two positive passes, one intended negative failure plus one pass, two restored passes, and all 32 affected boundaries tests passing, with zero runtime errors in every run. The negative failure must identify the retained writer-poll timer in the intended hard-stop case. The actual emitted writer bytes read from this checkout are restored in `finally`. New output is confined to ignored `local-results/`; captured logs remain unchanged. Exit zero means these expected controls matched, not that the deliberately faulted runtime passed. No manual copy from another worktree is needed.

Affected boundaries suite after restoration: **32 passed, zero failed/skipped/runtime errors** (boundaries-results.json / boundaries.log). Committed-form clean-checkout reproduction is a separate validation step, pending commit authorization when this record was prepared.

Attribution: GPT-6.1 Sol implemented the test and evidence runner under the supervising agent's scoped assignment; the supervisor reviewed and accepted the bounded integrated proof. No independent human implementation or production repair is claimed.
