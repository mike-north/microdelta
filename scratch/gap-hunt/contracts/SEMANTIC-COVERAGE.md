# Tracking, Composition, and glossary semantic coverage

Implementer: Codex worker (gpt-6.1-sol), operating for Mike North.

`semantic-clauses.json` retains all 178 non-code paragraph/table blocks of
`tracking.md`, `composition.md`, and `glossary.md`. Fifty-six named assertion anchors
record the concrete behavior they establish and the actual execution log. This is
an exhaustive clause inventory, **not complete normative certification**: 104 blocks
have bounded semantic assertion evidence, 41 remain explicitly uncovered by this
audit, and 33 are structural text. Every partial block explicitly leaves all
unproved sub-obligations uncovered. An uncovered block is not itself a defect or
proof that the repository lacks a relevant test. Literal requirement-ID references
were never counted as assertion coverage.

Executed in this worktree:

- Tracking observer, lazy-view, output-observation, and the new invalidation matrix:
  73 assertions passed (`semantic-tracking.log`).
- Value package: 50 assertions passed (`semantic-value.log`).
- Definition package: 281 assertions passed (`semantic-definition.log`).
- Assembled M4 keyed, nested, strict-fold, topology suites: 22 assertions passed
  (`semantic-composition.log`), including separate processes and SQLite stores.
- New precision matrix: strict TypeScript compilation and type-aware lint pass.

The strongest verified boundaries are selected-leaf and operation precision,
missing-versus-undefined, current-path rebinding with retained original evidence,
concurrent/late async frames, cached derivation replay, value transport/equality
separation, exhaustive versus visited collection evidence, frozen topology,
tracked gate membership, child-output cutoff, keyed insertion/deletion/reorder,
and framework strict-fold coverage. These proofs remain bounded to their fixtures.

The ledger deliberately retains gaps: proposed identity conveniences, arbitrary ordering/ranking variants,
all argument-reconstruction sub-obligations, production cache eviction/scale,
and glossary definitions owned by operational/history contracts are not certified
here. EXP-6 Lean remains dormant as directed. Experimental/proposal text must not
be promoted to a current shipped obligation. The single logical projection digest
has component evidence; integrated arbitrary-loop scale remains outside this audit.

Two separately captured inconsistencies remain the substantive findings:

1. Nullable tracked container guards produce false reuse when a nonnull object
   changes to null/missing; the scalar guard control passes. See `README.md` and
   the container-guard tests/logs, including independent-process variants.
2. The author declaration/type surface accepts scalar result roots while runtime
   supports only record/array roots. See `SCALAR-ROOTS.md`. This is an API/DX
   mismatch, not a claim that M3 promised scalar-root lazy navigation.

`imported-artifact-probe.mjs` exercises the **production** observer with actual
imported emitted modules in independent Node processes. Its six cases pass:
unchanged fresh modules remain equal; a transitive tracked imported leaf edit
changes evidence; dependency package version metadata alone does not; function
rename, emitted formatting and emitted comments conservatively change evidence.
The latter are expected conservatism under TRK-2, not false reuse or defects.
Each frame observes both the intermediary and imported leaf implementation under
separate structural bindings. This does not establish untracked closure soundness.

Reproduce from the repository root:

```sh
node scratch/gap-hunt/contracts/imported-artifact-probe.mjs
node scratch/gap-hunt/contracts/semantic-map.mjs
npm run test:unit --workspace @microdelta/tracking -- --runTestsByPath .test-build/test/observer.test.js .test-build/test/lazy-view.test.js .test-build/test/output-observation.test.js .test-build/test/gap-hunt-contracts-invalidation.test.js
npm run test:unit --workspace @microdelta/value
npm run test:unit --workspace @microdelta/definition
npm run test:unit --workspace microdelta -- --runTestsByPath .test-build/test/m4-acceptance/keyed.test.js .test-build/test/m4-acceptance/nested.test.js .test-build/test/m4-acceptance/fold.test.js .test-build/test/m4-acceptance/topology.test.js
```

Additional executed owner evidence: documented capture-lint fixtures 34/34,
EXP-2 value/loading fixtures 28/28, nested SQLite navigation fixtures 12/12.
Operational glossary entries link the durability worker ledger at commit bfb1cc3
and preserve its suite-level limits. Lean historical prose remains dormant;
selected experimental evidence is never represented as production rollout proof.

An additional ordered-ranking operation assertion passes: selected score changes
invalidate, while unselected avatar edits preserve the ranked-key consumer evidence.
The focused precision matrix now has 13 passing assertions (`tracking-results.log`).

The finite edge oracle contributes 20 passing matrix rows (204 independent workers),
including special own-data keys, lone UTF16 keys, numeric atoms and sparse arrays.
The actual imported-helper capture lint probe asserts four expected diagnostics.
A distinct intrinsic-presence counterexample (9 red/2 green) is recorded separately
with exact TRK-5 and Value-domain citations; supervisor classification confirmed
operation-specific presence overrejection, not another #155 instance.

The updated `scope-evidence-ledger.json` separates sentence/table-row units before
coverage discussion: 294 delivered, 1 deferred target, 2 proposal, 32 historical,
and 46 structural units. These are denominator/routing counts, **not pass rates**.
The class-support deferral is separated from the delivered requirement to reject
classes visibly. No whole unit is certified merely by sharing a paragraph or ID
with a test. Each retains bounded evidence statements and open residuals.

`other-owner-evidence.json` snapshots 32 named operational/history requirements
and 295 actual test statuses from the durability worker at bfb1cc3; failed tests
are not promoted to passing evidence. The separately retained `surface-owner-evidence.json` links Analysis, Bounded
Context and Publication vocabulary to exact owner-reviewed records at 27271cb.
Those records preserve evidence paths and residuals; they are not represented as
independently executed test IDs or whole-unit proof.

The durable scalar branch test adds a passing five-process current-evidence
assertion: flip the branch, edit the abandoned leaf without rerunning, change a
newly active leaf and publish, then roll back to the original exact result.
The operation suite remains 6 intentionally red #155 cases and 8 passing controls.

The owner selected record/array roots for #156; scalar authors use wrappers. The
original accepted-scalar declarations remain historical mismatch evidence, while
`ISSUE-156-CONTRACT.md` now gives unconditional acceptance criteria.

Eight new explicit-output rows pass: current comparison distinguishes returned
record insertion order, missing/present undefined, holes, inherited values and
ownership, while equal detached shape/custom lookup chains remain equal. The
request names only the returned subtree; unread sibling edits remain outside it.
Two new concurrent replay rows pass for cached success and failure. One warmed
derivation runs once, replays evidence into overlapping async consumers, and
preserves their disjoint before/after leaves even when one closes first. The async
suite is now 5/5; Tracking strict compiler and type-aware lint checks pass. These
are bounded component proofs, not durable workspace or arbitrary async coverage.

Additional glossary explanation is available in the consumerDX branch at 2b4fcb8:
`scratch/gap-hunt/contract-surface/A3-GLOSSARY-ANCHORS.md`, retaining named assertions
and residual boundaries for Analysis, Bounded Context and Publication.

A further assembled-path precision gap is recorded in `DURABLE-OUTPUT-REUSE.md`:
input-bound MDS1 output evidence is recorded correctly but ownFactProvider cannot
answer it on restart. Identical/unread-only inputs therefore force publication;
the scalar-only control reuses. The durable output suite is 8 red/1 green. This is
conservative unnecessary execution, not false reuse; supervisor classification is
pending. Strict core compiler/type-aware lint pass, including documented type-only
capture suppressions for the historical #156 scalar acceptance fixture.

A focused TRK-5 guard assertion passes across eight independent processes: 0,
empty string, false, null, undefined, NaN and negative zero each remain distinct
consumed values despite identical falsey branch output. Rollback to zero reuses
the original exact result. Only this new operation row was rerun (1pass/14skipped);
the earlier six #155 red cases remain intentional. Core compiler and type-aware
lint pass. This supplies concrete scalar guard-value coverage, not evidence that
container truthiness was repaired.

The multi-hop current-argument scenario passes across eight independent processes
and three stores. Earlier-child forwarded paths and a transformed derived subject
follow current bindings through equal-output cutoff, later name/score changes,
unread edits and rollback. Current acceptance dependencies update while original
parent dependencies remain immutable; independent cold Eve/Grace stores agree.
`MULTIHOP-CURRENT-ARGUMENTS.md` enumerates exact assertions and residual variations.
No new false reuse or owner design question was found. The owner's Linux report
covers43444bb only; these new assertions have local Node24.22.1 execution evidence.


## Finite mandatory-outcome completion

`TRACK-A-COMPLETION.md` and `completion-audit.json`, reproduced by
`node scratch/gap-hunt/contracts/completion-audit.mjs`, supersede zero universal
certification as the Track A completion measure. The clause inventory still
records source paragraph coverage; it is not a count of unsatisfied requirements.
The finite audit has 71 mandatory Tracking/Composition outcomes: 64 satisfied,
7 divergent rows belonging to four existing issues (#155, #162, #164, #168).
All 67 glossary definitions now link exact executed assertions or bounded owner
audits; two explicitly carry the known Observation/Member key divergences.
No additional mandatory outcome lacks executed evidence in this scoped audit.
Additional cross-product combinations remain optional, not missing mandates.

Two actual missing assembled assertions are now supplied. COL-4 early termination
visits only [1,2] under a tracked threshold of 2; changing the unvisited third
value reuses. Raising the threshold to 3 publishes the full traversal, agrees
with an independent cold store, and later third-value changes invalidate.
Rollback retains the original exact result. This passes across six processes.
CMP-4 sibling precedence has one declared child await a host barrier that its
independent sibling releases; both finish before the parent and event order is
wait/release/resumed. The focused suites each pass; core strict compiler and
type-aware lint, 67 existing fold/keyed tests, and Tracking type contracts pass.
Portable selectors are `early-stop` and `precedence`; their underlying compile,
test and strict checks ran locally, while installer wrappers were not rerun.
These are characterization tests: the implementation already satisfied them,
so no expected-failure implementation cycle or production fix occurred.

Implementer: Codex worker (gpt-6.1-sol), operating for Mike North.

## TEST-5/6 concrete runtime outcomes

`TEST-5-6-COST-REACTIVE.md` records three new passing assertions across ten
independent processes: exactly three changed enrichment members; CPU-expensive
strict aggregate over cheap memoized leaves; ten narrow Materialization consumers
(160 scalar cells, zero root payloads); mutable local filters without stored
snapshot rewrites; and fresh process-local tags over one exact retained corpus.
Core strict/type-aware lint and generated-alpha tsd pass. Narrow/reactive views
compose owner-alpha APIs; a new facade convenience API is not presumed.
150,000 subjects remains an unmeasured capacity target for this bounded suite.
