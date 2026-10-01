/**
 * The facade's writer port: History's single-writer lease adapted to the
 * non-blocking port Run Supervision waits on. It translates between the two
 * owners' contracts and decides nothing itself. History stays the only lease
 * authority (fencing, expiry, takeover) and classifies storage contention
 * itself (PUB-005); Supervision owns whether and how long to wait. This module
 * is internal to the facade and not part of its entry.
 */
import { StaleWriterError } from '@microdelta/history';
import type { IDurableHistory, IWriterContention, IWriterLease } from '@microdelta/history';
import type { IRunWriter, IWriterAttempt } from '@microdelta/supervision';

/**
 * History's single-writer lease as one run's writer port. Each try maps
 * exactly one History outcome:
 *
 * - while the run holds a lease, it renews it. `renewed` is the run's valid
 *   lease. `contended` keeps the lease, because History changed nothing and
 *   refused nothing, and the next try renews again. `StaleWriterError` means
 *   the lease expired or was superseded, so it is dropped and the same try
 *   acquires afresh, with a new fence;
 * - otherwise it acquires: `acquired`, `held` and `contended` pass through.
 *
 * Every other failure (damaged storage, an unusable clock) propagates: waiting
 * cannot cure it. The lease is released once when the run closes.
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
   * Report History's contention outcome. The recorded writer is this run's
   * own only when it is exactly the lease the run holds, same holder and fence.
   */
  const contended = (contention: IWriterContention, own: IWriterLease | undefined): IWriterAttempt => Object.freeze({
    kind: 'contended',
    holder: contention.writer?.holder,
    expiresAt: contention.writer?.expiresAt,
    heldByThisRun: own !== undefined && contention.writer?.holder === own.holder && contention.writer.fence === own.fence,
    detail: contention.detail,
  });
  return Object.freeze({
    tryLease(): IWriterAttempt {
      if (held !== undefined) {
        try {
          const renewal = history.renewWriter(held, leaseMilliseconds);
          if (renewal.kind === 'contended') {
            return contended(renewal, held);
          }
          held = renewal.lease;
          return acquired(held);
        } catch (error: unknown) {
          if (!(error instanceof StaleWriterError)) {
            throw error;
          }
          held = undefined;
        }
      }
      const acquisition = history.acquireWriter({ holder, leaseMilliseconds });
      switch (acquisition.kind) {
        case 'acquired':
          held = acquisition.lease;
          return acquired(held);
        case 'held':
          return Object.freeze({ kind: 'held', holder: acquisition.holder, expiresAt: acquisition.expiresAt });
        case 'contended':
          return contended(acquisition, undefined);
        default: {
          const exhaustive: never = acquisition;
          return exhaustive;
        }
      }
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
