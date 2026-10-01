---
"@microdelta/history": minor
"@microdelta/machine-node": minor
"@microdelta/supervision": minor
"microdelta": minor
---

Wait for the store's writer lease until an operator deadline, with a typed writer-busy outcome. This is a breaking change to project-private `@alpha` surfaces.

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
