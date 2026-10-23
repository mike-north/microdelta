# Fixed-main consumer replay after PR185

Frozen runtime main5e3b2feba7191d6d643e571492730e5344b73b22 (PR185 merge), consumerd172f5f7c0790914bfc7a0ffbf1398618dd72ad8 (remote branch unchanged). New isolated runtime/private consumer checkouts; no consumer commit/push, paid provider, baseline or capacity repeat. Later main activity did not change these inputs.

**Compatibility PASS; original full synthetic command PARTIAL/exit1.** The unchanged runner completed both passes and output audit, then failed with the known final-copy EEXIST behavior (mkdir followed by cp with errorOnExist:true/force:false). Original failed report/log/receipt and final empty destination remain unchanged. No product fix or successful full command is claimed.

Fresh runtime locked install/package build completed before consumer install. Full prepush passed641 tests/46 files with lint/typecheck/build; focused pipeline329 tests/25 files passed. Installed issuer graph covers10 runtime packages, all dist/src files byte-exact to the frozen build. Definition alpha matches the build without the issue169 declaration patch. Only local lock/workspace wiring differs from consumer source. The tracked generator's exact0.2guard rejected local0.3during postinstall; the disclosed external scratch exact0.3generator generated the same-form alpha paths while original generator stayed unchanged. Local verifyDepsBeforeRun:false retains the byte-verified graph; formatter used the proven explicitpnpm binary. No check relaxation, source adapter removal or hidden product edit.

## Terminal measurements

Original command633.734s under its unchanged900s bound; exit1. Cold350.778s/warm279.878s; pull traversal110.714s/57.393s. These are single uncontrolled measurements, not causal evidence for PR185 or a baseline comparison. Prior replay receipts remain untouched.

Warm bodiesExecuted0/providerCalls0. Both inventories contain2082 bundle files (2081 encrypted payload/keyring entries plus plaintext manifest),18,843,216 data bytes. Complete path/length/SHA inventories independently compared identical. Integrated audit passed391 people,838 tables,90,362 submitted reviews,2346 comparisons and810 restricted-file denials. summary.json records38 completed stage measurements and exact original report/log hashes.

Separate saved-output validation copied exact saved bytes to a fresh destination and ran unchanged byte-verified site source in an isolated shadow checkout. It passed19,281,251 combined bytes (18,843,216 data+438,035 assets),1,690,269 below20MiB; every encrypted built byte matches saved input. Original receipts/report/log/data, tracked diff and existing site output stayed unchanged. No collection/provider work occurred. This separate site contract does not make the original EEXIST result green or modify its siteAssetsBudgetVerified:false fields.

After both original and supplemental commands, independently checked280 installed dist/src files, including70 JavaScript files, across10 packages against recorded pre-run hashes and the frozen build. Exact equality; manifest names/versions/dependencies match. No dependency mutation occurred during this check. Public summary preserves canonical before/after hash equality and private receipt hashes.

## Evidence boundary

Private scratch retains executed replay.py, prepare script, preflight, original install/gate/rehearsal logs and receipts, issuer graph, complete saved inventories/report, supplemental continue.py/receipt and independent runtime-after-run.json. Public files contain only synthetic counts/hashes/stage measurements and disclosed setup boundaries. Recorded host macOS27.0.1arm64, Node24.22.1, pnpm12.10.1. No Linux/deployment/performance-causality or paid-provider claim. Supervisor owns publication and acceptance.
