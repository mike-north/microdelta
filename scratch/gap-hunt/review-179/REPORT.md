# PR179 exact-head import-boundary review — PARTIAL

Exact PR head `04f9754843fb8eddbc7b8e15b34a3e35d91c1c9a`, parent `f43c5872987573d9b98a19f41c324b4d9336894c`. Own branch `gap-hunt-review-179`. No production repair, PR branch push, issue/comment write or merge.

The demonstrated dynamic-import fix passes: original boundary tests11/11,21 additional role/example probes, and `npm run check:imports` pass. A literal workspace-source bypass remains. It is inherited from the parent example policy, but its dynamic form remains within #145 / PR179's claimed example boundary. Full acceptance is therefore **PARTIAL**, not a regression claim against the added selectors.

## Governing requirement and scope

Live #145 Fix: “so that `import()` of any package forbidden by the same configuration is refused. Its source must be either a literal or refused outright.” It requires negative forbidden-package and deep-subpath imports. Verify names the forbidden `await import('@microdelta/machine-node')` probe and preservation of every existing test. PR179's body says it rejects “deep workspace source paths”.

PKG-004 says “architecture checks prohibit relative/deep source bypasses, including bypasses inside workspace tests.” PKG-008 says attempts to reach sibling source must produce a diagnostic rather than fall through to permission. PKG-007.5's boundary fixtures apply to the same forbidden source bypass. A literal leading `./` does not require computed resolution or a new import policy: both spellings resolve to the exact same prohibited History source file.

Read-only open issue/PR inventory found #145 / PR179 as the relevant boundary work. Other keyword hits were #174 store-path aliases, #170 roster workflow and #156 scalar results; no separate literal import normalization issue/PR was located. Recommend recording this on179/existing145, not filing a duplicate owner gap. This review has not posted anything.

## Exact literal cases and owner controls

Virtual importer `examples/contribution-report/src/probe.ts`, prohibited target `packages/history/src/index.js`:

| Syntax/source | Parent | PR179 |
| --- | --- | --- |
| `import {openDurableHistory} from '../../../packages/history/src/index.js';` | rejected (`no-restricted-imports`) | rejected (`no-restricted-imports`) |
| `void import('../../../packages/history/src/index.js');` | **accepted** | rejected (`no-restricted-syntax`) |
| `import {openDurableHistory} from './../../../packages/history/src/index.js';` | **accepted** | **accepted** |
| `void import('./../../../packages/history/src/index.js');` | **accepted** | **accepted** |

The canonical static diagnostic has `messageId: patternWithCustomMessage`, “The example must not reach into workspace source.” Canonical dynamic has `messageId: restrictedSyntax`, “The example cannot dynamically import workspace source paths.” The two dot-prefixed sources have empty diagnostic arrays. The new dynamic selector is anchored to literal leading `../` segments; the static pattern also misses the equivalent leading `./` spelling.

Same four imports at `packages/accounting/src/probe.ts` all fail on both revisions with `microdelta/context-imports`, `messageId: forbidden`, “PKG-004: accounting cannot use sibling source via a relative path; use an approved declared package surface and edge.” The package-role checker normalizes literal relative targets and is unchanged by this PR. `path-{new,parent}.json` includes all8 rows, source, importer, resolved target and exact rule/message keys. New head has6passing/2failing boundary assertions; parent5passing/3failing. Static dot-prefix bypass is pre-existing, and the dynamic canonical case is genuinely repaired.

## Positive and negative evidence

- Independent `npm ci --no-audit --no-fund`: exit0. No compiled runtime packages are needed for these source/tooling checks.
- `node --test tooling/context-boundaries.test.mjs`:11/11pass. Allowed literals include facade/Node/local imports, plus existing static named Accounting/SQLite exceptions. Computed imports, forbidden scoped packages, facade subpaths and canonical workspace paths are rejected.
- `node scratch/gap-hunt/review-179/probes.mjs`:21qualified assertions pass, including package directed edges, Node Machine exception, example static allowlists, no-expression template/computed rejection and allowed literal Node subpath. Dot-prefix observations are recorded separately from those21passing controls.
- `npm run check:imports`:pass; rerun after final restoration also passes.
- Parent-config negative uses unchanged new-head test file against exact parent config. It fails exactly the example `void import('@microdelta/history')` case:10pass/1fail. Current config restored byte-for-byte in `finally`; same suite11/11pass. No test assertion or production fix was changed.
- `node scratch/gap-hunt/review-179/path-matrix.mjs`: intended requirement regression exits1 on PR179, with6passes/2failures; `--diagnostic` prints the same outcomes with exit0. Parent matrix5passes/3failures distinguishes the inherited limitation from the new fix.

## Clean reproduction

```sh
python3 scratch/gap-hunt/review-179/reproduce.py
```

The runner verifies unchanged reviewed source, installs its own dependencies, runs the11test/21probe positives, requires the exact8case current and parent path matrices, rejects the parent config using the new tests, restores actual current config bytes in `finally`, reruns11tests/import check and writes fresh ignored local-results. Wrapper exit0 means this expected PARTIAL outcome and all controls matched; it does not mean the two source-bypass assertions passed. No manual overlay/copy, package build, provider, fullsuite or Linux execution is needed or claimed.

Attribution: GPT-6.1 Sol independently reviewed and executed this scoped hunt for Mike North. The hunt supervisor owns the bounded finding/comment; this work has no merge authority. PR179's author owns any subsequent repair. Original and new policy bytes are preserved by commit pins.
