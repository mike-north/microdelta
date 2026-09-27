# Package and API boundaries

`PKG-` requirements are normative unless marked experiment. They implement the
ownership in [architecture](architecture.md); exact package names and output
filenames are engineering choices. This specifies required enforcement, not a
claim that API Extractor or its checks are already configured. The initial
enforcement gate is M0.5, before runtime experiments; the CML correspondence
experiment is separate.

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

## PKG-006 — Separate CML/API correspondence experiment

Use established CML syntax unchanged. The selected mapping is **CML package
visibility to `@internal`**, with the visibility boundary corresponding to the
coarse workspace package in PKG-001, not an individual implementation folder.
Do not invent mappings from CML private/protected members to alpha/beta release
tiers. The experiment must identify which existing CML concepts have meaningful
TypeScript/API counterparts before enforcing them.

Compare architecture intent and explicit context/package/API-element mappings
with API Extractor's `.api.json` model, read through
`@microsoft/api-extractor-model`. Filter the extracted surface consistently with
the relevant declaration tier. Check represented ownership, exposed signatures
and cross-context types without requiring every TypeScript helper to correspond
one-to-one to a CML concept or inferring API names from display labels.

Combine this with TypeScript compiler information for source/class visibility
and implementation import checks. CML relationships are not automatically exact
import adjacency. Structural conformance cannot establish correct freshness,
publication or observation semantics; those require the behavioral contracts and
tests in their owning contexts.

**EXP-5 decision — bounded optional correspondence.** Retain the
[native CML fixture and checker](../../experiments/exp-5/README.md) as an optional
architecture correspondence tool. The tested subset maps two explicit bounded
contexts to workspace package entrypoints, entities/services to exported classes,
and selected operations to named methods with ordered parameters and simple
return types. CML package visibility corresponds to `@internal`; native
TypeScript accessibility and release tiers remain separate facts.
The extracted Entity/Service distinction is retained as provenance but is not
checked against TypeScript class roles.

The official CML parser supplies model facts, API Extractor's maintained model
supplies exported API facts, and the TypeScript compiler supplies the internal
method and native-privacy facts absent from the API model. The correspondence
manifest chooses represented elements and artifact locations; it must not invent
their observed identity or signature. Missing mapped declarations, a mismatched
actual API package identity, and a same-named reference from the wrong API owner
must fail. The fixture exercises these boundaries with source-derived artifacts
and mutation controls; [its evidence record](../../experiments/exp-5/evidence.md)
distinguishes initial compiler failures from later behavioral sensitivity checks.

This selection does not cover arbitrary TypeScript structures or establish
semantic equivalence between classes and domain objects. Entity attributes,
standalone functions, interfaces, type aliases, protected/private/`#` members,
and beta/alpha tiers remain explicitly outside the CML comparison. Existing
compiler, declaration-consumer, and import checks still govern those package
boundaries. Generic types, overloads, and additional CML constructs require their
own faithful mapping and negative assertions before they become represented facts.
The Java/Gradle setup and model-maintenance cost do not justify an unconditional
production CI prerequisite. Neither the optional model nor its absence changes
PKG-001 through PKG-005 or the runtime contracts.

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
   are detected by the appropriate model/compiler/import checks. Unsupported CML
   comparisons are reported as unsupported, not passed as semantic conformance.

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
source must produce a diagnostic, not fall through to permission. CML may later
check selected architecture correspondence, but its adoption, parser, and model
mapping are not prerequisites for PKG-008 or basic API Extractor enforcement.

**Validation:** run all foundation commands from a clean checkout in CI and
record their exact results. Deliberately break a release tag, omit a producer's
declarations, introduce a forbidden sibling source import, and trigger a
type-aware lint rule; each must fail for its intended reason. Restore each
fixture and verify the positive consumers pass. See [A-15](acceptance.md),
[TEST-8](acceptance.md), and [M0.5](../milestones.md).
