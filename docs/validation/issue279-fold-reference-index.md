# Exact fold-reference bookkeeping — issue #279

Owner: Reuse Resolution. Governing contracts: RES-002/003/004/006/007,
REUSE-001, CMP-8 and RUN-010. Base: PR #278 merge
`e34dbd1b9f48338007743180701aee9568e4bb77`.

## Change and boundary

`uniqueReferences` retains the first original reference object for each complete,
opaque locator string, in original order, using a function-local membership
index. Its four existing callers remain nested-candidate acceptance, nested
publication, direct publication, and shared strict/outcome fold publication.
Direct-candidate acceptance and unrelated integrity guards are unchanged.

`evaluateFoldCandidate` indexes only this candidate's exact dependency locators,
after supported-provenance/kind, consumed-step correspondence, own-fact and
membership guards. The original ordered loop still rejects a missing dependency
before reading that member, reads every included historical envelope even if
unconsumed, and checks its scope. Historical references remain separate from the
following unchanged current-reference map and consumed-fact comparison. Neither
index survives the helper call/candidate. History retains locator interpretation
and integrity ownership. No public API, declarations or persistence format changes.

## Tests-first evidence

Before runtime edits, the initial work oracle was independently reviewed at
SHA-256 `fb3af173224dbb9e8eed701f240efba9bc880c8b4a4b7893779566d9d6f36000`.
The unchanged runtime failed all four focused work assertions: publication at
N8/N32 observed 73/1,057 locator reads against allowances 52/196; retained
validation observed 36/528 against allowances 16/64. Publication/reuse, exact
references, equal-payload distinct results and historical-read assertions before
the work assertions succeeded. Command (terminal exit 1):

```sh
node --experimental-vm-modules node_modules/jest/bin/jest.js --config packages/core/jest.config.mjs --runInBand --runTestsByPath packages/core/.test-build/test/resolution/fold-reference-index.test.js
```

An earlier pattern-based command also matched the worktree directory and ran all
107 Core suites. Its unrelated output-fixture failures came from running only
`build:packages`; it is not the bounded RED record. Interrupted earlier attempts
and a rejected accessor-reference fixture were harness/setup work, not product RED.

All 13 additional semantic controls passed on unchanged runtime before the two
index edits; they specify preserved behavior rather than manufacture failures.
After implementation, the exact two focused suites passed 17/17 tests. Their
TypeScript compilation and type-aware lint passed. A subsequent copied-string
control found and repaired an observer coverage gap as detailed below; the final
repaired oracle re-observed all four original failures before restored GREEN.

## Acceptance mapping

| Obligation | Executable evidence |
| --- | --- |
| Separate actual publication and retained-validation work at N8/N32 | `fold-reference-index.test.ts`: `fold publication preserves N=… equal-payload distinct references with bounded exact-reference work`; `retained fold validation checks every N=… historical member with bounded dependency search` |
| First representative, exact string equality, order and non-fold helper caller | `fold-reference-integrity.test.ts`: `ordinary publication keeps the first equal-locator object in canonical child order and preserves distinct equal payloads`; real aliased sources expose distinct ordinary objects with the same locator, and stage dependencies assert object identity before normalization |
| Equal payloads with distinct exact locators survive | Both publication work cases, plus the ordinary alias case, read the real member/source results and assert distinct locator vectors |
| Immutable historical refs versus current acceptance | `an unread member change keeps historical references while current acceptance follows the new member` |
| Unconsumed included members' exact dependency, historical read and scope | `a sparse fold checks every included historical envelope although only the first member was consumed`; both `an unconsumed included member retains its … integrity obligation` cases |
| Missing-dependency/read ordering and exact diagnostics | `a missing unconsumed dependency fails before its read and every later read, preserving the exact message`; `an earlier historical fault wins over a later missing dependency` |
| Earlier miss guards | Five `… miss precedes dependency traversal` cases: unsupported evidence, different kind, consumed step, own fact, membership |
| Candidate/request local lifetime | `an earlier candidate index cannot authorize a later candidate or a later request`, asserting actual first-candidate reads and no historical reads for the later missing-dependency request |
| Strict/outcome statuses, skips, empty/open populations and restart | `fold/fold.test.ts`: `a closed empty population is a successful fold; a later open empty population waits and does not rewind it`; `fold/restart.test.ts`: `cold, then an unchanged restart: zero member and report bodies, the exact fold reference and its coverage`; `outcome-fold/outcome-fold.test.ts`: `RUN-010: over closed discovery the body receives every settled status, and the outcome carries complete coverage`, `a closed empty population folds as complete with empty coverage`; `outcome-fold/restart.test.ts`: `A-11 across processes: waits while unsettled, folds the failure once settled, reconsiders on repair, then reuses` |
| Existing nested/direct helpers and declarations | `nested/validation.test.ts`: `a cold run records ordered calls with v2 witnesses, argument recipes, exact child references and per-call consumed facts`, `an unchanged restart with reversed registration reuses every exact reference and runs no body`; existing direct Resolution suites and repository check/test/build gates |

## Work-oracle scope and sensitivity

The probes transparently delegate real operations and preserve values, reference
data descriptors, predicate arguments/results and traversal. They restore the
observed operation in `finally`; fixture assertions run after deactivation.
Classification uses retained boundary-object/locator metadata and adds no counted
locator read. Locator traversal must be nonzero. The publication allowance is
6N+4 locator reads (two deduplication, two provenance/materialization and two
staging reads per member, plus fixed discovery/fold work) and 2N predicate visits.
Retained validation permits 2N candidate-dependency locator reads and 2N predicate
visits. These allowances were fixed before runtime changes.

Author sensitivity controls separately restored each original scan: each compiled
and failed only its two route cases, while the other two cases passed. The copied
publication string-array scan likewise failed its predicate-visit bounds. The
copied validation string-array control exposed an observer coverage gap: native
SQLite adapter arrays and their mapped descendants retained a different realm's
array prototype. An independent native/Jest diagnostic confirmed a copied
triangular search performed 36 comparisons at N8 while the initial observer saw
zero; a local `Array.from` retained exact reference values/order and exposed all
36. The repair is only the test History-port dependency-array copy plus its
comment; the runtime and finite bounds were unchanged.

The final oracle SHA-256 is
`7984efe3901b407d627c15c375db2c310343ed7f2f6f3f7e7a6ace8fd4a1721f`.
With this repaired oracle, author controls compiled original base source and
observed all four work cases fail (terminal 1), then compiled a copied-string
validation scan and observed exactly its two predicate-visit bounds fail while
both publication cases passed (terminal 1). Source and generated runtime were
restored in `finally`; all 17 focused tests then passed (terminal 0). The copied
validation predicate counts were 36/528 against 16/64. Test type-aware lint passed.
Author controls are not independent final review. Exact-head repository gates and
independent adversarial review remain delivery gates; their exact SHA/results
belong in the delivery review rather than being inferred from these tiny cases.

## Limits

This is tiny, deterministic bookkeeping evidence. It does not measure Set
internals, latency/speedup, transient heap, physical I/O or whole-runtime resource
bounds. It establishes no author contract for arbitrary getters/proxies. Full
150,000 subjects/full rows, ten retained fields/consumers, three changed subjects,
N+9 retained results, all 18 phases and TEST5/M7 remain unproved. No frozen #272
lineage, qualification harness, provider run, CLI, publication or release automation
was changed or executed.
