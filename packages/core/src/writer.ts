/**
 * The facade's writer port: History's single-writer lease adapted to the
 * non-blocking port Run Supervision waits on. It translates between the two
 * owners' contracts and decides nothing itself. History stays the only lease
 * authority (fencing, expiry, takeover); Supervision owns whether and how long
 * to wait. This module is internal to the facade and not part of its entry.
 */
import { SqliteBusyError, StaleWriterError } from '@microdelta/history';
import type { IDurableHistory, IWriterAcquisition, IWriterLease } from '@microdelta/history';
import type { IRunWriter, IWriterAttempt } from '@microdelta/supervision';

/**
 * History's single-writer lease as one run's writer port. Each try renews the
 * run's lease while History still accepts it; a lease that expired or was
 * superseded is dropped and a fresh one is acquired, with a new fence, so
 * History's fencing (not this port) still rejects anything the stale lease
 * might have written. Another unexpired holder is reported as `held`, never
 * as a failure: waiting is Supervision's decision. When SQLite stays locked
 * past its bounded busy wait (History's typed `SqliteBusyError`, which changed
 * nothing), the try reports `contended` together with the writer recorded at
 * that moment, read without the write lock; a raw driver failure never
 * reaches Supervision. The lease is released once when the run closes.
 * @param history - The durable History authority of the workspace.
 * @param holder - The run's opaque holder identity, for diagnostics; the fence, not the name, orders writers.
 * @param leaseMilliseconds - The lease duration requested at each acquisition and renewal.
 * @returns The run's writer port.
 */
export function writerFor(history: IDurableHistory, holder: string, leaseMilliseconds: number): IRunWriter {
  let held: IWriterLease | undefined;
  /** Report the run's valid lease. */
  const acquired = (lease: IWriterLease): IWriterAttempt => Object.freeze({ kind: 'acquired', lease });
  /**
   * Report storage contention, naming the writer recorded at that moment when
   * a lock-free inspection can read it. An inspection that is itself busy
   * leaves the holder unknown rather than guessed.
   */
  const contended = (busy: SqliteBusyError): IWriterAttempt => {
    let recorded: IWriterLease | undefined;
    try {
      recorded = history.currentWriter();
    } catch (error: unknown) {
      if (!(error instanceof SqliteBusyError)) {
        throw error;
      }
    }
    return Object.freeze({ kind: 'contended', holder: recorded?.holder, expiresAt: recorded?.expiresAt, detail: busy.message });
  };
  return Object.freeze({
    tryLease(): IWriterAttempt {
      if (held !== undefined) {
        try {
          held = history.renewWriter(held, leaseMilliseconds);
          return acquired(held);
        } catch (error: unknown) {
          if (error instanceof SqliteBusyError) {
            // The renewal changed nothing; the run may still hold its lease, so it keeps it for the next try.
            return contended(error);
          }
          if (!(error instanceof StaleWriterError)) {
            throw error;
          }
          held = undefined;
        }
      }
      let acquisition: IWriterAcquisition;
      try {
        acquisition = history.acquireWriter({ holder, leaseMilliseconds });
      } catch (error: unknown) {
        if (error instanceof SqliteBusyError) {
          return contended(error);
        }
        throw error;
      }
      if (acquisition.kind === 'held') {
        return Object.freeze({ kind: 'held', holder: acquisition.holder, expiresAt: acquisition.expiresAt });
      }
      held = acquisition.lease;
      return acquired(held);
    },
    release(): void {
      if (held !== undefined) {
        const lease = held;
        held = undefined;
        try {
          history.releaseWriter(lease);
        } catch (error: unknown) {
          // An expired lease is no longer held by anyone on this run's behalf; there is nothing to release.
          // Any other failure, including SQLite contention, reaches Supervision, which reports it as a
          // diagnostic of the closed run; the lease then ends at its recorded expiry, as after a crash.
          if (!(error instanceof StaleWriterError)) {
            throw error;
          }
        }
      }
    },
  });
}
