# PR test preparation and isolated shards

Ordinary `pull_request` events run [PR Check](../.github/workflows/pr-check.yml)
on Node 24. One preparation runs the root build, every existing package and
workspace static check, and the additional test compilers. Four fresh runner
jobs each install the lockfile with `npm ci`, restore their generated outputs,
and execute their assigned tests serially, including Node test-file dispatch. No installed dependencies or mutable
working directory crosses runners. This workflow uses read-only contents access.

The required **core (24)** PR check is the aggregate of preparation and all four
shards. Its job runs even when dependencies fail or are cancelled or skipped.
It requires four successful receipts whose planned and executed inventories
exactly match the current partition. Missing, duplicate, stale or partial receipts
fail; a successful subset never qualifies the check. **PR metadata** and
**Supervisor review** remain independent requirements with their existing source
restrictions and exact-head readback.

Automatic feature-branch pushes do not run the full Check workflow. They receive
automatic coverage when a PR opens, reopens or updates. A push to `main` still
runs [Check](../.github/workflows/check.yml), with its unchanged **core (24)** job
and actual `npm ci`, `npm run check`, `npm test`, `npm run build` steps. Check's
no-input `workflow_dispatch` still runs that full path on the ref selected by its
caller, including `changeset-release/*` branches. An explicit manual Check may
coexist with a PR run. Required-check readback must continue accounting for every
returned result of a required name; a passing duplicate does not hide a failure.
The main Check remains the release integration authority.

## Inventory and changes

[`tooling/pr-ci-catalog.json`](../tooling/pr-ci-catalog.json) records ownership of
the existing npm test graph: package and experiment Jest configurations, package
and experiment tsd commands, public consumer checks, tooling and example
`node:test`, mutation controls, fanout and subtree gates. Ordinary Jest suite files
and the tooling/example node test files are discovered from checkout source.
Preparation also asks the installed Jest resolver for every ordinary config's
actual emitted files and requires exact agreement. Missing or duplicate
configuration/type ownership, unrecognized workspaces, changed test scripts,
changed Jest configurations or changed type-test inputs fail until their owners
are reviewed in the catalog. The supported root workspace layout is exactly
`["packages/*"]`; additional patterns fail before planning, including private
workspaces that ordinary npm workspace commands would otherwise include. The executor also pairs each supported script's
exact command with preparation or executable owners; refreshing the graph
snapshot alone cannot admit a new leaf, alter a composite expansion or hide
pre/post lifecycle hooks around directly invoked leaves. Update ownership and
preparation together when changing the test graph.

Core Jest files are divided across all four shards. Other ordinary Jest files
use the same stable file-count partition. This does not claim equal durations;
preparation and shard receipts record elapsed milliseconds for adjustment from
observed evidence. Tooling keeps one execution owner with four serial whole-file
commands: `quality-gates.test.mjs` belongs to shard 3,
`release-artifacts.test.mjs` to shard 2, and `declaration-boundaries.test.mjs` to
shard 1; all remaining discovered tooling files belong to shard 4. These routes
spread the measured compiler and package-fixture cost. Discovery and command
ownership must cover every tooling file exactly once; a missing named route,
duplicate, unowned new file or differing command fails before execution. The
ordinary local tooling command is unchanged. The existing whole
`release-artifacts` tooling group runs before the fixture Jest group in shard 2:
its real packaged installs resolve registry metadata that lockfile-only `npm ci`
does not guarantee for the later offline copied-package consumer. The CLI fixture
stays pinned to that same shard when earlier fixture files are added. Its actual
installed-package assertions and offline install policy remain unchanged; shared
ambient caches cannot substitute for this ordered prerequisite. EXP-3 retains its SQLite-capability then publication order.
Tracking's intentional mutation failures and final positive rerun remain one
compound control obligation within one private emitted tree. Fanout retains its
entire roster/window matrix and Jest gate; subtree retains Jest, SQL-work and
remapped-result controls. Prepared wrapper mode skips only prerequisites that
preparation has completed and the consuming runner has verified. Their normal
local invocation still compiles and lints.

The Lean differential suite, context-component scale replay and full controlled
report workload remain opt-in and outside ordinary npm test, as before. The PR
path does not launch the full 150,000-item qualification or provider experiments.
The existing explicit controlled-report type command selects `contracts.test-d.ts`;
this change does not add a separate invocation of `reactive-cost.test-d.ts` or
archived exploratory type fixtures.

## Artifact identity and recovery

Bundles contain only explicitly enumerated generated runtime/declaration and
test output roots. Preparation clears these roots before compiling, preventing
old emissions from entering a new bundle. Symlinks, changed hashes, incomplete
outputs, unexpected paths and mismatched plans are rejected before output restore
or test dispatch. Every manifest and receipt binds the actual tested checkout
commit, the associated PR source-head SHA, the workflow run ID and the current
run attempt. A PR merge checkout can differ from its source head; both identities
are retained rather than treating them as interchangeable. Identity also binds a
whole-source digest over every tracked and new source/tooling file, excluding
ignored generated outputs. Preparation verifies this digest before dispatch and
after building/checking/bundling; restore, shard receipt and aggregate boundaries
verify the same frozen inputs. Editing source while a phase is running invalidates
its evidence even when Git HEAD and the planned file names are unchanged.

Artifact names include the run ID, attempt and shard. Hidden `.test-build` outputs
are explicitly included. Each shard receives generated dependencies and the
output roots required by its partition; dependencies are reinstalled on its own
runner. Preparation's inventory, four receipts, timings and aggregate record are
retained as workflow artifacts for three days.

Use **Re-run all jobs** to recover this PR workflow. Failed-jobs-only reruns cannot
consume preparation from an earlier attempt and therefore fail closed. A source
edit also requires new preparation and all four consumers; matching compiled
outputs or a matching Git SHA cannot rebind older evidence to the changed source. Do not
rename or copy an older artifact to satisfy the current attempt. Full local
`npm run check`, `npm test` and `npm run build` entrypoints are unchanged; the
prepared path does not replace those required pre-delivery checks.

For a local investigation, `node tooling/pr-ci-runner.mjs plan` prints discovery
and assignments without executing tests. `npm run build:pr-ci` prepares a checkout;
`npm run test:pr-ci -- <1..4> <bundle-directory>` verifies and consumes one bundle;
`npm run test:pr-ci:aggregate` validates `.pr-ci/preparation.json` and exactly four files in
`.pr-ci/receipts/`, then writes the successful aggregate evidence record.
Execution requires `PR_HEAD_SHA`, `GITHUB_RUN_ID` and
`GITHUB_RUN_ATTEMPT` and validates the checkout association; aggregation additionally
requires `PR_PREPARE_RESULT=success` and `PR_SHARDS_RESULT=success`. Reproduce all
four consumers in separate checkouts with private installs and working trees,
using the same frozen source and preparation identity. Do not run concurrent
consumers against one checkout's emitted files.
