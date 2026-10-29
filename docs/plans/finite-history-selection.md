# Finite exact History selection

The supervisor selected [#309](https://github.com/mike-north/microdelta/issues/309)
after independent contract review. This is the implementation-guiding contract
for one library read operation under ARC-010, RUN-006/007, A-16f and part of
CLI-001. It is not delivery of #165/#167, a general inspector, or M6/M7.
The [standalone inspection plan](standalone-inspection.md) remains the home for
the broader proposed composition and unresolved product decisions.

## Meaning and responsibility

One request explicitly names an existing storage location, logical store, exact
completed-result reference and either a selected fact or a fingerprint query.
History validates that evidence, realizes the requested answer and attempts all
release actions before returning or throwing. A successful answer owns detached
data and retains no reader, connection, statement, iterator, callback or lazy
Materialization view. It neither selects a current result nor verifies freshness.

Machine owns existing-file native readonly authority, DEFERRED transaction
mechanics, locks, bounded busy waiting and physical end/close. History owns SQL,
schema, logical identity, exact-reference resolution and result integrity. An
internal scoped read port connects those responsibilities; Machine interprets no
History schema or application outcome.

The initial query vocabulary admits unquoted SELECT and WITH RECURSIVE forms,
one leading role comment, and the COUNT/JSON_EACH calls used by owner queries.
Unsupported/configuring syntax, including PRAGMA and table-valued pragma paths,
is refused before native preparation; the native reader/readonly classification
is an additional check. This is a finite admitted syntax, not a general SQL parser.

The portable `ISqliteCoordinatedReadCapability` opens one
`ISqliteCoordinatedReadScope`. That scope exposes `begin`, readonly `prepare`
(`get`/`all`), `end` and `close`; it exposes no writable SQL execution or iterator.
Reads require a begun scope and fail after end or close. BEGIN alone does not
anchor a snapshot: the first actual database read anchors all schema, identity,
reference and selected-data queries in the operation. End and close are separate
actions so a failed end cannot prevent the close attempt. The existing rollback
`ISqliteReadCapability` and CLI-005 keep their no-filesystem-write contracts.

History's alpha `readHistorySelection` receives injected coordinated SQLite and
SHA-256 capabilities, an explicit location/logical store, an exact reference and a
discriminated fact/fingerprint request. Its fact reply uses `ISelectedFact`; its
fingerprint reply uses `ISelectedFingerprintResolution`. The facade supplies Node
Machine capabilities without constructing a workspace or loading author modules.
No caller-owned open reader is added.

## Selection and failure invariants

Reuse `ICompletedResultReader`'s individual selection semantics, not an inferred
resource lifetime. `ISelectedFact` can contain an object; normalize the selected
answer with Value's `normalizeSelectedFact`, verify operation/address
correspondence and finish realization before release. Selected containers retain
their existing subtree meaning. Finite means a closed request/resource lifetime,
not constant bytes/time or a new arbitrary size bound. Fingerprint queries load
no payload. Do not change Value's root/selection domain or escaped-view policy.

Validate the supported History schema and logical-store identity without calling
`initializeSchema` or `openDurableHistory`. Reuse exact locator, store, scope,
completion and stored encoding/index validation before reading selected rows.
Separate selected-index read construction from insertion and full verification;
preserve the existing writable authority's contracts. The preliminary schema
version probe must not swallow a storage failure and substitute a later schema
diagnosis. Only evidenced incompatibility is a schema conclusion.

Preserve the following existing meanings:

- Host-proven missing input is `SqliteReadError('absent')`; unavailable access
  or an unknown native error is not proof of absence. Host-proven corrupt or
  recovery-required storage uses those existing codes and preserves its cause.
  Do not diagnose corruption, permissions or recovery from arbitrary error text.
- Empty/incomplete or foreign-valid schemas, wrong file identity and unsupported
  schema versions are `HistorySchemaError`. A missing/malformed/wrong-scope exact
  reference, unsupported stored result encoding/index, or inconsistent selected
  data is `HistoryIntegrityError`. None is a successful cache miss or fallback.
- Exact-reference validation precedes fingerprint results. The existing index's
  keyed-projection fingerprint is `unavailable`; a non-projection request
  encoding mismatch, selected-value root or Value shape rejection is
  `incompatible`. Indexed or proved-absence facts can be `compatible`.
  Present-index damage and storage failures never become unavailable or
  incompatible. The interface's `ambiguous` case is not manufactured by this
  backend. Invalid direct selections retain Value's `TypeError` behavior.
- Exhausted Machine contention is translated at History's capability boundary to
  `HistoryBusyError`, retaining the exact `SqliteBusyError` cause. Apply each
  established boundary translation before causal failure aggregation.

Attempt end and close after any acquired scope, including after begin/query
failure. One failure propagates unchanged after its owning translation, including
thrown undefined. Multiple failures use standard `AggregateError`: request
failure first when present, then end/close failures in causal order. Failure of
release prevents ordinary success. No automatic retry or successful release after
arbitrary native malfunction is promised.

## Physical policy and supported evidence

The new capability permits only enumerated native WAL/SHM coordination under
evidenced eligible layouts while preserving main bytes, committed WAL and domain
contents. No application initialization, migration, recovery, checkpoint, journal
conversion, writable fallback or sidecar cleanup is authorized. Missing stays
missing; an empty file and its entries stay unchanged. Healthy foreign/wrong-
version refusal can have eligible native coordination; it is not a blanket
files-unchanged claim. Unknown effects fail or remain unproved, never enlarge the
allowance.

The [#302 result](../../experiments/exp-wal-coordinated-snapshot/result.md) is
bounded evidence for this mechanism, not a production allowlist or a general
layout validator. Its tiny page/frame/byte recognizers and campaign bounds are
not production size restrictions. New real History schema/index-sized fixtures
and existing Node 24/Ubuntu CI establish tested coverage under the existing
Node >=24 baseline. Other permission/media behavior remains refused or unproved;
no universal host or transient-native-write-absence claim follows. #296's REJECT
and the two historical #302 INCONCLUSIVE runs remain unchanged.

## Acceptance and exclusions

Write outcome and negative Jest/tsd assertions first. Use real History fixtures
in separate writer/inspection processes during active WAL and after healthy
closure; coordinate publication between validation/selection and prove coherent
exact reads and writer progress after release while inspection remains alive.
Instrument selected loads and reject all execution, source-policy, claim,
acceptance/publication and author-module paths. Exercise direct/fingerprint
semantics, schema-version-probe storage failure, fingerprint storage failure,
typed busy causes, detached results after closure and physical refusal outcomes.

Real fixtures cover reachable opening/query/contention/schema/refusal behavior.
Injected host-adapter end/close, multiple-failure and thrown-undefined controls
must be labeled honestly: prove attempted cleanup and retained causes, not
genuine native-malfunction release. Keep the new ordinary tests in existing
package/check/test/build and PR-shard discovery. Do not rerun the spent #302
qualifier. Independent review precedes delivery.

No new CLI verb, report application, renderer, recent-history retention,
enumeration, subscription, aggregate engine or escaped lazy-view policy belongs
here. #272 scale and #301's within-person work remain separate. This operation is
only the selected-result access dependency of the complete inspection checkpoint.
