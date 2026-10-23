# #162 independent clean default-command proof

Implementer: Codex worker (gpt-6.1-sol), operating for Mike North.

At exact evidence commit `9267a44e1a203966e6ccd73db188e5826506326b`, a fresh disposable detached worktree with no installed dependencies or generated outputs ran:

```sh
node scratch/gap-hunt/contracts/reproduce.mjs intrinsic
```

The default command independently installed locked dependencies, completed the full build, compiled the Tracking tests, and ran the original unchanged intrinsic-presence suite. It exited **1**, as expected: **9 failed, 2 passed, 11 total**. These are assertion failures exposing the preserved contract gap, with the two original controls passing. This invocation shares no bootstrap with the #155/#156 evidence. Git status remained clean.

Node 24.22.1/npm 11.12.1, exact commit, command exit, source/fixture/lock hashes, and clean status are recorded in `intrinsic-standalone-clean.json`; `intrinsic-standalone-clean.log` preserves the command output. No fixture expectation or production code changed.
