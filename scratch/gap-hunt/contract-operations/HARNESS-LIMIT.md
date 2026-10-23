# Child-process launch transport control

The original473-case operational run had3 failures in `journal/processes.test.ts`: normal seed/read children were SIGKILL with empty stderr. Those are **not reached publication/journal fault points** and are not evidence of a product journal failure.

Minimal replay, without changing global settings:

```sh
node scratch/gap-hunt/contract-operations/launch-probe.mjs
node --require ./scratch/gap-hunt/contract-operations/file-fed-harness.cjs --experimental-vm-modules node_modules/jest/bin/jest.js --config packages/core/jest.config.mjs --runInBand --runTestsByPath packages/core/.test-build/test/journal/processes.test.js
```

`launch-child.mjs` imports only node:fs, writes an entry marker, parses JSON and prints its length. It imports no microdelta code, opens no database and requests no signal. On this macOS/Node24.22.1 host:

| Child/transport | Observation |
| --- | --- |
| Inert argv14,514,714,914bytes | exit0, entry marker, expected printed lengths |
| Inert argv1014,10014,64014,128014bytes | SIGKILL, no marker, no stdout/stderr, no spawn error |
| Same inert data supplied through a file | all exit0, including128000bytes of padding |
| Actual lifecycle worker219–525byte argv | all succeed, including allocate/stage/publish/release |
| Actual seven-step journal seed984byte argv | SIGKILL, no trace, no stderr |
| Same actual journal seed supplied through file | exit0; all7expected successful trace entries |

Argument bytes exclude executable/module path and environment, so do not treat these samples as an exact universal threshold. The minimal inert control establishes a reproducible **host launch/argument-transport limitation independent of microdelta or SQLite**. It does not identify the OS/harness enforcer or policy. No corporate-policy attribution, global setting change, host filling or expensive stress was attempted.

The test-only `file-fed-harness.cjs` intercepts only the exact existing lifecycle-worker launch and substitutes TrackB's file-fed wrapper. That wrapper reads the same JSON into `process.argv[2]`, then imports the unchanged worker. Database paths, lifecycle scripts, fault schedule, expected results and test assertions remain unchanged. It removes its temporary transport files afterward.

With that bounded transport change, **all4original journal/processes tests pass**, including the planned before/after journal commit kills, stale-holder refusal, isolated environments, pre-promotion kill and exact promotion. Thus the previously blocked journal assertions can now be executed on this host. Their fault proof still requires the expected trace length and successful prefix, never merely SIGKILL. `journal-file-fed.log` preserves the result. The original failure log remains intact as the original-run record.

Suggested direction: a small test-harness portability follow-up can send fixture scripts over files/stdin and preserve planned-kill trace assertions. This is not a production persistence bug. No issue filed here.

Implementer: Codex worker (gpt-6.1-sol).

## Publication follow-up

The identical test-only file transport also runs `durable-history/crash-recovery.test.ts` with all original eight assertions unchanged:

```sh
node --require ./scratch/gap-hunt/contract-operations/file-fed-harness.cjs --experimental-vm-modules node_modules/jest/bin/jest.js --config packages/core/jest.config.mjs --runInBand --runTestsByPath packages/core/.test-build/test/durable-history/crash-recovery.test.js
```

All eight pass on macOS arm64 Node24.22.1 (`publication-file-fed.log`): post-acquisition expiry/fence takeover; post-allocation consumed ID; inside-allocation rollback; post-stage incomplete candidate; inside-stage no content; pre-publication commit rollback followed by staged republish without body; postcommit lost acknowledgment exact-key recovery without body; expired-holder refusal across renew/allocate/stage/publish/abandon/accept/release. Each planned kill retains the original trace-prefix evidence check. This closes the eight originally blocked component publication cases on this host; the archived argv failures remain launch anomalies, not product failures.
