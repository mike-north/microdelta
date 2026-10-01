---
"@microdelta/history": minor
"@microdelta/supervision": minor
"microdelta": minor
---

Wait for the store's writer lease until an operator deadline, with a typed writer-busy outcome (project-private `@alpha` surfaces).

- **Waiting.** A normal request that finds another run, in this or another process, holding the writer lease now waits instead of failing. It polls on Supervision's timer every `writerWait.pollMilliseconds` (default one second), and also wakes exactly at the holder's recorded expiry and at the deadline. History alone decides takeover: an expired lease is taken over only through a fresh fence, and a poll changes nothing but the clock high-water. Concurrent requests of one run share one wait.
- **Deadline.** `writerWait.deadline` (whole epoch milliseconds) has no default: without one a request waits until it holds the lease or a stop ends the wait. A deadline already reached still allows one attempt. At the deadline the request fails with `WriterBusyError` (code `writer-busy`), which names the holder and expiry its final attempt observed. The `writer-unavailable` code is removed.
- **Stops.** Any stop, soft or hard, ends a wait at once with `stopped`; a stop already in force does not keep a request from a free lease. Check-only and recovery requests never wait.
- **Contention.** When SQLite stays locked past its bounded busy wait, the try is reported as contention, never as a raw driver error, and at the deadline it is a `WriterBusyError` marked `contended` that names the writer recorded then, when it could be read.
- **Writer port.** Supervision's `IRunWriter` now exposes `tryLease()`, which returns an `IWriterAttempt` (`acquired`, `held` or `contended`) instead of throwing. `IRunOptions.writerWait` and the facade's `IWorkspaceRunOptions.writerWait` carry the operator's policy, and `WriterBusyError` and `IWriterWaitOptions` are exported from the facade.
- **History.** Renewal and release no longer assign the writer row's fence column; only a grant writes it. History re-exports Machine's `SqliteBusyError`, which its operations raise unchanged on storage contention.
