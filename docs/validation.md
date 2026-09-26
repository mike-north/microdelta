> Historical implementation evidence, not current design authority. Start at
> [the active specification](spec/README.md). Dates and passing-test counts below
> describe prior runs; they were not rerun by the specification consolidation.

# Core implementation checkpoints — 2026-09-13

## Latest checkpoint: internal tracking and authoring exploration

Node ≥20 and AsyncLocalStorage are now confirmed. The internal track façade is
implemented behind `@preact/signals-core@1.14.4`, with 23 rule-derived tests. The
root authoring API has not been extended while surface exploration is underway.

`npm run check` and `npm test` passed: **69 runtime tests**, four dependency-rule
checks, and tsd. The same 69 compiled runtime tests passed on **Node 20.0.0** and
**Node 24.14.0**. Three initially failing regressions caught hidden dependencies
across nested frame boundaries; the adapter now isolates frame callbacks and
subscribes only to their explicitly collected tags. Cached failures replay tags
before rethrowing, and completed frames do not acquire detached-work reads.

The user also confirmed array length as a field read. Its materialization behavior
remains unimplemented. Promise-valued properties were allowed as an option, not
selected as the final surface. The earlier asynchronous getter impossibility
claim is corrected in the [decision record](archive/pre-consolidation/decisions.md).

The [authoring exploration](archive/pre-consolidation/exploration/authoring-surface.md) includes code snippets,
type-only compiler probes, and bounded allocation experiments. It does not approve
an author-facing API. The original store checkpoint below is retained as historical
evidence; its pending-runtime and missing-track statements have been superseded.

## Initial checkpoint: store and naming

The audit target is the first storage milestone and the naming leaf. Rev 9 governs
semantics; the core draft supplies proposed interfaces; the components document
supplies sequencing. The viewer is informative. This is not full core acceptance.

## Verified locally

Environment: macOS, Node **24.14.0**, npm **11.18.0**. No remote CI run was performed.

| Check | Result |
| --- | --- |
| `npm run check` | Strict source/test typecheck and dependency lint passed. |
| `npm test` | 46 Jest tests passed; 4 tooling tests passed; tsd passed. |
| `npm run build` | ESM and declarations emitted successfully. |
| `npm audit` during final install | 0 reported vulnerabilities in the locked dependency tree. |
| Local `npm pack` and isolated consumer | Normal import ran without Jest or a build step; packed declarations typechecked. No publication. |

The 46 runtime tests comprise 31 reusable store conformance tests, 9 memory
snapshot regressions, and 6 naming tests. No test was skipped. The fingerprint
probe records **zero value reads** for both a 16-byte and a 1 MiB payload; its
positive control increments when fields are loaded. This is mechanism evidence,
not a storage throughput or ST11 benchmark.

## Requirement coverage

| Classification | Contract | Evidence / remaining limit |
| --- | --- | --- |
| aligned | SA-1 single-row CAS | 64 same-version contenders produce exactly one winner; stale CAS changes nothing; exact token increments; exhausted/invalid versions reject. |
| aligned | SA-2 insert-only rows | Concurrent subject and generation inserts retain one winner; immutable field batches reject all writes on conflict. |
| aligned | SA-3 fingerprints without payloads | Separate header/value indexes, instrumented no-value-read test with a positive control. SQLite SQL remains unverified. |
| aligned | SA-4 expiry query | Strict `< now`, oldest first, bounded result, isolated copies, no state mutation. |
| aligned | SA-5 metadata | Schema 1, fixed `sha256` identifier, mismatch rejection. No fingerprint implementation exists yet; this does not validate a future hashing module. |
| specified but missing | SA-6 SQLite default | Memory passes; SQLite, reopen/migration tests, contention, and process-crash tests are not implemented. |
| aligned | SA-7 storage has no lifecycle policy | Arbitrary states/numbers round-trip without allocation, sweeping, supersession, or retries. |
| aligned | NM-1 / NM-2 | Declared/inferred names, anonymous/bound/synthetic names, explicit overrides, immutable rejection vocabulary, inaccessible names. |
| aligned | DR-1 graph enforcement | Exact source-graph comparison; prohibited imports/re-exports/dynamic/CommonJS imports; schema-only edge; unlisted module rejection. |
| spec ambiguity or contradiction | Remaining leaf and upper-layer contracts | See [findings](archive/pre-consolidation/design-findings.md). No substitute semantics implemented. |
| specified but missing | Complete core and steel threads | No runtime, claims, repository, trace, materializer, explanation, or integration steel threads yet. |

## Test-first and review evidence

- The dependency-boundary tests initially failed because the rule was absent;
  subsequent bypass tests failed before CommonJS/unlisted-module enforcement was
  added. The final four tests pass.
- Store interface/conformance tests existed before memory implementation. The
  registered memory suite initially failed to compile because the backend module
  was absent, then passed against the implementation.
- The naming tests similarly failed against the missing module before implementation.
- Independent review reproduced version overflow, nonfinite numeric tuple
  collisions, and shared-memory mutation. Seventeen regression cases failed
  against the old backend while the original 23 store cases still passed. All
  pass after exact token validation, unambiguous numeric tuple encoding, and a
  detached V8 snapshot codec were added.
- Package smoke verification used the actual packed files in a fresh temporary
  consumer, not a workspace symlink. The normal entry point has no Jest import.

## Proposed refinements actually applied

1. `GenerationPatch` excludes immutable address fields; runtime patch guards reject
   managed-key/version changes. Missing generation updates reject explicitly.
2. `putFields` is an insert-only atomic batch, implementing retained-value
   immutability without lifecycle interpretation.
3. Store snapshots detach inputs, patches, and outputs. The memory codec rejects
   raw shared buffers and copies shared views; it is not a durable disk encoding.
4. Subject versions are nonnegative safe integers and cannot advance beyond their
   exact range. Numeric tuple components preserve distinct nonfinite values;
   deciding valid revision/generation policy remains a caller responsibility.
5. DR-1 uses a custom ESLint rule rather than only string import restrictions,
   retaining the supplied adjacency list unchanged.

All refinements have corresponding tests and comments. Empty explicit naming
overrides remain literal, per NM-1's “override if given”; wrapper validation is
not implemented. No graveyard mechanism was introduced.

## Pending gates

The required batched assumption confirmation has not arrived. The tracking
adoption probe is documented, but its façade is not implemented. Fingerprint
canonicalization/path behavior, identity dependencies, and middleware failure
types remain unresolved. Higher layers are blocked by the documented publication,
trace-address, primitive-identity, and asynchronous-access contracts.

The memory storage gate and naming leaf are complete; **sequencing step 1 as a
whole is not complete**. SQLite and ST11 are not measured. Claims about durable
memoization, no duplicated paid execution, restart behavior, reclamation, and
whole-core correctness would be premature.
