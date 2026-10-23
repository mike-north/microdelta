# Hard stop during priority lane reclaim

Exact production source pin `f43c5872987573d9b98a19f41c324b4d9336894c`; branch `gap-hunt-stop-reclaim`. Tests/evidence only. No production changes or GitHub mutations. Evidence commits may advance HEAD while preserving production bytes.

The new two-case Jest test in `packages/supervision/test/stop.test.ts` targets RUN-002 / RUN-014. One lane: admitted sleeper lends its lane; admitted holder takes it; a third member waits without admission. Fake time advances until sleeper's timer fires, while holder still occupies the lane. Thus sleeper waits for priority reclaim before stop.

The normal control releases holder: sleeper resumes/sends and all three can pass the publication refusal boundary. The hard-stop case keeps holder gated until the two admitted executions and unadmitted queue member settle. Sleeper never resumes or sends; queued work never reaches caller admission policy or body; both admitted executions end interrupted; queued member ends cancelled; publication is refused. Releasing the detached holder afterwards does not change the result. Every fake timer is fired or cancelled. No provider request is performed in the hard-stop case.

Validation:

- Independent `npm ci --no-audit --no-fund`, then `npm run build:packages`: exit 0.
- Targeted new cases through `npm run test:unit`: 2 pass, 62 skipped, exit 0; strict test compilation is part of this command.
- `npm run check` in Supervision: strict/portable TypeScript and type-aware ESLint exit 0.
- Negative control changed only emitted `.test-build/src/execution.js`: priority reclaim received a fresh nonaborting signal instead of `run.hard.signal`. Normal case passed; hard-stop case failed with `resumed` equal to `['sleeper']` instead of `[]`. This tests the intended cancellation distinction, rather than merely the body race or timer.
- Emitted artifact restored byte-for-byte; affected `stop.test` suite recompiled and rerun: **64 pass, zero failed/skipped**, exit 0.

See `metadata.json`, Jest JSON/logs, `check.log`, `build.log`, and `test.patch` for concrete evidence. Production baseline passes; the only failure is the deliberate emitted-artifact control. There was no implementation to fix and no pre-fix current-runtime failure.

From an evidence commit containing this test, replay with `node scratch/gap-hunt/stop-reclaim/run-clean.mjs`. It checks the full committed diff against the production pin permits only the test and this evidence directory, makes a detached clean checkout of its own HEAD, and uses the committed test directly. It installs/builds/checks only the needed package chain, verifies actual Jest case counts and the specific negative failure, restores emitted bytes in `finally`, reruns the 64-test affected suite, and checks a clean tracked worktree. Logs/JSON go under ignored `runs/`; the temporary checkout is removed. No local overlay or production source mutation is used. `WAIT-LIFECYCLE-CENSUS.md` supplies the preceding read-only source inventory.

This is a bounded Supervision port test using Node asynchronous context and a fake timer, three members, window one, and zero hard-stop provider sends. The publication list models Resolution obeying `publicationRefusal`; it is **not persisted SQLite History evidence**. It does not establish full-capacity dispatch, retained heap, universal latency, or termination of arbitrary provider cancellation. Existing #173 owns broader queued dispatch/active-wait assertions; this result supplies one finite missing supported lifecycle discriminator without closing that issue.
