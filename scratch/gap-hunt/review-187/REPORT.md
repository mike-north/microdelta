# PR187 / issue164 independent repair review

Reviewed head: `0af7f746aa82fc72e88d24c3945061b1a17c0511`.

Verdict: **delivered clean build FAIL; runtime PASS under an explicit support overlay.**

The new `scratch/gap-hunt/consumer-dx/tsconfig.output-bindings.json` extends
`./tsconfig.all.json`, but that target is absent from this Git commit. The root
`build:fixtures` now invokes `build:output-fixture`, so the byte-exact original
reproduction runner performs clean `npm ci`, enters `npm run build`, and exits2
with TS5083 before its runtime oracle executes. The root check cannot establish
AC7 on a clean checkout. Follow-up: make the fixture's complete strict compiler
configuration part of the PR. No repair is included in this evidence.

## Reproduce

From a clean checkout of this evidence branch with Node24 and npm:

```sh
python3 scratch/gap-hunt/review-187/reproduce.py
```

The runner checks original source hashes before executing anything. First it runs
the frozen original minimal runner with no support overlay and asserts the
missing-config failure. It then temporarily supplies the byte-exact
`a97c11f` historical `tsconfig.all.json` solely to qualify runtime behavior.
That overlay is removed in `finally`; it is neither a product fix nor proof that
the PR builds on its own. Under the overlay it repeats the original minimal
runner (including clean install/build), checks strict types/lint and tsd, then
runs focused acceptance and regression suites. The only runtime counterfactual
replaces `packages/resolution/src/current.ts` with its exact parent source,
rebuilds Resolution, runs the same focused tests, restores the reviewed bytes in
`finally`, rebuilds and repeats the acceptance tests.

`original-reproduce.mjs` is byte-identical to
`4dc00d6af1c2405095792c7be893a1ad2cc382b3`'s original runner. Its new directory is
at the same repository depth, preserving root resolution. The four original
fixture/worker source files match their original `4dc00d6`/`a97c11f` Git objects.
The original issue164 red proof is retained separately at its original revision;
this evidence does not rewrite its expectations or substitute a new oracle.

## Acceptance mapping

| AC | Evidence and boundary |
| --- | --- |
| 1 Exact fresh-process input/member/argument reuse | Original Core input matrix; generated-alpha member/argument fixture; nested child's durable History count independently checks parent cutoff cannot conceal another publication; new process fixture also checks zero input body calls and unchanged History count. |
| 2 Unread sibling precision | Original input unread case retains the exact reference; owner test also changes member unread sibling while the selected subtree stays equal. |
| 3 MDS1 shape comparison | Original warm/cold process matrix covers changed leaf, key insertion order, missing/present undefined, hole/present slot, inherited value and inherited/own ownership. |
| 4 Rollback | Every original shape row continues through exact original-reference rollback; process fixture verifies body/publication counts. |
| 5 Exact current binding/subtree | Owner tests verify current selected data, foreign binding rejection, missing/ambiguous declarations and opaque argument rejection; unread sibling tests discriminate whole-input widening. Exact prior-source counterfactual must fail. |
| 6 Rejection/scope/materialization | Owner test preserves Date rejection and scalar-root incompatibility; original scalar controls reuse; focused Tracking output/observer suites preserve materialization and scope/correspondence checks. |
| 7 Strict checks/test-first evidence | Clean build is blocked by absent fixture config; strict checks under the explicit support overlay are reported separately. Exact prior-source negative and restoration use unchanged tests. |

Resolution retains current-fact ownership and selects the recorded address in a
separate validation observer. Tracking still owns MDS1 materialization and the
supported-value domain. Child-output comparison and publication remain with
their existing owners. No schema/API/host expansion is claimed.

## Captured results and limits

On macOS arm64 Node24.22.1, all 15 recorded command exits matched the runner's expectations. The pristine original command exited2; the supported original
minimal oracle passed 2 tests with 7 skipped. Under the overlay, Core passed 14 tests
in 3 suites, Resolution passed 6 tests, and Tracking passed 54 tests in 2 suites. The
exact prior source produced 11 Core failures/3 passes and 6 owner failures, with no
runtime-error suites. Byte-exact source restoration and rebuild returned Core 14
and owner 6 to green. Strict TypeScript, type-aware lint and tsd passed under
the overlay. The temporary support file was absent again on completion.

See `captures/summary.json` and `captures/commands.json` for exact outcomes and
source hashes. Logs contain sanitized paths; raw Jest result JSON stays local.
The receipt records actual OS and Node version. There is no Linux, full repository,
provider, package publication or universal performance claim. The hunt supervisor
assesses and posts this bounded evidence; repository acceptance and merge remain
with the repository supervisor.
