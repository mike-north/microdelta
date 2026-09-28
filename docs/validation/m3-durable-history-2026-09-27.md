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

Out of scope, and owned by dependent tickets: Resolution's derivation of attempt keys and intent
digests, the `recover` entry operation, and the full workspace authoring-path
recovery proof after lost acknowledgment. This record proves History's own
stable key and intent boundary; it does not prove that path.

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
`AttemptConflictError`. `recoverAttempt` is read-only. A `completed` recovery first resolves its exact
result, so a missing or corrupted result is an integrity failure, not a
dangling success. It returns one of
`absent`, `incomplete`, `unsuccessful` or `completed`. It never executes,
publishes or records acceptance.

**Candidates and acceptance.** `findCandidates` filters by the scoped subject
and compatibility version, orders by latest publication and reads metadata
only. `recordAcceptance` requires the writer lease but no attempt. It never
changes the result or the current pointer, so a version-1 rollback leaves the
version-2 pointer in place.

**Selected index.** The index adopts the seven requirements from the #54 gate.
It is generated from the canonical payload inside the publish transaction.

History adds read-time verification:

- A scalar leaf must equal its address's MDO1 `value` digest.
- A subtree must equal its node's MDS1 digest.
- `verifyResult` regenerates the whole index from the payload and compares it.

The reader also validates each index metadata row against its node kind and
address, and requires unique stored key order. Storage-shape failures raise
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
tests failed with that error. (Independent review later added three tests;
their observed failures are recorded under review repairs.) A stub failure shows only that the factory did
nothing, not that the assertions discriminate. That evidence is the mutation
controls below.

## Acceptance mapping

| Issue criterion | Named tests (`packages/core/test/durable-history`) |
| --- | --- |
| 1. Versioned schema; unknown or incomplete storage rejected; exact scope; integrity failures never follow current | `durable-history.test.ts`: *a new file receives a versioned History schema…*; *a file holding another logical store, another schema version, an incomplete or foreign schema…*; *exact references resolve their own snapshot…*; *subjects are complete opaque strings…*; *a tampered index row or stored encoding is detected* |
| 2. Lifecycle, candidates, exact and selected reads, separate acceptance, opaque provenance with explicit dependencies, retained history | *allocation commits a never-reused identity…*; *a staged attempt is not a completed result…*; *dependencies must be exact completed results…*; *candidates filter by compatibility version…*; *stored results and acceptances are immutable in storage*; tsd `packages/history/test-d/durable.test-d.ts` |
| 3. One writer; fenced mutations; allocation before staging; one publication commit; rollback never rewinds current | *one live holder at a time…*; *a lease is fenced by its token alone…*; *a staged attempt is not a completed result, and publication installs everything in one commit* (in-process throw before commit); *candidates filter…rollback acceptance never rewinds current…*; crash suite below |
| 4. Stable keys recover one execution; lost acknowledgment; changed intent rejects; clock policy; injected host | *stable keys identify one execution…*; *a kill after the publication commit but before acknowledgment is recovered by its stable key…*; *a backward host clock…*; *a forward jump can expire a lease early, after which the old fence cannot allocate, stage or publish…*; *an unavailable or invalid clock reading…* |
| 5. Independent processes on the real backend: kills, stale holders, monotonic allocation, retained results, fresh equal, acceptance, corruption, indexed reads | `crash-recovery.test.ts` (8 tests, below); *fresh equal output is a distinct result…*; *selected leaves, lengths and metadata fingerprints come from the index without root payload reads…*; *unread changes keep consumed fingerprints equal…*; the five *meaningful corruption* tests |
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
unchanged suites and restored the build. The work-record script requires each
anchor to match exactly once and requires the restored build to pass all 32
tests.

| Planted defect | Rejected by |
| --- | --- |
| Holder and fence checks removed | cross-process stale holder; forward-jump test; same-holder fence test |
| Fence equality alone removed (holder still checked) | same-holder fence test |
| Lease expiry not checked | backward-clock test |
| Clock high-water ignored | backward-clock test |
| Publication leaves the current pointer | 12 tests, including every kill boundary |
| Attempt counter not persisted (identities reissued) | 23 tests |
| Exact reads ignore stored scope | exact-reference integrity test |
| Allocation ignores intent | stable-key test |
| Recovery ignores intent | stable-key test; lost-acknowledgment test |
| Scalar leaves not verified | tampered-leaf test |
| Stored dependencies not validated | dangling/wrong-scope dependency test |
| Leaf reads also load the root payload | indexed-read I/O test |
| Acceptance rewinds the current pointer | rollback acceptance test |
| Index metadata not validated against node kind | kind-contradicting metadata test |
| Completed recovery does not resolve its result | completed-recovery integrity test |

The first run exposed two faults in the controls themselves; the tests were
not at fault.

- One anchor had the wrong indentation and matched nothing.
- A control that removed only the dangling-dependency check was **not**
  rejected. The following scope check also rejects a missing row, because its
  LEFT JOIN yields a null scope. The control was corrected to remove all
  dependency validation, which the test rejects.

No assertion was weakened. After independent review, the fence-only,
metadata and recovery controls were added, and the recovery-intent anchor was
updated for the changed code. All 15 controls are rejected. A publication split across two commits was not
planted; that boundary rests on the in-process rollback and SIGKILL tests.

## Review repairs

A separate read-only reviewer subagent inspected the uncommitted implementation
before commit. It found no fencing, atomicity, clock or allocation defect, and
reported the following, all addressed:

| Finding | Repair and evidence |
| --- | --- |
| Fence-only staleness untested: every stale test also differed by holder, null holder or expiry | New test: the same holder re-acquires; its old token with an unexpired durable lease is rejected for publish, renew and release. The new fence-only control is rejected. The test passed on the already-correct code, so it is discrimination evidence, not a bug regression |
| Corrupted index metadata could become `incompatible` or wrong data: null array length, duplicate keys, null member fingerprint, null terminal | Kind-dependent CHECKs on nodes and addresses; reader row validation; unique key order. The new test bypasses CHECKs with `ignore_check_constraints` and **failed before the repair**, then passes |
| Recovery could report `completed` without a resolvable result | Recovery resolves the exact result first. The new test **failed before the repair** |
| The forward-jump test never ran stale stage or publish | The test now stages before the jump and asserts stale allocate, stage and publish all reject |
| Child lists were copied per child, quadratic in width, inside the publish lock | Appends in place in both index generation and subtree reads |
| Commands section empty; authoring-path recovery scope | Filled below. The scope question is raised for supervisor decision; see limitations |

## EXP-7 invariant and abstraction mapping

The retained [EXP-7 model](../../experiments/exp-7/README.md) is unchanged and
was not rerun. The pinned `tla2tools.jar` is not available in this environment,
and the recorded 2026-09-26 run remains historical evidence for its bounds. The
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
| `CurrentIsComplete`, `CompletedHistoryIsRetained` | The pointer's foreign key names a result whose scope matches; triggers forbid result deletion; `readCurrent` rejects a pointer that does not join | Kill boundaries; immutable-storage test; pointer/scope corruption surfaces as an integrity error | **Aligned** |
| `ExactReferenceReadIsStable`; `AcknowledgedHistoryIsReadable` | Locator resolution never consults current; the index is immutable | Exact references after supersession and reopen; fresh equal results; old reference after later publications | **Aligned** |
| `RebindAttempt` | Same key and intent returns the existing attempt; any current holder may stage or publish it | Kill before publication commit, then successor publication without a second body call | **Aligned** |
| `RetryCompleted`; `CompletedRetryKeepsReferenceAndSkipsBody` | Completed key returns its exact reference from `allocateAttempt` and `recoverAttempt`; publishing again returns the same reference | Lost-acknowledgment test with a file-backed body counter | **Aligned** |
| `Crash` / `Restart` preserve durable state | SQLite WAL with FULL synchronous commits; a fresh process reopens | All eight child-process tests | **Aligned** within process-termination scope |
| `Execute` bounded pre-commit retry | Outside History: no body execution | None | **Model-only assumption.** Resolution owns execution |
| Not modeled: intent digests, abandonment, acceptance records, dependencies, schema and scope validation, the selected index, corruption | Implemented here | Named tests above | **Missing from the model.** Test evidence only; the finite model is not evidence for these |

Model-only assumptions that remain unproven by implementation evidence:

- fairness and liveness;
- more than one simultaneously active contender, as in M5;
- unbounded time, fences and generations.

## Commands and results

These ran in sequence on the final implementation tree, on Node v24.14.0.

| Command | Result |
| --- | --- |
| `npm run check` | exit 0: strict TypeScript (including History's `types: []` portable check), type-aware ESLint, import boundaries, declaration preflight and API reports, fixtures, suppressions, wiring |
| `npm test` | exit 0: 164/164 tooling tests; facade suite 35/35 (32 durable History); every package, experiment and control suite passed; tsd for History including `durable.test-d.ts` |
| `npm run build` | exit 0; generated declarations and API reports current |
| `git diff --check` | exit 0 |

The API report diff adds only alpha declarations to `packages/history/etc/history.api.md`
and `history.shared.api.md`. The facade's `microdelta.api.md` and
`microdelta.conformance.store.api.md` are unchanged, and the public rollups
export no durable symbol (tsd asserts `openDurableHistory` is absent from the
public tier).

The mutation controls were run with a work-record script outside the
repository against the emitted build. Remote CI on Node 20, 22 and 24 runs on
the pull request.

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
- **No authoring-path consumer yet (scope decision for the supervisor).**
  Issue #55's "Explicit recovery boundary" section also asks for a proof
  through the real workspace authoring path after lost acknowledgment. That
  path needs Resolution's key and intent derivation and Run Supervision's
  `recover` entry operation (#56/#57), which do not exist yet. The assignment
  classified that proof as a dependent-ticket obligation. This PR proves
  History's own key and intent boundary through independent processes. The
  supervisor should confirm the reassignment or state a narrower expectation.
- **EXP-7 not rerun.** TLC was not rerun for this change; see the mapping above.
