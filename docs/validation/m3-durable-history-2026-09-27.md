# M3 durable History authority and exact selected reader (issue #55)

Implementation base: `4edff05ac7f4770c8b01ee8e87388fa5c36aad71`. Local runs used
Node v24.14.0 on macOS with SQLite through better-sqlite3 12.9.0 via Machine's
Node adapter. Node 20 and 22 are exercised only by the repository CI matrix.
Dates are Pacific.

## Scope

History gains a project-private `@alpha` durable authority, `openDurableHistory`,
beside the unchanged row Store and memory backend. It receives Machine's
`ISqliteCapability`, `IClockCapability` and `ISha256Capability`, a location
passed only to the SQLite capability, and a logical store identity. It owns
every SQL statement and lifecycle decision:

- a versioned schema (`microdelta.history.durable`, version 1), distinct from
  the legacy Store and the EXP-3 and nested-read experiments;
- the single logical writer (holder, increasing fence, lease expiry, clock
  high-water);
- never-reused attempt identities with stable keys and intent digests;
- staging, one-commit publication and abandonment;
- per-scoped-subject current pointers and immutable completed results with a
  generated selected index;
- separate acceptance records;
- versioned opaque provenance with explicit exact dependencies.

History never imports Definition or Tracking and never interprets provenance or
evidence content. It stores content as canonical MDS1 and returns it decoded
and frozen. The facade's exports and the public Store API are unchanged
(`microdelta.api.md` is untouched). The new surface appears only in History's
alpha rollup and API reports.

**Recovery ownership (settled by the supervisor in issue #55's "Recovery
delivery ownership" section).** #55 owns durable scoped attempt keys and opaque
intent digests, conflict rejection, exact committed-result integrity, explicit
recovery states, and the real-backend component crash/reopen proof. Deriving
keys and complete current intent, and no-execution recovery through Resolution,
belong to #56. The workspace alpha normal/recover entry operations belong to
#57. The independent-process proof through the assembled authoring path belongs
to #58, and final M3 acceptance (#50) stays gated on it. No proof obligation is
removed. This record claims only the #55 component boundary.

## Evidence roles

| Role | Evidence |
| --- | --- |
| Author (Claude Code Opus 5.5 implementer) | Tests, implementation, repairs, mutation controls and every local gate result in this record, unless attributed below |
| Peer (author-dispatched read-only Claude reviewer subagent) | Pre-commit review findings listed under *Author-requested peer review repairs* |
| Supervisor (Codex Astra and its commissioned independent reviewer) | Review of head `80554619`: three confirmed integrity findings with saved real-SQLite probes; a 509-check valid-domain parity probe; the fresh EXP-7 TLC reruns. The author reran these probes unchanged after the repairs; the results are listed under *Supervisory review repairs* |
| Model (EXP-7 TLA+) | Finite-state safety evidence for the modeled protocol only; never evidence for TypeScript, SQL, or corruption handling |

## Owned contract

**Scope and locators.** A locator is `mdh1|` followed by the canonical JSON array
`[logicalStore, analysis, environment, resultId]`. The result identity is the
never-reused identity of the attempt that produced it. Exact resolution checks:

- the grammar and canonical spelling;
- the logical store;
- the stored analysis and environment;
- existence;
- completion of the producing attempt;
- the stored encoding (`MDS1`) and index version.

Any mismatch raises `HistoryIntegrityError`. The current pointer is never consulted.
Subjects are complete opaque strings; no prefix is added or parsed.

**Schema.** An empty file is initialized inside one IMMEDIATE transaction; an existing
file is validated without taking the write lock.
Otherwise the file must hold exactly the expected tables, indexes and triggers,
with definitions equal after whitespace normalization. It must also hold one
identity row with this schema name, this version and the requested logical
store. Any other file raises `HistorySchemaError` before work: foreign,
incomplete, extended, other-version or other-store. Kind-dependent CHECKs constrain index rows (for example, an array node must
have a length and a record node its key order and chain terminal). Storage
triggers reject
updates and deletes of results, index rows, dependencies, acceptances and
identity, and deletes of attempts, current pointers and writer/sequence rows.

**Transitions.** Each transition is one IMMEDIATE transaction.

| Transition | Durable change | Death before commit | Death after commit |
| --- | --- | --- | --- |
| acquire | holder, fence + 1, expiry | no change | held until expiry; successor fence + 1 |
| allocate | attempt counter + 1; `allocated` row with key, intent, fence | identity never issued | identity consumed; `incomplete` recovery |
| stage | `staged` MDS1 payload, provenance, dependency rows | stays `allocated` | candidate evidence, never a result |
| publish | result, generated index and digests, provenance, `completed`, current pointer, publication sequence | stays `staged`; a current holder may publish it | complete; recovery by key returns it |
| abandon | `failed`/`interrupted` plus evidence; staged evidence kept | unchanged | ended without a result |
| accept | acceptance row plus dependency rows | no change | retained; result and pointer untouched |

**Writer and clock policy.** Every holder mutation reads the writer row inside
its transaction. It evaluates `now = max(host reading, persisted high-water)`
and persists `now`. It then requires the same holder, the same fence and
`expiresAt > now`. A stale lease commits only the time observation and raises
`StaleWriterError`; holder, fence, expiry, attempts, results and pointers are
unchanged. The clock must return a nonnegative safe integer. Anything else, or a
clock that throws, aborts the transaction with no change.

- Backward host movement can delay expiry.
- A forward jump can expire a lease early.
- Neither lets an old fence act after a successor acquires.

This is a local single-file policy, not a distributed-time or liveness claim.

**Stable keys.** A key is unique per logical store, analysis, environment and
subject. Allocating an existing key with the same intent digest and version
returns the stored attempt in whatever state it reached, including `completed`
with its exact reference. A different intent or version raises
`AttemptConflictError`. `recoverAttempt` is read-only. Every path that reports
an attempt's outcome checks it against stored results first: re-allocation of an
existing key, re-publication of a completed attempt, and recovery. A completed
attempt's exact result must resolve, and an attempt recorded as not completed
must have no result row. Either contradiction is a `HistoryIntegrityError`,
never a success and never downgraded to incomplete work or a miss. Recovery
returns one of
`absent`, `incomplete`, `unsuccessful` or `completed`. It never executes,
publishes or records acceptance.

**Candidates and acceptance.** `findCandidates` filters by the scoped subject
and compatibility version, orders by latest publication and reads metadata
only. Every returned envelope, the current pointer's target and every returned
dependency reference go through the same exact resolution as a direct read:
completed producing attempt, matching scope, supported encoding. Corrupt history
raises `HistoryIntegrityError`; it is never silently filtered. `recordAcceptance` requires the writer lease but no attempt. It never
changes the result or the current pointer, so a version-1 rollback leaves the
version-2 pointer in place.

**Selected index.** The index adopts the seven requirements from the #54 gate.
It is generated from the canonical payload inside the publish transaction.

History adds read-time verification:

- A scalar leaf must equal its address's MDO1 `value` digest.
- A subtree must equal its node's MDS1 digest.
- `verifyResult` regenerates the whole index from the payload and compares it.

The reader also validates each index metadata row against its node kind and
address, and requires unique stored key order. An unindexed address is answered
as absent only when its longest indexed parent proves absence from shape
metadata:
- for records, the key appears in no own-key order along the parent's
  prototype chain;
- for arrays, the index has no present-element edge (a hole, or past the end).

A missing address or node row for a present member is an integrity failure,
never absent author data. Legitimate absence, holes versus present undefined,
and prototype lookup keep their Value answers without root-payload reads. Storage-shape failures raise
`HistoryIntegrityError`, never `TypeError`.
`TypeError` is reserved for Value rejecting a selection's shape, which resolves
to `incompatible`.

## Tests written before implementation

Tests live in the facade's assembly suite, because only assembly may compose
History with the Node adapter. History's own tests cannot import it:
`tooling/package-architecture.mjs` gives History no edge to it.

- `packages/core/test/durable-history/support.ts` wraps Node's real SQLite
  capability. It logs statement roles and payload cells, and can fire SIGKILL
  or a throw after a chosen transaction's SQL and before commit.
- `worker.ts` runs lifecycle scripts in independent Node processes. It writes
  each trace line synchronously so the trace survives SIGKILL.

The tests were written against the complete alpha contract while
`openDurableHistory` threw "not implemented". Both suites compiled and all 29
tests failed with that error. Later review added tests whose observed failures
are recorded in the two review-repair sections. A stub failure shows only that the factory did
nothing, not that the assertions discriminate. That evidence is the mutation
controls below.

## Acceptance mapping

| Issue criterion | Named tests (`packages/core/test/durable-history`) |
| --- | --- |
| 1. Versioned schema; unknown or incomplete storage rejected; exact scope; integrity failures never follow current | `durable-history.test.ts`: *a new file receives a versioned History schema…*; *a file holding another logical store, another schema version, an incomplete or foreign schema…*; *exact references resolve their own snapshot…*; *subjects are complete opaque strings…*; *a tampered index row or stored encoding is detected* |
| 2. Lifecycle, candidates, exact and selected reads, separate acceptance, opaque provenance with explicit dependencies, retained history | *allocation commits a never-reused identity…*; *a staged attempt is not a completed result…*; *dependencies must be exact completed results…*; *candidates filter by compatibility version…*; *stored results and acceptances are immutable in storage*; tsd `packages/history/test-d/durable.test-d.ts` |
| 3. One writer; fenced mutations; allocation before staging; one publication commit; rollback never rewinds current | *one live holder at a time…*; *a lease is fenced by its token alone…*; *a staged attempt is not a completed result, and publication installs everything in one commit* (in-process throw before commit); *candidates filter…rollback acceptance never rewinds current…*; crash suite below |
| 4. Stable keys recover one execution; lost acknowledgment; changed intent rejects; clock policy; injected host | *stable keys identify one execution…*; *a kill after the publication commit but before acknowledgment is recovered by its stable key…*; *a backward host clock…*; *a forward jump can expire a lease early, after which the old fence cannot allocate, stage or publish…*; *an unavailable or invalid clock reading…* |
| 5. Independent processes on the real backend: kills, stale holders, monotonic allocation, retained results, fresh equal, acceptance, corruption, indexed reads | `crash-recovery.test.ts` (8 tests, below); *fresh equal output is a distinct result…*; *selected leaves, lengths and metadata fingerprints come from the index without root payload reads…*; *unread changes keep consumed fingerprints equal…*; *every selection over the accepted Value edge domain equals the in-memory Value answer after reopen…*; the *meaningful corruption* tests, including the four per-transition lifecycle contradiction tests and their healthy control |
| 6. EXP-7 mapping; no M5 claim; gates | Section below; limitations; commands and results |

Process kills in `crash-recovery.test.ts` all use SIGKILL against one real file.
The Jest process reopens and inspects the file afterwards.

| Boundary | Observed outcome |
| --- | --- |
| After acquire | Successor sees `held` by the dead holder until expiry, then receives fence 3 (seed 1, killed 2); the seed result stays current and readable |
| After allocation commit | Attempt 2 `allocated`, no result, current unchanged; next allocation > 2; recovery `incomplete` |
| Inside allocation transaction | No attempt row; recovery `absent`; the next allocation receives identity 2, never issued before |
| After staging commit | Attempt `staged` with content; one result; candidates list only the seed |
| Inside staging transaction | Attempt stays `allocated` without content |
| Just before publication commit | Attempt `staged`, no result, pointer at seed. A successor re-allocates the same key, receives the staged attempt and publishes it; the body-call file still holds one call |
| After publication commit, before acknowledgment | Acknowledgment file absent. Recovery in a new process returns `completed` with the exact reference; re-allocation returns the completed attempt; one body call; a changed intent raises `AttemptConflictError` |
| Stale holder in a third process | renew, allocate, stage, publish, abandon, accept and release each raise `StaleWriterError`; holder, fence, expiry, current pointer, attempt rows and result count are unchanged |

The indexed-read test reopens the file through an instrumented connection.

- Root and array navigation, a nested name, three `merged` flags, one length,
  one key order and one absent-member check returned **0 root-payload cells**
  and exactly **4 scalar cells**: the one name and three flags consumed.
- Fingerprints for six selections and one explicit-output subtree equal
  independent Value oracles computed over the in-memory fixture.
- The fixture holds an unread 100,000-character note.
- Metadata comparison returned 0 root, scalar or staged cells.

## Mutation controls (behavioral discrimination)

Each control planted one wrong behavior in History's emitted build, ran both
unchanged suites and restored the build. The runner is checked in as
`packages/core/test/durable-history/controls/history-mutation-controls.mjs` and
is run on demand, after `npm run build` and the facade's `test:unit`. It
requires each anchor to match exactly once and each control to be rejected by
at least one named test, and it requires the restored build to pass every
baseline test (41 at the final head).

Every Jest run is judged fail-closed by `controls/control-outcome.mjs`. Its
false-success specification (`control-outcome.test.mjs`, 4 tests) runs in the
facade's `npm test` as `test:controls`. The runner rejects all of these:
- abnormal exits and missing or unparseable reports;
- runtime suite errors;
- a missing or foreign suite;
- missing, duplicated or foreign test titles;
- pending or skipped results;
- an exit status that disagrees with the assertions.

Temporary report directories are removed in `finally`, and on a signal. Planted
files are restored after each control and on error or SIGINT/SIGTERM/SIGHUP;
the final bytes are then compared with the originals.

Evidence for the runner itself (author):
- The judgment specification was run against the previous inline logic,
  extracted unchanged: **3 of 4 failed**. It passes 4 of 4 against the new
  judgment.
- The first hardened runner used `spawnSync`, which blocks signal delivery.
  An end-to-end SIGTERM partway through a control exited **0** without
  reporting completion. The build happened to be intact, but prompt restoration
  was not proven. The runner now runs Jest asynchronously; the same SIGTERM
  check exits **130**, logs `INTERRUPTED by SIGTERM; emitted files restored`,
  and matches the pre-run SHA-1 of both emitted files. No
  `history-controls-*` directory remains.
- With `crash-recovery.test.js` hidden, the runner exits **1**:
  `CONTROL RUN INVALID: unexpected suites ran: durable-history.test.js`.
- A SIGKILL cannot be intercepted. Rebuilding History restores the emitted
  files in that case.

After the lifecycle repair, three controls were added (stage, publication and
abandon each skip the attempt/result contradiction check) and one was retired.
The retired control removed verification from the completed re-publication
branch. Once publication verified the attempt before branching, that call was
redundant, so the control planted a defect in dead code and was **not
rejected**. The redundant call was removed rather than keeping an
undiscriminating control; the publication-contradiction control covers that
path.

The final run rejected **25 of 25** controls. The baseline and the restored
build each passed 41/41, the emitted files matched their pre-run hashes, and no
report directory leaked.

| Planted defect | Rejected by |
| --- | --- |
| Holder and fence checks removed | cross-process stale holder; forward-jump test; same-holder fence test |
| Fence equality alone removed (holder still checked) | same-holder fence test |
| Lease expiry not checked | backward-clock test |
| Clock high-water ignored | backward-clock test |
| Publication leaves the current pointer | 13 tests, including every kill boundary |
| Attempt counter not persisted (identities reissued) | 26 tests |
| Exact reads ignore stored scope | exact-reference integrity test |
| Allocation ignores intent | stable-key test |
| Recovery ignores intent | stable-key test; lost-acknowledgment test |
| Scalar leaves not verified | tampered-leaf test |
| Stored dependencies not validated | dangling/wrong-scope dependency test |
| Leaf reads also load the root payload | indexed-read I/O test; valid-domain parity test |
| Acceptance rewinds the current pointer | rollback acceptance test |
| Index metadata not validated against node kind | kind-contradicting metadata test |
| Completed outcomes are never resolved, on any acknowledgment path | completed-recovery test; completed-retry test |
| Completed re-allocation skips result verification | completed-retry test; incomplete-metadata test |
| Completed re-publication skips result verification | completed-retry test |
| Recovery skips outcome verification | completed-recovery, completed-retry and incomplete-metadata tests |
| Attempt/result contradiction not detected | incomplete-metadata test |
| Envelopes and candidates skip exact resolution | incomplete-metadata test |
| Current pointer skips exact resolution | incomplete-metadata test |
| Returned dependencies skip exact resolution | incomplete-metadata test |
| Absent members need no indexed proof of absence | missing-address test |

The first run exposed two faults in the controls themselves; the tests were
not at fault.

- One anchor had the wrong indentation and matched nothing.
- A control that removed only the dangling-dependency check was **not**
  rejected. The following scope check also rejects a missing row, because its
  LEFT JOIN yields a null scope. The control was corrected to remove all
  dependency validation, which the test rejects.

No assertion was weakened. Each review round added controls for its repairs
and updated anchors that the repaired code moved. A publication split across two
commits was not planted; that boundary rests on the in-process rollback and
SIGKILL tests.

## Author-requested peer review repairs

A separate read-only reviewer subagent, dispatched by the author, inspected the
uncommitted implementation before the first commit. It found no fencing, atomicity, clock or allocation defect, and
reported the following, all addressed:

| Finding | Repair and evidence |
| --- | --- |
| Fence-only staleness untested: every stale test also differed by holder, null holder or expiry | New test: the same holder re-acquires; its old token with an unexpired durable lease is rejected for publish, renew and release. The new fence-only control is rejected. The test passed on the already-correct code, so it is discrimination evidence, not a bug regression |
| Corrupted index metadata could become `incompatible` or wrong data: null array length, duplicate keys, null member fingerprint, null terminal | Kind-dependent CHECKs on nodes and addresses; reader row validation; unique key order. The new test bypasses CHECKs with `ignore_check_constraints` and **failed before the repair**, then passes |
| Recovery could report `completed` without a resolvable result | Recovery resolves the exact result first. The new test **failed before the repair** |
| The forward-jump test never ran stale stage or publish | The test now stages before the jump and asserts stale allocate, stage and publish all reject |
| Child lists were copied per child, quadratic in width, inside the publish lock | Appends in place in both index generation and subtree reads |
| Commands section empty; authoring-path recovery scope | Filled below. The scope was later settled by the supervisor; see *Scope* |

## Supervisory review repairs (head `80554619`)

The supervisor confirmed three integrity findings with real-SQLite probes. Each
probe publishes, closes, corrupts the file using this suite's own method
(triggers and foreign keys temporarily bypassed, schema restored exactly), and
reopens. Regressions were written first and run against the unrepaired build.

| Finding | Regression (observed before repair) | Repair |
| --- | --- | --- |
| Completed retry paths acknowledged a dangling result: re-allocation returned `completed` and re-publication returned the missing locator | *completed retry paths never acknowledge a missing result after reopen…*: failed at the re-allocation assertion (did not throw) | A shared `verifiedAttempt` resolves the exact result on every completed-success exit. A healthy completed attempt in the same file still acknowledges (positive control). The attempt row stays `completed`; corruption is not downgraded |
| Candidate and current lookup exposed a result whose producing attempt was tampered back to a valid `allocated` shape | *candidate, current and dependency metadata reject…*: failed at `findCandidates` (did not throw) | Envelopes, the current target and every returned dependency reference pass through exact resolution; corrupt history rejects rather than being filtered |
| (found by the author while rerunning that probe) Recovery and re-allocation then reported the contradicted attempt as `incomplete`/`allocated` work | Added to the same test: failed at `recoverAttempt` (did not throw) | An attempt recorded as not completed must have no result row, otherwise `HistoryIntegrityError` |
| A missing address row turned a present member into an absent fact (value `undefined`, own `false`, compatible fingerprint) | *a missing index address or node for a present member is an integrity failure…*: failed on the first read path (did not throw) | Absence needs indexed proof from the parent's chain key order or array edges. The test covers the address row and the node row of a record member and an array element, across navigation, value/own/membership facts, selected fingerprints and output fingerprints. Negative controls: a genuinely absent sibling, surviving descendant evidence, and an index past the end |

**Valid-domain negative control.** The supervisor's 509-check parity probe is
now a permanent test: *every selection over the accepted Value edge domain
equals the in-memory Value answer after reopen, without root payload reads*.
It covers 45 addresses × 5 operations for facts and selected fingerprints plus
navigation, and 7 subtree and output-fingerprint checks. The edge fixture is
copied from #54: custom and null prototypes, inherited and shadowed members,
holes versus present undefined, key order, NaN/−0/Infinity, Property versus
Index, and invalid paths. The test also asserts **0 root-payload cells**. It
passed both before and after the repairs, which shows the repairs preserve
valid-domain semantics.

**Author reruns of the supervisor probes after repair** (unchanged saved
scripts, final build):
- dangling-retry: recover, allocate, publish and readEnvelope all
  `HistoryIntegrityError`;
- incomplete-metadata: recover, candidates, current, allocate and readEnvelope
  all `HistoryIntegrityError`;
- missing-address: selected, own and fingerprint `HistoryIntegrityError`; root
  keys unchanged; `verifyResult` inconsistent;
- parity: `{"checks":509,"addresses":45,"result":"PASS"}`.

## Lifecycle contradiction repair (head `d2c190a`)

The supervisor's independent repair review reproduced one remaining P2 with
`/private/tmp/microdelta-issue55-repaired-lifecycle-probe.mjs`. It used the
same valid-shape producer corruption as the accepted incomplete-metadata test:
a completed attempt set back to `allocated` while its result and current pointer
remain. `stageAttempt` then committed a `staged` row and `abandonAttempt` a
`failed` row, even though reads rejected the contradiction.

The author wrote one independent test per transition. Each uses its own
corrupted file and compares every durable row a transition could change
(attempts, results, current pointers, dependencies, sequences and index nodes)
before and after. Against `d2c190a` **all four failed**:

| Transition | Observed before repair |
| --- | --- |
| Stage a contradicted `allocated` attempt | did not throw (committed) |
| Abandon a contradicted `allocated` attempt | did not throw (committed) |
| Abandon a contradicted `staged` attempt | did not throw (committed) |
| Publish a contradicted `staged` attempt (the analogous publication case) | refused only by SQLite `UNIQUE constraint failed: history_results.result_id`, the wrong error class |

**Repair.** Stage, publish and abandon now verify the attempt against stored
results inside their holder transaction, before any change, using the same
shared check as recovery. A contradiction raises `HistoryIntegrityError`, and
the durable evidence is identical before and after. A healthy-control test
shows that in the same reopened corrupted file, a normal allocate, stage,
publish (which moves the current pointer) and staged abandon still commit. The
unchanged saved probe now reports `HistoryIntegrityError` for stage, abandon,
recover, candidates, current, allocate and readEnvelope. This is bounded to the
producer/result contradiction; no broader corruption hardening was added.

## Copilot declaration finding (head `8055461`)

Copilot noted new `ae-forgotten-export` warnings for `ISha256Capability` and
`ISqliteConnection`. The durable options surface both host contracts, but
History did not re-export them. History now re-exports, from `@microdelta/machine`
as Value and Tracking do:
- the capabilities its alpha surface exposes: clock, SHA-256 and SQLite;
- the SQLite shapes reachable from a returned connection: connection,
  statement, row, value, run result and the synchronous-transaction guard.

`packages/history/test-d/host-capabilities.test-d.ts` was written first
against the generated alpha rollup. It **failed** with seven missing-export
errors and two type-identity errors, and it passes after the repair. It asserts:
- each re-export is Machine's exact contract, in both directions;
- the SQLite value domain and the Promise-rejecting transaction guard survive
  the re-export;
- the public tier exports none of it.

Both new warnings are gone. The pre-existing legacy warnings are unchanged
from base `4edff05`: `ISnapshotCapability` in the root and shared reports and
`Store` in the conformance report, one each. `history.public.d.ts` contains no
durable or host symbol, and the facade reports are unchanged.

Copilot's separate root-value finding was resolved by the supervisor as a false
positive. `observe(null, [], 'value')` throws `TypeError`, and the parity test
covers root value, own and membership rejection. Root-value semantics are
unchanged.

## EXP-7 invariant and abstraction mapping

The retained [EXP-7 model](../../experiments/exp-7/README.md) is unchanged. The
**supervisor** reran both configurations on 2026-09-27 with the pinned jar and
Java 17. The tool jar's SHA-256 is `d532ba31aafe17afba1130f92410d9257454ff7393d1eb2fe032f0c07f352da5`.
The model's SHA-256 is `4280635cb088e870d454f7bd155aeaa42e140a33fa2d9559da2fcad7c7664bc6`,
`Publication.cfg` is `e389bf7a9c1a26da7c029b6d41ec4b4636e87891f7644e6c502a9a5201c0d0d0`
and `PublicationBad.cfg` is `9db78b26edf0e492fd48da0774448b20d66eb277717035808ddf2787ab9c8fa2`.

| Configuration | Result |
| --- | --- |
| Faulty (`PublicationBad.cfg`) | exit 12 at `PublicationUsedCurrentAuthority`, depth 8, 47,256 generated / 13,732 distinct states |
| Corrected (`Publication.cfg`) | exit 0, 29,599,222 generated / 2,624,759 distinct states, zero queued, depth 24, 2 min 11 s |

This reproduces the 2026-09-26 figures. It is finite-model evidence for the
modeled protocol within its bounds, not proof of this TypeScript/SQLite
implementation, and the author did not run TLC. The
table compares each model element with this implementation (`packages/history/src/durable/`)
and the named tests. It uses PUB-004's classifications.

| Model element | Implementation | Tests | Assessment |
| --- | --- | --- | --- |
| `Authorized` = live lease ∧ `CurrentFence`; `PublicationUsedCurrentAuthority`; faulty `OmitPublishFence` | `asHolder` checks holder, fence and `expiresAt > now` inside every mutation's transaction, including publication | Cross-process stale holder; forward jump; same-holder fence test. The fence-only control reproduces the model's counterexample class (a live lease, a matching holder, a stale fence) | **Aligned** |
| `RejectedStaleMutationPreservesDurableState` (holder, expiry, fence, current) | A stale mutation commits only the time high-water, then throws | Cross-process stale holder compares holder, fence, expiry, current, attempts and result count | **Aligned** for the modeled fields. The time high-water intentionally advances; the model does not represent it |
| `Acquire`, `Reclaim`, `Held`, `Renew`, `Release`, `RejectRenew`, `RejectRelease` | `acquireWriter`, `renewWriter`, `releaseWriter`; release keeps the fence | *one live holder at a time…*; kill after acquire (fence 3); stale holder | **Aligned** |
| `Tick`: global monotonic model time | Host clock with persisted high-water, `max(host, high-water)` | Backward clock, forward jump, invalid clock | **Divergent by design.** The model checks no clock behavior; the implementation's clock policy is proven only by these tests |
| `DurableHighWaterNeverRegresses` (fence, generation) | Fence and store-wide attempt, publication and acceptance counters only increase; rolled-back allocation issues nothing | Kill after acquire (fence 3); allocation monotonicity with abandonment and reopen; kill inside allocation (identity 2) | **Aligned.** The representation differs: a store-wide attempt identity, not per-subject generations (PUB-003 permits either) |
| `Allocate`, then `Stage`, then `AtomicPublish` phase order; staged is not current | `allocateAttempt` commits first; `stageAttempt` needs `allocated`; `publishAttempt` needs `staged` | Kills after and inside allocation and staging; staged-not-result tests | **Aligned** |
| `AtomicPublish` / `AbortPublish` | One transaction installs the result, index, provenance, completed state, pointer and sequence | In-process throw before commit; SIGKILL before commit; kill after commit | **Aligned.** Stepwise SQL interruption is covered by real kills, not by the model |
| `CurrentIsComplete`, `CompletedHistoryIsRetained` | The pointer's foreign key names a result whose scope matches; triggers forbid result deletion; `readCurrent` resolves its target exactly (completed attempt, scope, encoding) | Kill boundaries; immutable-storage test; incomplete-metadata test | **Aligned** on committed transitions. Corrupted storage is outside the model and now fails closed (supervisory repair) |
| `ExactReferenceReadIsStable`; `AcknowledgedHistoryIsReadable` | Locator resolution never consults current; the index is immutable | Exact references after supersession and reopen; fresh equal results; old reference after later publications | **Aligned** |
| `RebindAttempt` | Same key and intent returns the existing attempt; any current holder may stage or publish it | Kill before publication commit, then successor publication without a second body call | **Aligned** |
| `RetryCompleted`; `CompletedRetryKeepsReferenceAndSkipsBody` | Completed key returns its exact reference from `allocateAttempt` and `recoverAttempt`; publishing again returns the same reference; every such return first resolves the result | Lost-acknowledgment test with a file-backed body counter; completed-retry corruption test | **Aligned.** Integrity of a missing result is test-only evidence; the model always retains completed results |
| `Crash` / `Restart` preserve durable state | SQLite WAL with FULL synchronous commits; a fresh process reopens | All eight child-process tests | **Aligned** within process-termination scope |
| `Execute` bounded pre-commit retry | Outside History: no body execution | None | **Model-only assumption.** Resolution owns execution |
| Not modeled: intent digests, abandonment, acceptance records, dependencies, schema and scope validation, the selected index, corruption | Implemented here | Named tests above | **Missing from the model.** Test evidence only; the finite model is not evidence for these |

Model-only assumptions that remain unproven by implementation evidence:

- fairness and liveness;
- more than one simultaneously active contender, as in M5;
- unbounded time, fences and generations.

## Commands and results

These ran in sequence, each to completion, on the final tree after the
lifecycle repair, on Node v24.14.0.

| Command | Result |
| --- | --- |
| `npm run check` | exit 0: strict TypeScript (including History's `types: []` portable check), type-aware ESLint, import boundaries, declaration preflight and API reports, fixtures, suppressions, wiring |
| `npm test` | exit 0. Tooling 164/164. Facade Jest 44/44, of which 41 are durable History; facade control judgment 4/4; History tsd including `durable.test-d.ts` and `host-capabilities.test-d.ts`. Every other package, experiment and control suite passed: Jest counts 81, 44, 49, 34, 93, 50, 24, 28, 5, 16 and 12, plus node:test 5/5 |
| `npm run build` | exit 0; generated declarations and API reports current |
| `git diff --check` | exit 0 |

The API report diff adds only alpha declarations to `packages/history/etc/history.api.md`
and `history.shared.api.md`. The facade's `microdelta.api.md` and
`microdelta.conformance.store.api.md` are unchanged, and the public rollups
export no durable symbol (tsd asserts `openDurableHistory` is absent from the
public tier).

The mutation controls ran through the checked-in runner described above
(25/25, run separately from these commands). Remote
CI on Node 20, 22 and 24 runs on the pull request.

## Limitations

- **Process termination only.** Real SIGKILL and reopen of one local file.
  Not concurrent writers or workers, power loss, device or filesystem failure,
  network filesystems, distributed clocks or multi-host durability. **No M5
  concurrency claim.**
- **No exactly-once work.** The stable key avoids repeating committed work
  after lost acknowledgment. It does not make uncommitted external work run
  exactly once.
- **Container roots only.** Payload roots must be records or arrays, carried
  from the #54 contract. Scalar-root results are rejected at staging.
- **Scope-local dependencies.** Dependencies and acceptance dependencies must be
  completed results in the same logical store, analysis and environment.
  Cross-scope dependencies are rejected rather than guessed.
- **Keyed projections unavailable.** They resolve `unavailable` from this
  reader, as in the #54 candidate.
- **Payload evidence counts cells.** It counts SQL result cells returned, not
  disk-page I/O. Index generation encodes each container subtree for its
  digests, so its cost grows with nodes times depth. It runs inside the publish
  transaction. No M7 scale, memory or eviction claim.
- **Assembled-path recovery is not claimed here.** Per the settled ownership
  in *Scope*, this record proves only History's component boundary. The
  lost-acknowledgment proof through the assembled authoring path belongs to #58,
  with #56 and #57 supplying its parts; #50 remains gated on it.
- **Model evidence is bounded.** The supervisor's TLC reruns cover the unchanged
  finite model only; see the mapping above.
- **Corruption detection is not complete verification.** Read paths detect
  the corruption classes tested here, but only `verifyResult` compares a whole
  index against its payload. Other out-of-band edits may surface only there.
