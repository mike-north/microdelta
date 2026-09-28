# Nested selected-read gate

Governing issue: [#54](https://github.com/mike-north/microdelta/issues/54).
Contracts: [DOM-3](../../docs/spec/domain.md), [TRK-1/2/5 and VAL-1/2/3](../../docs/spec/tracking.md),
[RES-002/003](../../docs/spec/execution.md), [package boundaries](../../docs/spec/package-boundaries.md)
and the nested-materialization section of the
[M3 plan](../../docs/plans/m3-contribution-analysis.md). The experiment follows
the [EXP-0 evidence contract](../../docs/spec/experiments.md).

## Question

Can ordinary nested record reads and indexed array loops over an exact retained
result be served node by node from real SQLite, recording exactly the TRK-5
observations an in-memory tracked wrapper records, while navigation, selected
leaves and fingerprint comparison never read the root payload or an unrelated
subtree?

## Scope and candidate

- Production owner ports (not experiment code): Value `navigate` and
  `normalizeSelectedNode` with `ISelectedNode`; History's optional alpha
  `ICompletedNavigationReader`; Tracking's `ITrackedNodeSource` and
  `materialization.lazyView`; Materialization's `materializeView` and optional
  `navigationReader`. Scalar-only readers and `materialize` are unchanged.
- Candidate layout (`src/node-index.ts`): a History-style immutable store with
  the canonical MDS1 payload plus a generated node index. It is a candidate for
  History to adopt; it owns no attempt, lease, current pointer, acceptance or
  publication protocol and is not a second persistence authority.
- Bounded input domain: the M3 contributor-activity fixture (Ada: PRs 101 and
  102 merged, 103 open, five submitted reviews; unread avatar, labels, dates,
  review ids and a one-megabyte note) and one Value-domain edge record (key
  order, sparse holes versus present undefined, two custom prototype levels,
  shadowing, a null-prototype record, Property `"0"` versus Index `0`, a dotted
  key, NaN, negative zero, infinity, null, a `then` data field).
- Variations: renamed profile, unread-only change (avatar, labels, notes), one
  merged-status change, profile becoming an array, name becoming a record.

## Assertions written first

Package suites (`packages/*/test`):

| Assertion | Test |
| --- | --- |
| A nested name returns exactly one consumed leaf; only its path is requested | `nested-view.test.ts` › a nested name…; `lazy-view.test.ts` › a nested leaf read… |
| Unread siblings are neither requested nor observed | same, plus indexed-loop tests |
| Name changes invalidate; unread changes do not; comparison reads no payload | `nested-view.test.ts` › consumed changes invalidate… |
| Container-kind changes never compare equal | `nested-view.test.ts` › container-kind changes… |
| Length only when read; loops record visited selected fields | `lazy-view.test.ts`, `nested-view.test.ts` › indexed loops… |
| Old exact reference never follows current | `nested-view.test.ts` › an old exact reference… |
| Missing, wrong-scope and incompatible content fail without observations | `nested-view.test.ts` › missing, wrong-scope… |
| Holes vs present undefined, prototypes, Property/Index, key order match in-memory wrappers | `lazy-view.test.ts` › every supported operation…; `navigation.test.ts` |
| Malformed reader envelopes (including Promises and accessors) rejected | `navigation.test.ts` › untrusted node envelopes; `nested-view.test.ts` › malformed reader envelopes… |
| Mutation and native reflection rejected; views owned by the composed observer | `lazy-view.test.ts`, `nested-view.test.ts` |
| Explicit wrapper output detaches the subtree and records MDS1 evidence | `lazy-view.test.ts`, `nested-view.test.ts` › explicit wrapper output… |
| Capture lifetime: late work fails before any reader request | both suites |
| Async carrier adds no phantom `then`; direct resolution does (control); `then` stays author data | `nested-view.test.ts` › asynchronous invocation transport |
| Scalar-only readers unchanged; nested views need the navigation capability | `nested-view.test.ts` › scalar-only readers… |

Real-SQLite suite (`test/nested-sqlite.test.ts`), with a publisher process, a
fresh reader process and a fresh comparison process on one file:

| Assertion | Test |
| --- | --- |
| Summary values and observation list are exact; fingerprints equal independent MDO1 oracles | a nested name and indexed loops… |
| Creation and navigation return zero payload cells; summary returns exactly its 4 consumed leaves; bound addresses are only consumed paths and prefixes | view creation, navigation and selected leaves… |
| Explicit output reads only the profile subtree; key order and MDS1 digest preserved | explicit output loads only… |
| Comparison in a fresh process returns zero payload cells; positive control returns one | metadata comparison… |
| Comparison outcomes for every variation | consumed changes invalidate… |
| Domain operations over SQLite equal in-memory wrapper evidence | supported Value-domain operations… |
| Old exact reference after later publications | an old exact reference… |
| Index generated from payload verifies; tampering detected by verification and subtree digests | the index is generated… |
| Missing, wrong-store, unknown-version, unsupported-encoding references fail | missing, wrong-scope… |
| Another store, schema version or incomplete schema rejected at open | another logical store… |
| Immutable publication; container root required | publication is immutable… |

## Observed test-first failures

Recorded before each implementation was supplied:

- Value: `navigation.test.ts` against throwing stubs — 10 failed, 37 passed.
- Tracking: `lazy-view.test.ts` against the unmodified source — compilation
  failed (`lazyView` and `ITrackedNodeSource` absent).
- Materialization: `nested-view.test.ts` against a throwing `materializeView` —
  15 failed, 17 passed.
- Real SQLite: `nested-sqlite.test.ts` against a throwing candidate — 11 failed.
  The first run with the candidate exposed a fixture defect (a shared `labels`
  array, correctly rejected by Value as a shared reference); after copying it
  per pull request, all 11 passed.

## Reproduction

```sh
npm run build
npm run test:exp-nested
npm test --workspace @microdelta/value --workspace @microdelta/tracking --workspace @microdelta/materialization
```

Pinned tools: Node 24.14.0 locally (CI 20/22/24), SQLite 3.53.0 through
better-sqlite3 12.9.0 via Machine's Node adapter, TypeScript 5.9.3, Jest 30.5.1.

## Observed results

Reader process, one fresh open of the file:

| Operation | Statements | Payload cells | Payload characters |
| --- | --- | --- | --- |
| Create view (root shape) | 2 | 0 | 0 |
| Summary: name, 3 merged flags, 2 lengths | 24 | 4 | 46 |
| Explicit output of `profile` | 6 | 3 | 88 |
| Old exact reference name | 7 | 1 | 16 |

The unread one-megabyte note never crossed the storage boundary. The comparison
process ran 51 statements (reference, node-metadata and fingerprint roles only)
and returned zero payload cells; its positive control returned exactly one.

| Current result | Summary capture | Output capture (`profile`) |
| --- | --- | --- |
| base | equal | equal |
| unread-only | equal | changed |
| renamed | changed | changed |
| merged-changed | changed | equal |
| profile becomes array | incompatible | changed |
| name becomes record | changed | changed |

## Decision

**Pass** within the declared scope. Nested lazy views over exact retained
results record the same evidence as in-memory tracked wrappers over the
supported Value domain, and the candidate layout answers navigation, selected
leaves and fingerprint metadata without root or unrelated payload reads.

Owner ports adopted here: `ISelectedNode`, `navigate` and
`normalizeSelectedNode` (Value); `ICompletedNavigationReader` (History, optional
beside `ICompletedResultReader`); `ITrackedNodeSource` and
`materialization.lazyView` (Tracking); `materializeView`, `IMaterializedView`
and `navigationReader` (Materialization). All are project-private `@alpha`.

Index requirements for the durable History authority:

1. History generates the index itself, in the publish transaction, from the
   canonical MDS1 payload it stores; it never accepts caller-authored metadata,
   and it can regenerate and compare the index to verify it.
2. Per node: kind, the scalar leaf (MDV1), array length, own keys in snapshot
   order, prototype link and chain terminal, and the MDS1 snapshot digest.
3. Per structural slot: own record members and present array elements, with
   enumeration position.
4. Per reachable address, including members inherited through supported
   prototypes: the node, the own flag and the MDO1 `value` digest.
5. Absent members are answered from the longest indexed prefix by evaluating
   Value on a payload-free stand-in of the same container kind and chain
   terminal; no absent-key rows are stored.
6. Fingerprint resolution selects only metadata and digest columns; a Value
   rejection of the recorded selection (for example a Property segment on an
   array) resolves `incompatible`, never equal. MDO1 `value` digests of
   containers make a scalar-to-container change resolve `changed`.
7. Reference resolution validates locator grammar version, logical store,
   existence and stored encoding; each failure is an integrity error, never a
   miss or a retarget.

## Coverage limits

- No publication, attempt, lease, current-pointer, acceptance, crash-recovery or
  concurrency claim; those belong to the durable History authority.
- Index generation encodes each container subtree for its digests, so its cost
  grows with nodes times depth. No M7 scale, memory, cache or eviction claim.
- Keyed projections resolve `unavailable` from this candidate.
- Navigable results need a record or array root; a scalar root has no member
  address and is rejected.
- Synchronous storage only. Asynchronous-only storage cannot implement the
  navigation capability and no synchronous getter over it is promised.
- Directly resolving a view through a Promise probes `then` as an ordinary read;
  invocation transport must carry views inside an ordinary result carrier.

## Proposed owning-contract amendment

For supervisor review: the EXP-2 access decision in
[tracking.md](../../docs/spec/tracking.md) states that nested lazy
materialization remains unproven. This gate supplies bounded evidence for it
over synchronous indexed storage; the amendment and the experiment table entry
are left to the supervisor.
