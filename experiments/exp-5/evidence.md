# EXP-5 bounded evidence, 2026-09-26

The assertion-first sequence began with `npx tsc -p
experiments/exp-5/tsconfig.test.json` failing because `conformance.js` did not
exist. After the comparator passed eight unit assertions, the integration test
first failed compilation because `model-bridge.js` did not exist. The privacy
assertion then failed compilation until compiler-backed inspection was added.
The explicit manifest test likewise failed compilation until its loader existed.

The later package-owner and reference-owner assertions were not run against the
unmodified old checker before their guards were added. Their first observed red
was `npx tsc -p experiments/exp-5/tsconfig.test.json` rejecting the new
assertions: `IParameterFact` lacked `reference`, `ICorrespondenceMapping` lacked
`references`, and a parameter fact had no `reference` property (TS2353/TS2339).
The following **post-fix mutation controls** demonstrate the false-acceptance behavior
that each guard prevents; they are not evidence of tests-first chronology. For
each control, a temporary copy of the emitted checker had only the named guard
removed; the real source and emitted files were
restored after the targeted Jest run. All three controls exited 1:

| Removed guard | Targeted assertion | Observed red result |
| --- | --- | --- |
| Expected mapped context/object/operation obligations | `rejects deleted mapped contexts, objects, and operations` | Deleting `ConsumerContext` returned an empty diagnostic string where `/ConsumerContext/` was required |
| Loaded API package identity equality | `a manifest cannot relabel a different API package as the mapped owner` | The wrong package's `.api.json` loaded without throwing |
| Canonical parameter reference owner | `a same-named local type cannot impersonate the producer reference` | A regenerated consumer API model referring to its local `RecordEntity` returned an empty diagnostic string where `/reference/` was required |

These controls are different from the later test expectation typo: after the guards were
implemented, changing native CML `rename` to `relabel` correctly reported both
the missing mapped `rename` and an unmapped current `relabel`; the assertion was
updated to expect the former diagnostic. The source-derived negative controls
run the official parser on changed `.cml` and TypeScript/API Extractor on changed
`.ts`; the JSON-only mutation is additional model-reader evidence.

With the guards restored, `JAVA_HOME=... GRADLE_USER_HOME=...
./experiments/exp-5/verify.sh` exited 0: official CML parsing, both package
API Extractor models and four declaration tiers, strict TypeScript and type-aware
lint, zero correspondence diagnostics, six reported unsupported categories, and
17 passing Jest assertions. After rebasing onto `6abfb24` (EXP-1 and EXP-2),
`npm run check`, `npm test`, and `npm run build` all exited 0. The canonical
`npm test` run included 77 passing tooling checks, including the existing
PKG-007 boundary consumers, plus passing EXP-1/EXP-2, package Jest and tsd
suites. Only the root TypeScript exclusion list conflicted during the rebase;
both the existing `experiments/**/test-d/**` exclusion and this fixture's
exclusion were preserved.

The branch was then rebased onto `4086df8` (EXP-3), retaining its SQLite
dependencies alongside the direct API-model dependency. On that final combined
state, the bounded `verify.sh`, `npm run check`, `npm test`, and `npm run build`
again exited 0. The canonical test run now included 78 passing tooling checks
and the EXP-3 SQLite/publication suites (5 and 12 passing tests respectively).

Peer review found that `ICmlObjectFact.kind` was extracted but not compared.
The accepted mapping intentionally compares either CML Entity or Service to an
exported TypeScript class without asserting their semantic roles. Before adding
this limitation to the coverage manifest, the focused assertion was run with
`npx tsc -p experiments/exp-5/tsconfig.test.json && NODE_OPTIONS=--experimental-vm-modules
npx jest --config experiments/exp-5/jest.config.mjs --runInBand --testNamePattern
'accepts the represented subset'`. Jest exited 1: it expected `Entity versus
Service semantic role` in `unsupported` and received the prior six categories.
The fixed fixture has globally unique CML object names; its extractor retains
the resolved referenced name rather than a qualified CML owner. This is a
coverage limit, not evidence of general CML namespace correspondence. Moving
`RecordEntity` or adding an unmapped duplicate is diagnosed under the fixed
object obligations, and the API canonical reference-owner check remains in force.

Clean CI on PR #21 initially failed `check:experiments` with
`no-unsafe-return` and `no-unsafe-member-access` on the fixture consumer's
`record.label`. The ordinary root build had not generated the producer alpha
declaration before type-aware lint, while the earlier bounded `verify.sh` had
left that ignored artifact in the local worktree. After moving both fixture
packages' ignored `dist` directories aside, `npm run check:experiments`
reproduced the failure. A new tooling assertion first failed because
`build:experiments` did not call `build:exp5-fixtures`; after wiring a Node-only
producer-then-consumer fixture build into the root build, the assertion passed.
With fixture `dist` still absent at the start, `npm run check` exited 0: its
build generated the producer declaration and both `.api.json` models before
strict lint. This fixture preparation does not invoke Gradle, Java, or the
optional CML comparison.

After that fix, the canonical `npm test` gate exited 0 with 79 tooling tests
and the package and EXP-1/2/3 suites; `npm run build` exited 0. The bounded
`verify.sh` also exited 0 with parser validation, zero diagnostics, seven
reported unsupported categories, and 17 Jest assertions. The fixture build
regression test stays in the ordinary tooling suite, so a future change to
the root build ordering will fail before the lint problem reappears in CI.
