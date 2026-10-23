# #144 clean-checkout, one-command reproduction

From the repository root of a clean checkout:

```sh
node scratch/gap-hunt/contracts/reproduce.mjs resolution-144
```

This command runs `npm ci`, the repository build, core test compilation, and a focused mutation runner. The runner performs exactly seven isolated Jest invocations: five tests on baseline, the same five tests once per each of five mutants, and the five restored tests. Each mutant must fail exactly its corresponding named witness; test inventory, isolated package path, and emitted-artifact SHA-256 checks remain enforced. Only temporary copied emitted artifacts are mutated. The output is written to ignored `scratch/gap-hunt/contracts/local-resolution-144-focused.json`; original recorded matrix evidence is never overwritten.

Verified from fresh disposable detached worktree `/tmp/microdelta-contracts-144-clean` at `86c15d6635fe98e9bca65e52b87d18e318c539c0`, with Node `v24.22.1` and npm `11.12.1`. The new worktree had no installed dependencies or generated build outputs before the command. The default selector command above exited **0**:

- baseline: **5/5 pass**;
- each mutant: **exactly its matching test fails**, with the other four passing;
- restored: **5/5 pass**;
- **seven** verified isolated package path/artifact-hash probes;
- `git status --short` after reproduction: empty.

`resolution-144-clean.log` records the complete command output, with ANSI color escapes and trailing whitespace removed. `resolution-144-clean.json` records the focused controls and verified-load hashes. The original `resolution-gap-controls.json`/`.log` full 73/216/221-test matrix remains unchanged. This handoff changes reproduction tooling and evidence only; it changes no test semantics or production code.

Implementer: Codex worker (gpt-6.1-sol), operating for Mike North.
