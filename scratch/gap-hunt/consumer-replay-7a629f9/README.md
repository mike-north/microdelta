# Current-main consumer replay after PR195

Frozen runtime main: `7a629f94d83366131e4aa25e541a24e41db744fa` (PR195 merge). Its entire tree is byte-identical to reviewed `04753e71bb920951356a7ad0dacbd11433ff4a8e`, tree `8556d948d3e068a88249a9f724a96fb6eb15acf2`. Private consumer source: `d172f5f7c0790914bfc7a0ffbf1398618dd72ad8`. Fresh isolated library and consumer checkouts; the pin was frozen once and completed without following later main changes. No consumer commit/push, live or paid provider execution, published baseline, or capacity rerun.

**Compatibility PASS; original full synthetic command PARTIAL / exit 1.** Both cold/warm passes and integrated output audit completed, then the unchanged consumer runner failed at final handoff with its known `mkdir` followed by `cp(errorOnExist:true,force:false)` EEXIST behavior. Original report, log, receipt and empty final destination remain unchanged. The separate saved-output site check does not make the original command successful.

Fresh library lockfile installation and package build preceded consumer installation. Consumer prepush passed 641 tests across 46 files plus lint/typecheck/build; focused pipeline tests passed 329 across 25 files. The issuer-resolved graph covers 10 runtime packages. After rehearsal and saved-output validation, an independent no-mutation check compared all 280 dist/src files, including 70 runtime JavaScript files, declarations and maps, with both pre-run hashes and frozen build: exact equality. Installed manifest names, versions and dependencies also match. Definition alpha declarations remain byte-exact without the old issue169 patch. Only private lock/workspace dependency wiring differs from consumer source.

The unchanged tracked postinstall generator requires installed 0.2.0 and rejects local 0.3.0. An external scratch copy accepts exact 0.3.0 and generates the same-form alpha paths; the original generator remains byte-exact. Local `verifyDepsBeforeRun:false` preserves the directly verified installed graph. The expected tracked-generator refusal is retained privately; no other setup failure occurred. Explicit pnpm formatted only workspace wiring before full gates. No product source or check relaxation was introduced.

## Measured outcome

The single bounded command took 646.112 seconds, below its unchanged 900-second limit. Cold 372.331s; warm 271.010s. These are uncontrolled single-run measurements, not causal timing evidence or a controlled baseline comparison.

The final report records warm bodiesExecuted 0 and providerCalls 0. Provider counters describe synthetic stub activity. Both passes contain 2082 bundle files totaling 18,843,216 data bytes. Complete path/length/SHA inventories are identical. The integrated output audit passes; summary retains its complete counts, 38 stage measurements, and exact report/log hashes.

Separate saved-output validation independently audited those bytes, copied them to a new private destination and ran the existing site builder with byte-exact tracked source in an isolated shadow checkout. It passed: 438,035 asset bytes plus 18,843,216 data bytes equals 19,281,251 total, 1,690,269 below the 20 MiB budget. Every built data byte matches saved input. Original artifacts, saved input, tracked diff and existing site output remain unchanged. No new collection or provider calls occurred. Original `siteAssetsBudgetVerified:false` fields and EEXIST outcome remain unchanged.

## Evidence boundary

Private scratch retains replay helper, setup/gate/rehearsal logs and receipts, issuer graph, preflight, original final report, saved inventories, supplemental validator and receipt, and after-run graph audit. These three public files contain synthetic counts, hashes, stage measurements and disclosed setup boundaries only. Recorded host: macOS-27.0.1-arm64-arm-64bit-Mach-O, Node v24.22.1, pnpm 12.10.1. No Linux, deployment, paid-provider, full-capacity or performance-causality claim.
