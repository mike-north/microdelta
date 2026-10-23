# Independent clean replay

Detached disposable worktree: `/Users/mnorth/stripe/microdelta/.worktrees/gap-hunt-context-clean`.
Source pin: `04ff7ee680f48e6436abb92153601cec7ec1a828`.
Runtime: Node v24.22.1, npm11.12.1.

Exact unmodified command:

```sh
node scratch/gap-hunt/scale/repro-context-component.mjs
```

No reuse-build environment option was supplied. This independently completed default npmci, generated package builds, generated-alpha strict TypeScript compilation and type-aware lint. Exit1 is the expected current-component regression result: semantic guard passes, completed-capture bounded-retention assertion fails with growth200 (allowance4). No production repair is included.

`git status --short` and `git ls-files --others --exclude-standard` both returned empty after replay; generated artifacts and installed dependencies remain ignored. The detached worktree is retained for review. No consumer checkout, paid-provider call or workspace leak claim was involved.

Full stdout/stderr: `logs/context-component-clean-bootstrap.log`.
SHA256: `ddaf7200dabc319b344c4e1b76bf469d521175ae6249f2bd7f82bc723ae88b3e`.
