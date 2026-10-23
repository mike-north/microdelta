# Resolution #144: five finite fault-site witnesses

Scope: existing issue #144, original production baseline `c5802daca4a0bb8ea91159854d84eddcfa5215b6`; this branch adds only tests and evidence. No production fixes or new issue classification.

The five baseline-passing tests live in `packages/core/test/gap-hunt-contracts-resolution-144.test.ts`:

| Fault site | Behavioral witness | Owning contract |
| --- | --- | --- |
| Gate invoker stops tracking its author callback | A successful gate's separate evidence contains its own implementation observation | TRK-2, CMP-8, REUSE-008 |
| Direct memo request map is ignored | Two concurrent calls in one parent execute the child body once and return total 14 | CMP-5; Resolution's request-local sharing contract |
| Supplied intent digest becomes constant | Equal invocations yield equal persisted intent; changed arguments or implementation yield different intent | History `IAttemptRequest`: complete invocation intent |
| Supplied provenance reader omits its own-implementation guard | A newly published crafted candidate missing exactly that fact rejects with integrity damage | TRK-2, REUSE-008, RES-003 |
| Fold provenance reader omits its own-implementation guard | A newly published crafted fold candidate missing exactly that fact reports integrity damage | TRK-2, CMP-8, REUSE-008, RES-003 |

The intent test observes `allocateAttempt` through the generated owner-alpha History port over real SQLite, rather than importing a private digest helper. Four fresh stores isolate equal, changed-argument, and changed-implementation invocations. The direct-memo test starts both calls before awaiting either one, so it detects missing in-flight sharing rather than depending on a later candidate lookup. The malformed candidates preserve payload and dependencies while removing exactly one own implementation observation. These are finite witnesses; they do not claim exhaustive digest-field or fold-variant coverage.

## Verified matrix

Baseline and restored expanded selection: **221/221 pass**. All five original-runner selections pass **73/73 under every mutant**. The focused selection passes **5/5 before and after**; each mutant fails exactly its matching new test.

| Mutant | Failures in original 73 | Failures in previous expanded 216 | Matching new test failures |
| --- | --- | --- | --- |
| gate-tracking | 0 | 3 | 1 |
| direct-memo-sharing | 0 | 0 | 1 |
| supplied-intent | 0 | 0 | 1 |
| supplied-own-evidence | 0 | 0 | 1 |
| fold-own-evidence | 0 | 0 | 1 |

The gate site is a mutation-runner selection gap: three existing keyed tests already reject it. The other four are genuine coverage gaps in the bounded 216-test selection. None of the five controls is redundant with the original runner. This does not claim every repository suite was exercised.

## Reproduction

From a clean branch checkout with supported Node and npm:

```sh
node scratch/gap-hunt/contracts/reproduce.mjs resolution-144
```

The wrapper installs dependencies, builds declarations/packages, compiles tests, and runs the five baseline witnesses, each matching mutant once, and the restored witnesses. All seven isolated invocations verify the package path and artifact hashes. It exits nonzero unless every mutant fails exactly its corresponding test. The generated local report is `scratch/gap-hunt/contracts/local-resolution-144-focused.json`; recorded original full-matrix evidence is preserved. For an already installed/built checkout:

```sh
npm run test:unit --workspace microdelta -- --runTestsByPath .test-build/test/gap-hunt-contracts-resolution-144.test.js
npm run check --workspace microdelta
node scratch/gap-hunt/contracts/resolution-gap-controls.mjs
```

The mutation runner copies packages and dependencies to a temporary directory, preserves relative workspace symlinks verbatim, and mutates only emitted Resolution JavaScript in that copy. Every invocation independently resolves the package entry inside the isolated directory and checks SHA-256 of all three emitted artifacts against expected baseline or mutant bytes. It enforces identical Jest test-title inventories, rejects runtime errors and exit/outcome disagreement, restores each artifact in `finally`, runs the restored baseline, and removes the temporary directory. Exact unique mutation anchors and hashes are retained in the JSON report.

## Verification evidence

- `resolution-144-results.log`: all five new tests pass.
- `resolution-144-check.log`: strict core TypeScript and type-aware ESLint pass.
- `resolution-144-focused.json` and `.log`: baseline 5/5, exactly the matching new test fails for each mutant, restored 5/5.
- `resolution-gap-controls.json` and `.log`: final verified-load baseline/mutant/restoration matrix.

The original matrix used the installed/built-checkout commands above. The later clean-checkout handoff records the one-command bootstrap and focused matrix separately in `RESOLUTION-144-CLEAN.md`.

An earlier diagnostic run used `fs.cpSync({dereference:false})` without `verbatimSymlinks:true`, which rewrote workspace links back to the source checkout. Its claimed survivors were invalid and are excluded entirely. The final runner's path and content guards make that failure explicit. No result from that earlier run supports the coverage conclusion.

Implementer: Codex worker (gpt-6.1-sol), operating for Mike North.
