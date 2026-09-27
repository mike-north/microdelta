# Package and API boundaries

`PKG-` requirements are normative unless marked experiment. They implement the
ownership in [architecture](architecture.md); exact package names and output
filenames are engineering choices. This specifies required enforcement, not a
claim that API Extractor or its checks are already configured. The initial
enforcement gate is M0.5, before runtime experiments. Deliberately shaped package
surfaces, encapsulation, generated declarations, API Extractor reports, compiler
checks, and import checks are the selected architecture/API enforcement system.

## PKG-001 — Coarse packages, explicit contracts

The project and library entry package are `microdelta`. Scoped workspace packages
use `@microdelta/*`; exact package suffixes are engineering choices within the
accepted context boundaries. This naming is settled.

Workspace packages should enforce bounded-context boundaries where useful.
Value Semantics and Materialization may also be packages. Do not create a package
for every implementation module or translate every Java-style subpackage into a
workspace package. Package placement does not change invariant ownership.

Own implementation source is the authority for implementation typechecking.
Sibling contexts consume declared package surfaces, never sibling source.

## PKG-002 — Three independent visibility mechanisms

| Mechanism | Meaning | Enforcement limit |
| --- | --- | --- |
| TypeScript `public`/`protected`/`private` | Class member access in TypeScript | Compile-time access; not runtime secrecy |
| ECMAScript `#` members | Runtime private fields/methods | Runtime object access restriction, not a package release tier |
| API Extractor release tags | Which declarations appear in each package surface | Declaration exposure, not a runtime security boundary |

A class member can be public in TypeScript while its exported containing API is
project-private by release tier. Do not infer one mechanism from another.

## PKG-003 — Release tiers

| Tier | Intended audience | Declaration view |
| --- | --- | --- |
| `@internal` | Own package only; explicitly internal exports are underscore-prefixed | Untrimmed entry-point rollup |
| `@alpha` | Project-private contract used by approved sibling packages | Alpha-trimmed rollup, including alpha/beta/public and excluding internal |
| `@beta` | Actual user-facing beta opt-in | Beta-trimmed release artifact, including beta/public |
| `@public` | Default user-facing API | Public-trimmed rollup |

Here `@alpha` deliberately means project-private, not an advertised user alpha
channel. The default package type entry exposes only the public-trimmed view.
A separately published beta version selected through an npm distribution tag
can point its package type entry at the beta rollup; selecting that version is
the opt-in. Keep any `exports` type condition consistent with the chosen `types`
entry. The exact release/tag spelling is not prescribed here. The untrimmed rollup contains entry-point exports, not every
unexported implementation declaration.

## PKG-004 — Build and test resolution

- Own source checks use own source types.
- Own package tests may use its untrimmed declarations. Their private test
  configuration must not grant untrimmed access to sibling consumers.
- Sibling consumer/test configurations use explicit TypeScript `paths` mappings
  to the producer's **alpha-trimmed `.d.ts` output**, never its TypeScript source
  or untrimmed output. Producers must build declarations before such checks.
- External-consumer fixtures use normal package resolution without those project
  paths. They see the public default; separate beta fixtures opt in explicitly.
- Declaration and runtime resolution are separate: TypeScript `paths` does not
  rewrite emitted imports. Runtime imports must resolve legitimate built package
  exports. Package exports restrict subpaths; architecture checks prohibit
  relative/deep source bypasses, including bypasses inside workspace tests.

Cross-context code may use only allowed dependency edges even if the selected
declaration tier exposes more APIs. No configuration may silently fall back to
raw sibling source when declarations are missing.

## PKG-005 — Closed, reviewed declaration surfaces

Every exported API has an intentional release classification. Configure internal
underscore diagnostics as errors. Each trimmed surface must be usable without
references to excluded private declarations. Exposed cross-context types must
come through approved ports and compatible release tiers.

Review API reports as contract changes. Source import analysis remains necessary:
an export model does not describe all implementation dependencies. Neither export
restrictions nor declaration trimming is a security sandbox for JavaScript code.

## PKG-006 — Shaped package surfaces are the architecture/API contract

The project does not adopt CML or another parallel architecture model. The
selected mechanism is the combination of deliberately shaped package entrypoints,
encapsulation, generated declaration tiers, API Extractor report comparison,
compiler checks, and fail-closed import-boundary checks defined by PKG-001 through
PKG-005 and PKG-008. These mechanisms each cover a bounded fact: API reports
protect exported signatures and release tags, compiler checks protect source
contracts, and import checks protect implementation dependency edges. None alone
proves runtime observation, freshness, or publication behavior; those obligations
remain with the owning behavioral contracts and tests.

**Superseding decision (2026-09-27):** EXP-5's bounded CML correspondence result
is historical evidence only. Its fixture, parser bridge, and checker are removed
from active source and package/build/check/test paths. The bounded findings and
provenance are summarized in the [archive record](../archive/experiments/exp-5.md);
the original run remains recoverable from PR #21 at commit
`b4e7b67b54990ef8b50e0603c7e83ba001613c9b`. This retirement does not weaken or
replace the API Extractor, declaration-consumer, compiler, or import checks.

## PKG-007 — Test-first enforcement gate

Before configuring enforcement, write positive and negative fixtures showing:

1. Own tests can use intended internal exports through their private untrimmed
   configuration; unexported declarations do not magically become exported.
2. A sibling can use an allowed alpha contract but cannot see internal exports;
   a forbidden context edge still fails even when its API is visible.
3. Default external consumers cannot see alpha, internal or beta APIs. An opt-in
   beta consumer sees beta/public but not alpha/internal.
4. Public, beta and alpha declaration views typecheck without hidden-type leaks.
5. Deep/relative imports, re-export chains and test-only source aliases cannot
   bypass the chosen surface. Missing producer declarations fail explicitly.
6. Deliberate changes to API ownership, signatures, release tags or allowed edges
   are detected by the appropriate API report/compiler/import checks.

Run fixtures against generated artifacts and real consumer configurations, not
only mocked path mappings. An intentional negative fixture must fail for its
expected boundary violation, not an unrelated missing dependency. No passing
results are asserted by this specification.

## PKG-008 — Foundation checks precede runtime experiments

The workspace must establish a coarse package structure that exposes approved
context contracts and makes forbidden dependencies detectable. It must also
establish strict TypeScript checking, type-aware linting, tests-first workflow,
deterministic CI commands, API Extractor declaration rollups/reports, and
fail-closed source-import enforcement before M1 runtime
experiments. Strict checking must cover intended production and test source;
type-aware lint rules must use a real TypeScript program where type information
is needed. A CI check must fail when a required checker is skipped, a producer
declaration is missing, or a source import bypasses its approved package
surface. Generated declaration consumers must exercise all four views in
PKG-003/004: own-package untrimmed, approved sibling alpha, default external
public, and explicit external beta opt-in. Positive and negative PKG-007 fixtures
define the expected boundary before configuring enforcement.

The existing scaffold has strict compiler flags and a source dependency checker,
but they do not establish this full gate. In particular, API Extractor rollups,
all release-tier consumer fixtures, and type-aware lint checks are target work,
not current evidence. Baseline source-import checks must remain fail-closed while
packages change: unknown package/context paths and attempts to reach sibling
source must produce a diagnostic, not fall through to permission. API report and
compiler/import gates are the selected architecture contract; no parallel model
parser or correspondence checker is a prerequisite or active gate.

**Validation:** run all foundation commands from a clean checkout in CI and
record their exact results. Deliberately break a release tag, omit a producer's
declarations, introduce a forbidden sibling source import, and trigger a
type-aware lint rule; each must fail for its intended reason. Restore each
fixture and verify the positive consumers pass. See [A-15](acceptance.md),
[TEST-8](acceptance.md), and [M0.5](../milestones.md).
