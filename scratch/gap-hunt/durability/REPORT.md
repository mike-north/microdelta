# Track B: faults and durability

Pinned baseline: c5802daca4a0bb8ea91159854d84eddcfa5215b6. Worktree `gap-hunt-durability`. Node v24.22.1. All values and stores synthetic. No production changes, paid calls, commits, pushes, or GitHub writes.

## Finding

No new product gap confirmed in the bounded probes below. No failing product reproduction or issue proposed. Existing #138 (busy errors), #129 (REPLACE), #152 (result-bearing settlement), #151 (accounting publication) are not duplicated.

## New executable probes

Command, from this worktree:

```sh
npx tsc -p packages/core/tsconfig.test.json
node --experimental-vm-modules node_modules/jest/bin/jest.js --config packages/core/jest.config.mjs --runInBand --runTestsByPath packages/core/.test-build/test/gap-hunt-durability-crash.test.js packages/core/.test-build/test/gap-hunt-durability-storage.test.js packages/core/.test-build/test/gap-hunt-durability-fold.test.js
npx tsc --noEmit -p packages/core/tsconfig.json
npx eslint packages/core/test/gap-hunt-durability-*.ts
```

Result: **11 tests pass across 3 suites**, strict TypeScript and type-aware lint pass. `new-probes.log` records the runtime result. No implementation was changed to obtain green tests: they are outcome probes against the pinned baseline.

| Probe | Governing contract | Expected and observed |
| --- | --- | --- |
| SIGKILL inside allocation transaction | PUB-001/003/004, A-09 | Reopen reports absent; no issued attempt identity escaped |
| SIGKILL inside stage transaction | PUB-001/004 | Reopen reports allocated, no completed result/current pointer |
| SIGKILL inside publication transaction | PUB-001/004 | Reopen reports staged, no completed result/current pointer |
| SIGKILL immediately after publication | PUB-004 | Stable-key recovery reports completed; exact 100KB payload intact |
| Incomplete 31-byte next WAL frame after committed publication | PUB-004 bounded recovery | SQLite ignores incomplete uncommitted tail; completed payload still readable |
| Real SQLITE_FULL during staging | PUB-001/003/004 | Old exact result/current pointer intact, attempt allocated; removing cap permits same-attempt publication; reopen exact data and monotonic next allocation |
| Real SQLITE_FULL during publication | PUB-001/003/004 | Old exact result/current pointer intact, attempt staged; removing cap permits same-attempt publication; reopen exact data and monotonic next allocation |
| Corrupt SQLite header | execution storage-integrity diagnostic, PUB-004 limit | Reopen rejects; damaged bytes not replaced |
| Truncate SQLite file to 100 bytes | execution storage-integrity diagnostic, PUB-004 limit | Reopen rejects; damaged bytes not replaced |
| Soft stop during admitted asynchronous fold body | RUN-014/015, A-13 | Fold drains and publishes; both member results remain retained |
| Hard stop during admitted asynchronous fold body | RUN-014/015, A-13 | Returned fold output discarded, fold cancelled; both member results remain retained |

The page cap is `PRAGMA max_page_count = current page_count` on only this test's temporary SQLite connection. It forces the real native engine's SQLITE_FULL at stage/publication without filling any host filesystem. It is **not** a host/VFS ENOSPC injection. The kill tests require SIGKILL plus a final trace proving the selected arm/publication was reached; a failed launch cannot pass as crash evidence. The file-fed worker only changes synthetic input transport; it imports the existing lifecycle worker and production History/Node SQLite implementations unchanged.

## Existing suites rerun

```sh
node --experimental-vm-modules node_modules/jest/bin/jest.js --config packages/core/jest.config.mjs --runInBand --testPathPatterns='(acceptance/crash-recovery|durable-history/crash-recovery|m5-acceptance/(writer|deferral|stop|replay|publication))'
node --experimental-vm-modules node_modules/jest/bin/jest.js --config packages/core/jest.config.mjs --runInBand --testPathPatterns='durable-history/durable-history|m5-acceptance/outcome-fold|operations/operator'
```

- First command: **49 passed, 8 failed; 6 suites passed, 1 failed**. All 8 failures are the component crash suite's ordinary seed process exiting SIGKILL before any trace, so its intended kill boundaries were not reached. Assembled crash recovery, M5 writer contention/takeover/expiry, sleep/exit deferral, stop, replay, and publication suites passed.
- Second command: **46 passed across 3 suites**. Includes existing local backwards clock/high-water, forward clock early expiry/stale fence, invalid clock refusal, data-integrity rejection; outcome fold pending/failure/repair coverage; operator settlement.
- Combined existing bounded coverage: **95 passed**, plus the unresolved original component launch failures. Logs: `microdelta-durability-baseline.log`, `microdelta-durability-secondary.log`.

An additional broad test selection was stopped when recognized as broader than intended: `--testPathPatterns=gap-hunt-durability` matches this worktree's own absolute directory name and selects all suites. Use exact `--runTestsByPath` above for these new probes.

## Host launch limitation, not a product finding

The original component harness puts its complete JSON script including 100KB payload in argv. On this host, a standalone child invoking the same worker with roughly 1KB or larger JSON was repeatedly SIGKILL before any trace, while a short script completed. The exact cause is unestablished (no error/diagnostic from spawnSync). Simple large strings passed to `node -e` were unaffected. This is insufficient evidence to blame microdelta or any corporate policy. A short file-path argv plus reading the synthetic JSON inside the child runs successfully; the new worker uses that transport. The original harness failures remain reported as failures rather than falsely counted as publication evidence.

## Limits and next rocks

No power-loss, failing device, network filesystem, distributed/multi-host clock, or general physical corruption recovery guarantee is established; PUB-004 explicitly excludes these. The torn WAL probe covers an incomplete extra tail only, not damage inside an acknowledged committed frame. Host/VFS ENOSPC, fsync EIO, and interrupted WAL checkpoint injection were not performed. Mid-fold stop probes are deterministic in-process barriers over the real durable store; restart and kill probes are independent processes. Existing result-less successful operator settlement remains the documented limitation tracked by #152, not a new gap.

## Attribution

Implementer: Codex worker (gpt-6.1-sol).
Agent assistance: Codex worker (gpt-6.1-sol) authored and ran the probes; parent review remains separate.
