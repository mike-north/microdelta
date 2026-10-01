# @microdelta/history

## 0.2.0
### Minor Changes

- c0eaf43: Add an operation journal, environment namespaces and recorded promotion to History's durable authority (project-private `@alpha` surfaces).
  
  - **Operation journal.** `openJournal(declaration)` returns a journal port for Run Supervision's operation and deferral records. History stores them as opaque versioned records, each addressed by analysis, environment, an owner-named collection and key.
    - A commit is atomic and uses compare-and-set on revisions. It runs under the current writer's holder, fence and unexpired lease, in the same transaction.
    - Earlier revisions are kept and are immutable.
    - A record's format and version are only its version tag, never part of its identity. A write under another format compare-and-sets against the address's current revision; it never creates a parallel record.
    - A port declares the record formats and versions it understands. A record of any other format or version is refused on write, read, list and overwrite, with `JournalVersionError`. A stale expected revision is refused with `JournalConflictError`.
  - **Environment namespaces.** Acceptance records now name the environment whose verification recorded them. `recordAcceptance` requires an explicit `environment`, and so does `readAcceptances`. Resolution passes its own run environment.
    - Attempts, current heads, candidates, acceptances and journal records of one environment never satisfy a lookup in another.
  - **Recorded promotion.** `promoteResults({ target, references, evidence })` records a fenced promotion with the promoter's evidence. It admits named exact results into another environment of the same analysis, where they become candidates, dependencies and acceptance targets. `readPromotions({ target })` returns promotion records.
    - A reference that cannot be promoted into the target is refused with `HistoryIntegrityError`: unknown, of another analysis, or already published in the target.
    - A promotion moves no current head. It never rewrites the promoted results, their provenance or their original environment's acceptances.
  - **Storage.** The durable SQLite schema is now version 2. A file at any other version, including a version 1 file written by an earlier release, is rejected by its recorded version with `HistorySchemaError`. Stored data is not migrated.
- a6addaa: Wait for the store's writer lease until an operator deadline, with a typed writer-busy outcome. This is a breaking change to project-private `@alpha` surfaces.
  
  - **Waiting.** A normal request that finds another run, in this or another process, holding the writer lease now waits instead of failing. It polls on Supervision's timer every `writerWait.pollMilliseconds` (default one second) and also wakes exactly at the holder's recorded expiry and at the deadline. History alone decides takeover: an expired lease is taken over only through a fresh fence, and a poll changes nothing but the clock high-water. Concurrent requests of one run share one wait.
  - **Deadline.** `writerWait.deadline` (whole epoch milliseconds) has no default: without one a request waits until it holds the lease or a stop ends the wait. A deadline already reached still allows one try. At the deadline the request fails with `WriterBusyError` (code `writer-busy`), which names the holder and expiry its final try observed, or reports storage contention, and says when the recorded holder is the run itself (`heldByThisRun`).
  - **Breaking: `writer-unavailable` is removed.** `writer-busy` replaces it as the code a held writer lease produces.
  - **Breaking: the writer port only tries.** `IRunWriter.lease()` is removed. Its replacement, `IRunWriter.tryLease()`, returns an `IWriterAttempt` (`acquired`, `held` or `contended`) instead of throwing.
  - **Stops.** Any stop, soft or hard, ends a wait at once with `stopped`; a stop already in force does not keep a request from a free lease. Check-only and recovery requests never wait.
  - **Breaking: History reports contention as an outcome.** When SQLite stays locked past its bounded busy wait:
    - `acquireWriter` now returns a `contended` outcome (`IWriterContention`) carrying the writer recorded at that moment, read without the write lock.
    - `renewWriter` now returns an `IWriterRenewal`, either `renewed` with the extended lease or `contended`. A busy renewal therefore leaves the lease in place instead of being treated as stale.
  
    Neither ever surfaces a raw driver error. Renewal and release no longer assign the writer row's fence column; only a grant writes it.
  - **Nested runs.** A workspace run started from inside an open run over the same store file is refused at once with `invalid-request`; it would otherwise wait forever for the lease its caller holds. This holds whichever workspace object opened the file and however its location was spelled, using machine-node's new `canonicalNodeLocation`, which gives an existing file's real path.
  - **Facade.** Workspace runs accept `writerWait`, and the facade exports `WriterBusyError` and `IWriterWaitOptions`.

### Patch Changes

- Updated dependencies [af7323b]
- Updated dependencies [dba23f0]
- Updated dependencies [00f672e]
  - @microdelta/machine@0.2.0
  - @microdelta/value@0.1.1

## 0.1.0
### Minor Changes

- 3420440: Add the project-private `@alpha` durable History authority for a local SQLite store. It records never-reused keyed attempts and their outcomes, enforces one leased and fenced logical writer, and atomically publishes immutable scoped completed results with their current pointers. Exact references continue to address their original historical results, and indexed reads select only requested facts; read-only recovery reports an identified attempt as absent, incomplete, unsuccessful, or completed, and inconsistent stored history fails closed. The existing public row Store API is unchanged. This bounded contract does not claim general concurrent-worker coordination, power-loss durability, or a stable public API.
- 709fb57: Add alpha nested selected reads over exact retained results. Value selects the scalar fact or container shape at one structured address and validates untrusted node and selected-fact envelopes in one pass, History adds an optional synchronous navigation reader capability, Tracking creates observer-owned lazy views over a node source with the same observation semantics as tracked inputs, and Materialization composes them through `materializeView`. Scalar-only readers keep their existing behavior.
- 2f70608: Add canonical keyed-projection encoding and normalization to Value, expose its observation facts through History and Tracking's alpha ports, and add bounded selected Materialization for scalar reads, detached output, and explicit member projections.

### Patch Changes

- Updated dependencies [39eef60]
- Updated dependencies [709fb57]
- Updated dependencies [2f70608]
- Updated dependencies [0b26e08]
  - @microdelta/machine@0.1.0
  - @microdelta/value@0.1.0
