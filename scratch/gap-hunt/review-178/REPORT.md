# PR178 scoped exact-head gap review

Reviewer: Codex worker operating for Mike North. Head577644f188a80bf7b081804fd63fe23ba263f88f; basef43c5872987573d9b98a19f41c324b4d9336894c. Live head checked before and after execution: unchanged, PR open. Node24.22.1/npm11.12.1/macOS arm64. Isolated owned worktree, fresh npmci and full npmrunbuild both exit0; native dependencies not borrowed.

## Result

**Fail within the bounded experiment: current subject/occurrence correspondence can falsely reuse an old value.** Existing focused tests and owner-gap baseline controls pass or remain expected-red as recorded below, but they do not cover this new counterexample. No runtime package file differs from base. This is a concrete PR finding, not public DSL adoption review or owner-issue closure.

| Evidence | Result |
|---|---|
| Original156 runtime fixture |10expected failures/5wrapped controls pass/0skipped;0runtime-error suites|
| Original156 generated-alpha tsd fixture |Pass: bare scalar source/memo still accepted by declarations; mismatch preserved|
| Original164 input selection |1expected failure/1scalar exact-reference control pass/7unselected cases skipped;0runtime errors|
| Original164 member/forwarded argument |2expected failures/2controls pass;0runtime errors|
| PR authoring experiment |16/16 across3suites plus tsd pass|
| Portable experiment tsc and experiment ESLint |exit0 each|
| Existing+changed capture tests |37/37 pass|

Original fixture source bytes are compared against Git origin objects in original-fixture-origins.json, not inferred from filenames. Scalar tsd initially copied the later comments-only lint-suppression variant; it was restored byte-for-byte to original9267a44e and its exact command passed again (scalar-types-original.log). Original runtime fixture and expectations were unchanged throughout. run.py and checks.json retain exact commands, expected failures and log hashes. Expected-red wrapper success is not product conformance.

## New false-reuse finding: suppressed occurrence selection

`experiments/exp-authoring/src/execute.ts:122-129` closes over `occurrence` to select `inputs.recipes[occurrence]` under a capture suppression justified by frozen graph/explicit slots. However, ordinary-step candidate correspondence remains the complete subject (`packages/resolution/src/resolution.ts:503-512`), not the occurrence slot. Freezing each graph does not bind one subject to one occurrence across process shutdown.

Accepted two-node graphs, identical pure `run({v}) => v`, same inputs `{first:1,second:2}`:

| Fresh process | Graph entry | Expected | Observed |
|---|---|---|---|
| Cold | name a / subject Sa / from first |1|1 published;1 body/1 publication|
| Unchanged | same |1, retained exact ref|1 reused;0 body/0 publication|
| Swap | name b / subject Sa / from second; a now subject Sb |2/current computation|**1 reused old exact Sa reference;0 body/0 publication**|
| Fresh subject control | name b / subject Sa-new / from second |2|2 published;1 body/1 publication|
| Independent empty-store swap control | swapped graph |2|2 published;1 body/1 publication|

Both subjects Sa/Sb are distinct in each graph; no token forgery, oversized graph, within-run mutation, closure-bearing author callback or provider is involved. Current recipe key/selected input changed for Sa, yet historical dependencies on recipes.a/helper a/first remain valid and hide the untracked occurrence change. This violates TRK-4 capture influence and current correspondence (CMP-6/REUSE-006), plus the charter's in-scope honest fixed-subject/from-edge requirements. The runtime may recompute against current origin or reject unsupported correspondence explicitly; silently returning1 is incorrect.

Diagnostic strict TypeScript and type-aware ESLint pass. Reproduce after build: `node node_modules/typescript/bin/tsc -p scratch/gap-hunt/review-178/tsconfig.occurrence.json` then `python3 scratch/gap-hunt/review-178/occurrence-check.py`. Expected command exit1 at the normative assertion after four controls pass. The script saves all five process receipts before failing. `occurrence-worker.ts`, `occurrence-check.log` and `occurrence-controls.json` retain concrete inputs, exact references and lifecycle events. No fix is made and no public API repair mechanism is prescribed.

## Preserved owner boundaries

156: raw string/number/boolean/null/undefined source and memo roots reject at runtime while all five record-wrapped controls succeed. The numeric experiment's private{value:number} storage boundary and tsd rejection of authored wrappers/async callbacks do not repair current-alpha result-root typing. PR baseline-worker independently executes one scalar body, rejects unsupported-result and publishes nothing.

164: original input-bound output still republishes on identical restart; member and forwarded-argument cases remain red. Scalar-member and parent equal-output controls pass. PR baseline-worker receipts independently show cold childreference2, parentreference1; fresh-process unchanged restart child executes/publishesreference3 while parent executes0times and retainsreference1. Thus retained parent does not hide repeated child work. The original input fixture fails before its later rollback assertions; no execution claim for those later assertions.

176 slice: inspected and ran separate-process tests asserting child and parent executions/publications/exact references for unchanged/unread restart, consumed equal/changed outputs, actual callback-only equal/changed edits and changed symbolic origin. Reserved names, aliases, ignored child output and raw storage carrier controls pass. Runtime negatives reject Promise/thenable/record/string/null without completed publication; protocol negatives reject forged/foreign origins, duplicate occurrences/subjects and oversized graphs. These support the bounded one/two synchronous numeric-node slice only.

Capture tooling: exact experimental protocol declaration is added as a constructor boundary. Real mutable author capture and imported-constructor alias are rejected; selected callback parameters and unrelated same-named local function pass. Existing capture controls remain green. Framework occurrence suppression is documented and actual author modules have no suppression. This does not prove arbitrary closure soundness.

173: deferred and independently reproduced on this exact head. Six scheduling implementation/contract files are byte-identical base→review head (173-source-control.json). Original fixture/config bytes were copied unchanged and strict generated-declaration compile/type-aware lint pass. Six real-workspace matrix rows return pending lane waits [99,999,92,992,0,92] for population/window/phase [(100,1,admission),(1000,1,admission),(100,8,admission),(1000,8,admission),(8,8,admission),(100,8,body)]. Window8 admission-held work has0 bodies and8 reached callbacks while queued waits grow92→992. Body-held control starts8 bodies; population8/window8 queues0. All rows drain queued waits to0 after stop, report full cardinality,0 successful member publications and unchanged topology. Original Jest discriminator:1expected bounded-queue failure/1control pass/0runtime-error suites. No universal memory/latency qualification or queue-repair claim. Report order and post-stop body-start counters are not independently asserted by this original harness.

## Commands and limits

Bootstrap: `npm ci --no-audit --no-fund`; `npm run build`. Scoped original-review command argv are in checks.json; original fixtures are identified by origin Git objects in original-fixture-origins.json. Original expected-red tests use `npm run test:unit -w microdelta -- --runTestsByPath`, focused input-name pattern and JSON receipts. PR tests use `npm run test:exp-authoring`; portable tsc, experiment lint and `node --test` both capture files. Fanout: `node node_modules/typescript/bin/tsc -p scratch/gap-hunt/scale/tsconfig.fanout-admission.json`; `node node_modules/eslint/bin/eslint.js --config scratch/gap-hunt/scale/fanout-admission.eslint.config.mjs scratch/gap-hunt/scale/fanout-admission.ts`; `python3 scratch/gap-hunt/review-178/fanout.py`. This invokes original emitted fixture and original Jest assertions on current generated build without a production-pin bootstrap.

No `npm run check`/full `npm test` gate was run: build plus named focused checks only. No provider, package publication, runtime fix, branch push, GitHub comment/review or merge. No consumer-private content is included. DSL syntax/design adoption, broader source/keyed/async/helper behavior, external packaged-consumer setup and merge gates remain outside this review.

## Packaged clean-checkout verification

The maintained one-command counterexample is `python3 scratch/gap-hunt/review-178/repro-occurrence.py` (see REPRODUCE.md). It was independently executed from a detached exact577644f checkout with byte-identical six-file overlay and no borrowed node_modules/build output. npm ci, build:packages, strict diagnostic compile and type-aware lint all exit0. Original Jest regression plus four controls yield1semantic failure/4passes/0runtime errors; the wrapper verifies this exact expected-red result and exits0. Clean snapshots and all eight process receipts are in clean-evidence/. The runtime-source guard permits later evidence-only commits, rejects product drift, and validates overlay hashes. Default regenerated outputs live only in ignored local-results/. No production changes or fix.
