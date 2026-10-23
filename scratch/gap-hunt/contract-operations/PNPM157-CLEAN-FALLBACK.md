# #157 clean explicit-fallback provenance

Supersedes the historical-only fallback boundary in `DIAGNOSTIC-CLEAN-BOOTSTRAP-AUDIT.md` at630dbd6. The default downloaded pnpm12 path remains untested after its historical137 failure; it was not retried. No environment repair, global build-trust change, Linux execution, GitHub mutation or #158 native diagnostic was performed.

## Verified prerequisite and actual command

On macOS arm64 under active Node **v24.22.1**, `/Users/mnorth/.nodenv/versions/24.14.0/bin/pnpm` exists and launches successfully as **12.10.1**. It resolves to `/Users/mnorth/.nodenv/versions/24.14.0/lib/node_modules/pnpm/pnpm`. The path's24.14.0 directory does not select the active Node process. Executable bytes SHA256 before and after execution:

```text
4b3ac7049efff04a28508951243b2a6fa2d2974d1662934de4edc37435d4be31
```

Exact `--version` argv, stdout, status, time and resolved path: `pnpm157-fallback-prerequisite.json`. No install, replacement or bypass was needed to qualify this executable.

Created a new detached checkout at **0683c2ed73934d10f9b5a1ad9e0dd9e3d1a88d4f** and ran:

```sh
PNPM12_BIN=/Users/mnorth/.nodenv/versions/24.14.0/bin/pnpm bash -x scratch/gap-hunt/contract-operations/verify-157.sh
```

`-x` records shell commands; the pinned runner itself is unchanged. No reuse override, script copy or checkout edit. Actual argv, explicit environment variable, Node/npm/platform, timestamps and pre/post `git status --porcelain --untracked-files=all` are in `pnpm157-fallback-clean-context.json`. Both status strings are empty. Repository node_modules was absent before and afterward because this runner installs published0.2.0 into disposable external consumers rather than building the repository. Actual npm is11.12.1.

## Observed outcomes

The unchanged runner created `/tmp/md157.3VhNTl` with independent `pnpm-10.34.7`/`pnpm-12.10.1` consumer directories, separate node_modules and separate `store-10.34.7`/`store-12.10.1` stores. It installed the pinned pnpm10 manager locally; pnpm12 used the qualified existing binary. Both consumer install logs report49 packages, reused0/downloaded49; no shared consumer install tree or copied binding was used. Each targeted native install lifecycle subsequently completed successfully. The logs show `prebuild-install || node-gyp rebuild --release`; they do not establish that source compilation rather than a prebuild was used.

| Manager | Unapproved install | Unapproved durable | Memory | Approved cold | Independent restart |
| --- | --- | --- | --- | --- | --- |
|10.34.7|exit0, ignored better-sqlite3 build warning|exit1, missing binding|pass|1body, published|0bodies, reused exact reference|
|12.10.1|exit1, ERR_PNPM_IGNORED_BUILDS|exit1, missing binding|pass|1body, published|0bodies, reused exact reference|

Approval was only the fixture-local `pnpm-workspace.yaml` setting `allowBuilds: better-sqlite3: true`, followed by targeted `pnpm rebuild better-sqlite3`. No global trust/configuration change. Distinct cold/restart Node invocations and exact reference comparisons are visible in the shell trace and retained JSON.

Overall **exit0**. `pnpm157-fallback-clean.log` preserves full runner stdout/stderr including shell trace. A read-only watcher copied consumer `.log`, `.json` and `.yaml` evidence before the runner's normal cleanup; no fixture interception or modification. `pnpm157-fallback-consumer-logs/` preserves manager/install/unapproved/rebuild output, package/lock/approval settings, cold and restart JSON. The context records original paths, file sizes and SHA256; `pnpm157-fallback-clean-results.json` validates captured hashes, negative controls, exact reference/body-count results and successful removal of the temporary consumer root. No SQLite/native/module trees are included. The disposable evidence checkout was removed after the post-status check.

## Remaining boundary

This closes clean **explicit PNPM12_BIN fallback** provenance at the exact pinned revision. It does not close default fresh pnpm12 download/launch, Linux pnpm10/12 approvals, other Node patches, or published0.2.0 installation on arbitrary hosts. The earlier default137 cause remains unknown. A user lacking the verified exact executable cannot assume this fallback is available; do not substitute a different binary or weaken the runner's version check. Owner-supplied Linux npm/native/runtime success remains separate positive evidence.

The test demonstrates the existing package-manager prerequisite and local recipe; documentation correction remains #157's delivery scope. It makes no product/runtime change or publication claim.

Implementer: Codex worker (gpt-6.1-sol), operating for Mike North, verified the prerequisite and executed/captured the exact pinned explicit-fallback run.
Agent assistance: supervising Codex selected this bounded provenance follow-up and forbade retrying the failed downloaded path. No human review or Linux execution is claimed.
