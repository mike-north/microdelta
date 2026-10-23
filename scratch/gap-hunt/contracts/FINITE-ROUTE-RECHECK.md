# Contracts finite-route recheck after durable Track D

Implementer: Codex worker (gpt-6.1-sol), operating for Mike North.

Read-only review input: `.worktrees/control/OBJECTIVE-AUDIT.md` and this branch's `TRACK-A-D-SOURCE-REVIEW.md`, `source-review.json`, `ARTIFACT-DURABLE.md`. Root status/control files and GitHub were not modified.

## Durable Track D ledger reconciliation

The six-case, 18-process durable controls are already routed from `TRK2-artifact-policy` to the exact Jest source and execution log in `source-review.json`. The raw evidence contains body counts, result values, exact locators and emitted leaf hashes; clean bootstrap evidence records tested head `7c935aa1cb3612376ae2d32af7145bf3e2018aca`, Node 24.22.1/npm 11.12.1, exit 0 and clean checkout. Final evidence delivery head is explicitly recorded as `6d5123651de0a0de420102702fb55c96b439f444`. No observer-only comparison is being promoted to a body-count result.

## Highest-value residual found: a missing negative evidence route

TRK-3 (`tracking.md:34–39`) says process-local tags/revision counters must never enter durable evidence; ARC-004 (`architecture.md:83–97`) preserves that boundary. The old `TRK3-durable-correspondence` route named canonical encoding and fresh-process rebinding, but did not route the explicit tag-serialization assertions. Those assertions already exist, so adding another test would duplicate behavior rather than uncover a new finite requirement.

Focused execution of `packages/tracking/test/track.test.ts` now passes **2 tests**, with **22 unrelated tests skipped**:

- `TK-1: tags are distinct frozen opaque tokens with no signal state` checks distinct frozen tags, absence of value/revision/subscriber state, direct and nested JSON rejection, structured-clone rejection and v8-serialization rejection.
- `TK-2/A-20: each injected tracker owns isolated tags and capture context` checks owner-specific frames/tags and foreign-tag rejection.

`source-review.json` now routes both exact titles and `local-tag-boundary-results.log` alongside the existing semantic restart evidence. This is an executed coverage-routing correction, not a newly found product defect, persistence of every arbitrary author number, or proof that unrestricted JavaScript can be sandboxed.

Installed-checkout reproduction, actually executed:

```sh
npm run test:unit -w @microdelta/tracking -- --runTestsByPath .test-build/test/track.test.js --testNamePattern 'TK-1:|TK-2/A-20:' --verbose
node scratch/gap-hunt/contracts/source-review.mjs
```

Production remains `c5802daca4a0bb8ea91159854d84eddcfa5215b6`; the focused run was made at branch head `6d5123651de0a0de420102702fb55c96b439f444` with generated declarations already built. No implementation or new fixture was required.

## Other finite candidates inspected before declining duplicate tests

| Candidate clause | Existing concrete assertion route / disposition |
| --- | --- |
| TRK-4 scalar extracted before capture | `fixtures/declarations/consumer-alpha/src/tracked-captures.fixture.ts:99–105`; `tooling/tracked-captures.test.mjs:28` explicitly requires diagnostics for extracted/maybe. Already in executed capture-lint mapping. |
| TRK-1 primitive/class rejection and no implicit memoization | `observer.test.ts:1149` and `:557`; current mapping already executes these runtime negatives and count assertions. |
| TRK-3 cached failure/success replay and closed-frame rejection | `observer.test.ts:739`, `:781`, `:803`, `:1063`; async companion tests supply detached success/failure and concurrent cached replay. Already routed, no new requirement inferred. |
| VAL-2 unknown encoding versions and malformed/duplicate records | `value.test.ts:343` separately rejects MDV9 and MDS9, duplicate MDV/MDS keys, malformed and noncanonical data. Existing executed Value route. |
| COL-2 projection descriptors, coverage and order | `observer.test.ts:834`, `:883`, `:936`, `:981`, `:1010`; the existing projection route covers exhaustive/visited shape and mismatched selection. Early-stop guards have the dedicated previously executed durable controls. |
| CMP-7 unjustified forwarded/derived and unavailable current origins | The preceding source-review correction routes the distinct executed `nested/arguments.test.ts:452/:476` and `nested/validation.test.ts:411/:442` cases. No repeat run needed. |
| CMP-8 admission/observer/integrity request failures | Prior explicit member observer test plus existing fold admission and malformed-evidence cases provide separate routes. Post-commit diagnostic behavior remains separate. |

The generator now checks every retained evidence route for an existing named source assertion and readable recorded execution log. All **173 routes across the 71 historical rows** pass this mechanical check. This checks reference integrity; it does not rerun 173 tests or certify every sentence from a count. The two rows with no local assertion routes remain the already owner-tracked custom-key alternative rejection (#168), with their pinned external repro retained.

## Remaining unverified or scoped clauses

- **CMP-8 bare undefined success:** source wording versus selected record/array root contract is owned by #156. Wrapped data is not substituted for the literal bare-root assertion.
- **ARC-008 literal independent recursive child resolver replacement:** the later [literal obligation audit](ARC-008-LITERAL.md) classifies this as a specified-but-missing validation seam/isolated-test obligation. Controlled callbacks and #144 mutations discriminate concrete runtime faults but do not satisfy the named fake-child-resolver requirement. A masked runtime defect is not a prerequisite for that normative validation finding. No public API is selected.
- **Merged #171 navigation-kind spec:** this branch's old nullable-guard and no-kind evidence is explicitly historical. It is not a complete fresh audit of merged-main Tracking/Composition; #155 is already owned/repaired according to the root audit.
- **VAL-3 eviction/strong ownership and scale:** no mandatory universal payload-retention limit is invented from the permissive eviction wording. Selected-view reclaimability is the separate Track C owner investigation listed in the root audit. This worker did not duplicate it.
- **Historical EXP-2/Lean evidence, future host/cache/CLI/scale targets, and arbitrary untracked closure soundness:** retain their existing historical/target/assumption classifications. They are not additional finite runtime assertions silently counted as passing.

Within this Tracking/Composition assignment, this recheck found no further unowned finite normative behavior lacking an executable route. That is a bounded investigation result, not completion of all tracks or universal conformance. No product fix, new issue, PR or root-ledger edit is proposed.
